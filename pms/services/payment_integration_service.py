from __future__ import annotations

import hmac
import hashlib
import json
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import sqlalchemy as sa
from flask import current_app, has_request_context, url_for

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..extensions import db
from ..i18n import normalize_language, t
from ..pricing import get_setting_value
from ..models import (
    EmailOutbox,
    Guest,
    PaymentEvent,
    PaymentRequest,
    Reservation,
    ReservationReviewQueue,
    ReservationStatusHistory,
)
from .communication_service import (
    dispatch_notification_deliveries,
    queue_deposit_request_email,
    queue_internal_activity_alert,
    queue_payment_success_email,
    query_notification_history,
)
from .admin_service import policy_text, render_notification_template
from .cashier_service import PaymentPostingPayload, money, record_payment


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@dataclass
class HostedCheckoutResult:
    checkout_url: str
    provider_reference: str
    provider_payment_reference: str | None
    provider_status: str | None
    expires_at: datetime | None
    metadata: dict | None = None


@dataclass
class NormalizedProviderEvent:
    event_type: str
    normalized_status: str
    provider_reference: str | None
    provider_payment_reference: str | None
    provider_event_id: str | None
    amount: Decimal | None
    currency_code: str | None
    provider_status: str | None
    request_code: str | None = None
    payment_request_id: str | None = None
    raw_payload: dict | None = None
    occurred_at: datetime | None = None


class PaymentProviderBase:
    provider_name = "disabled"

    def create_checkout(self, payment_request: PaymentRequest, reservation: Reservation, guest: Guest | None) -> HostedCheckoutResult:  # noqa: ARG002
        raise NotImplementedError

    def verify_and_parse_webhook(self, payload: bytes, headers: dict[str, str]) -> list[NormalizedProviderEvent]:  # noqa: ARG002
        raise NotImplementedError

    def retrieve_status(self, payment_request: PaymentRequest) -> NormalizedProviderEvent | None:  # noqa: ARG002
        return None


class DisabledPaymentProvider(PaymentProviderBase):
    provider_name = "disabled"

    def create_checkout(self, payment_request: PaymentRequest, reservation: Reservation, guest: Guest | None) -> HostedCheckoutResult:  # noqa: ARG002
        raise ValueError("Hosted payments are not configured.")

    def verify_and_parse_webhook(self, payload: bytes, headers: dict[str, str]) -> list[NormalizedProviderEvent]:  # noqa: ARG002
        raise ValueError("Hosted payments are not configured.")


class TestHostedPaymentProvider(PaymentProviderBase):
    provider_name = "test_hosted"

    def create_checkout(self, payment_request: PaymentRequest, reservation: Reservation, guest: Guest | None) -> HostedCheckoutResult:
        checkout_id = f"thc_{payment_request.id.hex[:18]}"
        public_url = guest_payment_entry_url(payment_request, reservation, external=True)
        provider_url = (
            f"{current_app.config['PAYMENT_BASE_URL'].rstrip('/')}/hosted-checkout/"
            f"{payment_request.request_code}?return_url={urllib.parse.quote(public_url, safe='')}"
        )
        return HostedCheckoutResult(
            checkout_url=provider_url,
            provider_reference=checkout_id,
            provider_payment_reference=f"thp_{payment_request.id.hex[:18]}",
            provider_status="pending",
            expires_at=utc_now() + timedelta(minutes=payment_link_ttl_minutes()),
            metadata={"mode": "test_hosted"},
        )

    def verify_and_parse_webhook(self, payload: bytes, headers: dict[str, str]) -> list[NormalizedProviderEvent]:
        expected = sign_test_hosted_webhook(payload)
        provided = headers.get("X-Test-Hosted-Signature", "")
        if not expected or not provided or not hmac.compare_digest(expected, provided):
            raise ValueError("Invalid hosted payment webhook signature.")
        data = json.loads(payload.decode("utf-8"))
        status = normalize_provider_status(str(data.get("status") or "pending"))
        amount_value = data.get("amount")
        amount = money(amount_value) if amount_value is not None else None
        return [
            NormalizedProviderEvent(
                event_type=f"payment.{status}",
                normalized_status=status,
                provider_reference=data.get("provider_reference"),
                provider_payment_reference=data.get("provider_payment_reference"),
                provider_event_id=data.get("event_id"),
                amount=amount,
                currency_code=data.get("currency_code") or "THB",
                provider_status=str(data.get("status") or status),
                request_code=data.get("payment_request_code"),
                payment_request_id=data.get("payment_request_id"),
                raw_payload=data,
            )
        ]

    def retrieve_status(self, payment_request: PaymentRequest) -> NormalizedProviderEvent | None:
        provider_status = payment_request.provider_status or payment_request.status
        provider_status = normalize_provider_status(provider_status)
        return NormalizedProviderEvent(
            event_type=f"payment.{provider_status}",
            normalized_status=provider_status,
            provider_reference=payment_request.provider_reference,
            provider_payment_reference=payment_request.provider_payment_reference,
            provider_event_id=None,
            amount=money(payment_request.amount),
            currency_code=payment_request.currency_code,
            provider_status=provider_status,
            request_code=payment_request.request_code,
            payment_request_id=str(payment_request.id),
            raw_payload={"source": "status_sync", "provider_status": provider_status},
        )


