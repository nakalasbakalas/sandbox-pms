from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
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
    Reservation,
    ReservationNote,
    ReservationStatusHistory,
    Room,
    RoomType,
    User,
)
from ..pricing import get_setting_value, quote_reservation
from .cashier_service import (
    ensure_room_charges_posted,
    PaymentPostingPayload,
    RefundPostingPayload,
    post_fee_charge,
    record_payment,
    record_refund,
)
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
    clean_optional,
    get_reservation_detail,
    normalize_email,
    normalize_phone,
    payment_summary,
)


READY_HOUSEKEEPING_CODES = {"clean", "inspected"}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


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


def list_front_desk_workspace(filters: FrontDeskFilters) -> dict:
    if filters.mode == "departures":
        items = list_front_desk_departures(filters.business_date, filters=filters)
    elif filters.mode == "in_house":
        items = list_front_desk_in_house(filters.business_date, filters=filters)
    else:
        items = list_front_desk_arrivals(filters.business_date, filters=filters)
    return {
        "mode": filters.mode,
        "business_date": filters.business_date,
        "items": items,
        "counts": {
            "arrivals": len(list_front_desk_arrivals(filters.business_date, filters=FrontDeskFilters(business_date=filters.business_date, mode="arrivals"))),
            "departures": len(list_front_desk_departures(filters.business_date, filters=FrontDeskFilters(business_date=filters.business_date, mode="departures"))),
            "in_house": len(list_front_desk_in_house(filters.business_date, filters=FrontDeskFilters(business_date=filters.business_date, mode="in_house"))),
        },
    }


def list_front_desk_arrivals(business_date: date, *, filters: FrontDeskFilters) -> list[dict]:
    query = _front_desk_query().filter(
        Reservation.check_in_date == business_date,
        Reservation.current_status.in_(["tentative", "confirmed"]),
    )
    query = _apply_front_desk_filters(query, filters)
    reservations = query.order_by(Reservation.booked_at.asc()).all()
    return [_front_desk_summary(reservation, business_date) for reservation in reservations]


def list_front_desk_departures(business_date: date, *, filters: FrontDeskFilters) -> list[dict]:
    query = _front_desk_query().filter(
        Reservation.check_out_date == business_date,
        Reservation.current_status.in_(["checked_in", "checked_out"]),
    )
    query = _apply_front_desk_filters(query, filters)
    reservations = query.order_by(Reservation.assigned_room_id.asc(), Reservation.booked_at.asc()).all()
    return [_front_desk_summary(reservation, business_date) for reservation in reservations]


def list_front_desk_in_house(business_date: date, *, filters: FrontDeskFilters) -> list[dict]:
    query = _front_desk_query().filter(
        Reservation.current_status == "checked_in",
        Reservation.check_in_date <= business_date,
        Reservation.check_out_date > business_date,
    )
    query = _apply_front_desk_filters(query, filters)
    reservations = query.order_by(Reservation.check_out_date.asc(), Reservation.assigned_room_id.asc()).all()
    return [_front_desk_summary(reservation, business_date) for reservation in reservations]


def get_front_desk_detail(reservation_id: uuid.UUID, *, business_date: date | None = None) -> dict:
    detail = get_reservation_detail(reservation_id)
    reservation = detail["reservation"]
    business_date = business_date or date.today()
    front_desk = _front_desk_summary(reservation, business_date)
    front_desk["early_fee"] = evaluate_early_check_in(reservation, _combine_local(business_date, _current_time()))
    front_desk["late_fee"] = evaluate_late_check_out(reservation, _combine_local(business_date, _current_time()))
    front_desk["folio_charges"] = (
        FolioCharge.query.filter_by(reservation_id=reservation.id).order_by(FolioCharge.posted_at.desc()).limit(20).all()
    )
    front_desk["payment_events"] = (
        PaymentEvent.query.filter_by(reservation_id=reservation.id).order_by(PaymentEvent.created_at.desc()).limit(20).all()
    )
    detail["front_desk"] = front_desk
    return detail


