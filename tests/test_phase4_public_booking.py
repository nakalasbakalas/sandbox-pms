from __future__ import annotations

import os
import threading
from datetime import date, timedelta
from pathlib import Path
from uuid import UUID

import pytest
import sqlalchemy as sa
from flask_migrate import upgrade

from pms.app import create_app
from pms.extensions import db
from pms.models import (
    CancellationRequest,
    EmailOutbox,
    InventoryDay,
    ModificationRequest,
    Reservation,
    ReservationHold,
    ReservationReviewQueue,
    Room,
    RoomType,
    StaffNotification,
)
from pms.seeds import seed_all
from pms.services.public_booking_service import (
    HoldRequestPayload,
    PublicBookingPayload,
    PublicSearchPayload,
    VerificationRequestPayload,
    cleanup_expired_holds,
    confirm_public_booking,
    create_reservation_hold,
    load_public_confirmation,
    search_public_availability,
    submit_cancellation_request,
    submit_modification_request,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = PROJECT_ROOT / "migrations"


def csrf_token_for(client) -> str:
    with client.session_transaction() as client_session:
        token = client_session.get("_csrf_token")
        if not token:
            token = "test-csrf-token"
            client_session["_csrf_token"] = token
        return token


def post_form(client, url: str, *, data: dict, follow_redirects: bool = False):
    payload = dict(data)
    payload["csrf_token"] = csrf_token_for(client)
    return client.post(url, data=payload, follow_redirects=follow_redirects)


def make_search_payload(room_type_id=None, **overrides):
    payload = PublicSearchPayload(
        check_in_date=date.today() + timedelta(days=7),
        check_out_date=date.today() + timedelta(days=9),
        adults=2,
        children=0,
        room_type_id=room_type_id,
        language="en",
    )
    for key, value in overrides.items():
        setattr(payload, key, value)
    return payload


def make_hold_payload(room_type_id, **overrides):
    payload = HoldRequestPayload(
        check_in_date=date.today() + timedelta(days=7),
        check_out_date=date.today() + timedelta(days=9),
        adults=2,
        children=0,
        room_type_id=room_type_id,
        guest_email="guest@example.com",
        idempotency_key="hold-001",
        language="en",
        source_channel="google_business",
        source_metadata={"utm_source": "google_business"},
        request_ip="127.0.0.1",
        user_agent="pytest",
    )
    for key, value in overrides.items():
        setattr(payload, key, value)
    return payload


def make_booking_payload(hold_code, idempotency_key="hold-001", **overrides):
    payload = PublicBookingPayload(
        hold_code=hold_code,
        idempotency_key=idempotency_key,
        first_name="Jane",
        last_name="Doe",
        phone="+66800000001",
        email="guest@example.com",
        special_requests="Late arrival",
        language="en",
        source_channel="google_business",
        source_metadata={"utm_source": "google_business"},
        terms_accepted=True,
        terms_version="2026-03",
    )
    for key, value in overrides.items():
        setattr(payload, key, value)
    return payload


def lock_all_but_one(room_type_code: str, business_dates: list[date]) -> None:
    room_type = RoomType.query.filter_by(code=room_type_code).first()
    rooms = Room.query.filter_by(room_type_id=room_type.id, is_sellable=True).order_by(Room.room_number.asc()).all()
    for room in rooms[1:]:
        rows = InventoryDay.query.filter(
            InventoryDay.room_id == room.id,
            InventoryDay.business_date.in_(business_dates),
        ).all()
        for row in rows:
            row.availability_status = "reserved"
            row.is_sellable = False
    db.session.commit()


def postgres_seeded_app():
    database_url = os.environ["TEST_DATABASE_URL"]
    app = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": database_url,
            "AUTO_BOOTSTRAP_SCHEMA": False,
            "AUTO_SEED_REFERENCE_DATA": False,
            "INVENTORY_BOOTSTRAP_DAYS": 30,
        }
    )
    with app.app_context():
        db.session.remove()
        with db.engine.begin() as connection:
            connection.execute(sa.text("DROP SCHEMA IF EXISTS public CASCADE"))
            connection.execute(sa.text("CREATE SCHEMA public"))
        upgrade(directory=str(MIGRATIONS_DIR))
        seed_all(app.config["INVENTORY_BOOTSTRAP_DAYS"])
    return app


