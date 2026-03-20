from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.orm import joinedload

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..extensions import db
from ..models import (
    ActivityLog,
    AuditLog,
    CancellationRequest,
    ConversationThread,
    EmailOutbox,
    FolioCharge,
    Guest,
    GuestNote,
    InventoryDay,
    ModificationRequest,
    PaymentRequest,
    Reservation,
    ReservationNote,
    ReservationReviewQueue,
    ReservationStatusHistory,
    Room,
    RoomType,
    User,
    utc_now,
)
from ..normalization import clean_optional, normalize_email, normalize_phone
from ..permissions import allowed_note_visibility_scopes
from ..pricing import money, quote_reservation
from .communication_service import (
    dispatch_notification_deliveries,
    query_notification_history,
    queue_cancellation_confirmation,
    queue_modification_confirmation,
    queue_reservation_confirmation,
)
from .extras_service import (
    post_reservation_extras_to_folio,
    recompute_reservation_grand_total,
    reprice_reservation_extras,
    reservation_extra_summary,
)
from .ical_service import room_has_external_block
from .reservation_service import (
    calculate_deposit_required,
    inventory_row_can_allocate,
    reservation_snapshot,
    validate_occupancy,
)

_log = logging.getLogger(__name__)


@dataclass
class ReservationWorkspaceFilters:
    q: str = ""
    status: str = ""
    room_type_id: str = ""
    arrival_date: str = ""
    departure_date: str = ""
    payment_state: str = ""
    booking_source: str = ""
    review_status: str = ""
    assigned: str = ""
    include_closed: bool = False
    page: int = 1
    per_page: int = 25
    sort: str = ""
    sort_dir: str = "asc"


@dataclass
class GuestUpdatePayload:
    first_name: str
    last_name: str
    phone: str
    email: str | None
    nationality: str | None = None
    id_document_type: str | None = None
    id_document_number: str | None = None
    preferred_language: str | None = None
    notes_summary: str | None = None


@dataclass
class StayDateChangePayload:
    check_in_date: date
    check_out_date: date
    adults: int
    children: int
    extra_guests: int
    requested_room_id: uuid.UUID | None = None


@dataclass
class ReservationNotePayload:
    note_text: str
    note_type: str = "general"
    is_important: bool = False
    visibility_scope: str = "all_staff"


def _reservation_workspace_query():
    return sa.select(Reservation).options(
        joinedload(Reservation.primary_guest),
        joinedload(Reservation.room_type),
        joinedload(Reservation.assigned_room),
        joinedload(Reservation.notes),
        joinedload(Reservation.status_history),
    ).outerjoin(ReservationReviewQueue, ReservationReviewQueue.reservation_id == Reservation.id)


def _apply_workspace_filters(query, filters: ReservationWorkspaceFilters):
    if not filters.include_closed and not filters.status:
        query = query.where(Reservation.current_status.not_in(["cancelled", "no_show", "checked_out"]))
    if filters.status:
        query = query.where(Reservation.current_status == filters.status)
    if filters.room_type_id:
        query = query.where(Reservation.room_type_id == uuid.UUID(filters.room_type_id))
    if filters.arrival_date:
        query = query.where(Reservation.check_in_date == date.fromisoformat(filters.arrival_date))
    if filters.departure_date:
        query = query.where(Reservation.check_out_date == date.fromisoformat(filters.departure_date))
    if filters.booking_source:
        query = query.where(Reservation.source_channel == filters.booking_source)
    if filters.review_status:
        query = query.where(ReservationReviewQueue.review_status == filters.review_status)
    if filters.assigned == "assigned":
        query = query.where(Reservation.assigned_room_id.is_not(None))
    if filters.assigned == "unassigned":
        query = query.where(Reservation.assigned_room_id.is_(None))
    if filters.payment_state:
        query = _apply_payment_state_filter(query, filters.payment_state)
    if filters.q:
        query = _apply_search_filter(query, filters.q)
    return query


