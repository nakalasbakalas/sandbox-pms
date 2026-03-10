from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone

import sqlalchemy as sa
from sqlalchemy.orm import joinedload

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..extensions import db
from ..models import (
    ActivityLog,
    AuditLog,
    HousekeepingStatus,
    InventoryDay,
    Reservation,
    Room,
    RoomNote,
    RoomStatusHistory,
    RoomType,
    User,
)
from .staff_reservations_service import clean_optional


READY_HOUSEKEEPING_CODES = {"clean", "inspected"}
OPERABLE_HOUSEKEEPING_CODES = {
    "dirty",
    "clean",
    "inspected",
    "pickup",
    "occupied_clean",
    "occupied_dirty",
    "do_not_disturb",
    "sleep",
    "out_of_service",
    "out_of_order",
}
CLOSURE_STATUS_CODES = {"out_of_order", "out_of_service"}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class HousekeepingBoardFilters:
    business_date: date
    floor: str = ""
    status: str = ""
    priority: str = ""
    room_type_id: str = ""
    arrival_today: str = ""
    departure_today: str = ""
    blocked: str = ""
    maintenance: str = ""
    notes: str = ""
    mobile: bool = False


@dataclass
class RoomStatusUpdatePayload:
    status_code: str
    note: str | None = None


@dataclass
class RoomNotePayload:
    note_text: str
    note_type: str = "housekeeping"
    is_important: bool = False
    visibility_scope: str = "all_staff"


@dataclass
class MaintenanceFlagPayload:
    enabled: bool
    note: str | None = None


@dataclass
class BlockRoomPayload:
    blocked: bool
    reason: str | None = None
    blocked_until: datetime | None = None


@dataclass
class BulkHousekeepingPayload:
    room_ids: list[uuid.UUID]
    business_date: date
    action: str
    status_code: str | None = None
    note: str | None = None
    room_note_type: str = "housekeeping"
    is_important: bool = False
    blocked_until: datetime | None = None


def list_housekeeping_board(filters: HousekeepingBoardFilters, *, actor_user: User | None = None) -> dict:
    rooms = Room.query.options(joinedload(Room.room_type)).order_by(Room.floor_number.asc(), Room.room_number.asc()).all()
    inventory_rows = {
        row.room_id: row
        for row in InventoryDay.query.filter_by(business_date=filters.business_date).all()
    }
    note_counts = {
        room_id: count
        for room_id, count in db.session.query(RoomNote.room_id, sa.func.count(RoomNote.id))
        .filter(
            sa.or_(RoomNote.business_date.is_(None), RoomNote.business_date == filters.business_date)
        )
        .group_by(RoomNote.room_id)
        .all()
    }
    arrival_by_room, departure_by_room, in_house_by_room, arrival_pressure = _reservation_context(filters.business_date)

    items = [
        _room_board_summary(
            room=room,
            inventory_row=inventory_rows.get(room.id),
            business_date=filters.business_date,
            arrival=arrival_by_room.get(room.id),
            departure=departure_by_room.get(room.id),
            in_house=in_house_by_room.get(room.id),
            room_type_arrival_pressure=arrival_pressure.get(room.room_type_id, 0),
            note_count=note_counts.get(room.id, 0),
            actor_user=actor_user,
        )
        for room in rooms
    ]
    items = _apply_board_filters(items, filters)
    items.sort(key=_board_sort_key)
    counts = {
        "dirty": sum(1 for item in items if item["housekeeping_status_code"] == "dirty"),
        "clean": sum(1 for item in items if item["housekeeping_status_code"] == "clean"),
        "inspected": sum(1 for item in items if item["housekeeping_status_code"] == "inspected"),
        "blocked": sum(1 for item in items if item["is_blocked"]),
        "maintenance": sum(1 for item in items if item["maintenance_flag"]),
        "out_of_order": sum(1 for item in items if item["availability_status"] == "out_of_order"),
    }
    return {
        "business_date": filters.business_date,
        "items": items,
        "counts": counts,
    }


