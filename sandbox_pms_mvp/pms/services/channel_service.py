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
import urllib.error
import urllib.request
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from flask import current_app

from ..audit import write_audit_log
from ..extensions import db
from ..models import (
    AppSetting,
    ExternalCalendarBlock,
    ExternalCalendarSource,
    ExternalCalendarSyncRun,
    OtaChannel,
    Reservation,
    RoomType,
    utc_now,
)


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
        query = sa.select(ExternalCalendarBlock).where(
            ExternalCalendarBlock.is_conflict.is_(False),
        )
        if since:
            query = query.where(ExternalCalendarBlock.last_seen_at >= since)

        blocks = db.session.execute(query).scalars().all()
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


class WebhookChannelProvider(ChannelProvider):
    """Generic webhook-backed outbound adapter for OTA/channel bridges."""

    @property
    def provider_key(self) -> str:
        return "webhook"

    def pull_reservations(self, since: datetime | None = None) -> list[InboundReservation]:
        return []

    def push_inventory(self, updates: list[OutboundInventoryUpdate]) -> SyncResult:
        webhook_url = str(current_app.config.get("CHANNEL_PUSH_WEBHOOK_URL", "") or "").strip()
        if not webhook_url:
            return SyncResult(
                provider=self.provider_key,
                direction="outbound",
                success=False,
                errors=["CHANNEL_PUSH_WEBHOOK_URL is not configured."],
            )

        payload = {
            "provider": self.provider_key,
            "updates": [
                {
                    "room_type_code": update.room_type_code,
                    "date_from": update.date_from.isoformat(),
                    "date_to": update.date_to.isoformat(),
                    "available_count": update.available_count,
                    "rate_amount": str(update.rate_amount) if update.rate_amount is not None else None,
                    "currency": update.currency,
                    "closed_to_arrival": update.closed_to_arrival,
                    "closed_to_departure": update.closed_to_departure,
                    "min_stay": update.min_stay,
                }
                for update in updates
            ],
        }
        request_obj = urllib.request.Request(
            webhook_url,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request_obj, timeout=15) as response:  # noqa: S310
                success = 200 <= getattr(response, "status", 200) < 300
                body = response.read().decode("utf-8", errors="ignore")
                return SyncResult(
                    provider=self.provider_key,
                    direction="outbound",
                    success=success,
                    records_processed=len(updates) if success else 0,
                    errors=[] if success else [body[:200] or f"Webhook returned {getattr(response, 'status', 'unknown')}"],
                    details={"response": body[:200]},
                )
        except urllib.error.URLError as exc:
            return SyncResult(
                provider=self.provider_key,
                direction="outbound",
                success=False,
                errors=[str(exc)],
            )

    def test_connection(self) -> bool:
        return bool(str(current_app.config.get("CHANNEL_PUSH_WEBHOOK_URL", "") or "").strip())


# ---------------------------------------------------------------------------
# API-key-backed OTA providers
# ---------------------------------------------------------------------------


class _OtaApiProvider(ChannelProvider):
    """Base for OTA providers backed by a persisted ``OtaChannel`` record.

    Concrete subclasses set ``provider_key_name``.  The provider is
    *read-only* at provider level: credentials come from the database row
    so that the admin panel is the single source of truth for API keys.

    At this stage the provider:
    - Reports its key / active status honestly.
    - Returns ``success=False`` with a clear message when the API key is not
      yet configured, instead of silently no-oping.
    - Implements ``test_connection()`` which can be expanded once live API
      access is available.

    Pull reservations and push inventory are stubs that will be replaced
    once the real OTA API client libraries are wired.
    """

    provider_key_name: str = ""

    @property
    def provider_key(self) -> str:
        return self.provider_key_name

    def _channel_record(self) -> OtaChannel | None:
        return db.session.execute(
            sa.select(OtaChannel).where(
                OtaChannel.provider_key == self.provider_key_name,
                OtaChannel.deleted_at.is_(None),
            )
        ).scalar_one_or_none()

    def _is_configured(self) -> bool:
        record = self._channel_record()
        return bool(record and record.api_key_encrypted)

    def pull_reservations(self, since: datetime | None = None) -> list[InboundReservation]:
        if not self._is_configured():
            return []
        # Stub: real pull logic will be added once API keys are live.
        return []

    def push_inventory(self, updates: list[OutboundInventoryUpdate]) -> SyncResult:
        if not self._is_configured():
            return SyncResult(
                provider=self.provider_key,
                direction="outbound",
                success=False,
                errors=[f"{self.provider_key}: API key not configured. Add credentials in Admin → Channels."],
            )
        # Stub: real push logic will be added once API keys are live.
        return SyncResult(
            provider=self.provider_key,
            direction="outbound",
            success=True,
            records_processed=len(updates),
            details={"note": "Stub — live API push not yet implemented."},
        )

    def test_connection(self) -> bool:
        return self._is_configured()