def _apply_search_filter(query, raw_query: str):
    q = raw_query.strip()
    like = f"%{q.lower()}%"
    digits = phone_digits(q)
    query = query.join(Guest, Guest.id == Reservation.primary_guest_id)
    conditions = [
        sa.func.lower(Guest.full_name).like(like),
        sa.func.lower(Reservation.reservation_code).like(f"{q.lower()}%"),
        sa.func.lower(sa.func.coalesce(Guest.email, "")).like(like),
    ]
    if digits:
        conditions.append(_normalized_phone_expression(Guest.phone).like(f"%{digits}%"))
    parsed_date = _maybe_date(q)
    if parsed_date:
        conditions.extend(
            [
                Reservation.check_in_date == parsed_date,
                Reservation.check_out_date == parsed_date,
                sa.and_(Reservation.check_in_date <= parsed_date, Reservation.check_out_date > parsed_date),
            ]
        )
    return query.where(sa.or_(*conditions))


def _apply_payment_state_filter(query, payment_state: str):
    paid_request_exists = sa.exists(
        sa.select(PaymentRequest.id).where(
            PaymentRequest.reservation_id == Reservation.id,
            PaymentRequest.status == "paid",
        )
    )
    failed_request_exists = sa.exists(
        sa.select(PaymentRequest.id).where(
            PaymentRequest.reservation_id == Reservation.id,
            PaymentRequest.status == "failed",
        )
    )
    if payment_state == "missing":
        return query.where(Reservation.deposit_required_amount > 0, Reservation.deposit_received_amount <= 0)
    if payment_state == "partial":
        return query.where(
            Reservation.deposit_required_amount > 0,
            Reservation.deposit_received_amount > 0,
            Reservation.deposit_received_amount < Reservation.deposit_required_amount,
        )
    if payment_state == "paid":
        return query.where(sa.or_(Reservation.deposit_received_amount >= Reservation.deposit_required_amount, paid_request_exists))
    if payment_state == "failed":
        return query.where(failed_request_exists)
    return query


def _load_reservation(reservation_id: uuid.UUID) -> Reservation | None:
    return (
        db.session.execute(
            sa.select(Reservation)
            .options(
                joinedload(Reservation.primary_guest),
                joinedload(Reservation.room_type),
                joinedload(Reservation.assigned_room),
                joinedload(Reservation.notes),
                joinedload(Reservation.status_history),
            )
            .where(Reservation.id == reservation_id)
        )
        .unique()
        .scalars()
        .first()
    )


def _load_reservation_for_update(reservation_id: uuid.UUID) -> Reservation | None:
    return (
        db.session.execute(
            sa.select(Reservation)
            .options(
                joinedload(Reservation.primary_guest),
                joinedload(Reservation.room_type),
                joinedload(Reservation.assigned_room),
                joinedload(Reservation.notes),
                joinedload(Reservation.status_history),
            )
            .where(Reservation.id == reservation_id)
            .with_for_update()
        )
        .unique()
        .scalars()
        .first()
    )


def _eligible_room_list(
    *,
    reservation: Reservation,
    room_type_id: uuid.UUID,
    check_in_date: date,
    check_out_date: date,
    include_current_reservation_rows: bool,
) -> list[Room]:
    rooms = (
        db.session.execute(
            sa.select(Room)
            .where(
                Room.room_type_id == room_type_id,
                Room.is_active.is_(True),
                Room.is_sellable.is_(True),
            )
            .order_by(Room.room_number.asc())
        )
        .scalars()
        .all()
    )
    eligible: list[Room] = []
    for room in rooms:
        if room_has_external_block(room.id, check_in_date, check_out_date, for_update=True):
            continue
        rows = _lock_inventory_rows(room.id, check_in_date, check_out_date)
        if len(rows) != (check_out_date - check_in_date).days:
            continue
        if all(
            (
                inventory_row_can_allocate(row)
                or (
                    include_current_reservation_rows
                    and row.reservation_id == reservation.id
                    and row.is_sellable
                    and not row.is_blocked
                    and not row.maintenance_flag
                    and row.availability_status in {"reserved", "occupied", "house_use"}
                )
            )
            for row in rows
        ):
            eligible.append(room)
    return eligible


