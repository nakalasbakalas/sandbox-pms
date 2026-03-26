"""Unified Guest Messaging Hub service.

Provides conversation management, message sending/receiving, channel adapter
dispatch, template rendering, and automation hook infrastructure.
"""
from __future__ import annotations

import abc
import json
import logging
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

import sqlalchemy as sa
from flask import current_app
from sqlalchemy.orm import joinedload

from ..audit import write_audit_log
from ..extensions import db
from ..models import (
    AutoResponseRule,
    AutomationRule,
    ConversationThread,
    DeliveryAttempt,
    Guest,
    Message,
    MessageTemplate,
    PendingAutomationEvent,
    Reservation,
    utc_now,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data-transfer objects
# ---------------------------------------------------------------------------


@dataclass
class InboxFilters:
    channel: str = ""
    status: str = ""
    unread_only: bool = False
    needs_followup: bool = False
    reservation_status: str = ""
    search: str = ""
    assigned_user_id: str = ""
    page: int = 1
    per_page: int = 25


@dataclass
class ComposePayload:
    thread_id: str | None = None
    guest_id: str | None = None
    reservation_id: str | None = None
    channel: str = "email"
    subject: str = ""
    body_text: str = ""
    is_internal_note: bool = False
    template_key: str | None = None
    recipient_address: str | None = None


@dataclass
class InboxEntry:
    thread_id: str = ""
    guest_name: str = ""
    reservation_code: str = ""
    reservation_status: str = ""
    channel: str = ""
    subject: str = ""
    last_message_preview: str = ""
    last_message_at: datetime | None = None
    unread_count: int = 0
    status: str = "open"
    is_needs_followup: bool = False
    assigned_user_name: str = ""


@dataclass
class ThreadDetail:
    thread: ConversationThread | None = None
    messages: list[Message] = field(default_factory=list)
    guest: Guest | None = None
    reservation: Reservation | None = None


# ---------------------------------------------------------------------------
# Channel Adapter abstraction
# ---------------------------------------------------------------------------


class ChannelAdapter(abc.ABC):
    """Base class for channel-specific delivery."""

    @abc.abstractmethod
    def send(self, message: Message, thread: ConversationThread) -> dict[str, Any]:
        """Send a message and return provider metadata.

        Returns dict with keys: success (bool), provider_message_id (str|None),
        error (str|None).
        """

    @abc.abstractmethod
    def channel_name(self) -> str:
        ...


class EmailAdapter(ChannelAdapter):
    """Email delivery via SMTP or sandbox mock."""

    def channel_name(self) -> str:
        return "email"

    def send(self, message: Message, thread: ConversationThread) -> dict[str, Any]:
        smtp_host = current_app.config.get("SMTP_HOST")
        if not smtp_host:
            logger.info("EmailAdapter: SMTP not configured, using sandbox mock mode")
            return {
                "success": True,
                "provider_message_id": f"mock-email-{uuid.uuid4().hex[:12]}",
                "error": None,
                "mock": True,
            }

        import smtplib
        import ssl
        from email.message import EmailMessage

        msg = EmailMessage()
        msg["Subject"] = message.subject or thread.subject or "Message from hotel"
        msg["From"] = current_app.config.get("MAIL_FROM", "noreply@sandbox.local")
        msg["To"] = message.recipient_address or ""
        msg.set_content(message.body_text)

        try:
            with smtplib.SMTP(smtp_host, current_app.config.get("SMTP_PORT", 587), timeout=15) as client:
                if current_app.config.get("SMTP_USE_TLS"):
                    client.starttls(context=ssl.create_default_context())
                username = current_app.config.get("SMTP_USERNAME")
                if username:
                    client.login(username, current_app.config.get("SMTP_PASSWORD", ""))
                client.send_message(msg)
            return {"success": True, "provider_message_id": None, "error": None}
        except Exception as exc:
            return {"success": False, "provider_message_id": None, "error": str(exc)[:500]}


class SmsAdapter(ChannelAdapter):
    """SMS delivery stub (sandbox/mock only)."""

    def channel_name(self) -> str:
        return "sms"

    def send(self, message: Message, thread: ConversationThread) -> dict[str, Any]:
        logger.info("SmsAdapter: sandbox mock — no live SMS provider configured")
        return {
            "success": True,
            "provider_message_id": f"mock-sms-{uuid.uuid4().hex[:12]}",
            "error": None,
            "mock": True,
        }


class WhatsAppAdapter(ChannelAdapter):
    """WhatsApp delivery stub."""

    def channel_name(self) -> str:
        return "whatsapp"

    def send(self, message: Message, thread: ConversationThread) -> dict[str, Any]:
        webhook_url = current_app.config.get("WHATSAPP_STAFF_ALERT_WEBHOOK_URL")
        if not webhook_url:
            logger.info("WhatsAppAdapter: sandbox mock — no webhook URL configured")
            return {
                "success": True,
                "provider_message_id": f"mock-wa-{uuid.uuid4().hex[:12]}",
                "error": None,
                "mock": True,
            }
        logger.info("WhatsAppAdapter: webhook URL configured but full API integration pending")
        return {
            "success": True,
            "provider_message_id": f"stub-wa-{uuid.uuid4().hex[:12]}",
            "error": None,
            "mock": True,
        }


class InternalNoteAdapter(ChannelAdapter):
    """Internal notes never leave the PMS."""

    def channel_name(self) -> str:
        return "internal_note"

    def send(self, message: Message, thread: ConversationThread) -> dict[str, Any]:
        return {"success": True, "provider_message_id": None, "error": None}


class ManualCallLogAdapter(ChannelAdapter):
    """Call log entries are recorded only; no dispatch."""

    def channel_name(self) -> str:
        return "manual_call_log"

    def send(self, message: Message, thread: ConversationThread) -> dict[str, Any]:
        return {"success": True, "provider_message_id": None, "error": None}


class OtaMessageAdapter(ChannelAdapter):
    """OTA message stub for future channel manager integration."""

    def channel_name(self) -> str:
        return "ota_message"

    def send(self, message: Message, thread: ConversationThread) -> dict[str, Any]:
        logger.info("OtaMessageAdapter: stub — not connected to any OTA messaging API")
        return {
            "success": True,
            "provider_message_id": f"mock-ota-{uuid.uuid4().hex[:12]}",
            "error": None,
            "mock": True,
        }


def _send_via_webhook(
    url: str,
    payload: dict[str, Any],
    *,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    request_headers = {"Content-Type": "application/json", **(headers or {})}
    request_obj = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers=request_headers,
    )
    try:
        with urllib.request.urlopen(request_obj, timeout=15) as response:  # noqa: S310
            response_body = response.read().decode("utf-8", errors="ignore")
            provider_message_id = (
                response.headers.get("X-Line-Request-Id")
                or response.headers.get("X-Request-Id")
                or response_body[:120]
                or f"webhook-{getattr(response, 'status', 200)}"
            )
            return {
                "success": 200 <= getattr(response, "status", 200) < 300,
                "provider_message_id": provider_message_id,
                "error": None,
            }
    except urllib.error.URLError as exc:
        return {"success": False, "provider_message_id": None, "error": str(exc)[:500]}


class WebhookSmsAdapter(ChannelAdapter):
    """SMS delivery via the pluggable SMS provider (twilio / webhook / log).

    Delegates to :func:`sms_provider.send_sms` which reads the ``SMS_PROVIDER``
    config key.  Falls back to the outbound webhook if the provider is not
    configured.
    """

    def channel_name(self) -> str:
        return "sms"

    def send(self, message: Message, thread: ConversationThread) -> dict[str, Any]:
        if not message.recipient_address:
            return {"success": False, "provider_message_id": None, "error": "SMS recipient is required."}

        from .sms_provider import send_sms as provider_send_sms

        result = provider_send_sms(to=message.recipient_address, body=message.body_text)

        return {
            "success": result.get("ok", False),
            "provider_message_id": result.get("sid"),
            "error": result.get("error"),
            "mock": result.get("mock", False),
        }


class LineAdapter(ChannelAdapter):
    """Guest-facing LINE delivery via push API or configured webhook."""

    def channel_name(self) -> str:
        return "line"

    def send(self, message: Message, thread: ConversationThread) -> dict[str, Any]:
        recipient = (message.recipient_address or "").strip()
        if not recipient:
            return {"success": False, "provider_message_id": None, "error": "LINE recipient is required."}

        channel_access_token = str(current_app.config.get("LINE_CHANNEL_ACCESS_TOKEN", "") or "").strip()
        if channel_access_token:
            base_url = str(current_app.config.get("LINE_API_BASE", "https://api.line.me") or "https://api.line.me").rstrip("/")
            return _send_via_webhook(
                f"{base_url}/v2/bot/message/push",
                {
                    "to": recipient,
                    "messages": [{"type": "text", "text": message.body_text}],
                },
                headers={"Authorization": f"Bearer {channel_access_token}"},
            )

        webhook_url = str(current_app.config.get("LINE_OUTBOUND_WEBHOOK_URL", "") or "").strip()
        if webhook_url:
            return _send_via_webhook(
                webhook_url,
                {
                    "channel": "line",
                    "to": recipient,
                    "body_text": message.body_text,
                    "subject": message.subject,
                    "thread_id": str(thread.id),
                    "message_id": str(message.id),
                },
            )

        logger.info("LineAdapter: sandbox mock - no LINE delivery integration configured")
        return {
            "success": True,
            "provider_message_id": f"mock-line-{uuid.uuid4().hex[:12]}",
            "error": None,
            "mock": True,
        }


class WebhookWhatsAppAdapter(ChannelAdapter):
    """WhatsApp delivery via outbound webhook or sandbox mock."""

    def channel_name(self) -> str:
        return "whatsapp"

    def send(self, message: Message, thread: ConversationThread) -> dict[str, Any]:
        webhook_url = str(current_app.config.get("WHATSAPP_OUTBOUND_WEBHOOK_URL", "") or "").strip()
        if not webhook_url:
            logger.info("WebhookWhatsAppAdapter: sandbox mock - no guest WhatsApp webhook configured")
            return {
                "success": True,
                "provider_message_id": f"mock-wa-{uuid.uuid4().hex[:12]}",
                "error": None,
                "mock": True,
            }
        if not message.recipient_address:
            return {"success": False, "provider_message_id": None, "error": "WhatsApp recipient is required."}
        return _send_via_webhook(
            webhook_url,
            {
                "channel": "whatsapp",
                "to": message.recipient_address,
                "body_text": message.body_text,
                "subject": message.subject,
                "thread_id": str(thread.id),
                "message_id": str(message.id),
            },
        )


_ADAPTERS: dict[str, ChannelAdapter] = {
    "email": EmailAdapter(),
    "sms": WebhookSmsAdapter(),
    "line": LineAdapter(),
    "whatsapp": WebhookWhatsAppAdapter(),
    "internal_note": InternalNoteAdapter(),
    "manual_call_log": ManualCallLogAdapter(),
    "ota_message": OtaMessageAdapter(),
}


def get_adapter(channel: str) -> ChannelAdapter:
    adapter = _ADAPTERS.get(channel)
    if not adapter:
        raise ValueError(f"No adapter for channel: {channel}")
    return adapter


# ---------------------------------------------------------------------------
# Inbox / conversation listing
# ---------------------------------------------------------------------------


def list_inbox(filters: InboxFilters) -> tuple[list[InboxEntry], int]:
    """Return paginated inbox entries with total count."""
    query = (
        sa.select(ConversationThread)
        .options(
            joinedload(ConversationThread.guest),
            joinedload(ConversationThread.reservation),
            joinedload(ConversationThread.assigned_user),
        )
        .where(ConversationThread.status != "archived")
    )

    if filters.channel:
        query = query.where(ConversationThread.channel == filters.channel)
    if filters.status:
        query = query.where(ConversationThread.status == filters.status)
    if filters.unread_only:
        query = query.where(ConversationThread.unread_count > 0)
    if filters.needs_followup:
        query = query.where(ConversationThread.is_needs_followup.is_(True))
    if filters.assigned_user_id:
        query = query.where(
            ConversationThread.assigned_user_id == uuid.UUID(filters.assigned_user_id)
        )

    if filters.reservation_status:
        query = query.join(
            Reservation,
            ConversationThread.reservation_id == Reservation.id,
            isouter=True,
        )
        rs = filters.reservation_status
        if rs == "arrivals_today":
            from datetime import date
            today = date.today()
            query = query.where(Reservation.check_in_date == today)
            query = query.where(Reservation.current_status.in_(["confirmed", "tentative"]))
        elif rs == "in_house":
            query = query.where(Reservation.current_status == "checked_in")
        elif rs == "post_stay":
            query = query.where(Reservation.current_status == "checked_out")
        elif rs == "no_reservation":
            query = query.where(ConversationThread.reservation_id.is_(None))
        else:
            query = query.where(Reservation.current_status == rs)

    if filters.search:
        search_term = f"%{filters.search}%"
        query = query.where(
            sa.or_(
                ConversationThread.subject.ilike(search_term),
                ConversationThread.guest_contact_value.ilike(search_term),
                ConversationThread.last_message_preview.ilike(search_term),
                ConversationThread.guest.has(Guest.full_name.ilike(search_term)),
                ConversationThread.guest.has(Guest.phone.ilike(search_term)),
                ConversationThread.guest.has(Guest.email.ilike(search_term)),
                ConversationThread.reservation.has(
                    Reservation.reservation_code.ilike(search_term)
                ),
            )
        )

    total = db.session.execute(
        sa.select(sa.func.count()).select_from(query.order_by(None).subquery())
    ).scalar_one()
    threads = (
        db.session.execute(
            query
            .order_by(ConversationThread.last_message_at.desc().nullslast())
            .offset((filters.page - 1) * filters.per_page)
            .limit(filters.per_page)
        )
        .unique()
        .scalars()
        .all()
    )

    entries = []
    for t in threads:
        guest = t.guest
        reservation = t.reservation
        entries.append(
            InboxEntry(
                thread_id=str(t.id),
                guest_name=guest.full_name if guest else (t.guest_contact_value or "Unknown"),
                reservation_code=reservation.reservation_code if reservation else "",
                reservation_status=reservation.current_status if reservation else "",
                channel=t.channel,
                subject=t.subject or "",
                last_message_preview=t.last_message_preview or "",
                last_message_at=t.last_message_at,
                unread_count=t.unread_count,
                status=t.status,
                is_needs_followup=t.is_needs_followup,
                assigned_user_name=(
                    t.assigned_user.full_name if t.assigned_user else ""
                ),
            )
        )
    return entries, total


# ---------------------------------------------------------------------------
# Thread detail
# ---------------------------------------------------------------------------


def get_thread_detail(thread_id: str) -> ThreadDetail | None:
    thread = (
        db.session.execute(
            sa.select(ConversationThread)
            .options(
            joinedload(ConversationThread.guest),
            joinedload(ConversationThread.reservation),
            joinedload(ConversationThread.assigned_user),
        )
            .where(ConversationThread.id == uuid.UUID(thread_id))
        )
        .unique()
        .scalars()
        .first()
    )
    if not thread:
        return None

    messages = (
        db.session.execute(
            sa.select(Message)
            .where(Message.thread_id == thread.id)
            .order_by(Message.created_at.asc())
        )
        .scalars()
        .all()
    )

    return ThreadDetail(
        thread=thread,
        messages=messages,
        guest=thread.guest,
        reservation=thread.reservation,
    )


# ---------------------------------------------------------------------------
# Thread creation / lookup
# ---------------------------------------------------------------------------


def get_or_create_thread(
    *,
    guest_id: str | None = None,
    reservation_id: str | None = None,
    channel: str = "email",
    subject: str | None = None,
    actor_user_id: str | None = None,
    guest_contact_value: str | None = None,
) -> ConversationThread:
    """Find existing open thread or create a new one."""
    query = sa.select(ConversationThread).where(
        ConversationThread.status.in_(["open", "waiting"])
    )
    if reservation_id:
        query = query.where(ConversationThread.reservation_id == uuid.UUID(reservation_id))
    if guest_id:
        query = query.where(ConversationThread.guest_id == uuid.UUID(guest_id))
    if channel:
        query = query.where(ConversationThread.channel == channel)

    existing = (
        db.session.execute(query.order_by(ConversationThread.last_message_at.desc().nullslast()))
        .scalars()
        .first()
    )
    if existing:
        return existing

    now = utc_now()
    thread = ConversationThread(
        guest_id=uuid.UUID(guest_id) if guest_id else None,
        reservation_id=uuid.UUID(reservation_id) if reservation_id else None,
        channel=channel,
        subject=subject,
        status="open",
        assigned_user_id=uuid.UUID(actor_user_id) if actor_user_id else None,
        guest_contact_value=guest_contact_value,
        created_at=now,
        updated_at=now,
        created_by_user_id=uuid.UUID(actor_user_id) if actor_user_id else None,
    )
    db.session.add(thread)
    db.session.flush()
    return thread


def link_thread_to_reservation(thread_id: str, reservation_id: str) -> None:
    thread = db.session.get(ConversationThread, uuid.UUID(thread_id))
    if thread:
        thread.reservation_id = uuid.UUID(reservation_id)


# ---------------------------------------------------------------------------
# Send / compose messages
# ---------------------------------------------------------------------------


def send_message(payload: ComposePayload, *, actor_user_id: str | None = None, commit: bool = True) -> Message:
    """Compose and send (or log) a message."""
    now = utc_now()

    guest_contact = payload.recipient_address
    if not guest_contact and payload.guest_id:
        guest = db.session.get(Guest, uuid.UUID(payload.guest_id))
        if guest:
            if payload.channel == "email" and guest.email:
                guest_contact = guest.email
            elif payload.channel in ("sms", "whatsapp") and guest.phone:
                guest_contact = guest.phone

    thread = None
    if payload.thread_id:
        thread = db.session.get(ConversationThread, uuid.UUID(payload.thread_id))

    if not thread:
        thread = get_or_create_thread(
            guest_id=payload.guest_id,
            reservation_id=payload.reservation_id,
            channel=payload.channel,
            subject=payload.subject or None,
            actor_user_id=actor_user_id,
            guest_contact_value=guest_contact,
        )

    if payload.is_internal_note:
        direction = "internal"
    else:
        direction = "outbound"

    actor_uuid = uuid.UUID(actor_user_id) if actor_user_id else None

    message = Message(
        thread_id=thread.id,
        direction=direction,
        channel=payload.channel,
        sender_user_id=actor_uuid,
        recipient_address=guest_contact if not payload.is_internal_note else None,
        subject=payload.subject or thread.subject,
        body_text=payload.body_text,
        status="queued",
        is_internal_note=payload.is_internal_note,
        template_key=payload.template_key,
        created_at=now,
        updated_at=now,
        created_by_user_id=actor_uuid,
    )
    db.session.add(message)
    db.session.flush()

    # Dispatch through channel adapter
    adapter = get_adapter(payload.channel)
    result = adapter.send(message, thread)

    attempt = DeliveryAttempt(
        message_id=message.id,
        channel=payload.channel,
        attempted_at=now,
        status="sent" if result["success"] else "failed",
        provider_response=result.get("provider_message_id"),
        error_detail=result.get("error"),
    )
    db.session.add(attempt)

    if result["success"]:
        message.status = "sent"
        message.sent_at = now
        message.provider_message_id = result.get("provider_message_id")
    else:
        message.status = "failed"
        message.provider_error = result.get("error")

    # Update thread metadata
    preview = payload.body_text[:255] if payload.body_text else ""
    thread.last_message_at = now
    thread.last_message_preview = preview
    thread.updated_at = now

    if actor_user_id:
        write_audit_log(
            actor_user_id=actor_uuid,
            entity_table="messages",
            entity_id=str(message.id),
            action="message.send" if not payload.is_internal_note else "message.internal_note",
            after_data={
                "channel": payload.channel,
                "direction": direction,
                "thread_id": str(thread.id),
                "reservation_id": payload.reservation_id,
            },
        )

    if commit:
        db.session.commit()

    return message


def record_inbound_message(
    *,
    channel: str,
    sender_address: str,
    body_text: str,
    subject: str | None = None,
    provider_message_id: str | None = None,
    guest_id: str | None = None,
    reservation_id: str | None = None,
    metadata: dict | None = None,
    commit: bool = True,
) -> Message:
    """Record an inbound message from a guest or external source."""
    now = utc_now()

    if not guest_id and sender_address:
        guest = (
            db.session.execute(
                sa.select(Guest).where(
                    sa.or_(
                        Guest.email == sender_address,
                        Guest.phone == sender_address,
                    )
                )
            )
            .scalars()
            .first()
        )
        if guest:
            guest_id = str(guest.id)

    if not reservation_id and guest_id:
        reservation = (
            db.session.execute(
                sa.select(Reservation)
                .where(
                    Reservation.primary_guest_id == uuid.UUID(guest_id),
                    Reservation.current_status.in_(["confirmed", "tentative", "checked_in"]),
                )
                .order_by(Reservation.check_in_date.desc())
            )
            .scalars()
            .first()
        )
        if reservation:
            reservation_id = str(reservation.id)

    thread = get_or_create_thread(
        guest_id=guest_id,
        reservation_id=reservation_id,
        channel=channel,
        subject=subject,
        guest_contact_value=sender_address,
    )

    message = Message(
        thread_id=thread.id,
        direction="inbound",
        channel=channel,
        sender_name=sender_address,
        body_text=body_text,
        subject=subject,
        status="delivered",
        provider_message_id=provider_message_id,
        delivered_at=now,
        is_internal_note=False,
        metadata_json=metadata,
        created_at=now,
        updated_at=now,
    )
    db.session.add(message)

    thread.last_message_at = now
    thread.last_message_preview = body_text[:255]
    thread.unread_count = (thread.unread_count or 0) + 1
    thread.status = "open"
    thread.updated_at = now

    if commit:
        db.session.commit()

    return message


# ---------------------------------------------------------------------------
# Thread operations
# ---------------------------------------------------------------------------


def mark_thread_read(thread_id: str, *, actor_user_id: str | None = None, commit: bool = True) -> None:
    thread = db.session.get(ConversationThread, uuid.UUID(thread_id))
    if not thread:
        return
    now = utc_now()
    thread.unread_count = 0
    thread.updated_at = now

    db.session.execute(
        sa.update(Message)
        .where(
            Message.thread_id == thread.id,
            Message.direction == "inbound",
            Message.read_at.is_(None),
        )
        .values(read_at=now)
    )

    if commit:
        db.session.commit()


def close_thread(thread_id: str, *, actor_user_id: str | None = None, commit: bool = True) -> None:
    thread = db.session.get(ConversationThread, uuid.UUID(thread_id))
    if not thread:
        return
    thread.status = "closed"
    thread.updated_at = utc_now()
    if actor_user_id:
        write_audit_log(
            actor_user_id=uuid.UUID(actor_user_id),
            entity_table="conversation_threads",
            entity_id=str(thread.id),
            action="thread.close",
            after_data={"status": "closed"},
        )
    if commit:
        db.session.commit()


def reopen_thread(thread_id: str, *, actor_user_id: str | None = None, commit: bool = True) -> None:
    thread = db.session.get(ConversationThread, uuid.UUID(thread_id))
    if not thread:
        return
    thread.status = "open"
    thread.updated_at = utc_now()
    if commit:
        db.session.commit()


def toggle_followup(thread_id: str, *, actor_user_id: str | None = None, commit: bool = True) -> bool:
    thread = db.session.get(ConversationThread, uuid.UUID(thread_id))
    if not thread:
        return False
    thread.is_needs_followup = not thread.is_needs_followup
    thread.updated_at = utc_now()
    if commit:
        db.session.commit()
    return thread.is_needs_followup


def assign_thread(thread_id: str, user_id: str | None, *, actor_user_id: str | None = None, commit: bool = True) -> None:
    thread = db.session.get(ConversationThread, uuid.UUID(thread_id))
    if not thread:
        return
    thread.assigned_user_id = uuid.UUID(user_id) if user_id else None
    thread.updated_at = utc_now()
    if commit:
        db.session.commit()


# ---------------------------------------------------------------------------
# Reservation communication timeline
# ---------------------------------------------------------------------------


def reservation_messages(reservation_id: str) -> list[Message]:
    """Return all messages linked to a reservation, newest first."""
    threads = (
        db.session.execute(
            sa.select(ConversationThread).where(
                ConversationThread.reservation_id == uuid.UUID(reservation_id)
            )
        )
        .scalars()
        .all()
    )
    if not threads:
        return []
    thread_ids = [t.id for t in threads]
    return (
        db.session.execute(
            sa.select(Message)
            .where(Message.thread_id.in_(thread_ids))
            .order_by(Message.created_at.desc())
        )
        .scalars()
        .all()
    )


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


def list_message_templates(*, channel: str | None = None, language: str | None = None) -> list[MessageTemplate]:
    query = sa.select(MessageTemplate).where(
        MessageTemplate.deleted_at.is_(None),
        MessageTemplate.is_active.is_(True),
    )
    if channel:
        query = query.where(MessageTemplate.channel == channel)
    if language:
        query = query.where(MessageTemplate.language_code == language)
    return (
        db.session.execute(query.order_by(MessageTemplate.template_key))
        .scalars()
        .all()
    )


def get_message_template(template_id: str) -> MessageTemplate | None:
    return db.session.get(MessageTemplate, uuid.UUID(template_id))


def render_message_template(template: MessageTemplate, context: dict[str, str]) -> tuple[str, str]:
    """Render subject and body with simple placeholder substitution.

    Context values are escaped to prevent injection.
    """
    import html as html_mod
    subject = template.subject_template or ""
    body = template.body_template or ""
    for key, value in context.items():
        placeholder = "{{" + key + "}}"
        escaped_value = html_mod.escape(str(value))
        subject = subject.replace(placeholder, escaped_value)
        body = body.replace(placeholder, escaped_value)
    return subject, body


def upsert_message_template(
    *,
    template_key: str,
    template_type: str = "general",
    channel: str = "email",
    language_code: str = "en",
    name: str,
    subject_template: str = "",
    body_template: str,
    actor_user_id: str | None = None,
    commit: bool = True,
) -> MessageTemplate:
    """Create or update a message template."""
    now = utc_now()
    actor_uuid = uuid.UUID(actor_user_id) if actor_user_id else None
    existing = (
        db.session.execute(
            sa.select(MessageTemplate)
            .where(
                MessageTemplate.template_key == template_key,
                MessageTemplate.channel == channel,
                MessageTemplate.language_code == language_code,
                MessageTemplate.deleted_at.is_(None),
            )
        )
        .scalars()
        .first()
    )

    if existing:
        existing.name = name
        existing.template_type = template_type
        existing.subject_template = subject_template
        existing.body_template = body_template
        existing.updated_at = now
        existing.updated_by_user_id = actor_uuid
        if commit:
            db.session.commit()
        return existing

    tpl = MessageTemplate(
        template_key=template_key,
        template_type=template_type,
        channel=channel,
        language_code=language_code,
        name=name,
        subject_template=subject_template,
        body_template=body_template,
        created_at=now,
        updated_at=now,
        created_by_user_id=actor_uuid,
    )
    db.session.add(tpl)
    if commit:
        db.session.commit()
    return tpl


# ---------------------------------------------------------------------------
# Automation hooks
# ---------------------------------------------------------------------------


def list_automation_rules(*, event_type: str | None = None) -> list[AutomationRule]:
    query = sa.select(AutomationRule).where(AutomationRule.deleted_at.is_(None))
    if event_type:
        query = query.where(AutomationRule.event_type == event_type)
    return (
        db.session.execute(query.order_by(AutomationRule.event_type.asc(), AutomationRule.channel.asc(), AutomationRule.created_at.asc()))
        .scalars()
        .all()
    )


def upsert_automation_rule(
    *,
    event_type: str,
    channel: str,
    delay_minutes: int,
    actor_user_id: str,
    rule_id: str | None = None,
    template_id: str | None = None,
    is_active: bool = False,
    commit: bool = True,
) -> AutomationRule:
    event_type = (event_type or "").strip()
    if not event_type:
        raise ValueError("Automation event type is required.")
    if len(event_type) > 60:
        raise ValueError("Automation event type must be 60 characters or fewer.")
    if channel not in {"email", "sms", "line", "whatsapp", "internal_note", "manual_call_log", "ota_message"}:
        raise ValueError("Automation channel is invalid.")
    if delay_minutes < 0:
        raise ValueError("Automation delay must be zero or greater.")

    actor_uuid = uuid.UUID(actor_user_id)
    now = utc_now()
    template_uuid = uuid.UUID(template_id) if template_id else None
    template = db.session.get(MessageTemplate, template_uuid) if template_uuid else None
    if template and template.channel != channel:
        raise ValueError("Automation template channel must match the automation rule channel.")

    rule = db.session.get(AutomationRule, uuid.UUID(rule_id)) if rule_id else None
    if rule and rule.deleted_at is not None:
        rule = None

    if rule is None:
        rule = AutomationRule(
            event_type=event_type,
            channel=channel,
            created_at=now,
            updated_at=now,
            created_by_user_id=actor_uuid,
        )
        db.session.add(rule)

    rule.event_type = event_type
    rule.channel = channel
    rule.template_id = template.id if template else None
    rule.is_active = bool(is_active)
    rule.delay_minutes = int(delay_minutes)
    rule.updated_at = now
    rule.updated_by_user_id = actor_uuid
    db.session.flush()

    write_audit_log(
        actor_user_id=actor_uuid,
        entity_table="automation_rules",
        entity_id=str(rule.id),
        action="automation_rule.upsert",
        after_data={
            "event_type": rule.event_type,
            "channel": rule.channel,
            "template_id": str(rule.template_id) if rule.template_id else None,
            "is_active": rule.is_active,
            "delay_minutes": rule.delay_minutes,
        },
    )
    if commit:
        db.session.commit()
    return rule


def fire_automation_event(
    event_type: str,
    *,
    reservation_id: str | None = None,
    guest_id: str | None = None,
    context: dict[str, str] | None = None,
) -> list[Message]:
    """Evaluate automation rules for an event and send messages if matched.

    Rules with ``delay_minutes == 0`` are sent immediately.  Rules with a
    positive delay are queued in ``pending_automation_events`` and dispatched
    later by the ``process-automation-events`` CLI command.
    """
    rules = (
        db.session.execute(
            sa.select(AutomationRule)
            .where(
                AutomationRule.event_type == event_type,
                AutomationRule.is_active.is_(True),
                AutomationRule.deleted_at.is_(None),
            )
        )
        .scalars()
        .all()
    )

    sent_messages: list[Message] = []
    queued = 0
    for rule in rules:
        if not rule.template_id:
            continue
        template = db.session.get(MessageTemplate, rule.template_id)
        if not template or not template.is_active:
            continue

        if rule.delay_minutes > 0:
            # Queue for deferred processing via CLI
            fire_at = utc_now() + timedelta(minutes=rule.delay_minutes)
            pending = PendingAutomationEvent(
                id=uuid.uuid4(),
                rule_id=rule.id,
                reservation_id=uuid.UUID(reservation_id) if reservation_id else None,
                guest_id=uuid.UUID(guest_id) if guest_id else None,
                context_json=context or {},
                fire_at=fire_at,
            )
            db.session.add(pending)
            queued += 1
            continue

        subject, body = render_message_template(template, context or {})
        payload = ComposePayload(
            guest_id=guest_id,
            reservation_id=reservation_id,
            channel=rule.channel,
            subject=subject,
            body_text=body,
            template_key=template.template_key,
        )
        try:
            msg = send_message(payload, commit=False)
            sent_messages.append(msg)
        except Exception:
            logger.exception("Automation rule %s failed for event %s", rule.id, event_type)

    if sent_messages or queued:
        db.session.commit()
    return sent_messages


def cleanup_processed_automation_events(
    *, retention_days: int | None = None, commit: bool = True
) -> int:
    """Delete processed automation events older than the retention window."""
    keep_days = retention_days
    if keep_days is None:
        keep_days = int(current_app.config.get("PENDING_AUTOMATION_RETENTION_DAYS", 30))
    if keep_days <= 0:
        return 0

    cutoff = utc_now() - timedelta(days=keep_days)
    stale_events = (
        db.session.execute(
            sa.select(PendingAutomationEvent).where(
                PendingAutomationEvent.processed_at.is_not(None),
                PendingAutomationEvent.processed_at < cutoff,
            )
        )
        .scalars()
        .all()
    )
    for event in stale_events:
        db.session.delete(event)
    if stale_events and commit:
        db.session.commit()
    return len(stale_events)


def process_pending_automations() -> dict[str, int]:
    """Process all due pending automation events.

    Called by the ``process-automation-events`` CLI command.  Returns a summary
    dict with keys ``processed``, ``skipped``, and ``errors``.
    """
    now = utc_now()
    due: list[PendingAutomationEvent] = (
        db.session.execute(
            sa.select(PendingAutomationEvent)
            .where(
                PendingAutomationEvent.fire_at <= now,
                PendingAutomationEvent.processed_at.is_(None),
            )
            .order_by(PendingAutomationEvent.fire_at.asc())
        )
        .scalars()
        .all()
    )

    processed = 0
    skipped = 0
    errors = 0
    cleaned_up = 0

    for event in due:
        rule = db.session.get(AutomationRule, event.rule_id)
        if not rule or not rule.is_active or not rule.template_id:
            event.processed_at = now
            event.error = "rule inactive or missing template"
            skipped += 1
            continue

        template = db.session.get(MessageTemplate, rule.template_id)
        if not template or not template.is_active:
            event.processed_at = now
            event.error = "template inactive or deleted"
            skipped += 1
            continue

        context = event.context_json or {}
        reservation_id = str(event.reservation_id) if event.reservation_id else None
        guest_id = str(event.guest_id) if event.guest_id else None

        try:
            subject, body = render_message_template(template, context)
            payload = ComposePayload(
                guest_id=guest_id,
                reservation_id=reservation_id,
                channel=rule.channel,
                subject=subject,
                body_text=body,
                template_key=template.template_key,
            )
            send_message(payload, commit=False)
            event.processed_at = now
            event.error = None
            processed += 1
        except Exception:
            logger.exception("Failed to process pending automation event %s", event.id)
            event.error = "send failed — see server log"
            errors += 1

    try:
        db.session.commit()
    except Exception:
        logger.exception("Failed to commit pending automation batch")
        db.session.rollback()
    else:
        try:
            cleaned_up = cleanup_processed_automation_events(commit=True)
        except Exception:
            logger.exception("Failed to clean up processed automation events")
            db.session.rollback()

    return {
        "processed": processed,
        "skipped": skipped,
        "errors": errors,
        "cleaned_up": cleaned_up,
    }


# ---------------------------------------------------------------------------
# Unread badge count
# ---------------------------------------------------------------------------


def total_unread_count() -> int:
    result = db.session.execute(
        sa.select(sa.func.coalesce(sa.func.sum(ConversationThread.unread_count), 0))
        .where(ConversationThread.status.in_(["open", "waiting"]))
    )
    return int(result.scalar() or 0)


# ---------------------------------------------------------------------------
# Pending automation events -- admin queue view
# ---------------------------------------------------------------------------


def list_pending_automation_events(*, include_processed: bool = False, limit: int = 100) -> list[PendingAutomationEvent]:
    """Return pending automation events for admin queue view."""
    stmt = (
        sa.select(PendingAutomationEvent)
        .options(joinedload(PendingAutomationEvent.rule))
    )
    if not include_processed:
        stmt = stmt.where(PendingAutomationEvent.processed_at.is_(None))
    stmt = stmt.order_by(PendingAutomationEvent.fire_at.asc()).limit(limit)
    return list(db.session.execute(stmt).scalars().unique())


def cancel_pending_automation_event(event_id: str, *, actor_user_id: uuid.UUID) -> PendingAutomationEvent:
    """Cancel a pending automation event by marking it as processed with error."""
    try:
        parsed_id = uuid.UUID(str(event_id))
    except (ValueError, AttributeError):
        raise ValueError("Invalid event ID.")
    event = db.session.get(PendingAutomationEvent, parsed_id)
    if not event:
        raise ValueError("Pending automation event not found.")
    if event.processed_at is not None:
        raise ValueError("Event has already been processed.")
    event.processed_at = utc_now()
    event.error = "Cancelled by admin"
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="pending_automation_events",
        entity_id=str(event.id),
        action="automation_event_cancelled",
    )
    db.session.commit()
    return event


