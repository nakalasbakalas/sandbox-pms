"""Channel manager integration adapter layer.

Provides a provider-agnostic interface for synchronising reservations,
inventory, and rates with external OTA / channel-manager systems.

Architecture
------------
``ChannelProvider``  — abstract base class that each adapter implements.
``ChannelSyncService`` — orchestrator that dispatches to the correct provider.

The module ships with a ``MockChannelProvider`` for safe local testing and a
``ICalChannelProvider`` that delegates to the existing ``ical_service`` for
iCal-based OTA integrations (Airbnb, Booking.com, VRBO, etc.).

Adding a new provider
---------------------
1. Create a subclass of ``ChannelProvider`` in a new module or inline here.
2. Register it in ``PROVIDER_REGISTRY``.
3. Map room types / rate plans via ``ChannelMapping`` records in the database.
"""

from __future__ import annotations

import json
import uuid
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import sqlalchemy as sa

from ..audit import write_audit_log
from ..extensions import db
from ..models import (
    ExternalCalendarBlock,
    ExternalCalendarSource,
    ExternalCalendarSyncRun,
    InventoryDay,
    Reservation,
    Room,
    RoomType,
    utc_now,
)
from ..pricing import get_setting_value, money, quote_reservation


# ---------------------------------------------------------------------------
# Data transfer objects
# ---------------------------------------------------------------------------

@dataclass
class InboundReservation:
    """Normalised external reservation payload ready for PMS import."""

    external_booking_id: str
    external_source: str  # provider key, e.g. "booking_com"
    guest_name: str
    guest_email: str | None = None
    guest_phone: str | None = None
    room_type_code: str | None = None
    check_in: date | None = None
    check_out: date | None = None
    adults: int = 2
    children: int = 0
    total_amount: Decimal | None = None
    currency: str = "THB"
    deposit_hint: Decimal | None = None
    notes: str | None = None
    raw_payload: dict[str, Any] = field(default_factory=dict)
    is_cancellation: bool = False


@dataclass
class OutboundInventoryUpdate:
    """Inventory / rate push payload for an external channel."""

    room_type_code: str
    date_from: date
    date_to: date
    available_count: int
    rate_amount: Decimal | None = None
    currency: str = "THB"
    closed_to_arrival: bool = False
    closed_to_departure: bool = False
    min_stay: int | None = None


@dataclass
class SyncResult:
    """Outcome of a sync operation."""

    provider: str
    direction: str  # "inbound" or "outbound"
    success: bool
    records_processed: int = 0
    errors: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class ChannelMapping:
    """Maps an internal room type / rate plan to an external channel code."""

    provider: str
    internal_room_type_id: uuid.UUID
    external_room_type_code: str
    external_rate_plan_code: str | None = None
    is_active: bool = True


# ---------------------------------------------------------------------------
# Abstract provider
# ---------------------------------------------------------------------------

class ChannelProvider(ABC):
    """Interface every channel adapter must implement."""

    @property
    @abstractmethod
    def provider_key(self) -> str:
        """Unique identifier for this provider (e.g. ``booking_com``)."""

    # -- Inbound (pull) ---------------------------------------------------

    @abstractmethod
    def pull_reservations(self, since: datetime | None = None) -> list[InboundReservation]:
        """Fetch new / updated reservations from the external system."""

    # -- Outbound (push) --------------------------------------------------

    @abstractmethod
    def push_inventory(self, updates: list[OutboundInventoryUpdate]) -> SyncResult:
        """Push availability / rate updates to the external system."""

    # -- Lifecycle --------------------------------------------------------

    @abstractmethod
    def test_connection(self) -> bool:
        """Return ``True`` if the provider credentials are valid."""


# ---------------------------------------------------------------------------
# Mock / sandbox provider
# ---------------------------------------------------------------------------