def complete_check_in(
    reservation_id: uuid.UUID,
    payload: CheckInPayload,
    *,
    actor_user_id: uuid.UUID,
) -> Reservation:
    action_at = payload.action_at or utc_now()
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    if reservation.current_status not in {"tentative", "confirmed"}:
        raise ValueError("Only tentative or confirmed reservations can be checked in.")
    if action_at.date() >= reservation.check_out_date:
        raise ValueError("This reservation can no longer be checked in because the departure date has passed.")

    actor = db.session.get(User, actor_user_id)
    room = _resolve_check_in_room(reservation, payload.room_id, actor_user_id=actor_user_id, business_date=action_at.date())
    readiness = _locked_room_readiness(reservation, room, action_at.date())
    if not readiness["is_ready"]:
        raise ValueError(readiness["reason"])

    current_payment = payment_summary(reservation)
    _update_guest_from_check_in(reservation.primary_guest, payload, actor_user_id=actor_user_id)
    _collect_payment_if_requested(
        reservation,
        payload.collect_payment_amount,
        payload.payment_method,
        actor_user_id=actor_user_id,
        action_at=action_at,
        is_deposit=current_payment["deposit_received_amount"] < current_payment["deposit_required_amount"],
    )
    current_payment = payment_summary(reservation)
    deposit_shortfall = max(Decimal("0.00"), current_payment["deposit_required_amount"] - current_payment["deposit_received_amount"])
    if deposit_shortfall > Decimal("0.00") and not payload.override_payment:
        raise ValueError("Deposit remains outstanding. Collect payment or request a manager override.")
    if deposit_shortfall > Decimal("0.00") and payload.override_payment and not _can_override(actor):
        raise ValueError("Only manager or admin can override deposit controls.")

    early_fee = evaluate_early_check_in(reservation, action_at)
    if early_fee["applies"]:
        _resolve_fee_decision(
            reservation=reservation,
            actor=actor,
            action_at=action_at,
            fee_amount=early_fee["amount"],
            charge_code="ECI",
            description="Early check-in fee",
            apply_fee=payload.apply_early_fee,
            waive_fee=payload.waive_early_fee,
            waiver_reason=payload.waiver_reason,
            actor_user_id=actor_user_id,
            activity_event="front_desk.early_check_in",
        )

    before = _front_desk_snapshot(reservation)
    reservation.current_status = "checked_in"
    reservation.checked_in_at = action_at
    reservation.updated_by_user_id = actor_user_id
    if payload.identity_verified:
        reservation.identity_verified_at = action_at
        reservation.identity_verified_by_user_id = actor_user_id

    room_rows = _reservation_inventory_rows(reservation.id, start_date=action_at.date())
    for row in room_rows:
        row.availability_status = "occupied"
        row.updated_by_user_id = actor_user_id

    if payload.arrival_note:
        db.session.add(
            ReservationNote(
                reservation_id=reservation.id,
                note_text=payload.arrival_note[:2000],
                note_type="operations",
                is_important=False,
                visibility_scope="all_staff",
                created_by_user_id=actor_user_id,
            )
        )

    db.session.add(
        ReservationStatusHistory(
            reservation_id=reservation.id,
            old_status=before["status"],
            new_status="checked_in",
            reason="front_desk_check_in",
            note=f"Checked in to room {room.room_number}",
            changed_by_user_id=actor_user_id,
        )
    )
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="reservations",
        entity_id=str(reservation.id),
        action="front_desk_check_in",
        before_data=before,
        after_data=_front_desk_snapshot(reservation),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="front_desk.checked_in",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"reservation_code": reservation.reservation_code, "room_number": room.room_number},
    )
    db.session.commit()
    return reservation