# ---------------------------------------------------------------------------
# Inbound email thread-matching helper
# ---------------------------------------------------------------------------


def create_inbound_message(
    *,
    thread_id: str,
    body: str,
    channel: str = "email",
    sender_email: str | None = None,
    provider_message_id: str | None = None,
    subject: str | None = None,
    commit: bool = True,
) -> Message:
    """Create an inbound message on an existing thread.

    Used by the inbound-email webhook to append a guest reply to an
    existing conversation thread (matched via ``in_reply_to`` /
    ``references`` headers).
    """
    now = utc_now()
    thread = db.session.get(ConversationThread, uuid.UUID(thread_id))
    if not thread:
        raise ValueError("Conversation thread not found.")

    message = Message(
        thread_id=thread.id,
        direction="inbound",
        channel=channel,
        sender_name=sender_email,
        recipient_address=None,
        subject=subject,
        body_text=body,
        status="delivered",
        provider_message_id=provider_message_id,
        delivered_at=now,
        is_internal_note=False,
        created_at=now,
        updated_at=now,
    )
    db.session.add(message)

    thread.last_message_at = now
    thread.last_message_preview = body[:255]
    thread.unread_count = (thread.unread_count or 0) + 1
    thread.status = "open"
    thread.updated_at = now

    if commit:
        db.session.commit()

    return message