class StripeHostedPaymentProvider(PaymentProviderBase):
    provider_name = "stripe"

    def create_checkout(self, payment_request: PaymentRequest, reservation: Reservation, guest: Guest | None) -> HostedCheckoutResult:
        secret_key = current_app.config.get("STRIPE_SECRET_KEY")
        if not secret_key:
            raise ValueError("Stripe secret key is not configured.")
        payload = {
            "mode": "payment",
            "success_url": payment_return_url(payment_request, reservation, external=True),
            "cancel_url": payment_return_url(payment_request, reservation, external=True),
            "customer_email": (guest.email if guest and guest.email else payment_request.guest_email or ""),
            "metadata[payment_request_id]": str(payment_request.id),
            "metadata[payment_request_code]": payment_request.request_code or "",
            "metadata[reservation_id]": str(reservation.id),
            "metadata[reservation_code]": reservation.reservation_code,
            "line_items[0][price_data][currency]": payment_request.currency_code.lower(),
            "line_items[0][price_data][unit_amount]": str(int(money(payment_request.amount) * Decimal("100"))),
            "line_items[0][price_data][product_data][name]": f"Sandbox Hotel deposit {reservation.reservation_code}",
            "line_items[0][price_data][product_data][description]": f"Deposit for stay {reservation.check_in_date} to {reservation.check_out_date}",
            "line_items[0][quantity]": "1",
            "expires_at": str(int((utc_now() + timedelta(minutes=payment_link_ttl_minutes())).timestamp())),
        }
        response = _stripe_request(
            "POST",
            "/v1/checkout/sessions",
            body=urllib.parse.urlencode(payload).encode("utf-8"),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        expires_at = None
        if response.get("expires_at"):
            expires_at = datetime.fromtimestamp(int(response["expires_at"]), tz=timezone.utc)
        return HostedCheckoutResult(
            checkout_url=response["url"],
            provider_reference=response["id"],
            provider_payment_reference=response.get("payment_intent"),
            provider_status=response.get("status"),
            expires_at=expires_at,
            metadata={"mode": "stripe"},
        )

    def verify_and_parse_webhook(self, payload: bytes, headers: dict[str, str]) -> list[NormalizedProviderEvent]:
        signature = headers.get("Stripe-Signature", "")
        secret = current_app.config.get("STRIPE_WEBHOOK_SECRET")
        if not signature or not secret:
            raise ValueError("Stripe webhook secret is not configured.")
        _verify_stripe_signature(payload, signature, secret, current_app.config["PAYMENT_WEBHOOK_TOLERANCE_SECONDS"])
        event = json.loads(payload.decode("utf-8"))
        obj = ((event.get("data") or {}).get("object") or {})
        metadata = obj.get("metadata") or {}
        amount_total = obj.get("amount_total")
        amount = None
        if amount_total is not None:
            amount = (Decimal(str(amount_total)) / Decimal("100")).quantize(Decimal("0.01"))
        normalized_status = _stripe_status_to_internal(event.get("type", ""), obj)
        return [
            NormalizedProviderEvent(
                event_type=f"payment.{normalized_status}",
                normalized_status=normalized_status,
                provider_reference=obj.get("id"),
                provider_payment_reference=obj.get("payment_intent"),
                provider_event_id=event.get("id"),
                amount=amount,
                currency_code=(obj.get("currency") or "thb").upper(),
                provider_status=obj.get("payment_status") or obj.get("status"),
                request_code=metadata.get("payment_request_code"),
                payment_request_id=metadata.get("payment_request_id"),
                raw_payload=event,
            )
        ]

    def retrieve_status(self, payment_request: PaymentRequest) -> NormalizedProviderEvent | None:
        if not payment_request.provider_reference:
            return None
        response = _stripe_request(
            "GET",
            f"/v1/checkout/sessions/{urllib.parse.quote(payment_request.provider_reference, safe='')}",
        )
        amount_total = response.get("amount_total")
        amount = None
        if amount_total is not None:
            amount = (Decimal(str(amount_total)) / Decimal("100")).quantize(Decimal("0.01"))
        normalized_status = _stripe_status_to_internal("checkout.session.status_sync", response)
        return NormalizedProviderEvent(
            event_type=f"payment.{normalized_status}",
            normalized_status=normalized_status,
            provider_reference=response.get("id"),
            provider_payment_reference=response.get("payment_intent"),
            provider_event_id=None,
            amount=amount,
            currency_code=(response.get("currency") or payment_request.currency_code).upper(),
            provider_status=response.get("payment_status") or response.get("status"),
            request_code=payment_request.request_code,
            payment_request_id=str(payment_request.id),
            raw_payload=response,
        )


def payments_enabled() -> bool:
    return _bool_setting("payment.deposit_enabled", True) and active_payment_provider_name() != "disabled"


def active_payment_provider_name() -> str:
    configured = str(get_setting_value("payment.active_provider", "env") or "env").strip().lower()
    if configured in {"", "env"}:
        configured = str(current_app.config.get("PAYMENT_PROVIDER") or "disabled").strip().lower()
    return configured or "disabled"


def payment_link_ttl_minutes() -> int:
    return int(get_setting_value("payment.link_expiry_minutes", current_app.config["PAYMENT_LINK_TTL_MINUTES"]))


def payment_link_resend_cooldown_seconds() -> int:
    return int(
        get_setting_value(
            "payment.link_resend_cooldown_seconds",
            current_app.config["PAYMENT_LINK_RESEND_COOLDOWN_SECONDS"],
        )
    )


def _bool_setting(key: str, default: bool) -> bool:
    value = get_setting_value(key, default)
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "on", "yes"}


