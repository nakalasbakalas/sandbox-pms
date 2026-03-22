from __future__ import annotations

import sys
from datetime import timedelta

from .communication_base import *  # noqa: F401,F403
from .communication_queue import queue_failed_payment_reminder, queue_pre_arrival_reminder
from . import communication_base as _base

_string_setting = _base._string_setting
_bool_setting = _base._bool_setting
_int_setting = _base._int_setting
_staff_notification_type = _base._staff_notification_type

MAX_DELIVERY_ATTEMPTS = 5
BACKOFF_BASE_SECONDS = 60  # 1 min, 2 min, 4 min, 8 min, 16 min


def _service_module():
    return sys.modules.get("pms.services.communication_service")

def _mark_delivery_failed(delivery: NotificationDelivery, *, category: str, reason: str) -> None:
    delivery.failure_category = category
    delivery.failure_reason = (reason or "")[:255]
    delivery.failed_at = utc_now()
    if delivery.attempts >= MAX_DELIVERY_ATTEMPTS or category == "configuration":
        delivery.status = "failed"
        delivery.next_retry_at = None
    else:
        delivery.status = "retry"
        backoff = BACKOFF_BASE_SECONDS * (2 ** (delivery.attempts - 1))
        delivery.next_retry_at = utc_now() + timedelta(seconds=backoff)


def _deliver_email_outbox_entry(email_outbox_id: uuid.UUID, *, commit: bool = True) -> EmailOutbox | None:
    entry = db.session.get(EmailOutbox, email_outbox_id)
    if not entry or entry.status == "sent":
        return entry

    entry.attempts += 1
    smtp_host = current_app.config.get("SMTP_HOST")
    if not smtp_host:
        entry.status = "failed"
        entry.last_error = "SMTP is not configured."
        if commit:
            db.session.commit()
        return entry

    message = EmailMessage()
    message["Subject"] = entry.subject
    message["From"] = current_app.config["MAIL_FROM"]
    message["To"] = entry.recipient_email
    message.set_content(entry.body_text)

    try:
        smtp_lib = getattr(_service_module(), "smtplib", smtplib)
        with smtp_lib.SMTP(smtp_host, current_app.config["SMTP_PORT"], timeout=15) as client:
            if current_app.config["SMTP_USE_TLS"]:
                client.starttls(context=ssl.create_default_context())
            if current_app.config["SMTP_USERNAME"]:
                client.login(
                    current_app.config["SMTP_USERNAME"],
                    current_app.config["SMTP_PASSWORD"],
                )
            client.send_message(message)
        entry.status = "sent"
        entry.sent_at = utc_now()
        entry.last_error = None
    except Exception as exc:  # noqa: BLE001
        entry.status = "failed"
        entry.last_error = str(exc)[:255]
    if commit:
        db.session.commit()
    return entry


