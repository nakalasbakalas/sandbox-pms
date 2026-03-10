from __future__ import annotations

import json
from datetime import date, timedelta, timezone

from werkzeug.security import generate_password_hash

from pms.extensions import db
from pms.models import (
    EmailOutbox,
    NotificationDelivery,
    NotificationTemplate,
    PaymentRequest,
    Reservation,
    Role,
    RoomType,
    StaffNotification,
    User,
)
from pms.services.admin_service import (
    NotificationTemplatePayload,
    upsert_notification_template,
    upsert_settings_bundle,
)
from pms.services.communication_service import (
    dispatch_notification_deliveries,
    query_notification_history,
    queue_reservation_confirmation,
    queue_staff_new_booking_alert,
    send_due_failed_payment_reminders,
    send_due_pre_arrival_reminders,
)
from pms.services.payment_integration_service import (
    create_or_reuse_deposit_request,
    process_payment_webhook,
    sign_test_hosted_webhook,
)
from pms.services.public_booking_service import (
    HoldRequestPayload,
    PublicBookingPayload,
    confirm_public_booking,
    create_reservation_hold,
)
from pms.services.reservation_service import ReservationCreatePayload, create_reservation
from pms.services.staff_reservations_service import (
    StayDateChangePayload,
    cancel_reservation_workspace,
    change_stay_dates,
)


def make_staff_user(*, email: str, role_code: str) -> User:
    role = Role.query.filter_by(code=role_code).one()
    user = User(
        username=email.split("@", 1)[0],
        email=email,
        full_name=email.split("@", 1)[0].replace(".", " ").title(),
        password_hash=generate_password_hash("password123456"),
        is_active=True,
        account_state="active",
    )
    user.roles = [role]
    db.session.add(user)
    db.session.commit()
    return user


def login_as(client, user: User) -> None:
    with client.session_transaction() as client_session:
        client_session["staff_user_id"] = str(user.id)
        client_session["_csrf_token"] = "test-csrf-token"


def post_form(client, url: str, *, data: dict, follow_redirects: bool = False):
    payload = dict(data)
    payload["csrf_token"] = "test-csrf-token"
    return client.post(url, data=payload, follow_redirects=follow_redirects)


def create_public_reservation(*, room_type_code: str = "TWN", language: str = "en") -> Reservation:
    room_type = RoomType.query.filter_by(code=room_type_code).one()
    idempotency_key = f"phase11-public-{room_type_code}-{language}"
    hold = create_reservation_hold(
        HoldRequestPayload(
            check_in_date=date.today() + timedelta(days=5),
            check_out_date=date.today() + timedelta(days=7),
            adults=2,
            children=0,
            room_type_id=room_type.id,
            guest_email="guest@example.com",
            idempotency_key=idempotency_key,
            language=language,
            source_channel="direct_web",
            source_metadata={"utm_source": "phase11"},
            request_ip="127.0.0.1",
            user_agent="pytest",
        )
    )
    return confirm_public_booking(
        PublicBookingPayload(
            hold_code=hold.hold_code,
            idempotency_key=idempotency_key,
            first_name="Jane",
            last_name="Guest",
            phone="+66810001111",
            email="guest@example.com",
            special_requests="Late arrival",
            language=language,
            source_channel="direct_web",
            source_metadata={"utm_source": "phase11"},
            terms_accepted=True,
            terms_version="2026-03",
        )
    )


def create_staff_reservation(*, first_name: str, room_type_code: str = "DBL", offset_days: int = 10) -> Reservation:
    room_type = RoomType.query.filter_by(code=room_type_code).one()
    check_in_date = date.today() + timedelta(days=offset_days)
    phone_suffix = f"{offset_days:02d}{len(first_name):04d}"
    return create_reservation(
        ReservationCreatePayload(
            first_name=first_name,
            last_name="Staff",
            phone=f"+6681{phone_suffix}",
            email=f"{first_name.lower()}@example.com",
            room_type_id=room_type.id,
            check_in_date=check_in_date,
            check_out_date=check_in_date + timedelta(days=2),
            adults=2,
            children=0,
            source_channel="admin_manual",
        )
    )