def get_housekeeping_room_detail(
    room_id: uuid.UUID,
    *,
    business_date: date,
    actor_user: User | None = None,
) -> dict:
    room = Room.query.options(joinedload(Room.room_type)).filter_by(id=room_id).first()
    if not room:
        raise ValueError("Room not found.")
    inventory_row = InventoryDay.query.filter_by(room_id=room.id, business_date=business_date).first()
    if not inventory_row:
        raise ValueError("Inventory row not found for the selected day.")
    arrival_by_room, departure_by_room, in_house_by_room, arrival_pressure = _reservation_context(business_date)
    summary = _room_board_summary(
        room=room,
        inventory_row=inventory_row,
        business_date=business_date,
        arrival=arrival_by_room.get(room.id),
        departure=departure_by_room.get(room.id),
        in_house=in_house_by_room.get(room.id),
        room_type_arrival_pressure=arrival_pressure.get(room.room_type_id, 0),
        note_count=None,
        actor_user=actor_user,
    )
    notes = (
        RoomNote.query.options(joinedload(RoomNote.created_by_user)).filter(
            RoomNote.room_id == room.id,
            sa.or_(RoomNote.business_date.is_(None), RoomNote.business_date == business_date),
        )
        .order_by(RoomNote.created_at.desc())
        .all()
    )
    history = (
        RoomStatusHistory.query.options(
            joinedload(RoomStatusHistory.changed_by_user),
            joinedload(RoomStatusHistory.previous_housekeeping_status),
            joinedload(RoomStatusHistory.new_housekeeping_status),
        )
        .filter_by(room_id=room.id, business_date=business_date)
        .order_by(RoomStatusHistory.changed_at.desc())
        .all()
    )
    activities = (
        ActivityLog.query.filter(
            ActivityLog.entity_table == "inventory_days",
            ActivityLog.entity_id == str(inventory_row.id),
        )
        .order_by(ActivityLog.created_at.desc())
        .limit(20)
        .all()
    )
    audits = (
        AuditLog.query.filter(
            AuditLog.entity_table == "inventory_days",
            AuditLog.entity_id == str(inventory_row.id),
        )
        .order_by(AuditLog.created_at.desc())
        .limit(20)
        .all()
    )
    return {
        "room": room,
        "inventory": inventory_row,
        "summary": summary,
        "notes": notes,
        "history": history,
        "activities": activities,
        "audits": audits,
    }


def update_housekeeping_status(
    room_id: uuid.UUID,
    *,
    business_date: date,
    payload: RoomStatusUpdatePayload,
    actor_user_id: uuid.UUID,
    commit: bool = True,
) -> InventoryDay:
    actor = db.session.get(User, actor_user_id)
    row = _load_inventory_row_for_update(room_id, business_date)
    status = _status_by_code(payload.status_code)
    if payload.status_code not in OPERABLE_HOUSEKEEPING_CODES:
        raise ValueError("Unsupported housekeeping status.")
    if payload.status_code in CLOSURE_STATUS_CODES or row.availability_status in CLOSURE_STATUS_CODES:
        _require_override(actor)

    before = _inventory_snapshot(row)
    row.housekeeping_status_id = status.id
    if payload.status_code in CLOSURE_STATUS_CODES:
        row.availability_status = payload.status_code
        row.is_blocked = False
        row.blocked_reason = None
        row.blocked_at = None
        row.blocked_until = None
        row.blocked_by_user_id = None
    elif row.availability_status in CLOSURE_STATUS_CODES and row.reservation_id is None:
        row.availability_status = "available"

    if payload.status_code == "clean":
        row.cleaned_at = utc_now()
    elif payload.status_code == "inspected":
        row.cleaned_at = row.cleaned_at or utc_now()
        row.inspected_at = utc_now()
    elif payload.status_code == "dirty":
        row.inspected_at = None

    row.is_sellable = _sellable_for_row(row, status.code)
    _persist_room_history(
        row=row,
        before=before,
        actor_user_id=actor_user_id,
        event_type="status_changed",
        note=clean_optional(payload.note, limit=500),
    )
    if payload.note:
        _create_room_note(
            room_id=room_id,
            business_date=business_date,
            payload=RoomNotePayload(note_text=payload.note),
            actor_user_id=actor_user_id,
        )
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="inventory_days",
        entity_id=str(row.id),
        action="housekeeping_status_changed",
        before_data=before,
        after_data=_inventory_snapshot(row),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="housekeeping.status_changed",
        entity_table="inventory_days",
        entity_id=str(row.id),
        metadata={"room_id": str(room_id), "status_code": status.code, "business_date": business_date.isoformat()},
    )
    if commit:
        db.session.commit()
    return row


