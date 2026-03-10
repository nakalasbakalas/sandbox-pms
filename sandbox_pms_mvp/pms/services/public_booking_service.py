from __future__ import annotations

import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256

import sqlalchemy as sa
from flask import current_app
from sqlalchemy.exc import IntegrityError

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..constants import BOOKING_LANGUAGES, BOOKING_SOURCE_CHANNELS
from ..extensions import db
from ..i18n import normalize_language, t
from ..models import (
    CancellationRequest,
    Guest,
    InventoryDay,
    ModificationRequest,
    Reservation,
    ReservationHold,
    ReservationReviewQueue,
    ReservationStatusHistory,
    Room,
    RoomType,
)
from ..pricing import QuoteResult, get_setting_value, quote_reservation
from .admin_service import assert_blackout_allows_booking, policy_text, render_notification_template
from .communication_service import (
    dispatch_notification_deliveries,
    queue_cancellation_confirmation,
    queue_cancellation_request_received,
    queue_internal_activity_alert,
    queue_modification_request_received,
    queue_reservation_confirmation,
    queue_staff_new_booking_alert,
)
from .reservation_service import (
    calculate_deposit_required,
    create_or_get_guest,
    next_reservation_code,
    validate_occupancy,
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@dataclass
class PublicSearchPayload:
    check_in_date: date
    check_out_date: date
    adults: int
    children: int
    room_type_id: uuid.UUID | None = None
    language: str = "th"


@dataclass
class HoldRequestPayload:
    check_in_date: date
    check_out_date: date
    adults: int
    children: int
    room_type_id: uuid.UUID
    guest_email: str | None
    idempotency_key: str
    language: str
    source_channel: str
    source_metadata: dict | None
    request_ip: str | None
    user_agent: str | None
    extra_guests: int = 0


@dataclass
class PublicBookingPayload:
    hold_code: str
    idempotency_key: str
    first_name: str
    last_name: str
    phone: str
    email: str
    special_requests: str | None
    language: str
    source_channel: str
    source_metadata: dict | None
    terms_accepted: bool
    terms_version: str


@dataclass
class VerificationRequestPayload:
    booking_reference: str
    contact_value: str
    language: str
    request_ip: str | None
    user_agent: str | None
    reason: str | None = None
    requested_changes: dict | None = None


def stay_dates(check_in_date: date, check_out_date: date) -> list[date]:
    cursor = check_in_date
    nights: list[date] = []
    while cursor < check_out_date:
        nights.append(cursor)
        cursor += timedelta(days=1)
    return nights


def normalize_email(value: str | None) -> str | None:
    return (value or "").strip().lower() or None


def normalize_phone(value: str | None) -> str | None:
    raw = "".join(ch for ch in (value or "") if ch.isdigit() or ch == "+").strip()
    return raw or None


def mask_contact(value: str | None) -> str | None:
    if not value:
        return None
    if "@" in value:
        name, domain = value.split("@", 1)
        return f"{name[:2]}***@{domain}"
    return f"{value[:3]}***{value[-2:]}" if len(value) > 5 else "***"


def hash_contact(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()


def public_source_channel(value: str | None) -> str:
    if value in BOOKING_SOURCE_CHANNELS:
        return value
    return "direct_web"


def cleanup_expired_holds() -> None:
    now = utc_now()
    expired_holds = (
        db.session.execute(
            sa.select(ReservationHold).where(ReservationHold.status == "active").with_for_update()
        )
        .scalars()
        .all()
    )
    for hold in expired_holds:
        if not as_utc(hold.expires_at) or as_utc(hold.expires_at) > now:
            continue
        hold.status = "expired"
        inventory_rows = (
            db.session.execute(
                sa.select(InventoryDay).where(InventoryDay.hold_id == hold.id).with_for_update()
            )
            .scalars()
            .all()
        )
        for row in inventory_rows:
            row.availability_status = "available"
            row.hold_id = None
            row.nightly_rate = None


def validate_public_search(payload: PublicSearchPayload) -> RoomType | None:
    if payload.check_in_date >= payload.check_out_date:
        raise ValueError(t(payload.language, "invalid_dates"))
    if payload.adults < 1 or payload.children < 0:
        raise ValueError(t(payload.language, "invalid_occupancy"))
    assert_blackout_allows_booking(payload.check_in_date, payload.check_out_date)
    room_type = db.session.get(RoomType, payload.room_type_id) if payload.room_type_id else None
    if room_type:
        validate_occupancy(room_type, payload.adults, payload.children)
    return room_type


def get_live_available_rooms(
    *,
    room_type_id: uuid.UUID | None,
    check_in_date: date,
    check_out_date: date,
) -> list[Room]:
    nights = stay_dates(check_in_date, check_out_date)
    candidate_query = Room.query.filter_by(is_active=True, is_sellable=True).order_by(Room.room_number.asc())
    if room_type_id:
        candidate_query = candidate_query.filter_by(room_type_id=room_type_id)
    candidates = candidate_query.all()
    available_rooms: list[Room] = []
    for room in candidates:
        rows = (
            db.session.execute(
                sa.select(InventoryDay)
                .where(
                    InventoryDay.room_id == room.id,
                    InventoryDay.business_date.in_(nights),
                )
            )
            .scalars()
            .all()
        )
        if len(rows) != len(nights):
            continue
        if all(
            row.is_sellable
            and not getattr(row, "is_blocked", False)
            and row.availability_status == "available"
            and row.hold_id is None
            for row in rows
        ):
            available_rooms.append(room)
    return available_rooms


def search_public_availability(payload: PublicSearchPayload) -> list[dict]:
    payload.language = normalize_language(payload.language)
    room_type = validate_public_search(payload)
    cleanup_expired_holds()
    db.session.flush()

    room_types = [room_type] if room_type else RoomType.query.filter_by(is_active=True).order_by(RoomType.code.asc()).all()
    results: list[dict] = []
    for item in room_types:
        validate_occupancy(item, payload.adults, payload.children)
        rooms = get_live_available_rooms(
            room_type_id=item.id,
            check_in_date=payload.check_in_date,
            check_out_date=payload.check_out_date,
        )
        if not rooms:
            continue
        quote = quote_reservation(
            room_type=item,
            check_in_date=payload.check_in_date,
            check_out_date=payload.check_out_date,
            adults=payload.adults,
            children=payload.children,
        )
        results.append(
            {
                "room_type": item,
                "available_rooms": len(rooms),
                "quote": quote,
                "policy_summary": policy_text("cancellation_policy", payload.language, t(payload.language, "policy_summary")),
                "extra_guest_summary": policy_text("child_extra_guest_policy", payload.language, t(payload.language, "extra_guest_summary")),
                "checkin_summary": policy_text("check_in_policy", payload.language, t(payload.language, "checkin_summary")),
            }
        )
    return results


def _check_public_rate_limit(request_ip: str | None, *, limit: int, mode: str = "booking") -> None:
    if not request_ip:
        return
    window_start = utc_now() - timedelta(minutes=current_app.config["PUBLIC_BOOKING_RATE_LIMIT_WINDOW_MINUTES"])
    if mode == "booking":
        count = (
            db.session.execute(
                sa.select(sa.func.count())
                .select_from(ReservationHold)
                .where(ReservationHold.request_ip == request_ip, ReservationHold.created_at >= window_start)
            )
            .scalar_one()
        )
    else:
        cancellation_count = (
            db.session.execute(
                sa.select(sa.func.count())
                .select_from(CancellationRequest)
                .where(CancellationRequest.request_ip == request_ip, CancellationRequest.requested_at >= window_start)
            )
            .scalar_one()
        )
        modification_count = (
            db.session.execute(
                sa.select(sa.func.count())
                .select_from(ModificationRequest)
                .where(ModificationRequest.request_ip == request_ip, ModificationRequest.requested_at >= window_start)
            )
            .scalar_one()
        )
        count = cancellation_count + modification_count
    if count >= limit:
        raise ValueError("Too many booking attempts. Please wait a moment and try again.")


def create_reservation_hold(payload: HoldRequestPayload) -> ReservationHold:
    payload.language = normalize_language(payload.language)
    _check_public_rate_limit(payload.request_ip, limit=current_app.config["PUBLIC_BOOKING_RATE_LIMIT_COUNT"])
    room_type = validate_public_search(
        PublicSearchPayload(
            check_in_date=payload.check_in_date,
            check_out_date=payload.check_out_date,
            adults=payload.adults + payload.extra_guests,
            children=payload.children,
            room_type_id=payload.room_type_id,
            language=payload.language,
        )
    )
    cleanup_expired_holds()
    existing = ReservationHold.query.filter_by(idempotency_key=payload.idempotency_key).first()
    if existing:
        if existing.status == "converted" and existing.converted_reservation_id:
            return existing
        if existing.status == "active" and as_utc(existing.expires_at) and as_utc(existing.expires_at) > utc_now():
            return existing

    if payload.guest_email:
        matching_hold = (
            ReservationHold.query.filter_by(
                guest_email=normalize_email(payload.guest_email),
                room_type_id=payload.room_type_id,
                check_in_date=payload.check_in_date,
                check_out_date=payload.check_out_date,
                status="active",
            )
            .order_by(ReservationHold.created_at.desc())
            .first()
        )
        if matching_hold and as_utc(matching_hold.expires_at) and as_utc(matching_hold.expires_at) > utc_now():
            return matching_hold

    quote = quote_reservation(
        room_type=room_type,
        check_in_date=payload.check_in_date,
        check_out_date=payload.check_out_date,
        adults=payload.adults + payload.extra_guests,
        children=payload.children,
    )

    for _ in range(5):
        try:
            return _create_hold_once(payload, room_type, quote)
        except IntegrityError:
            db.session.rollback()
    raise ValueError(t(payload.language, "room_unavailable"))


def _create_hold_once(payload: HoldRequestPayload, room_type: RoomType, quote: QuoteResult) -> ReservationHold:
    nights = stay_dates(payload.check_in_date, payload.check_out_date)
    rooms = Room.query.filter_by(room_type_id=room_type.id, is_active=True, is_sellable=True).order_by(Room.room_number.asc()).all()
    now = utc_now()
    expires_at = now + timedelta(minutes=current_app.config["PUBLIC_BOOKING_HOLD_MINUTES"])
    for room in rooms:
        rows = (
            db.session.execute(
                sa.select(InventoryDay)
                .where(InventoryDay.room_id == room.id, InventoryDay.business_date.in_(nights))
                .with_for_update()
            )
            .scalars()
            .all()
        )
        if len(rows) != len(nights):
            continue
        if not all(
            row.is_sellable
            and not getattr(row, "is_blocked", False)
            and row.availability_status == "available"
            and row.hold_id is None
            for row in rows
        ):
            continue
        hold = ReservationHold(
            hold_code=f"HLD-{secrets.token_hex(4).upper()}",
            room_type_id=room_type.id,
            assigned_room_id=room.id,
            guest_email=normalize_email(payload.guest_email),
            check_in_date=payload.check_in_date,
            check_out_date=payload.check_out_date,
            adults=payload.adults,
            children=payload.children,
            extra_guests=payload.extra_guests,
            source_channel=public_source_channel(payload.source_channel),
            booking_language=payload.language,
            source_metadata_json=payload.source_metadata,
            idempotency_key=payload.idempotency_key,
            status="active",
            expires_at=expires_at,
            request_ip=payload.request_ip,
            user_agent=payload.user_agent,
            quoted_room_total=quote.room_total,
            quoted_tax_total=quote.tax_total,
            quoted_grand_total=quote.grand_total,
        )
        db.session.add(hold)
        db.session.flush()
        rate_lookup = {business_date: nightly_rate for business_date, nightly_rate in quote.nightly_rates}
        for row in rows:
            row.availability_status = "held"
            row.hold_id = hold.id
            row.nightly_rate = rate_lookup[row.business_date]
        write_activity_log(
            actor_user_id=None,
            event_type="booking.hold_created",
            entity_table="reservation_holds",
            entity_id=str(hold.id),
            metadata={"hold_code": hold.hold_code, "source_channel": hold.source_channel},
        )
        db.session.commit()
        return hold
    raise ValueError(t(payload.language, "room_unavailable"))


def _duplicate_reservation(payload: PublicBookingPayload, hold: ReservationHold) -> Reservation | None:
    window_start = utc_now() - timedelta(minutes=15)
    email = normalize_email(payload.email)
    phone = normalize_phone(payload.phone)
    guest_ids = [
        item.id
        for item in Guest.query.filter(
            sa.or_(Guest.email == email, Guest.phone == phone),
            Guest.deleted_at.is_(None),
        ).all()
    ]
    if not guest_ids:
        return None
    return (
        Reservation.query.filter(
            Reservation.primary_guest_id.in_(guest_ids),
            Reservation.check_in_date == hold.check_in_date,
            Reservation.check_out_date == hold.check_out_date,
            Reservation.room_type_id == hold.room_type_id,
            Reservation.quoted_grand_total == hold.quoted_grand_total,
            Reservation.source_channel == public_source_channel(payload.source_channel),
            Reservation.booked_at >= window_start,
            Reservation.current_status.in_(["tentative", "confirmed", "checked_in"]),
        )
        .order_by(Reservation.booked_at.desc())
        .first()
    )


def confirm_public_booking(payload: PublicBookingPayload) -> Reservation:
    payload.language = normalize_language(payload.language)
    if not payload.terms_accepted:
        raise ValueError(t(payload.language, "terms_required"))
    if "@" not in payload.email:
        raise ValueError("Valid email is required.")
    if not normalize_phone(payload.phone):
        raise ValueError("Valid mobile phone is required.")
    if len((payload.special_requests or "")) > 500:
        raise ValueError("Special requests are too long.")

    cleanup_expired_holds()
    db.session.flush()
    hold = (
        db.session.execute(
            sa.select(ReservationHold)
            .where(ReservationHold.hold_code == payload.hold_code)
            .with_for_update()
        )
        .scalar_one_or_none()
    )
    if not hold or hold.idempotency_key != payload.idempotency_key:
        raise ValueError(t(payload.language, "hold_expired"))
    if hold.status == "converted" and hold.converted_reservation_id:
        existing = db.session.get(Reservation, hold.converted_reservation_id)
        if existing:
            return existing
    if hold.status != "active" or not as_utc(hold.expires_at) or as_utc(hold.expires_at) <= utc_now():
        hold.status = "expired"
        db.session.flush()
        raise ValueError(t(payload.language, "hold_expired"))

    duplicate = _duplicate_reservation(payload, hold)
    if duplicate:
        duplicate.duplicate_suspected = True
        db.session.commit()
        return duplicate

    quote = QuoteResult(
        room_total=Decimal(str(hold.quoted_room_total)),
        tax_total=Decimal(str(hold.quoted_tax_total)),
        grand_total=Decimal(str(hold.quoted_grand_total)),
        nightly_rates=[],
    )
    guest_payload = type(
        "GuestPayload",
        (),
        {
            "first_name": payload.first_name,
            "last_name": payload.last_name,
            "phone": normalize_phone(payload.phone),
            "email": normalize_email(payload.email),
        },
    )()
    guest = create_or_get_guest(guest_payload, None)
    reservation = Reservation(
        reservation_code=next_reservation_code(),
        primary_guest_id=guest.id,
        room_type_id=hold.room_type_id,
        assigned_room_id=hold.assigned_room_id,
        current_status="tentative" if quote.grand_total > Decimal("0.00") else "confirmed",
        source_channel=public_source_channel(payload.source_channel),
        check_in_date=hold.check_in_date,
        check_out_date=hold.check_out_date,
        adults=hold.adults,
        children=hold.children,
        extra_guests=hold.extra_guests,
        special_requests=(payload.special_requests or "").strip() or None,
        quoted_room_total=quote.room_total,
        quoted_tax_total=quote.tax_total,
        quoted_grand_total=quote.grand_total,
        deposit_required_amount=calculate_deposit_required(hold.check_in_date, hold.check_out_date, quote.grand_total),
        deposit_received_amount=Decimal("0.00"),
        created_from_public_booking_flow=True,
        booking_language=payload.language,
        source_metadata_json=payload.source_metadata,
        duplicate_suspected=False,
        terms_accepted_at=utc_now(),
        terms_version=payload.terms_version,
        public_confirmation_token=secrets.token_urlsafe(24),
        booked_at=utc_now(),
    )
    db.session.add(reservation)
    db.session.flush()
    notification_delivery_ids: list[uuid.UUID] = []

    rows = (
        db.session.execute(
            sa.select(InventoryDay)
            .where(InventoryDay.hold_id == hold.id)
            .with_for_update()
        )
        .scalars()
        .all()
    )
    if len(rows) != len(stay_dates(hold.check_in_date, hold.check_out_date)):
        raise ValueError(t(payload.language, "room_unavailable"))
    for row in rows:
        if row.availability_status != "held":
            raise ValueError(t(payload.language, "room_unavailable"))
        row.availability_status = "reserved"
        row.reservation_id = reservation.id
        row.hold_id = None

    hold.status = "converted"
    hold.converted_reservation_id = reservation.id
    db.session.add(
        ReservationStatusHistory(
            reservation_id=reservation.id,
            old_status=None,
            new_status=reservation.current_status,
            reason="public_booking_created",
            note="Created via public booking flow",
            changed_by_user_id=None,
        )
    )
    review_entry = ReservationReviewQueue(
        reservation_id=reservation.id,
        review_status="new",
        deposit_state="deposit_pending" if reservation.deposit_required_amount > 0 else "no_deposit",
        flagged_duplicate_suspected=reservation.duplicate_suspected,
        special_requests_present=bool(reservation.special_requests),
    )
    db.session.add(review_entry)
    notification_delivery_ids.extend(
        queue_reservation_confirmation(
            reservation,
            actor_user_id=None,
            language_code=payload.language,
            manual=False,
        )
    )
    notification_delivery_ids.extend(
        queue_staff_new_booking_alert(
            reservation,
            actor_user_id=None,
        )
    )
    write_audit_log(
        actor_user_id=None,
        entity_table="reservations",
        entity_id=str(reservation.id),
        action="public_booking_create",
        after_data={
            "reservation_code": reservation.reservation_code,
            "source_channel": reservation.source_channel,
            "booking_language": reservation.booking_language,
        },
    )
    write_activity_log(
        actor_user_id=None,
        event_type="booking.public_confirmed",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"reservation_code": reservation.reservation_code},
    )
    db.session.commit()
    dispatch_notification_deliveries(notification_delivery_ids)
    return reservation


def render_guest_confirmation_email(reservation: Reservation, guest_name: str, language: str) -> str:
    return render_guest_confirmation_message(reservation, guest_name, language)[1]


def render_guest_confirmation_message(reservation: Reservation, guest_name: str, language: str) -> tuple[str, str]:
    context = {
        "hotel_name": str(get_setting_value("hotel.name", "Sandbox Hotel")),
        "guest_name": guest_name,
        "reservation_code": reservation.reservation_code,
        "check_in_date": reservation.check_in_date.isoformat(),
        "check_out_date": reservation.check_out_date.isoformat(),
        "room_type_name": reservation.room_type.name if reservation.room_type else "Room",
        "grand_total": f"{Decimal(str(reservation.quoted_grand_total)):,.2f}",
        "deposit_amount": f"{Decimal(str(reservation.deposit_required_amount or 0)):,.2f}",
        "contact_phone": str(get_setting_value("hotel.contact_phone", "+66 000 000 000")),
        "contact_email": str(get_setting_value("hotel.contact_email", "reservations@sandbox-hotel.local")),
        "cancellation_policy": policy_text("cancellation_policy", language, t(language, "policy_summary")),
        "check_in_policy": policy_text("check_in_policy", language, t(language, "checkin_summary")),
        "check_out_policy": policy_text("check_out_policy", language, ""),
    }
    fallback_subject = t(language, "guest_email_subject", reference=reservation.reservation_code)
    fallback_body = "\n".join(
        [
            f"{context['hotel_name']} - {reservation.reservation_code}",
            guest_name,
            f"{reservation.check_in_date} to {reservation.check_out_date}",
            f"Total THB {context['grand_total']}",
            context["cancellation_policy"],
            context["check_in_policy"],
            f"Contact: {context['contact_phone']}",
        ]
    )
    return render_notification_template(
        "guest_confirmation",
        language,
        context,
        fallback_subject=fallback_subject,
        fallback_body=fallback_body,
    )


def load_public_confirmation(reservation_code: str, token: str) -> Reservation | None:
    reservation = Reservation.query.filter_by(reservation_code=reservation_code, created_from_public_booking_flow=True).first()
    if not reservation or not reservation.public_confirmation_token:
        return None
    if not hmac.compare_digest(reservation.public_confirmation_token, token):
        return None
    return reservation


def submit_cancellation_request(payload: VerificationRequestPayload) -> CancellationRequest | None:
    _check_public_rate_limit(
        payload.request_ip,
        limit=current_app.config["PUBLIC_LOOKUP_RATE_LIMIT_COUNT"],
        mode="lookup",
    )
    reservation = _verified_public_reservation(payload.booking_reference, payload.contact_value)
    if not reservation:
        return None
    existing = CancellationRequest.query.filter_by(
        booking_reference=payload.booking_reference,
        requester_contact_hash=hash_contact(payload.contact_value.strip().lower()),
        status="submitted",
    ).first()
    if existing:
        return existing
    notification_delivery_ids: list[uuid.UUID] = []
    request_row = CancellationRequest(
        reservation_id=reservation.id,
        request_code=f"CAN-{secrets.token_hex(4).upper()}",
        booking_reference=payload.booking_reference,
        requester_contact_hash=hash_contact(payload.contact_value.strip().lower()),
        requester_contact_hint=mask_contact(payload.contact_value),
        status="submitted",
        reason=(payload.reason or "").strip() or None,
        request_ip=payload.request_ip,
        user_agent=payload.user_agent,
    )
    db.session.add(request_row)
    eligible = reservation.check_in_date > (date.today() + timedelta(hours=24 / 24))
    previous_status = reservation.current_status
    if eligible and reservation.current_status in {"tentative", "confirmed"}:
        reservation.current_status = "cancelled"
        reservation.cancelled_at = utc_now()
        reservation.cancellation_reason = "public_cancellation_request_auto"
        rows = (
            db.session.execute(
                sa.select(InventoryDay).where(InventoryDay.reservation_id == reservation.id).with_for_update()
            )
            .scalars()
            .all()
        )
        for row in rows:
            row.availability_status = "available"
            row.reservation_id = None
            row.nightly_rate = None
        db.session.add(
            ReservationStatusHistory(
                reservation_id=reservation.id,
                old_status=previous_status,
                new_status="cancelled",
                reason="public_cancellation_request_auto",
                note="Auto-processed via public flow",
            )
        )
        request_row.status = "auto_processed"
        request_row.processed_at = utc_now()
    else:
        request_row.status = "needs_review"
    notification_delivery_ids.extend(
        queue_internal_activity_alert(
            reservation,
            actor_user_id=None,
            summary=f"Cancellation request {request_row.request_code} received for {reservation.reservation_code}.",
            event_code="reservation.cancellation_request",
            manual=False,
        )
    )
    if request_row.status == "auto_processed":
        notification_delivery_ids.extend(
            queue_cancellation_confirmation(
                reservation,
                actor_user_id=None,
                language_code=payload.language,
            )
        )
    else:
        notification_delivery_ids.extend(
            queue_cancellation_request_received(
                reservation,
                actor_user_id=None,
                request_code=request_row.request_code,
                language_code=payload.language,
            )
        )
    db.session.commit()
    dispatch_notification_deliveries(notification_delivery_ids)
    return request_row


def submit_modification_request(payload: VerificationRequestPayload) -> ModificationRequest | None:
    _check_public_rate_limit(
        payload.request_ip,
        limit=current_app.config["PUBLIC_LOOKUP_RATE_LIMIT_COUNT"],
        mode="lookup",
    )
    reservation = _verified_public_reservation(payload.booking_reference, payload.contact_value)
    if not reservation:
        return None
    notification_delivery_ids: list[uuid.UUID] = []
    request_row = ModificationRequest(
        reservation_id=reservation.id,
        request_code=f"MOD-{secrets.token_hex(4).upper()}",
        requested_changes_json=payload.requested_changes or {},
        requester_contact_hash=hash_contact(payload.contact_value.strip().lower()),
        requester_contact_hint=mask_contact(payload.contact_value),
        status="submitted",
        request_ip=payload.request_ip,
        user_agent=payload.user_agent,
    )
    db.session.add(request_row)
    notification_delivery_ids.extend(
        queue_internal_activity_alert(
            reservation,
            actor_user_id=None,
            summary=f"Modification request {request_row.request_code} received for {reservation.reservation_code}.",
            event_code="reservation.modification_request",
            manual=False,
        )
    )
    notification_delivery_ids.extend(
        queue_modification_request_received(
            reservation,
            actor_user_id=None,
            request_code=request_row.request_code,
            language_code=payload.language,
        )
    )
    db.session.commit()
    dispatch_notification_deliveries(notification_delivery_ids)
    return request_row


def _verified_public_reservation(booking_reference: str, contact_value: str) -> Reservation | None:
    normalized_email = normalize_email(contact_value)
    normalized_phone = normalize_phone(contact_value)
    reservation = Reservation.query.filter_by(reservation_code=booking_reference).first()
    if not reservation:
        return None
    guest = db.session.get(Guest, reservation.primary_guest_id)
    if not guest:
        return None
    if normalized_email and guest.email and normalized_email == guest.email.lower():
        return reservation
    if normalized_phone and guest.phone and normalized_phone == normalize_phone(guest.phone):
        return reservation
    return None
