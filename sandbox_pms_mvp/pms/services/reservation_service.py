from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import re

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from ..audit import write_audit_log
from ..constants import INVENTORY_AVAILABILITY_STATUSES
from ..extensions import db
from ..models import (
    AppSetting,
    Guest,
    InventoryDay,
    PaymentEvent,
    PaymentRequest,
    Reservation,
    ReservationCodeSequence,
    ReservationStatusHistory,
    Room,
    RoomType,
    utc_now,
)
from ..normalization import clean_optional_text, normalize_email, normalize_phone
from ..pricing import get_setting_value, quote_reservation
from .admin_service import assert_blackout_allows_booking
from .ical_service import room_has_external_block

EMAIL_PATTERN = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}$")


@dataclass
class ReservationCreatePayload:
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
    assigned_room_id: uuid.UUID | None = None
    source_channel: str = "direct"
    special_requests: str | None = None
    internal_notes: str | None = None
    request_payment: bool = False
    request_type: str = "deposit"
    initial_status: str | None = None
    defer_room_assignment: bool = False


def create_reservation(payload: ReservationCreatePayload, actor_user_id: uuid.UUID | None = None) -> Reservation:
    validate_payload(payload)
    for _ in range(5):
        try:
            return _create_reservation_once(payload, actor_user_id=actor_user_id)
        except IntegrityError:
            db.session.rollback()
            continue
    raise ValueError("Could not allocate inventory without conflict. Please retry.")


def _create_reservation_once(payload: ReservationCreatePayload, actor_user_id: uuid.UUID | None = None) -> Reservation:
    room_type = db.session.get(RoomType, payload.room_type_id)
    if not room_type or not room_type.is_active:
        raise ValueError("Selected room type is not available.")
    validate_occupancy(room_type, payload.adults, payload.children)
    guest = create_or_get_guest(payload, actor_user_id)
    quote = quote_reservation(
        room_type=room_type,
        check_in_date=payload.check_in_date,
        check_out_date=payload.check_out_date,
        adults=payload.adults + payload.extra_guests,
        children=payload.children,
    )
    assigned_room = None
    if not payload.defer_room_assignment:
        assigned_room = choose_available_room(
            room_type_id=room_type.id,
            check_in_date=payload.check_in_date,
            check_out_date=payload.check_out_date,
            assigned_room_id=payload.assigned_room_id,
        )
    reservation_code = next_reservation_code()
    deposit_required = calculate_deposit_required(payload.check_in_date, payload.check_out_date, quote.grand_total)
    requested_status = (payload.initial_status or "").strip() or None
    if requested_status == "house_use":
        deposit_required = Decimal("0.00")
    current_status = requested_status or ("confirmed" if deposit_required == Decimal("0.00") else "tentative")
    reservation = Reservation(
        reservation_code=reservation_code,
        primary_guest_id=guest.id,
        room_type_id=room_type.id,
        assigned_room_id=assigned_room.id if assigned_room else None,
        current_status=current_status,
        source_channel=payload.source_channel,
        check_in_date=payload.check_in_date,
        check_out_date=payload.check_out_date,
        adults=payload.adults,
        children=payload.children,
        extra_guests=payload.extra_guests,
        special_requests=payload.special_requests,
        internal_notes=payload.internal_notes,
        quoted_room_total=quote.room_total,
        quoted_tax_total=quote.tax_total,
        quoted_extras_total=Decimal("0.00"),
        quoted_grand_total=quote.grand_total,
        deposit_required_amount=deposit_required,
        deposit_received_amount=Decimal("0.00"),
        booked_at=utc_now(),
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.session.add(reservation)
    db.session.flush()
    if assigned_room:
        allocate_inventory(
            reservation=reservation,
            room=assigned_room,
            nightly_rates=quote.nightly_rates,
            actor_user_id=actor_user_id,
        )
    db.session.add(
        ReservationStatusHistory(
            reservation_id=reservation.id,
            old_status=None,
            new_status=reservation.current_status,
            reason="reservation_created",
            note="Reservation created transactionally",
            changed_by_user_id=actor_user_id,
        )
    )
    if payload.request_payment and deposit_required > Decimal("0.00"):
        payment_request = PaymentRequest(
            reservation_id=reservation.id,
            request_type=payload.request_type,
            amount=deposit_required,
            currency_code="THB",
            status="pending",
            provider="manual",
            created_by_user_id=actor_user_id,
            updated_by_user_id=actor_user_id,
        )
        db.session.add(payment_request)
        db.session.flush()
        db.session.add(
            PaymentEvent(
                payment_request_id=payment_request.id,
                reservation_id=reservation.id,
                event_type="payment_request_created",
                amount=deposit_required,
                currency_code="THB",
                provider="manual",
                created_by_user_id=actor_user_id,
            )
        )
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="reservations",
        entity_id=str(reservation.id),
        action="create",
        after_data=reservation_snapshot(reservation),
    )
    db.session.commit()
    return reservation


