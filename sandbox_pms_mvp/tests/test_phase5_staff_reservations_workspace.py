from __future__ import annotations

import os
import threading
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
import sqlalchemy as sa
from flask_migrate import upgrade
from werkzeug.security import generate_password_hash

from pms.app import create_app
from pms.extensions import db
from pms.models import AuditLog, EmailOutbox, InventoryDay, PaymentRequest, Reservation, ReservationNote, Role, Room, RoomType, User
from pms.seeds import seed_all
from pms.services.reservation_service import ReservationCreatePayload, create_reservation
from pms.services.staff_reservations_service import (
    GuestUpdatePayload,
    ReservationNotePayload,
    ReservationWorkspaceFilters,
    StayDateChangePayload,
    add_reservation_note,
    assign_room,
    cancel_reservation_workspace,
    change_stay_dates,
    get_reservation_detail,
    list_arrivals,
    list_departures,
    list_in_house,
    list_reservations,
    payment_summary,
    resend_confirmation,
    update_guest_details,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = PROJECT_ROOT / "migrations"


def next_weekday(target: int, offset_weeks: int = 1) -> date:
    anchor = date.today() + timedelta(days=7 * offset_weeks)
    days_ahead = (target - anchor.weekday()) % 7
    return anchor + timedelta(days=days_ahead)


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


def mark_checked_in(reservation: Reservation) -> None:
    reservation.current_status = "checked_in"
    reservation.checked_in_at = reservation.booked_at
    rows = InventoryDay.query.filter_by(reservation_id=reservation.id).all()
    for row in rows:
        row.availability_status = "occupied"
    db.session.commit()


def mark_checked_out(reservation: Reservation) -> None:
    reservation.current_status = "checked_out"
    reservation.checked_out_at = reservation.booked_at
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


def test_reservation_list_loads_correctly(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        create_staff_reservation(
            first_name="Alice",
            last_name="Walker",
            phone="+66800000021",
            room_type_code="TWN",
            check_in_date=date.today() + timedelta(days=1),
            check_out_date=date.today() + timedelta(days=3),
        )
        user = make_staff_user("front_desk", "frontdesk@example.com")
    login_as(client, user)
    response = client.get("/staff/reservations")
    assert response.status_code == 200
    assert "Alice Walker" in response.get_data(as_text=True)


def test_staff_operational_routes_render_for_authorized_user(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        create_staff_reservation(
            first_name="Ops",
            last_name="Arrival",
            phone="+66800000020",
            room_type_code="TWN",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=2),
        )
        user = make_staff_user("front_desk", "opsdesk@example.com")
    login_as(client, user)
    assert client.get("/staff/reservations").status_code == 200
    assert client.get("/staff/reservations/arrivals").status_code == 200
    assert client.get("/staff/reservations/departures").status_code == 200
    assert client.get("/staff/reservations/in-house").status_code == 200


def test_search_by_guest_name_phone_and_code_work(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Nora",
            last_name="Jones",
            phone="+66 80-000-0022",
            room_type_code="TWN",
            check_in_date=date.today() + timedelta(days=2),
            check_out_date=date.today() + timedelta(days=4),
        )
        assert list_reservations(ReservationWorkspaceFilters(q="Nora"))["items"][0]["reservation_code"] == reservation.reservation_code
        assert list_reservations(ReservationWorkspaceFilters(q="800000022"))["items"][0]["reservation_code"] == reservation.reservation_code
        assert list_reservations(ReservationWorkspaceFilters(q=reservation.reservation_code))["items"][0]["reservation_code"] == reservation.reservation_code


def test_filters_by_status_room_type_arrival_and_departure_work(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        twin = create_staff_reservation(
            first_name="Twin",
            last_name="Guest",
            phone="+66800000023",
            room_type_code="TWN",
            check_in_date=date.today() + timedelta(days=3),
            check_out_date=date.today() + timedelta(days=5),
        )
        double = create_staff_reservation(
            first_name="Double",
            last_name="Guest",
            phone="+66800000024",
            room_type_code="DBL",
            check_in_date=date.today() + timedelta(days=4),
            check_out_date=date.today() + timedelta(days=6),
        )
        double.current_status = "cancelled"
        db.session.commit()
        twin_results = list_reservations(ReservationWorkspaceFilters(room_type_id=str(twin.room_type_id)))
        assert {item["reservation_code"] for item in twin_results["items"]} == {twin.reservation_code}
        arrival_results = list_reservations(ReservationWorkspaceFilters(arrival_date=twin.check_in_date.isoformat()))
        assert {item["reservation_code"] for item in arrival_results["items"]} == {twin.reservation_code}
        departure_results = list_reservations(ReservationWorkspaceFilters(departure_date=double.check_out_date.isoformat(), include_closed=True))
        assert double.reservation_code in {item["reservation_code"] for item in departure_results["items"]}
        cancelled_results = list_reservations(ReservationWorkspaceFilters(status="cancelled", include_closed=True))
        assert {item["reservation_code"] for item in cancelled_results["items"]} == {double.reservation_code}


def test_reservation_detail_view_returns_correct_data(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Detail",
            last_name="Guest",
            phone="+66800000025",
            room_type_code="DBL",
            check_in_date=date.today() + timedelta(days=2),
            check_out_date=date.today() + timedelta(days=4),
        )
        detail = get_reservation_detail(reservation.id)
        assert detail["reservation"].reservation_code == reservation.reservation_code
        assert detail["room_type_code"] == "DBL"


def test_authorized_user_can_edit_guest_details(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Edit",
            last_name="Guest",
            phone="+66800000026",
            room_type_code="TWN",
            check_in_date=date.today() + timedelta(days=2),
            check_out_date=date.today() + timedelta(days=4),
        )
        user = make_staff_user("front_desk", "editor@example.com")
        update_guest_details(
            reservation.id,
            GuestUpdatePayload(
                first_name="Edited",
                last_name="Guest",
                phone="+66800000999",
                email="edited@example.com",
                nationality="TH",
            ),
            actor_user_id=user.id,
        )
        refreshed = db.session.get(Reservation, reservation.id)
        assert refreshed.primary_guest.first_name == "Edited"
        assert refreshed.primary_guest.phone == "+66800000999"


def test_unauthorized_user_cannot_edit_guest_details(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Blocked",
            last_name="Guest",
            phone="+66800000027",
            room_type_code="TWN",
            check_in_date=date.today() + timedelta(days=2),
            check_out_date=date.today() + timedelta(days=4),
        )
        user = make_staff_user("housekeeping", "housekeeping@example.com")
    login_as(client, user)
    response = post_form(
        client,
        f"/staff/reservations/{reservation.id}/guest",
        data={"first_name": "Nope", "last_name": "Guest", "phone": "+66800000027", "back_url": "/staff/reservations"},
    )
    assert response.status_code == 403


def test_housekeeping_detail_hides_folio_summary(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Restricted",
            last_name="View",
            phone="+66800000037",
            room_type_code="TWN",
            check_in_date=date.today() + timedelta(days=2),
            check_out_date=date.today() + timedelta(days=4),
        )
        user = make_staff_user("housekeeping", "housekeeping2@example.com")
    login_as(client, user)
    response = client.get(f"/staff/reservations/{reservation.id}")
    body = response.get_data(as_text=True)
    assert response.status_code == 200
    assert "Payment and deposit summary is restricted for your role." in body


def test_stay_date_change_revalidates_availability_and_reprices(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        start = next_weekday(0)
        reservation = create_staff_reservation(
            first_name="Date",
            last_name="Change",
            phone="+66800000028",
            room_type_code="TWN",
            check_in_date=start,
            check_out_date=start + timedelta(days=2),
        )
        original_total = Decimal(str(reservation.quoted_grand_total))
        result = change_stay_dates(
            reservation.id,
            StayDateChangePayload(
                check_in_date=start + timedelta(days=4),
                check_out_date=start + timedelta(days=6),
                adults=2,
                children=0,
                extra_guests=1,
            ),
            actor_user_id=make_staff_user("manager", "manager1@example.com").id,
        )
        assert result["new_total"] != original_total

        extra_night = reservation.check_out_date + timedelta(days=3)
        twin_rooms = Room.query.join(RoomType).filter(RoomType.code == "TWN", Room.is_sellable.is_(True)).all()
        for room in twin_rooms:
            row = InventoryDay.query.filter_by(room_id=room.id, business_date=extra_night).one()
            row.availability_status = "reserved"
            row.is_sellable = False
        db.session.commit()
        with pytest.raises(ValueError):
            change_stay_dates(
                reservation.id,
                StayDateChangePayload(
                    check_in_date=reservation.check_in_date,
                    check_out_date=extra_night + timedelta(days=1),
                    adults=2,
                    children=0,
                    extra_guests=0,
                ),
                actor_user_id=make_staff_user("manager", "manager2@example.com").id,
            )


def test_room_assignment_only_shows_eligible_rooms_and_prevents_double_booking(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        check_in = date.today() + timedelta(days=3)
        check_out = check_in + timedelta(days=2)
        reservation_one = create_staff_reservation(
            first_name="Room",
            last_name="One",
            phone="+66800000029",
            room_type_code="TWN",
            check_in_date=check_in,
            check_out_date=check_out,
        )
        reservation_two = create_staff_reservation(
            first_name="Room",
            last_name="Two",
            phone="+66800000030",
            room_type_code="TWN",
            check_in_date=check_in,
            check_out_date=check_out,
        )
        detail = get_reservation_detail(reservation_one.id)
        eligible_numbers = {room.room_number for room in detail["eligible_rooms"]}
        assert reservation_two.assigned_room.room_number not in eligible_numbers
        with pytest.raises(ValueError):
            assign_room(reservation_one.id, reservation_two.assigned_room_id, actor_user_id=make_staff_user("front_desk", "frontdesk2@example.com").id)


def test_cancellation_updates_status_history_and_releases_inventory(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Cancel",
            last_name="Guest",
            phone="+66800000031",
            room_type_code="DBL",
            check_in_date=date.today() + timedelta(days=2),
            check_out_date=date.today() + timedelta(days=5),
        )
        cancel_reservation_workspace(reservation.id, actor_user_id=make_staff_user("manager", "manager3@example.com").id, reason="guest_cancelled")
        refreshed = db.session.get(Reservation, reservation.id)
        assert refreshed.current_status == "cancelled"
        assert InventoryDay.query.filter_by(reservation_id=reservation.id).count() == 0


def test_note_creation_and_payment_summary_and_resend_confirmation_work(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Note",
            last_name="Guest",
            phone="+66800000032",
            room_type_code="DBL",
            check_in_date=date.today() + timedelta(days=2),
            check_out_date=date.today() + timedelta(days=5),
        )
        db.session.add(
            PaymentRequest(
                reservation_id=reservation.id,
                request_type="deposit",
                amount=reservation.deposit_required_amount,
                currency_code="THB",
                status="paid",
                provider="manual",
            )
        )
        db.session.commit()
        note = add_reservation_note(
            reservation.id,
            ReservationNotePayload(note_text="Guest called to confirm ETA", note_type="operations", is_important=True),
            actor_user_id=make_staff_user("front_desk", "frontdesk3@example.com").id,
        )
        summary = payment_summary(reservation)
        email = resend_confirmation(reservation.id, actor_user_id=make_staff_user("manager", "manager4@example.com").id)
        assert db.session.get(ReservationNote, note.id) is not None
        assert summary["deposit_state"] == "paid"
        assert db.session.get(EmailOutbox, email.id) is not None


def test_arrivals_departures_and_in_house_lists_work(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        arrival = create_staff_reservation(
            first_name="Arrival",
            last_name="Guest",
            phone="+66800000033",
            room_type_code="TWN",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=2),
        )
        departure = create_staff_reservation(
            first_name="Departure",
            last_name="Guest",
            phone="+66800000034",
            room_type_code="DBL",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        in_house = create_staff_reservation(
            first_name="House",
            last_name="Guest",
            phone="+66800000035",
            room_type_code="TWN",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=2),
        )
        departure.check_in_date = date.today() - timedelta(days=2)
        departure.check_out_date = date.today()
        db.session.commit()
        mark_checked_in(departure)
        mark_checked_in(in_house)
        arrivals = list_arrivals(arrival_date=date.today())
        departures = list_departures(departure_date=date.today())
        in_house_items = list_in_house(business_date=date.today())
        assert arrival.reservation_code in {item["reservation_code"] for item in arrivals}
        assert departure.reservation_code in {item["reservation_code"] for item in departures}
        assert in_house.reservation_code in {item["reservation_code"] for item in in_house_items}


def test_audit_entries_are_written_for_critical_actions(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Audit",
            last_name="Guest",
            phone="+66800000036",
            room_type_code="DBL",
            check_in_date=date.today() + timedelta(days=2),
            check_out_date=date.today() + timedelta(days=4),
        )
        actor = make_staff_user("manager", "manager5@example.com")
        update_guest_details(
            reservation.id,
            GuestUpdatePayload(first_name="Audit", last_name="Updated", phone="+66800000036", email="audit@example.com"),
            actor_user_id=actor.id,
        )
        cancel_reservation_workspace(reservation.id, actor_user_id=actor.id, reason="audit_cancel")
        audit_actions = {item.action for item in AuditLog.query.all()}
        assert "staff_guest_update" in audit_actions
        assert "staff_cancelled" in audit_actions


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is not configured for Postgres workspace testing")
def test_postgres_concurrent_room_change_allows_only_one_assignment_to_target_room():
    app = postgres_seeded_app()
    with app.app_context():
        start = date.today() + timedelta(days=4)
        check_out = start + timedelta(days=2)
        reservation_one = create_staff_reservation(
            first_name="Pg",
            last_name="One",
            phone="+66800000040",
            room_type_code="TWN",
            check_in_date=start,
            check_out_date=check_out,
        )
        reservation_two = create_staff_reservation(
            first_name="Pg",
            last_name="Two",
            phone="+66800000041",
            room_type_code="TWN",
            check_in_date=start,
            check_out_date=check_out,
        )
        target_room = Room.query.join(RoomType).filter(
            RoomType.code == "TWN",
            Room.room_number.not_in([reservation_one.assigned_room.room_number, reservation_two.assigned_room.room_number]),
            Room.is_sellable.is_(True),
        ).order_by(Room.room_number.asc()).first()
        actor_one = make_staff_user("front_desk", "pgfront1@example.com")
        actor_two = make_staff_user("front_desk", "pgfront2@example.com")

    barrier = threading.Barrier(3)
    results: list[tuple[str, str]] = []
    lock = threading.Lock()

    def worker(reservation_id, actor_id):
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
                assign_room(reservation_id, target_room.id, actor_user_id=actor_id)
                outcome = ("ok", str(reservation_id))
            except Exception as exc:  # noqa: BLE001
                outcome = ("error", str(exc))
            finally:
                db.session.remove()
            with lock:
                results.append(outcome)

    thread_one = threading.Thread(target=worker, args=(reservation_one.id, actor_one.id))
    thread_two = threading.Thread(target=worker, args=(reservation_two.id, actor_two.id))
    thread_one.start()
    thread_two.start()
    barrier.wait()
    thread_one.join()
    thread_two.join()

    successes = [item for item in results if item[0] == "ok"]
    failures = [item for item in results if item[0] == "error"]
    assert len(successes) == 1
    assert len(failures) == 1
    assert "not available" in failures[0][1].lower() or "conflict" in failures[0][1].lower()

    with app.app_context():
        target_rows = InventoryDay.query.filter_by(room_id=target_room.id).filter(
            InventoryDay.business_date >= start,
            InventoryDay.business_date < check_out,
        ).all()
        reservation_ids = {str(row.reservation_id) for row in target_rows if row.reservation_id}
        assert len(reservation_ids) == 1