def get_payment_provider(provider_name: str | None = None) -> PaymentProviderBase:
    selected = (provider_name or active_payment_provider_name()).strip().lower()
    if selected == "stripe":
        return StripeHostedPaymentProvider()
    if selected == "test_hosted":
        return TestHostedPaymentProvider()
    return DisabledPaymentProvider()


def create_or_reuse_deposit_request(
    reservation_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID | None,
    send_email: bool = False,
    language: str | None = None,
    force_new_link: bool = False,
    source: str = "staff",
) -> PaymentRequest:
    if not payments_enabled():
        raise ValueError("Hosted payments are not enabled.")
    reservation = (
        db.session.execute(
            sa.select(Reservation)
            .options(sa.orm.joinedload(Reservation.primary_guest))
            .where(Reservation.id == reservation_id)
            .with_for_update()
        )
        .scalars()
        .first()
    )
    if not reservation:
        raise ValueError("Reservation not found.")
    required_amount = money(reservation.deposit_required_amount)
    received_amount = money(reservation.deposit_received_amount)
    outstanding_amount = max(required_amount - received_amount, Decimal("0.00"))
    if outstanding_amount <= Decimal("0.00"):
        raise ValueError("No deposit request is required for this reservation.")

    now = utc_now()
    payment_request = (
        db.session.execute(
            sa.select(PaymentRequest)
            .where(
                PaymentRequest.reservation_id == reservation.id,
                PaymentRequest.request_type == "deposit_hosted",
                PaymentRequest.status == "pending",
            )
            .order_by(PaymentRequest.created_at.desc())
            .with_for_update()
        )
        .scalars()
        .first()
    )
    if payment_request and as_utc(payment_request.expires_at) and as_utc(payment_request.expires_at) <= now:
        payment_request.status = "expired"
        payment_request.expired_at = now
        _append_payment_event(
            payment_request=payment_request,
            reservation=reservation,
            event_type="payment.expired",
            amount=money(payment_request.amount),
            provider_event_id=None,
            raw_payload={"source": "internal_expiry"},
        )
        payment_request = None

    created = False
    if not payment_request:
        payment_request = PaymentRequest(
            reservation_id=reservation.id,
            request_type="deposit_hosted",
            amount=outstanding_amount,
            currency_code="THB",
            due_at=now,
            status="pending",
            provider=active_payment_provider_name(),
            guest_email=reservation.primary_guest.email if reservation.primary_guest else None,
            guest_name=reservation.primary_guest.full_name if reservation.primary_guest else None,
            metadata_json={
                "source": source,
                "created_from_public_booking_flow": reservation.created_from_public_booking_flow,
                "booking_language": reservation.booking_language,
            },
            created_by_user_id=actor_user_id,
            updated_by_user_id=actor_user_id,
        )
        db.session.add(payment_request)
        db.session.flush()
        payment_request.request_code = f"PAY-{payment_request.id.hex[:10].upper()}"
        created = True
        _append_payment_event(
            payment_request=payment_request,
            reservation=reservation,
            event_type="payment.request_created",
            amount=outstanding_amount,
            provider_event_id=None,
            raw_payload={"request_code": payment_request.request_code, "source": source},
        )
    else:
        payment_request.amount = outstanding_amount
        payment_request.updated_by_user_id = actor_user_id
        payment_request.provider = active_payment_provider_name()
        metadata = dict(payment_request.metadata_json or {})
        metadata["source"] = source
        payment_request.metadata_json = metadata

    _sync_review_queue_deposit_state(reservation)

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="payment_requests",
        entity_id=str(payment_request.id),
        action="payment_request_create_or_reuse",
        after_data={
            "reservation_id": str(reservation.id),
            "request_code": payment_request.request_code,
            "status": payment_request.status,
            "provider": payment_request.provider,
            "amount": str(payment_request.amount),
            "created": created,
        },
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="payment.request_created" if created else "payment.request_reused",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"request_code": payment_request.request_code, "amount": str(payment_request.amount)},
    )
    db.session.commit()

    generate_or_refresh_hosted_checkout(payment_request.id, actor_user_id=actor_user_id, force_new=force_new_link)
    if send_email:
        queue_payment_link_email(
            payment_request.id,
            actor_user_id=actor_user_id,
            language=language or reservation.booking_language,
            resend=not created,
        )
    return db.session.get(PaymentRequest, payment_request.id)


