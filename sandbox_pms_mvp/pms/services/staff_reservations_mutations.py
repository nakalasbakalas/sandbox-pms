from __future__ import annotations

from .staff_reservations_base import *  # noqa: F401,F403
from . import staff_reservations_base as _base

_allocate_inventory_range = _base._allocate_inventory_range
_find_eligible_room = _base._find_eligible_room
_load_reservation = _base._load_reservation
_load_reservation_for_update = _base._load_reservation_for_update
_log = _base._log
_maybe_date = _base._maybe_date
_reservation_inventory_rows = _base._reservation_inventory_rows
guest_snapshot = _base.guest_snapshot


def update_guest_details(
    reservation_id: uuid.UUID,
    payload: GuestUpdatePayload,
    *,
    actor_user_id: uuid.UUID,
) -> Reservation:
    reservation = _load_reservation(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    guest = reservation.primary_guest
    if not guest:
        raise ValueError("Guest record not found.")

    payload = GuestUpdatePayload(
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        phone=normalize_phone(payload.phone),
        email=normalize_email(payload.email),
        nationality=clean_optional(payload.nationality),
        id_document_type=clean_optional(payload.id_document_type),
        id_document_number=clean_optional(payload.id_document_number),
        preferred_language=clean_optional(payload.preferred_language),
        notes_summary=clean_optional(payload.notes_summary, limit=255),
    )
    if not payload.first_name or not payload.last_name:
        raise ValueError("First name and last name are required.")
    if not payload.phone:
        raise ValueError("A valid mobile phone is required.")
    if payload.email and "@" not in payload.email:
        raise ValueError("A valid email address is required.")

    before_data = guest_snapshot(guest)
    guest.first_name = payload.first_name
    guest.last_name = payload.last_name
    guest.full_name = f"{payload.first_name} {payload.last_name}".strip()
    guest.phone = payload.phone
    guest.email = payload.email
    guest.nationality = payload.nationality
    guest.id_document_type = payload.id_document_type
    guest.id_document_number = payload.id_document_number
    guest.preferred_language = payload.preferred_language
    guest.notes_summary = payload.notes_summary
    guest.updated_by_user_id = actor_user_id

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="guests",
        entity_id=str(guest.id),
        action="staff_guest_update",
        before_data=before_data,
        after_data=guest_snapshot(guest),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="reservation.guest_updated",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"reservation_code": reservation.reservation_code},
    )
    db.session.commit()
    return reservation