def add_room_note(
    room_id: uuid.UUID,
    *,
    business_date: date,
    payload: RoomNotePayload,
    actor_user_id: uuid.UUID,
    commit: bool = True,
) -> RoomNote:
    note = _create_room_note(room_id=room_id, business_date=business_date, payload=payload, actor_user_id=actor_user_id)
    if commit:
        db.session.commit()
    return note


def set_maintenance_flag(
    room_id: uuid.UUID,
    *,
    business_date: date,
    payload: MaintenanceFlagPayload,
    actor_user_id: uuid.UUID,
    commit: bool = True,
) -> InventoryDay:
    row = _load_inventory_row_for_update(room_id, business_date)
    before = _inventory_snapshot(row)
    row.maintenance_flag = bool(payload.enabled)
    row.maintenance_note = clean_optional(payload.note, limit=255) if payload.enabled else None
    row.maintenance_flagged_at = utc_now() if payload.enabled else None
    row.maintenance_flagged_by_user_id = actor_user_id if payload.enabled else None
    _persist_room_history(
        row=row,
        before=before,
        actor_user_id=actor_user_id,
        event_type="maintenance_flagged" if payload.enabled else "maintenance_cleared",
        note=clean_optional(payload.note, limit=500),
    )
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="inventory_days",
        entity_id=str(row.id),
        action="housekeeping_maintenance_changed",
        before_data=before,
        after_data=_inventory_snapshot(row),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="housekeeping.maintenance_changed",
        entity_table="inventory_days",
        entity_id=str(row.id),
        metadata={"room_id": str(room_id), "enabled": payload.enabled, "business_date": business_date.isoformat()},
    )
    if payload.note:
        _create_room_note(
            room_id=room_id,
            business_date=business_date,
            payload=RoomNotePayload(note_text=payload.note, note_type="maintenance", is_important=payload.enabled),
            actor_user_id=actor_user_id,
        )
    if commit:
        db.session.commit()
    return row


def set_blocked_state(
    room_id: uuid.UUID,
    *,
    business_date: date,
    payload: BlockRoomPayload,
    actor_user_id: uuid.UUID,
    commit: bool = True,
) -> InventoryDay:
    actor = db.session.get(User, actor_user_id)
    _require_override(actor)
    row = _load_inventory_row_for_update(room_id, business_date)
    before = _inventory_snapshot(row)
    if payload.blocked:
        if row.reservation_id is not None or row.availability_status in {"occupied", "reserved", "house_use", "held"}:
            raise ValueError("Only currently unallocated rooms can be blocked.")
        reason = clean_optional(payload.reason, limit=255)
        if not reason:
            raise ValueError("A blocked-room reason is required.")
        row.is_blocked = True
        row.blocked_reason = reason
        row.blocked_at = utc_now()
        row.blocked_until = payload.blocked_until
        row.blocked_by_user_id = actor_user_id
        row.is_sellable = False
    else:
        row.is_blocked = False
        row.blocked_reason = None
        row.blocked_at = None
        row.blocked_until = None
        row.blocked_by_user_id = None
        row.is_sellable = _sellable_for_row(row, _housekeeping_code(row.housekeeping_status_id))
    _persist_room_history(
        row=row,
        before=before,
        actor_user_id=actor_user_id,
        event_type="blocked" if payload.blocked else "unblocked",
        note=clean_optional(payload.reason, limit=500),
    )
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="inventory_days",
        entity_id=str(row.id),
        action="housekeeping_block_changed",
        before_data=before,
        after_data=_inventory_snapshot(row),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="housekeeping.block_changed",
        entity_table="inventory_days",
        entity_id=str(row.id),
        metadata={"room_id": str(room_id), "blocked": payload.blocked, "business_date": business_date.isoformat()},
    )
    if commit:
        db.session.commit()
    return row


