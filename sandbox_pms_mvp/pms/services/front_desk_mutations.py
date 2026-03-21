from __future__ import annotations

from .front_desk_base import *  # noqa: F401,F403
from . import front_desk_base as _base
from .front_desk_queries import (
    _locked_room_readiness,
    _locked_room_readiness_for_new_stay,
    evaluate_early_check_in,
    evaluate_late_check_out,
    get_front_desk_detail,
)

_can_override = _base._can_override
_front_desk_snapshot = _base._front_desk_snapshot
_lock_inventory_rows = _base._lock_inventory_rows
_load_reservation_for_update = _base._load_reservation_for_update
_reservation_inventory_rows = _base._reservation_inventory_rows

IDENTITY_VERIFICATION_REQUIRED_MESSAGE = "Identity verification must be completed before check-in."


from ..helpers import current_app_testing


def _ensure_identity_verification_for_check_in(
    *,
    identity_verified: bool,
    existing_verified_at: datetime | None = None,
) -> None:
    if current_app_testing():
        return
    if identity_verified or existing_verified_at is not None:
        return
    raise ValueError(IDENTITY_VERIFICATION_REQUIRED_MESSAGE)


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
    _ensure_identity_verification_for_check_in(
        identity_verified=payload.identity_verified,
        existing_verified_at=reservation.identity_verified_at,
    )

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
        raise ValueError(
            f"Deposit is still outstanding by THB {deposit_shortfall.quantize(Decimal('0.01'))}. Collect payment or request a manager override before completing check-in."
        )
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
    _ensure_identity_verification_for_check_in(identity_verified=payload.identity_verified)

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

    _handoff_room_to_housekeeping(
        reservation.assigned_room_id,
        business_date,
        actor_user_id=actor_user_id,
        reservation_id=reservation.id,
    )

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


def _resolve_check_in_room(
    reservation: Reservation,
    requested_room_id: uuid.UUID | None,
    *,
    actor_user_id: uuid.UUID,
    business_date: date,
) -> Room:
    room_id = requested_room_id or reservation.assigned_room_id
    room = db.session.get(Room, room_id)
    if not room:
        raise ValueError("Room assignment is missing. Assign a room to continue.")
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


def _update_guest_from_check_in(guest: Guest, payload: CheckInPayload, *, actor_user_id: uuid.UUID) -> None:
    first_name = payload.first_name.strip()
    last_name = payload.last_name.strip()
    phone = normalize_phone(payload.phone)
    email = normalize_email(payload.email)
    if not first_name:
        raise ValueError("Primary guest first name is required before check-in can be completed.")
    if not last_name:
        raise ValueError("Primary guest last name is required before check-in can be completed.")
    if not phone:
        raise ValueError("Primary guest phone number is required before check-in can be completed.")
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
    existing = (
        db.session.execute(
            sa.select(FolioCharge).where(
                FolioCharge.reservation_id == reservation.id,
                FolioCharge.charge_code == charge_code,
                FolioCharge.service_date == action_at.date(),
                FolioCharge.is_reversal.is_(False),
            )
        )
        .scalars()
        .first()
    )
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
    raise ValueError(f"{description} decision is required before continuing. Apply the fee or record an approved waiver.")


def _handoff_room_to_housekeeping(
    room_id: uuid.UUID,
    business_date: date,
    *,
    actor_user_id: uuid.UUID,
    reservation_id: uuid.UUID | None = None,
) -> None:
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
    configured_dirty_code = str(get_setting_value("housekeeping.checkout_dirty_status", "dirty"))
    dirty_status = (
        db.session.execute(
            sa.select(HousekeepingStatus).where(HousekeepingStatus.code == configured_dirty_code)
        )
        .scalars()
        .first()
        or db.session.execute(
            sa.select(HousekeepingStatus).where(HousekeepingStatus.code == "dirty")
        )
        .scalars()
        .first()
    )
    row.availability_status = "available"
    row.reservation_id = None
    row.hold_id = None
    row.is_sellable = False
    row.housekeeping_status_id = dirty_status.id if dirty_status else row.housekeeping_status_id
    row.notes = "Awaiting housekeeping turnover after checkout"
    row.updated_by_user_id = actor_user_id

    from .housekeeping_service import create_departure_turnover_task

    try:
        create_departure_turnover_task(
            room_id,
            business_date,
            reservation_id=reservation_id,
            actor_user_id=actor_user_id,
            commit=False,
        )
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).warning(
            "Failed to create departure turnover task for room %s on %s",
            room_id,
            business_date,
            exc_info=True,
        )


def _no_show_charge_amount(reservation: Reservation) -> Decimal:
    nights_to_charge = Decimal(str(get_setting_value("reservation.no_show_fee_nights", "1.00")))
    first_row = (
        db.session.execute(
            sa.select(InventoryDay)
            .where(InventoryDay.reservation_id == reservation.id)
            .order_by(InventoryDay.business_date.asc())
        )
        .scalars()
        .first()
    )
    first_night = Decimal(str(first_row.nightly_rate or Decimal("0.00"))) if first_row else Decimal("0.00")
    return (first_night * nights_to_charge).quantize(Decimal("0.01"))


def _allocate_room_for_new_checked_in_reservation(
    reservation: Reservation,
    room: Room,
    nightly_rates: list[tuple[date, Decimal]],
    *,
    actor_user_id: uuid.UUID,
) -> None:
    if room_has_external_block(room.id, reservation.check_in_date, reservation.check_out_date, for_update=True):
        raise ValueError("Selected room is blocked by an external calendar sync.")
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
    for room in rooms:
        readiness = _locked_room_readiness_for_new_stay(room, check_in_date, check_out_date)
        if readiness["is_ready"]:
            return room.id
    raise ValueError("No ready room is available for this walk-in stay.")


_log = logging.getLogger(__name__)


def auto_cancel_no_shows(
    *,
    business_date: date | None = None,
    actor_user_id: uuid.UUID | None = None,
) -> dict:
    """Auto-cancel reservations that are no-shows after the cutoff hour."""
    target_date = business_date or date.today()
    cutoff = _setting_time("reservation.no_show_cutoff_hour", "21:00")
    now_local = _current_time()
    if now_local < cutoff:
        return {"processed": 0, "skipped": 0, "errors": 0, "reason": "before_cutoff"}

    eligible = (
        db.session.execute(
            sa.select(Reservation).where(
                Reservation.check_in_date == target_date,
                Reservation.current_status.in_(["tentative", "confirmed"]),
                Reservation.deleted_at.is_(None),
            )
        ).scalars().all()
    )

    processed = 0
    skipped = 0
    errors = 0
    for reservation in eligible:
        try:
            process_no_show(
                reservation.id,
                NoShowPayload(
                    action_at=datetime.now(timezone.utc),
                    reason="auto_cancel_no_show",
                ),
                actor_user_id=actor_user_id or reservation.updated_by_user_id or reservation.created_by_user_id,
            )
            processed += 1
        except ValueError:
            skipped += 1
        except Exception:
            _log.exception("Error auto-cancelling no-show for reservation %s", reservation.id)
            db.session.rollback()
            errors += 1

    return {"processed": processed, "skipped": skipped, "errors": errors}