def change_stay_dates(
    reservation_id: uuid.UUID,
    payload: StayDateChangePayload,
    *,
    actor_user_id: uuid.UUID,
) -> dict:
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    if reservation.current_status not in {"tentative", "confirmed"}:
        raise ValueError("Only tentative or confirmed reservations can have stay dates edited.")
    if payload.check_in_date >= payload.check_out_date:
        raise ValueError("Check-in date must be before check-out date.")

    room_type = reservation.room_type
    validate_occupancy(room_type, payload.adults + payload.extra_guests, payload.children)
    before_data = reservation_snapshot(reservation)
    previous_room_id = reservation.assigned_room_id
    before_check_in = reservation.check_in_date
    before_check_out = reservation.check_out_date
    before_adults = reservation.adults
    before_children = reservation.children
    before_extra_guests = reservation.extra_guests

    quote = quote_reservation(
        room_type=room_type,
        check_in_date=payload.check_in_date,
        check_out_date=payload.check_out_date,
        adults=payload.adults + payload.extra_guests,
        children=payload.children,
    )
    candidate_room = _find_eligible_room(
        reservation=reservation,
        room_type_id=reservation.room_type_id,
        check_in_date=payload.check_in_date,
        check_out_date=payload.check_out_date,
        requested_room_id=payload.requested_room_id or reservation.assigned_room_id,
        include_current_reservation_rows=True,
    )
    current_rows = _reservation_inventory_rows(reservation.id)
    for row in current_rows:
        row.availability_status = "available"
        row.reservation_id = None
        row.nightly_rate = None
        row.updated_by_user_id = actor_user_id

    reservation.check_in_date = payload.check_in_date
    reservation.check_out_date = payload.check_out_date
    reservation.adults = payload.adults
    reservation.children = payload.children
    reservation.extra_guests = payload.extra_guests
    reservation.assigned_room_id = candidate_room.id
    reservation.quoted_room_total = quote.room_total
    reservation.quoted_tax_total = quote.tax_total
    reprice_reservation_extras(reservation, actor_user_id=actor_user_id)
    post_reservation_extras_to_folio(reservation, actor_user_id=actor_user_id)
    new_grand_total = recompute_reservation_grand_total(reservation)
    reservation.deposit_required_amount = calculate_deposit_required(payload.check_in_date, payload.check_out_date, new_grand_total)
    reservation.updated_by_user_id = actor_user_id

    _allocate_inventory_range(
        reservation=reservation,
        room=candidate_room,
        nightly_rates=quote.nightly_rates,
        actor_user_id=actor_user_id,
    )
    db.session.add(
        ReservationStatusHistory(
            reservation_id=reservation.id,
            old_status=before_data["status"],
            new_status=reservation.current_status,
            reason="stay_dates_changed",
            note="Stay dates repriced by staff",
            changed_by_user_id=actor_user_id,
        )
    )
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="reservations",
        entity_id=str(reservation.id),
        action="staff_stay_dates_changed",
        before_data=before_data,
        after_data=reservation_snapshot(reservation),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="reservation.dates_changed",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={
            "reservation_code": reservation.reservation_code,
            "room_changed": previous_room_id != candidate_room.id,
            "grand_total": str(reservation.quoted_grand_total),
        },
    )
    notification_delivery_ids = queue_modification_confirmation(
        reservation,
        actor_user_id=actor_user_id,
        summary=(
            f"Stay updated from {before_check_in.isoformat()} to {before_check_out.isoformat()} "
            f"to {reservation.check_in_date.isoformat()} to {reservation.check_out_date.isoformat()}; "
            f"occupancy {before_adults}/{before_children}/{before_extra_guests} "
            f"to {reservation.adults}/{reservation.children}/{reservation.extra_guests}."
        ),
        language_code=reservation.booking_language,
        manual=False,
    )
    db.session.commit()
    try:
        dispatch_notification_deliveries(notification_delivery_ids)
    except Exception:  # noqa: BLE001
        _log.exception("dispatch_notification_deliveries failed after reservation modification")
    return {
        "reservation": reservation,
        "room_changed": previous_room_id != candidate_room.id,
        "old_total": Decimal(before_data["quoted_grand_total"]),
        "new_total": Decimal(str(reservation.quoted_grand_total)),
    }