def bulk_update_housekeeping(payload: BulkHousekeepingPayload, *, actor_user_id: uuid.UUID) -> dict:
    if not payload.room_ids:
        raise ValueError("Select at least one room for a bulk housekeeping update.")
    results: list[dict] = []
    successes = 0
    for room_id in payload.room_ids:
        try:
            with db.session.begin_nested():
                if payload.action == "set_status":
                    update_housekeeping_status(
                        room_id,
                        business_date=payload.business_date,
                        payload=RoomStatusUpdatePayload(status_code=payload.status_code or "", note=payload.note),
                        actor_user_id=actor_user_id,
                        commit=False,
                    )
                elif payload.action == "add_note":
                    add_room_note(
                        room_id,
                        business_date=payload.business_date,
                        payload=RoomNotePayload(
                            note_text=payload.note or "",
                            note_type=payload.room_note_type,
                            is_important=payload.is_important,
                        ),
                        actor_user_id=actor_user_id,
                        commit=False,
                    )
                elif payload.action == "maintenance_on":
                    set_maintenance_flag(
                        room_id,
                        business_date=payload.business_date,
                        payload=MaintenanceFlagPayload(enabled=True, note=payload.note),
                        actor_user_id=actor_user_id,
                        commit=False,
                    )
                elif payload.action == "maintenance_off":
                    set_maintenance_flag(
                        room_id,
                        business_date=payload.business_date,
                        payload=MaintenanceFlagPayload(enabled=False, note=payload.note),
                        actor_user_id=actor_user_id,
                        commit=False,
                    )
                elif payload.action == "block":
                    set_blocked_state(
                        room_id,
                        business_date=payload.business_date,
                        payload=BlockRoomPayload(blocked=True, reason=payload.note, blocked_until=payload.blocked_until),
                        actor_user_id=actor_user_id,
                        commit=False,
                    )
                elif payload.action == "unblock":
                    set_blocked_state(
                        room_id,
                        business_date=payload.business_date,
                        payload=BlockRoomPayload(blocked=False),
                        actor_user_id=actor_user_id,
                        commit=False,
                    )
                else:
                    raise ValueError("Unsupported bulk housekeeping action.")
            results.append({"room_id": str(room_id), "success": True})
            successes += 1
        except Exception as exc:  # noqa: BLE001
            results.append({"room_id": str(room_id), "success": False, "error": str(exc)})
    if successes:
        db.session.commit()
    else:
        db.session.rollback()
    return {"results": results, "success_count": successes, "failure_count": len(results) - successes}


def _reservation_context(business_date: date) -> tuple[dict, dict, dict, dict]:
    arrivals = (
        Reservation.query.options(joinedload(Reservation.primary_guest))
        .filter(
            Reservation.check_in_date == business_date,
            Reservation.current_status.in_(["tentative", "confirmed"]),
        )
        .all()
    )
    departures = (
        Reservation.query.options(joinedload(Reservation.primary_guest))
        .filter(
            Reservation.check_out_date == business_date,
            Reservation.current_status == "checked_in",
        )
        .all()
    )
    in_house = (
        Reservation.query.options(joinedload(Reservation.primary_guest))
        .filter(
            Reservation.current_status == "checked_in",
            Reservation.check_in_date <= business_date,
            Reservation.check_out_date > business_date,
        )
        .all()
    )
    arrival_by_room = {item.assigned_room_id: item for item in arrivals if item.assigned_room_id}
    departure_by_room = {item.assigned_room_id: item for item in departures if item.assigned_room_id}
    in_house_by_room = {item.assigned_room_id: item for item in in_house if item.assigned_room_id}
    arrival_pressure: dict[uuid.UUID, int] = {}
    for item in arrivals:
        arrival_pressure[item.room_type_id] = arrival_pressure.get(item.room_type_id, 0) + 1
    return arrival_by_room, departure_by_room, in_house_by_room, arrival_pressure