def create_walk_in_and_check_in(payload: WalkInCheckInPayload, *, actor_user_id: uuid.UUID) -> Reservation:
    action_at = payload.action_at or utc_now()
    room_type = db.session.get(RoomType, payload.room_type_id)
    if not room_type or not room_type.is_active:
        raise ValueError("Selected room type is not available.")
    reservation_payload = ReservationCreatePayload(
        first_name=payload.first_name,
        last_name=payload.last_name,
        phone=normalize_phone(payload.phone),
        email=normalize_email(payload.email),
        room_type_id=payload.room_type_id,
        check_in_date=payload.check_in_date,
        check_out_date=payload.check_out_date,
        adults=payload.adults,
        children=payload.children,
        extra_guests=payload.extra_guests,
        assigned_room_id=payload.room_id or _first_ready_room_id(payload.room_type_id, payload.check_in_date, payload.check_out_date),
        source_channel="walk_in",
        special_requests=payload.special_requests,
        internal_notes=payload.internal_notes,
    )
    validate_payload(reservation_payload)
    validate_occupancy(room_type, payload.adults + payload.extra_guests, payload.children)

    guest = create_or_get_guest(reservation_payload, actor_user_id)
    quote = quote_reservation(
        room_type=room_type,
        check_in_date=payload.check_in_date,
        check_out_date=payload.check_out_date,
        adults=payload.adults + payload.extra_guests,
        children=payload.children,
    )
    room = db.session.get(Room, reservation_payload.assigned_room_id)
    readiness = _locked_room_readiness_for_new_stay(room, payload.check_in_date, payload.check_out_date)
    if not readiness["is_ready"]:
        raise ValueError(readiness["reason"])

    reservation = Reservation(
        reservation_code=next_reservation_code(),
        primary_guest_id=guest.id,
        room_type_id=room_type.id,
        assigned_room_id=room.id,
        current_status="confirmed",
        source_channel="walk_in",
        check_in_date=payload.check_in_date,
        check_out_date=payload.check_out_date,
        adults=payload.adults,
        children=payload.children,
        extra_guests=payload.extra_guests,
        special_requests=payload.special_requests,
        internal_notes=payload.internal_notes,
        quoted_room_total=quote.room_total,
        quoted_tax_total=quote.tax_total,
        quoted_grand_total=quote.grand_total,
        deposit_required_amount=calculate_deposit_required(payload.check_in_date, payload.check_out_date, quote.grand_total),
        deposit_received_amount=Decimal("0.00"),
        booked_at=action_at,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.session.add(reservation)
    db.session.flush()
    _allocate_room_for_new_checked_in_reservation(reservation, room, quote.nightly_rates, actor_user_id=actor_user_id)
    _update_guest_walk_in_identity(guest, payload, actor_user_id=actor_user_id)
    _collect_payment_if_requested(
        reservation,
        payload.collect_payment_amount,
        payload.payment_method,
        actor_user_id=actor_user_id,
        action_at=action_at,
        is_deposit=Decimal(str(reservation.deposit_required_amount)) > Decimal("0.00"),
    )

    early_fee = evaluate_early_check_in(reservation, action_at)
    if early_fee["applies"]:
        _resolve_fee_decision(
            reservation=reservation,
            actor=db.session.get(User, actor_user_id),
            action_at=action_at,
            fee_amount=early_fee["amount"],
            charge_code="ECI",
            description="Early check-in fee",
            apply_fee=payload.apply_early_fee,
            waive_fee=payload.waive_early_fee,
            waiver_reason=payload.waiver_reason,
            actor_user_id=actor_user_id,
            activity_event="front_desk.early_check_in",
        )

    reservation.current_status = "checked_in"
    reservation.checked_in_at = action_at
    if payload.identity_verified:
        reservation.identity_verified_at = action_at
        reservation.identity_verified_by_user_id = actor_user_id

    db.session.add(
        ReservationStatusHistory(
            reservation_id=reservation.id,
            old_status=None,
            new_status="checked_in",
            reason="walk_in_checked_in",
            note=f"Walk-in checked in to room {room.room_number}",
            changed_by_user_id=actor_user_id,
        )
    )
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="reservations",
        entity_id=str(reservation.id),
        action="front_desk_walk_in_check_in",
        after_data=_front_desk_snapshot(reservation),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="front_desk.walk_in_checked_in",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"reservation_code": reservation.reservation_code, "room_number": room.room_number},
    )
    db.session.commit()
    return reservation


def prepare_checkout(reservation_id: uuid.UUID, *, action_at: datetime | None = None) -> dict:
    detail = get_front_desk_detail(reservation_id)
    reservation = detail["reservation"]
    action_at = action_at or utc_now()
    ensure_room_charges_posted(
        reservation.id,
        through_date=reservation.check_out_date.fromordinal(reservation.check_out_date.toordinal() - 1),
        actor_user_id=None,
        commit=True,
    )
    detail["checkout_fee"] = evaluate_late_check_out(reservation, action_at)
    detail["checkout_payment_summary"] = payment_summary(reservation)
    return detail


