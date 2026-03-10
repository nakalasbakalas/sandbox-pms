from __future__ import annotations

import hashlib
import json
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import sqlalchemy as sa
from flask import current_app
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from ..extensions import db
from ..i18n import normalize_language
from ..models import (
    EmailOutbox,
    NotificationDelivery,
    PaymentRequest,
    Reservation,
    StaffNotification,
)
from ..pricing import get_setting_value
from .admin_service import get_notification_template_variant, policy_text, render_notification_template
from .notification_service import deliver_email_outbox_entry


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def money(value) -> Decimal:
    return Decimal(str(value or "0.00")).quantize(Decimal("0.01"))


def _string_setting(key: str, default: str) -> str:
    return str(get_setting_value(key, default) or default)


def _bool_setting(key: str, default: bool) -> bool:
    value = get_setting_value(key, default)
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _int_setting(key: str, default: int) -> int:
    value = get_setting_value(key, default)
    return int(str(value or default))


def _format_datetime(value: datetime | None) -> str:
    if not value:
        return "-"
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _make_key(prefix: str, *parts: object) -> str:
    raw = ":".join([prefix, *[str(part) for part in parts if part not in {None, ""}]])
    if len(raw) <= 150:
        return raw
    return f"{prefix}:{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:20]}"


def _manual_suffix(manual: bool) -> str:
    return utc_now().strftime("%Y%m%d%H%M%S%f") if manual else "auto"


def _staff_alert_recipients() -> list[str]:
    configured = _string_setting("notifications.staff_alert_recipients", "")
    value = configured or ",".join(current_app.config.get("STAFF_ALERT_EMAILS", []))
    return [item.strip().lower() for item in value.split(",") if item.strip()]


def _brand_context() -> dict[str, str]:
    return {
        "hotel_name": _string_setting("hotel.name", "Sandbox Hotel"),
        "hotel_logo_url": _string_setting("hotel.logo_url", ""),
        "hotel_address": _string_setting("hotel.address", "Sandbox Hotel, Thailand"),
        "hotel_check_in_time": _string_setting("hotel.check_in_time", "14:00"),
        "hotel_check_out_time": _string_setting("hotel.check_out_time", "11:00"),
        "contact_phone": _string_setting("hotel.contact_phone", "+66 000 000 000"),
        "contact_email": _string_setting("hotel.contact_email", "reservations@sandbox-hotel.local"),
    }


def _reservation_language(reservation: Reservation, fallback: str = "en") -> str:
    guest = reservation.primary_guest
    preferred = guest.preferred_language if guest else None
    return normalize_language(reservation.booking_language or preferred or fallback)


def _occupancy_summary(reservation: Reservation) -> str:
    return f"{reservation.adults} adults / {reservation.children} children / {reservation.extra_guests} extra"


def _payment_state_for_reservation(reservation: Reservation) -> str:
    required = money(reservation.deposit_required_amount)
    received = money(reservation.deposit_received_amount)
    if required <= Decimal("0.00"):
        return "not_required"
    if received >= required:
        return "paid"
    if received > Decimal("0.00"):
        return "partial"
    return "pending"


def _payment_entry_url(payment_request: PaymentRequest, reservation: Reservation) -> str:
    base_url = str(current_app.config.get("APP_BASE_URL") or "").strip().rstrip("/")
    if not base_url:
        raise RuntimeError("APP_BASE_URL must be configured for guest payment links.")
    query = urllib.parse.urlencode(
        {
            "reservation_code": reservation.reservation_code,
            "token": reservation.public_confirmation_token,
        }
    )
    return f"{base_url}/payments/request/{payment_request.request_code}?{query}"


def _base_reservation_context(reservation: Reservation) -> dict[str, str]:
    guest = reservation.primary_guest
    return {
        **_brand_context(),
        "guest_name": guest.full_name if guest else "Guest",
        "reservation_code": reservation.reservation_code,
        "check_in_date": reservation.check_in_date.isoformat(),
        "check_out_date": reservation.check_out_date.isoformat(),
        "room_type_name": reservation.room_type.name if reservation.room_type else "Room",
        "room_number": reservation.assigned_room.room_number if reservation.assigned_room else "",
        "occupancy_summary": _occupancy_summary(reservation),
        "grand_total": f"{money(reservation.quoted_grand_total):,.2f}",
        "deposit_amount": f"{money(reservation.deposit_required_amount):,.2f}",
        "payment_status": _payment_state_for_reservation(reservation),
        "source_channel": reservation.source_channel or "",
        "cancellation_policy": policy_text("cancellation_policy", _reservation_language(reservation), ""),
        "check_in_policy": policy_text("check_in_policy", _reservation_language(reservation), ""),
        "check_out_policy": policy_text("check_out_policy", _reservation_language(reservation), ""),
        "refund_amount": "0.00",
        "modification_summary": "",
        "notification_summary": "",
        "amount_received": f"{money(reservation.deposit_received_amount):,.2f}",
        "payment_expires_at": "-",
        "payment_link": "",
    }


def _template_description(template_key: str) -> str:
    return template_key.replace("_", " ").title()


def _email_type(template_key: str | None, event_type: str) -> str:
    return template_key or event_type.replace(".", "_")