def _dispatch_email(delivery: NotificationDelivery) -> str:
    if not delivery.email_outbox_id:
        _mark_delivery_failed(delivery, category="configuration", reason="Email outbox entry is missing.")
        return "failed"
    delivery.queued_at = delivery.queued_at or utc_now()
    delivery.attempts += 1
    outbox = _deliver_email_outbox_entry(delivery.email_outbox_id, commit=False)
    if not outbox:
        _mark_delivery_failed(delivery, category="configuration", reason="Email outbox entry could not be loaded.")
        return "failed"
    if outbox.status == "sent":
        delivery.status = "delivered"
        delivery.failure_category = None
        delivery.failure_reason = None
        delivery.sent_at = outbox.sent_at or utc_now()
        delivery.delivered_at = delivery.sent_at
        delivery.next_retry_at = None
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
    query = sa.select(NotificationDelivery.id).order_by(NotificationDelivery.created_at.asc())
    if delivery_ids:
        query = query.where(NotificationDelivery.id.in_(delivery_ids))
    else:
        now = utc_now()
        query = query.where(
            sa.or_(
                NotificationDelivery.status.in_(["pending", "queued"]),
                sa.and_(
                    NotificationDelivery.status == "retry",
                    sa.or_(
                        NotificationDelivery.next_retry_at.is_(None),
                        NotificationDelivery.next_retry_at <= now,
                    ),
                ),
            )
        )
    ids = db.session.execute(query.limit(limit)).scalars().all()
    results = {"processed": 0, "sent": 0, "failed": 0, "skipped": 0}
    for delivery_id in ids:
        try:
            delivery = db.session.get(NotificationDelivery, delivery_id)
            if not delivery:
                continue
            if delivery.status in {"sent", "delivered", "cancelled", "skipped", "failed"}:
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
    query = sa.select(NotificationDelivery).options(
        joinedload(NotificationDelivery.reservation),
        joinedload(NotificationDelivery.payment_request),
        joinedload(NotificationDelivery.email_outbox),
        joinedload(NotificationDelivery.staff_notification),
    )
    if reservation_id:
        query = query.where(NotificationDelivery.reservation_id == reservation_id)
    if payment_request_id:
        query = query.where(NotificationDelivery.payment_request_id == payment_request_id)
    if audience_type:
        query = query.where(NotificationDelivery.audience_type == audience_type)
    if channel:
        query = query.where(NotificationDelivery.channel == channel)
    if status:
        query = query.where(NotificationDelivery.status == status)
    return (
        db.session.execute(query.order_by(NotificationDelivery.created_at.desc()).limit(limit))
        .unique()
        .scalars()
        .all()
    )


def send_due_pre_arrival_reminders(*, actor_user_id: uuid.UUID | None = None) -> dict[str, int]:
    if not _bool_setting("notifications.pre_arrival_enabled", True):
        return {"queued": 0, "sent": 0, "failed": 0, "skipped": 0}
    days_before = _int_setting("notifications.pre_arrival_days_before", 1)
    target_date = date.today() + timedelta(days=days_before)
    reservations = (
        db.session.execute(
            sa.select(Reservation)
            .where(
                Reservation.check_in_date == target_date,
                Reservation.current_status.in_(["tentative", "confirmed"]),
            )
            .order_by(Reservation.check_in_date.asc())
        )
        .scalars()
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
        for item in db.session.execute(
            sa.select(PaymentRequest)
            .where(
                PaymentRequest.status.in_(["failed", "expired"]),
                sa.or_(PaymentRequest.failed_at <= threshold, PaymentRequest.expired_at <= threshold),
            )
            .order_by(PaymentRequest.created_at.asc())
        )
        .scalars()
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
        except Exception as exc:
            db.session.rollback()
            current_app.logger.exception(
                "Failed to generate failed-payment reminder checkout for %s.",
                payment_request.request_code,
            )
            activity_logger = getattr(_service_module(), "write_activity_log", write_activity_log)
            activity_logger(
                actor_user_id=actor_user_id,
                event_type="notification.failed_payment_reminder_failed",
                entity_table="payment_requests",
                entity_id=str(payment_request.id),
                metadata={
                    "payment_request_code": payment_request.request_code,
                    "reservation_code": reservation.reservation_code,
                    "error": str(exc)[:255],
                },
            )
            totals["failed"] += 1
            continue
        outcome = dispatch_notification_deliveries(delivery_ids)
        totals["queued"] += len(delivery_ids)
        totals["sent"] += outcome["sent"]
        totals["failed"] += outcome["failed"]
        totals["skipped"] += outcome["skipped"]
    return totals


def communication_settings_context() -> dict[str, object]:
    pending_count = db.session.execute(
        sa.select(sa.func.count())
        .select_from(NotificationDelivery)
        .where(NotificationDelivery.status.in_(["pending", "queued"]))
    ).scalar_one()
    failed_count = db.session.execute(
        sa.select(sa.func.count())
        .select_from(NotificationDelivery)
        .where(NotificationDelivery.status == "failed")
    ).scalar_one()
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
        "pending_count": pending_count,
        "failed_count": failed_count,
    }