def test_public_booking_creates_guest_confirmation_and_staff_alert_deliveries(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_public_reservation()
        deliveries = query_notification_history(reservation_id=reservation.id, limit=10)
        guest_delivery = next(item for item in deliveries if item.event_type == "reservation.confirmation")
        staff_delivery = next(item for item in deliveries if item.event_type == "booking.new_alert" and item.channel == "internal_notification")
        outbox = EmailOutbox.query.filter_by(reservation_id=reservation.id, email_type="guest_confirmation").one()
        staff_note = StaffNotification.query.filter_by(reservation_id=reservation.id, notification_type="new_public_booking").one()

        assert guest_delivery.audience_type == "guest"
        assert guest_delivery.rendered_body and reservation.reservation_code in guest_delivery.rendered_body
        assert "Sandbox Hotel" in guest_delivery.rendered_body
        assert outbox.subject == guest_delivery.rendered_subject
        assert staff_delivery.status == "delivered"
        assert staff_note.payload_json["reservation_code"] == reservation.reservation_code


def test_deposit_request_email_tracks_payment_link_and_payment_success_waits_for_webhook(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    client = app.test_client()
    with app.app_context():
        reservation = create_public_reservation()
        request_row = create_or_reuse_deposit_request(
            reservation.id,
            actor_user_id=None,
            send_email=True,
            language="en",
            source="phase11",
        )
        deposit_delivery = next(
            item
            for item in query_notification_history(payment_request_id=request_row.id, limit=20)
            if item.event_type == "payment.deposit_request_email"
        )
        assert f"/payments/request/{request_row.request_code}" in (deposit_delivery.rendered_body or "")
        assert EmailOutbox.query.filter_by(
            reservation_id=reservation.id,
            email_type="deposit_payment_request",
        ).count() == 1

    response = client.get(
        f"/payments/return/{request_row.request_code}?reservation_code={reservation.reservation_code}&token={reservation.public_confirmation_token}"
    )
    assert response.status_code == 200

    with app.app_context():
        assert NotificationDelivery.query.filter_by(
            payment_request_id=request_row.id,
            event_type="payment.success_email",
        ).count() == 0

        payload = json.dumps(
            {
                "event_id": "evt-phase11-paid",
                "payment_request_code": request_row.request_code,
                "payment_request_id": str(request_row.id),
                "status": "paid",
                "provider_reference": request_row.provider_reference,
                "provider_payment_reference": "pi_phase11_paid",
                "amount": str(request_row.amount),
                "currency_code": "THB",
            }
        ).encode("utf-8")
        process_payment_webhook(
            "test_hosted",
            payload,
            {"X-Test-Hosted-Signature": sign_test_hosted_webhook(payload)},
        )
        process_payment_webhook(
            "test_hosted",
            payload,
            {"X-Test-Hosted-Signature": sign_test_hosted_webhook(payload)},
        )

        success_deliveries = NotificationDelivery.query.filter_by(
            payment_request_id=request_row.id,
            event_type="payment.success_email",
        ).all()
        assert len(success_deliveries) == 1
        assert success_deliveries[0].rendered_body and "Payment" in success_deliveries[0].rendered_subject


def test_pre_arrival_runner_only_targets_eligible_reservations(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        due_reservation = create_staff_reservation(first_name="Due", offset_days=1)
        cancelled_reservation = create_staff_reservation(first_name="Cancelled", offset_days=1)
        later_reservation = create_staff_reservation(first_name="Later", offset_days=3)
        cancelled_reservation.current_status = "cancelled"
        db.session.commit()

        result = send_due_pre_arrival_reminders()

        assert result["queued"] == 1
        reminder_deliveries = NotificationDelivery.query.filter_by(event_type="reservation.pre_arrival_reminder").all()
        assert len(reminder_deliveries) == 1
        assert reminder_deliveries[0].reservation_id == due_reservation.id
        assert later_reservation.id != reminder_deliveries[0].reservation_id


def test_cancellation_and_modification_confirmations_follow_real_state(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))
        cancel_reservation = create_staff_reservation(first_name="Cancel", offset_days=8)
        change_reservation = create_staff_reservation(first_name="Modify", offset_days=11)

        cancel_reservation_workspace(
            cancel_reservation.id,
            actor_user_id=admin.id,
            reason="Guest requested cancellation",
        )
        change_stay_dates(
            change_reservation.id,
            StayDateChangePayload(
                check_in_date=change_reservation.check_in_date + timedelta(days=1),
                check_out_date=change_reservation.check_out_date + timedelta(days=1),
                adults=change_reservation.adults,
                children=change_reservation.children,
                extra_guests=change_reservation.extra_guests,
            ),
            actor_user_id=admin.id,
        )

        cancellation_delivery = NotificationDelivery.query.filter_by(
            reservation_id=cancel_reservation.id,
            event_type="reservation.cancellation_confirmation",
        ).one()
        modification_delivery = NotificationDelivery.query.filter_by(
            reservation_id=change_reservation.id,
            event_type="reservation.modification_confirmation",
        ).one()

        assert cancellation_delivery.rendered_body and "cancel" in cancellation_delivery.rendered_body.lower()
        assert modification_delivery.rendered_body and change_reservation.check_in_date.isoformat() in modification_delivery.rendered_body


def test_failed_payment_reminder_runner_only_targets_unpaid_requests(app_factory):
    app = app_factory(
        seed=True,
        config={
            "PAYMENT_PROVIDER": "test_hosted",
            "PAYMENT_BASE_URL": "https://hosted.test",
            "PAYMENT_LINK_RESEND_COOLDOWN_SECONDS": 0,
        },
    )
    with app.app_context():
        reservation = create_public_reservation()
        request_row = create_or_reuse_deposit_request(
            reservation.id,
            actor_user_id=None,
            send_email=False,
            language="en",
            source="phase11",
        )
        request_row.status = "failed"
        request_row.failed_at = request_row.updated_at - timedelta(hours=8)
        request_row.last_sent_at = None
        db.session.commit()

        result = send_due_failed_payment_reminders()

        reminder = NotificationDelivery.query.filter_by(
            payment_request_id=request_row.id,
            event_type="payment.failed_reminder",
        ).one()
        assert result["queued"] == 1
        assert reminder.rendered_body and request_row.request_code in reminder.rendered_body
        assert EmailOutbox.query.filter_by(email_type="payment_failed", reservation_id=reservation.id).count() == 1


def test_optional_staff_alert_channel_failure_isolated_from_internal_alerts(app_factory):
    app = app_factory(
        seed=True,
        config={"LINE_STAFF_ALERT_WEBHOOK_URL": "http://127.0.0.1:9/line-hook"},
    )
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))
        upsert_settings_bundle(
            [
                {
                    "key": "notifications.line_staff_alert_enabled",
                    "value": True,
                    "value_type": "boolean",
                    "description": "Enable optional LINE staff alert channel",
                    "is_public": False,
                    "sort_order": 40,
                }
            ],
            actor_user_id=admin.id,
        )
        reservation = create_staff_reservation(first_name="Alert", offset_days=12)
        delivery_ids = queue_staff_new_booking_alert(reservation, actor_user_id=admin.id)
        result = dispatch_notification_deliveries(delivery_ids)
        internal_delivery = NotificationDelivery.query.filter_by(
            reservation_id=reservation.id,
            event_type="booking.new_alert",
            channel="internal_notification",
        ).order_by(NotificationDelivery.created_at.desc()).first()
        line_delivery = NotificationDelivery.query.filter_by(
            reservation_id=reservation.id,
            event_type="booking.new_alert",
            channel="line_staff_alert",
        ).order_by(NotificationDelivery.created_at.desc()).first()

        assert internal_delivery is not None and internal_delivery.status == "delivered"
        assert line_delivery is not None and line_delivery.status == "failed"
        assert result["sent"] >= 1
        assert result["failed"] >= 1