def complete_checkout(
    reservation_id: uuid.UUID,
    payload: CheckoutPayload,
    *,
    actor_user_id: uuid.UUID,
) -> Reservation:
    action_at = payload.action_at or utc_now()
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    if reservation.current_status != "checked_in":
        raise ValueError("Only checked-in reservations can be checked out.")

    actor = db.session.get(User, actor_user_id)
    before = _front_desk_snapshot(reservation)
    ensure_room_charges_posted(
        reservation.id,
        through_date=reservation.check_out_date.fromordinal(reservation.check_out_date.toordinal() - 1),
        actor_user_id=actor_user_id,
        commit=False,
    )
    _collect_payment_if_requested(
        reservation,
        payload.collect_payment_amount,
        payload.payment_method,
        actor_user_id=actor_user_id,
        action_at=action_at,
        is_deposit=False,
    )

    late_fee = evaluate_late_check_out(reservation, action_at)
    if late_fee["applies"]:
        _resolve_fee_decision(
            reservation=reservation,
            actor=actor,
            action_at=action_at,
            fee_amount=late_fee["amount"],
            charge_code="LCO",
            description="Late check-out fee",
            apply_fee=payload.apply_late_fee,
            waive_fee=payload.waive_late_fee,
            waiver_reason=payload.waiver_reason,
            actor_user_id=actor_user_id,
            activity_event="front_desk.late_check_out",
        )

    current_payment = payment_summary(reservation)
    if current_payment["balance_due"] > Decimal("0.00") and not payload.override_balance:
        raise ValueError("Outstanding balance remains. Collect payment or request a manager override.")
    if current_payment["balance_due"] > Decimal("0.00") and payload.override_balance and not _can_override(actor):
        raise ValueError("Only manager or admin can override checkout balance controls.")

    if current_payment["refund_due"] > Decimal("0.00"):
        if payload.process_refund:
            record_refund(
                reservation.id,
                RefundPostingPayload(
                    amount=current_payment["refund_due"],
                    reason=clean_optional(payload.refund_note, limit=255) or "Checkout refund",
                    payment_method=payload.payment_method,
                    service_date=action_at.date(),
                    processed=True,
                ),
                actor_user_id=actor_user_id,
                commit=False,
            )
        else:
            record_refund(
                reservation.id,
                RefundPostingPayload(
                    amount=current_payment["refund_due"],
                    reason=clean_optional(payload.refund_note, limit=255) or "Checkout refund pending",
                    payment_method=payload.payment_method,
                    service_date=action_at.date(),
                    processed=False,
                ),
                actor_user_id=actor_user_id,
                commit=False,
            )

    business_date = action_at.date()
    rows = _reservation_inventory_rows(reservation.id)
    for row in rows:
        if row.business_date >= business_date:
            row.availability_status = "available"
            row.reservation_id = None
            row.nightly_rate = None
            row.updated_by_user_id = actor_user_id

    _handoff_room_to_housekeeping(reservation.assigned_room_id, business_date, actor_user_id=actor_user_id)

    reservation.current_status = "checked_out"
    reservation.checked_out_at = action_at
    reservation.updated_by_user_id = actor_user_id
    db.session.add(
        ReservationStatusHistory(
            reservation_id=reservation.id,
            old_status=before["status"],
            new_status="checked_out",
            reason="front_desk_check_out",
            note=f"Checked out from room {reservation.assigned_room.room_number}",
            changed_by_user_id=actor_user_id,
        )
    )
    if payload.departure_note:
        db.session.add(
            ReservationNote(
                reservation_id=reservation.id,
                note_text=payload.departure_note[:2000],
                note_type="operations",
                is_important=False,
                visibility_scope="all_staff",
                created_by_user_id=actor_user_id,
            )
        )
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="reservations",
        entity_id=str(reservation.id),
        action="front_desk_check_out",
        before_data=before,
        after_data=_front_desk_snapshot(reservation),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="front_desk.checked_out",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"reservation_code": reservation.reservation_code, "room_number": reservation.assigned_room.room_number},
    )
    db.session.commit()
    return reservation