class MockChannelProvider(ChannelProvider):
    """Local testing provider that simulates channel operations.

    All calls succeed immediately and log what *would* happen.
    """

    @property
    def provider_key(self) -> str:
        return "mock"

    def __init__(self) -> None:
        self._log: list[dict] = []

    def pull_reservations(self, since: datetime | None = None) -> list[InboundReservation]:
        self._log.append({"action": "pull_reservations", "since": str(since)})
        return []  # Nothing to pull in mock mode

    def push_inventory(self, updates: list[OutboundInventoryUpdate]) -> SyncResult:
        self._log.append({
            "action": "push_inventory",
            "count": len(updates),
        })
        return SyncResult(
            provider=self.provider_key,
            direction="outbound",
            success=True,
            records_processed=len(updates),
        )

    def test_connection(self) -> bool:
        return True

    @property
    def operation_log(self) -> list[dict]:
        """Return recorded mock operations for inspection in tests."""
        return list(self._log)


# ---------------------------------------------------------------------------
# iCal provider — wraps existing ical_service
# ---------------------------------------------------------------------------

class ICalChannelProvider(ChannelProvider):
    """Adapter that bridges the existing iCal sync into the channel layer.

    Inbound: delegates to ``ical_service.sync_external_calendar_source()``.
    Outbound: existing ICS feed export (``/calendar/feed/<token>.ics``) handles
    this via HTTP — no programmatic push is required.
    """

    @property
    def provider_key(self) -> str:
        return "ical"

    def pull_reservations(self, since: datetime | None = None) -> list[InboundReservation]:
        """Pull reservations from all active external calendar sources.

        Converts ``ExternalCalendarBlock`` records to ``InboundReservation``
        DTOs so the caller has a unified format.
        """
        query = ExternalCalendarBlock.query.filter(
            ExternalCalendarBlock.is_conflict.is_(False),
        )
        if since:
            query = query.filter(ExternalCalendarBlock.last_seen_at >= since)

        blocks = query.all()
        results: list[InboundReservation] = []
        for block in blocks:
            source = db.session.get(ExternalCalendarSource, block.source_id)
            results.append(InboundReservation(
                external_booking_id=block.external_uid,
                external_source=f"ical:{source.name}" if source else "ical",
                guest_name=block.summary or "OTA Guest",
                check_in=block.starts_on,
                check_out=block.ends_on,
                raw_payload=block.metadata_json or {},
            ))
        return results

    def push_inventory(self, updates: list[OutboundInventoryUpdate]) -> SyncResult:
        # iCal feeds are pull-based; the external platform fetches from us.
        return SyncResult(
            provider=self.provider_key,
            direction="outbound",
            success=True,
            records_processed=0,
            details={"note": "iCal feeds are pull-based; no active push required."},
        )

    def test_connection(self) -> bool:
        # iCal feeds are stateless HTTP; connection is always "OK".
        return True


# ---------------------------------------------------------------------------
# Configurable API push providers
# ---------------------------------------------------------------------------