def _room_board_summary(
    *,
    room: Room,
    inventory_row: InventoryDay | None,
    business_date: date,
    arrival: Reservation | None,
    departure: Reservation | None,
    in_house: Reservation | None,
    room_type_arrival_pressure: int,
    note_count: int | None,
    actor_user: User | None,
) -> dict:
    status_code = _housekeeping_code(inventory_row.housekeeping_status_id) if inventory_row else None
    operational_state = _operational_state(inventory_row)
    priority = _priority_for_room(
        inventory_row=inventory_row,
        arrival=arrival,
        departure=departure,
        in_house=in_house,
        room_type_arrival_pressure=room_type_arrival_pressure,
    )
    reservation_code = arrival.reservation_code if arrival else departure.reservation_code if departure else in_house.reservation_code if in_house else None
    guest_name = None
    if actor_user and actor_user.primary_role != "housekeeping":
        guest = arrival.primary_guest if arrival else departure.primary_guest if departure else in_house.primary_guest if in_house else None
        guest_name = guest.full_name if guest else None
    return {
        "room_id": room.id,
        "room_number": room.room_number,
        "floor_number": room.floor_number,
        "room_type_id": str(room.room_type_id),
        "room_type_code": room.room_type.code,
        "room_type_name": room.room_type.name,
        "business_date": business_date,
        "housekeeping_status_code": status_code,
        "availability_status": inventory_row.availability_status if inventory_row else None,
        "operational_state": operational_state,
        "is_sellable": bool(inventory_row.is_sellable) if inventory_row else room.is_sellable,
        "is_blocked": bool(inventory_row.is_blocked) if inventory_row else False,
        "blocked_reason": inventory_row.blocked_reason if inventory_row else None,
        "maintenance_flag": bool(inventory_row.maintenance_flag) if inventory_row else False,
        "maintenance_note": inventory_row.maintenance_note if inventory_row else None,
        "arrival_today": arrival is not None,
        "departure_today": departure is not None,
        "in_house": in_house is not None,
        "priority": priority["code"],
        "priority_label": priority["label"],
        "priority_reason": priority["reason"],
        "reservation_code": reservation_code,
        "guest_name": guest_name,
        "last_updated_at": inventory_row.updated_at if inventory_row else None,
        "note_count": note_count if note_count is not None else RoomNote.query.filter(
            RoomNote.room_id == room.id,
            sa.or_(RoomNote.business_date.is_(None), RoomNote.business_date == business_date),
        ).count(),
        "cleaned_at": inventory_row.cleaned_at if inventory_row else None,
        "inspected_at": inventory_row.inspected_at if inventory_row else None,
    }


def _apply_board_filters(items: list[dict], filters: HousekeepingBoardFilters) -> list[dict]:
    filtered = items
    if filters.floor:
        filtered = [item for item in filtered if str(item["floor_number"]) == str(filters.floor)]
    if filters.status:
        filtered = [item for item in filtered if item["housekeeping_status_code"] == filters.status]
    if filters.priority:
        filtered = [item for item in filtered if item["priority"] == filters.priority]
    if filters.room_type_id:
        filtered = [item for item in filtered if item["room_type_id"] == filters.room_type_id]
    if filters.arrival_today == "1":
        filtered = [item for item in filtered if item["arrival_today"]]
    if filters.departure_today == "1":
        filtered = [item for item in filtered if item["departure_today"]]
    if filters.blocked == "1":
        filtered = [item for item in filtered if item["is_blocked"]]
    if filters.maintenance == "1":
        filtered = [item for item in filtered if item["maintenance_flag"]]
    if filters.notes == "1":
        filtered = [item for item in filtered if item["note_count"] > 0]
    return filtered


def _board_sort_key(item: dict) -> tuple:
    priority_rank = {"urgent": 0, "high": 1, "normal": 2, "blocked": 3}.get(item["priority"], 9)
    status_rank = {"dirty": 0, "pickup": 1, "clean": 2, "inspected": 3}.get(item["housekeeping_status_code"], 9)
    return (priority_rank, item["floor_number"], status_rank, item["room_number"])


def _priority_for_room(
    *,
    inventory_row: InventoryDay | None,
    arrival: Reservation | None,
    departure: Reservation | None,
    in_house: Reservation | None,
    room_type_arrival_pressure: int,
) -> dict:
    if not inventory_row:
        return {"code": "blocked", "label": "Blocked", "reason": "Inventory row is missing."}
    if inventory_row.availability_status in CLOSURE_STATUS_CODES or inventory_row.is_blocked:
        return {"code": "blocked", "label": "Blocked", "reason": "Room is blocked or operationally closed."}
    status_code = _housekeeping_code(inventory_row.housekeeping_status_id)
    if departure and status_code in {"dirty", "pickup"}:
        return {"code": "urgent", "label": "Urgent", "reason": "Departure room must be turned for the day."}
    if arrival and status_code in {"dirty", "pickup"}:
        return {"code": "urgent", "label": "Urgent", "reason": "Assigned arrival room is not ready."}
    if status_code in {"dirty", "pickup"} and room_type_arrival_pressure > 0:
        return {"code": "high", "label": "High", "reason": "Arrival demand exists for this room type today."}
    if arrival and status_code in READY_HOUSEKEEPING_CODES:
        return {"code": "high", "label": "High", "reason": "Arrival-ready room should be protected for check-in."}
    if in_house and status_code == "occupied_dirty":
        return {"code": "normal", "label": "Normal", "reason": "In-house room awaits regular service."}
    return {"code": "normal", "label": "Normal", "reason": "No immediate arrival or departure risk."}