def generate_or_refresh_hosted_checkout(
    payment_request_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID | None,
    force_new: bool = False,
) -> PaymentRequest:
    payment_request = (
        db.session.execute(
            sa.select(PaymentRequest)
            .where(PaymentRequest.id == payment_request_id)
            .with_for_update()
        )
        .scalars()
        .first()
    )
    if not payment_request:
        raise ValueError("Payment request not found.")
    reservation = db.session.get(Reservation, payment_request.reservation_id)
    guest = db.session.get(Guest, reservation.primary_guest_id) if reservation else None
    if not reservation:
        raise ValueError("Reservation not found.")
    if payment_request.status == "paid":
        return payment_request
    if payment_request.status in {"failed", "expired", "cancelled"} and not force_new:
        payment_request.status = "pending"

    if (
        not force_new
        and payment_request.payment_url
        and as_utc(payment_request.expires_at)
        and as_utc(payment_request.expires_at) > utc_now()
    ):
        return payment_request

    provider = get_payment_provider(payment_request.provider)
    result = provider.create_checkout(payment_request, reservation, guest)
    metadata = dict(payment_request.metadata_json or {})
    metadata.update(result.metadata or {})
    payment_request.payment_url = result.checkout_url
    payment_request.provider_reference = result.provider_reference
    payment_request.provider_payment_reference = result.provider_payment_reference
    payment_request.provider_status = result.provider_status
    payment_request.checkout_created_at = utc_now()
    payment_request.expires_at = result.expires_at
    payment_request.metadata_json = metadata
    payment_request.updated_by_user_id = actor_user_id
    _append_payment_event(
        payment_request=payment_request,
        reservation=reservation,
        event_type="payment.checkout_created",
        amount=money(payment_request.amount),
        provider_event_id=None,
        raw_payload={
            "provider_reference": result.provider_reference,
            "expires_at": result.expires_at.isoformat() if result.expires_at else None,
        },
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="payment.checkout_created",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"request_code": payment_request.request_code},
    )
    db.session.commit()
    return payment_request


def queue_payment_link_email(
    payment_request_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID | None,
    language: str | None = None,
    resend: bool = False,
) -> EmailOutbox:
    payment_request = db.session.get(PaymentRequest, payment_request_id)
    if not payment_request:
        raise ValueError("Payment request not found.")
    reservation = db.session.get(Reservation, payment_request.reservation_id)
    guest = db.session.get(Guest, reservation.primary_guest_id) if reservation else None
    if not reservation or not guest:
        raise ValueError("Reservation not found.")
    if payment_request.status != "pending":
        raise ValueError("Only pending payment requests can be sent.")
    if not payment_request.payment_url:
        raise ValueError("Hosted payment link has not been generated.")
    now = utc_now()
    recent_cutoff = now - timedelta(seconds=payment_link_resend_cooldown_seconds())
    if payment_request.last_sent_at and (as_utc(payment_request.last_sent_at) or now) > recent_cutoff:
        raise ValueError("Payment link was sent recently. Please wait before resending.")
    email_language = normalize_language(language or reservation.booking_language)
    notification_delivery_ids = queue_deposit_request_email(
        reservation,
        payment_request,
        actor_user_id=actor_user_id,
        language_code=email_language,
        resend=resend,
    )
    payment_request.last_sent_at = now
    _append_payment_event(
        payment_request=payment_request,
        reservation=reservation,
        event_type="payment.link_resent" if resend else "payment.link_sent",
        amount=money(payment_request.amount),
        provider_event_id=None,
        raw_payload={"email": guest.email},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="payment.link_resent" if resend else "payment.link_sent",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"request_code": payment_request.request_code},
    )
    notification_delivery_ids.extend(
        queue_internal_activity_alert(
            reservation,
            payment_request=payment_request,
            actor_user_id=actor_user_id,
            summary=(
                f"Deposit payment link {'resent' if resend else 'sent'} for "
                f"{reservation.reservation_code} ({payment_request.request_code})."
            ),
            event_code="payment.deposit_request_sent",
            manual=resend,
        )
    )
    db.session.commit()
    dispatch_notification_deliveries(notification_delivery_ids)
    for item in query_notification_history(payment_request_id=payment_request.id, limit=20):
        if item.email_outbox_id and item.event_type == "payment.deposit_request_email":
            outbox = db.session.get(EmailOutbox, item.email_outbox_id)
            if outbox:
                return outbox
    raise ValueError("Deposit payment email outbox entry could not be loaded.")


