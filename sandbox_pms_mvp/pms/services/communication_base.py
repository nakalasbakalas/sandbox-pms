from __future__ import annotations

import hashlib
import json
import smtplib
import ssl
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from email.message import EmailMessage

import sqlalchemy as sa
from flask import current_app
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from ..activity import write_activity_log
from ..branding import branding_settings_context, resolve_public_base_url
from ..extensions import db
from ..i18n import normalize_language
from ..models import (
    EmailOutbox,
    NotificationDelivery,
    PaymentRequest,
    Reservation,
    StaffNotification,
    utc_now,
)
from ..pricing import get_setting_value, money
from ..url_topology import build_booking_url
from .admin_service import get_notification_template_variant, policy_text, render_notification_template


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
    branding = branding_settings_context()
    return {
        "hotel_name": branding["hotel_name"],
        "hotel_logo_url": branding["logo_url"],
        "hotel_address": branding["address"],
        "hotel_check_in_time": branding["check_in_time"],
        "hotel_check_out_time": branding["check_out_time"],
        "contact_phone": branding["contact_phone"],
        "contact_email": branding["contact_email"],
        "support_contact_text": branding["support_contact_text"],
        "public_booking_url": branding["public_base_url"] or resolve_public_base_url(),
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
    base_url = resolve_public_base_url()
    if not base_url:
        raise RuntimeError("APP_BASE_URL must be configured for guest payment links.")
    query = urllib.parse.urlencode(
        {
            "reservation_code": reservation.reservation_code,
            "token": reservation.public_confirmation_token,
        }
    )
    return build_booking_url(f"/payments/request/{payment_request.request_code}", query_string=query)


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
    return (
        db.session.execute(
            sa.select(NotificationDelivery).where(NotificationDelivery.dedupe_key == dedupe_key)
        )
        .scalars()
        .first()
    )


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