def find_thread_by_provider_message_id(provider_message_id: str) -> ConversationThread | None:
    """Look up the thread that contains a message with the given provider_message_id.

    Used by the inbound-email webhook to match ``In-Reply-To`` /
    ``References`` headers back to an existing conversation.
    """
    if not provider_message_id:
        return None
    msg = (
        db.session.execute(
            sa.select(Message).where(
                Message.provider_message_id == provider_message_id,
            )
        )
        .scalars()
        .first()
    )
    if msg:
        return db.session.get(ConversationThread, msg.thread_id)
    return None


# ---------------------------------------------------------------------------
# Auto-Response Rules
# ---------------------------------------------------------------------------


def list_auto_response_rules(*, active_only: bool = False) -> list[AutoResponseRule]:
    """Return all auto-response rules, optionally filtered to active only."""
    query = sa.select(AutoResponseRule)
    if active_only:
        query = query.where(AutoResponseRule.is_active.is_(True))
    return (
        db.session.execute(query.order_by(AutoResponseRule.name.asc()))
        .scalars()
        .all()
    )


def upsert_auto_response_rule(
    *,
    name: str,
    trigger_keywords: list[str],
    template_id: str,
    channel: str = "email",
    is_active: bool = True,
    rule_id: str | None = None,
    actor_user_id: str | None = None,
    commit: bool = True,
) -> AutoResponseRule:
    """Create or update an auto-response rule."""
    name = (name or "").strip()
    if not name:
        raise ValueError("Auto-response rule name is required.")
    if not trigger_keywords:
        raise ValueError("At least one trigger keyword is required.")
    if not template_id:
        raise ValueError("A message template is required.")

    now = utc_now()
    actor_uuid = uuid.UUID(actor_user_id) if actor_user_id else None
    template_uuid = uuid.UUID(template_id)
    template = db.session.get(MessageTemplate, template_uuid)
    if not template:
        raise ValueError("Message template not found.")

    rule = db.session.get(AutoResponseRule, uuid.UUID(rule_id)) if rule_id else None

    if rule is None:
        rule = AutoResponseRule(
            name=name,
            trigger_keywords=trigger_keywords,
            template_id=template.id,
            channel=channel,
            is_active=is_active,
            created_at=now,
            updated_at=now,
            created_by_user_id=actor_uuid,
        )
        db.session.add(rule)
    else:
        rule.name = name
        rule.trigger_keywords = trigger_keywords
        rule.template_id = template.id
        rule.channel = channel
        rule.is_active = is_active
        rule.updated_at = now
        rule.updated_by_user_id = actor_uuid

    db.session.flush()

    write_audit_log(
        actor_user_id=actor_uuid,
        entity_table="auto_response_rules",
        entity_id=str(rule.id),
        action="auto_response_rule.upsert",
        after_data={
            "name": rule.name,
            "trigger_keywords": rule.trigger_keywords,
            "template_id": str(rule.template_id),
            "channel": rule.channel,
            "is_active": rule.is_active,
        },
    )

    if commit:
        db.session.commit()
    return rule


