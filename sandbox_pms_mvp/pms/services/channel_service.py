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

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

import sqlalchemy as sa

from ..audit import write_audit_log
from ..extensions import db
from ..models import (
    AppSetting,
    ExternalCalendarBlock,
    ExternalCalendarSource,
    ExternalCalendarSyncRun,
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


# ---------------------------------------------------------------------------
# Provider registry
# ---------------------------------------------------------------------------

PROVIDER_REGISTRY: dict[str, type[ChannelProvider]] = {
    "mock": MockChannelProvider,
    "ical": ICalChannelProvider,
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