def process_no_show(
    reservation_id: uuid.UUID,
    payload: NoShowPayload,
    *,
    actor_user_id: uuid.UUID,
) -> Reservation:
    action_at = payload.action_at or utc_now()
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    if reservation.current_status not in {"tentative", "confirmed"}:
        raise ValueError("Only tentative or confirmed reservations can be marked as no-show.")
    if action_at.date() < reservation.check_in_date:
        raise ValueError("No-show processing is only available on or after the arrival date.")

    before = _front_desk_snapshot(reservation)
    no_show_amount = _no_show_charge_amount(reservation)
    rows = _reservation_inventory_rows(reservation.id)
    for row in rows:
        if row.business_date >= action_at.date():
            row.availability_status = "available"
            row.reservation_id = None
            row.nightly_rate = None
            row.updated_by_user_id = actor_user_id

    if no_show_amount > Decimal("0.00"):
        payment_request = PaymentRequest(
            reservation_id=reservation.id,
            request_type="no_show_charge",
            amount=no_show_amount,
            currency_code="THB",
            status="pending",
            provider="front_desk",
            created_by_user_id=actor_user_id,
            updated_by_user_id=actor_user_id,
        )
        db.session.add(payment_request)
        db.session.flush()
        db.session.add(
            PaymentEvent(
                payment_request_id=payment_request.id,
                reservation_id=reservation.id,
                event_type="no_show_charge_created",
                amount=no_show_amount,
                currency_code="THB",
                provider="front_desk",
                created_by_user_id=actor_user_id,
            )
        )

    reservation.current_status = "no_show"
    reservation.no_show_at = action_at
    reservation.updated_by_user_id = actor_user_id
    db.session.add(
        ReservationStatusHistory(
            reservation_id=reservation.id,
            old_status=before["status"],
            new_status="no_show",
            reason=clean_optional(payload.reason, limit=255) or "front_desk_no_show",
            note="Marked as no-show from front desk workspace",
            changed_by_user_id=actor_user_id,
        )
    )
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="reservations",
        entity_id=str(reservation.id),
        action="front_desk_no_show",
        before_data=before,
        after_data=_front_desk_snapshot(reservation),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="front_desk.no_show_processed",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"reservation_code": reservation.reservation_code, "charge_amount": str(no_show_amount)},
    )
    db.session.commit()
    return reservation


def evaluate_early_check_in(reservation: Reservation, action_at: datetime) -> dict:
    check_in_dt = _combine_local(reservation.check_in_date, _setting_time("hotel.check_in_time", "14:00"))
    amount = Decimal(str(get_setting_value("reservation.early_check_in_fee", "100.00")))
    applies = amount > Decimal("0.00") and action_at < check_in_dt
    return {"applies": applies, "amount": amount, "cutoff": check_in_dt}


def evaluate_late_check_out(reservation: Reservation, action_at: datetime) -> dict:
    check_out_dt = _combine_local(reservation.check_out_date, _setting_time("hotel.check_out_time", "11:00"))
    amount = Decimal(str(get_setting_value("reservation.late_check_out_fee", "100.00")))
    applies = amount > Decimal("0.00") and action_at > check_out_dt
    return {"applies": applies, "amount": amount, "cutoff": check_out_dt}


def _ready_housekeeping_codes() -> set[str]:
    if get_setting_value("housekeeping.require_inspected_for_ready", False):
        return {"inspected"}
    return READY_HOUSEKEEPING_CODES


def room_readiness_snapshot(reservation: Reservation, business_date: date) -> dict:
    if not reservation.assigned_room_id:
        return {
            "is_ready": False,
            "label": "unassigned",
            "reason": "No room is assigned yet.",
            "housekeeping_status_code": None,
        }
    row = (
        InventoryDay.query.filter(
            InventoryDay.room_id == reservation.assigned_room_id,
            InventoryDay.business_date == business_date,
        )
        .first()
    )
    if not row:
        return {
            "is_ready": False,
            "label": "missing_inventory",
            "reason": "Inventory is missing for this room and date.",
            "housekeeping_status_code": None,
        }
    housekeeping_code = _housekeeping_code(row.housekeeping_status_id)
    if getattr(row, "is_blocked", False):
        return {
            "is_ready": False,
            "label": "blocked",
            "reason": row.blocked_reason or "Room is blocked from sale.",
            "housekeeping_status_code": housekeeping_code,
        }
    if row.availability_status in {"out_of_service", "out_of_order"}:
        return {
            "is_ready": False,
            "label": row.availability_status,
            "reason": "Room is not sellable for arrival.",
            "housekeeping_status_code": housekeeping_code,
        }
    if row.reservation_id not in {None, reservation.id} and row.availability_status in {"reserved", "occupied", "house_use"}:
        return {
            "is_ready": False,
            "label": "conflict",
            "reason": "Room has a conflicting reservation.",
            "housekeeping_status_code": housekeeping_code,
        }
    if row.reservation_id is None and not row.is_sellable:
        return {
            "is_ready": False,
            "label": "not_sellable",
            "reason": "Room is not sellable for arrival.",
            "housekeeping_status_code": housekeeping_code,
        }
    if housekeeping_code not in _ready_housekeeping_codes():
        return {
            "is_ready": False,
            "label": "not_ready",
            "reason": f"Room is {housekeeping_code or 'not ready'} for arrival.",
            "housekeeping_status_code": housekeeping_code,
        }
    return {
        "is_ready": True,
        "label": "ready",
        "reason": "Room is ready for arrival.",
        "housekeeping_status_code": housekeeping_code,
    }