def check_auto_responses(thread_id: str, message_body: str) -> list[Message]:
    """Scan active auto-response rules for keyword matches and send auto-replies.

    For each matching rule, renders the associated template and sends a reply
    on the same thread.  Returns the list of auto-reply messages sent.
    """
    if not message_body:
        return []

    body_lower = message_body.lower()
    rules = (
        db.session.execute(
            sa.select(AutoResponseRule).where(AutoResponseRule.is_active.is_(True))
        )
        .scalars()
        .all()
    )

    sent_messages: list[Message] = []
    for rule in rules:
        keywords = rule.trigger_keywords or []
        matched = any(kw.lower() in body_lower for kw in keywords if kw)
        if not matched:
            continue

        template = rule.template
        if not template or not template.is_active:
            continue

        thread = db.session.get(ConversationThread, uuid.UUID(thread_id))
        if not thread:
            continue

        # Build simple context from thread
        context: dict[str, str] = {
            "guest_name": "",
            "hotel_name": current_app.config.get("HOTEL_NAME", "Hotel"),
        }
        if thread.guest:
            context["guest_name"] = thread.guest.full_name or ""
        if thread.reservation:
            context["reservation_code"] = thread.reservation.reservation_code or ""

        subject, body = render_message_template(template, context)

        payload = ComposePayload(
            thread_id=thread_id,
            channel=rule.channel,
            subject=subject,
            body_text=body,
        )
        try:
            msg = send_message(payload, commit=False)
            sent_messages.append(msg)
            logger.info(
                "AutoResponse rule %s matched on thread %s — sent message %s",
                rule.name, thread_id, msg.id,
            )
        except Exception:
            logger.exception("AutoResponse rule %s failed on thread %s", rule.name, thread_id)

    if sent_messages:
        db.session.commit()

    return sent_messages
