"""Tests for real-time housekeeping & room-readiness sync module.

Covers:
- Room readiness calculation
- Check-out → dirty transition
- Cleaned → inspected → ready flow
- Blocked room exclusion from assignment
- Housekeeping task lifecycle (create/assign/start/complete/inspect/cancel)
- Departure turnover auto-task creation
- cleaning_in_progress status
- Audit logging for room-state changes
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from flask_migrate import upgrade
from werkzeug.security import generate_password_hash

from pms.extensions import db
from pms.models import (
    ActivityLog,
    AuditLog,
    HousekeepingStatus,
    HousekeepingTask,
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
    room_readiness_snapshot,
)
from pms.services.housekeeping_service import (
    BlockRoomPayload,
    CreateTaskPayload,
    HousekeepingBoardFilters,
    MaintenanceFlagPayload,
    RoomStatusUpdatePayload,
    TaskListFilters,
    assign_housekeeping_task,
    cancel_housekeeping_task,
    complete_housekeeping_task,
    create_departure_turnover_task,
    create_housekeeping_task,
    inspect_housekeeping_task,
    list_housekeeping_board,
    list_housekeeping_tasks,
    set_blocked_state,
    set_maintenance_flag,
    start_housekeeping_task,
    update_housekeeping_status,
)
from pms.services.reservation_service import ReservationCreatePayload, create_reservation
from pms.services.room_readiness_service import (
    get_assignable_rooms,
    is_room_assignable,
    room_readiness_board,
)
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


# ---------------------------------------------------------------------------
# Room Readiness Service Tests
# ---------------------------------------------------------------------------


def test_room_readiness_clean_room_is_assignable(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-ready@example.com")

        # Set room to clean
        update_housekeeping_status(
            room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="clean"),
            actor_user_id=manager.id,
        )

        readiness = is_room_assignable(room.id, business_date)
        assert readiness.is_ready is True
        assert readiness.label == "ready"
        assert readiness.room_number == "201"


def test_room_readiness_dirty_room_not_assignable(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-dirty@example.com")

        update_housekeeping_status(
            room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="dirty"),
            actor_user_id=manager.id,
        )

        readiness = is_room_assignable(room.id, business_date)
        assert readiness.is_ready is False
        assert readiness.label == "not_ready"


def test_room_readiness_blocked_room_not_assignable(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-block@example.com")

        # First make room clean
        update_housekeeping_status(
            room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="clean"),
            actor_user_id=manager.id,
        )
        # Then block it
        set_blocked_state(
            room.id,
            business_date=business_date,
            payload=BlockRoomPayload(blocked=True, reason="VIP preparation"),
            actor_user_id=manager.id,
        )

        readiness = is_room_assignable(room.id, business_date)
        assert readiness.is_ready is False
        assert readiness.label == "blocked"
        assert readiness.is_blocked is True


def test_room_readiness_maintenance_room_not_assignable(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-maint@example.com")

        set_maintenance_flag(
            room.id,
            business_date=business_date,
            payload=MaintenanceFlagPayload(enabled=True, note="AC broken"),
            actor_user_id=manager.id,
        )

        readiness = is_room_assignable(room.id, business_date)
        assert readiness.is_ready is False
        assert readiness.label == "maintenance"
        assert readiness.is_maintenance is True


def test_room_readiness_board_returns_all_active_rooms(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        board = room_readiness_board(business_date)
        active_count = Room.query.filter_by(is_active=True).count()
        assert len(board) == active_count


def test_get_assignable_rooms_filters_ready_only(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room_type = RoomType.query.filter_by(code="TWN").one()
        manager = make_staff_user("manager", "mgr-assign@example.com")

        twn_rooms = Room.query.filter_by(room_type_id=room_type.id, is_active=True).all()
        # Make first room clean, leave rest as default
        update_housekeeping_status(
            twn_rooms[0].id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="clean"),
            actor_user_id=manager.id,
        )

        assignable = get_assignable_rooms(room_type.id, business_date)
        assert any(r.room_id == twn_rooms[0].id for r in assignable)


# ---------------------------------------------------------------------------
# Housekeeping Task Lifecycle Tests
# ---------------------------------------------------------------------------


def test_create_housekeeping_task(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-task@example.com")

        task = create_housekeeping_task(
            CreateTaskPayload(
                room_id=room.id,
                business_date=business_date,
                task_type="checkout_clean",
                priority="normal",
                notes="After guest checkout",
            ),
            actor_user_id=manager.id,
        )

        assert task.room_id == room.id
        assert task.status == "open"
        assert task.task_type == "checkout_clean"
        assert task.priority == "normal"
        assert task.business_date == business_date

        # Verify audit log
        audit = AuditLog.query.filter_by(
            entity_table="housekeeping_tasks",
            action="housekeeping_task_created",
        ).first()
        assert audit is not None


def test_assign_housekeeping_task(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-assign-task@example.com")
        housekeeper = make_staff_user("housekeeping", "hk-assign@example.com")

        task = create_housekeeping_task(
            CreateTaskPayload(room_id=room.id, business_date=business_date),
            actor_user_id=manager.id,
        )

        task = assign_housekeeping_task(task.id, assigned_to_user_id=housekeeper.id, actor_user_id=manager.id)
        assert task.status == "assigned"
        assert task.assigned_to_user_id == housekeeper.id


def test_start_housekeeping_task_sets_cleaning_in_progress(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-start-task@example.com")
        housekeeper = make_staff_user("housekeeping", "hk-start@example.com")

        # Set room to dirty first
        update_housekeeping_status(
            room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="dirty"),
            actor_user_id=manager.id,
        )

        task = create_housekeeping_task(
            CreateTaskPayload(room_id=room.id, business_date=business_date, assigned_to_user_id=housekeeper.id),
            actor_user_id=manager.id,
        )

        task = start_housekeeping_task(task.id, actor_user_id=housekeeper.id)
        assert task.status == "in_progress"
        assert task.started_at is not None

        # Room should now be cleaning_in_progress
        inv = InventoryDay.query.filter_by(room_id=room.id, business_date=business_date).one()
        cip_status = HousekeepingStatus.query.filter_by(code="cleaning_in_progress").one()
        assert inv.housekeeping_status_id == cip_status.id

        # Room should not be assignable while cleaning
        readiness = is_room_assignable(room.id, business_date)
        assert readiness.is_ready is False


def test_complete_housekeeping_task_sets_room_clean(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-complete@example.com")
        housekeeper = make_staff_user("housekeeping", "hk-complete@example.com")

        update_housekeeping_status(
            room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="dirty"),
            actor_user_id=manager.id,
        )

        task = create_housekeeping_task(
            CreateTaskPayload(room_id=room.id, business_date=business_date),
            actor_user_id=manager.id,
        )
        task = start_housekeeping_task(task.id, actor_user_id=housekeeper.id)
        task = complete_housekeeping_task(task.id, actor_user_id=housekeeper.id, notes="All done")

        assert task.status == "completed"
        assert task.completed_at is not None

        # Room should now be clean
        inv = InventoryDay.query.filter_by(room_id=room.id, business_date=business_date).one()
        clean_status = HousekeepingStatus.query.filter_by(code="clean").one()
        assert inv.housekeeping_status_id == clean_status.id
        assert inv.cleaned_at is not None


def test_inspect_housekeeping_task_sets_room_inspected(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-inspect@example.com")
        housekeeper = make_staff_user("housekeeping", "hk-inspect@example.com")

        update_housekeeping_status(
            room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="dirty"),
            actor_user_id=manager.id,
        )

        task = create_housekeeping_task(
            CreateTaskPayload(room_id=room.id, business_date=business_date),
            actor_user_id=manager.id,
        )
        task = start_housekeeping_task(task.id, actor_user_id=housekeeper.id)
        task = complete_housekeeping_task(task.id, actor_user_id=housekeeper.id)
        task = inspect_housekeeping_task(task.id, actor_user_id=manager.id, notes="Passed inspection")

        assert task.status == "inspected"
        assert task.verified_by_user_id == manager.id
        assert task.verified_at is not None

        # Room should now be inspected and ready
        inv = InventoryDay.query.filter_by(room_id=room.id, business_date=business_date).one()
        inspected_status = HousekeepingStatus.query.filter_by(code="inspected").one()
        assert inv.housekeeping_status_id == inspected_status.id
        assert inv.inspected_at is not None

        readiness = is_room_assignable(room.id, business_date)
        assert readiness.is_ready is True
        assert readiness.label == "ready"


def test_cancel_housekeeping_task(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-cancel@example.com")

        task = create_housekeeping_task(
            CreateTaskPayload(room_id=room.id, business_date=business_date),
            actor_user_id=manager.id,
        )

        task = cancel_housekeeping_task(task.id, actor_user_id=manager.id, reason="Cancelled by supervisor")
        assert task.status == "cancelled"
        assert "Cancelled by supervisor" in (task.notes or "")


def test_cannot_start_completed_task(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-double@example.com")

        task = create_housekeeping_task(
            CreateTaskPayload(room_id=room.id, business_date=business_date),
            actor_user_id=manager.id,
        )
        complete_housekeeping_task(task.id, actor_user_id=manager.id)

        with pytest.raises(ValueError, match="Only open or assigned"):
            start_housekeeping_task(task.id, actor_user_id=manager.id)


def test_cannot_inspect_non_completed_task(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-insp-err@example.com")

        task = create_housekeeping_task(
            CreateTaskPayload(room_id=room.id, business_date=business_date),
            actor_user_id=manager.id,
        )

        with pytest.raises(ValueError, match="Only completed tasks"):
            inspect_housekeeping_task(task.id, actor_user_id=manager.id)


def test_list_housekeeping_tasks_filters(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        room2 = Room.query.filter_by(room_number="202").one()
        manager = make_staff_user("manager", "mgr-list@example.com")

        create_housekeeping_task(
            CreateTaskPayload(room_id=room.id, business_date=business_date, task_type="checkout_clean"),
            actor_user_id=manager.id,
        )
        create_housekeeping_task(
            CreateTaskPayload(room_id=room2.id, business_date=business_date, task_type="rush_clean", priority="urgent"),
            actor_user_id=manager.id,
        )

        # List all
        tasks = list_housekeeping_tasks(TaskListFilters(business_date=business_date))
        assert len(tasks) == 2

        # Filter by priority
        tasks = list_housekeeping_tasks(TaskListFilters(business_date=business_date, priority="urgent"))
        assert len(tasks) == 1
        assert tasks[0]["task_type"] == "rush_clean"

        # Filter by task_type
        tasks = list_housekeeping_tasks(TaskListFilters(business_date=business_date, task_type="checkout_clean"))
        assert len(tasks) == 1


# ---------------------------------------------------------------------------
# Departure Turnover Workflow Tests
# ---------------------------------------------------------------------------


def test_departure_turnover_task_created_on_checkout(app_factory):
    """Check-out should automatically create a departure cleaning task."""
    app = app_factory(seed=True)
    with app.app_context():
        today = date.today()
        tomorrow = today + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        admin = make_staff_user("admin", "admin-turnover@example.com")
        front_desk = make_staff_user("front_desk", "fd-turnover@example.com")

        # Make room clean for check-in
        update_housekeeping_status(
            room.id,
            business_date=today,
            payload=RoomStatusUpdatePayload(status_code="clean"),
            actor_user_id=admin.id,
        )

        # Create reservation, assign room, check in
        reservation = create_staff_reservation(
            first_name="Turnover",
            last_name="Test",
            phone="+66800001111",
            room_type_code="TWN",
            check_in_date=today,
            check_out_date=tomorrow,
        )
        assign_room(reservation.id, room.id, actor_user_id=admin.id)

        complete_check_in(
            reservation.id,
            CheckInPayload(
                room_id=room.id,
                first_name="Turnover",
                last_name="Test",
                phone="+66800001111",
                email="turnover@example.com",
                identity_verified=True,
                collect_payment_amount=Decimal(str(reservation.deposit_required_amount)),
                action_at=utc_dt(today, 14),
            ),
            actor_user_id=admin.id,
        )

        # Pay outstanding balance then check out
        from pms.services.front_desk_service import payment_summary
        ps = payment_summary(reservation)
        complete_checkout(
            reservation.id,
            CheckoutPayload(
                collect_payment_amount=ps["balance_due"],
                action_at=utc_dt(tomorrow, 3),
            ),
            actor_user_id=front_desk.id,
        )

        # Verify a checkout_clean task was auto-created
        task = HousekeepingTask.query.filter_by(
            room_id=room.id,
            task_type="checkout_clean",
        ).first()
        assert task is not None
        assert task.status in {"open", "assigned"}
        assert task.reservation_id == reservation.id


def test_departure_turnover_auto_task_not_duplicated(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-nodup@example.com")

        task1 = create_departure_turnover_task(
            room.id, business_date, actor_user_id=manager.id,
        )
        task2 = create_departure_turnover_task(
            room.id, business_date, actor_user_id=manager.id,
        )

        # Same task should be returned
        assert task1.id == task2.id

        # Only one task in DB
        count = HousekeepingTask.query.filter_by(
            room_id=room.id,
            business_date=business_date,
            task_type="checkout_clean",
        ).count()
        assert count == 1


# ---------------------------------------------------------------------------
# Cleaned → Inspected → Ready Flow
# ---------------------------------------------------------------------------


def test_full_turnover_flow_dirty_to_ready(app_factory):
    """dirty → cleaning_in_progress → clean → inspected = ready."""
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-flow@example.com")
        housekeeper = make_staff_user("housekeeping", "hk-flow@example.com")

        # Start: dirty
        update_housekeeping_status(
            room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="dirty"),
            actor_user_id=manager.id,
        )
        assert is_room_assignable(room.id, business_date).is_ready is False

        # Step 1: cleaning_in_progress
        update_housekeeping_status(
            room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="cleaning_in_progress"),
            actor_user_id=housekeeper.id,
        )
        assert is_room_assignable(room.id, business_date).is_ready is False

        # Step 2: clean
        update_housekeeping_status(
            room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="clean"),
            actor_user_id=housekeeper.id,
        )
        readiness = is_room_assignable(room.id, business_date)
        assert readiness.is_ready is True

        # Step 3: inspected (even more ready)
        update_housekeeping_status(
            room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="inspected"),
            actor_user_id=manager.id,
        )
        readiness = is_room_assignable(room.id, business_date)
        assert readiness.is_ready is True
        assert readiness.housekeeping_status_code == "inspected"


# ---------------------------------------------------------------------------
# Room Move Effects on State
# ---------------------------------------------------------------------------


def test_cleaning_in_progress_status_in_board(app_factory):
    """cleaning_in_progress status should appear in housekeeping board."""
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        housekeeper = make_staff_user("housekeeping", "hk-cip@example.com")

        update_housekeeping_status(
            room.id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="cleaning_in_progress"),
            actor_user_id=housekeeper.id,
        )

        board = list_housekeeping_board(HousekeepingBoardFilters(business_date=business_date))
        room_item = next(item for item in board["items"] if item["room_number"] == "201")
        assert room_item["housekeeping_status_code"] == "cleaning_in_progress"


# ---------------------------------------------------------------------------
# Audit Logging Tests
# ---------------------------------------------------------------------------


def test_task_lifecycle_produces_audit_trail(app_factory):
    """Full task lifecycle should produce audit entries for each transition."""
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-audit@example.com")
        housekeeper = make_staff_user("housekeeping", "hk-audit@example.com")

        # Count audits before
        before_count = AuditLog.query.filter_by(entity_table="housekeeping_tasks").count()

        task = create_housekeeping_task(
            CreateTaskPayload(room_id=room.id, business_date=business_date),
            actor_user_id=manager.id,
        )
        assign_housekeeping_task(task.id, assigned_to_user_id=housekeeper.id, actor_user_id=manager.id)
        start_housekeeping_task(task.id, actor_user_id=housekeeper.id)
        complete_housekeeping_task(task.id, actor_user_id=housekeeper.id)
        inspect_housekeeping_task(task.id, actor_user_id=manager.id)

        after_count = AuditLog.query.filter_by(entity_table="housekeeping_tasks").count()
        assert after_count - before_count == 5  # created, assigned, started, completed, inspected


def test_room_status_change_produces_history_entry(app_factory):
    """Every housekeeping status change produces a RoomStatusHistory entry."""
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-hist@example.com")

        before_count = RoomStatusHistory.query.filter_by(room_id=room.id).count()

        update_housekeeping_status(
            room.id, business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="dirty"),
            actor_user_id=manager.id,
        )
        update_housekeeping_status(
            room.id, business_date=business_date,
            payload=RoomStatusUpdatePayload(status_code="clean"),
            actor_user_id=manager.id,
        )

        after_count = RoomStatusHistory.query.filter_by(room_id=room.id).count()
        assert after_count - before_count == 2


# ---------------------------------------------------------------------------
# Quick Action Route Tests
# ---------------------------------------------------------------------------


def login_as(client, user: User) -> None:
    with client.session_transaction() as session:
        session["staff_user_id"] = str(user.id)
        session["_csrf_token"] = "test-csrf-token"


def post_form(client, url: str, *, data: dict, follow_redirects: bool = False):
    payload = dict(data)
    payload["csrf_token"] = "test-csrf-token"
    return client.post(url, data=payload, follow_redirects=follow_redirects)


def test_quick_action_mark_dirty_route(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()
        manager = make_staff_user("manager", "mgr-qa@example.com")

        with app.test_client() as client:
            login_as(client, manager)
            resp = post_form(client, "/staff/housekeeping/quick-action", data={
                "action": "mark_dirty",
                "room_id": str(room.id),
                "business_date": business_date.isoformat(),
            })
            assert resp.status_code == 302

            inv = InventoryDay.query.filter_by(room_id=room.id, business_date=business_date).one()
            dirty_status = HousekeepingStatus.query.filter_by(code="dirty").one()
            assert inv.housekeeping_status_id == dirty_status.id


def test_quick_action_rush_clean_creates_task(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="202").one()
        manager = make_staff_user("manager", "mgr-rush@example.com")

        with app.test_client() as client:
            login_as(client, manager)
            resp = post_form(client, "/staff/housekeeping/quick-action", data={
                "action": "rush_clean",
                "room_id": str(room.id),
                "business_date": business_date.isoformat(),
            })
            assert resp.status_code == 302

            task = HousekeepingTask.query.filter_by(
                room_id=room.id,
                business_date=business_date,
                task_type="rush_clean",
            ).first()
            assert task is not None
            assert task.priority == "urgent"


def test_room_readiness_api_endpoint(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        manager = make_staff_user("manager", "mgr-api@example.com")
        business_date = date.today() + timedelta(days=1)

        with app.test_client() as client:
            login_as(client, manager)
            resp = client.get(f"/staff/api/room-readiness?date={business_date.isoformat()}")
            assert resp.status_code == 200
            data = resp.get_json()
            assert "rooms" in data
            active_count = Room.query.filter_by(is_active=True).count()
            assert len(data["rooms"]) == active_count


def test_room_readiness_single_api_endpoint(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        manager = make_staff_user("manager", "mgr-single@example.com")
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()

        with app.test_client() as client:
            login_as(client, manager)
            resp = client.get(f"/staff/api/room-readiness/{room.id}?date={business_date.isoformat()}")
            assert resp.status_code == 200
            data = resp.get_json()
            assert data["room_number"] == "201"
            assert "is_ready" in data


def test_housekeeping_tasks_api_endpoint(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        manager = make_staff_user("manager", "mgr-taskapi@example.com")
        business_date = date.today() + timedelta(days=1)
        room = Room.query.filter_by(room_number="201").one()

        create_housekeeping_task(
            CreateTaskPayload(room_id=room.id, business_date=business_date),
            actor_user_id=manager.id,
        )

        with app.test_client() as client:
            login_as(client, manager)
            resp = client.get(f"/staff/housekeeping/tasks?date={business_date.isoformat()}")
            assert resp.status_code == 200
            data = resp.get_json()
            assert len(data["tasks"]) >= 1


def test_housekeeping_mobile_board_renders_with_offline_hooks(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        manager = make_staff_user("manager", "mgr-mobilehk@example.com")
        business_date = date.today() + timedelta(days=1)

        with app.test_client() as client:
            login_as(client, manager)
            resp = client.get(f"/staff/housekeeping?date={business_date.isoformat()}&view=mobile")
            assert resp.status_code == 200
            text = resp.get_data(as_text=True)
            assert "Mobile board" in text
            assert "serviceWorker.register" in text
            assert "stay available offline" in text


def test_housekeeping_desktop_board_renders_after_template_refresh(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        manager = make_staff_user("manager", "mgr-desktophk@example.com")
        business_date = date.today() + timedelta(days=1)

        with app.test_client() as client:
            login_as(client, manager)
            resp = client.get(f"/staff/housekeeping?date={business_date.isoformat()}")
            assert resp.status_code == 200
            text = resp.get_data(as_text=True)
            assert "Housekeeping" in text
            assert "Bulk actions" in text
            assert "Today" in text


def test_housekeeping_service_worker_route_serves_cache_script(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    response = client.get("/staff/sw.js")
    assert response.status_code == 200
    assert response.mimetype == "application/javascript"
    text = response.get_data(as_text=True)
    assert "sandbox-hk-mobile-v1" in text
    assert "/staff/housekeeping" in text
