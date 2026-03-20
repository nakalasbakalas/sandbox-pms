from __future__ import annotations

import os
import threading
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
import sqlalchemy as sa
from flask_migrate import upgrade
from werkzeug.security import generate_password_hash

import pms.app as pms_app
import pms.routes.front_desk as front_desk_routes
import pms.services.front_desk_service as front_desk_service
from pms.app import create_app
from pms.extensions import db
from pms.models import (
    ActivityLog,
    BookingExtra,
    HousekeepingStatus,
    InventoryDay,
    PaymentRequest,
    Reservation,
    ReservationStatusHistory,
    Role,
    Room,
    RoomType,
    User,
)
from pms.seeds import seed_all
from pms.services.extras_service import attach_extras_quote_to_reservation, post_reservation_extras_to_folio, quote_booking_extras
from pms.services.front_desk_service import (
    CheckInPayload,
    CheckoutPayload,
    FrontDeskFilters,
    NoShowPayload,
    WalkInCheckInPayload,
    complete_check_in,
    complete_checkout,
    create_walk_in_and_check_in,
    evaluate_early_check_in,
    evaluate_late_check_out,
    list_front_desk_arrivals,
    list_front_desk_departures,
    list_front_desk_in_house,
    prepare_checkout,
    process_no_show,
)
from pms.services.reservation_service import ReservationCreatePayload, create_reservation
from pms.services.staff_reservations_service import assign_room


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = PROJECT_ROOT / "migrations"
HOTEL_TZ = ZoneInfo("Asia/Bangkok")


def utc_dt(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour=hour, minute=minute), tzinfo=timezone.utc)


def hotel_dt(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour=hour, minute=minute), tzinfo=HOTEL_TZ)


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


def create_staff_reservation(
    *,
    first_name: str,
    last_name: str,
    phone: str,
    room_type_code: str,
    check_in_date: date,
    check_out_date: date,
    source_channel: str = "admin_manual",
) -> Reservation:
    room_type = RoomType.query.filter_by(code=room_type_code).one()
    return create_reservation(
        ReservationCreatePayload(
            first_name=first_name,
            last_name=last_name,
            phone=phone,
            email=f"{first_name.lower()}@example.com",
            room_type_id=room_type.id,
            check_in_date=check_in_date,
            check_out_date=check_out_date,
            adults=2,
            children=0,
            source_channel=source_channel,
        )
    )


def create_booking_extra(*, code: str, name: str, pricing_mode: str, unit_price: str) -> BookingExtra:
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


def mark_checked_in(reservation: Reservation) -> None:
    reservation.current_status = "checked_in"
    reservation.checked_in_at = utc_dt(reservation.check_in_date, 14)
    rows = InventoryDay.query.filter_by(reservation_id=reservation.id).all()
    occupied_clean = HousekeepingStatus.query.filter_by(code="occupied_clean").one()
    for row in rows:
        row.availability_status = "occupied"
        row.housekeeping_status_id = occupied_clean.id
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


def test_arrivals_departures_and_in_house_lists_return_expected_rows(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=3)
        arrival = create_staff_reservation(
            first_name="Arrive",
            last_name="Today",
            phone="+66800000101",
            room_type_code="TWN",
            check_in_date=business_date,
            check_out_date=business_date + timedelta(days=1),
        )
        departure = create_staff_reservation(
            first_name="Leave",
            last_name="Today",
            phone="+66800000102",
            room_type_code="DBL",
            check_in_date=business_date - timedelta(days=1),
            check_out_date=business_date,
        )
        in_house = create_staff_reservation(
            first_name="Inside",
            last_name="Guest",
            phone="+66800000103",
            room_type_code="TWN",
            check_in_date=business_date - timedelta(days=1),
            check_out_date=business_date + timedelta(days=1),
        )
        mark_checked_in(departure)
        mark_checked_in(in_house)

        filters = FrontDeskFilters(business_date=business_date, mode="arrivals")
        arrival_codes = {item["reservation_code"] for item in list_front_desk_arrivals(business_date, filters=filters)}
        departure_codes = {item["reservation_code"] for item in list_front_desk_departures(business_date, filters=FrontDeskFilters(business_date=business_date, mode="departures"))}
        in_house_codes = {item["reservation_code"] for item in list_front_desk_in_house(business_date, filters=FrontDeskFilters(business_date=business_date, mode="in_house"))}

        assert arrival.reservation_code in arrival_codes
        assert departure.reservation_code in departure_codes
        assert in_house.reservation_code in in_house_codes