def _staff_notification_type(event_type: str) -> str:
    legacy_mapping = {
        "booking.new_alert": "new_public_booking",
        "reservation.cancellation_request": "reservation_cancellation_request",
        "reservation.modification_request": "reservation_modification_request",
    }
    return legacy_mapping.get(event_type, event_type.replace(".", "_"))


def _existing_delivery(dedupe_key: str) -> NotificationDelivery | None:
    return NotificationDelivery.query.filter_by(dedupe_key=dedupe_key).first()


def _create_delivery(
    *,
    event_type: str,
    audience_type: str,
    channel: str,
    template_key: str,
    language_code: str,
    reservation: Reservation | None,
    payment_request: PaymentRequest | None,
    recipient_target: str | None,
    recipient_name: str | None,
    dedupe_key: str,
    event_key: str | None,
    context: dict[str, object],
    fallback_subject: str,
    fallback_body: str,
    actor_user_id: uuid.UUID | None,
    metadata: dict | None = None,
) -> NotificationDelivery:
    existing = _existing_delivery(dedupe_key)
    if existing:
        return existing
    template = get_notification_template_variant(template_key, language_code, channel=channel)
    rendered_subject, rendered_body = render_notification_template(
        template_key,
        language_code,
        context,
        fallback_subject=fallback_subject,
        fallback_body=fallback_body,
        channel=channel,
    )
    payload = dict(metadata or {})
    payload.setdefault(
        "template_fallback_used",
        template is None or template.channel != channel or template.language_code != language_code,
    )
    delivery = NotificationDelivery(
        event_type=event_type,
        reservation_id=reservation.id if reservation else None,
        payment_request_id=payment_request.id if payment_request else None,
        audience_type=audience_type,
        channel=channel,
        template_id=template.id if template else None,
        template_key=template_key,
        language_code=language_code,
        recipient_target=recipient_target,
        recipient_name=recipient_name,
        event_key=event_key,
        dedupe_key=dedupe_key,
        status="pending",
        rendered_subject=rendered_subject,
        rendered_body=rendered_body,
        metadata_json=payload,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.session.add(delivery)
    db.session.flush()
    if channel == "email" and recipient_target:
        outbox = EmailOutbox(
            email_type=_email_type(template_key, event_type),
            reservation_id=reservation.id if reservation else None,
            recipient_email=recipient_target,
            subject=rendered_subject or _template_description(template_key),
            body_text=rendered_body or "",
            language=language_code,
            dedupe_key=dedupe_key,
            status="pending",
        )
        db.session.add(outbox)
        db.session.flush()
        delivery.email_outbox_id = outbox.id
    return delivery


def _queue_delivery_safe(**kwargs) -> NotificationDelivery:
    dedupe_key = kwargs["dedupe_key"]
    existing = _existing_delivery(dedupe_key)
    if existing:
        return existing
    try:
        with db.session.begin_nested():
            delivery = _create_delivery(**kwargs)
        db.session.flush()
        return delivery
    except IntegrityError:
        existing = _existing_delivery(dedupe_key)
        if existing:
            return existing
        raise


def _create_invalid_delivery(
    *,
    event_type: str,
    audience_type: str,
    channel: str,
    template_key: str,
    language_code: str,
    reservation: Reservation | None,
    payment_request: PaymentRequest | None,
    recipient_target: str | None,
    recipient_name: str | None,
    dedupe_key: str,
    actor_user_id: uuid.UUID | None,
    failure_category: str,
    failure_reason: str,
    metadata: dict | None = None,
) -> NotificationDelivery:
    existing = _existing_delivery(dedupe_key)
    if existing:
        return existing
    delivery = NotificationDelivery(
        event_type=event_type,
        reservation_id=reservation.id if reservation else None,
        payment_request_id=payment_request.id if payment_request else None,
        audience_type=audience_type,
        channel=channel,
        template_key=template_key,
        language_code=language_code,
        recipient_target=recipient_target,
        recipient_name=recipient_name,
        dedupe_key=dedupe_key,
        status="failed",
        failure_category=failure_category,
        failure_reason=failure_reason[:255],
        failed_at=utc_now(),
        metadata_json=metadata or {},
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.session.add(delivery)
    db.session.flush()
    return delivery


def _queue_guest_email_delivery(
    *,
    template_key: str,
    event_type: str,
    reservation: Reservation,
    payment_request: PaymentRequest | None,
    language_code: str,
    context: dict[str, object],
    fallback_subject: str,
    fallback_body: str,
    dedupe_key: str,
    actor_user_id: uuid.UUID | None,
    metadata: dict | None = None,
) -> NotificationDelivery:
    guest = reservation.primary_guest
    if not guest or not guest.email:
        return _create_invalid_delivery(
            event_type=event_type,
            audience_type="guest",
            channel="email",
            template_key=template_key,
            language_code=language_code,
            reservation=reservation,
            payment_request=payment_request,
            recipient_target=None,
            recipient_name=context.get("guest_name", "Guest"),
            dedupe_key=dedupe_key,
            actor_user_id=actor_user_id,
            failure_category="invalid_recipient",
            failure_reason="Guest email is not available for notification delivery.",
            metadata=metadata,
        )
    return _queue_delivery_safe(
        event_type=event_type,
        audience_type="guest",
        channel="email",
        template_key=template_key,
        language_code=language_code,
        reservation=reservation,
        payment_request=payment_request,
        recipient_target=guest.email,
        recipient_name=context.get("guest_name", guest.full_name),
        dedupe_key=dedupe_key,
        event_key=event_type,
        context=context,
        fallback_subject=fallback_subject,
        fallback_body=fallback_body,
        actor_user_id=actor_user_id,
        metadata=metadata,
    )


def _queue_staff_email_alerts(
    *,
    template_key: str,
    event_type: str,
    reservation: Reservation,
    payment_request: PaymentRequest | None,
    language_code: str,
    context: dict[str, object],
    fallback_subject: str,
    fallback_body: str,
    dedupe_seed: str,
    actor_user_id: uuid.UUID | None,
    metadata: dict | None = None,
) -> list[NotificationDelivery]:
    deliveries: list[NotificationDelivery] = []
    if not _bool_setting("notifications.staff_email_alerts_enabled", False):
        return deliveries
    for recipient in _staff_alert_recipients():
        deliveries.append(
            _queue_delivery_safe(
                event_type=event_type,
                audience_type="staff",
                channel="email",
                template_key=template_key,
                language_code=language_code,
                reservation=reservation,
                payment_request=payment_request,
                recipient_target=recipient,
                recipient_name="Staff alert",
                dedupe_key=_make_key(dedupe_seed, "email", recipient),
                event_key=event_type,
                context=context,
                fallback_subject=fallback_subject,
                fallback_body=fallback_body,
                actor_user_id=actor_user_id,
                metadata=metadata,
            )
        )
    return deliveries


def _queue_optional_staff_channel(
    *,
    setting_key: str,
    channel: str,
    template_key: str,
    event_type: str,
    reservation: Reservation,
    payment_request: PaymentRequest | None,
    language_code: str,
    context: dict[str, object],
    fallback_subject: str,
    fallback_body: str,
    dedupe_seed: str,
    actor_user_id: uuid.UUID | None,
    metadata: dict | None = None,
) -> NotificationDelivery | None:
    if not _bool_setting(setting_key, False):
        return None
    return _queue_delivery_safe(
        event_type=event_type,
        audience_type="staff",
        channel=channel,
        template_key=template_key,
        language_code=language_code,
        reservation=reservation,
        payment_request=payment_request,
        recipient_target=channel,
        recipient_name="Staff alert",
        dedupe_key=_make_key(dedupe_seed, channel),
        event_key=event_type,
        context=context,
        fallback_subject=fallback_subject,
        fallback_body=fallback_body,
        actor_user_id=actor_user_id,
        metadata=metadata,
    )


def queue_reservation_confirmation(
    reservation: Reservation,
    *,
    actor_user_id: uuid.UUID | None,
    language_code: str | None = None,
    manual: bool = False,
) -> list[uuid.UUID]:
    selected_language = normalize_language(language_code or _reservation_language(reservation))
    context = _base_reservation_context(reservation)
    delivery = _queue_guest_email_delivery(
        template_key="guest_confirmation",
        event_type="reservation.confirmation",
        reservation=reservation,
        payment_request=None,
        language_code=selected_language,
        context=context,
        fallback_subject=f"Booking confirmation {reservation.reservation_code}",
        fallback_body=(
            f"{context['hotel_name']}\n{context['guest_name']}\n"
            f"Booking reference {reservation.reservation_code}\n"
            f"Stay {context['check_in_date']} to {context['check_out_date']}\n"
            f"Total THB {context['grand_total']}"
        ),
        dedupe_key=_make_key("notification", "guest_confirmation", reservation.id, _manual_suffix(manual)),
        actor_user_id=actor_user_id,
        metadata={"manual": manual},
    )
    return [delivery.id]


def queue_staff_new_booking_alert(
    reservation: Reservation,
    *,
    actor_user_id: uuid.UUID | None,
) -> list[uuid.UUID]:
    context = _base_reservation_context(reservation)
    summary = f"New booking {reservation.reservation_code} for arrival {reservation.check_in_date.isoformat()}."
    context["notification_summary"] = summary
    deliveries: list[NotificationDelivery] = [
        _queue_delivery_safe(
            event_type="booking.new_alert",
            audience_type="staff",
            channel="internal_notification",
            template_key="internal_new_booking_alert",
            language_code="en",
            reservation=reservation,
            payment_request=None,
            recipient_target="pms_inbox",
            recipient_name="Staff inbox",
            dedupe_key=_make_key("notification", "new_booking", reservation.id, "internal"),
            event_key="booking.new_alert",
            context=context,
            fallback_subject=f"New booking {reservation.reservation_code}",
            fallback_body=summary,
            actor_user_id=actor_user_id,
            metadata={"summary": summary},
        )
    ]
    deliveries.extend(
        _queue_staff_email_alerts(
            template_key="internal_new_booking_alert",
            event_type="booking.new_alert",
            reservation=reservation,
            payment_request=None,
            language_code="en",
            context=context,
            fallback_subject=f"New booking {reservation.reservation_code}",
            fallback_body=summary,
            dedupe_seed=_make_key("notification", "new_booking", reservation.id),
            actor_user_id=actor_user_id,
            metadata={"summary": summary},
        )
    )
    for setting_key, channel in (
        ("notifications.line_staff_alert_enabled", "line_staff_alert"),
        ("notifications.whatsapp_staff_alert_enabled", "whatsapp_staff_alert"),
    ):
        delivery = _queue_optional_staff_channel(
            setting_key=setting_key,
            channel=channel,
            template_key="internal_new_booking_alert",
            event_type="booking.new_alert",
            reservation=reservation,
            payment_request=None,
            language_code="en",
            context=context,
            fallback_subject=f"New booking {reservation.reservation_code}",
            fallback_body=summary,
            dedupe_seed=_make_key("notification", "new_booking", reservation.id),
            actor_user_id=actor_user_id,
            metadata={"summary": summary},
        )
        if delivery:
            deliveries.append(delivery)
    return [delivery.id for delivery in deliveries]


def queue_internal_activity_alert(
    reservation: Reservation,
    *,
    payment_request: PaymentRequest | None = None,
    actor_user_id: uuid.UUID | None,
    summary: str,
    event_code: str,
    manual: bool = False,
) -> list[uuid.UUID]:
    context = _base_reservation_context(reservation)
    context["notification_summary"] = summary
    if payment_request:
        context["deposit_amount"] = f"{money(payment_request.amount):,.2f}"
        context["payment_status"] = payment_request.status
        context["payment_expires_at"] = _format_datetime(payment_request.expires_at)
        if payment_request.payment_url:
            context["payment_link"] = payment_request.payment_url
    suffix = _manual_suffix(manual)
    seed = _make_key("notification", event_code, reservation.id, payment_request.id if payment_request else "none", suffix)
    deliveries: list[NotificationDelivery] = [
        _queue_delivery_safe(
            event_type=event_code,
            audience_type="staff",
            channel="internal_notification",
            template_key="internal_activity_alert",
            language_code="en",
            reservation=reservation,
            payment_request=payment_request,
            recipient_target="pms_inbox",
            recipient_name="Staff inbox",
            dedupe_key=_make_key(seed, "internal"),
            event_key=event_code,
            context=context,
            fallback_subject=f"Operational update {reservation.reservation_code}",
            fallback_body=summary,
            actor_user_id=actor_user_id,
            metadata={"summary": summary, "manual": manual},
        )
    ]
    deliveries.extend(
        _queue_staff_email_alerts(
            template_key="internal_activity_alert",
            event_type=event_code,
            reservation=reservation,
            payment_request=payment_request,
            language_code="en",
            context=context,
            fallback_subject=f"Operational update {reservation.reservation_code}",
            fallback_body=summary,
            dedupe_seed=seed,
            actor_user_id=actor_user_id,
            metadata={"summary": summary, "manual": manual},
        )
    )
    for setting_key, channel in (
        ("notifications.line_staff_alert_enabled", "line_staff_alert"),
        ("notifications.whatsapp_staff_alert_enabled", "whatsapp_staff_alert"),
    ):
        delivery = _queue_optional_staff_channel(
            setting_key=setting_key,
            channel=channel,
            template_key="internal_activity_alert",
            event_type=event_code,
            reservation=reservation,
            payment_request=payment_request,
            language_code="en",
            context=context,
            fallback_subject=f"Operational update {reservation.reservation_code}",
            fallback_body=summary,
            dedupe_seed=seed,
            actor_user_id=actor_user_id,
            metadata={"summary": summary, "manual": manual},
        )
        if delivery:
            deliveries.append(delivery)
    return [delivery.id for delivery in deliveries]


def queue_deposit_request_email(
    reservation: Reservation,
    payment_request: PaymentRequest,
    *,
    actor_user_id: uuid.UUID | None,
    language_code: str | None = None,
    resend: bool = False,
) -> list[uuid.UUID]:
    selected_language = normalize_language(language_code or _reservation_language(reservation))
    context = _base_reservation_context(reservation)
    context["deposit_amount"] = f"{money(payment_request.amount):,.2f}"
    context["payment_status"] = payment_request.status
    context["payment_expires_at"] = _format_datetime(payment_request.expires_at)
    try:
        context["payment_link"] = _payment_entry_url(payment_request, reservation)
    except RuntimeError as exc:
        delivery = _create_invalid_delivery(
            event_type="payment.deposit_request_email",
            audience_type="guest",
            channel="email",
            template_key="deposit_payment_request",
            language_code=selected_language,
            reservation=reservation,
            payment_request=payment_request,
            recipient_target=reservation.primary_guest.email if reservation.primary_guest else None,
            recipient_name=context["guest_name"],
            dedupe_key=_make_key("notification", "deposit_request", payment_request.id, _manual_suffix(resend)),
            actor_user_id=actor_user_id,
            failure_category="configuration",
            failure_reason=str(exc),
            metadata={"resend": resend},
        )
        return [delivery.id]
    payment_request.last_sent_at = utc_now()
    delivery = _queue_guest_email_delivery(
        template_key="deposit_payment_request",
        event_type="payment.deposit_request_email",
        reservation=reservation,
        payment_request=payment_request,
        language_code=selected_language,
        context=context,
        fallback_subject=f"Deposit payment link {reservation.reservation_code}",
        fallback_body=(
            f"{context['hotel_name']}\n{context['guest_name']}\n"
            f"Please pay THB {context['deposit_amount']} for reservation {reservation.reservation_code}\n"
            f"{context['payment_link']}"
        ),
        dedupe_key=_make_key("notification", "deposit_request", payment_request.id, _manual_suffix(resend)),
        actor_user_id=actor_user_id,
        metadata={"resend": resend, "request_code": payment_request.request_code},
    )
    return [delivery.id]


def queue_payment_success_email(
    reservation: Reservation,
    payment_request: PaymentRequest,
    *,
    actor_user_id: uuid.UUID | None,
    language_code: str | None = None,
) -> list[uuid.UUID]:
    selected_language = normalize_language(language_code or _reservation_language(reservation))
    context = _base_reservation_context(reservation)
    context["payment_status"] = "paid"
    context["amount_received"] = f"{money(payment_request.amount):,.2f}"
    context["deposit_amount"] = f"{money(payment_request.amount):,.2f}"
    delivery = _queue_guest_email_delivery(
        template_key="payment_success",
        event_type="payment.success_email",
        reservation=reservation,
        payment_request=payment_request,
        language_code=selected_language,
        context=context,
        fallback_subject=f"Payment received {reservation.reservation_code}",
        fallback_body=(
            f"{context['hotel_name']}\n{context['guest_name']}\n"
            f"We received THB {context['amount_received']} for reservation {reservation.reservation_code}."
        ),
        dedupe_key=_make_key("notification", "payment_success", payment_request.id),
        actor_user_id=actor_user_id,
        metadata={"request_code": payment_request.request_code},
    )
    return [delivery.id]


def queue_failed_payment_reminder(
    reservation: Reservation,
    payment_request: PaymentRequest,
    *,
    actor_user_id: uuid.UUID | None,
    language_code: str | None = None,
    manual: bool = False,
) -> list[uuid.UUID]:
    if payment_request.status == "paid":
        return []
    selected_language = normalize_language(language_code or _reservation_language(reservation))
    context = _base_reservation_context(reservation)
    context["payment_status"] = payment_request.status
    context["deposit_amount"] = f"{money(payment_request.amount):,.2f}"
    context["payment_expires_at"] = _format_datetime(payment_request.expires_at)
    try:
        context["payment_link"] = _payment_entry_url(payment_request, reservation)
    except RuntimeError as exc:
        delivery = _create_invalid_delivery(
            event_type="payment.failed_reminder",
            audience_type="guest",
            channel="email",
            template_key="payment_failed",
            language_code=selected_language,
            reservation=reservation,
            payment_request=payment_request,
            recipient_target=reservation.primary_guest.email if reservation.primary_guest else None,
            recipient_name=context["guest_name"],
            dedupe_key=_make_key("notification", "payment_failed", payment_request.id, _manual_suffix(manual)),
            actor_user_id=actor_user_id,
            failure_category="configuration",
            failure_reason=str(exc),
            metadata={"manual": manual},
        )
        return [delivery.id]
    payment_request.last_sent_at = utc_now()
    delivery = _queue_guest_email_delivery(
        template_key="payment_failed",
        event_type="payment.failed_reminder",
        reservation=reservation,
        payment_request=payment_request,
        language_code=selected_language,
        context=context,
        fallback_subject=f"Payment follow-up {reservation.reservation_code}",
        fallback_body=(
            f"{context['hotel_name']}\n{context['guest_name']}\n"
            f"The deposit payment for reservation {reservation.reservation_code} is {payment_request.status}.\n"
            f"Retry using {context['payment_link']}"
        ),
        dedupe_key=_make_key("notification", "payment_failed", payment_request.id, _manual_suffix(manual)),
        actor_user_id=actor_user_id,
        metadata={"manual": manual, "request_code": payment_request.request_code},
    )
    return [delivery.id]


def queue_pre_arrival_reminder(
    reservation: Reservation,
    *,
    actor_user_id: uuid.UUID | None,
    language_code: str | None = None,
) -> list[uuid.UUID]:
    selected_language = normalize_language(language_code or _reservation_language(reservation))
    context = _base_reservation_context(reservation)
    delivery = _queue_guest_email_delivery(
        template_key="pre_arrival_reminder",
        event_type="reservation.pre_arrival_reminder",
        reservation=reservation,
        payment_request=None,
        language_code=selected_language,
        context=context,
        fallback_subject=f"Pre-arrival reminder {reservation.reservation_code}",
        fallback_body=(
            f"{context['hotel_name']}\n{context['guest_name']}\n"
            f"This is a reminder for your arrival on {context['check_in_date']}."
        ),
        dedupe_key=_make_key("notification", "pre_arrival", reservation.id, reservation.check_in_date.isoformat()),
        actor_user_id=actor_user_id,
        metadata={"check_in_date": reservation.check_in_date.isoformat()},
    )
    return [delivery.id]


def queue_cancellation_confirmation(
    reservation: Reservation,
    *,
    actor_user_id: uuid.UUID | None,
    language_code: str | None = None,
) -> list[uuid.UUID]:
    from .cashier_service import folio_summary

    selected_language = normalize_language(language_code or _reservation_language(reservation))
    summary = folio_summary(reservation)
    context = _base_reservation_context(reservation)
    context["payment_status"] = summary["settlement_state"]
    context["refund_amount"] = f"{money(summary['refund_due']):,.2f}"
    delivery = _queue_guest_email_delivery(
        template_key="cancellation_confirmation",
        event_type="reservation.cancellation_confirmation",
        reservation=reservation,
        payment_request=None,
        language_code=selected_language,
        context=context,
        fallback_subject=f"Cancellation confirmed {reservation.reservation_code}",
        fallback_body=(
            f"{context['hotel_name']}\n{context['guest_name']}\n"
            f"Reservation {reservation.reservation_code} has been cancelled."
        ),
        dedupe_key=_make_key(
            "notification",
            "cancellation_confirmation",
            reservation.id,
            reservation.cancelled_at.isoformat() if reservation.cancelled_at else "cancelled",
        ),
        actor_user_id=actor_user_id,
    )
    return [delivery.id]


def queue_modification_confirmation(
    reservation: Reservation,
    *,
    actor_user_id: uuid.UUID | None,
    summary: str,
    language_code: str | None = None,
    manual: bool = False,
) -> list[uuid.UUID]:
    selected_language = normalize_language(language_code or _reservation_language(reservation))
    context = _base_reservation_context(reservation)
    context["modification_summary"] = summary
    delivery = _queue_guest_email_delivery(
        template_key="modification_confirmation",
        event_type="reservation.modification_confirmation",
        reservation=reservation,
        payment_request=None,
        language_code=selected_language,
        context=context,
        fallback_subject=f"Reservation updated {reservation.reservation_code}",
        fallback_body=f"{context['hotel_name']}\n{summary}",
        dedupe_key=_make_key(
            "notification",
            "modification_confirmation",
            reservation.id,
            hashlib.sha256(summary.encode('utf-8')).hexdigest()[:12],
            _manual_suffix(manual),
        ),
        actor_user_id=actor_user_id,
        metadata={"manual": manual},
    )
    return [delivery.id]


def queue_cancellation_request_received(
    reservation: Reservation,
    *,
    actor_user_id: uuid.UUID | None,
    request_code: str,
    language_code: str | None = None,
) -> list[uuid.UUID]:
    selected_language = normalize_language(language_code or _reservation_language(reservation))
    context = _base_reservation_context(reservation)
    delivery = _queue_guest_email_delivery(
        template_key="cancellation_request_received",
        event_type="reservation.cancellation_request_received",
        reservation=reservation,
        payment_request=None,
        language_code=selected_language,
        context=context,
        fallback_subject=f"Cancellation request received {reservation.reservation_code}",
        fallback_body=f"{context['hotel_name']}\nWe received your cancellation request for {reservation.reservation_code}.",
        dedupe_key=_make_key("notification", "cancellation_request", reservation.id, request_code),
        actor_user_id=actor_user_id,
        metadata={"request_code": request_code},
    )
    return [delivery.id]


def queue_modification_request_received(
    reservation: Reservation,
    *,
    actor_user_id: uuid.UUID | None,
    request_code: str,
    language_code: str | None = None,
) -> list[uuid.UUID]:
    selected_language = normalize_language(language_code or _reservation_language(reservation))
    context = _base_reservation_context(reservation)
    delivery = _queue_guest_email_delivery(
        template_key="modification_request_received",
        event_type="reservation.modification_request_received",
        reservation=reservation,
        payment_request=None,
        language_code=selected_language,
        context=context,
        fallback_subject=f"Modification request received {reservation.reservation_code}",
        fallback_body=f"{context['hotel_name']}\nWe received your modification request for {reservation.reservation_code}.",
        dedupe_key=_make_key("notification", "modification_request", reservation.id, request_code),
        actor_user_id=actor_user_id,
        metadata={"request_code": request_code},
    )
    return [delivery.id]


def _mark_delivery_failed(delivery: NotificationDelivery, *, category: str, reason: str) -> None:
    delivery.status = "failed"
    delivery.failure_category = category
    delivery.failure_reason = (reason or "")[:255]
    delivery.failed_at = utc_now()


def _dispatch_email(delivery: NotificationDelivery) -> str:
    if not delivery.email_outbox_id:
        _mark_delivery_failed(delivery, category="configuration", reason="Email outbox entry is missing.")
        return "failed"
    delivery.queued_at = delivery.queued_at or utc_now()
    delivery.attempts += 1
    outbox = deliver_email_outbox_entry(delivery.email_outbox_id, commit=False)
    if not outbox:
        _mark_delivery_failed(delivery, category="configuration", reason="Email outbox entry could not be loaded.")
        return "failed"
    if outbox.status == "sent":
        delivery.status = "delivered"
        delivery.failure_category = None
        delivery.failure_reason = None
        delivery.sent_at = outbox.sent_at or utc_now()
        delivery.delivered_at = delivery.sent_at
        return "sent"
    category = "transport"
    if outbox.last_error and "SMTP is not configured" in outbox.last_error:
        category = "configuration"
    _mark_delivery_failed(delivery, category=category, reason=outbox.last_error or "Email delivery failed.")
    return "failed"


def _dispatch_internal_notification(delivery: NotificationDelivery) -> str:
    if delivery.staff_notification_id:
        existing = db.session.get(StaffNotification, delivery.staff_notification_id)
        if existing:
            delivery.status = "delivered"
            delivery.sent_at = delivery.sent_at or utc_now()
            delivery.delivered_at = delivery.delivered_at or delivery.sent_at
            return "sent"
    reservation = db.session.get(Reservation, delivery.reservation_id) if delivery.reservation_id else None
    payment_request = db.session.get(PaymentRequest, delivery.payment_request_id) if delivery.payment_request_id else None
    payload = dict(delivery.metadata_json or {})
    payload.update(
        {
            "subject": delivery.rendered_subject or "",
            "body": delivery.rendered_body or "",
            "template_key": delivery.template_key,
            "event_type": delivery.event_type,
        }
    )
    if reservation:
        payload.setdefault("reservation_code", reservation.reservation_code)
        payload.setdefault("guest_name", reservation.primary_guest.full_name if reservation.primary_guest else None)
        payload.setdefault("arrival_date", reservation.check_in_date.isoformat())
    if payment_request:
        payload.setdefault("payment_request_code", payment_request.request_code)
    note = StaffNotification(
        notification_type=_staff_notification_type(delivery.event_type),
        reservation_id=delivery.reservation_id,
        payload_json=payload,
        status="new",
    )
    db.session.add(note)
    db.session.flush()
    delivery.staff_notification_id = note.id
    delivery.queued_at = delivery.queued_at or utc_now()
    delivery.attempts += 1
    delivery.status = "delivered"
    delivery.sent_at = utc_now()
    delivery.delivered_at = delivery.sent_at
    delivery.failure_category = None
    delivery.failure_reason = None
    return "sent"


def _external_channel_url(channel: str) -> str:
    mapping = {
        "line_staff_alert": str(current_app.config.get("LINE_STAFF_ALERT_WEBHOOK_URL", "") or ""),
        "whatsapp_staff_alert": str(current_app.config.get("WHATSAPP_STAFF_ALERT_WEBHOOK_URL", "") or ""),
    }
    return mapping.get(channel, "").strip()


def _dispatch_external_staff_alert(delivery: NotificationDelivery) -> str:
    webhook_url = _external_channel_url(delivery.channel)
    if not webhook_url:
        _mark_delivery_failed(delivery, category="configuration", reason=f"{delivery.channel} webhook is not configured.")
        return "failed"
    reservation = db.session.get(Reservation, delivery.reservation_id) if delivery.reservation_id else None
    payment_request = db.session.get(PaymentRequest, delivery.payment_request_id) if delivery.payment_request_id else None
    payload = {
        "event_type": delivery.event_type,
        "channel": delivery.channel,
        "subject": delivery.rendered_subject or "",
        "body": delivery.rendered_body or "",
        "reservation_id": str(delivery.reservation_id) if delivery.reservation_id else None,
        "reservation_code": reservation.reservation_code if reservation else None,
        "payment_request_id": str(delivery.payment_request_id) if delivery.payment_request_id else None,
        "payment_request_code": payment_request.request_code if payment_request else None,
    }
    request_obj = urllib.request.Request(
        webhook_url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    delivery.queued_at = delivery.queued_at or utc_now()
    delivery.attempts += 1
    try:
        with urllib.request.urlopen(request_obj, timeout=10) as response:  # noqa: S310
            response_body = response.read().decode("utf-8", errors="ignore")
            delivery.status = "delivered"
            delivery.sent_at = utc_now()
            delivery.delivered_at = delivery.sent_at
            delivery.external_message_id = f"{response.status}:{response_body[:120]}"
            delivery.failure_category = None
            delivery.failure_reason = None
            return "sent"
    except urllib.error.URLError as exc:
        _mark_delivery_failed(delivery, category="transport", reason=str(exc))
        return "failed"


def dispatch_notification_deliveries(
    delivery_ids: list[uuid.UUID] | None = None,
    *,
    limit: int = 100,
) -> dict[str, int]:
    query = NotificationDelivery.query.order_by(NotificationDelivery.created_at.asc())
    if delivery_ids:
        query = query.filter(NotificationDelivery.id.in_(delivery_ids))
    else:
        query = query.filter(NotificationDelivery.status.in_(["pending", "queued", "failed"]))
    ids = [item.id for item in query.limit(limit).all()]
    results = {"processed": 0, "sent": 0, "failed": 0, "skipped": 0}
    for delivery_id in ids:
        try:
            delivery = db.session.get(NotificationDelivery, delivery_id)
            if not delivery:
                continue
            if delivery.status in {"sent", "delivered", "cancelled", "skipped"}:
                results["skipped"] += 1
                continue
            if delivery.channel == "email":
                outcome = _dispatch_email(delivery)
            elif delivery.channel == "internal_notification":
                outcome = _dispatch_internal_notification(delivery)
            elif delivery.channel in {"line_staff_alert", "whatsapp_staff_alert"}:
                outcome = _dispatch_external_staff_alert(delivery)
            else:
                _mark_delivery_failed(delivery, category="configuration", reason="Unsupported notification channel.")
                outcome = "failed"
            db.session.commit()
            results["processed"] += 1
            if outcome == "sent":
                results["sent"] += 1
            elif outcome == "failed":
                results["failed"] += 1
            else:
                results["skipped"] += 1
        except Exception as exc:  # noqa: BLE001
            db.session.rollback()
            delivery = db.session.get(NotificationDelivery, delivery_id)
            if delivery:
                _mark_delivery_failed(delivery, category="transport", reason=str(exc))
                db.session.commit()
            results["processed"] += 1
            results["failed"] += 1
    return results


def query_notification_history(
    *,
    reservation_id: uuid.UUID | None = None,
    payment_request_id: uuid.UUID | None = None,
    audience_type: str | None = None,
    channel: str | None = None,
    status: str | None = None,
    limit: int = 100,
) -> list[NotificationDelivery]:
    query = NotificationDelivery.query.options(
        joinedload(NotificationDelivery.reservation),
        joinedload(NotificationDelivery.payment_request),
        joinedload(NotificationDelivery.email_outbox),
        joinedload(NotificationDelivery.staff_notification),
    )
    if reservation_id:
        query = query.filter(NotificationDelivery.reservation_id == reservation_id)
    if payment_request_id:
        query = query.filter(NotificationDelivery.payment_request_id == payment_request_id)
    if audience_type:
        query = query.filter(NotificationDelivery.audience_type == audience_type)
    if channel:
        query = query.filter(NotificationDelivery.channel == channel)
    if status:
        query = query.filter(NotificationDelivery.status == status)
    return query.order_by(NotificationDelivery.created_at.desc()).limit(limit).all()


def send_due_pre_arrival_reminders(*, actor_user_id: uuid.UUID | None = None) -> dict[str, int]:
    if not _bool_setting("notifications.pre_arrival_enabled", True):
        return {"queued": 0, "sent": 0, "failed": 0, "skipped": 0}
    days_before = _int_setting("notifications.pre_arrival_days_before", 1)
    target_date = date.today() + timedelta(days=days_before)
    reservations = (
        Reservation.query.filter(
            Reservation.check_in_date == target_date,
            Reservation.current_status.in_(["tentative", "confirmed"]),
        )
        .order_by(Reservation.check_in_date.asc())
        .all()
    )
    delivery_ids: list[uuid.UUID] = []
    for reservation in reservations:
        delivery_ids.extend(queue_pre_arrival_reminder(reservation, actor_user_id=actor_user_id))
    db.session.commit()
    outcome = dispatch_notification_deliveries(delivery_ids)
    outcome["queued"] = len(delivery_ids)
    return outcome


def send_due_failed_payment_reminders(*, actor_user_id: uuid.UUID | None = None) -> dict[str, int]:
    if not _bool_setting("notifications.failed_payment_reminder_enabled", True):
        return {"queued": 0, "sent": 0, "failed": 0, "skipped": 0}
    threshold = utc_now() - timedelta(hours=_int_setting("notifications.failed_payment_reminder_delay_hours", 6))
    request_ids = [
        item.id
        for item in PaymentRequest.query.filter(
            PaymentRequest.status.in_(["failed", "expired"]),
            sa.or_(PaymentRequest.failed_at <= threshold, PaymentRequest.expired_at <= threshold),
        )
        .order_by(PaymentRequest.created_at.asc())
        .all()
    ]
    totals = {"queued": 0, "sent": 0, "failed": 0, "skipped": 0}
    for payment_request_id in request_ids:
        payment_request = db.session.get(PaymentRequest, payment_request_id)
        if not payment_request:
            continue
        reservation = db.session.get(Reservation, payment_request.reservation_id)
        if not reservation or reservation.current_status in {"cancelled", "no_show", "checked_out"}:
            continue
        if money(reservation.deposit_received_amount) >= money(reservation.deposit_required_amount):
            continue
        from .payment_integration_service import generate_or_refresh_hosted_checkout

        try:
            generate_or_refresh_hosted_checkout(
                payment_request.id,
                actor_user_id=actor_user_id,
                force_new=payment_request.status == "expired",
            )
            payment_request = db.session.get(PaymentRequest, payment_request_id)
            reservation = db.session.get(Reservation, payment_request.reservation_id) if payment_request else None
            if not payment_request or not reservation:
                continue
            delivery_ids = queue_failed_payment_reminder(
                reservation,
                payment_request,
                actor_user_id=actor_user_id,
                manual=False,
            )
            db.session.commit()
        except Exception:
            db.session.rollback()
            totals["failed"] += 1
            continue
        outcome = dispatch_notification_deliveries(delivery_ids)
        totals["queued"] += len(delivery_ids)
        totals["sent"] += outcome["sent"]
        totals["failed"] += outcome["failed"]
        totals["skipped"] += outcome["skipped"]
    return totals


def communication_settings_context() -> dict[str, object]:
    return {
        "sender_name": _string_setting("notifications.sender_name", "Sandbox Hotel"),
        "pre_arrival_enabled": _bool_setting("notifications.pre_arrival_enabled", True),
        "pre_arrival_days_before": _int_setting("notifications.pre_arrival_days_before", 1),
        "failed_payment_reminder_enabled": _bool_setting("notifications.failed_payment_reminder_enabled", True),
        "failed_payment_reminder_delay_hours": _int_setting("notifications.failed_payment_reminder_delay_hours", 6),
        "staff_email_alerts_enabled": _bool_setting("notifications.staff_email_alerts_enabled", False),
        "staff_alert_recipients": _string_setting("notifications.staff_alert_recipients", ""),
        "line_staff_alert_enabled": _bool_setting("notifications.line_staff_alert_enabled", False),
        "whatsapp_staff_alert_enabled": _bool_setting("notifications.whatsapp_staff_alert_enabled", False),
        "line_staff_alert_configured": bool(current_app.config.get("LINE_STAFF_ALERT_WEBHOOK_URL")),
        "whatsapp_staff_alert_configured": bool(current_app.config.get("WHATSAPP_STAFF_ALERT_WEBHOOK_URL")),
        "pending_count": NotificationDelivery.query.filter(NotificationDelivery.status.in_(["pending", "queued"])).count(),
        "failed_count": NotificationDelivery.query.filter_by(status="failed").count(),
    }