def _front_desk_query():
    return Reservation.query.options(
        joinedload(Reservation.primary_guest),
        joinedload(Reservation.assigned_room),
        joinedload(Reservation.room_type),
    )


def _apply_front_desk_filters(query, filters: FrontDeskFilters):
    if filters.room_type_id:
        query = query.filter(Reservation.room_type_id == uuid.UUID(filters.room_type_id))
    if filters.assigned == "assigned":
        query = query.filter(Reservation.assigned_room_id.is_not(None))
    if filters.assigned == "unassigned":
        query = query.filter(Reservation.assigned_room_id.is_(None))
    if filters.booking_source:
        query = query.filter(Reservation.source_channel == filters.booking_source)
    if filters.payment_state:
        if filters.payment_state == "paid":
            query = query.filter(Reservation.deposit_received_amount >= Reservation.deposit_required_amount)
        elif filters.payment_state == "partial":
            query = query.filter(Reservation.deposit_received_amount > 0, Reservation.deposit_received_amount < Reservation.deposit_required_amount)
        elif filters.payment_state == "missing":
            query = query.filter(Reservation.deposit_required_amount > 0, Reservation.deposit_received_amount <= 0)
    reservations = query.all()
    if not any([filters.ready, filters.flagged]):
        return query
    matching_ids: list[uuid.UUID] = []
    for reservation in reservations:
        summary = _front_desk_summary(reservation, filters.business_date)
        if filters.ready == "ready" and not summary["room_ready"]:
            continue
        if filters.ready == "not_ready" and summary["room_ready"]:
            continue
        if filters.flagged == "issues" and not summary["flagged_issue"]:
            continue
        matching_ids.append(reservation.id)
    if not matching_ids:
        return query.filter(sa.false())
    return query.filter(Reservation.id.in_(matching_ids))


def _front_desk_summary(reservation: Reservation, business_date: date) -> dict:
    summary = build_reservation_summary(reservation)
    readiness = room_readiness_snapshot(reservation, business_date)
    payment = payment_summary(reservation)
    early_requested = bool(reservation.special_requests and "early" in reservation.special_requests.lower())
    flagged_issue = any(
        [
            not readiness["is_ready"],
            summary["assigned_room_number"] is None,
            payment["deposit_state"] in {"missing", "partial"},
            summary["duplicate_suspected"],
            summary["special_requests_present"],
        ]
    )
    summary.update(
        {
            "room_ready": readiness["is_ready"],
            "room_readiness_label": readiness["label"],
            "room_readiness_reason": readiness["reason"],
            "housekeeping_status_code": readiness["housekeeping_status_code"],
            "payment_summary": payment,
            "refund_due": payment["refund_due"],
            "early_check_in_requested": early_requested,
            "flagged_issue": flagged_issue,
            "turnover_status": "awaiting_housekeeping" if reservation.current_status == "checked_out" else None,
        }
    )
    return summary


def _resolve_check_in_room(reservation: Reservation, requested_room_id: uuid.UUID | None, *, actor_user_id: uuid.UUID, business_date: date) -> Room:
    room_id = requested_room_id or reservation.assigned_room_id
    room = db.session.get(Room, room_id)
    if not room:
        raise ValueError("A valid room assignment is required before check-in.")
    if room.room_type_id != reservation.room_type_id:
        raise ValueError("Check-in room must stay within the booked room type.")
    if room.id != reservation.assigned_room_id:
        assign_room(
            reservation.id,
            room.id,
            actor_user_id=actor_user_id,
            reason="arrival_reassignment",
            commit=False,
        )
        db.session.expire_all()
        refreshed = _load_reservation_for_update(reservation.id)
        room = refreshed.assigned_room
    return room


