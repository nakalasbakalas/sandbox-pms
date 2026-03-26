"""Room readiness service – single source of truth for room assignability.

This service centralises the logic that decides whether a room is ready for
guest assignment.  Both the front-desk check-in flow and the housekeeping
board consume this service so that there is exactly one definition of "ready".
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date

import sqlalchemy as sa
from sqlalchemy.orm import joinedload

from ..extensions import db
from ..models import (
    HousekeepingStatus,
    HousekeepingTask,
    InventoryDay,
    Reservation,
    Room,
)


READY_HK_CODES = {"clean", "inspected"}
CLOSURE_STATUSES = {"out_of_service", "out_of_order"}


@dataclass
class RoomReadiness:
    room_id: uuid.UUID
    room_number: str
    room_type_code: str
    room_type_name: str
    floor_number: int
    is_ready: bool
    label: str
    reason: str
    housekeeping_status_code: str | None
    availability_status: str | None
    is_blocked: bool
    is_maintenance: bool
    has_active_task: bool
    active_task_status: str | None
    reservation_code: str | None


def is_room_assignable(room_id: uuid.UUID, business_date: date) -> RoomReadiness:
    """Central check: can a room be assigned to a guest for *business_date*?"""
    room = (
        db.session.execute(
            sa.select(Room)
            .options(joinedload(Room.room_type))
            .where(Room.id == room_id)
        )
        .unique()
        .scalars()
        .first()
    )
    if not room:
        raise ValueError("Room not found.")

    inv = (
        db.session.execute(
            sa.select(InventoryDay).where(
                InventoryDay.room_id == room_id,
                InventoryDay.business_date == business_date,
            )
        )
        .scalars()
        .first()
    )
    if not inv:
        return _readiness(room, None, False, "missing_inventory", "No inventory row for this date.")

    hk_code = _hk_code(inv.housekeeping_status_id)
    task = _active_task(room_id, business_date)

    if inv.is_blocked:
        return _readiness(room, inv, False, "blocked", inv.blocked_reason or "Room is blocked.", task=task)

    if inv.availability_status in CLOSURE_STATUSES:
        return _readiness(room, inv, False, inv.availability_status, "Room is operationally closed.", task=task)

    if inv.maintenance_flag:
        return _readiness(room, inv, False, "maintenance", inv.maintenance_note or "Room has a maintenance issue.", task=task)

    if inv.reservation_id is not None:
        res = db.session.get(Reservation, inv.reservation_id)
        res_code = res.reservation_code if res else None
        return _readiness(room, inv, False, "occupied", "Room is currently occupied.", task=task, reservation_code=res_code)

    if hk_code not in READY_HK_CODES:
        reason = f"Room housekeeping status is '{hk_code or 'unknown'}'."
        return _readiness(room, inv, False, "not_ready", reason, task=task)

    return _readiness(room, inv, True, "ready", "Room is ready for assignment.", task=task)


def get_assignable_rooms(room_type_id: uuid.UUID, business_date: date) -> list[RoomReadiness]:
    """Return all rooms of a given type that are ready for assignment on *business_date*."""
    rooms = (
        db.session.execute(
            sa.select(Room)
            .where(Room.room_type_id == room_type_id, Room.is_active.is_(True))
            .order_by(Room.room_number)
        )
        .scalars()
        .all()
    )
    results: list[RoomReadiness] = []
    for room in rooms:
        readiness = is_room_assignable(room.id, business_date)
        if readiness.is_ready:
            results.append(readiness)
    return results


def room_readiness_board(business_date: date) -> list[RoomReadiness]:
    """Return readiness snapshots for *every* active room on *business_date*."""
    rooms = (
        db.session.execute(
            sa.select(Room)
            .options(joinedload(Room.room_type))
            .where(Room.is_active.is_(True))
            .order_by(Room.floor_number, Room.room_number)
        )
        .unique()
        .scalars()
        .all()
    )
    inv_map = {
        row.room_id: row
        for row in db.session.execute(
            sa.select(InventoryDay).where(InventoryDay.business_date == business_date)
        )
        .scalars()
        .all()
    }
    task_map = _active_tasks_map(business_date)
    results: list[RoomReadiness] = []
    for room in rooms:
        inv = inv_map.get(room.id)
        task = task_map.get(room.id)
        if not inv:
            results.append(_readiness(room, None, False, "missing_inventory", "No inventory row.", task=task))
            continue

        hk_code = _hk_code(inv.housekeeping_status_id)

        if inv.is_blocked:
            results.append(_readiness(room, inv, False, "blocked", inv.blocked_reason or "Blocked.", task=task))
        elif inv.availability_status in CLOSURE_STATUSES:
            results.append(_readiness(room, inv, False, inv.availability_status, "Operationally closed.", task=task))
        elif inv.maintenance_flag:
            results.append(_readiness(room, inv, False, "maintenance", inv.maintenance_note or "Maintenance.", task=task))
        elif inv.reservation_id is not None:
            res = db.session.get(Reservation, inv.reservation_id)
            res_code = res.reservation_code if res else None
            results.append(_readiness(room, inv, False, "occupied", "Occupied.", task=task, reservation_code=res_code))
        elif hk_code not in READY_HK_CODES:
            results.append(_readiness(room, inv, False, "not_ready", f"Status: {hk_code or 'unknown'}.", task=task))
        else:
            results.append(_readiness(room, inv, True, "ready", "Ready.", task=task))
    return results


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _readiness(
    room: Room,
    inv: InventoryDay | None,
    ready: bool,
    label: str,
    reason: str,
    *,
    task: HousekeepingTask | None = None,
    reservation_code: str | None = None,
) -> RoomReadiness:
    return RoomReadiness(
        room_id=room.id,
        room_number=room.room_number,
        room_type_code=room.room_type.code,
        room_type_name=room.room_type.name,
        floor_number=room.floor_number,
        is_ready=ready,
        label=label,
        reason=reason,
        housekeeping_status_code=_hk_code(inv.housekeeping_status_id) if inv else None,
        availability_status=inv.availability_status if inv else None,
        is_blocked=bool(inv.is_blocked) if inv else False,
        is_maintenance=bool(inv.maintenance_flag) if inv else False,
        has_active_task=task is not None,
        active_task_status=task.status if task else None,
        reservation_code=reservation_code,
    )


def _hk_code(status_id: uuid.UUID | None) -> str | None:
    if not status_id:
        return None
    status = db.session.get(HousekeepingStatus, status_id)
    return status.code if status else None


def _active_task(room_id: uuid.UUID, business_date: date) -> HousekeepingTask | None:
    return (
        db.session.execute(
            sa.select(HousekeepingTask).where(
                HousekeepingTask.room_id == room_id,
                HousekeepingTask.business_date == business_date,
                HousekeepingTask.status.in_(["open", "assigned", "in_progress"]),
            )
            .order_by(HousekeepingTask.created_at.desc())
        )
        .scalars()
        .first()
    )


def _active_tasks_map(business_date: date) -> dict[uuid.UUID, HousekeepingTask]:
    tasks = (
        db.session.execute(
            sa.select(HousekeepingTask).where(
                HousekeepingTask.business_date == business_date,
                HousekeepingTask.status.in_(["open", "assigned", "in_progress"]),
            )
            .order_by(HousekeepingTask.created_at.desc())
        )
        .scalars()
        .all()
    )
    result: dict[uuid.UUID, HousekeepingTask] = {}
    for t in tasks:
        if t.room_id not in result:
            result[t.room_id] = t
    return result
