"""Housekeeping task lifecycle operations."""

from __future__ import annotations

from .housekeeping_base import *  # noqa: F401,F403
from . import housekeeping_board_ops as _board

_inventory_snapshot = _board._inventory_snapshot
_persist_room_history = _board._persist_room_history
_sellable_for_row = _board._sellable_for_row

# ---------------------------------------------------------------------------
# Housekeeping Task Management
# ---------------------------------------------------------------------------

ACTIVE_TASK_STATUSES = {"open", "assigned", "in_progress"}
VALID_TASK_TYPES = {"checkout_clean", "daily_service", "rush_clean", "deep_clean", "inspection", "turndown"}
VALID_TASK_PRIORITIES = {"low", "normal", "high", "urgent"}


@dataclass
class CreateTaskPayload:
    room_id: uuid.UUID
    business_date: date
    task_type: str = "checkout_clean"
    priority: str = "normal"
    notes: str | None = None
    assigned_to_user_id: uuid.UUID | None = None
    reservation_id: uuid.UUID | None = None
    due_at: datetime | None = None


@dataclass
class TaskListFilters:
    business_date: date
    status: str = ""
    room_id: str = ""
    assigned_to_user_id: str = ""
    task_type: str = ""
    priority: str = ""


def create_housekeeping_task(
    payload: CreateTaskPayload,
    *,
    actor_user_id: uuid.UUID,
    commit: bool = True,
) -> HousekeepingTask:
    """Create a new housekeeping task for a room."""
    if payload.task_type not in VALID_TASK_TYPES:
        raise ValueError(f"Invalid task type: {payload.task_type}")
    if payload.priority not in VALID_TASK_PRIORITIES:
        raise ValueError(f"Invalid priority: {payload.priority}")

    room = db.session.get(Room, payload.room_id)
    if not room:
        raise ValueError("Room not found.")

    initial_status = "assigned" if payload.assigned_to_user_id else "open"

    task = HousekeepingTask(
        room_id=payload.room_id,
        reservation_id=payload.reservation_id,
        task_type=payload.task_type,
        priority=payload.priority,
        status=initial_status,
        assigned_to_user_id=payload.assigned_to_user_id,
        due_at=payload.due_at,
        notes=clean_optional(payload.notes, limit=2000),
        business_date=payload.business_date,
        created_by_user_id=actor_user_id,
    )
    db.session.add(task)

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="housekeeping_tasks",
        entity_id=str(task.id),
        action="housekeeping_task_created",
        after_data=_task_snapshot(task),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="housekeeping.task_created",
        entity_table="housekeeping_tasks",
        entity_id=str(task.id),
        metadata={
            "room_id": str(payload.room_id),
            "task_type": payload.task_type,
            "priority": payload.priority,
            "business_date": payload.business_date.isoformat(),
        },
    )

    if commit:
        db.session.commit()
    return task


def assign_housekeeping_task(
    task_id: uuid.UUID,
    *,
    assigned_to_user_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    commit: bool = True,
) -> HousekeepingTask:
    """Assign or reassign a task to a housekeeper."""
    task = db.session.get(HousekeepingTask, task_id)
    if not task:
        raise ValueError("Task not found.")
    if task.status in {"completed", "inspected", "cancelled"}:
        raise ValueError("Cannot assign a finished task.")

    before = _task_snapshot(task)
    task.assigned_to_user_id = assigned_to_user_id
    if task.status == "open":
        task.status = "assigned"
    task.updated_by_user_id = actor_user_id

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="housekeeping_tasks",
        entity_id=str(task.id),
        action="housekeeping_task_assigned",
        before_data=before,
        after_data=_task_snapshot(task),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="housekeeping.task_assigned",
        entity_table="housekeeping_tasks",
        entity_id=str(task.id),
        metadata={"room_id": str(task.room_id), "assigned_to": str(assigned_to_user_id)},
    )

    if commit:
        db.session.commit()
    return task


def start_housekeeping_task(
    task_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID,
    commit: bool = True,
) -> HousekeepingTask:
    """Mark a task as in-progress and set room to cleaning_in_progress."""
    task = db.session.get(HousekeepingTask, task_id)
    if not task:
        raise ValueError("Task not found.")
    if task.status not in {"open", "assigned"}:
        raise ValueError("Only open or assigned tasks can be started.")

    before = _task_snapshot(task)
    task.status = "in_progress"
    task.started_at = utc_now()
    if not task.assigned_to_user_id:
        task.assigned_to_user_id = actor_user_id
    task.updated_by_user_id = actor_user_id

    # Transition room housekeeping status to cleaning_in_progress
    cip_status = (
        db.session.execute(
            sa.select(HousekeepingStatus).where(HousekeepingStatus.code == "cleaning_in_progress")
        )
        .scalars()
        .first()
    )
    if cip_status:
        inv = (
            db.session.execute(
                sa.select(InventoryDay).where(
                    InventoryDay.room_id == task.room_id,
                    InventoryDay.business_date == task.business_date,
                )
            )
            .scalars()
            .first()
        )
        if inv and inv.availability_status not in CLOSURE_STATUS_CODES:
            inv_before = _inventory_snapshot(inv)
            inv.housekeeping_status_id = cip_status.id
            inv.is_sellable = False
            _persist_room_history(
                row=inv,
                before=inv_before,
                actor_user_id=actor_user_id,
                event_type="task_started",
                note=f"Cleaning task started (task type: {task.task_type})",
            )

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="housekeeping_tasks",
        entity_id=str(task.id),
        action="housekeeping_task_started",
        before_data=before,
        after_data=_task_snapshot(task),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="housekeeping.task_started",
        entity_table="housekeeping_tasks",
        entity_id=str(task.id),
        metadata={"room_id": str(task.room_id)},
    )

    if commit:
        db.session.commit()
    return task