def _find_eligible_room(
    *,
    reservation: Reservation,
    room_type_id: uuid.UUID,
    check_in_date: date,
    check_out_date: date,
    requested_room_id: uuid.UUID | None,
    include_current_reservation_rows: bool,
) -> Room:
    rooms = _eligible_room_list(
        reservation=reservation,
        room_type_id=room_type_id,
        check_in_date=check_in_date,
        check_out_date=check_out_date,
        include_current_reservation_rows=include_current_reservation_rows,
    )
    if requested_room_id:
        for room in rooms:
            if room.id == requested_room_id:
                return room
        raise ValueError("The requested room is not available for the requested stay.")
    if not rooms:
        raise ValueError("No eligible room is available for the requested change.")
    current_room = next((room for room in rooms if room.id == reservation.assigned_room_id), None)
    return current_room or rooms[0]


def _reservation_inventory_rows(reservation_id: uuid.UUID, start_date: date | None = None) -> list[InventoryDay]:
    query = sa.select(InventoryDay).where(InventoryDay.reservation_id == reservation_id)
    if start_date:
        query = query.where(InventoryDay.business_date >= start_date)
    return (
        db.session.execute(query.order_by(InventoryDay.business_date.asc()).with_for_update())
        .scalars()
        .all()
    )


def _lock_inventory_rows(room_id: uuid.UUID, check_in_date: date, check_out_date: date) -> list[InventoryDay]:
    return (
        db.session.execute(
            sa.select(InventoryDay)
            .where(
                InventoryDay.room_id == room_id,
                InventoryDay.business_date >= check_in_date,
                InventoryDay.business_date < check_out_date,
            )
            .order_by(InventoryDay.business_date.asc())
            .with_for_update()
        )
        .scalars()
        .all()
    )


def _allocate_inventory_range(
    *,
    reservation: Reservation,
    room: Room,
    nightly_rates: list[tuple[date, Decimal]],
    actor_user_id: uuid.UUID,
) -> None:
    if room_has_external_block(room.id, reservation.check_in_date, reservation.check_out_date, for_update=True):
        raise ValueError("Inventory could not be allocated because the room is blocked by an external calendar sync.")
    rate_lookup = {business_date: nightly_rate for business_date, nightly_rate in nightly_rates}
    rows = _lock_inventory_rows(room.id, reservation.check_in_date, reservation.check_out_date)
    if len(rows) != len(rate_lookup):
        raise ValueError("Inventory horizon is incomplete for the requested stay.")
    for row in rows:
        if not inventory_row_can_allocate(row):
            raise ValueError("Inventory could not be allocated without conflict.")
        row.availability_status = "occupied" if reservation.current_status == "checked_in" else "reserved"
        row.reservation_id = reservation.id
        row.nightly_rate = rate_lookup[row.business_date]
        row.updated_by_user_id = actor_user_id


def guest_snapshot(guest: Guest) -> dict:
    return {
        "first_name": guest.first_name,
        "last_name": guest.last_name,
        "full_name": guest.full_name,
        "phone": guest.phone,
        "email": guest.email,
        "nationality": guest.nationality,
        "id_document_type": guest.id_document_type,
        "id_document_number": guest.id_document_number,
        "preferred_language": guest.preferred_language,
        "notes_summary": guest.notes_summary,
    }


def phone_digits(value: str | None) -> str:
    return "".join(ch for ch in (value or "") if ch.isdigit())


def _actor_name(actor_user_id) -> str | None:
    if not actor_user_id:
        return None
    actor = db.session.get(User, actor_user_id)
    return actor.full_name if actor else str(actor_user_id)


def _normalized_phone_expression(column):
    return sa.func.replace(
        sa.func.replace(
            sa.func.replace(
                sa.func.replace(sa.func.replace(column, "+", ""), "-", ""),
                " ",
                "",
            ),
            "(",
            "",
        ),
        ")",
        "",
    )


def _maybe_date(value: str) -> date | None:
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None
