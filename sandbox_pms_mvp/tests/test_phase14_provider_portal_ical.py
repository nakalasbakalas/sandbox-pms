from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

from werkzeug.security import generate_password_hash

from pms.extensions import db
from pms.models import ActivityLog, ExternalCalendarBlock, PaymentRequest, Reservation, Role, Room, RoomType, User
from pms.services.ical_service import (
    create_calendar_feed,
    create_external_calendar_source,
    parse_ical_events,
    provider_calendar_context,
    stage_ical_import,
    sync_external_calendar_source,
)
from pms.services.payment_integration_service import process_payment_webhook, sign_test_hosted_webhook
from pms.services.public_booking_service import get_live_available_rooms
from pms.services.reservation_service import ReservationCreatePayload, create_reservation


def make_user(role_code: str, email: str) -> User:
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


def create_portal_reservation(*, room_id=None, source_channel: str = "direct_web") -> Reservation:
    room_type = RoomType.query.filter_by(code="DBL").one()
    reservation = create_reservation(
        ReservationCreatePayload(
            first_name="Portal",
            last_name="Guest",
            phone="+66811112222",
            email="portal.guest@example.com",
            room_type_id=room_type.id,
            assigned_room_id=room_id,
            check_in_date=date.today() + timedelta(days=4),
            check_out_date=date.today() + timedelta(days=6),
            adults=2,
            children=0,
            source_channel=source_channel,
        )
    )
    reservation.created_from_public_booking_flow = True
    reservation.booking_language = "en"
    reservation.public_confirmation_token = "provider-token-123"
    db.session.commit()
    return reservation