def complete_housekeeping_task(
    task_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID,
    notes: str | None = None,
    commit: bool = True,
) -> HousekeepingTask:
    """Mark a task as completed and set room to clean."""
    task = db.session.get(HousekeepingTask, task_id)
    if not task:
        raise ValueError("Task not found.")
    if task.status not in {"open", "assigned", "in_progress"}:
        raise ValueError("Only active tasks can be completed.")

    before = _task_snapshot(task)
    task.status = "completed"
    task.completed_at = utc_now()
    task.started_at = task.started_at or utc_now()
    if notes:
        task.notes = (task.notes + "\n" + notes if task.notes else notes)[:2000]
    task.updated_by_user_id = actor_user_id

    # Transition room to clean
    clean_status = (
        db.session.execute(sa.select(HousekeepingStatus).where(HousekeepingStatus.code == "clean"))
        .scalars()
        .first()
    )
    if clean_status:
        inv = (
            db.session.execute(
                sa.select(InventoryDay).where(
                    InventoryDay.room_id == task.room_id,
                    InventoryDay.business_date == task.business_date,
                )
            )
            .scalars()
            .first()
        )
        if inv and inv.availability_status not in CLOSURE_STATUS_CODES and not inv.is_blocked:
            inv_before = _inventory_snapshot(inv)
            inv.housekeeping_status_id = clean_status.id
            inv.cleaned_at = utc_now()
            inv.is_sellable = _sellable_for_row(inv, "clean")
            _persist_room_history(
                row=inv,
                before=inv_before,
                actor_user_id=actor_user_id,
                event_type="task_completed",
                note=f"Cleaning task completed (task type: {task.task_type})",
            )

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="housekeeping_tasks",
        entity_id=str(task.id),
        action="housekeeping_task_completed",
        before_data=before,
        after_data=_task_snapshot(task),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="housekeeping.task_completed",
        entity_table="housekeeping_tasks",
        entity_id=str(task.id),
        metadata={"room_id": str(task.room_id)},
    )

    if commit:
        db.session.commit()
    return task


def inspect_housekeeping_task(
    task_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID,
    notes: str | None = None,
    commit: bool = True,
) -> HousekeepingTask:
    """Mark a completed task as inspected and set room to inspected."""
    task = db.session.get(HousekeepingTask, task_id)
    if not task:
        raise ValueError("Task not found.")
    if task.status != "completed":
        raise ValueError("Only completed tasks can be inspected.")

    before = _task_snapshot(task)
    task.status = "inspected"
    task.verified_by_user_id = actor_user_id
    task.verified_at = utc_now()
    if notes:
        task.notes = (task.notes + "\n" + notes if task.notes else notes)[:2000]
    task.updated_by_user_id = actor_user_id

    # Transition room to inspected
    inspected_status = (
        db.session.execute(sa.select(HousekeepingStatus).where(HousekeepingStatus.code == "inspected"))
        .scalars()
        .first()
    )
    if inspected_status:
        inv = (
            db.session.execute(
                sa.select(InventoryDay).where(
                    InventoryDay.room_id == task.room_id,
                    InventoryDay.business_date == task.business_date,
                )
            )
            .scalars()
            .first()
        )
        if inv and inv.availability_status not in CLOSURE_STATUS_CODES and not inv.is_blocked:
            inv_before = _inventory_snapshot(inv)
            inv.housekeeping_status_id = inspected_status.id
            inv.cleaned_at = inv.cleaned_at or utc_now()
            inv.inspected_at = utc_now()
            inv.is_sellable = _sellable_for_row(inv, "inspected")
            _persist_room_history(
                row=inv,
                before=inv_before,
                actor_user_id=actor_user_id,
                event_type="task_inspected",
                note=f"Inspection passed (task type: {task.task_type})",
            )

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="housekeeping_tasks",
        entity_id=str(task.id),
        action="housekeeping_task_inspected",
        before_data=before,
        after_data=_task_snapshot(task),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="housekeeping.task_inspected",
        entity_table="housekeeping_tasks",
        entity_id=str(task.id),
        metadata={"room_id": str(task.room_id)},
    )

    if commit:
        db.session.commit()
    return task