def assign_room(
    reservation_id: uuid.UUID,
    room_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID,
    reason: str | None = None,
    commit: bool = True,
) -> Reservation:
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    if reservation.current_status not in {"tentative", "confirmed", "checked_in"}:
        raise ValueError("This reservation cannot be reassigned right now.")
    room = db.session.get(Room, room_id)
    if not room:
        raise ValueError("Selected room was not found.")
    if room.room_type_id != reservation.room_type_id:
        raise ValueError("Room assignment must stay within the booked room type.")

    if reservation.assigned_room_id == room.id:
        return reservation

    effective_start = max(date.today(), reservation.check_in_date) if reservation.current_status == "checked_in" else reservation.check_in_date
    if effective_start >= reservation.check_out_date:
        raise ValueError("No future inventory remains to reassign.")
    current_rows = _reservation_inventory_rows(reservation.id, start_date=effective_start)
    target_rows = _base._lock_inventory_rows(room.id, effective_start, reservation.check_out_date)
    if room_has_external_block(room.id, effective_start, reservation.check_out_date, for_update=True):
        raise ValueError("Selected room is blocked by an external calendar sync.")
    if len(target_rows) != (reservation.check_out_date - effective_start).days:
        raise ValueError("Selected room is not available for the full remaining stay.")
    if not all(inventory_row_can_allocate(row) for row in target_rows):
        raise ValueError("Selected room is not available for the full remaining stay.")

    before_data = reservation_snapshot(reservation)
    if current_rows:
        rate_lookup = {row.business_date: row.nightly_rate for row in current_rows}
    else:
        quote = quote_reservation(
            room_type=reservation.room_type,
            check_in_date=reservation.check_in_date,
            check_out_date=reservation.check_out_date,
            adults=reservation.adults + reservation.extra_guests,
            children=reservation.children,
        )
        rate_lookup = {
            business_date: nightly_rate
            for business_date, nightly_rate in quote.nightly_rates
            if business_date >= effective_start
        }
    for row in current_rows:
        row.availability_status = "available"
        row.reservation_id = None
        row.nightly_rate = None
        row.updated_by_user_id = actor_user_id
    for row in target_rows:
        row.availability_status = "occupied" if reservation.current_status == "checked_in" else "reserved"
        row.reservation_id = reservation.id
        row.nightly_rate = rate_lookup.get(row.business_date)
        row.updated_by_user_id = actor_user_id

    reservation.assigned_room_id = room.id
    reservation.updated_by_user_id = actor_user_id
    db.session.add(
        ReservationStatusHistory(
            reservation_id=reservation.id,
            old_status=reservation.current_status,
            new_status=reservation.current_status,
            reason="room_changed",
            note=f"Room changed to {room.room_number}" + (f" ({clean_optional(reason, limit=120)})" if reason else ""),
            changed_by_user_id=actor_user_id,
        )
    )
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="reservations",
        entity_id=str(reservation.id),
        action="staff_room_changed",
        before_data=before_data,
        after_data=reservation_snapshot(reservation),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="reservation.room_changed",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={
            "reservation_code": reservation.reservation_code,
            "room_number": room.room_number,
            "reason": clean_optional(reason, limit=120),
        },
    )
    if commit:
        db.session.commit()
    return reservation


def cancel_reservation_workspace(
    reservation_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID,
    reason: str,
) -> Reservation:
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    if reservation.current_status not in {"tentative", "confirmed"}:
        raise ValueError("Only tentative or confirmed reservations can be cancelled here.")

    before_data = reservation_snapshot(reservation)
    rows = _reservation_inventory_rows(reservation.id)
    for row in rows:
        row.availability_status = "available"
        row.reservation_id = None
        row.nightly_rate = None
        row.updated_by_user_id = actor_user_id

    reservation.current_status = "cancelled"
    reservation.cancelled_at = utc_now()
    reservation.cancellation_reason = clean_optional(reason, limit=255) or "staff_cancelled"
    reservation.updated_by_user_id = actor_user_id
    db.session.add(
        ReservationStatusHistory(
            reservation_id=reservation.id,
            old_status=before_data["status"],
            new_status="cancelled",
            reason=reservation.cancellation_reason,
            note="Cancelled via reservation workspace",
            changed_by_user_id=actor_user_id,
        )
    )
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="reservations",
        entity_id=str(reservation.id),
        action="staff_cancelled",
        before_data=before_data,
        after_data=reservation_snapshot(reservation),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="reservation.cancelled",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"reservation_code": reservation.reservation_code, "reason": reservation.cancellation_reason},
    )
    notification_delivery_ids = queue_cancellation_confirmation(
        reservation,
        actor_user_id=actor_user_id,
        language_code=reservation.booking_language,
    )
    db.session.commit()
    try:
        dispatch_notification_deliveries(notification_delivery_ids)
    except Exception:  # noqa: BLE001
        _log.exception("dispatch_notification_deliveries failed after reservation cancellation")
    return reservation


def add_reservation_note(
    reservation_id: uuid.UUID,
    payload: ReservationNotePayload,
    *,
    actor_user_id: uuid.UUID,
) -> ReservationNote:
    reservation = _load_reservation(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    note_text = (payload.note_text or "").strip()
    if not note_text:
        raise ValueError("A note is required.")
    note = ReservationNote(
        reservation_id=reservation.id,
        note_text=note_text[:2000],
        note_type=payload.note_type,
        is_important=payload.is_important,
        visibility_scope=payload.visibility_scope,
        created_by_user_id=actor_user_id,
    )
    db.session.add(note)
    db.session.flush()
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="reservation_notes",
        entity_id=str(note.id),
        action="create",
        after_data={"reservation_id": str(reservation.id), "note_type": note.note_type, "is_important": note.is_important},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="reservation.note_added",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"reservation_code": reservation.reservation_code, "note_type": note.note_type},
    )
    db.session.commit()
    return note


