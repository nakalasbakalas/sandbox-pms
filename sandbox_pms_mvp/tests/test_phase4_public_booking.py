from __future__ import annotations

import os
import re
import threading
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import pytest
import sqlalchemy as sa
from flask_migrate import upgrade

from pms.app import create_app
from pms.extensions import db
from pms.models import (
    BookingExtra,
    CancellationRequest,
    EmailOutbox,
    FolioCharge,
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
from pms.services.payment_integration_service import create_or_reuse_deposit_request
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


def create_public_extra(*, code: str, name: str, pricing_mode: str, unit_price: str) -> BookingExtra:
    extra = BookingExtra(
        code=code,
        name=name,
        pricing_mode=pricing_mode,
        unit_price=Decimal(unit_price),
        is_active=True,
        is_public=True,
        sort_order=10,
    )
    db.session.add(extra)
    db.session.commit()
    return extra


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
        seed_all(app.config["INVENTORY_BOOTSTRAP_DAYS"], include_demo_data=True)
    return app


def test_public_availability_returns_only_sellable_rooms(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        results = search_public_availability(make_search_payload(twin.id))
        assert results
        assert results[0]["available_rooms"] == 15


def test_public_room_merchandising_renders_on_availability_and_booking_summary(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    check_in = date.today() + timedelta(days=7)
    check_out = date.today() + timedelta(days=9)

    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").one()
        double = RoomType.query.filter_by(code="DBL").one()
        twin.summary = "Quiet twin room with a flexible layout for short city stays."
        twin.description = "Corner sofa for reading or extra luggage space."
        twin.bed_details = "Two single beds"
        twin.media_urls = ["https://cdn.example.test/twin-room.jpg"]
        twin.amenities = ["Rain shower", "Writing desk", "Blackout curtains"]
        twin.policy_callouts = ["No party groups after 22:00."]
        double.summary = None
        double.description = None
        double.bed_details = None
        double.media_urls = None
        double.amenities = None
        double.policy_callouts = None
        db.session.commit()

    availability = client.get(
        f"/book?lang=en&check_in={check_in.isoformat()}&check_out={check_out.isoformat()}&adults=2&children=0"
    )
    availability_body = availability.get_data(as_text=True)

    assert availability.status_code == 200
    assert "https://cdn.example.test/twin-room.jpg" in availability_body
    assert "Quiet twin room with a flexible layout for short city stays." in availability_body
    assert "Corner sofa for reading or extra luggage space." in availability_body
    assert "Rain shower" in availability_body
    assert "No party groups after 22:00." in availability_body
    assert "room-offer-placeholder" in availability_body

    hold_response = post_form(
        client,
        "/booking/hold",
        data={
            "room_type_id": str(twin.id),
            "check_in_date": str(check_in),
            "check_out_date": str(check_out),
            "adults": "2",
            "children": "0",
            "language": "en",
            "source_channel": "direct_web",
            "idempotency_key": "room-content-booking-summary",
            "email": "room-content@example.com",
        },
        follow_redirects=True,
    )
    hold_body = hold_response.get_data(as_text=True)

    assert hold_response.status_code == 200
    assert "https://cdn.example.test/twin-room.jpg" in hold_body
    assert "Quiet twin room with a flexible layout for short city stays." in hold_body
    assert "Rain shower" in hold_body
    assert "No party groups after 22:00." in hold_body


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


def test_public_booking_can_add_extras_and_post_them_to_folio(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        breakfast = create_public_extra(
            code="BFST",
            name="Daily breakfast",
            pricing_mode="per_night",
            unit_price="350.00",
        )
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id, idempotency_key="extras-booking"))
        reservation = confirm_public_booking(
            make_booking_payload(
                hold.hold_code,
                idempotency_key="extras-booking",
                extra_ids=(breakfast.id,),
            )
        )
        extra_line = FolioCharge.query.filter_by(reservation_id=reservation.id, charge_code="XTR").one()

        assert reservation.quoted_extras_total == Decimal("700.00")
        assert reservation.quoted_grand_total == Decimal(str(hold.quoted_grand_total)) + Decimal("700.00")
        assert len(reservation.extras) == 1
        assert reservation.extras[0].quantity == 2
        assert extra_line.description.startswith("Daily breakfast")


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
        initial_count = Reservation.query.count()
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id))
        first = confirm_public_booking(make_booking_payload(hold.hold_code))
        second = confirm_public_booking(make_booking_payload(hold.hold_code))
        assert first.id == second.id
        assert Reservation.query.count() == initial_count + 1


