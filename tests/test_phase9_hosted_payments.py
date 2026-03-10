from __future__ import annotations

import os
from datetime import date, timedelta
from pathlib import Path

import pytest
import sqlalchemy as sa
from flask_migrate import upgrade
from werkzeug.security import generate_password_hash

from pms.extensions import db
from pms.models import EmailOutbox, FolioCharge, PaymentEvent, PaymentRequest, Reservation, Role, RoomType, User
from pms.seeds import seed_all
from pms.services.cashier_service import folio_summary
from pms.services.payment_integration_service import (
    active_payment_provider_name,
    create_or_reuse_deposit_request,
    process_payment_webhook,
    resend_payment_link,
    sign_test_hosted_webhook,
)
from pms.services.reservation_service import ReservationCreatePayload, create_reservation


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = PROJECT_ROOT / "migrations"


def make_staff_user(role_code: str, email: str) -> User:
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
    with client.session_transaction() as session:
        session["staff_user_id"] = str(user.id)
        session["_csrf_token"] = "test-csrf-token"


def post_form(client, url: str, *, data: dict, follow_redirects: bool = False):
    payload = dict(data)
    payload["csrf_token"] = "test-csrf-token"
    return client.post(url, data=payload, follow_redirects=follow_redirects)


def create_public_reservation() -> Reservation:
    room_type = RoomType.query.filter_by(code="DBL").one()
    reservation = create_reservation(
        ReservationCreatePayload(
            first_name="Public",
            last_name="Guest",
            phone="+66810001111",
            email="public.guest@example.com",
            room_type_id=room_type.id,
            check_in_date=date.today() + timedelta(days=5),
            check_out_date=date.today() + timedelta(days=7),
            adults=2,
            children=0,
            source_channel="direct_web",
        )
    )
    reservation.created_from_public_booking_flow = True
    reservation.booking_language = "en"
    reservation.public_confirmation_token = "public-token-123"
    db.session.commit()
    return reservation


