from __future__ import annotations

from datetime import date, timedelta

from pms.extensions import db
from pms.models import EmailOutbox, Reservation, RoomType, User
from pms.services.auth_service import request_password_reset
from pms.services.payment_integration_service import (
    create_or_reuse_deposit_request,
    guest_payment_entry_url,
    payment_return_url,
)
from pms.services.reservation_service import ReservationCreatePayload, create_reservation


def create_public_reservation() -> Reservation:
    room_type = RoomType.query.filter_by(code="DBL").one()
    reservation = create_reservation(
        ReservationCreatePayload(
            first_name="Topology",
            last_name="Guest",
            phone="+66810002222",
            email="topology.guest@example.com",
            room_type_id=room_type.id,
            check_in_date=date.today() + timedelta(days=6),
            check_out_date=date.today() + timedelta(days=8),
            adults=2,
            children=0,
            source_channel="direct_web",
        )
    )
    reservation.created_from_public_booking_flow = True
    reservation.booking_language = "en"
    reservation.public_confirmation_token = "topology-token-123"
    db.session.commit()
    return reservation


def test_public_payment_urls_use_booking_host_even_from_staff_request_context(app_factory):
    app = app_factory(
        seed=True,
        config={
            "APP_BASE_URL": "https://book.example.com",
            "BOOKING_ENGINE_URL": "https://book.example.com",
            "STAFF_APP_URL": "https://staff.example.com",
            "PAYMENT_PROVIDER": "test_hosted",
            "PAYMENT_BASE_URL": "https://hosted.test",
        },
    )
    with app.app_context():
        reservation = create_public_reservation()
        payment_request = create_or_reuse_deposit_request(
            reservation.id,
            actor_user_id=None,
            send_email=False,
            language="en",
            source="topology-test",
        )

        with app.test_request_context("/staff/cashier/demo", base_url="https://staff.example.com"):
            entry_url = guest_payment_entry_url(payment_request, reservation, external=True)
            return_url = payment_return_url(payment_request, reservation, external=True)

        assert entry_url.startswith("https://book.example.com/payments/request/")
        assert return_url.startswith("https://book.example.com/payments/return/")
        assert payment_request.payment_url is not None
        assert "https%3A%2F%2Fbook.example.com%2Fpayments%2Frequest%2F" in payment_request.payment_url


def test_password_reset_email_uses_staff_host(app_factory):
    app = app_factory(
        seed=True,
        config={
            "APP_BASE_URL": "https://book.example.com",
            "BOOKING_ENGINE_URL": "https://book.example.com",
            "STAFF_APP_URL": "https://staff.example.com",
        },
    )
    with app.app_context():
        user = User.query.filter_by(email="admin@sandbox.local").one()
        result = request_password_reset(user.email, ip_address="127.0.0.1")
        outbox = (
            EmailOutbox.query.filter_by(email_type="password_reset")
            .order_by(EmailOutbox.created_at.desc())
            .first()
        )

        assert result.issued is True
        assert outbox is not None
        assert "https://staff.example.com/staff/reset-password/" in outbox.body_text
        assert "https://book.example.com/staff/reset-password/" not in outbox.body_text


def test_staff_routes_redirect_to_staff_host_when_enforced(app_factory):
    app = app_factory(
        config={
            "APP_BASE_URL": "https://book.example.com",
            "BOOKING_ENGINE_URL": "https://book.example.com",
            "STAFF_APP_URL": "https://staff.example.com",
            "ENFORCE_CANONICAL_HOSTS": True,
        }
    )
    client = app.test_client()

    response = client.get("/staff/login", base_url="https://book.example.com")

    assert response.status_code == 302
    assert response.headers["Location"] == "https://staff.example.com/staff/login"


def test_provider_routes_redirect_to_staff_host_when_enforced(app_factory):
    app = app_factory(
        config={
            "APP_BASE_URL": "https://book.example.com",
            "BOOKING_ENGINE_URL": "https://book.example.com",
            "STAFF_APP_URL": "https://staff.example.com",
            "ENFORCE_CANONICAL_HOSTS": True,
        }
    )
    client = app.test_client()

    response = client.get("/provider/calendar", base_url="https://book.example.com")

    assert response.status_code == 302
    assert response.headers["Location"] == "https://staff.example.com/provider/calendar"


def test_public_routes_redirect_to_booking_host_when_enforced(app_factory):
    app = app_factory(
        config={
            "APP_BASE_URL": "https://book.example.com",
            "BOOKING_ENGINE_URL": "https://book.example.com",
            "STAFF_APP_URL": "https://staff.example.com",
            "ENFORCE_CANONICAL_HOSTS": True,
        }
    )
    client = app.test_client()

    response = client.get("/", base_url="https://staff.example.com")

    assert response.status_code == 302
    assert response.headers["Location"] == "https://book.example.com/"


def test_local_same_origin_topology_does_not_redirect(app_factory):
    app = app_factory(
        config={
            "APP_BASE_URL": "http://127.0.0.1:5000",
            "BOOKING_ENGINE_URL": "http://127.0.0.1:5000",
            "STAFF_APP_URL": "http://127.0.0.1:5000",
            "ENFORCE_CANONICAL_HOSTS": True,
            "AUTH_COOKIE_SECURE": False,
            "SESSION_COOKIE_SECURE": False,
        }
    )
    client = app.test_client()

    response = client.get("/staff", base_url="http://127.0.0.1:5000")

    assert response.status_code == 401
    assert "Location" not in response.headers


def test_public_booking_host_renders_without_missing_template_globals(app_factory):
    app = app_factory(
        seed=True,
        config={
            "APP_BASE_URL": "https://book.example.com",
            "BOOKING_ENGINE_URL": "https://book.example.com",
            "STAFF_APP_URL": "https://staff.example.com",
            "ENFORCE_CANONICAL_HOSTS": True,
        },
    )
    client = app.test_client()

    response = client.get("/", base_url="https://book.example.com")

    assert response.status_code == 200
    assert b"application/ld+json" in response.data
    assert b"tel:" in response.data


def test_staff_host_login_renders_without_missing_template_globals(app_factory):
    app = app_factory(
        config={
            "APP_BASE_URL": "https://book.example.com",
            "BOOKING_ENGINE_URL": "https://book.example.com",
            "STAFF_APP_URL": "https://staff.example.com",
            "ENFORCE_CANONICAL_HOSTS": True,
        }
    )
    client = app.test_client()

    response = client.get("/staff/login", base_url="https://staff.example.com")

    assert response.status_code == 200
    assert b"Staff sign in" in response.data
    assert b'<link rel="canonical" href="https://staff.example.com/staff/login?lang=th">' in response.data