def test_template_updates_affect_future_deliveries_only(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))
        reservation = create_public_reservation()
        original_delivery = NotificationDelivery.query.filter_by(
            reservation_id=reservation.id,
            event_type="reservation.confirmation",
        ).one()
        template = NotificationTemplate.query.filter_by(
            template_key="guest_confirmation",
            channel="email",
            language_code="en",
        ).one()

        upsert_notification_template(
            template.id,
            NotificationTemplatePayload(
                template_key="guest_confirmation",
                channel="email",
                language_code="en",
                description=template.description,
                subject_template=template.subject_template,
                body_template=f"{template.body_template}\nUPDATED COPY",
                is_active=True,
            ),
            actor_user_id=admin.id,
        )

        delivery_ids = queue_reservation_confirmation(
            reservation,
            actor_user_id=admin.id,
            language_code="en",
            manual=True,
        )
        dispatch_notification_deliveries(delivery_ids)

        latest_delivery = NotificationDelivery.query.filter_by(
            reservation_id=reservation.id,
            event_type="reservation.confirmation",
        ).order_by(NotificationDelivery.created_at.desc()).first()

        assert original_delivery.rendered_body and "UPDATED COPY" not in original_delivery.rendered_body
        assert latest_delivery is not None and latest_delivery.rendered_body and "UPDATED COPY" in latest_delivery.rendered_body


def test_admin_communications_page_requires_permission_and_saves_settings(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))
        housekeeping = make_staff_user(email="hk-communications@example.com", role_code="housekeeping")
        reservation = create_public_reservation()

    login_as(client, housekeeping)
    assert client.get("/staff/admin/communications").status_code == 403

    login_as(client, admin)
    response = client.get("/staff/admin/communications")
    assert response.status_code == 200
    assert reservation.reservation_code in response.get_data(as_text=True)

    response = post_form(
        client,
        "/staff/admin/communications",
        data={
            "action": "save_settings",
            "sender_name": "Sandbox Communications",
            "pre_arrival_enabled": "on",
            "pre_arrival_days_before": "2",
            "failed_payment_reminder_enabled": "on",
            "failed_payment_reminder_delay_hours": "12",
            "staff_email_alerts_enabled": "on",
            "staff_alert_recipients": "desk@example.com,manager@example.com",
        },
    )
    assert response.status_code == 302

    with app.app_context():
        refreshed = client.get("/staff/admin/communications")
        assert refreshed.status_code == 200
        assert "Sandbox Communications" in refreshed.get_data(as_text=True)


def test_housekeeping_cannot_trigger_restricted_resend_actions(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_public_reservation()
        housekeeping = make_staff_user(email="hk-resend@example.com", role_code="housekeeping")

    login_as(client, housekeeping)
    response = post_form(
        client,
        f"/staff/reservations/{reservation.id}/resend-confirmation",
        data={"language": "en"},
    )
    assert response.status_code == 403