def test_public_availability_returns_only_sellable_rooms(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        results = search_public_availability(make_search_payload(twin.id))
        assert results
        assert results[0]["available_rooms"] == 15


def test_non_sellable_rooms_never_appear_publicly(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        nights = [date.today() + timedelta(days=7), date.today() + timedelta(days=8)]
        room_216 = Room.query.filter_by(room_number="216").first()
        room_316 = Room.query.filter_by(room_number="316").first()
        rows = InventoryDay.query.filter(
            InventoryDay.room_id.in_([room_216.id, room_316.id]),
            InventoryDay.business_date.in_(nights),
        ).all()
        assert all(row.is_sellable is False or row.availability_status == "out_of_service" for row in rows)


def test_invalid_dates_are_rejected(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        with pytest.raises(ValueError):
            search_public_availability(make_search_payload(check_in_date=date.today() + timedelta(days=8), check_out_date=date.today() + timedelta(days=8)))


def test_occupancy_violations_are_rejected(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        with pytest.raises(ValueError):
            search_public_availability(make_search_payload(twin.id, adults=2, children=2))


def test_terms_acceptance_is_required(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id))
        with pytest.raises(ValueError):
            confirm_public_booking(make_booking_payload(hold.hold_code, terms_accepted=False))


def test_booking_confirmation_returns_booking_reference(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id))
        reservation = confirm_public_booking(make_booking_payload(hold.hold_code))
        assert reservation.reservation_code.startswith("SBX-")


def test_guest_confirmation_email_is_queued_after_booking(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id))
        reservation = confirm_public_booking(make_booking_payload(hold.hold_code))
        outbox = EmailOutbox.query.filter_by(reservation_id=reservation.id).one()
        assert outbox.email_type == "guest_confirmation"
        assert outbox.status in {"pending", "failed", "sent"}


def test_staff_review_queue_receives_new_reservation(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id))
        reservation = confirm_public_booking(make_booking_payload(hold.hold_code))
        queue_entry = ReservationReviewQueue.query.filter_by(reservation_id=reservation.id).one()
        notification = StaffNotification.query.filter_by(reservation_id=reservation.id).one()
        assert queue_entry.review_status == "new"
        assert notification.notification_type == "new_public_booking"


def test_cancellation_request_can_be_submitted_and_linked(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id))
        reservation = confirm_public_booking(make_booking_payload(hold.hold_code))
        request_row = submit_cancellation_request(
            VerificationRequestPayload(
                booking_reference=reservation.reservation_code,
                contact_value="guest@example.com",
                language="en",
                reason="Plans changed",
                request_ip="127.0.0.1",
                user_agent="pytest",
            )
        )
        assert request_row is not None
        assert request_row.reservation_id == reservation.id
        assert CancellationRequest.query.count() == 1


def test_modification_request_can_be_submitted_and_reviewed(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id))
        reservation = confirm_public_booking(make_booking_payload(hold.hold_code))
        request_row = submit_modification_request(
            VerificationRequestPayload(
                booking_reference=reservation.reservation_code,
                contact_value="guest@example.com",
                language="en",
                request_ip="127.0.0.1",
                user_agent="pytest",
                requested_changes={"requested_check_in": str(date.today() + timedelta(days=8))},
            )
        )
        request_row.status = "reviewed"
        db.session.commit()
        assert ModificationRequest.query.one().status == "reviewed"


def test_duplicate_browser_submit_does_not_create_two_bookings(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id))
        first = confirm_public_booking(make_booking_payload(hold.hold_code))
        second = confirm_public_booking(make_booking_payload(hold.hold_code))
        assert first.id == second.id
        assert Reservation.query.count() == 1


def test_duplicate_idempotency_key_does_not_create_two_holds_or_bookings(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        first_hold = create_reservation_hold(make_hold_payload(twin.id, idempotency_key="same-key"))
        second_hold = create_reservation_hold(make_hold_payload(twin.id, idempotency_key="same-key"))
        reservation = confirm_public_booking(make_booking_payload(first_hold.hold_code, idempotency_key="same-key"))
        assert first_hold.id == second_hold.id
        assert reservation.reservation_code


def test_two_last_room_attempts_do_not_both_succeed(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        nights = [date.today() + timedelta(days=7), date.today() + timedelta(days=8)]
        lock_all_but_one("TWN", nights)
        first_hold = create_reservation_hold(make_hold_payload(twin.id, idempotency_key="last-room-1"))
        with pytest.raises(ValueError):
            create_reservation_hold(make_hold_payload(twin.id, idempotency_key="last-room-2", guest_email="other@example.com"))
        assert first_hold.hold_code


def test_last_room_failure_returns_graceful_unavailability_message(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        nights = [date.today() + timedelta(days=7), date.today() + timedelta(days=8)]
        lock_all_but_one("TWN", nights)
        create_reservation_hold(make_hold_payload(twin.id, idempotency_key="graceful-1"))
        with pytest.raises(ValueError, match="Please choose a refreshed option|just taken|unavailable"):
            create_reservation_hold(make_hold_payload(twin.id, idempotency_key="graceful-2", guest_email="other@example.com"))


def test_expired_hold_releases_availability(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id))
        hold.expires_at = hold.expires_at - timedelta(minutes=30)
        db.session.commit()
        cleanup_expired_holds()
        db.session.commit()
        rows = InventoryDay.query.filter_by(hold_id=hold.id).all()
        assert rows == []


def test_stale_hold_cannot_confirm_after_expiry(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id))
        hold.expires_at = hold.expires_at - timedelta(minutes=30)
        db.session.commit()
        with pytest.raises(ValueError):
            confirm_public_booking(make_booking_payload(hold.hold_code))


def test_multilingual_content_renders_for_booking_flow(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    response = client.get("/availability?lang=zh-Hans")
    assert response.status_code == 200
    assert "查询可订房型" in response.get_data(as_text=True)


def test_booking_source_tracking_is_persisted(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id, source_channel="facebook", source_metadata={"utm_source": "facebook"}))
        reservation = confirm_public_booking(make_booking_payload(hold.hold_code, source_channel="facebook", source_metadata={"utm_source": "facebook"}))
        assert reservation.source_channel == "facebook"
        assert reservation.source_metadata_json["utm_source"] == "facebook"


def test_backend_validation_blocks_malformed_requests(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id))
        with pytest.raises(ValueError):
            confirm_public_booking(make_booking_payload(hold.hold_code, email="not-an-email"))