def resend_payment_link(
    payment_request_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID | None,
    force_new: bool = False,
) -> PaymentRequest:
    refreshed = generate_or_refresh_hosted_checkout(payment_request_id, actor_user_id=actor_user_id, force_new=force_new)
    reservation = db.session.get(Reservation, refreshed.reservation_id)
    queue_payment_link_email(
        refreshed.id,
        actor_user_id=actor_user_id,
        language=reservation.booking_language if reservation else "th",
        resend=True,
    )
    return db.session.get(PaymentRequest, refreshed.id)


def public_payment_context(request_code: str, reservation_code: str, token: str) -> tuple[Reservation, PaymentRequest]:
    reservation = Reservation.query.filter_by(
        reservation_code=reservation_code,
        created_from_public_booking_flow=True,
    ).first()
    if not reservation or not reservation.public_confirmation_token:
        raise LookupError("Payment request not found.")
    if not hmac.compare_digest(reservation.public_confirmation_token, token):
        raise LookupError("Payment request not found.")
    payment_request = PaymentRequest.query.filter_by(
        reservation_id=reservation.id,
        request_code=request_code,
    ).first()
    if not payment_request:
        raise LookupError("Payment request not found.")
    return reservation, payment_request


def handle_public_payment_start(request_code: str, reservation_code: str, token: str) -> PaymentRequest:
    reservation, payment_request = public_payment_context(request_code, reservation_code, token)
    if payment_request.status == "paid":
        return payment_request
    if payment_request.status == "expired":
        raise ValueError("Payment request has expired.")
    if payment_request.status == "cancelled":
        raise ValueError("Payment request is no longer active.")
    payment_request = generate_or_refresh_hosted_checkout(payment_request.id, actor_user_id=None, force_new=False)
    _append_payment_event(
        payment_request=payment_request,
        reservation=reservation,
        event_type="payment.entry_viewed",
        amount=money(payment_request.amount),
        provider_event_id=None,
        raw_payload={"path": "public_payment_start"},
    )
    db.session.commit()
    return payment_request


def load_public_payment_return(request_code: str, reservation_code: str, token: str) -> dict:
    reservation, payment_request = public_payment_context(request_code, reservation_code, token)
    if payment_request.status == "pending":
        synced = sync_payment_request_status(payment_request.id, actor_user_id=None, swallow_errors=True)
        if synced:
            payment_request = synced
    _append_payment_event(
        payment_request=payment_request,
        reservation=reservation,
        event_type="payment.return_viewed",
        amount=money(payment_request.amount),
        provider_event_id=None,
        raw_payload={"path": "public_payment_return"},
    )
    db.session.commit()
    return {
        "reservation": reservation,
        "payment_request": payment_request,
        "guest": db.session.get(Guest, reservation.primary_guest_id),
        "payment_entry_url": guest_payment_entry_url(payment_request, reservation, external=False),
    }


def sync_payment_request_status(
    payment_request_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID | None,
    swallow_errors: bool = False,
) -> PaymentRequest | None:
    payment_request = db.session.get(PaymentRequest, payment_request_id)
    if not payment_request:
        raise ValueError("Payment request not found.")
    provider = get_payment_provider(payment_request.provider)
    try:
        event = provider.retrieve_status(payment_request)
    except Exception:
        if swallow_errors:
            return payment_request
        raise
    if not event:
        return payment_request
    _, delivery_ids = _apply_provider_event(event, provider.provider_name, actor_user_id=actor_user_id)
    db.session.commit()
    dispatch_notification_deliveries(delivery_ids)
    return db.session.get(PaymentRequest, payment_request_id)


def process_payment_webhook(provider_name: str, payload: bytes, headers: dict[str, str]) -> dict:
    provider = get_payment_provider(provider_name)
    events = provider.verify_and_parse_webhook(payload, headers)
    processed = 0
    duplicates = 0
    delivery_ids: list[uuid.UUID] = []
    for event in events:
        outcome, new_delivery_ids = _apply_provider_event(event, provider.provider_name, actor_user_id=None)
        delivery_ids.extend(new_delivery_ids)
        if outcome == "duplicate":
            duplicates += 1
        else:
            processed += 1
    db.session.commit()
    dispatch_notification_deliveries(delivery_ids)
    return {"processed": processed, "duplicates": duplicates}