def _locked_room_readiness(reservation: Reservation, room: Room, business_date: date) -> dict:
    rows = _lock_inventory_rows(room.id, business_date, reservation.check_out_date)
    if len(rows) != (reservation.check_out_date - business_date).days:
        return {"is_ready": False, "label": "missing_inventory", "reason": "Inventory is missing for this room and date."}
    first_row = rows[0]
    housekeeping_code = _housekeeping_code(first_row.housekeeping_status_id)
    if getattr(first_row, "is_blocked", False):
        return {"is_ready": False, "label": "blocked", "reason": first_row.blocked_reason or "Assigned room is blocked."}
    if housekeeping_code not in _ready_housekeeping_codes():
        return {"is_ready": False, "label": "not_ready", "reason": f"Room is {housekeeping_code or 'not ready'} for arrival."}
    consuming_conflict = any(
        row.reservation_id not in {None, reservation.id} and row.availability_status in {"reserved", "occupied", "house_use"}
        for row in rows
    )
    if consuming_conflict:
        return {"is_ready": False, "label": "conflict", "reason": "Assigned room conflicts with another active stay."}
    bad_rows = [
        row
        for row in rows
        if row.availability_status in {"out_of_service", "out_of_order"}
        or (row.reservation_id is None and not row.is_sellable)
        or getattr(row, "is_blocked", False)
    ]
    if bad_rows:
        return {"is_ready": False, "label": "not_sellable", "reason": "Assigned room is not sellable for the full stay."}
    return {"is_ready": True, "label": "ready", "reason": "Room is ready for arrival."}


def _locked_room_readiness_for_new_stay(room: Room, check_in_date: date, check_out_date: date) -> dict:
    rows = _lock_inventory_rows(room.id, check_in_date, check_out_date)
    if len(rows) != (check_out_date - check_in_date).days:
        return {"is_ready": False, "reason": "Inventory is missing for the requested walk-in stay."}
    first_row = rows[0]
    housekeeping_code = _housekeeping_code(first_row.housekeeping_status_id)
    if getattr(first_row, "is_blocked", False):
        return {"is_ready": False, "reason": first_row.blocked_reason or "Selected room is blocked."}
    if housekeeping_code not in _ready_housekeeping_codes():
        return {"is_ready": False, "reason": f"Selected room is {housekeeping_code or 'not ready'} for arrival."}
    if not all(row.availability_status == "available" and row.is_sellable and not getattr(row, "is_blocked", False) for row in rows):
        return {"is_ready": False, "reason": "Selected room is not available for the full stay."}
    return {"is_ready": True, "reason": "Room is ready for arrival."}


def _update_guest_from_check_in(guest: Guest, payload: CheckInPayload, *, actor_user_id: uuid.UUID) -> None:
    first_name = payload.first_name.strip()
    last_name = payload.last_name.strip()
    phone = normalize_phone(payload.phone)
    email = normalize_email(payload.email)
    if not first_name or not last_name:
        raise ValueError("Guest first name and last name are required.")
    if not phone:
        raise ValueError("A valid phone number is required.")
    guest.first_name = first_name
    guest.last_name = last_name
    guest.full_name = f"{first_name} {last_name}".strip()
    guest.phone = phone
    guest.email = email
    guest.nationality = clean_optional(payload.nationality, limit=80)
    guest.id_document_type = clean_optional(payload.id_document_type, limit=80)
    guest.id_document_number = clean_optional(payload.id_document_number, limit=120)
    guest.preferred_language = clean_optional(payload.preferred_language, limit=30)
    guest.notes_summary = clean_optional(payload.notes_summary, limit=255)
    guest.updated_by_user_id = actor_user_id


def _update_guest_walk_in_identity(guest: Guest, payload: WalkInCheckInPayload, *, actor_user_id: uuid.UUID) -> None:
    guest.nationality = clean_optional(payload.nationality, limit=80)
    guest.id_document_type = clean_optional(payload.id_document_type, limit=80)
    guest.id_document_number = clean_optional(payload.id_document_number, limit=120)
    guest.preferred_language = clean_optional(payload.preferred_language, limit=30)
    guest.notes_summary = clean_optional(payload.notes_summary, limit=255)
    guest.updated_by_user_id = actor_user_id


def _collect_payment_if_requested(
    reservation: Reservation,
    amount: Decimal,
    payment_method: str,
    *,
    actor_user_id: uuid.UUID,
    action_at: datetime,
    is_deposit: bool,
) -> None:
    amount = Decimal(str(amount or Decimal("0.00"))).quantize(Decimal("0.01"))
    if amount <= Decimal("0.00"):
        return
    record_payment(
        reservation.id,
        PaymentPostingPayload(
            amount=amount,
            payment_method=payment_method or "front_desk",
            note="Collected from front-desk workflow",
            service_date=action_at.date(),
            request_type="front_desk_deposit" if is_deposit else "front_desk_collection",
            is_deposit=is_deposit,
        ),
        actor_user_id=actor_user_id,
        commit=False,
    )


