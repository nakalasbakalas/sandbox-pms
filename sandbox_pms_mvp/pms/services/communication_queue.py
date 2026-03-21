from __future__ import annotations

from .communication_base import *  # noqa: F401,F403

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
    payment_request_noun = _payment_request_noun(payment_request)
    context = _base_reservation_context(reservation)
    context["deposit_amount"] = f"{money(payment_request.amount):,.2f}"
    context["payment_amount"] = context["deposit_amount"]
    context["payment_status"] = payment_request.status
    context["payment_expires_at"] = _format_datetime(payment_request.expires_at)
    context["payment_request_label"] = payment_request_noun
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
        fallback_subject=f"Payment link {reservation.reservation_code}",
        fallback_body=(
            f"{context['hotel_name']}\n{context['guest_name']}\n"
            f"Please complete the {payment_request_noun} of THB {context['deposit_amount']} "
            f"for reservation {reservation.reservation_code}\n"
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
    context["payment_amount"] = context["deposit_amount"]
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
    payment_request_noun = _payment_request_noun(payment_request)
    context = _base_reservation_context(reservation)
    context["payment_status"] = payment_request.status
    context["deposit_amount"] = f"{money(payment_request.amount):,.2f}"
    context["payment_amount"] = context["deposit_amount"]
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
            f"The {payment_request_noun} for reservation {reservation.reservation_code} is {payment_request.status}.\n"
            f"Retry using {context['payment_link']}"
        ),
        dedupe_key=_make_key("notification", "payment_failed", payment_request.id, _manual_suffix(manual)),
        actor_user_id=actor_user_id,
        metadata={"manual": manual, "request_code": payment_request.request_code},
    )
    return [delivery.id]


def _payment_request_noun(payment_request: PaymentRequest) -> str:
    request_type = (payment_request.request_type or "").lower()
    if "deposit" in request_type:
        return "deposit payment"
    if "full_payment" in request_type:
        return "full payment"
    return "balance payment"


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