def test_duplicate_match_releases_redundant_hold_inventory(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        first_hold = create_reservation_hold(make_hold_payload(twin.id, idempotency_key="dup-release-1"))
        first = confirm_public_booking(make_booking_payload(first_hold.hold_code, idempotency_key="dup-release-1"))

        second_hold = create_reservation_hold(make_hold_payload(twin.id, idempotency_key="dup-release-2"))
        duplicate = confirm_public_booking(make_booking_payload(second_hold.hold_code, idempotency_key="dup-release-2"))
        refreshed_hold = db.session.get(ReservationHold, second_hold.id)

        assert duplicate.id == first.id
        assert refreshed_hold.status == "converted"
        assert refreshed_hold.converted_reservation_id == first.id
        assert InventoryDay.query.filter_by(hold_id=second_hold.id).count() == 0


def test_duplicate_detection_respects_selected_extras(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        initial_count = Reservation.query.count()
        breakfast = create_public_extra(
            code="BFST",
            name="Daily breakfast",
            pricing_mode="per_night",
            unit_price="350.00",
        )
        twin = RoomType.query.filter_by(code="TWN").first()
        first_hold = create_reservation_hold(make_hold_payload(twin.id, idempotency_key="dup-extra-1"))
        first = confirm_public_booking(make_booking_payload(first_hold.hold_code, idempotency_key="dup-extra-1"))

        second_hold = create_reservation_hold(make_hold_payload(twin.id, idempotency_key="dup-extra-2"))
        second = confirm_public_booking(
            make_booking_payload(
                second_hold.hold_code,
                idempotency_key="dup-extra-2",
                extra_ids=(breakfast.id,),
            )
        )

        assert first.id != second.id
        assert second.quoted_extras_total == Decimal("700.00")
        assert Reservation.query.count() == initial_count + 2


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
    response = client.get("/book?lang=zh-Hans")
    assert response.status_code == 200
    body = response.get_data(as_text=True)
    assert "查询可订房型" in body
    assert "实时房态" in body
    assert "入住日期" in body


def test_booking_form_renders_configured_public_extras(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        create_public_extra(
            code="TRNS",
            name="Airport transfer",
            pricing_mode="per_stay",
            unit_price="900.00",
        )
        twin = RoomType.query.filter_by(code="TWN").first()

    response = post_form(
        client,
        "/booking/hold",
        data={
            "check_in_date": (date.today() + timedelta(days=7)).isoformat(),
            "check_out_date": (date.today() + timedelta(days=9)).isoformat(),
            "adults": "2",
            "children": "0",
            "room_type_id": str(twin.id),
            "email": "guest@example.com",
            "idempotency_key": "extras-ui",
            "language": "en",
            "source_channel": "direct_web",
        },
    )

    body = response.get_data(as_text=True)
    assert response.status_code == 200
    assert "Airport transfer" in body
    assert "Enhance your stay" in body


@pytest.mark.parametrize(
    ("path", "expected_snippets"),
    [
        ("/?lang=zh-Hans", ["房型", "官网直订", "预订协助"]),
        ("/booking/cancel?lang=zh-Hans", ["客人自助服务", "取消申请", "提交申请"]),
        ("/booking/modify?lang=zh-Hans", ["客人自助服务", "修改申请", "提交申请"]),
    ],
)
def test_guest_self_service_pages_render_translated_copy(app_factory, path, expected_snippets):
    app = app_factory(seed=True)
    client = app.test_client()

    response = client.get(path)
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    for snippet in expected_snippets:
        assert snippet in body


def test_booking_source_tracking_is_persisted(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id, source_channel="facebook", source_metadata={"utm_source": "facebook"}))
        reservation = confirm_public_booking(make_booking_payload(hold.hold_code, source_channel="facebook", source_metadata={"utm_source": "facebook"}))
        assert reservation.source_channel == "facebook"
        assert reservation.source_metadata_json["utm_source"] == "facebook"


def test_book_route_prefills_clean_query_params_and_tracking(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    check_in = str(date.today() + timedelta(days=7))
    check_out = str(date.today() + timedelta(days=9))

    response = client.get(
        f"/book?lang=en&check_in={check_in}&check_out={check_out}&guests=2&room_type=TWN&utm_source=facebook&utm_campaign=spring-sale"
    )
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert f'name="check_in" value="{check_in}"' in body
    assert f'name="check_out" value="{check_out}"' in body
    assert 'name="adults" min="1" max="3" value="2"' in body
    assert 'name="children" min="0" max="2" value="0"' in body
    assert 'value="TWN" selected' in body
    assert 'name="utm_source" value="facebook"' in body
    assert 'name="utm_campaign" value="spring-sale"' in body
    assert 'name="source_channel" value="facebook"' in body


def test_book_route_rejects_unknown_room_type_query(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()

    response = client.get("/book?lang=en&room_type=NOT-A-ROOM")

    assert response.status_code == 400
    assert "Invalid room_type query parameter." in response.get_data(as_text=True)


def test_legacy_availability_redirects_to_book_preserving_query_string(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    check_in = str(date.today() + timedelta(days=7))
    check_out = str(date.today() + timedelta(days=9))

    response = client.get(
        f"/availability?lang=en&check_in={check_in}&check_out={check_out}&room_type=TWN&utm_source=facebook",
        follow_redirects=False,
    )

    assert response.status_code == 308
    assert response.headers["Location"].startswith("/book?")
    assert f"check_in={check_in}" in response.headers["Location"]
    assert f"check_out={check_out}" in response.headers["Location"]
    assert "room_type=TWN" in response.headers["Location"]
    assert "utm_source=facebook" in response.headers["Location"]


def test_marketing_attribution_survives_public_route_flow(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()

    landing = client.get(
        "/?lang=en&utm_source=google&utm_medium=cpc&utm_campaign=spring_sale&utm_content=hero_banner&source_label=google_ads",
        headers={"Referer": "https://partner.example/deals?token=secret"},
    )
    assert landing.status_code == 200

    availability = client.get(
        f"/book?lang=en&check_in={date.today() + timedelta(days=7)}&check_out={date.today() + timedelta(days=9)}&adults=2&children=0&cta_source=home_search"
    )
    assert availability.status_code == 200

    hold_response = post_form(
        client,
        "/booking/hold",
        data={
            "room_type_id": str(twin.id),
            "check_in_date": str(date.today() + timedelta(days=7)),
            "check_out_date": str(date.today() + timedelta(days=9)),
            "adults": "2",
            "children": "0",
            "language": "en",
            "idempotency_key": "route-attribution-hold",
            "email": "attrib@example.com",
            "cta_source": "availability_room_card",
        },
        follow_redirects=True,
    )
    assert hold_response.status_code == 200

    with app.app_context():
        hold = ReservationHold.query.filter_by(idempotency_key="route-attribution-hold").one()
        hold_id = hold.id
        assert hold.source_channel == "referral"
        assert hold.source_metadata_json["utm_source"] == "google"
        assert hold.source_metadata_json["utm_medium"] == "cpc"
        assert hold.source_metadata_json["utm_campaign"] == "spring_sale"
        assert hold.source_metadata_json["utm_content"] == "hero_banner"
        assert hold.source_metadata_json["source_label"] == "google_ads"
        assert hold.source_metadata_json["entry_page"] == "/"
        assert hold.source_metadata_json["entry_cta_source"] == "home_search"
        assert hold.source_metadata_json["referrer_host"] == "partner.example"
        assert "referrer" not in hold.source_metadata_json

    confirm_response = post_form(
        client,
        "/booking/confirm",
        data={
            "hold_code": hold.hold_code,
            "idempotency_key": "route-attribution-hold",
            "first_name": "Attrib",
            "last_name": "Guest",
            "phone": "+66800000123",
            "email": "attrib@example.com",
            "language": "en",
            "accept_terms": "on",
        },
        follow_redirects=False,
    )
    assert confirm_response.status_code == 302

    with app.app_context():
        hold = db.session.get(ReservationHold, hold_id)
        reservation = db.session.get(Reservation, hold.converted_reservation_id)
        assert reservation is not None
        assert reservation.source_channel == "referral"
        assert reservation.source_metadata_json["utm_source"] == "google"
        assert reservation.source_metadata_json["utm_medium"] == "cpc"
        assert reservation.source_metadata_json["utm_campaign"] == "spring_sale"
        assert reservation.source_metadata_json["utm_content"] == "hero_banner"
        assert reservation.source_metadata_json["source_label"] == "google_ads"
        assert reservation.source_metadata_json["entry_page"] == "/"
        assert reservation.source_metadata_json["entry_cta_source"] == "home_search"
        assert reservation.source_metadata_json["referrer_host"] == "partner.example"


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


def test_public_confirmation_is_not_cacheable_or_indexable(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id))
        reservation = confirm_public_booking(make_booking_payload(hold.hold_code))

    response = client.get(
        f"/booking/confirmation/{reservation.reservation_code}?token={reservation.public_confirmation_token}"
    )

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store, private, max-age=0"
    assert response.headers["X-Robots-Tag"] == "noindex, nofollow, noarchive"


def test_confirmation_page_uses_reservation_language_without_query_string(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id, language="zh-Hans"))
        reservation = confirm_public_booking(make_booking_payload(hold.hold_code, language="zh-Hans"))

    response = client.get(
        f"/booking/confirmation/{reservation.reservation_code}?token={reservation.public_confirmation_token}"
    )

    assert response.status_code == 200
    body = response.get_data(as_text=True)
    assert '<html lang="zh-Hans">' in body
    assert "客人" in body
    assert "申请修改" in body


def test_public_booking_form_renders_translated_labels(app_factory):
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
            "language": "zh-Hans",
            "source_channel": "direct_web",
            "idempotency_key": "route-hold-zh-form",
            "email": "route-zh@example.com",
        },
        follow_redirects=True,
    )
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert "最后一步" in body
    assert "手机号码" in body
    assert "预订条款" in body


def test_public_payment_return_renders_translated_labels(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    client = app.test_client()
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(
            make_hold_payload(
                twin.id,
                language="zh-Hans",
                idempotency_key="zh-payment-hold",
                guest_email="zh-payment@example.com",
            )
        )
        reservation = confirm_public_booking(
            make_booking_payload(
                hold.hold_code,
                idempotency_key="zh-payment-hold",
                language="zh-Hans",
                email="zh-payment@example.com",
            )
        )
        request_row = create_or_reuse_deposit_request(
            reservation.id,
            actor_user_id=None,
            send_email=False,
            language="zh-Hans",
            source="test",
        )

    response = client.get(
        f"/payments/return/{request_row.request_code}?reservation_code={reservation.reservation_code}&token={reservation.public_confirmation_token}"
    )
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert '<html lang="zh-Hans">' in body
    assert "付款状态" in body
    assert "押金" in body


def test_public_pages_use_token_free_og_url(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()

    response = client.get("/book?lang=en&utm_source=google_business")
    body = response.get_data(as_text=True)
    og_url_match = re.search(r'<meta property="og:url" content="([^"]+)">', body)
    canonical_match = re.search(r'<link rel="canonical" href="([^"]+)">', body)

    assert response.status_code == 200
    assert og_url_match is not None
    assert og_url_match.group(1).endswith("/book?lang=en")
    assert "utm_source" not in og_url_match.group(1)
    assert canonical_match is not None
    assert canonical_match.group(1).endswith("/book?lang=en")
    assert "utm_source" not in canonical_match.group(1)


@pytest.mark.parametrize("path", ["/booking/cancel?lang=en", "/booking/modify?lang=en"])
def test_sensitive_guest_pages_suppress_social_metadata(app_factory, path):
    app = app_factory(seed=True)
    client = app.test_client()

    response = client.get(path)
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert 'property="og:type"' not in body
    assert 'property="og:title"' not in body
    assert 'property="og:url"' not in body
    assert 'name="twitter:card"' not in body
    assert 'application/ld+json' not in body


def test_public_pages_render_seo_metadata_contact_links_and_json_ld(app_factory):
    app = app_factory(seed=True, config={"APP_BASE_URL": "https://hotel.example"})
    client = app.test_client()

    response = client.get("/?lang=en")
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert 'name="twitter:card"' in body
    assert 'application/ld+json' in body
    assert 'rel="icon"' in body
    assert "favicon.svg" in body
    assert 'hreflang="en"' in body
    assert 'hreflang="th"' in body
    assert 'hreflang="x-default"' in body
    assert ("tel:" in body) or ("mailto:" in body)
    assert "mailto:" in body
    assert 'property="og:image"' in body
    assert 'property="og:image" content="http' in body


def test_public_pages_render_analytics_and_consent_hooks(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()

    response = client.get("/?lang=en")
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert "public-site.js" in body
    assert 'data-consent-banner' in body
    assert 'data-consent-action="grant"' in body
    assert 'data-consent-action="deny"' in body
    assert 'data-consent-open' in body
    assert 'data-analytics-event="booking_request_submit"' in body
    assert 'data-analytics-event="cta_click"' in body


def test_public_site_script_exposes_expected_event_taxonomy(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()

    response = client.get("/static/public-site.js")
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert "dataLayer" in body
    assert "cta_click" in body
    assert "booking_request_submit" in body
    assert "contact_click" in body
    assert "gallery_interaction" in body
    assert "consent_update" in body


def test_robots_route_includes_dynamic_sitemap_url(app_factory):
    app = app_factory(seed=True, config={"APP_BASE_URL": "https://hotel.example"})
    client = app.test_client()

    response = client.get("/robots.txt")
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert response.mimetype == "text/plain"
    assert "Disallow: /staff/" in body
    assert "Sitemap: https://hotel.example/sitemap.xml" in body


def test_sitemap_route_lists_public_guest_pages(app_factory):
    app = app_factory(seed=True, config={"APP_BASE_URL": "https://hotel.example"})
    client = app.test_client()

    response = client.get("/sitemap.xml")
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert response.mimetype == "application/xml"
    assert "<urlset" in body
    assert "https://hotel.example/" in body
    assert "https://hotel.example/book?lang=en" in body
    assert "https://hotel.example/booking/cancel?lang=th" in body
    assert "https://hotel.example/booking/modify?lang=zh-Hans" in body


def test_homepage_does_not_render_guest_booking_data(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id))
        reservation = confirm_public_booking(make_booking_payload(hold.hold_code))
        guest_name = reservation.primary_guest.full_name

    response = client.get("/?lang=en")
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert reservation.reservation_code not in body
    assert guest_name not in body


def test_cancel_request_shows_error_when_booking_cannot_be_verified(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()

    response = post_form(
        client,
        "/booking/cancel?lang=en",
        data={
            "booking_reference": "SBX-40440404",
            "contact_value": "missing@example.com",
            "reason": "Changed plans",
        },
    )

    assert response.status_code == 200
    assert "We could not find a booking matching those details." in response.get_data(as_text=True)
    with app.app_context():
        assert CancellationRequest.query.count() == 0


def test_booking_confirm_uses_published_terms_version(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(make_hold_payload(twin.id, idempotency_key="route-hold-terms"))

    response = post_form(
        client,
        "/booking/confirm",
        data={
            "hold_code": hold.hold_code,
            "idempotency_key": "route-hold-terms",
            "first_name": "Route",
            "last_name": "Guest",
            "phone": "+66800000010",
            "email": "route-terms@example.com",
            "language": "en",
            "source_channel": "direct_web",
            "accept_terms": "on",
            "terms_version": "tampered-version",
        },
    )

    assert response.status_code == 302
    with app.app_context():
        reservation = Reservation.query.filter_by(reservation_code=response.headers["Location"].split("/booking/confirmation/", 1)[1].split("?", 1)[0]).one()
        assert reservation.terms_version == "2026-03"


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
