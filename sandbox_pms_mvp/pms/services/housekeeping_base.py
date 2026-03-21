"""Shared housekeeping imports, constants, and payloads."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone

import sqlalchemy as sa
from sqlalchemy.orm import joinedload

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..extensions import db
from ..models import (
    ActivityLog,
    AuditLog,
    HousekeepingStatus,
    HousekeepingTask,
    InventoryDay,
    Reservation,
    Room,
    RoomNote,
    RoomStatusHistory,
    RoomType,
    User,
    utc_now,
)
from ..normalization import clean_optional
from ..permissions import allowed_note_visibility_scopes, can_manage_operational_overrides


READY_HOUSEKEEPING_CODES = {"clean", "inspected"}
OPERABLE_HOUSEKEEPING_CODES = {
    "dirty",
    "clean",
    "inspected",
    "pickup",
    "occupied_clean",
    "occupied_dirty",
    "do_not_disturb",
    "sleep",
    "out_of_service",
    "out_of_order",
    "cleaning_in_progress",
}
CLOSURE_STATUS_CODES = {"out_of_order", "out_of_service"}


@dataclass
class HousekeepingBoardFilters:
    business_date: date
    floor: str = ""
    status: str = ""
    priority: str = ""
    room_type_id: str = ""
    arrival_today: str = ""
    departure_today: str = ""
    blocked: str = ""
    maintenance: str = ""
    notes: str = ""
    mobile: bool = False


@dataclass
class RoomStatusUpdatePayload:
    status_code: str
    note: str | None = None


@dataclass
class RoomNotePayload:
    note_text: str
    note_type: str = "housekeeping"
    is_important: bool = False
    visibility_scope: str = "all_staff"


@dataclass
class MaintenanceFlagPayload:
    enabled: bool
    note: str | None = None


@dataclass
class BlockRoomPayload:
    blocked: bool
    reason: str | None = None
    blocked_until: datetime | None = None


@dataclass
class BulkHousekeepingPayload:
    room_ids: list[uuid.UUID]
    business_date: date
    action: str
    status_code: str | None = None
    note: str | None = None
    room_note_type: str = "housekeeping"
    is_important: bool = False
    blocked_until: datetime | None = None