def test_provider_selection_and_deposit_request_creation(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        reservation = create_public_reservation()
        request_row = create_or_reuse_deposit_request(
            reservation.id,
            actor_user_id=None,
            send_email=False,
            language="en",
            source="test",
        )

        assert active_payment_provider_name() == "test_hosted"
        assert request_row.request_code.startswith("PAY-")
        assert request_row.provider == "test_hosted"
        assert request_row.payment_url.startswith("https://hosted.test/hosted-checkout/")
        assert request_row.provider_reference


def test_public_payment_start_and_return_do_not_treat_redirect_as_final_truth(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    client = app.test_client()
    with app.app_context():
        reservation = create_public_reservation()
        request_row = create_or_reuse_deposit_request(reservation.id, actor_user_id=None, send_email=False, language="en", source="test")

    start_response = client.get(
        f"/payments/request/{request_row.request_code}?reservation_code={reservation.reservation_code}&token={reservation.public_confirmation_token}"
    )
    assert start_response.status_code == 302
    assert start_response.headers["Location"].startswith("https://hosted.test/hosted-checkout/")

    return_response = client.get(
        f"/payments/return/{request_row.request_code}?reservation_code={reservation.reservation_code}&token={reservation.public_confirmation_token}"
    )
    assert return_response.status_code == 200
    assert b"Pending confirmation" in return_response.data


def test_webhook_paid_event_updates_status_and_applies_folio_deposit(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        reservation = create_public_reservation()
        request_row = create_or_reuse_deposit_request(reservation.id, actor_user_id=None, send_email=False, language="en", source="test")
        payload = {
            "event_id": "evt-paid-1",
            "payment_request_code": request_row.request_code,
            "payment_request_id": str(request_row.id),
            "status": "paid",
            "provider_reference": request_row.provider_reference,
            "provider_payment_reference": "pi_test_paid_1",
            "amount": str(request_row.amount),
            "currency_code": "THB",
        }
        body = __import__("json").dumps(payload).encode("utf-8")

        result = process_payment_webhook(
            "test_hosted",
            body,
            {"X-Test-Hosted-Signature": sign_test_hosted_webhook(body)},
        )
        db.session.expire_all()
        updated_request = db.session.get(PaymentRequest, request_row.id)
        summary = folio_summary(reservation.id)

        assert result["processed"] == 1
        assert updated_request.status == "paid"
        assert summary["deposit_received_amount"] == updated_request.amount
        assert FolioCharge.query.filter_by(posting_key=f"provider_deposit:{request_row.id}").count() == 1


def test_duplicate_paid_webhook_is_idempotent(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        reservation = create_public_reservation()
        request_row = create_or_reuse_deposit_request(reservation.id, actor_user_id=None, send_email=False, language="en", source="test")
        payload = __import__("json").dumps(
            {
                "event_id": "evt-paid-dup",
                "payment_request_code": request_row.request_code,
                "payment_request_id": str(request_row.id),
                "status": "paid",
                "provider_reference": request_row.provider_reference,
                "provider_payment_reference": "pi_test_dup",
                "amount": str(request_row.amount),
                "currency_code": "THB",
            }
        ).encode("utf-8")
        headers = {"X-Test-Hosted-Signature": sign_test_hosted_webhook(payload)}

        first = process_payment_webhook("test_hosted", payload, headers)
        second = process_payment_webhook("test_hosted", payload, headers)

        assert first["processed"] == 1
        assert second["duplicates"] == 1
        assert FolioCharge.query.filter_by(posting_key=f"provider_deposit:{request_row.id}").count() == 1


def test_failed_and_expired_payment_handling_update_status_without_folio_application(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        reservation = create_public_reservation()
        request_row = create_or_reuse_deposit_request(reservation.id, actor_user_id=None, send_email=False, language="en", source="test")

        for idx, status in enumerate(["failed", "expired"], start=1):
            payload = __import__("json").dumps(
                {
                    "event_id": f"evt-{status}-{idx}",
                    "payment_request_code": request_row.request_code,
                    "payment_request_id": str(request_row.id),
                    "status": status,
                    "provider_reference": request_row.provider_reference,
                    "amount": str(request_row.amount),
                    "currency_code": "THB",
                }
            ).encode("utf-8")
            process_payment_webhook("test_hosted", payload, {"X-Test-Hosted-Signature": sign_test_hosted_webhook(payload)})
            db.session.expire_all()
            request_row = db.session.get(PaymentRequest, request_row.id)
            assert request_row.status == status

        assert FolioCharge.query.filter_by(posting_key=f"provider_deposit:{request_row.id}").count() == 0


def test_resend_payment_link_records_email_and_history(app_factory):
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
        request_row = create_or_reuse_deposit_request(reservation.id, actor_user_id=None, send_email=False, language="en", source="test")
        refreshed = resend_payment_link(request_row.id, actor_user_id=None, force_new=True)

        assert refreshed.payment_url.startswith("https://hosted.test/hosted-checkout/")
        assert EmailOutbox.query.filter_by(email_type="deposit_payment_request", reservation_id=reservation.id).count() == 1
        assert PaymentEvent.query.filter_by(payment_request_id=request_row.id, event_type="payment.link_resent").count() == 1


def test_provider_reference_mapping_works_without_request_code(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        reservation = create_public_reservation()
        request_row = create_or_reuse_deposit_request(reservation.id, actor_user_id=None, send_email=False, language="en", source="test")
        payload = __import__("json").dumps(
            {
                "event_id": "evt-provider-ref-only",
                "status": "paid",
                "provider_reference": request_row.provider_reference,
                "provider_payment_reference": "pi_provider_ref",
                "amount": str(request_row.amount),
                "currency_code": "THB",
            }
        ).encode("utf-8")

        process_payment_webhook("test_hosted", payload, {"X-Test-Hosted-Signature": sign_test_hosted_webhook(payload)})
        db.session.expire_all()
        updated = db.session.get(PaymentRequest, request_row.id)
        assert updated.status == "paid"
        assert updated.provider_payment_reference == "pi_provider_ref"


def test_staff_permission_checks_protect_payment_request_actions(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    client = app.test_client()
    with app.app_context():
        reservation = create_public_reservation()
        hk_user = make_staff_user("housekeeping", "hk-payments@example.com")

    login_as(client, hk_user)
    response = post_form(
        client,
        f"/staff/cashier/{reservation.id}/payment-requests",
        data={"back_url": f"/staff/cashier/{reservation.id}"},
    )
    assert response.status_code == 403


def test_public_confirmation_does_not_expose_provider_secret(app_factory):
    app = app_factory(
        seed=True,
        config={
            "PAYMENT_PROVIDER": "test_hosted",
            "PAYMENT_BASE_URL": "https://hosted.test",
            "TEST_HOSTED_PAYMENT_SECRET": "super-secret-do-not-leak",
        },
    )
    client = app.test_client()
    with app.app_context():
        reservation = create_public_reservation()
        request_row = create_or_reuse_deposit_request(reservation.id, actor_user_id=None, send_email=False, language="en", source="test")

    response = client.get(
        f"/booking/confirmation/{reservation.reservation_code}?token={reservation.public_confirmation_token}"
    )
    assert response.status_code == 200
    assert request_row.request_code.encode("utf-8") in response.data
    assert b"super-secret-do-not-leak" not in response.data


def test_return_before_webhook_then_webhook_before_return_is_stable(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    client = app.test_client()
    with app.app_context():
        reservation = create_public_reservation()
        request_row = create_or_reuse_deposit_request(reservation.id, actor_user_id=None, send_email=False, language="en", source="test")

        first_return = client.get(
            f"/payments/return/{request_row.request_code}?reservation_code={reservation.reservation_code}&token={reservation.public_confirmation_token}"
        )
        assert first_return.status_code == 200
        assert b"Pending confirmation" in first_return.data

        payload = __import__("json").dumps(
            {
                "event_id": "evt-ordering-1",
                "payment_request_code": request_row.request_code,
                "payment_request_id": str(request_row.id),
                "status": "paid",
                "provider_reference": request_row.provider_reference,
                "provider_payment_reference": "pi_ordering_1",
                "amount": str(request_row.amount),
                "currency_code": "THB",
            }
        ).encode("utf-8")
        process_payment_webhook("test_hosted", payload, {"X-Test-Hosted-Signature": sign_test_hosted_webhook(payload)})

        second_return = client.get(
            f"/payments/return/{request_row.request_code}?reservation_code={reservation.reservation_code}&token={reservation.public_confirmation_token}"
        )
        assert second_return.status_code == 200
        assert b"applied to your reservation folio" in second_return.data


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not configured")
def test_postgres_webhook_processing_remains_idempotent_under_repeated_calls():
    from pms.app import create_app

    app = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": os.environ["TEST_DATABASE_URL"],
            "AUTO_BOOTSTRAP_SCHEMA": False,
            "AUTO_SEED_REFERENCE_DATA": False,
            "INVENTORY_BOOTSTRAP_DAYS": 30,
            "PAYMENT_PROVIDER": "test_hosted",
            "PAYMENT_BASE_URL": "https://hosted.test",
        }
    )
    with app.app_context():
        db.session.remove()
        with db.engine.begin() as connection:
            connection.execute(sa.text("DROP SCHEMA IF EXISTS public CASCADE"))
            connection.execute(sa.text("CREATE SCHEMA public"))
        upgrade(directory=str(MIGRATIONS_DIR))
        seed_all(app.config["INVENTORY_BOOTSTRAP_DAYS"])
        reservation = create_public_reservation()
        request_row = create_or_reuse_deposit_request(reservation.id, actor_user_id=None, send_email=False, language="en", source="test")
        payload = __import__("json").dumps(
            {
                "event_id": "evt-pg-repeat",
                "payment_request_code": request_row.request_code,
                "payment_request_id": str(request_row.id),
                "status": "paid",
                "provider_reference": request_row.provider_reference,
                "provider_payment_reference": "pi_pg_repeat",
                "amount": str(request_row.amount),
                "currency_code": "THB",
            }
        ).encode("utf-8")
        headers = {"X-Test-Hosted-Signature": sign_test_hosted_webhook(payload)}

        process_payment_webhook("test_hosted", payload, headers)
        process_payment_webhook("test_hosted", payload, headers)

        assert FolioCharge.query.filter_by(posting_key=f"provider_deposit:{request_row.id}").count() == 1