def cancel_housekeeping_task(
    task_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID,
    reason: str | None = None,
    commit: bool = True,
) -> HousekeepingTask:
    """Cancel an active task."""
    task = db.session.get(HousekeepingTask, task_id)
    if not task:
        raise ValueError("Task not found.")
    if task.status in {"completed", "inspected", "cancelled"}:
        raise ValueError("Cannot cancel a finished task.")

    before = _task_snapshot(task)
    task.status = "cancelled"
    if reason:
        task.notes = (task.notes + "\n" + reason if task.notes else reason)[:2000]
    task.updated_by_user_id = actor_user_id

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="housekeeping_tasks",
        entity_id=str(task.id),
        action="housekeeping_task_cancelled",
        before_data=before,
        after_data=_task_snapshot(task),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="housekeeping.task_cancelled",
        entity_table="housekeeping_tasks",
        entity_id=str(task.id),
        metadata={"room_id": str(task.room_id), "reason": reason or ""},
    )

    if commit:
        db.session.commit()
    return task


def list_housekeeping_tasks(filters: TaskListFilters) -> list[dict]:
    """Return housekeeping tasks matching the provided filters."""
    query = (
        sa.select(HousekeepingTask)
        .options(
            joinedload(HousekeepingTask.room),
            joinedload(HousekeepingTask.assigned_to_user),
            joinedload(HousekeepingTask.verified_by_user),
        )
        .where(HousekeepingTask.business_date == filters.business_date)
    )
    if filters.status:
        query = query.where(HousekeepingTask.status == filters.status)
    if filters.room_id:
        query = query.where(HousekeepingTask.room_id == filters.room_id)
    if filters.assigned_to_user_id:
        query = query.where(HousekeepingTask.assigned_to_user_id == filters.assigned_to_user_id)
    if filters.task_type:
        query = query.where(HousekeepingTask.task_type == filters.task_type)
    if filters.priority:
        query = query.where(HousekeepingTask.priority == filters.priority)

    tasks = (
        db.session.execute(
            query.order_by(
                sa.case(
                    (HousekeepingTask.priority == "urgent", 0),
                    (HousekeepingTask.priority == "high", 1),
                    (HousekeepingTask.priority == "normal", 2),
                    (HousekeepingTask.priority == "low", 3),
                    else_=4,
                ),
                HousekeepingTask.created_at.asc(),
            )
        )
        .unique()
        .scalars()
        .all()
    )

    return [_task_to_dict(t) for t in tasks]


def create_departure_turnover_task(
    room_id: uuid.UUID,
    business_date: date,
    *,
    reservation_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID,
    priority: str = "normal",
    commit: bool = True,
) -> HousekeepingTask:
    """Create a checkout/departure cleaning task for a room.

    Called automatically by the checkout handoff flow. If an active task
    already exists for this room+date, it is returned instead of creating
    a duplicate.
    """
    existing = (
        db.session.execute(
            sa.select(HousekeepingTask).where(
                HousekeepingTask.room_id == room_id,
                HousekeepingTask.business_date == business_date,
                HousekeepingTask.task_type == "checkout_clean",
                HousekeepingTask.status.in_(list(ACTIVE_TASK_STATUSES)),
            )
        )
        .scalars()
        .first()
    )
    if existing:
        return existing

    # Check if there's an incoming arrival that needs the room — bump priority
    arrival = (
        db.session.execute(
            sa.select(Reservation).where(
                Reservation.assigned_room_id == room_id,
                Reservation.check_in_date == business_date,
                Reservation.current_status.in_(["tentative", "confirmed"]),
            )
        )
        .scalars()
        .first()
    )
    if arrival:
        priority = "urgent"

    return create_housekeeping_task(
        CreateTaskPayload(
            room_id=room_id,
            business_date=business_date,
            task_type="checkout_clean",
            priority=priority,
            reservation_id=reservation_id,
            notes="Auto-created after guest checkout",
        ),
        actor_user_id=actor_user_id,
        commit=commit,
    )


def _task_snapshot(task: HousekeepingTask) -> dict:
    return {
        "task_id": str(task.id),
        "room_id": str(task.room_id),
        "reservation_id": str(task.reservation_id) if task.reservation_id else None,
        "task_type": task.task_type,
        "priority": task.priority,
        "status": task.status,
        "assigned_to_user_id": str(task.assigned_to_user_id) if task.assigned_to_user_id else None,
        "business_date": task.business_date.isoformat(),
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "verified_at": task.verified_at.isoformat() if task.verified_at else None,
    }


def _task_to_dict(task: HousekeepingTask) -> dict:
    return {
        "id": str(task.id),
        "room_id": str(task.room_id),
        "room_number": task.room.room_number if task.room else None,
        "reservation_id": str(task.reservation_id) if task.reservation_id else None,
        "task_type": task.task_type,
        "priority": task.priority,
        "status": task.status,
        "assigned_to_user_id": str(task.assigned_to_user_id) if task.assigned_to_user_id else None,
        "assigned_to_name": task.assigned_to_user.full_name if task.assigned_to_user else None,
        "due_at": task.due_at.isoformat() if task.due_at else None,
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "verified_by_name": task.verified_by_user.full_name if task.verified_by_user else None,
        "verified_at": task.verified_at.isoformat() if task.verified_at else None,
        "notes": task.notes,
        "business_date": task.business_date.isoformat(),
        "created_at": task.created_at.isoformat() if task.created_at else None,
    }