def resend_confirmation(reservation_id: uuid.UUID, *, actor_user_id: uuid.UUID, language: str | None = None) -> EmailOutbox:
    reservation = _load_reservation(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    guest = reservation.primary_guest
    if not guest or not guest.email:
        raise ValueError("This reservation does not have a guest email address.")

    recent_send = (
        db.session.execute(
            sa.select(EmailOutbox)
            .where(
                EmailOutbox.reservation_id == reservation.id,
                EmailOutbox.email_type == "guest_confirmation",
            )
            .order_by(EmailOutbox.created_at.desc())
        )
        .scalars()
        .first()
    )
    if recent_send and recent_send.created_at >= utc_now() - timedelta(minutes=5):
        raise ValueError("A confirmation was already sent recently. Please wait before resending.")

    selected_language = language or reservation.booking_language or guest.preferred_language or "th"
    notification_delivery_ids = queue_reservation_confirmation(
        reservation,
        actor_user_id=actor_user_id,
        language_code=selected_language,
        manual=True,
    )
    if not notification_delivery_ids:
        raise ValueError("Confirmation email could not be queued.")
    delivery_id = notification_delivery_ids[0]
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="notification_deliveries",
        entity_id=str(delivery_id),
        action="guest_confirmation_resend",
        after_data={"reservation_id": str(reservation.id), "recipient_email": guest.email, "language": selected_language},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="reservation.confirmation_resent",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"reservation_code": reservation.reservation_code, "recipient_email": guest.email},
    )
    db.session.commit()
    try:
        dispatch_notification_deliveries(notification_delivery_ids)
    except Exception:  # noqa: BLE001
        _log.exception("dispatch_notification_deliveries failed after resend confirmation")
    delivery = query_notification_history(reservation_id=reservation.id, limit=10)
    for item in delivery:
        if item.id == delivery_id and item.email_outbox_id:
            return db.session.get(EmailOutbox, item.email_outbox_id)
    raise ValueError("Confirmation email outbox entry could not be loaded.")


def approve_modification_request(
    reservation_id: uuid.UUID,
    mod_request_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID,
    internal_note: str = "",
) -> dict:
    mr = db.session.get(ModificationRequest, mod_request_id)
    if not mr or mr.reservation_id != reservation_id:
        raise ValueError("Modification request not found.")
    if mr.status not in ("submitted", "reviewed"):
        raise ValueError("This modification request has already been processed.")
    changes = mr.requested_changes_json or {}
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    new_check_in = _maybe_date(changes.get("requested_check_in", "")) or reservation.check_in_date
    new_check_out = _maybe_date(changes.get("requested_check_out", "")) or reservation.check_out_date
    new_adults = int(changes.get("requested_adults") or reservation.adults)
    new_children = int(changes.get("requested_children") or reservation.children)
    result = change_stay_dates(
        reservation_id,
        StayDateChangePayload(
            check_in_date=new_check_in,
            check_out_date=new_check_out,
            adults=new_adults,
            children=new_children,
            extra_guests=reservation.extra_guests,
        ),
        actor_user_id=actor_user_id,
    )
    mr.status = "approved"
    mr.reviewed_at = utc_now()
    mr.reviewed_by_user_id = actor_user_id
    mr.internal_note = internal_note or None
    db.session.commit()
    return result


def decline_modification_request(
    reservation_id: uuid.UUID,
    mod_request_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID,
    internal_note: str = "",
) -> ModificationRequest:
    mr = db.session.get(ModificationRequest, mod_request_id)
    if not mr or mr.reservation_id != reservation_id:
        raise ValueError("Modification request not found.")
    if mr.status not in ("submitted", "reviewed"):
        raise ValueError("This modification request has already been processed.")
    mr.status = "declined"
    mr.reviewed_at = utc_now()
    mr.reviewed_by_user_id = actor_user_id
    mr.internal_note = internal_note or None
    db.session.commit()
    return mr