def cancel_reservation(reservation_id: uuid.UUID, actor_user_id: uuid.UUID | None, reason: str) -> Reservation:
    reservation = db.session.get(Reservation, reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    before_data = reservation_snapshot(reservation)
    if reservation.current_status not in {"tentative", "confirmed"}:
        raise ValueError("Only tentative or confirmed reservations can be cancelled.")
    reservation.current_status = "cancelled"
    reservation.cancelled_at = utc_now()
    reservation.cancellation_reason = reason
    reservation.updated_by_user_id = actor_user_id
    release_inventory(reservation, actor_user_id)
    db.session.add(
        ReservationStatusHistory(
            reservation_id=reservation.id,
            old_status=before_data["status"],
            new_status="cancelled",
            reason=reason,
            note="Reservation cancelled",
            changed_by_user_id=actor_user_id,
        )
    )
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="reservations",
        entity_id=str(reservation.id),
        action="cancel",
        before_data=before_data,
        after_data=reservation_snapshot(reservation),
    )
    db.session.commit()
    return reservation


def validate_payload(payload: ReservationCreatePayload) -> None:
    if payload.check_in_date >= payload.check_out_date:
        raise ValueError("check_in_date must be before check_out_date.")
    payload.first_name = (payload.first_name or "").strip()
    payload.last_name = (payload.last_name or "").strip()
    if not payload.first_name or not payload.last_name:
        raise ValueError("Guest first and last name are required.")
    if len(payload.first_name) > 80 or len(payload.last_name) > 80:
        raise ValueError("Guest name fields are too long.")
    normalized_phone = normalize_phone(payload.phone, limit=32)
    if not normalized_phone:
        raise ValueError("A valid phone number is required.")
    payload.phone = normalized_phone
    payload.email = normalize_email(payload.email)
    if payload.email and not EMAIL_PATTERN.match(payload.email):
        raise ValueError("A valid email address is required.")
    payload.source_channel = (payload.source_channel or "direct").strip() or "direct"
    if len(payload.source_channel) > 80:
        raise ValueError("Source channel is too long.")
    payload.initial_status = (payload.initial_status or "").strip() or None
    if payload.initial_status and payload.initial_status not in {"tentative", "confirmed", "house_use"}:
        raise ValueError("Initial status is invalid.")
    if payload.defer_room_assignment and payload.assigned_room_id:
        raise ValueError("Deferred room assignment cannot also target a specific room.")
    if payload.defer_room_assignment and payload.initial_status == "house_use":
        raise ValueError("House-use reservations must have an assigned room.")
    payload.special_requests = clean_optional_text(payload.special_requests, limit=500)
    payload.internal_notes = clean_optional_text(payload.internal_notes, limit=2000)
    if payload.adults < 1:
        raise ValueError("At least one adult is required.")
    if payload.children < 0 or payload.extra_guests < 0:
        raise ValueError("Guest counts must be non-negative.")
    assert_blackout_allows_booking(payload.check_in_date, payload.check_out_date)


def validate_occupancy(room_type: RoomType, adults: int, children: int) -> None:
    total_occupants = adults + children
    if total_occupants > room_type.max_occupancy:
        raise ValueError("Occupancy exceeds room type maximum.")


