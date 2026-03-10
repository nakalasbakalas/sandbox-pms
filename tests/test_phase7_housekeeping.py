from __future__ import annotations

import os
import threading
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask_migrate import upgrade
from werkzeug.security import generate_password_hash

from pms.app import create_app
from pms.extensions import db
from pms.models import (
    ActivityLog,
    AuditLog,
    HousekeepingStatus,
    InventoryDay,
    Role,
    Room,
    RoomNote,
    RoomStatusHistory,
    RoomType,
    User,
)
from pms.seeds import seed_all
from pms.services.front_desk_service import (
    CheckInPayload,
    CheckoutPayload,
    complete_check_in,
    complete_checkout,
    payment_summary,
    room_readiness_snapshot,
)
from pms.services.housekeeping_service import (
    BlockRoomPayload,
    BulkHousekeepingPayload,
    HousekeepingBoardFilters,
    MaintenanceFlagPayload,
    RoomNotePayload,
    RoomStatusUpdatePayload,
    add_room_note,
    bulk_update_housekeeping,
    get_housekeeping_room_detail,
    list_housekeeping_board,
    set_blocked_state,
    set_maintenance_flag,
    update_housekeeping_status,
)
from pms.services.reservation_service import ReservationCreatePayload, create_reservation
from pms.services.staff_reservations_service import assign_room


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = PROJECT_ROOT / "migrations"


def utc_dt(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour=hour, minute=minute), tzinfo=timezone.utc)


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
):
    room_type = RoomType.query.filter_by(code=room_type_code).one()
    return create_reservation(
        ReservationCreatePayload(
            first_name=first_name,
            last_name=last_name,
            phone=phone,
            email=f"{first_name.lower()}{phone[-4:]}@example.com",
            room_type_id=room_type.id,
            check_in_date=check_in_date,
            check_out_date=check_out_date,
            adults=2,
            children=0,
            source_channel="admin_manual",
        )
    )


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


def test_housekeeping_board_returns_correct_rooms_and_statuses(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        board = list_housekeeping_board(HousekeepingBoardFilters(business_date=date.today()))

        assert len(board["items"]) == 32
        room_201 = next(item for item in board["items"] if item["room_number"] == "201")
        room_216 = next(item for item in board["items"] if item["room_number"] == "216")
        room_316 = next(item for item in board["items"] if item["room_number"] == "316")

        assert room_201["room_type_code"] == "TWN"
        assert room_216["is_sellable"] is False
        assert room_316["availability_status"] == "out_of_service"


def test_room_status_transitions_history_and_timestamps_work(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        housekeeper = make_staff_user("housekeeping", "hk-status@example.com")
        manager = make_staff_user("manager", "hk-manager@example.com")

        update_housekeeping_status(
            room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="dirty", note="Departure clean needed"),
            actor_user_id=housekeeper.id,
        )
        clean_row = update_housekeeping_status(
            room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="clean", note="Room cleaned"),
            actor_user_id=housekeeper.id,
        )
        inspected_row = update_housekeeping_status(
            room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="inspected", note="Supervisor release"),
            actor_user_id=housekeeper.id,
        )
        out_of_order_row = update_housekeeping_status(
            room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="out_of_order", note="AC issue"),
            actor_user_id=manager.id,
        )

        assert clean_row.cleaned_at is not None
        assert inspected_row.inspected_at is not None
        assert out_of_order_row.availability_status == "out_of_order"
        assert out_of_order_row.is_sellable is False
        history = RoomStatusHistory.query.filter_by(room_id=room.id, business_date=business_date).all()
        assert len(history) == 4