def write_ical_file(tmp_path: Path, uid: str, start_date: date, end_date: date, *, summary: str = "External block") -> str:
    path = tmp_path / f"{uid}.ics"
    path.write_text(
        "\n".join(
            [
                "BEGIN:VCALENDAR",
                "VERSION:2.0",
                "PRODID:-//Sandbox Hotel//Calendar Test//EN",
                "BEGIN:VEVENT",
                f"UID:{uid}",
                f"DTSTART;VALUE=DATE:{start_date.strftime('%Y%m%d')}",
                f"DTEND;VALUE=DATE:{end_date.strftime('%Y%m%d')}",
                f"SUMMARY:{summary}",
                "END:VEVENT",
                "END:VCALENDAR",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return path.as_uri()


def test_provider_dashboard_pages_load_and_rbac_is_enforced(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    client = app.test_client()
    with app.app_context():
        provider_user = make_user("provider", "provider@example.com")
        housekeeping_user = make_user("housekeeping", "hk@example.com")
        reservation = create_portal_reservation()
        reservation_id = reservation.id

    login_as(client, provider_user)
    assert client.get("/provider").status_code == 200
    assert client.get("/provider/bookings").status_code == 200
    assert client.get(f"/provider/bookings/{reservation_id}").status_code == 200
    assert client.get("/provider/calendar").status_code == 200

    login_as(client, housekeeping_user)
    assert client.get("/provider").status_code == 403
    assert client.get("/provider/calendar").status_code == 403


def test_provider_deposit_flow_runs_end_to_end_through_real_code_path(app_factory):
    app = app_factory(
        seed=True,
        config={
            "PAYMENT_PROVIDER": "test_hosted",
            "PAYMENT_BASE_URL": "https://hosted.test",
            "TEST_HOSTED_PAYMENT_SECRET": "phase14-secret",
            "PAYMENT_LINK_RESEND_COOLDOWN_SECONDS": 0,
        },
    )
    client = app.test_client()
    with app.app_context():
        provider_user = make_user("provider", "provider-payments@example.com")
        reservation = create_portal_reservation()
        reservation_id = reservation.id
        reservation_code = reservation.reservation_code
        confirmation_token = reservation.public_confirmation_token

    login_as(client, provider_user)
    response = post_form(
        client,
        f"/provider/bookings/{reservation_id}/payment-requests",
        data={"back_url": "/provider/bookings"},
    )
    assert response.status_code == 302

    with app.app_context():
        payment_request = (
            PaymentRequest.query.filter_by(reservation_id=reservation_id)
            .order_by(PaymentRequest.created_at.desc())
            .first()
        )
        assert payment_request is not None
        assert payment_request.payment_url
        payment_request_id = payment_request.id

    start_response = client.get(
        f"/payments/request/{payment_request.request_code}?reservation_code={reservation_code}&token={confirmation_token}"
    )
    assert start_response.status_code == 302
    assert start_response.headers["Location"].startswith("https://hosted.test/hosted-checkout/")

    with app.app_context():
        payload = json.dumps(
            {
                "event_id": "evt-provider-paid-1",
                "payment_request_code": payment_request.request_code,
                "payment_request_id": str(payment_request.id),
                "status": "paid",
                "provider_reference": payment_request.provider_reference,
                "provider_payment_reference": "pi_provider_paid_1",
                "amount": str(payment_request.amount),
                "currency_code": "THB",
            }
        ).encode("utf-8")
        headers = {"X-Test-Hosted-Signature": sign_test_hosted_webhook(payload)}
        first = process_payment_webhook("test_hosted", payload, headers)
        second = process_payment_webhook("test_hosted", payload, headers)
        db.session.expire_all()
        payment_request = db.session.get(PaymentRequest, payment_request_id)
        reservation = db.session.get(Reservation, reservation_id)

        assert first["processed"] == 1
        assert second["duplicates"] == 1
        assert payment_request.status == "paid"
        assert reservation.deposit_received_amount == payment_request.amount
        assert ActivityLog.query.filter_by(event_type="payment.status_paid", entity_id=str(reservation.id)).count() == 1

    detail_response = client.get(f"/provider/bookings/{reservation_id}")
    assert detail_response.status_code == 200
    assert b"pi_provider_paid_1" in detail_response.data
    assert b"Deposit received" in detail_response.data


def test_ical_export_feed_is_valid_and_does_not_expose_guest_identity(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_portal_reservation()
        guest_name = reservation.primary_guest.full_name
        reservation_code = reservation.reservation_code
        feed_token = create_calendar_feed(scope_type="property", actor_user_id=None)

    response = client.get(f"/calendar/feed/{feed_token.token}.ics")
    assert response.status_code == 200
    body = response.data.decode("utf-8")
    assert "BEGIN:VCALENDAR" in body
    assert "BEGIN:VEVENT" in body
    assert "Reserved" in body
    assert guest_name not in body
    assert reservation_code not in body


def test_external_ical_sync_is_idempotent_and_conflicts_are_flagged(app_factory, tmp_path):
    app = app_factory(seed=True)
    with app.app_context():
        room = Room.query.filter_by(room_number="301").one()
        reservation = create_portal_reservation(room_id=room.id)
        feed_url = write_ical_file(
            tmp_path,
            "provider-conflict-1",
            reservation.check_in_date,
            reservation.check_out_date,
            summary="OTA external booking",
        )
        source = create_external_calendar_source(
            room_id=room.id,
            name="OTA room 301",
            feed_url=feed_url,
            actor_user_id=None,
        )

        first = sync_external_calendar_source(source.id, actor_user_id=None)
        second = sync_external_calendar_source(source.id, actor_user_id=None)
        blocks = ExternalCalendarBlock.query.filter_by(source_id=source.id).all()
        calendar = provider_calendar_context()

        assert first["run"].status == "conflict"
        assert second["run"].status == "conflict"
        assert len(blocks) == 1
        assert blocks[0].is_conflict is True
        assert blocks[0].conflict_reservation_id == reservation.id
        assert calendar["recent_conflicts"]


def test_external_ical_blocks_affect_live_availability_without_duplicate_blocks(app_factory, tmp_path):
    app = app_factory(seed=True)
    with app.app_context():
        room = Room.query.filter_by(room_number="201").one()
        room_type = db.session.get(RoomType, room.room_type_id)
        start_date = date.today() + timedelta(days=10)
        end_date = start_date + timedelta(days=2)
        feed_url = write_ical_file(tmp_path, "provider-open-block-1", start_date, end_date, summary="Airbnb hold")
        source = create_external_calendar_source(
            room_id=room.id,
            name="Airbnb room 201",
            feed_url=feed_url,
            actor_user_id=None,
        )

        sync_external_calendar_source(source.id, actor_user_id=None)
        sync_external_calendar_source(source.id, actor_user_id=None)
        available = get_live_available_rooms(
            room_type_id=room_type.id,
            check_in_date=start_date,
            check_out_date=end_date,
        )

        assert ExternalCalendarBlock.query.filter_by(source_id=source.id).count() == 1
        assert all(item.id != room.id for item in available)


def test_ical_metadata_parsing_and_staging_report_preserve_x_properties_and_validation_details(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        metadata_payload = "\n".join(
            [
                "BEGIN:VCALENDAR",
                "VERSION:2.0",
                "PRODID:-//Sandbox Hotel//Calendar Metadata Test//EN",
                "BEGIN:VEVENT",
                "UID:metadata-event-1",
                "DTSTAMP:20260312T000000Z",
                "LAST-MODIFIED:20260312T010000Z",
                "DTSTART;VALUE=DATE:20260320",
                "DTEND;VALUE=DATE:20260322",
                "SUMMARY:OTA reservation",
                "DESCRIPTION:Imported from OTA feed",
                "LOCATION:Room 201",
                "CATEGORIES:reservation,ota",
                "SEQUENCE:7",
                "X-ROOM-ID:room-201",
                "X-BLOCK-TYPE:reservation",
                "END:VEVENT",
                "END:VCALENDAR",
                "",
            ]
        ).encode("utf-8")
        parsed_events = parse_ical_events(metadata_payload)

        assert len(parsed_events) == 1
        assert parsed_events[0]["metadata_json"]["categories"] == ["reservation", "ota"]
        assert parsed_events[0]["metadata_json"]["sequence"] == 7
        assert parsed_events[0]["metadata_json"]["x_properties"]["X-ROOM-ID"] == "room-201"
        assert parsed_events[0]["metadata_json"]["x_properties"]["X-BLOCK-TYPE"] == "reservation"
        assert parsed_events[0]["metadata_json"]["last_modified"] is not None
        assert parsed_events[0]["metadata_json"]["dtstamp"] is not None

        staging_payload = "\n".join(
            [
                "BEGIN:VCALENDAR",
                "VERSION:2.0",
                "PRODID:-//Sandbox Hotel//Calendar Stage Test//EN",
                "BEGIN:VEVENT",
                "UID:known-duplicate",
                "DTSTART;TZID=UTC:20260320T120000",
                "DTEND;TZID=UTC:20260321T120000",
                "SUMMARY:Known duplicate",
                "END:VEVENT",
                "BEGIN:VEVENT",
                "DTSTART;VALUE=DATE:20260325",
                "DTEND;VALUE=DATE:20260327",
                "SUMMARY:Missing UID event",
                "END:VEVENT",
                "BEGIN:VEVENT",
                "UID:bad-dates",
                "DTSTART;VALUE=DATE:20260328",
                "DTEND;VALUE=DATE:20260328",
                "SUMMARY:Invalid dates",
                "END:VEVENT",
                "END:VCALENDAR",
                "",
            ]
        ).encode("utf-8")
        report = stage_ical_import(staging_payload, known_uids={"known-duplicate"})

        assert report["summary"]["parsed_count"] == 3
        assert report["summary"]["accepted_count"] == 1
        assert report["summary"]["rejected_count"] == 2
        assert report["summary"]["duplicate_uid_count"] == 1
        assert report["duplicate_uid_issues"] == [{"uid": "known-duplicate", "scope": "existing"}]
        assert report["timezone_issues"][0]["uid"] == "known-duplicate"
        assert report["missing_fields"][0]["fields"] == ["UID"]
        assert report["invalid_dates"] == [{"uid": "bad-dates", "summary": "Invalid dates"}]

        invalid_report = stage_ical_import(b"not a calendar payload")
        assert invalid_report["summary"]["parsed_count"] == 0
        assert invalid_report["summary"]["rejected_count"] == 1
        assert "Invalid iCalendar payload" in invalid_report["rejected_events"][0]["reason"]