def sign_test_hosted_webhook(payload: bytes) -> str:
    secret = current_app.config.get("TEST_HOSTED_PAYMENT_SECRET", "")
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def _public_url(endpoint: str, *, external: bool, **values: str) -> str:
    if has_request_context():
        return url_for(endpoint, _external=external, **values)
    request_code = values["request_code"]
    query_string = urllib.parse.urlencode(
        {
            "reservation_code": values["reservation_code"],
            "token": values["token"],
        }
    )
    route_map = {
        "public_payment_start": f"/payments/request/{request_code}",
        "public_payment_return": f"/payments/return/{request_code}",
    }
    relative_url = f"{route_map[endpoint]}?{query_string}"
    if not external:
        return relative_url
    base_url = str(current_app.config.get("APP_BASE_URL") or "").strip().rstrip("/")
    if not base_url:
        raise RuntimeError("APP_BASE_URL must be configured for hosted payment links.")
    return f"{base_url}{relative_url}"


def guest_payment_entry_url(payment_request: PaymentRequest, reservation: Reservation, *, external: bool) -> str:
    return _public_url(
        "public_payment_start",
        request_code=payment_request.request_code,
        reservation_code=reservation.reservation_code,
        token=reservation.public_confirmation_token,
        external=external,
    )


def payment_return_url(payment_request: PaymentRequest, reservation: Reservation, *, external: bool) -> str:
    return _public_url(
        "public_payment_return",
        request_code=payment_request.request_code,
        reservation_code=reservation.reservation_code,
        token=reservation.public_confirmation_token,
        external=external,
    )


def render_payment_request_email(
    reservation: Reservation,
    guest_name: str,
    payment_request: PaymentRequest,
    language: str,
    payment_link: str,
) -> str:
    return render_payment_request_message(reservation, guest_name, payment_request, language, payment_link)[1]


def render_payment_request_message(
    reservation: Reservation,
    guest_name: str,
    payment_request: PaymentRequest,
    language: str,
    payment_link: str,
) -> tuple[str, str]:
    context = {
        "hotel_name": str(get_setting_value("hotel.name", "Sandbox Hotel")),
        "guest_name": guest_name,
        "reservation_code": reservation.reservation_code,
        "deposit_amount": f"{money(payment_request.amount):,.2f}",
        "payment_link": payment_link,
        "contact_phone": str(get_setting_value("hotel.contact_phone", "+66 000 000 000")),
        "contact_email": str(get_setting_value("hotel.contact_email", "reservations@sandbox-hotel.local")),
        "check_in_policy": policy_text("check_in_policy", language, t(language, "checkin_summary")),
    }
    fallback_subject = t(language, "payment_email_subject", reference=reservation.reservation_code)
    fallback_body = "\n".join(
        [
            f"{context['hotel_name']} - {reservation.reservation_code}",
            guest_name,
            t(language, "payment_email_intro", amount=f"THB {money(payment_request.amount):,.2f}"),
            payment_link,
            context["check_in_policy"],
            f"Contact: {context['contact_phone']} / {context['contact_email']}",
        ]
    )
    return render_notification_template(
        "deposit_payment_request",
        language,
        context,
        fallback_subject=fallback_subject,
        fallback_body=fallback_body,
    )


def _append_payment_event(
    *,
    payment_request: PaymentRequest | None,
    reservation: Reservation | None,
    event_type: str,
    amount: Decimal | None,
    provider_event_id: str | None,
    raw_payload: dict | None,
    provider: str | None = None,
) -> PaymentEvent:
    event = PaymentEvent(
        payment_request_id=payment_request.id if payment_request else None,
        reservation_id=reservation.id if reservation else None,
        event_type=event_type,
        amount=money(amount) if amount is not None else None,
        currency_code=payment_request.currency_code if payment_request else "THB",
        provider=provider or (payment_request.provider if payment_request else None),
        provider_event_id=provider_event_id,
        raw_payload=raw_payload,
        processed_at=utc_now(),
        created_by_user_id=None,
    )
    db.session.add(event)
    return event