def test_housekeeping_notes_and_detail_view_are_retrievable(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today()
        room = Room.query.filter_by(room_number="202").one()
        actor = make_staff_user("housekeeping", "hk-notes@example.com")

        note = add_room_note(
            room.id,
            business_date=business_date,
            payload=RoomNotePayload(
                note_text="Guest left belongings under the bed",
                note_type="lost_and_found",
                is_important=True,
            ),
            actor_user_id=actor.id,
        )
        detail = get_housekeeping_room_detail(room.id, business_date=business_date, actor_user=actor)

        assert note.note_type == "lost_and_found"
        assert detail["notes"][0].note_text == "Guest left belongings under the bed"
        assert detail["notes"][0].created_by_user.full_name == actor.full_name


def test_cleaning_priority_marks_arrival_dirty_room_as_urgent(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=2)
        reservation = create_staff_reservation(
            first_name="Arrival",
            last_name="Urgent",
            phone="+66810000001",
            room_type_code="TWN",
            check_in_date=business_date,
            check_out_date=business_date + timedelta(days=1),
        )
        actor = make_staff_user("housekeeping", "hk-priority@example.com")
        update_housekeeping_status(
            reservation.assigned_room_id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="dirty", note="Still dirty"),
            actor_user_id=actor.id,
        )

        board = list_housekeeping_board(HousekeepingBoardFilters(business_date=business_date), actor_user=actor)
        room_item = next(item for item in board["items"] if str(item["room_id"]) == str(reservation.assigned_room_id))

        assert room_item["arrival_today"] is True
        assert room_item["priority"] == "urgent"
        assert "not ready" in room_item["priority_reason"].lower()


