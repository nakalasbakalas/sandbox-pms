"""Phase 18: Unified Guest Messaging Hub tests.

Tests cover:
- Domain model (ConversationThread, Message, MessageTemplate, DeliveryAttempt, AutomationRule)
- Messaging service (thread creation, send, inbound, read, close, templates, automation)
- Channel adapters (email, sms, whatsapp, internal_note, manual_call_log, ota_message)
- Inbox listing / filtering
- Reservation-linked timeline
- Audit trail for messaging actions
- Route accessibility / permission checks
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from pms.extensions import db
from pms.models import (
    AutomationRule,
    ConversationThread,
    DeliveryAttempt,
    Guest,
    Message,
    MessageTemplate,
    PendingAutomationEvent,
    Reservation,
    RoomType,
    User,
    utc_now,
)
from pms.services.messaging_service import (
    ComposePayload,
    InboxFilters,
    assign_thread,
    close_thread,
    fire_automation_event,
    get_adapter,
    get_or_create_thread,
    get_thread_detail,
    list_inbox,
    list_message_templates,
    mark_thread_read,
    process_pending_automations,
    record_inbound_message,
    render_message_template,
    reopen_thread,
    reservation_messages,
    send_message,
    toggle_followup,
    total_unread_count,
    upsert_message_template,
)


@pytest.fixture()
def seeded_app(app_factory):
    return app_factory(seed=True)


@pytest.fixture()
def app_ctx(seeded_app):
    with seeded_app.app_context():
        yield seeded_app


@pytest.fixture()
def staff_user(app_ctx):
    user = User.query.filter_by(email="admin@sandbox.local").first()
    assert user is not None
    return user


@pytest.fixture()
def guest(app_ctx):
    g = Guest(
        first_name="Test",
        last_name="Guest",
        full_name="Test Guest",
        phone="+66812345678",
        email="guest@example.com",
        preferred_language="en",
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.session.add(g)
    db.session.flush()
    return g


@pytest.fixture()
def reservation(app_ctx, guest):
    room_type = RoomType.query.first()
    r = Reservation(
        reservation_code="SBX-TST001",
        primary_guest_id=guest.id,
        room_type_id=room_type.id if room_type else None,
        current_status="confirmed",
        check_in_date=date.today(),
        check_out_date=date.today() + timedelta(days=2),
        adults=2,
        children=0,
        extra_guests=0,
        source_channel="direct_web",
        booked_at=utc_now(),
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.session.add(r)
    db.session.flush()
    return r


def login_as(client, user: User) -> None:
    with client.session_transaction() as client_session:
        client_session["staff_user_id"] = str(user.id)
        client_session["_csrf_token"] = "test-csrf-token"


def post_form(client, url: str, *, data: dict, follow_redirects: bool = False):
    payload = dict(data)
    payload["csrf_token"] = "test-csrf-token"
    return client.post(url, data=payload, follow_redirects=follow_redirects)


# ---------------------------------------------------------------------------
# Model tests
# ---------------------------------------------------------------------------


class TestConversationThreadModel:
    def test_create_thread(self, app_ctx, guest, reservation, staff_user):
        thread = ConversationThread(
            guest_id=guest.id,
            reservation_id=reservation.id,
            channel="email",
            subject="Booking inquiry",
            status="open",
            assigned_user_id=staff_user.id,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        db.session.add(thread)
        db.session.commit()

        loaded = db.session.get(ConversationThread, thread.id)
        assert loaded is not None
        assert loaded.channel == "email"
        assert loaded.status == "open"
        assert loaded.guest_id == guest.id
        assert loaded.reservation_id == reservation.id

    def test_thread_defaults(self, app_ctx, guest):
        thread = ConversationThread(
            guest_id=guest.id,
            channel="sms",
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        db.session.add(thread)
        db.session.commit()
        assert thread.unread_count == 0
        assert thread.is_needs_followup is False


class TestMessageModel:
    def test_create_message(self, app_ctx, guest, staff_user):
        thread = ConversationThread(
            guest_id=guest.id,
            channel="email",
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        db.session.add(thread)
        db.session.flush()

        msg = Message(
            thread_id=thread.id,
            direction="outbound",
            channel="email",
            sender_user_id=staff_user.id,
            recipient_address="guest@example.com",
            subject="Hello",
            body_text="Welcome to the hotel!",
            status="sent",
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        db.session.add(msg)
        db.session.commit()

        loaded = db.session.get(Message, msg.id)
        assert loaded is not None
        assert loaded.direction == "outbound"
        assert loaded.body_text == "Welcome to the hotel!"
        assert loaded.is_internal_note is False

    def test_internal_note(self, app_ctx, guest, staff_user):
        thread = ConversationThread(
            guest_id=guest.id,
            channel="internal_note",
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        db.session.add(thread)
        db.session.flush()

        msg = Message(
            thread_id=thread.id,
            direction="internal",
            channel="internal_note",
            sender_user_id=staff_user.id,
            body_text="Guest is VIP",
            is_internal_note=True,
            status="sent",
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        db.session.add(msg)
        db.session.commit()
        assert msg.is_internal_note is True
        assert msg.recipient_address is None


class TestMessageTemplateModel:
    def test_create_template(self, app_ctx):
        tpl = MessageTemplate(
            template_key="welcome",
            template_type="general",
            channel="email",
            language_code="en",
            name="Welcome Message",
            subject_template="Welcome {{guest_name}}",
            body_template="Dear {{guest_name}}, welcome to {{hotel_name}}.",
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        db.session.add(tpl)
        db.session.commit()
        assert tpl.is_active is True


# ---------------------------------------------------------------------------
# Service tests
# ---------------------------------------------------------------------------


class TestThreadCreation:
    def test_get_or_create_new_thread(self, app_ctx, guest, reservation):
        thread = get_or_create_thread(
            guest_id=str(guest.id),
            reservation_id=str(reservation.id),
            channel="email",
            subject="New inquiry",
        )
        db.session.commit()
        assert thread.id is not None
        assert thread.guest_id == guest.id
        assert thread.reservation_id == reservation.id

    def test_get_or_create_reuses_open_thread(self, app_ctx, guest, reservation):
        thread1 = get_or_create_thread(
            guest_id=str(guest.id),
            reservation_id=str(reservation.id),
            channel="email",
        )
        db.session.commit()
        thread2 = get_or_create_thread(
            guest_id=str(guest.id),
            reservation_id=str(reservation.id),
            channel="email",
        )
        assert thread1.id == thread2.id


class TestSendMessage:
    def test_send_email_message(self, app_ctx, guest, reservation, staff_user):
        payload = ComposePayload(
            guest_id=str(guest.id),
            reservation_id=str(reservation.id),
            channel="email",
            subject="Confirmation",
            body_text="Your booking is confirmed.",
            recipient_address="guest@example.com",
        )
        msg = send_message(payload, actor_user_id=str(staff_user.id))
        assert msg.status == "sent"
        assert msg.direction == "outbound"
        assert msg.is_internal_note is False
        assert msg.thread_id is not None

    def test_send_internal_note(self, app_ctx, guest, staff_user):
        payload = ComposePayload(
            guest_id=str(guest.id),
            channel="internal_note",
            body_text="Guest called to ask about pool hours.",
            is_internal_note=True,
        )
        msg = send_message(payload, actor_user_id=str(staff_user.id))
        assert msg.status == "sent"
        assert msg.direction == "internal"
        assert msg.is_internal_note is True
        assert msg.recipient_address is None

    def test_send_sms_mock(self, app_ctx, guest, staff_user):
        payload = ComposePayload(
            guest_id=str(guest.id),
            channel="sms",
            body_text="Reminder: check-in starts at 14:00.",
            recipient_address="+66812345678",
        )
        msg = send_message(payload, actor_user_id=str(staff_user.id))
        assert msg.status == "sent"
        assert msg.provider_message_id is not None
        assert msg.provider_message_id.startswith("mock-sms-")

    def test_send_whatsapp_mock(self, app_ctx, guest, staff_user):
        payload = ComposePayload(
            guest_id=str(guest.id),
            channel="whatsapp",
            body_text="Welcome!",
            recipient_address="+66812345678",
        )
        msg = send_message(payload, actor_user_id=str(staff_user.id))
        assert msg.status == "sent"

    def test_send_creates_delivery_attempt(self, app_ctx, guest, staff_user):
        payload = ComposePayload(
            guest_id=str(guest.id),
            channel="email",
            body_text="Test delivery tracking.",
            recipient_address="guest@example.com",
        )
        msg = send_message(payload, actor_user_id=str(staff_user.id))
        attempts = DeliveryAttempt.query.filter_by(message_id=msg.id).all()
        assert len(attempts) == 1
        assert attempts[0].status == "sent"

    def test_send_updates_thread_metadata(self, app_ctx, guest, staff_user):
        payload = ComposePayload(
            guest_id=str(guest.id),
            channel="email",
            body_text="Hello guest!",
            recipient_address="guest@example.com",
        )
        msg = send_message(payload, actor_user_id=str(staff_user.id))
        thread = db.session.get(ConversationThread, msg.thread_id)
        assert thread.last_message_at is not None
        assert "Hello guest" in thread.last_message_preview


class TestInboundMessage:
    def test_record_inbound_auto_links_guest(self, app_ctx, guest):
        msg = record_inbound_message(
            channel="email",
            sender_address="guest@example.com",
            body_text="When can I check in?",
            subject="Check-in time",
        )
        assert msg.direction == "inbound"
        assert msg.status == "delivered"
        thread = db.session.get(ConversationThread, msg.thread_id)
        assert thread.guest_id == guest.id
        assert thread.unread_count == 1

    def test_record_inbound_unknown_sender(self, app_ctx):
        msg = record_inbound_message(
            channel="email",
            sender_address="unknown@somewhere.com",
            body_text="I want to book a room.",
        )
        assert msg.direction == "inbound"
        thread = db.session.get(ConversationThread, msg.thread_id)
        assert thread.guest_id is None
        assert thread.guest_contact_value == "unknown@somewhere.com"


class TestThreadOperations:
    def test_mark_thread_read(self, app_ctx, guest):
        msg = record_inbound_message(
            channel="email",
            sender_address="guest@example.com",
            body_text="Question",
        )
        thread = db.session.get(ConversationThread, msg.thread_id)
        assert thread.unread_count == 1
        mark_thread_read(str(thread.id))
        db.session.refresh(thread)
        assert thread.unread_count == 0

    def test_close_and_reopen_thread(self, app_ctx, guest, staff_user):
        thread = get_or_create_thread(guest_id=str(guest.id), channel="email")
        db.session.commit()
        assert thread.status == "open"
        close_thread(str(thread.id), actor_user_id=str(staff_user.id))
        db.session.refresh(thread)
        assert thread.status == "closed"
        reopen_thread(str(thread.id))
        db.session.refresh(thread)
        assert thread.status == "open"

    def test_toggle_followup(self, app_ctx, guest):
        thread = get_or_create_thread(guest_id=str(guest.id), channel="email")
        db.session.commit()
        assert thread.is_needs_followup is False
        result = toggle_followup(str(thread.id))
        assert result is True
        db.session.refresh(thread)
        assert thread.is_needs_followup is True
        result = toggle_followup(str(thread.id))
        assert result is False

    def test_assign_thread(self, app_ctx, guest, staff_user):
        thread = get_or_create_thread(guest_id=str(guest.id), channel="email")
        db.session.commit()
        assign_thread(str(thread.id), str(staff_user.id))
        db.session.refresh(thread)
        assert thread.assigned_user_id == staff_user.id
        assign_thread(str(thread.id), None)
        db.session.refresh(thread)
        assert thread.assigned_user_id is None


class TestInboxListing:
    def test_list_inbox_empty(self, app_ctx):
        entries, total = list_inbox(InboxFilters())
        assert total == 0
        assert entries == []

    def test_list_inbox_with_entries(self, app_ctx, guest, staff_user):
        send_message(
            ComposePayload(guest_id=str(guest.id), channel="email", body_text="Hello", recipient_address="guest@example.com"),
            actor_user_id=str(staff_user.id),
        )
        entries, total = list_inbox(InboxFilters())
        assert total == 1
        assert entries[0].guest_name == "Test Guest"

    def test_filter_by_channel(self, app_ctx, guest, staff_user):
        send_message(
            ComposePayload(guest_id=str(guest.id), channel="email", body_text="Email msg", recipient_address="guest@example.com"),
            actor_user_id=str(staff_user.id),
        )
        send_message(
            ComposePayload(guest_id=str(guest.id), channel="sms", body_text="SMS msg", recipient_address="+66812345678"),
            actor_user_id=str(staff_user.id),
        )
        entries, total = list_inbox(InboxFilters(channel="email"))
        assert total == 1
        assert entries[0].channel == "email"

    def test_filter_unread_only(self, app_ctx, guest):
        record_inbound_message(channel="email", sender_address="guest@example.com", body_text="Question")
        entries, total = list_inbox(InboxFilters(unread_only=True))
        assert total == 1

    def test_search_by_guest_name(self, app_ctx, guest, staff_user):
        send_message(
            ComposePayload(guest_id=str(guest.id), channel="email", body_text="Hi", recipient_address="guest@example.com"),
            actor_user_id=str(staff_user.id),
        )
        entries, total = list_inbox(InboxFilters(search="Test Guest"))
        assert total == 1


class TestThreadDetail:
    def test_get_thread_detail(self, app_ctx, guest, staff_user):
        payload = ComposePayload(
            guest_id=str(guest.id),
            channel="email",
            body_text="Hello",
            recipient_address="guest@example.com",
        )
        msg = send_message(payload, actor_user_id=str(staff_user.id))
        detail = get_thread_detail(str(msg.thread_id))
        assert detail is not None
        assert detail.thread is not None
        assert len(detail.messages) == 1
        assert detail.guest.id == guest.id

    def test_get_thread_detail_not_found(self, app_ctx):
        detail = get_thread_detail(str(uuid.uuid4()))
        assert detail is None


class TestReservationTimeline:
    def test_reservation_messages(self, app_ctx, guest, reservation, staff_user):
        send_message(
            ComposePayload(
                guest_id=str(guest.id),
                reservation_id=str(reservation.id),
                channel="email",
                body_text="Confirmation sent",
                recipient_address="guest@example.com",
            ),
            actor_user_id=str(staff_user.id),
        )
        msgs = reservation_messages(str(reservation.id))
        assert len(msgs) == 1
        assert msgs[0].body_text == "Confirmation sent"

    def test_reservation_messages_empty(self, app_ctx, reservation):
        msgs = reservation_messages(str(reservation.id))
        assert len(msgs) == 0


class TestTemplates:
    def test_upsert_and_render_template(self, app_ctx, staff_user):
        tpl = upsert_message_template(
            template_key="test_welcome",
            template_type="general",
            channel="email",
            language_code="en",
            name="Welcome",
            subject_template="Hello {{guest_name}}",
            body_template="Welcome to {{hotel_name}}, {{guest_name}}!",
            actor_user_id=str(staff_user.id),
        )
        assert tpl.id is not None
        subject, body = render_message_template(tpl, {"guest_name": "John", "hotel_name": "Sandbox Hotel"})
        assert subject == "Hello John"
        assert body == "Welcome to Sandbox Hotel, John!"

    def test_list_message_templates(self, app_ctx, staff_user):
        upsert_message_template(
            template_key="tpl1", name="Template 1", body_template="Body 1",
            actor_user_id=str(staff_user.id),
        )
        upsert_message_template(
            template_key="tpl2", name="Template 2", body_template="Body 2",
            actor_user_id=str(staff_user.id),
        )
        templates = list_message_templates()
        assert len(templates) >= 2


class TestChannelAdapters:
    def test_email_adapter_mock_mode(self, app_ctx, guest, staff_user):
        payload = ComposePayload(
            guest_id=str(guest.id),
            channel="email",
            body_text="Test email",
            recipient_address="guest@example.com",
        )
        msg = send_message(payload, actor_user_id=str(staff_user.id))
        assert msg.status == "sent"

    def test_sms_adapter(self, app_ctx):
        adapter = get_adapter("sms")
        assert adapter.channel_name() == "sms"

    def test_whatsapp_adapter(self, app_ctx):
        adapter = get_adapter("whatsapp")
        assert adapter.channel_name() == "whatsapp"

    def test_internal_note_adapter(self, app_ctx):
        adapter = get_adapter("internal_note")
        assert adapter.channel_name() == "internal_note"

    def test_manual_call_log_adapter(self, app_ctx):
        adapter = get_adapter("manual_call_log")
        assert adapter.channel_name() == "manual_call_log"

    def test_ota_message_adapter(self, app_ctx):
        adapter = get_adapter("ota_message")
        assert adapter.channel_name() == "ota_message"

    def test_unknown_adapter_raises(self, app_ctx):
        with pytest.raises(ValueError, match="No adapter"):
            get_adapter("carrier_pigeon")


class TestUnreadCount:
    def test_total_unread_count(self, app_ctx, guest):
        record_inbound_message(channel="email", sender_address="guest@example.com", body_text="Hi")
        count = total_unread_count()
        assert count >= 1


class TestAutomationHooks:
    def test_fire_automation_no_rules(self, app_ctx, reservation):
        # Use an event type with no seeded active rules
        result = fire_automation_event("__no_such_event__", reservation_id=str(reservation.id))
        assert result == []

    def test_fire_automation_with_rule(self, app_ctx, guest, reservation, staff_user):
        tpl = upsert_message_template(
            template_key="auto_confirm",
            template_type="booking_confirmation",
            channel="email",
            name="Auto Confirm",
            subject_template="Confirmed {{reservation_code}}",
            body_template="Dear {{guest_name}}, your booking {{reservation_code}} is confirmed.",
            actor_user_id=str(staff_user.id),
        )
        rule = AutomationRule(
            event_type="__test_res_created__",
            template_id=tpl.id,
            channel="email",
            is_active=True,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        db.session.add(rule)
        db.session.commit()

        result = fire_automation_event(
            "__test_res_created__",
            reservation_id=str(reservation.id),
            guest_id=str(guest.id),
            context={"guest_name": "Test Guest", "reservation_code": "SBX-TST001"},
        )
        assert len(result) == 1
        assert result[0].status == "sent"


class TestInternalNoteSeparation:
    def test_internal_note_not_sent_externally(self, app_ctx, guest, staff_user):
        payload = ComposePayload(
            guest_id=str(guest.id),
            channel="internal_note",
            body_text="VIP guest, give extra towels",
            is_internal_note=True,
        )
        msg = send_message(payload, actor_user_id=str(staff_user.id))
        assert msg.is_internal_note is True
        assert msg.recipient_address is None
        assert msg.direction == "internal"

    def test_guest_visible_message_has_recipient(self, app_ctx, guest, staff_user):
        payload = ComposePayload(
            guest_id=str(guest.id),
            channel="email",
            body_text="Your room is ready!",
            recipient_address="guest@example.com",
        )
        msg = send_message(payload, actor_user_id=str(staff_user.id))
        assert msg.is_internal_note is False
        assert msg.recipient_address == "guest@example.com"
        assert msg.direction == "outbound"


# ---------------------------------------------------------------------------
# Route tests
# ---------------------------------------------------------------------------


class TestMessagingRoutes:
    def test_inbox_requires_auth(self, seeded_app):
        with seeded_app.test_client() as client:
            resp = client.get("/staff/messaging")
            assert resp.status_code == 401

    def test_inbox_accessible_after_login(self, seeded_app):
        with seeded_app.app_context():
            admin = User.query.filter_by(email="admin@sandbox.local").first()
        with seeded_app.test_client() as client:
            login_as(client, admin)
            resp = client.get("/staff/messaging")
            assert resp.status_code == 200
            assert b"Unified Inbox" in resp.data

    def test_compose_page(self, seeded_app):
        with seeded_app.app_context():
            admin = User.query.filter_by(email="admin@sandbox.local").first()
        with seeded_app.test_client() as client:
            login_as(client, admin)
            resp = client.get("/staff/messaging/compose")
            assert resp.status_code == 200
            assert b"Compose New Message" in resp.data

    def test_send_message_via_route(self, seeded_app):
        with seeded_app.app_context():
            admin = User.query.filter_by(email="admin@sandbox.local").first()
        with seeded_app.test_client() as client:
            login_as(client, admin)
            resp = post_form(client, "/staff/messaging/send", data={
                "channel": "internal_note",
                "body_text": "Test route message",
                "is_internal_note": "1",
            }, follow_redirects=True)
            assert resp.status_code == 200

    def test_send_empty_body_rejected(self, seeded_app):
        with seeded_app.app_context():
            admin = User.query.filter_by(email="admin@sandbox.local").first()
        with seeded_app.test_client() as client:
            login_as(client, admin)
            resp = post_form(client, "/staff/messaging/send", data={
                "channel": "email",
                "body_text": "",
            }, follow_redirects=True)
            assert resp.status_code == 200
            assert b"cannot be empty" in resp.data

    def test_add_note_via_route(self, seeded_app):
        with seeded_app.app_context():
            admin = User.query.filter_by(email="admin@sandbox.local").first()
        with seeded_app.test_client() as client:
            login_as(client, admin)
            resp = post_form(client, "/staff/messaging/note", data={
                "body_text": "Test internal note",
            }, follow_redirects=True)
            assert resp.status_code == 200

    def test_call_log_via_route(self, seeded_app):
        with seeded_app.app_context():
            admin = User.query.filter_by(email="admin@sandbox.local").first()
        with seeded_app.test_client() as client:
            login_as(client, admin)
            resp = post_form(client, "/staff/messaging/call-log", data={
                "body_text": "Guest called about late checkout",
            }, follow_redirects=True)
            assert resp.status_code == 200

    def test_inbound_webhook(self, seeded_app):
        with seeded_app.test_client() as client:
            resp = client.post(
                "/staff/messaging/inbound",
                json={
                    "channel": "email",
                    "sender_address": "someone@example.com",
                    "body_text": "I want to book",
                    "subject": "Booking inquiry",
                },
            )
            assert resp.status_code == 200
            data = resp.get_json()
            assert data["status"] == "ok"
            assert "message_id" in data

    def test_inbound_webhook_missing_fields(self, seeded_app):
        with seeded_app.test_client() as client:
            resp = client.post(
                "/staff/messaging/inbound",
                json={"channel": "email"},
            )
            assert resp.status_code == 400


class TestMessagingAuditTrail:
    def test_send_message_creates_audit_log(self, app_ctx, guest, staff_user):
        from pms.models import AuditLog

        payload = ComposePayload(
            guest_id=str(guest.id),
            channel="email",
            body_text="Audited message",
            recipient_address="guest@example.com",
        )
        msg = send_message(payload, actor_user_id=str(staff_user.id))
        audit = AuditLog.query.filter_by(
            entity_table="messages",
            entity_id=str(msg.id),
        ).first()
        assert audit is not None
        assert audit.action == "message.send"

    def test_close_thread_creates_audit_log(self, app_ctx, guest, staff_user):
        from pms.models import AuditLog

        thread = get_or_create_thread(guest_id=str(guest.id), channel="email")
        db.session.commit()
        close_thread(str(thread.id), actor_user_id=str(staff_user.id))
        audit = AuditLog.query.filter_by(
            entity_table="conversation_threads",
            entity_id=str(thread.id),
        ).first()
        assert audit is not None
        assert audit.action == "thread.close"


# ---------------------------------------------------------------------------
# Delayed automation (PendingAutomationEvent) tests
# ---------------------------------------------------------------------------


@pytest.fixture()
def _delayed_rule(app_ctx, staff_user):
    """AutomationRule with delay_minutes=60 on a unique test event type."""
    tpl = upsert_message_template(
        template_key="delayed_followup_test",
        template_type="checkout_followup",
        channel="email",
        name="Delayed Followup Test",
        subject_template="Follow-up for {{reservation_code}}",
        body_template="Dear {{guest_name}}, hope your stay was great!",
        actor_user_id=str(staff_user.id),
    )
    rule = AutomationRule(
        event_type="__test_checkout_delayed__",
        template_id=tpl.id,
        channel="email",
        is_active=True,
        delay_minutes=60,
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db.session.add(rule)
    db.session.commit()
    return rule, tpl


class TestDelayedAutomationEvents:
    def test_fire_delayed_rule_queues_pending_event(
        self, app_ctx, guest, reservation, _delayed_rule
    ):
        _rule, _tpl = _delayed_rule
        before = datetime.now(timezone.utc)
        result = fire_automation_event(
            "__test_checkout_delayed__",
            reservation_id=str(reservation.id),
            guest_id=str(guest.id),
            context={"guest_name": "Test Guest", "reservation_code": "SBX-TST001"},
        )
        # Delayed rule does not send immediately
        assert result == []

        pending = PendingAutomationEvent.query.filter_by(rule_id=_rule.id).first()
        assert pending is not None
        assert pending.processed_at is None
        assert pending.reservation_id == reservation.id
        assert pending.guest_id == guest.id
        assert pending.context_json["reservation_code"] == "SBX-TST001"
        # fire_at should be roughly 60 minutes in the future (SQLite may strip tz)
        fire_naive = pending.fire_at.replace(tzinfo=None) if pending.fire_at.tzinfo else pending.fire_at
        before_naive = before.replace(tzinfo=None)
        assert (fire_naive - before_naive).total_seconds() > 50 * 60

    def test_process_pending_does_not_send_future_events(
        self, app_ctx, guest, reservation, _delayed_rule
    ):
        fire_automation_event(
            "__test_checkout_delayed__",
            reservation_id=str(reservation.id),
            guest_id=str(guest.id),
            context={"guest_name": "Test Guest", "reservation_code": "SBX-TST001"},
        )
        # Event is in the future — nothing should be processed
        result = process_pending_automations()
        assert result["processed"] == 0
        assert result["errors"] == 0

    def test_process_pending_sends_due_events(
        self, app_ctx, guest, reservation, _delayed_rule
    ):
        _rule, _tpl = _delayed_rule
        # Insert a due event directly with fire_at in the past
        now = utc_now()
        event = PendingAutomationEvent(
            id=uuid.uuid4(),
            rule_id=_rule.id,
            reservation_id=reservation.id,
            guest_id=guest.id,
            context_json={"guest_name": "Test Guest", "reservation_code": "SBX-TST001"},
            fire_at=now - timedelta(minutes=1),
            created_at=now,
            updated_at=now,
        )
        db.session.add(event)
        db.session.commit()

        result = process_pending_automations()
        assert result["processed"] == 1
        assert result["errors"] == 0

        db.session.refresh(event)
        assert event.processed_at is not None
        assert event.error is None

    def test_process_pending_skips_inactive_rule(
        self, app_ctx, guest, reservation, _delayed_rule
    ):
        _rule, _tpl = _delayed_rule
        _rule.is_active = False
        db.session.commit()

        now = utc_now()
        event = PendingAutomationEvent(
            id=uuid.uuid4(),
            rule_id=_rule.id,
            reservation_id=reservation.id,
            guest_id=guest.id,
            context_json={},
            fire_at=now - timedelta(seconds=5),
            created_at=now,
            updated_at=now,
        )
        db.session.add(event)
        db.session.commit()

        result = process_pending_automations()
        assert result["processed"] == 0
        assert result["skipped"] == 1

        db.session.refresh(event)
        assert event.processed_at is not None
        assert "inactive" in event.error

    def test_process_pending_idempotent(
        self, app_ctx, guest, reservation, _delayed_rule
    ):
        """Already-processed events are not re-sent."""
        _rule, _tpl = _delayed_rule
        now = utc_now()
        event = PendingAutomationEvent(
            id=uuid.uuid4(),
            rule_id=_rule.id,
            reservation_id=reservation.id,
            guest_id=guest.id,
            context_json={"guest_name": "Test Guest", "reservation_code": "SBX-TST001"},
            fire_at=now - timedelta(minutes=10),
            processed_at=now,  # already processed
            created_at=now,
            updated_at=now,
        )
        db.session.add(event)
        db.session.commit()

        result = process_pending_automations()
        assert result["processed"] == 0
        assert result["skipped"] == 0

    def test_process_pending_cleans_up_old_processed_events(
        self, app_ctx, guest, reservation, _delayed_rule
    ):
        _rule, _tpl = _delayed_rule
        app_ctx.config["PENDING_AUTOMATION_RETENTION_DAYS"] = 7
        now = utc_now()

        old_event = PendingAutomationEvent(
            id=uuid.uuid4(),
            rule_id=_rule.id,
            reservation_id=reservation.id,
            guest_id=guest.id,
            context_json={"guest_name": "Test Guest", "reservation_code": "SBX-TST001"},
            fire_at=now - timedelta(days=9),
            processed_at=now - timedelta(days=8),
            created_at=now - timedelta(days=9),
            updated_at=now - timedelta(days=8),
        )
        recent_event = PendingAutomationEvent(
            id=uuid.uuid4(),
            rule_id=_rule.id,
            reservation_id=reservation.id,
            guest_id=guest.id,
            context_json={"guest_name": "Test Guest", "reservation_code": "SBX-TST001"},
            fire_at=now - timedelta(days=2),
            processed_at=now - timedelta(days=1),
            created_at=now - timedelta(days=2),
            updated_at=now - timedelta(days=1),
        )
        due_event = PendingAutomationEvent(
            id=uuid.uuid4(),
            rule_id=_rule.id,
            reservation_id=reservation.id,
            guest_id=guest.id,
            context_json={"guest_name": "Test Guest", "reservation_code": "SBX-TST001"},
            fire_at=now - timedelta(minutes=2),
            created_at=now,
            updated_at=now,
        )
        db.session.add_all([old_event, recent_event, due_event])
        db.session.commit()

        result = process_pending_automations()

        assert result["processed"] == 1
        assert result["cleaned_up"] == 1
        assert db.session.get(PendingAutomationEvent, old_event.id) is None
        assert db.session.get(PendingAutomationEvent, recent_event.id) is not None
        db.session.refresh(due_event)
        assert due_event.processed_at is not None

    def test_process_automation_events_cli_command(
        self, seeded_app, app_ctx, guest, reservation, _delayed_rule
    ):
        _rule, _tpl = _delayed_rule
        now = utc_now()
        event = PendingAutomationEvent(
            id=uuid.uuid4(),
            rule_id=_rule.id,
            reservation_id=reservation.id,
            guest_id=guest.id,
            context_json={"guest_name": "Test Guest", "reservation_code": "SBX-TST001"},
            fire_at=now - timedelta(minutes=1),
            created_at=now,
            updated_at=now,
        )
        db.session.add(event)
        db.session.commit()

        runner = seeded_app.test_cli_runner()
        result = runner.invoke(args=["process-automation-events"])

        assert result.exit_code == 0
        assert "1 sent" in result.output
        assert "0 cleaned up" in result.output
        db.session.refresh(event)
        assert event.processed_at is not None