class ConfiguredPushChannelProvider(ChannelProvider):
    """Outbound-only provider that posts normalized inventory payloads to a configured endpoint.

    This intentionally does not hard-code a third-party OTA schema. Each provider
    posts a stable JSON envelope to a hotel-configured integration endpoint so we
    fail clearly until a real Booking.com / Expedia connector is wired.
    """

    provider_key_name = ""

    @property
    def provider_key(self) -> str:
        return self.provider_key_name

    def pull_reservations(self, since: datetime | None = None) -> list[InboundReservation]:
        return []

    def push_inventory(self, updates: list[OutboundInventoryUpdate]) -> SyncResult:
        endpoint = _channel_provider_setting(self.provider_key, "endpoint", "")
        token = _channel_provider_setting(self.provider_key, "api_token", "")
        account_id = _channel_provider_setting(self.provider_key, "account_id", "")
        if not endpoint:
            return SyncResult(
                provider=self.provider_key,
                direction="outbound",
                success=False,
                errors=[f"{self.provider_key} endpoint is not configured."],
            )

        payload = {
            "provider": self.provider_key,
            "generated_at": utc_now().isoformat(),
            "account_id": account_id or None,
            "updates": [
                {
                    "room_type_code": item.room_type_code,
                    "date_from": item.date_from.isoformat(),
                    "date_to": item.date_to.isoformat(),
                    "available_count": item.available_count,
                    "rate_amount": str(item.rate_amount) if item.rate_amount is not None else None,
                    "currency": item.currency,
                    "closed_to_arrival": item.closed_to_arrival,
                    "closed_to_departure": item.closed_to_departure,
                    "min_stay": item.min_stay,
                }
                for item in updates
            ],
        }
        headers = {"Content-Type": "application/json", "User-Agent": "SandboxHotelPMS/1.0"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310 - endpoint is operator configured
                body = response.read().decode("utf-8", errors="ignore")
                details = {"http_status": response.status}
                if body.strip():
                    try:
                        details["response"] = json.loads(body)
                    except json.JSONDecodeError:
                        details["response_text"] = body[:500]
                return SyncResult(
                    provider=self.provider_key,
                    direction="outbound",
                    success=200 <= response.status < 300,
                    records_processed=len(updates),
                    details=details,
                )
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="ignore")
            return SyncResult(
                provider=self.provider_key,
                direction="outbound",
                success=False,
                errors=[f"HTTP {exc.code}: {body[:240] or exc.reason}"],
                details={"http_status": exc.code},
            )
        except urllib.error.URLError as exc:
            return SyncResult(
                provider=self.provider_key,
                direction="outbound",
                success=False,
                errors=[str(exc.reason or exc)],
            )

    def test_connection(self) -> bool:
        return bool(_channel_provider_setting(self.provider_key, "endpoint", ""))


class BookingComChannelProvider(ConfiguredPushChannelProvider):
    provider_key_name = "booking_com"


class ExpediaChannelProvider(ConfiguredPushChannelProvider):
    provider_key_name = "expedia"


# ---------------------------------------------------------------------------
# Provider registry
# ---------------------------------------------------------------------------

PROVIDER_REGISTRY: dict[str, type[ChannelProvider]] = {
    "mock": MockChannelProvider,
    "ical": ICalChannelProvider,
    "booking_com": BookingComChannelProvider,
    "expedia": ExpediaChannelProvider,
}


def get_provider(provider_key: str) -> ChannelProvider:
    """Instantiate and return the provider for *provider_key*.

    Raises ``ValueError`` if the key is unknown.
    """
    cls = PROVIDER_REGISTRY.get(provider_key)
    if not cls:
        raise ValueError(f"Unknown channel provider: {provider_key!r}")
    return cls()


def build_outbound_inventory_updates(
    *,
    date_from: date,
    date_to: date,
    room_type_id: uuid.UUID | None = None,
) -> list[OutboundInventoryUpdate]:
    room_type_query = RoomType.query.filter_by(is_active=True).order_by(RoomType.code.asc())
    if room_type_id:
        room_type_query = room_type_query.filter(RoomType.id == room_type_id)
    room_types = room_type_query.all()
    if not room_types:
        return []

    availability_query = (
        db.session.query(
            InventoryDay.business_date,
            InventoryDay.room_type_id,
            sa.func.count(InventoryDay.id),
        )
        .join(Room, Room.id == InventoryDay.room_id)
        .filter(
            InventoryDay.business_date >= date_from,
            InventoryDay.business_date <= date_to,
            Room.is_active.is_(True),
            Room.is_sellable.is_(True),
            InventoryDay.is_blocked.is_(False),
            InventoryDay.availability_status == "available",
        )
    )
    if room_type_id:
        availability_query = availability_query.filter(InventoryDay.room_type_id == room_type_id)
    availability_counts = {
        (business_date, inventory_room_type_id): int(available_count or 0)
        for business_date, inventory_room_type_id, available_count in availability_query.group_by(
            InventoryDay.business_date,
            InventoryDay.room_type_id,
        ).all()
    }

    updates: list[OutboundInventoryUpdate] = []
    currency_code = str(get_setting_value("hotel.currency", "THB") or "THB")
    for room_type in room_types:
        current = date_from
        while current <= date_to:
            updates.append(
                OutboundInventoryUpdate(
                    room_type_code=room_type.code,
                    date_from=current,
                    date_to=current + timedelta(days=1),
                    available_count=availability_counts.get((current, room_type.id), 0),
                    rate_amount=_default_rate_for_room_type(room_type, current),
                    currency=currency_code,
                    closed_to_arrival=False,
                    closed_to_departure=False,
                )
            )
            current += timedelta(days=1)
    return updates