def _operational_state(inventory_row: InventoryDay | None) -> str:
    if not inventory_row:
        return "missing_inventory"
    if inventory_row.availability_status in CLOSURE_STATUS_CODES:
        return inventory_row.availability_status
    if inventory_row.is_blocked:
        return "blocked"
    if inventory_row.maintenance_flag:
        return "maintenance_flagged"
    if inventory_row.is_sellable:
        return "sellable"
    return "not_ready"


def _load_inventory_row_for_update(room_id: uuid.UUID, business_date: date) -> InventoryDay:
    row = (
        db.session.execute(
            sa.select(InventoryDay)
            .where(InventoryDay.room_id == room_id, InventoryDay.business_date == business_date)
            .with_for_update()
        )
        .scalars()
        .first()
    )
    if not row:
        raise ValueError("Inventory row not found for the selected room/date.")
    return row


def _status_by_code(code: str) -> HousekeepingStatus:
    status = HousekeepingStatus.query.filter_by(code=code).first()
    if not status:
        raise ValueError("Unknown housekeeping status.")
    return status


def _inventory_snapshot(row: InventoryDay) -> dict:
    return {
        "inventory_day_id": str(row.id),
        "room_id": str(row.room_id),
        "business_date": row.business_date.isoformat(),
        "housekeeping_status_code": _housekeeping_code(row.housekeeping_status_id),
        "availability_status": row.availability_status,
        "is_sellable": row.is_sellable,
        "is_blocked": row.is_blocked,
        "blocked_reason": row.blocked_reason,
        "maintenance_flag": row.maintenance_flag,
        "maintenance_note": row.maintenance_note,
        "cleaned_at": row.cleaned_at.isoformat() if row.cleaned_at else None,
        "inspected_at": row.inspected_at.isoformat() if row.inspected_at else None,
    }


def _persist_room_history(
    *,
    row: InventoryDay,
    before: dict,
    actor_user_id: uuid.UUID,
    event_type: str,
    note: str | None,
) -> None:
    db.session.add(
        RoomStatusHistory(
            room_id=row.room_id,
            inventory_day_id=row.id,
            business_date=row.business_date,
            previous_housekeeping_status_id=_status_id_from_code(before.get("housekeeping_status_code")),
            new_housekeeping_status_id=row.housekeeping_status_id,
            previous_availability_status=before.get("availability_status"),
            new_availability_status=row.availability_status,
            previous_is_sellable=before.get("is_sellable"),
            new_is_sellable=row.is_sellable,
            previous_is_blocked=before.get("is_blocked"),
            new_is_blocked=row.is_blocked,
            previous_maintenance_flag=before.get("maintenance_flag"),
            new_maintenance_flag=row.maintenance_flag,
            event_type=event_type,
            note=note,
            changed_by_user_id=actor_user_id,
        )
    )


def _create_room_note(
    *,
    room_id: uuid.UUID,
    business_date: date,
    payload: RoomNotePayload,
    actor_user_id: uuid.UUID,
) -> RoomNote:
    note_text = (payload.note_text or "").strip()
    if not note_text:
        raise ValueError("Room note text is required.")
    note = RoomNote(
        room_id=room_id,
        business_date=business_date,
        note_text=note_text[:2000],
        note_type=payload.note_type,
        is_important=payload.is_important,
        visibility_scope=payload.visibility_scope,
        created_by_user_id=actor_user_id,
    )
    db.session.add(note)
    return note


def _sellable_for_row(row: InventoryDay, status_code: str | None) -> bool:
    if row.reservation_id is not None or row.hold_id is not None:
        return False
    if row.availability_status in CLOSURE_STATUS_CODES:
        return False
    if row.is_blocked:
        return False
    status = _status_by_code(status_code) if status_code else None
    return bool(status and status.is_sellable_state and row.availability_status == "available")


def _housekeeping_code(status_id: uuid.UUID | None) -> str | None:
    if not status_id:
        return None
    status = db.session.get(HousekeepingStatus, status_id)
    return status.code if status else None


def _status_id_from_code(code: str | None) -> uuid.UUID | None:
    if not code:
        return None
    status = HousekeepingStatus.query.filter_by(code=code).first()
    return status.id if status else None


def _require_override(actor: User | None) -> None:
    if not actor or actor.primary_role not in {"admin", "manager"}:
        raise ValueError("Only manager or admin can perform this operational override.")