def _apply_provider_event(
    event: NormalizedProviderEvent,
    provider_name: str,
    *,
    actor_user_id: uuid.UUID | None,
) -> tuple[str, list[uuid.UUID]]:
    if event.provider_event_id:
        duplicate = PaymentEvent.query.filter_by(provider=provider_name, provider_event_id=event.provider_event_id).first()
        if duplicate:
            return "duplicate", []

    payment_request = _resolve_payment_request_for_update(provider_name, event)
    reservation = db.session.get(Reservation, payment_request.reservation_id) if payment_request else None
    event_row = _append_payment_event(
        payment_request=payment_request,
        reservation=reservation,
        event_type=event.event_type,
        amount=event.amount,
        provider_event_id=event.provider_event_id,
        raw_payload=event.raw_payload,
        provider=provider_name,
    )
    if not payment_request or not reservation:
        write_activity_log(
            actor_user_id=actor_user_id,
            event_type="payment.orphan_event_received",
            entity_table="payment_events",
            entity_id=str(event_row.id),
            metadata={"provider": provider_name},
        )
        return "processed", []

    previous_status = payment_request.status
    notification_delivery_ids: list[uuid.UUID] = []
    payment_request.provider = provider_name
    if event.provider_reference:
        payment_request.provider_reference = event.provider_reference
    if event.provider_payment_reference:
        payment_request.provider_payment_reference = event.provider_payment_reference
    payment_request.provider_status = event.provider_status or event.normalized_status
    payment_request.last_synced_at = utc_now()
    payment_request.status = event.normalized_status
    if event.normalized_status == "paid":
        payment_request.paid_at = payment_request.paid_at or utc_now()
        _apply_paid_deposit(payment_request, reservation, actor_user_id=actor_user_id, event=event)
        notification_delivery_ids.extend(
            queue_payment_success_email(
                reservation,
                payment_request,
                actor_user_id=actor_user_id,
                language_code=reservation.booking_language,
            )
        )
        notification_delivery_ids.extend(
            queue_internal_activity_alert(
                reservation,
                payment_request=payment_request,
                actor_user_id=actor_user_id,
                summary=(
                    f"Deposit payment {payment_request.request_code} was confirmed as paid "
                    f"for {reservation.reservation_code}."
                ),
                event_code="payment.deposit_paid",
                manual=False,
            )
        )
    elif event.normalized_status == "failed":
        payment_request.failed_at = utc_now()
        notification_delivery_ids.extend(
            queue_internal_activity_alert(
                reservation,
                payment_request=payment_request,
                actor_user_id=actor_user_id,
                summary=(
                    f"Deposit payment {payment_request.request_code} failed "
                    f"for {reservation.reservation_code}."
                ),
                event_code="payment.deposit_failed",
                manual=False,
            )
        )
    elif event.normalized_status == "expired":
        payment_request.expired_at = utc_now()
        notification_delivery_ids.extend(
            queue_internal_activity_alert(
                reservation,
                payment_request=payment_request,
                actor_user_id=actor_user_id,
                summary=(
                    f"Deposit payment link {payment_request.request_code} expired "
                    f"for {reservation.reservation_code}."
                ),
                event_code="payment.deposit_expired",
                manual=False,
            )
        )
    elif event.normalized_status == "cancelled":
        payment_request.cancelled_at = utc_now()
        notification_delivery_ids.extend(
            queue_internal_activity_alert(
                reservation,
                payment_request=payment_request,
                actor_user_id=actor_user_id,
                summary=(
                    f"Deposit payment request {payment_request.request_code} was cancelled "
                    f"for {reservation.reservation_code}."
                ),
                event_code="payment.deposit_cancelled",
                manual=False,
            )
        )

    _sync_review_queue_deposit_state(reservation)
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="payment_requests",
        entity_id=str(payment_request.id),
        action="payment_status_sync",
        before_data={"status": previous_status},
        after_data={
            "status": payment_request.status,
            "provider_reference": payment_request.provider_reference,
            "provider_payment_reference": payment_request.provider_payment_reference,
        },
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type=f"payment.status_{payment_request.status}",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"request_code": payment_request.request_code},
    )
    return "processed", notification_delivery_ids


def _apply_paid_deposit(
    payment_request: PaymentRequest,
    reservation: Reservation,
    *,
    actor_user_id: uuid.UUID | None,
    event: NormalizedProviderEvent,
) -> None:
    record_payment(
        reservation.id,
        PaymentPostingPayload(
            amount=money(payment_request.amount),
            payment_method="card",
            note=f"Hosted deposit payment {payment_request.request_code}",
            request_type=payment_request.request_type,
            related_payment_request_id=payment_request.id,
            is_deposit=True,
            posting_key=f"provider_deposit:{payment_request.id}",
            provider_reference=payment_request.provider_reference,
            provider_payment_reference=payment_request.provider_payment_reference,
            metadata={
                "source": "hosted_checkout",
                "provider_event_id": event.provider_event_id,
            },
        ),
        actor_user_id=actor_user_id,
        commit=False,
    )
    if reservation.current_status == "tentative" and money(reservation.deposit_received_amount) >= money(reservation.deposit_required_amount):
        reservation.current_status = "confirmed"
        db.session.add(
            ReservationStatusHistory(
                reservation_id=reservation.id,
                old_status="tentative",
                new_status="confirmed",
                reason="deposit_paid",
                note=f"Deposit paid via {payment_request.provider}",
                changed_by_user_id=actor_user_id,
            )
        )


