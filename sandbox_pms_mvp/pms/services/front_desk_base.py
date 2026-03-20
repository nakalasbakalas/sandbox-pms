from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.orm import joinedload

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..extensions import db
from ..models import (
    FolioCharge,
    Guest,
    HousekeepingStatus,
    InventoryDay,
    PaymentEvent,
    PaymentRequest,
    PreCheckIn,
    Reservation,
    ReservationNote,
    ReservationStatusHistory,
    Room,
    RoomType,
    User,
    utc_now,
)
from ..normalization import clean_optional, normalize_email, normalize_phone
from ..pricing import get_setting_value, quote_reservation
from .cashier_service import (
    PaymentPostingPayload,
    RefundPostingPayload,
    ensure_room_charges_posted,
    post_fee_charge,
    record_payment,
    record_refund,
)
from .ical_service import calendar_timezone, room_has_external_block
from .reservation_service import (
    ReservationCreatePayload,
    calculate_deposit_required,
    create_or_get_guest,
    next_reservation_code,
    validate_occupancy,
    validate_payload,
)
from .staff_reservations_service import (
    _load_reservation_for_update,
    _lock_inventory_rows,
    _reservation_inventory_rows,
    assign_room,
    build_reservation_summary,
    get_reservation_detail,
    payment_summary,
)


READY_HOUSEKEEPING_CODES = {"clean", "inspected"}


@dataclass
class FrontDeskFilters:
    business_date: date
    mode: str = "arrivals"
    room_type_id: str = ""
    assigned: str = ""
    ready: str = ""
    payment_state: str = ""
    booking_source: str = ""
    flagged: str = ""


@dataclass
class CheckInPayload:
    room_id: uuid.UUID | None
    first_name: str
    last_name: str
    phone: str
    email: str | None
    nationality: str | None = None
    id_document_type: str | None = None
    id_document_number: str | None = None
    preferred_language: str | None = None
    notes_summary: str | None = None
    identity_verified: bool = False
    collect_payment_amount: Decimal = Decimal("0.00")
    payment_method: str = "front_desk"
    arrival_note: str | None = None
    apply_early_fee: bool = False
    waive_early_fee: bool = False
    waiver_reason: str | None = None
    override_payment: bool = False
    action_at: datetime | None = None


@dataclass
class CheckoutPayload:
    collect_payment_amount: Decimal = Decimal("0.00")
    payment_method: str = "front_desk"
    departure_note: str | None = None
    apply_late_fee: bool = False
    waive_late_fee: bool = False
    waiver_reason: str | None = None
    override_balance: bool = False
    process_refund: bool = False
    refund_note: str | None = None
    action_at: datetime | None = None


@dataclass
class WalkInCheckInPayload:
    first_name: str
    last_name: str
    phone: str
    email: str | None
    room_type_id: uuid.UUID
    check_in_date: date
    check_out_date: date
    adults: int
    children: int
    extra_guests: int = 0
    room_id: uuid.UUID | None = None
    special_requests: str | None = None
    internal_notes: str | None = None
    nationality: str | None = None
    id_document_type: str | None = None
    id_document_number: str | None = None
    preferred_language: str | None = None
    notes_summary: str | None = None
    identity_verified: bool = False
    collect_payment_amount: Decimal = Decimal("0.00")
    payment_method: str = "front_desk"
    apply_early_fee: bool = False
    waive_early_fee: bool = False
    waiver_reason: str | None = None
    action_at: datetime | None = None


@dataclass
class NoShowPayload:
    action_at: datetime | None = None
    reason: str | None = None


def _ready_housekeeping_codes() -> set[str]:
    if get_setting_value("housekeeping.require_inspected_for_ready", False):
        return {"inspected"}
    return READY_HOUSEKEEPING_CODES


def _front_desk_query():
    return sa.select(Reservation).options(
        joinedload(Reservation.primary_guest),
        joinedload(Reservation.assigned_room),
        joinedload(Reservation.room_type),
    )


def _apply_front_desk_filters(query, filters: FrontDeskFilters):
    if filters.room_type_id:
        query = query.where(Reservation.room_type_id == uuid.UUID(filters.room_type_id))
    if filters.assigned == "assigned":
        query = query.where(Reservation.assigned_room_id.is_not(None))
    if filters.assigned == "unassigned":
        query = query.where(Reservation.assigned_room_id.is_(None))
    if filters.booking_source:
        query = query.where(Reservation.source_channel == filters.booking_source)
    if filters.payment_state:
        if filters.payment_state == "paid":
            query = query.where(Reservation.deposit_received_amount >= Reservation.deposit_required_amount)
        elif filters.payment_state == "partial":
            query = query.where(
                Reservation.deposit_received_amount > 0,
                Reservation.deposit_received_amount < Reservation.deposit_required_amount,
            )
        elif filters.payment_state == "missing":
            query = query.where(
                Reservation.deposit_required_amount > 0,
                Reservation.deposit_received_amount <= 0,
            )
    return query


def _can_override(actor: User | None) -> bool:
    if not actor:
        return False
    return any(role.code in {"admin", "manager"} for role in actor.roles)


def _housekeeping_code(housekeeping_status_id) -> str | None:
    if not housekeeping_status_id:
        return None
    status = db.session.get(HousekeepingStatus, housekeeping_status_id)
    return status.code if status else None


def _setting_time(key: str, default: str) -> time:
    raw = str(get_setting_value(key, default))
    hours, minutes = raw.split(":", 1)
    return time(hour=int(hours), minute=int(minutes))


def _combine_local(day: date, wall_clock: time) -> datetime:
    return datetime.combine(day, wall_clock, tzinfo=calendar_timezone())


def _current_time() -> time:
    now = datetime.now(calendar_timezone())
    return time(hour=now.hour, minute=now.minute)


def _front_desk_snapshot(reservation: Reservation) -> dict:
    return {
        "reservation_code": reservation.reservation_code,
        "status": reservation.current_status,
        "assigned_room_id": str(reservation.assigned_room_id),
        "check_in_date": reservation.check_in_date.isoformat(),
        "check_out_date": reservation.check_out_date.isoformat(),
        "checked_in_at": reservation.checked_in_at.isoformat() if reservation.checked_in_at else None,
        "checked_out_at": reservation.checked_out_at.isoformat() if reservation.checked_out_at else None,
        "identity_verified_at": reservation.identity_verified_at.isoformat() if reservation.identity_verified_at else None,
    }