def test_public_confirmation_access_uses_secure_token(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id))
        reservation = confirm_public_booking(make_booking_payload(hold.hold_code))
        assert load_public_confirmation(reservation.reservation_code, "bad-token") is None
        assert load_public_confirmation(reservation.reservation_code, reservation.public_confirmation_token) is not None


def test_public_route_flow_creates_booking_and_confirmation_page(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
    response = post_form(
        client,
        "/booking/hold",
        data={
            "room_type_id": str(twin.id),
            "check_in_date": str(date.today() + timedelta(days=7)),
            "check_out_date": str(date.today() + timedelta(days=9)),
            "adults": "2",
            "children": "0",
            "language": "en",
            "source_channel": "direct_web",
            "idempotency_key": "route-hold-1",
            "email": "route@example.com",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    with app.app_context():
        hold = ReservationHold.query.filter_by(idempotency_key="route-hold-1").one()
    response = post_form(
        client,
        "/booking/confirm",
        data={
            "hold_code": hold.hold_code,
            "idempotency_key": "route-hold-1",
            "first_name": "Route",
            "last_name": "Guest",
            "phone": "+66800000009",
            "email": "route@example.com",
            "language": "en",
            "source_channel": "direct_web",
            "accept_terms": "on",
        },
        follow_redirects=False,
    )
    assert response.status_code == 302
    assert "/booking/confirmation/" in response.headers["Location"]


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is not configured for Postgres concurrency testing")
def test_postgres_concurrent_last_room_hold_allows_only_one_success():
    app = postgres_seeded_app()
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        nights = [date.today() + timedelta(days=7), date.today() + timedelta(days=8)]
        lock_all_but_one("TWN", nights)
        room_type_id = twin.id

    barrier = threading.Barrier(3)
    results: list[tuple[str, str]] = []
    lock = threading.Lock()

    def worker(idempotency_key: str, guest_email: str) -> None:
        worker_app = create_app(
            {
                "TESTING": True,
                "SQLALCHEMY_DATABASE_URI": os.environ["TEST_DATABASE_URL"],
                "AUTO_BOOTSTRAP_SCHEMA": False,
                "AUTO_SEED_REFERENCE_DATA": False,
                "INVENTORY_BOOTSTRAP_DAYS": 30,
            }
        )
        with worker_app.app_context():
            barrier.wait()
            try:
                hold = create_reservation_hold(
                    make_hold_payload(
                        room_type_id,
                        idempotency_key=idempotency_key,
                        guest_email=guest_email,
                        request_ip=f"10.0.0.{1 if idempotency_key.endswith('1') else 2}",
                    )
                )
                outcome = ("ok", hold.hold_code)
            except Exception as exc:  # noqa: BLE001
                outcome = ("error", str(exc))
            finally:
                db.session.remove()
            with lock:
                results.append(outcome)

    thread_one = threading.Thread(target=worker, args=("pg-last-room-1", "pg1@example.com"))
    thread_two = threading.Thread(target=worker, args=("pg-last-room-2", "pg2@example.com"))
    thread_one.start()
    thread_two.start()
    barrier.wait()
    thread_one.join()
    thread_two.join()

    successes = [item for item in results if item[0] == "ok"]
    failures = [item for item in results if item[0] == "error"]
    assert len(successes) == 1
    assert len(failures) == 1
    assert "unavailable" in failures[0][1].lower() or "taken" in failures[0][1].lower()

    with app.app_context():
        active_holds = ReservationHold.query.filter_by(status="active").count()
        assert active_holds == 1