def provider_push_context() -> dict[str, dict[str, Any]]:
    return {
        provider_key: {
            "configured": bool(_channel_provider_setting(provider_key, "endpoint", "")),
            "endpoint": _channel_provider_setting(provider_key, "endpoint", ""),
            "has_api_token": bool(_channel_provider_setting(provider_key, "api_token", "")),
            "account_id": _channel_provider_setting(provider_key, "account_id", ""),
        }
        for provider_key in ("booking_com", "expedia")
    }


# ---------------------------------------------------------------------------
# Sync orchestrator
# ---------------------------------------------------------------------------

class ChannelSyncService:
    """High-level orchestrator for channel sync operations."""

    def __init__(self, provider: ChannelProvider) -> None:
        self.provider = provider

    # -- Inbound ----------------------------------------------------------

    def import_reservations(
        self,
        *,
        since: datetime | None = None,
        actor_user_id: uuid.UUID | None = None,
    ) -> SyncResult:
        """Pull reservations from the channel and import them idempotently."""
        try:
            inbound = self.provider.pull_reservations(since=since)
        except Exception as exc:
            return SyncResult(
                provider=self.provider.provider_key,
                direction="inbound",
                success=False,
                errors=[str(exc)],
            )

        imported = 0
        errors: list[str] = []
        for res_data in inbound:
            try:
                self._import_single(res_data, actor_user_id)
                imported += 1
            except Exception as exc:
                errors.append(f"{res_data.external_booking_id}: {exc}")

        return SyncResult(
            provider=self.provider.provider_key,
            direction="inbound",
            success=len(errors) == 0,
            records_processed=imported,
            errors=errors,
        )

    def _import_single(
        self,
        data: InboundReservation,
        actor_user_id: uuid.UUID | None,
    ) -> None:
        """Import one external reservation idempotently.

        For iCal-based providers the data is stored as
        ``ExternalCalendarBlock`` records by ``ical_service``.  For future
        API-based providers this method would create ``Reservation`` records
        directly, using ``external_booking_id`` stored in ``internal_notes``
        and ``source_channel`` to guarantee idempotency.
        """
        # For the iCal provider, blocks are managed by ical_service directly.
        # For API-based providers the reservation would be created here.

    # -- Outbound ---------------------------------------------------------

    def push_inventory_updates(
        self,
        updates: list[OutboundInventoryUpdate],
        actor_user_id: uuid.UUID | None = None,
    ) -> SyncResult:
        """Push inventory / rate updates to the channel."""
        result = self.provider.push_inventory(updates)
        if actor_user_id:
            write_audit_log(
                actor_user_id=actor_user_id,
                entity_table="channel_sync",
                entity_id=self.provider.provider_key,
                action="update",
                after_data={
                    "direction": "outbound",
                    "records": result.records_processed,
                    "success": result.success,
                },
            )
            db.session.commit()
        return result

    # -- Health -----------------------------------------------------------

    def test_connection(self) -> bool:
        return self.provider.test_connection()


def _default_rate_for_room_type(room_type: RoomType, business_date: date) -> Decimal:
    quote = quote_reservation(
        room_type=room_type,
        check_in_date=business_date,
        check_out_date=business_date + timedelta(days=1),
        adults=room_type.standard_occupancy,
        children=0,
    )
    return money(quote.grand_total)


def _channel_provider_setting(provider_key: str, field_name: str, default: str) -> str:
    return str(get_setting_value(f"channel_push.{provider_key}.{field_name}", default) or default).strip()