class BookingComChannelProvider(_OtaApiProvider):
    """Booking.com connectivity channel provider."""

    provider_key_name = "booking_com"


class ExpediaChannelProvider(_OtaApiProvider):
    """Expedia connectivity channel provider."""

    provider_key_name = "expedia"


class AgodaChannelProvider(_OtaApiProvider):
    """Agoda connectivity channel provider."""

    provider_key_name = "agoda"


# ---------------------------------------------------------------------------
# Provider registry
# ---------------------------------------------------------------------------

PROVIDER_REGISTRY: dict[str, type[ChannelProvider]] = {
    "mock": MockChannelProvider,
    "ical": ICalChannelProvider,
    "webhook": WebhookChannelProvider,
    "booking_com": BookingComChannelProvider,
    "expedia": ExpediaChannelProvider,
    "agoda": AgodaChannelProvider,
}


def get_provider(provider_key: str) -> ChannelProvider:
    """Instantiate and return the provider for *provider_key*.

    Raises ``ValueError`` if the key is unknown.
    """
    cls = PROVIDER_REGISTRY.get(provider_key)
    if not cls:
        raise ValueError(f"Unknown channel provider: {provider_key!r}")
    return cls()


# ---------------------------------------------------------------------------
# OTA channel management helpers
# ---------------------------------------------------------------------------


def list_ota_channels() -> list[OtaChannel]:
    """Return all non-deleted OtaChannel records ordered by provider_key."""
    return (
        db.session.execute(
            sa.select(OtaChannel)
            .where(OtaChannel.deleted_at.is_(None))
            .order_by(OtaChannel.provider_key.asc())
        )
        .scalars()
        .all()
    )


def get_ota_channel(provider_key: str) -> OtaChannel | None:
    """Return the OtaChannel for *provider_key*, or None if not configured."""
    return db.session.execute(
        sa.select(OtaChannel).where(
            OtaChannel.provider_key == provider_key,
            OtaChannel.deleted_at.is_(None),
        )
    ).scalar_one_or_none()



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


# ---------------------------------------------------------------------------
# OTA channel credential management
# ---------------------------------------------------------------------------


def upsert_ota_channel(
    *,
    provider_key: str,
    display_name: str,
    is_active: bool,
    hotel_id: str | None = None,
    endpoint_url: str | None = None,
    api_key: str | None = None,
    api_secret: str | None = None,
    actor_user_id: uuid.UUID | None = None,
) -> OtaChannel:
    """Create or update an OtaChannel record.

    Credentials are encrypted before storage.  Passing ``None`` for
    ``api_key`` / ``api_secret`` leaves any previously stored encrypted value
    unchanged so that a form submit that omits the key field does not clear
    existing credentials.

    Returns the persisted OtaChannel instance (not yet committed).
    """
    from .auth_service import encrypt_secret

    record = get_ota_channel(provider_key)
    is_create = record is None
    if is_create:
        record = OtaChannel(
            provider_key=provider_key,
            display_name=display_name,
        )
        db.session.add(record)
    else:
        record.display_name = display_name

    record.is_active = is_active
    record.hotel_id = hotel_id or None
    record.endpoint_url = endpoint_url or None
    record.updated_by_user_id = actor_user_id

    if api_key:
        record.api_key_encrypted = encrypt_secret(api_key)
        record.api_key_hint = api_key[-4:] if len(api_key) >= 4 else api_key

    if api_secret:
        record.api_secret_encrypted = encrypt_secret(api_secret)
        record.api_secret_hint = api_secret[-4:] if len(api_secret) >= 4 else api_secret

    record.updated_at = utc_now()
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="ota_channels",
        entity_id=provider_key,
        action="create" if is_create else "update",
        after_data={
            "provider_key": provider_key,
            "is_active": is_active,
            "hotel_id": hotel_id,
            "api_key_updated": bool(api_key),
            "api_secret_updated": bool(api_secret),
        },
    )
    return record


def test_ota_channel_connection(
    provider_key: str,
    *,
    actor_user_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Test the connection for an OTA provider and persist the result.

    Returns a dict with ``success`` (bool) and ``error`` (str or None).
    """
    record = get_ota_channel(provider_key)
    if record is None:
        return {"success": False, "error": "Channel not configured."}

    try:
        provider = get_provider(provider_key)
        ok = provider.test_connection()
        error: str | None = None
    except Exception as exc:  # noqa: BLE001
        ok = False
        error = str(exc)

    record.last_tested_at = utc_now()
    record.last_test_ok = ok
    record.last_test_error = error
    record.updated_by_user_id = actor_user_id

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="ota_channels",
        entity_id=str(record.id),
        action="test",
        after_data={"provider_key": provider_key, "success": ok, "error": error},
    )
    db.session.commit()
    return {"success": ok, "error": error}