def _resolve_fee_decision(
    *,
    reservation: Reservation,
    actor: User | None,
    action_at: datetime,
    fee_amount: Decimal,
    charge_code: str,
    description: str,
    apply_fee: bool,
    waive_fee: bool,
    waiver_reason: str | None,
    actor_user_id: uuid.UUID,
    activity_event: str,
) -> None:
    existing = FolioCharge.query.filter_by(
        reservation_id=reservation.id,
        charge_code=charge_code,
        service_date=action_at.date(),
        is_reversal=False,
    ).first()
    if apply_fee:
        if existing:
            return
        post_fee_charge(
            reservation.id,
            charge_code=charge_code,
            description=description,
            amount=fee_amount,
            service_date=action_at.date(),
            actor_user_id=actor_user_id,
            metadata={"applied_at": action_at.isoformat()},
            commit=False,
        )
        write_activity_log(
            actor_user_id=actor_user_id,
            event_type=activity_event,
            entity_table="reservations",
            entity_id=str(reservation.id),
            metadata={"reservation_code": reservation.reservation_code, "decision": "applied", "amount": str(fee_amount)},
        )
        return
    if waive_fee:
        if not _can_override(actor):
            raise ValueError("Only manager or admin can waive this fee.")
        write_activity_log(
            actor_user_id=actor_user_id,
            event_type=activity_event,
            entity_table="reservations",
            entity_id=str(reservation.id),
            metadata={"reservation_code": reservation.reservation_code, "decision": "waived", "reason": clean_optional(waiver_reason, limit=255)},
        )
        return
    raise ValueError(f"{description} decision is required before continuing.")


def _handoff_room_to_housekeeping(room_id: uuid.UUID, business_date: date, *, actor_user_id: uuid.UUID) -> None:
    row = (
        db.session.execute(
            sa.select(InventoryDay)
            .where(InventoryDay.room_id == room_id, InventoryDay.business_date == business_date)
            .with_for_update()
        )
        .scalars()
        .first()
    )
    if not row:
        return
    dirty_status = HousekeepingStatus.query.filter_by(
        code=str(get_setting_value("housekeeping.checkout_dirty_status", "dirty"))
    ).first() or HousekeepingStatus.query.filter_by(code="dirty").first()
    row.availability_status = "available"
    row.reservation_id = None
    row.hold_id = None
    row.is_sellable = False
    row.housekeeping_status_id = dirty_status.id if dirty_status else row.housekeeping_status_id
    row.notes = "Awaiting housekeeping turnover after checkout"
    row.updated_by_user_id = actor_user_id


def _no_show_charge_amount(reservation: Reservation) -> Decimal:
    nights_to_charge = Decimal(str(get_setting_value("reservation.no_show_fee_nights", "1.00")))
    first_row = (
        InventoryDay.query.filter_by(reservation_id=reservation.id)
        .order_by(InventoryDay.business_date.asc())
        .first()
    )
    first_night = Decimal(str(first_row.nightly_rate or Decimal("0.00"))) if first_row else Decimal("0.00")
    return (first_night * nights_to_charge).quantize(Decimal("0.01"))


def _allocate_room_for_new_checked_in_reservation(reservation: Reservation, room: Room, nightly_rates: list[tuple[date, Decimal]], *, actor_user_id: uuid.UUID) -> None:
    rows = _lock_inventory_rows(room.id, reservation.check_in_date, reservation.check_out_date)
    rate_lookup = {business_date: nightly_rate for business_date, nightly_rate in nightly_rates}
    if len(rows) != len(rate_lookup):
        raise ValueError("Inventory horizon is incomplete for this stay.")
    for row in rows:
        if row.availability_status != "available" or not row.is_sellable:
            raise ValueError("Selected room is not available for all requested nights.")
        row.availability_status = "occupied"
        row.reservation_id = reservation.id
        row.nightly_rate = rate_lookup[row.business_date]
        row.updated_by_user_id = actor_user_id


def _first_ready_room_id(room_type_id: uuid.UUID, check_in_date: date, check_out_date: date) -> uuid.UUID:
    rooms = Room.query.filter_by(room_type_id=room_type_id, is_active=True, is_sellable=True).order_by(Room.room_number.asc()).all()
    for room in rooms:
        readiness = _locked_room_readiness_for_new_stay(room, check_in_date, check_out_date)
        if readiness["is_ready"]:
            return room.id
    raise ValueError("No ready room is available for this walk-in stay.")


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
    return datetime.combine(day, wall_clock, tzinfo=timezone.utc)


def _current_time() -> time:
    now = utc_now()
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