def _resolve_payment_request_for_update(provider_name: str, event: NormalizedProviderEvent) -> PaymentRequest | None:
    query = sa.select(PaymentRequest)
    if event.payment_request_id:
        try:
            payment_request_id = uuid.UUID(str(event.payment_request_id))
        except ValueError:
            payment_request_id = None
        if payment_request_id:
            return (
                db.session.execute(query.where(PaymentRequest.id == payment_request_id).with_for_update())
                .scalars()
                .first()
            )
    if event.request_code:
        return (
            db.session.execute(query.where(PaymentRequest.request_code == event.request_code).with_for_update())
            .scalars()
            .first()
        )
    if event.provider_reference:
        return (
            db.session.execute(
                query.where(
                    PaymentRequest.provider == provider_name,
                    PaymentRequest.provider_reference == event.provider_reference,
                ).with_for_update()
            )
            .scalars()
            .first()
        )
    if event.provider_payment_reference:
        return (
            db.session.execute(
                query.where(
                    PaymentRequest.provider == provider_name,
                    PaymentRequest.provider_payment_reference == event.provider_payment_reference,
                ).with_for_update()
            )
            .scalars()
            .first()
        )
    return None


def _sync_review_queue_deposit_state(reservation: Reservation) -> None:
    entry = ReservationReviewQueue.query.filter_by(reservation_id=reservation.id).first()
    if not entry:
        return
    required_amount = money(reservation.deposit_required_amount)
    received_amount = money(reservation.deposit_received_amount)
    latest_request = (
        PaymentRequest.query.filter_by(reservation_id=reservation.id)
        .order_by(PaymentRequest.created_at.desc())
        .first()
    )
    if required_amount <= Decimal("0.00"):
        entry.deposit_state = "no_deposit"
    elif received_amount >= required_amount:
        entry.deposit_state = "deposit_paid"
    elif received_amount > Decimal("0.00"):
        entry.deposit_state = "deposit_partial"
    elif latest_request and latest_request.status == "failed":
        entry.deposit_state = "deposit_failed"
    elif latest_request and latest_request.status == "expired":
        entry.deposit_state = "deposit_expired"
    else:
        entry.deposit_state = "deposit_pending"


def normalize_provider_status(value: str) -> str:
    normalized = (value or "").strip().lower()
    if normalized in {"paid", "succeeded", "success", "complete", "completed"}:
        return "paid"
    if normalized in {"failed", "failure"}:
        return "failed"
    if normalized == "expired":
        return "expired"
    if normalized in {"cancelled", "canceled"}:
        return "cancelled"
    return "pending"


def _stripe_status_to_internal(event_type: str, data: dict) -> str:
    payment_status = str(data.get("payment_status") or "").lower()
    checkout_status = str(data.get("status") or "").lower()
    normalized_event = (event_type or "").lower()
    if normalized_event == "checkout.session.expired" or checkout_status == "expired":
        return "expired"
    if normalized_event == "checkout.session.async_payment_failed":
        return "failed"
    if payment_status == "paid" or normalized_event in {"checkout.session.completed", "checkout.session.async_payment_succeeded"}:
        return "paid"
    if checkout_status == "open":
        return "pending"
    return "pending"


def _stripe_request(
    method: str,
    path: str,
    *,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> dict:
    request_headers = {"Authorization": f"Bearer {current_app.config['STRIPE_SECRET_KEY']}"}
    request_headers.update(headers or {})
    request_obj = urllib.request.Request(
        f"{current_app.config['STRIPE_API_BASE'].rstrip('/')}{path}",
        data=body,
        method=method,
        headers=request_headers,
    )
    try:
        with urllib.request.urlopen(request_obj, timeout=15) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="ignore")
        raise ValueError(f"Stripe request failed: {payload[:255]}") from exc


def _verify_stripe_signature(payload: bytes, signature_header: str, secret: str, tolerance_seconds: int) -> None:
    parts: dict[str, list[str]] = {}
    for fragment in signature_header.split(","):
        if "=" not in fragment:
            continue
        key, value = fragment.split("=", 1)
        parts.setdefault(key, []).append(value)
    timestamp = parts.get("t", [None])[0]
    signatures = parts.get("v1", [])
    if not timestamp or not signatures:
        raise ValueError("Missing Stripe webhook signature.")
    signed_payload = f"{timestamp}.{payload.decode('utf-8')}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, candidate) for candidate in signatures):
        raise ValueError("Invalid Stripe webhook signature.")
    if abs(int(utc_now().timestamp()) - int(timestamp)) > tolerance_seconds:
        raise ValueError("Stripe webhook signature is outside tolerance.")