def test_mobile_housekeeping_route_renders_for_housekeeping_user(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        user = make_staff_user("housekeeping", "hk-mobile@example.com")
    login_as(client, user)

    response = client.get("/staff/housekeeping?view=mobile")

    assert response.status_code == 200
    text = response.get_data(as_text=True)
    assert "Daily housekeeping board" in text
    assert "Mobile" in text


def test_room_detail_route_hides_guest_name_for_housekeeping_role(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        business_date = date.today() + timedelta(days=2)
        reservation = create_staff_reservation(
            first_name="Privacy",
            last_name="Guest",
            phone="+66810000002",
            room_type_code="TWN",
            check_in_date=business_date,
            check_out_date=business_date + timedelta(days=1),
        )
        user = make_staff_user("housekeeping", "hk-privacy@example.com")
        room_id = reservation.assigned_room_id
    login_as(client, user)

    response = client.get(f"/staff/housekeeping/rooms/{room_id}?date={business_date.isoformat()}")

    assert response.status_code == 200
    text = response.get_data(as_text=True)
    assert reservation.reservation_code in text
    assert "Privacy Guest" not in text


def test_bulk_updates_apply_per_room_and_report_failures(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        actor = make_staff_user("housekeeping", "hk-bulk@example.com")
        room_one = Room.query.filter_by(room_number="203").one()
        room_two = Room.query.filter_by(room_number="204").one()

        result = bulk_update_housekeeping(
            BulkHousekeepingPayload(
                room_ids=[room_one.id, room_two.id, uuid4()],
                business_date=business_date,
                action="set_status",
                status_code="clean",
                note="Bulk cleaned for arrivals",
            ),
            actor_user_id=actor.id,
        )

        assert result["success_count"] == 2
        assert result["failure_count"] == 1
        refreshed = InventoryDay.query.filter(
            InventoryDay.room_id.in_([room_one.id, room_two.id]),
            InventoryDay.business_date == business_date,
        ).all()
        assert all(row.cleaned_at is not None for row in refreshed)
        assert RoomStatusHistory.query.filter_by(business_date=business_date, event_type="status_changed").count() >= 2


def test_maintenance_flag_can_be_set_and_cleared(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today()
        room = Room.query.filter_by(room_number="205").one()
        actor = make_staff_user("housekeeping", "hk-maint@example.com")

        set_maintenance_flag(
            room.id,
            business_date=business_date,
            payload=MaintenanceFlagPayload(enabled=True, note="Bathroom drain issue"),
            actor_user_id=actor.id,
        )
        row = InventoryDay.query.filter_by(room_id=room.id, business_date=business_date).one()
        assert row.maintenance_flag is True
        assert row.maintenance_note == "Bathroom drain issue"

        set_maintenance_flag(
            room.id,
            business_date=business_date,
            payload=MaintenanceFlagPayload(enabled=False, note="Cleared"),
            actor_user_id=actor.id,
        )
        row = InventoryDay.query.filter_by(room_id=room.id, business_date=business_date).one()
        assert row.maintenance_flag is False
        assert row.maintenance_note is None


def test_blocked_room_handling_affects_assignment_and_unblock_does_not_force_ready(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=2)
        reservation = create_staff_reservation(
            first_name="Blocked",
            last_name="Stay",
            phone="+66810000003",
            room_type_code="DBL",
            check_in_date=business_date,
            check_out_date=business_date + timedelta(days=2),
        )
        housekeeper = make_staff_user("housekeeping", "hk-block-state@example.com")
        manager = make_staff_user("manager", "mgr-block-state@example.com")
        blocked_room = Room.query.filter(
            Room.room_type_id == reservation.room_type_id,
            Room.id != reservation.assigned_room_id,
            Room.is_sellable.is_(True),
        ).order_by(Room.room_number.asc()).first()
        update_housekeeping_status(
            blocked_room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="dirty", note="Not ready"),
            actor_user_id=housekeeper.id,
        )

        set_blocked_state(
            blocked_room.id,
            business_date=business_date,
            payload=BlockRoomPayload(blocked=True, reason="Arrival recovery hold"),
            actor_user_id=manager.id,
        )
        with pytest.raises(ValueError, match="not available"):
            assign_room(reservation.id, blocked_room.id, actor_user_id=manager.id)

        set_blocked_state(
            blocked_room.id,
            business_date=business_date,
            payload=BlockRoomPayload(blocked=False),
            actor_user_id=manager.id,
        )
        with pytest.raises(ValueError, match="not available"):
            assign_room(reservation.id, blocked_room.id, actor_user_id=manager.id)

        update_housekeeping_status(
            blocked_room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="clean", note="Released after cleaning"),
            actor_user_id=housekeeper.id,
        )
        assign_room(reservation.id, blocked_room.id, actor_user_id=manager.id)
        assert reservation.assigned_room_id == blocked_room.id


def test_front_desk_can_view_board_but_cannot_block_room(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        user = make_staff_user("front_desk", "fd-housekeeping@example.com")
        room = Room.query.filter_by(room_number="206").one()
    login_as(client, user)

    response = client.get("/staff/housekeeping")
    assert response.status_code == 200

    result = post_form(
        client,
        f"/staff/housekeeping/rooms/{room.id}/block",
        data={
            "business_date": date.today().isoformat(),
            "blocked": "1",
            "reason": "Front desk should not block this room",
            "back_url": "/staff/housekeeping",
        },
        follow_redirects=True,
    )

    assert result.status_code == 200
    assert "Only manager or admin can perform this operational override." in result.get_data(as_text=True)
    with app.app_context():
        row = InventoryDay.query.filter_by(room_id=room.id, business_date=date.today()).one()
        assert row.is_blocked is False


def test_checkout_dirty_turnover_appears_in_housekeeping_and_clean_inspected_restore_readiness(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        reservation = create_staff_reservation(
            first_name="Turnover",
            last_name="Guest",
            phone="+66810000004",
            room_type_code="TWN",
            check_in_date=business_date,
            check_out_date=business_date + timedelta(days=1),
        )
        front_desk = make_staff_user("front_desk", "fd-turnover@example.com")
        housekeeper = make_staff_user("housekeeping", "hk-turnover@example.com")

        complete_check_in(
            reservation.id,
            CheckInPayload(
                room_id=reservation.assigned_room_id,
                first_name="Turnover",
                last_name="Guest",
                phone="+66810000004",
                email="turnover@example.com",
                identity_verified=True,
                collect_payment_amount=Decimal(str(reservation.deposit_required_amount)),
                action_at=utc_dt(business_date, 14),
            ),
            actor_user_id=front_desk.id,
        )
        current_payment = payment_summary(reservation)
        complete_checkout(
            reservation.id,
            CheckoutPayload(
                collect_payment_amount=current_payment["balance_due"],
                departure_note="Checked out on time",
                action_at=utc_dt(business_date + timedelta(days=1), 10),
            ),
            actor_user_id=front_desk.id,
        )

        board = list_housekeeping_board(HousekeepingBoardFilters(business_date=business_date + timedelta(days=1)))
        room_item = next(item for item in board["items"] if str(item["room_id"]) == str(reservation.assigned_room_id))
        assert room_item["housekeeping_status_code"] == "dirty"

        future_reservation = create_staff_reservation(
            first_name="Next",
            last_name="Arrival",
            phone="+66810000005",
            room_type_code="TWN",
            check_in_date=business_date + timedelta(days=2),
            check_out_date=business_date + timedelta(days=3),
        )
        update_housekeeping_status(
            future_reservation.assigned_room_id,
            business_date=business_date + timedelta(days=2),
            payload=RoomStatusUpdatePayload(status_code="clean"),
            actor_user_id=housekeeper.id,
        )
        clean_snapshot = room_readiness_snapshot(future_reservation, business_date + timedelta(days=2))
        assert clean_snapshot["is_ready"] is True

        update_housekeeping_status(
            future_reservation.assigned_room_id,
            business_date=business_date + timedelta(days=2),
            payload=RoomStatusUpdatePayload(status_code="inspected"),
            actor_user_id=housekeeper.id,
        )
        inspected_snapshot = room_readiness_snapshot(future_reservation, business_date + timedelta(days=2))
        assert inspected_snapshot["is_ready"] is True


def test_status_changes_write_audit_and_activity_trail(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        actor = make_staff_user("housekeeping", "hk-audit@example.com")
        room = Room.query.filter_by(room_number="207").one()
        business_date = date.today()

        update_housekeeping_status(
            room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="dirty", note="Guest departed"),
            actor_user_id=actor.id,
        )
        set_maintenance_flag(
            room.id,
            business_date=business_date,
            payload=MaintenanceFlagPayload(enabled=True, note="Lamp replacement"),
            actor_user_id=actor.id,
        )

        assert ActivityLog.query.filter(ActivityLog.event_type.like("housekeeping.%")).count() >= 2
        assert AuditLog.query.filter(
            AuditLog.entity_table == "inventory_days",
            AuditLog.action.in_(["housekeeping_status_changed", "housekeeping_maintenance_changed"]),
        ).count() >= 2


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is not configured for Postgres housekeeping testing")
def test_postgres_block_and_assignment_race_allows_only_one_winner():
    app = postgres_seeded_app()
    with app.app_context():
        start = date.today() + timedelta(days=5)
        check_out = start + timedelta(days=2)
        reservation = create_staff_reservation(
            first_name="Race",
            last_name="Reservation",
            phone="+66810000991",
            room_type_code="TWN",
            check_in_date=start,
            check_out_date=check_out,
        )
        target_room = Room.query.join(RoomType).filter(
            RoomType.code == "TWN",
            Room.room_number != reservation.assigned_room.room_number,
            Room.is_sellable.is_(True),
        ).order_by(Room.room_number.asc()).first()
        manager = make_staff_user("manager", "mgr-race@example.com")
        front_desk = make_staff_user("front_desk", "fd-race@example.com")

    barrier = threading.Barrier(3)
    results: list[tuple[str, str]] = []
    lock = threading.Lock()

    def block_worker():
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
                set_blocked_state(
                    target_room.id,
                    business_date=start,
                    payload=BlockRoomPayload(blocked=True, reason="Supervisor block"),
                    actor_user_id=manager.id,
                )
                outcome = ("ok", "blocked")
            except Exception as exc:  # noqa: BLE001
                outcome = ("error", str(exc))
            finally:
                db.session.remove()
            with lock:
                results.append(outcome)

    def assign_worker():
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
                assign_room(reservation.id, target_room.id, actor_user_id=front_desk.id)
                outcome = ("ok", "assigned")
            except Exception as exc:  # noqa: BLE001
                outcome = ("error", str(exc))
            finally:
                db.session.remove()
            with lock:
                results.append(outcome)

    thread_one = threading.Thread(target=block_worker)
    thread_two = threading.Thread(target=assign_worker)
    thread_one.start()
    thread_two.start()
    barrier.wait()
    thread_one.join()
    thread_two.join()

    successes = [item for item in results if item[0] == "ok"]
    failures = [item for item in results if item[0] == "error"]
    assert len(successes) == 1
    assert len(failures) == 1

    with app.app_context():
        start_row = InventoryDay.query.filter_by(room_id=target_room.id, business_date=start).one()
        if successes[0][1] == "blocked":
            assert start_row.is_blocked is True
            assert str(InventoryDay.query.filter_by(room_id=target_room.id, business_date=start).one().reservation_id) != str(reservation.id)
        else:
            assert str(start_row.reservation_id) == str(reservation.id)
            assert start_row.is_blocked is False