def test_check_in_fails_when_room_is_not_ready(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        reservation = create_staff_reservation(
            first_name="Dirty",
            last_name="Room",
            phone="+66800000104",
            room_type_code="TWN",
            check_in_date=business_date,
            check_out_date=business_date + timedelta(days=1),
        )
        actor = make_staff_user("front_desk", "fd1@example.com")
        dirty = HousekeepingStatus.query.filter_by(code="dirty").one()
        arrival_row = InventoryDay.query.filter_by(room_id=reservation.assigned_room_id, business_date=business_date).one()
        arrival_row.housekeeping_status_id = dirty.id
        db.session.commit()

        with pytest.raises(ValueError, match="dirty"):
            complete_check_in(
                reservation.id,
                CheckInPayload(
                    room_id=reservation.assigned_room_id,
                    first_name="Dirty",
                    last_name="Room",
                    phone="+66800000104",
                    email="dirty@example.com",
                    identity_verified=True,
                    action_at=utc_dt(business_date, 15),
                ),
                actor_user_id=actor.id,
            )


def test_check_in_succeeds_and_updates_reservation_inventory_and_identity(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        reservation = create_staff_reservation(
            first_name="Ready",
            last_name="Guest",
            phone="+66800000105",
            room_type_code="TWN",
            check_in_date=business_date,
            check_out_date=business_date + timedelta(days=2),
        )
        actor = make_staff_user("front_desk", "fd2@example.com")

        checked_in = complete_check_in(
            reservation.id,
            CheckInPayload(
                room_id=reservation.assigned_room_id,
                first_name="Ready",
                last_name="Guest",
                phone="+66800000199",
                email="ready@example.com",
                    nationality="TH",
                    id_document_type="passport",
                    id_document_number="A1234567",
                    identity_verified=True,
                    collect_payment_amount=Decimal(str(reservation.deposit_required_amount)),
                    arrival_note="Guest checked in at front desk",
                    action_at=utc_dt(business_date, 15),
                ),
                actor_user_id=actor.id,
            )

        assert checked_in.current_status == "checked_in"
        assert checked_in.identity_verified_at is not None
        assert checked_in.primary_guest.phone == "+66800000199"
        rows = InventoryDay.query.filter_by(reservation_id=reservation.id).all()
        assert rows
        assert all(row.availability_status == "occupied" for row in rows)
        assert ActivityLog.query.filter_by(event_type="front_desk.checked_in").count() == 1


def test_check_in_requires_identity_verification_outside_testing(app_factory, monkeypatch):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        reservation = create_staff_reservation(
            first_name="Verify",
            last_name="Required",
            phone="+66800000195",
            room_type_code="TWN",
            check_in_date=business_date,
            check_out_date=business_date + timedelta(days=1),
        )
        actor = make_staff_user("front_desk", "fd-identity-required@example.com")
        monkeypatch.setattr(front_desk_service, "current_app_testing", lambda: False)

        with pytest.raises(ValueError, match="Identity verification must be completed before check-in."):
            complete_check_in(
                reservation.id,
                CheckInPayload(
                    room_id=reservation.assigned_room_id,
                    first_name="Verify",
                    last_name="Required",
                    phone="+66800000195",
                    email="verify-required@example.com",
                    action_at=utc_dt(business_date, 15),
                ),
                actor_user_id=actor.id,
            )

        refreshed = db.session.get(Reservation, reservation.id)
        assert refreshed.current_status == reservation.current_status
        assert refreshed.current_status != "checked_in"
        assert refreshed.checked_in_at is None
        assert refreshed.identity_verified_at is None


def test_check_in_accepts_existing_verified_identity_outside_testing(app_factory, monkeypatch):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        reservation = create_staff_reservation(
            first_name="Pre",
            last_name="Verified",
            phone="+66800000196",
            room_type_code="TWN",
            check_in_date=business_date,
            check_out_date=business_date + timedelta(days=1),
        )
        actor = make_staff_user("front_desk", "fd-identity-existing@example.com")
        verified_at = utc_dt(business_date, 11)
        reservation.identity_verified_at = verified_at
        reservation.identity_verified_by_user_id = actor.id
        db.session.commit()
        monkeypatch.setattr(front_desk_service, "current_app_testing", lambda: False)

        checked_in = complete_check_in(
            reservation.id,
            CheckInPayload(
                room_id=reservation.assigned_room_id,
                first_name="Pre",
                last_name="Verified",
                phone="+66800000196",
                email="preverified@example.com",
                collect_payment_amount=Decimal(str(reservation.deposit_required_amount)),
                action_at=utc_dt(business_date, 15),
            ),
            actor_user_id=actor.id,
        )

        assert checked_in.current_status == "checked_in"
        assert checked_in.identity_verified_at == verified_at


def test_unauthorized_role_cannot_complete_check_in_or_checkout(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        arrival_date = date.today()
        departure_date = date.today() + timedelta(days=2)
        arrival = create_staff_reservation(
            first_name="Blocked",
            last_name="Arrival",
            phone="+66800000106",
            room_type_code="TWN",
            check_in_date=arrival_date,
            check_out_date=arrival_date + timedelta(days=1),
        )
        stay = create_staff_reservation(
            first_name="Blocked",
            last_name="Departure",
            phone="+66800000107",
            room_type_code="DBL",
            check_in_date=departure_date - timedelta(days=1),
            check_out_date=departure_date,
        )
        mark_checked_in(stay)
        user = make_staff_user("housekeeping", "hk-frontdesk@example.com")
    login_as(client, user)

    check_in_response = post_form(
        client,
        f"/staff/front-desk/{arrival.id}/check-in",
        data={
            "room_id": str(arrival.assigned_room_id),
            "first_name": "Blocked",
            "last_name": "Arrival",
            "phone": "+66800000106",
            "email": "blocked@example.com",
            "back_url": "/staff/front-desk",
            "business_date": arrival_date.isoformat(),
        },
    )
    check_out_response = post_form(
        client,
        f"/staff/front-desk/{stay.id}/check-out",
        data={
            "back_url": "/staff/front-desk",
            "business_date": departure_date.isoformat(),
        },
    )

    assert check_in_response.status_code == 403
    assert check_out_response.status_code == 403


def test_early_and_late_fee_evaluation_use_operating_rules(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        reservation = create_staff_reservation(
            first_name="Fee",
            last_name="Guest",
            phone="+66800000108",
            room_type_code="DBL",
            check_in_date=business_date,
            check_out_date=business_date + timedelta(days=1),
        )
        early = evaluate_early_check_in(reservation, hotel_dt(reservation.check_in_date, 10))
        late = evaluate_late_check_out(reservation, hotel_dt(reservation.check_out_date, 12))

        assert early["applies"] is True
        assert late["applies"] is True
        assert early["amount"] == Decimal("100.00")
        assert late["amount"] == Decimal("100.00")


def test_fee_cutoffs_respect_hotel_timezone(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        reservation = create_staff_reservation(
            first_name="Timezone",
            last_name="Guest",
            phone="+66800000109",
            room_type_code="DBL",
            check_in_date=business_date,
            check_out_date=business_date + timedelta(days=1),
        )
        early = evaluate_early_check_in(
            reservation,
            hotel_dt(reservation.check_in_date, 15),
        )
        late = evaluate_late_check_out(
            reservation,
            hotel_dt(reservation.check_out_date, 12),
        )

        assert early["cutoff"].tzinfo == HOTEL_TZ
        assert early["applies"] is False
        assert late["applies"] is True


def test_walk_in_create_and_check_in_uses_authoritative_service_path(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        actor = make_staff_user("front_desk", "fd3@example.com")
        twin = RoomType.query.filter_by(code="TWN").one()
        reservation = create_walk_in_and_check_in(
            WalkInCheckInPayload(
                first_name="Walk",
                last_name="In",
                phone="+66800000109",
                email="walkin@example.com",
                room_type_id=twin.id,
                check_in_date=date.today(),
                check_out_date=date.today() + timedelta(days=1),
                adults=2,
                children=0,
                identity_verified=True,
                collect_payment_amount=Decimal("300.00"),
                action_at=utc_dt(date.today(), 15),
            ),
            actor_user_id=actor.id,
        )

        assert reservation.current_status == "checked_in"
        assert reservation.source_channel == "walk_in"
        assert reservation.public_confirmation_token is None
        assert PaymentRequest.query.filter_by(reservation_id=reservation.id, status="paid").count() == 1
        assert InventoryDay.query.filter_by(reservation_id=reservation.id, availability_status="occupied").count() == 1


def test_walk_in_route_requires_identity_verification_outside_testing(app_factory, monkeypatch):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        user = make_staff_user("front_desk", "fd-walkin-identity@example.com")
        twin = RoomType.query.filter_by(code="TWN").one()
        walk_in_count_before = Reservation.query.filter_by(source_channel="walk_in").count()
    monkeypatch.setattr(front_desk_service, "current_app_testing", lambda: False)
    login_as(client, user)

    response = post_form(
        client,
        "/staff/front-desk/walk-in",
        data={
            "first_name": "Walk",
            "last_name": "Blocked",
            "phone": "+66800000197",
            "email": "walk-blocked@example.com",
            "room_type_id": str(twin.id),
            "check_in_date": date.today().isoformat(),
            "check_out_date": (date.today() + timedelta(days=1)).isoformat(),
            "adults": "2",
            "children": "0",
            "extra_guests": "0",
            "collect_payment_amount": "0.00",
            "payment_method": "front_desk",
            "back_mode": "arrivals",
            "back_date": date.today().isoformat(),
        },
        follow_redirects=True,
    )
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert "Identity verification must be completed before check-in." in body
    with app.app_context():
        assert Reservation.query.filter_by(source_channel="walk_in").count() == walk_in_count_before


def test_checked_in_room_move_cannot_double_book_target_room(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        start = date.today() + timedelta(days=2)
        first = create_staff_reservation(
            first_name="Move",
            last_name="One",
            phone="+66800000110",
            room_type_code="TWN",
            check_in_date=start,
            check_out_date=start + timedelta(days=2),
        )
        second = create_staff_reservation(
            first_name="Move",
            last_name="Two",
            phone="+66800000111",
            room_type_code="TWN",
            check_in_date=start,
            check_out_date=start + timedelta(days=2),
        )
        mark_checked_in(first)
        mark_checked_in(second)
        actor = make_staff_user("front_desk", "fd4@example.com")

        with pytest.raises(ValueError, match="not available"):
            assign_room(first.id, second.assigned_room_id, actor_user_id=actor.id, reason="guest_move")


def test_checkout_prep_and_checkout_handoff_update_state_correctly(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        check_in_date = date.today() + timedelta(days=1)
        check_out_date = date.today() + timedelta(days=2)
        reservation = create_staff_reservation(
            first_name="Checkout",
            last_name="Guest",
            phone="+66800000112",
            room_type_code="DBL",
            check_in_date=check_in_date,
            check_out_date=check_out_date,
        )
        mark_checked_in(reservation)
        actor = make_staff_user("front_desk", "fd5@example.com")

        prep = prepare_checkout(reservation.id, action_at=hotel_dt(check_out_date, 10))
        assert prep["checkout_payment_summary"]["balance_due"] == Decimal(str(reservation.quoted_grand_total))

        checked_out = complete_checkout(
            reservation.id,
            CheckoutPayload(
                collect_payment_amount=Decimal(str(reservation.quoted_grand_total)),
                departure_note="Guest settled balance and returned key",
                    action_at=hotel_dt(check_out_date, 10),
                ),
                actor_user_id=actor.id,
            )

        dirty = HousekeepingStatus.query.filter_by(code="dirty").one()
        turnover_row = InventoryDay.query.filter_by(room_id=reservation.assigned_room_id, business_date=check_out_date).one()
        assert checked_out.current_status == "checked_out"
        assert turnover_row.housekeeping_status_id == dirty.id
        assert turnover_row.is_sellable is False
        assert turnover_row.notes == "Awaiting housekeeping turnover after checkout"


def test_checkout_blocks_when_financial_balance_remains(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        check_in_date = date.today() + timedelta(days=1)
        check_out_date = date.today() + timedelta(days=2)
        reservation = create_staff_reservation(
            first_name="Balance",
            last_name="Due",
            phone="+66800000113",
            room_type_code="DBL",
            check_in_date=check_in_date,
            check_out_date=check_out_date,
        )
        mark_checked_in(reservation)
        actor = make_staff_user("front_desk", "fd6@example.com")

        with pytest.raises(ValueError, match="Outstanding balance remains"):
                complete_checkout(
                    reservation.id,
                    CheckoutPayload(collect_payment_amount=Decimal("0.00"), action_at=hotel_dt(check_out_date, 10)),
                    actor_user_id=actor.id,
                )


def test_no_show_processing_updates_status_history_and_releases_inventory(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        reservation = create_staff_reservation(
            first_name="No",
            last_name="Show",
            phone="+66800000114",
            room_type_code="TWN",
            check_in_date=business_date,
            check_out_date=business_date + timedelta(days=2),
        )
        actor = make_staff_user("front_desk", "fd7@example.com")

        process_no_show(
            reservation.id,
            NoShowPayload(reason="Did not arrive by cutoff", action_at=utc_dt(business_date, 7)),
            actor_user_id=actor.id,
        )

        refreshed = db.session.get(Reservation, reservation.id)
        assert refreshed.current_status == "no_show"
        assert refreshed.no_show_at is not None
        assert InventoryDay.query.filter_by(reservation_id=reservation.id).count() == 0
        assert ReservationStatusHistory.query.filter_by(reservation_id=reservation.id, new_status="no_show").count() == 1
        assert PaymentRequest.query.filter_by(reservation_id=reservation.id, request_type="no_show_charge").count() == 1


def test_stale_conflict_is_detected_during_check_in(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        reservation = create_staff_reservation(
            first_name="Conflict",
            last_name="Guest",
            phone="+66800000115",
            room_type_code="TWN",
            check_in_date=business_date,
            check_out_date=business_date + timedelta(days=1),
        )
        other = create_staff_reservation(
            first_name="Other",
            last_name="Guest",
            phone="+66800000116",
            room_type_code="TWN",
            check_in_date=business_date,
            check_out_date=business_date + timedelta(days=1),
        )
        actor = make_staff_user("front_desk", "fd8@example.com")

        row = InventoryDay.query.filter_by(room_id=reservation.assigned_room_id, business_date=business_date).one()
        row.availability_status = "reserved"
        row.reservation_id = other.id
        db.session.commit()

        with pytest.raises(ValueError, match="conflicts with another active stay"):
            complete_check_in(
                reservation.id,
                CheckInPayload(
                    room_id=reservation.assigned_room_id,
                    first_name="Conflict",
                    last_name="Guest",
                    phone="+66800000115",
                    email="conflict@example.com",
                    identity_verified=True,
                    action_at=utc_dt(business_date, 15),
                ),
                actor_user_id=actor.id,
            )


def test_front_desk_routes_render_and_show_operational_data(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Route",
            last_name="Guest",
            phone="+66800000117",
            room_type_code="TWN",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        user = make_staff_user("front_desk", "fd9@example.com")
    login_as(client, user)

    workspace_response = client.get("/staff/front-desk")
    detail_response = client.get(f"/staff/front-desk/{reservation.id}")

    assert workspace_response.status_code == 200
    assert "Front desk workspace" in workspace_response.get_data(as_text=True)
    assert detail_response.status_code == 200
    assert reservation.reservation_code in detail_response.get_data(as_text=True)


def test_front_desk_detail_shows_booked_extras(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Front",
            last_name="Extras",
            phone="+66800000170",
            room_type_code="TWN",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=2),
        )
        transfer = create_booking_extra(
            code="TRNS",
            name="Airport transfer",
            pricing_mode="per_stay",
            unit_price="900.00",
        )
        extras_quote = quote_booking_extras(
            [transfer],
            check_in_date=reservation.check_in_date,
            check_out_date=reservation.check_out_date,
        )
        attach_extras_quote_to_reservation(reservation, extras_quote, actor_user_id=None, source="public_booking")
        post_reservation_extras_to_folio(reservation, actor_user_id=None)
        db.session.commit()
        user = make_staff_user("front_desk", "fd-extras@example.com")
    login_as(client, user)

    response = client.get(f"/staff/front-desk/{reservation.id}")
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert "Booked extras" in body
    assert "Airport transfer" in body


def test_front_desk_detail_prefills_check_in_with_outstanding_deposit(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Deposit",
            last_name="Default",
            phone="+66800000175",
            room_type_code="DBL",
            check_in_date=date.today() + timedelta(days=1),
            check_out_date=date.today() + timedelta(days=2),
        )
        user = make_staff_user("front_desk", "fd-checkin-default@example.com")
    login_as(client, user)

    response = client.get(f"/staff/front-desk/{reservation.id}")
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert (
        f'name="collect_payment_amount" min="0" step="0.01" value="{reservation.deposit_required_amount}"' in body
    )


def test_front_desk_detail_prefills_check_out_with_current_balance_due(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Checkout",
            last_name="Default",
            phone="+66800000176",
            room_type_code="DBL",
            check_in_date=date.today() + timedelta(days=1),
            check_out_date=date.today() + timedelta(days=4),
        )
        mark_checked_in(reservation)
        checkout_prep = prepare_checkout(reservation.id)
        user = make_staff_user("front_desk", "fd-checkout-default@example.com")
    login_as(client, user)

    response = client.get(f"/staff/front-desk/{reservation.id}")
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert checkout_prep["checkout_payment_summary"]["balance_due"] == reservation.quoted_grand_total
    assert checkout_prep["checkout_payment_summary"]["balance_due"] > Decimal("1000.00")
    assert (
        'name="collect_payment_amount" min="0" step="0.01" '
        f'value="{checkout_prep["checkout_payment_summary"]["balance_due"]}"' in body
    )
    assert (
        'name="collect_payment_amount" min="0" step="0.01" '
        f'value="{checkout_prep["checkout_payment_summary"]["balance_due"]:,}"' not in body
    )


def test_check_in_route_updates_guest_identity_fields(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Route",
            last_name="Identity",
            phone="+66800000118",
            room_type_code="DBL",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        user = make_staff_user("front_desk", "fd10@example.com")
    login_as(client, user)

    response = post_form(
        client,
        f"/staff/front-desk/{reservation.id}/check-in",
        data={
            "room_id": str(reservation.assigned_room_id),
            "first_name": "Route",
            "last_name": "Identity",
            "phone": "+66800000999",
            "email": "identity@example.com",
            "nationality": "TH",
            "id_document_type": "passport",
            "id_document_number": "P-12345",
            "identity_verified": "on",
            "collect_payment_amount": str(reservation.deposit_required_amount),
            "apply_early_fee": "on",
            "back_url": "/staff/front-desk",
            "business_date": date.today().isoformat(),
        },
        follow_redirects=True,
    )

    with app.app_context():
        refreshed = db.session.get(Reservation, reservation.id)
        assert response.status_code == 200
        assert refreshed.current_status == "checked_in"
        assert refreshed.primary_guest.phone == "+66800000999"
        assert refreshed.identity_verified_at is not None


def test_check_in_route_rejects_deposit_override_for_front_desk_role(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Override",
            last_name="Blocked",
            phone="+66800000119",
            room_type_code="DBL",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        reservation.deposit_required_amount = Decimal("500.00")
        db.session.commit()
        user = make_staff_user("front_desk", "fd-override-blocked@example.com")
    login_as(client, user)

    response = post_form(
        client,
        f"/staff/front-desk/{reservation.id}/check-in",
        data={
            "room_id": str(reservation.assigned_room_id),
            "first_name": "Override",
            "last_name": "Blocked",
            "phone": "+66800000119",
            "email": "override-blocked@example.com",
            "identity_verified": "on",
            "collect_payment_amount": "0.00",
            "override_payment": "on",
            "apply_early_fee": "on",
            "back_url": "/staff/front-desk",
            "business_date": date.today().isoformat(),
        },
    )
    body = response.get_data(as_text=True)

    assert response.status_code == 400
    assert "Deposit is still outstanding." in body
    with app.app_context():
        refreshed = db.session.get(Reservation, reservation.id)
        assert refreshed.current_status == "confirmed"
        assert refreshed.checked_in_at is None


def test_check_in_route_allows_manager_deposit_override(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Override",
            last_name="Manager",
            phone="+66800000120",
            room_type_code="DBL",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        reservation.deposit_required_amount = Decimal("500.00")
        db.session.commit()
        user = make_staff_user("manager", "manager-override@example.com")
    login_as(client, user)

    response = post_form(
        client,
        f"/staff/front-desk/{reservation.id}/check-in",
        data={
            "room_id": str(reservation.assigned_room_id),
            "first_name": "Override",
            "last_name": "Manager",
            "phone": "+66800000120",
            "email": "override-manager@example.com",
            "identity_verified": "on",
            "collect_payment_amount": "0.00",
            "override_payment": "on",
            "apply_early_fee": "on",
            "back_url": "/staff/front-desk",
            "business_date": date.today().isoformat(),
        },
        follow_redirects=True,
    )

    with app.app_context():
        refreshed = db.session.get(Reservation, reservation.id)
        assert response.status_code == 200
        assert refreshed.current_status == "checked_in"
        assert refreshed.checked_in_at is not None


def test_check_in_route_blocks_missing_identity_verification_outside_testing(app_factory, monkeypatch):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Route",
            last_name="Blocked",
            phone="+66800000198",
            room_type_code="DBL",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        user = make_staff_user("front_desk", "fd-route-identity-required@example.com")
    monkeypatch.setattr(front_desk_routes, "current_app_testing", lambda: False)
    login_as(client, user)

    response = post_form(
        client,
        f"/staff/front-desk/{reservation.id}/check-in",
        data={
            "room_id": str(reservation.assigned_room_id),
            "first_name": "Route",
            "last_name": "Blocked",
            "phone": "+66800000198",
            "email": "route-blocked@example.com",
            "collect_payment_amount": str(reservation.deposit_required_amount),
            "apply_early_fee": "on",
            "back_url": "/staff/front-desk",
            "business_date": date.today().isoformat(),
        },
    )
    body = response.get_data(as_text=True)

    assert response.status_code == 400
    assert "Identity verification must be completed before check-in." in body
    assert 'href="#check-in-identity-section"' in body
    with app.app_context():
        refreshed = db.session.get(Reservation, reservation.id)
        assert refreshed.current_status == "confirmed"
        assert refreshed.checked_in_at is None


def test_front_desk_detail_shows_check_in_blockers_before_submit(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Blocker",
            last_name="Guest",
            phone="+66800000171",
            room_type_code="DBL",
            check_in_date=date.today() + timedelta(days=1),
            check_out_date=date.today() + timedelta(days=2),
        )
        user = make_staff_user("front_desk", "fd-checkin-blockers@example.com")
    login_as(client, user)

    response = client.get(f"/staff/front-desk/{reservation.id}")
    body = response.get_data(as_text=True)

    assert response.status_code == 200
    assert "Resolve these items before completing check-in:" in body
    assert "Early check-in fee requires a decision." in body
    assert (
        f'name="collect_payment_amount" min="0" step="0.01" value="{reservation.deposit_required_amount}"' in body
    )


def test_check_in_route_returns_structured_field_errors_for_validation_issues(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Needs",
            last_name="Validation",
            phone="+66800000172",
            room_type_code="DBL",
            check_in_date=date.today() + timedelta(days=1),
            check_out_date=date.today() + timedelta(days=2),
        )
        user = make_staff_user("front_desk", "fd-checkin-validation@example.com")
    login_as(client, user)

    response = post_form(
        client,
        f"/staff/front-desk/{reservation.id}/check-in",
        data={
            "room_id": str(reservation.assigned_room_id),
            "first_name": "",
            "last_name": "Validation",
            "phone": "",
            "email": "validation@example.com",
            "payment_method": "front_desk",
            "collect_payment_amount": "0.00",
            "back_url": "/staff/front-desk",
            "business_date": (date.today() + timedelta(days=1)).isoformat(),
        },
    )
    body = response.get_data(as_text=True)

    assert response.status_code == 400
    assert "Check-in could not be completed. Please fix the following:" in body
    assert "Primary guest first name is required before check-in can be completed." in body
    assert "Primary guest phone number is required before check-in can be completed." in body
    assert "Deposit is still outstanding." in body
    assert 'href="#check-in-first-name"' in body
    assert 'id="check-in-first-name"' in body
    assert 'aria-invalid="true"' in body
    assert 'value="Validation"' in body


def test_check_in_route_rejects_invalid_payment_amount_with_field_message(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Amount",
            last_name="Invalid",
            phone="+66800000173",
            room_type_code="DBL",
            check_in_date=date.today() + timedelta(days=1),
            check_out_date=date.today() + timedelta(days=2),
        )
        user = make_staff_user("front_desk", "fd-checkin-amount@example.com")
    login_as(client, user)

    response = post_form(
        client,
        f"/staff/front-desk/{reservation.id}/check-in",
        data={
            "room_id": str(reservation.assigned_room_id),
            "first_name": "Amount",
            "last_name": "Invalid",
            "phone": "+66800000173",
            "email": "amount@example.com",
            "payment_method": "front_desk",
            "collect_payment_amount": "abc",
            "back_url": "/staff/front-desk",
            "business_date": (date.today() + timedelta(days=1)).isoformat(),
        },
    )
    body = response.get_data(as_text=True)

    assert response.status_code == 400
    assert "Payment collected now must be a valid amount in THB." in body
    assert "Something went wrong. Please try again or contact the hotel." not in body


def test_check_in_route_uses_unexpected_failure_fallback_with_reference(app_factory, monkeypatch):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Unexpected",
            last_name="Failure",
            phone="+66800000174",
            room_type_code="DBL",
            check_in_date=date.today() + timedelta(days=1),
            check_out_date=date.today() + timedelta(days=2),
        )
        user = make_staff_user("front_desk", "fd-checkin-unexpected@example.com")

    def boom(*args, **kwargs):
        raise RuntimeError("secret token should never leak")

    monkeypatch.setattr(pms_app, "complete_check_in", boom)
    login_as(client, user)

    response = post_form(
        client,
        f"/staff/front-desk/{reservation.id}/check-in",
        data={
            "room_id": str(reservation.assigned_room_id),
            "first_name": "Unexpected",
            "last_name": "Failure",
            "phone": "+66800000174",
            "email": "unexpected@example.com",
            "payment_method": "front_desk",
            "collect_payment_amount": str(reservation.deposit_required_amount),
            "apply_early_fee": "on",
            "back_url": "/staff/front-desk",
            "business_date": (date.today() + timedelta(days=1)).isoformat(),
        },
    )
    body = response.get_data(as_text=True)

    assert response.status_code == 500
    assert "Check-in could not be completed due to an unexpected system error." in body
    assert "CHKIN-" in body
    assert "secret token should never leak" not in body


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is not configured for Postgres front-desk testing")
def test_postgres_concurrent_walk_in_only_allows_one_last_room_check_in():
    app = postgres_seeded_app()
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").one()
        arrival = date.today()
        departure = arrival + timedelta(days=1)
        sellable_twin_rooms = Room.query.filter_by(room_type_id=twin.id, is_sellable=True).order_by(Room.room_number.asc()).all()
        keep_room = sellable_twin_rooms[-1]
        for room in sellable_twin_rooms[:-1]:
            row = InventoryDay.query.filter_by(room_id=room.id, business_date=arrival).one()
            row.availability_status = "occupied"
            row.is_sellable = False
        actor = make_staff_user("front_desk", "fd-postgres@example.com")
        db.session.commit()

    results: list[str] = []
    errors: list[str] = []

    def worker(label: str):
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
            try:
                create_walk_in_and_check_in(
                    WalkInCheckInPayload(
                        first_name=f"Walk{label}",
                        last_name="Guest",
                        phone=f"+668000009{label}",
                        email=f"walk{label}@example.com",
                        room_type_id=twin.id,
                        room_id=keep_room.id,
                        check_in_date=arrival,
                        check_out_date=departure,
                        adults=2,
                        children=0,
                    ),
                    actor_user_id=actor.id,
                )
                results.append(label)
            except Exception as exc:  # noqa: BLE001
                errors.append(str(exc))

    first = threading.Thread(target=worker, args=("1",))
    second = threading.Thread(target=worker, args=("2",))
    first.start()
    second.start()
    first.join()
    second.join()

    assert len(results) == 1
    assert len(errors) == 1