def create_or_get_guest(payload: ReservationCreatePayload, actor_user_id: uuid.UUID | None) -> Guest:
    guest = Guest.query.filter_by(phone=payload.phone, deleted_at=None).first()
    full_name = f"{payload.first_name.strip()} {payload.last_name.strip()}".strip()
    if guest:
        guest.first_name = payload.first_name.strip()
        guest.last_name = payload.last_name.strip()
        guest.full_name = full_name
        guest.email = payload.email
        guest.updated_by_user_id = actor_user_id
        return guest
    guest = Guest(
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        full_name=full_name,
        phone=payload.phone.strip(),
        email=payload.email,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.session.add(guest)
    db.session.flush()
    return guest


def choose_available_room(
    *,
    room_type_id: uuid.UUID,
    check_in_date: date,
    check_out_date: date,
    assigned_room_id: uuid.UUID | None,
) -> Room:
    candidates = Room.query.filter_by(
        room_type_id=room_type_id, is_active=True, is_sellable=True
    ).order_by(Room.room_number.asc())
    if assigned_room_id:
        room = db.session.get(Room, assigned_room_id)
        if not room or room.room_type_id != room_type_id:
            raise ValueError("Assigned room does not match room type.")
        candidates = [room]
    else:
        candidates = candidates.all()
    nights = list(_stay_dates(check_in_date, check_out_date))
    for room in candidates:
        if room_has_external_block(room.id, check_in_date, check_out_date, for_update=True):
            continue
        rows = (
            db.session.execute(
                sa.select(InventoryDay)
                .where(
                    InventoryDay.room_id == room.id,
                    InventoryDay.business_date.in_(nights),
                )
                .with_for_update()
            )
            .scalars()
            .all()
        )
        if len(rows) != len(nights):
            continue
        if all(inventory_row_can_allocate(row) for row in rows):
            return room
    raise ValueError("No available room could be assigned without overbooking.")


def allocate_inventory(reservation: Reservation, room: Room, nightly_rates, actor_user_id: uuid.UUID | None) -> None:
    if room_has_external_block(room.id, reservation.check_in_date, reservation.check_out_date, for_update=True):
        raise ValueError("Selected room is blocked by an external calendar sync.")
    rate_lookup = {business_date: nightly_rate for business_date, nightly_rate in nightly_rates}
    rows = (
        db.session.execute(
            sa.select(InventoryDay)
            .where(
                InventoryDay.room_id == room.id,
                InventoryDay.business_date.in_(list(rate_lookup.keys())),
            )
            .with_for_update()
        )
        .scalars()
        .all()
    )
    if len(rows) != len(rate_lookup):
        raise ValueError("Inventory horizon is incomplete for this stay.")
    inventory_status = "reserved"
    if reservation.current_status == "checked_in":
        inventory_status = "occupied"
    elif reservation.current_status == "house_use":
        inventory_status = "house_use"
    for row in rows:
        if not inventory_row_can_allocate(row):
            raise ValueError("Selected room is not available for all requested nights.")
        row.availability_status = inventory_status
        row.reservation_id = reservation.id
        row.nightly_rate = rate_lookup[row.business_date]
        row.updated_by_user_id = actor_user_id


def release_inventory(reservation: Reservation, actor_user_id: uuid.UUID | None) -> None:
    rows = (
        db.session.execute(
            sa.select(InventoryDay)
            .where(InventoryDay.reservation_id == reservation.id)
            .with_for_update()
        )
        .scalars()
        .all()
    )
    for row in rows:
        row.availability_status = "available"
        row.reservation_id = None
        row.nightly_rate = None
        row.updated_by_user_id = actor_user_id


def next_reservation_code() -> str:
    prefix_setting = AppSetting.query.filter_by(key="reservation.code_prefix", deleted_at=None).first()
    prefix = prefix_setting.value_json.get("value", "SBX") if prefix_setting else "SBX"
    bind = db.session.get_bind()
    if bind.dialect.name == "postgresql":
        next_value = db.session.execute(sa.text("SELECT nextval('reservation_code_seq')")).scalar_one()
    else:
        sequence = ReservationCodeSequence.query.filter_by(sequence_name="reservation_code").with_for_update().first()
        if not sequence:
            sequence = ReservationCodeSequence(sequence_name="reservation_code", next_value=1)
            db.session.add(sequence)
            db.session.flush()
        next_value = sequence.next_value
        sequence.next_value += 1
    return f"{prefix}-{int(next_value):08d}"


def calculate_deposit_required(check_in_date: date, check_out_date: date, grand_total: Decimal) -> Decimal:
    if not get_setting_value("payment.deposit_enabled", True):
        return Decimal("0.00")
    if check_in_date <= date.today():
        return Decimal("0.00")
    percentage = Decimal(str(get_setting_value("reservation.deposit_percentage", "50.00")))
    if percentage <= Decimal("0.00"):
        return Decimal("0.00")
    return ((grand_total * percentage) / Decimal("100.00")).quantize(Decimal("0.01"))


def reservation_snapshot(reservation: Reservation) -> dict:
    return {
        "reservation_code": reservation.reservation_code,
        "status": reservation.current_status,
        "room_type_id": str(reservation.room_type_id),
        "assigned_room_id": str(reservation.assigned_room_id) if reservation.assigned_room_id else None,
        "check_in_date": reservation.check_in_date.isoformat(),
        "check_out_date": reservation.check_out_date.isoformat(),
        "quoted_extras_total": str(getattr(reservation, "quoted_extras_total", 0)),
        "quoted_grand_total": str(reservation.quoted_grand_total),
    }


def inventory_row_can_allocate(row: InventoryDay) -> bool:
    return (
        row.availability_status == "available"
        and row.is_sellable
        and not row.is_blocked
        and not row.maintenance_flag
    )


def _stay_dates(check_in_date: date, check_out_date: date):
    cursor = check_in_date
    while cursor < check_out_date:
        yield cursor
        cursor += timedelta(days=1)


# ---------------------------------------------------------------------------
# Waitlist promotion and expiry
# ---------------------------------------------------------------------------

_log = logging.getLogger(__name__)


def promote_eligible_waitlist() -> dict:
    """Promote waitlisted reservations to confirmed when rooms become available.

    Processes waitlisted reservations ordered by creation date (FIFO),
    attempting to assign a room and allocate inventory for each. Reservations
    whose check-in date has already passed are skipped (handled by expiry).

    Returns a summary dict with ``promoted`` and ``skipped`` counts.
    """
    today = date.today()
    waitlisted = (
        db.session.execute(
            sa.select(Reservation)
            .where(
                Reservation.current_status == "waitlist",
                Reservation.check_in_date >= today,
                Reservation.deleted_at.is_(None),
            )
            .order_by(Reservation.created_at.asc())
        )
        .scalars()
        .all()
    )

    promoted = 0
    skipped = 0

    for reservation in waitlisted:
        try:
            room = choose_available_room(
                room_type_id=reservation.room_type_id,
                check_in_date=reservation.check_in_date,
                check_out_date=reservation.check_out_date,
                assigned_room_id=None,
            )
        except ValueError:
            skipped += 1
            continue

        before_data = reservation_snapshot(reservation)
        room_type = db.session.get(RoomType, reservation.room_type_id)
        quote = quote_reservation(
            room_type=room_type,
            check_in_date=reservation.check_in_date,
            check_out_date=reservation.check_out_date,
            adults=reservation.adults + (reservation.extra_guests or 0),
            children=reservation.children,
        )

        reservation.assigned_room_id = room.id
        reservation.current_status = "confirmed"
        reservation.updated_by_user_id = None
        allocate_inventory(
            reservation=reservation,
            room=room,
            nightly_rates=quote.nightly_rates,
            actor_user_id=None,
        )
        db.session.add(
            ReservationStatusHistory(
                reservation_id=reservation.id,
                old_status="waitlist",
                new_status="confirmed",
                reason="waitlist_auto_promotion",
                note=f"Auto-promoted: room {room.room_number} became available",
                changed_by_user_id=None,
            )
        )
        write_audit_log(
            actor_user_id=None,
            entity_table="reservations",
            entity_id=str(reservation.id),
            action="update",
            before_data=before_data,
            after_data=reservation_snapshot(reservation),
        )
        promoted += 1
        _log.info(
            "Waitlist promoted: %s → confirmed (room %s)",
            reservation.reservation_code,
            room.room_number,
        )

    if promoted:
        db.session.commit()

    return {"promoted": promoted, "skipped": skipped}


def expire_stale_waitlist(*, max_age_days: int = 14) -> dict:
    """Cancel waitlisted reservations that are past their check-in date or older
    than ``max_age_days`` since creation.

    Returns a summary dict with ``expired`` count.
    """
    today = date.today()
    cutoff = utc_now() - timedelta(days=max_age_days)

    stale = (
        db.session.execute(
            sa.select(Reservation)
            .where(
                Reservation.current_status == "waitlist",
                Reservation.deleted_at.is_(None),
                sa.or_(
                    Reservation.check_in_date < today,
                    Reservation.created_at < cutoff,
                ),
            )
            .order_by(Reservation.created_at.asc())
        )
        .scalars()
        .all()
    )

    expired = 0
    for reservation in stale:
        before_data = reservation_snapshot(reservation)
        reservation.current_status = "cancelled"
        reservation.cancelled_at = utc_now()
        reservation.cancellation_reason = "waitlist_expired"
        reservation.updated_by_user_id = None
        release_inventory(reservation, actor_user_id=None)
        db.session.add(
            ReservationStatusHistory(
                reservation_id=reservation.id,
                old_status="waitlist",
                new_status="cancelled",
                reason="waitlist_expired",
                note=f"Auto-expired: waitlist older than {max_age_days} days or past check-in",
                changed_by_user_id=None,
            )
        )
        write_audit_log(
            actor_user_id=None,
            entity_table="reservations",
            entity_id=str(reservation.id),
            action="update",
            before_data=before_data,
            after_data=reservation_snapshot(reservation),
        )
        expired += 1
        _log.info("Waitlist expired: %s → cancelled", reservation.reservation_code)

    if expired:
        db.session.commit()

    return {"expired": expired}
