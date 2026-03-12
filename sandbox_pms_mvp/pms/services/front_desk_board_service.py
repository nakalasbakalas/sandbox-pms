from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import joinedload

from ..models import ExternalCalendarBlock, InventoryDay, InventoryOverride, Reservation, ReservationHold, Room, utc_now


ACTIVE_BOARD_RESERVATION_STATUSES = {
    "tentative",
    "confirmed",
    "checked_in",
    "checked_out",
    "house_use",
    "waitlist",
}
ACTIVE_BOARD_HOLD_STATUSES = {"active"}
CLOSED_INVENTORY_STATUSES = {"out_of_service", "out_of_order"}
BOARD_OPERATIONAL_BLOCK_TYPES = {"closure", "blocked", "maintenance"}
BOARD_VISIBLE_DAY_OPTIONS = (7, 14, 30)


@dataclass
class FrontDeskBoardFilters:
    start_date: date
    days: int = 14
    q: str = ""
    room_type_id: str = ""
    show_unallocated: bool = True
    show_closed: bool = False


def build_front_desk_board(filters: FrontDeskBoardFilters) -> dict[str, Any]:
    filters.days = filters.days if filters.days in BOARD_VISIBLE_DAY_OPTIONS else 14
    window_start = filters.start_date
    window_end = window_start + timedelta(days=filters.days)
    today = date.today()
    query_text = (filters.q or "").strip().lower()

    rooms = _room_query(filters.room_type_id)
    room_by_id = {room.id: room for room in rooms}
    room_ids = [room.id for room in rooms]
    room_id_set = set(room_ids)
    room_type_meta = {
        room.room_type_id: {
            "id": str(room.room_type_id),
            "code": room.room_type.code if room.room_type else "",
            "name": room.room_type.name if room.room_type else "",
        }
        for room in rooms
    }
    room_type_ids = set(room_type_meta.keys())

    reservations = _reservation_query(
        room_type_id=filters.room_type_id,
        window_start=window_start,
        window_end=window_end,
    )
    holds = _hold_query(
        room_type_id=filters.room_type_id,
        window_start=window_start,
        window_end=window_end,
    )

    inventory_rows: list[InventoryDay] = []
    overrides: list[InventoryOverride] = []
    external_blocks: list[ExternalCalendarBlock] = []
    if room_ids:
        inventory_rows = (
            InventoryDay.query.filter(
                InventoryDay.room_id.in_(room_ids),
                InventoryDay.business_date >= window_start,
                InventoryDay.business_date < window_end,
            )
            .order_by(InventoryDay.room_id.asc(), InventoryDay.business_date.asc())
            .all()
        )
        overrides = (
            InventoryOverride.query.filter(
                InventoryOverride.is_active.is_(True),
                InventoryOverride.start_date < window_end,
                InventoryOverride.end_date >= window_start,
                sa.or_(
                    InventoryOverride.room_id.in_(room_ids),
                    InventoryOverride.room_type_id.in_(room_type_ids),
                ),
            )
            .order_by(InventoryOverride.start_date.asc(), InventoryOverride.created_at.asc())
            .all()
        )
        external_blocks = (
            ExternalCalendarBlock.query.options(joinedload(ExternalCalendarBlock.conflict_reservation))
            .filter(
                ExternalCalendarBlock.room_id.in_(room_ids),
                ExternalCalendarBlock.starts_on < window_end,
                ExternalCalendarBlock.ends_on > window_start,
            )
            .order_by(ExternalCalendarBlock.room_id.asc(), ExternalCalendarBlock.starts_on.asc())
            .all()
        )

    group_map: dict[uuid.UUID, dict[str, Any]] = {}
    room_map: dict[uuid.UUID, dict[str, Any]] = {}
    for room in rooms:
        group = _ensure_group(group_map, room_type_meta=room_type_meta, room_type_id=room.room_type_id)
        group["room_options"].append(
            {
                "id": str(room.id),
                "label": f"Room {room.room_number} - Floor {room.floor_number}",
                "roomNumber": room.room_number,
                "floorNumber": room.floor_number,
                "roomTypeId": str(room.room_type_id),
            }
        )
        row = {
            "id": str(room.id),
            "anchor_id": f"room-{room.id}",
            "anchorId": f"room-{room.id}",
            "lane_kind": "room",
            "laneKind": "room",
            "room_id": str(room.id),
            "roomId": str(room.id),
            "room_type_id": str(room.room_type_id),
            "roomTypeId": str(room.room_type_id),
            "room_number": room.room_number,
            "roomNumber": room.room_number,
            "floor_number": room.floor_number,
            "floorNumber": room.floor_number,
            "room_type_code": group["room_type_code"],
            "room_type_name": group["room_type_name"],
            "roomTypeCode": group["room_type_code"],
            "roomTypeName": group["room_type_name"],
            "label": f"Room {room.room_number}",
            "secondary_label": f"Floor {room.floor_number}",
            "is_unallocated": False,
            "isUnallocated": False,
            "blocks": [],
            "visible_blocks": [],
            "lane_count": 1,
            "track_height": 74,
            "search_text": " ".join(
                part.lower()
                for part in [room.room_number, group["room_type_code"], group["room_type_name"], str(room.floor_number)]
                if part
            ),
        }
        group["rows"].append(row)
        room_map[room.id] = row

    conflict_reservation_ids = {
        str(block.conflict_reservation_id)
        for block in external_blocks
        if block.is_conflict and block.conflict_reservation_id is not None
    }

    for reservation in reservations:
        room_type_meta.setdefault(
            reservation.room_type_id,
            {
                "id": str(reservation.room_type_id),
                "code": reservation.room_type.code if reservation.room_type else "",
                "name": reservation.room_type.name if reservation.room_type else "",
            },
        )
        target_group = _ensure_group(group_map, room_type_meta=room_type_meta, room_type_id=reservation.room_type_id)
        target_row = room_map.get(reservation.assigned_room_id) if reservation.assigned_room_id else None
        allocation_state = "unallocated" if reservation.assigned_room_id is None or reservation.current_status == "waitlist" else "allocated"
        block = _reservation_block(
            reservation=reservation,
            window_start=window_start,
            window_end=window_end,
            room=room_by_id.get(reservation.assigned_room_id) if reservation.assigned_room_id else None,
            status="conflict" if str(reservation.id) in conflict_reservation_ids else reservation.current_status,
            allocation_state=allocation_state,
        )
        if allocation_state == "unallocated" or target_row is None or reservation.assigned_room_id not in room_id_set:
            _ensure_unallocated_row(target_group)["blocks"].append(block)
            continue
        target_row["blocks"].append(block)

    for hold in holds:
        room_type_meta.setdefault(
            hold.room_type_id,
            {
                "id": str(hold.room_type_id),
                "code": "",
                "name": "",
            },
        )
        target_group = _ensure_group(group_map, room_type_meta=room_type_meta, room_type_id=hold.room_type_id)
        target_row = room_map.get(hold.assigned_room_id) if hold.assigned_room_id else None
        block = _hold_block(
            hold=hold,
            window_start=window_start,
            window_end=window_end,
            room=room_by_id.get(hold.assigned_room_id) if hold.assigned_room_id else None,
            room_type_meta=room_type_meta.get(hold.room_type_id, {}),
        )
        if target_row is None or hold.assigned_room_id not in room_id_set:
            _ensure_unallocated_row(target_group)["blocks"].append(block)
            continue
        target_row["blocks"].append(block)

    override_coverage: dict[str, set[date]] = {}
    for override in overrides:
        if override.override_action != "close":
            continue
        if override.scope_type == "room":
            target_rows = [room_map[override.room_id]] if override.room_id in room_map else []
        else:
            target_rows = [
                row
                for row in room_map.values()
                if row["room_type_id"] == str(override.room_type_id)
            ]
        for row in target_rows:
            row["blocks"].append(
                _override_block(
                    override=override,
                    window_start=window_start,
                    window_end=window_end,
                    row=row,
                )
            )
            covered_days = override_coverage.setdefault(row["room_id"], set())
            segment_start = max(window_start, override.start_date)
            segment_end = min(window_end, override.end_date + timedelta(days=1))
            current = segment_start
            while current < segment_end:
                covered_days.add(current)
                current += timedelta(days=1)

    room_rows = _rows_by_room_and_date(inventory_rows)
    for room in rooms:
        row = room_map.get(room.id)
        if not row:
            continue
        row["blocks"].extend(
            _inventory_state_blocks(
                room=row,
                rows=room_rows.get(room.id, []),
                window_start=window_start,
                window_end=window_end,
                covered_days=override_coverage.get(str(room.id), set()),
            )
        )

    for block in external_blocks:
        if block.is_conflict and block.conflict_reservation_id is not None:
            continue
        row = room_map.get(block.room_id)
        room = room_by_id.get(block.room_id)
        if row and room:
            row["blocks"].append(
                _external_block(block=block, window_start=window_start, window_end=window_end, row=row, room=room)
            )

    operational_room_ids: set[str] = set()
    unallocated_count = 0
    groups: list[dict[str, Any]] = []
    for group in sorted(group_map.values(), key=lambda item: (item["room_type_code"], item["room_type_name"])):
        rows: list[dict[str, Any]] = []
        for row in group["rows"]:
            row["blocks"] = sorted(
                row["blocks"],
                key=lambda item: (
                    item["gridStart"],
                    item["gridSpan"],
                    item["sourceType"],
                    item["label"],
                ),
            )
            visible_blocks = [
                item
                for item in row["blocks"]
                if filters.show_closed or item["sourceType"] not in BOARD_OPERATIONAL_BLOCK_TYPES
            ]
            if any(item["sourceType"] in BOARD_OPERATIONAL_BLOCK_TYPES for item in row["blocks"]):
                operational_room_ids.add(row["room_id"])
            room_match = not query_text or query_text in row["search_text"]
            if query_text and not room_match:
                visible_blocks = [item for item in visible_blocks if query_text in item["searchText"]]
            if row["is_unallocated"]:
                unallocated_count += sum(1 for item in visible_blocks if item["sourceType"] in {"reservation", "hold"})
            if query_text and not room_match and not visible_blocks:
                continue
            row["visible_blocks"] = visible_blocks
            row["visibleBlocks"] = visible_blocks
            row["lane_count"] = _assign_block_lanes(visible_blocks)
            row["track_height"] = max(74, 18 + (row["lane_count"] * 54))
            rows.append(row)
        if not filters.show_unallocated:
            rows = [row for row in rows if not row["is_unallocated"]]
        if rows:
            groups.append(group | {"rows": rows})

    today_offset = (today - window_start).days + 1 if window_start <= today < window_end else None
    return {
        "start_date": window_start,
        "startDate": window_start.isoformat(),
        "end_date": window_end,
        "endDate": window_end.isoformat(),
        "days": filters.days,
        "day_options": list(BOARD_VISIBLE_DAY_OPTIONS),
        "headers": _build_headers(window_start, filters.days, today=today),
        "groups": groups,
        "room_options": [
            {
                "id": str(room.id),
                "label": f"Room {room.room_number} - {room.room_type.code if room.room_type else ''}",
            }
            for room in rooms
        ],
        "counts": {
            "unallocated": unallocated_count,
            "closed_or_blocked": len(operational_room_ids),
            "arrivals_today": _count_arrivals(today, filters.room_type_id),
            "departures_today": _count_departures(today, filters.room_type_id),
        },
        "today_offset": today_offset,
        "todayOffset": today_offset,
        "current_window_label": f"{window_start.strftime('%d %b %Y')} - {(window_end - timedelta(days=1)).strftime('%d %b %Y')}",
        "prev_start_date": window_start - timedelta(days=filters.days),
        "next_start_date": window_start + timedelta(days=filters.days),
        "today": today,
    }


def list_front_desk_room_groups(*, room_type_id: str = "") -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for room in _room_query(room_type_id):
        group = groups.setdefault(
            str(room.room_type_id),
            {
                "roomTypeId": str(room.room_type_id),
                "roomTypeCode": room.room_type.code if room.room_type else "",
                "roomTypeName": room.room_type.name if room.room_type else "",
                "rooms": [],
            },
        )
        group["rooms"].append(
            {
                "id": str(room.id),
                "roomNumber": room.room_number,
                "floorNumber": room.floor_number,
                "label": f"Room {room.room_number} - Floor {room.floor_number}",
            }
        )
    return list(groups.values())


def flatten_front_desk_blocks(board: dict[str, Any], *, visible_only: bool = True) -> list[dict[str, Any]]:
    flattened: list[dict[str, Any]] = []
    for group in board.get("groups", []):
        for row in group.get("rows", []):
            blocks = row.get("visible_blocks", []) if visible_only else row.get("blocks", [])
            for block in blocks:
                block_copy = dict(block)
                block_copy["rowLabel"] = row.get("label")
                block_copy["groupLabel"] = f"{group.get('room_type_code')} - {group.get('room_type_name')}".strip(" -")
                flattened.append(block_copy)
    return flattened


def serialize_front_desk_board(board: dict[str, Any]) -> dict[str, Any]:
    return _serialize_value(board)


def _room_query(room_type_id: str) -> list[Room]:
    query = Room.query.options(joinedload(Room.room_type)).filter(Room.is_active.is_(True))
    if room_type_id:
        query = query.filter(Room.room_type_id == uuid.UUID(room_type_id))
    return query.order_by(Room.room_type_id.asc(), Room.room_number.asc()).all()


def _reservation_query(*, room_type_id: str, window_start: date, window_end: date) -> list[Reservation]:
    query = Reservation.query.options(
        joinedload(Reservation.primary_guest),
        joinedload(Reservation.room_type),
        joinedload(Reservation.assigned_room),
    ).filter(
        Reservation.current_status.in_(tuple(ACTIVE_BOARD_RESERVATION_STATUSES)),
        Reservation.check_in_date < window_end,
        Reservation.check_out_date > window_start,
    )
    if room_type_id:
        query = query.filter(Reservation.room_type_id == uuid.UUID(room_type_id))
    return query.order_by(Reservation.check_in_date.asc(), Reservation.booked_at.asc()).all()


def _hold_query(*, room_type_id: str, window_start: date, window_end: date) -> list[ReservationHold]:
    query = ReservationHold.query.filter(
        ReservationHold.status.in_(tuple(ACTIVE_BOARD_HOLD_STATUSES)),
        ReservationHold.check_in_date < window_end,
        ReservationHold.check_out_date > window_start,
        ReservationHold.expires_at > utc_now(),
    )
    if room_type_id:
        query = query.filter(ReservationHold.room_type_id == uuid.UUID(room_type_id))
    return query.order_by(ReservationHold.check_in_date.asc(), ReservationHold.created_at.asc()).all()


def _build_headers(window_start: date, days: int, *, today: date) -> list[dict[str, Any]]:
    headers = []
    for offset in range(days):
        business_date = window_start + timedelta(days=offset)
        headers.append(
            {
                "date": business_date,
                "isoDate": business_date.isoformat(),
                "day_label": business_date.strftime("%a").upper(),
                "day_number": business_date.strftime("%d"),
                "month_label": business_date.strftime("%b").upper(),
                "is_weekend": business_date.weekday() >= 5,
                "is_today": business_date == today,
                "column": offset + 1,
            }
        )
    return headers


def _ensure_group(group_map: dict[uuid.UUID, dict[str, Any]], *, room_type_meta: dict[uuid.UUID, dict[str, str]], room_type_id: uuid.UUID) -> dict[str, Any]:
    meta = room_type_meta.get(room_type_id) or {"id": str(room_type_id), "code": "", "name": ""}
    return group_map.setdefault(
        room_type_id,
        {
            "room_type_id": str(room_type_id),
            "roomTypeId": str(room_type_id),
            "room_type_code": meta.get("code", ""),
            "roomTypeCode": meta.get("code", ""),
            "room_type_name": meta.get("name", ""),
            "roomTypeName": meta.get("name", ""),
            "room_options": [],
            "rows": [],
        },
    )


def _ensure_unallocated_row(group: dict[str, Any]) -> dict[str, Any]:
    for row in group["rows"]:
        if row["is_unallocated"]:
            return row
    row = {
        "id": f"unallocated-{group['room_type_id']}",
        "anchor_id": f"unallocated-{group['room_type_id']}",
        "anchorId": f"unallocated-{group['room_type_id']}",
        "lane_kind": "unallocated",
        "laneKind": "unallocated",
        "room_id": None,
        "roomId": None,
        "room_type_id": group["room_type_id"],
        "roomTypeId": group["room_type_id"],
        "room_number": "Unallocated",
        "roomNumber": "Unallocated",
        "floor_number": None,
        "floorNumber": None,
        "room_type_code": group["room_type_code"],
        "room_type_name": group["room_type_name"],
        "roomTypeCode": group["room_type_code"],
        "roomTypeName": group["room_type_name"],
        "label": "Unallocated",
        "secondary_label": group["room_type_code"] or group["room_type_name"],
        "is_unallocated": True,
        "isUnallocated": True,
        "blocks": [],
        "visible_blocks": [],
        "lane_count": 1,
        "track_height": 74,
        "search_text": f"unallocated {group['room_type_code'].lower()} {group['room_type_name'].lower()}",
    }
    group["rows"].append(row)
    return row


def _reservation_block(
    *,
    reservation: Reservation,
    window_start: date,
    window_end: date,
    room: Room | None,
    status: str,
    allocation_state: str,
) -> dict[str, Any]:
    visible_start = max(window_start, reservation.check_in_date)
    visible_end = min(window_end, reservation.check_out_date)
    guest_name = reservation.primary_guest.full_name if reservation.primary_guest else "Unknown guest"
    drag_policy = "none"
    draggable = False
    resizable = False
    if allocation_state == "unallocated" and reservation.current_status in {"tentative", "confirmed"}:
        drag_policy = "room"
        draggable = True
    elif reservation.current_status in {"tentative", "confirmed"}:
        drag_policy = "both"
        draggable = True
        resizable = True
    elif reservation.current_status == "checked_in":
        drag_policy = "room"
        draggable = True
    metadata = {
        "reservationCode": reservation.reservation_code,
        "sourceChannel": reservation.source_channel,
        "roomNumber": room.room_number if room else None,
        "roomTypeCode": reservation.room_type.code if reservation.room_type else "",
        "roomTypeName": reservation.room_type.name if reservation.room_type else "",
        "updatedAt": reservation.updated_at.isoformat() if getattr(reservation, "updated_at", None) else None,
        "sequence": 0,
        "dragPolicy": drag_policy,
    }
    return _base_block(
        block_id=f"reservation-{reservation.id}",
        source_type="reservation",
        source_id=str(reservation.id),
        room_id=str(reservation.assigned_room_id) if reservation.assigned_room_id and allocation_state == "allocated" else None,
        room_type_id=str(reservation.room_type_id),
        start_date=reservation.check_in_date,
        end_date=reservation.check_out_date,
        visible_start=visible_start,
        visible_end=visible_end,
        window_start=window_start,
        window_end=window_end,
        label=guest_name,
        subtitle=f"{reservation.reservation_code} - {reservation.current_status.replace('_', ' ')}",
        status=status,
        display_variant=_reservation_display_variant(
            reservation.current_status,
            allocation_state=allocation_state,
            block_end=reservation.check_out_date,
        ),
        guest_name=guest_name,
        draggable=draggable,
        resizable=resizable,
        allocation_state=allocation_state,
        lane_kind="unallocated" if allocation_state == "unallocated" else "room",
        metadata=metadata,
        search_parts=[
            guest_name,
            reservation.reservation_code,
            reservation.current_status.replace("_", " "),
            reservation.source_channel,
            metadata["roomTypeCode"],
            metadata["roomNumber"],
        ],
        extra_fields={
            "reservationId": str(reservation.id),
            "checkInAt": reservation.check_in_date.isoformat(),
            "checkOutAt": reservation.check_out_date.isoformat(),
        },
    )


def _hold_block(
    *,
    hold: ReservationHold,
    window_start: date,
    window_end: date,
    room: Room | None,
    room_type_meta: dict[str, str],
) -> dict[str, Any]:
    visible_start = max(window_start, hold.check_in_date)
    visible_end = min(window_end, hold.check_out_date)
    guest_label = hold.guest_email or hold.hold_code
    metadata = {
        "holdCode": hold.hold_code,
        "guestEmail": hold.guest_email,
        "roomNumber": room.room_number if room else None,
        "roomTypeCode": room_type_meta.get("code", ""),
        "roomTypeName": room_type_meta.get("name", ""),
        "expiresAt": hold.expires_at.isoformat() if hold.expires_at else None,
        "updatedAt": hold.updated_at.isoformat() if getattr(hold, "updated_at", None) else None,
        "sequence": 0,
    }
    return _base_block(
        block_id=f"hold-{hold.id}",
        source_type="hold",
        source_id=str(hold.id),
        room_id=str(hold.assigned_room_id) if hold.assigned_room_id else None,
        room_type_id=str(hold.room_type_id),
        start_date=hold.check_in_date,
        end_date=hold.check_out_date,
        visible_start=visible_start,
        visible_end=visible_end,
        window_start=window_start,
        window_end=window_end,
        label=guest_label,
        subtitle=f"{hold.hold_code} - hold",
        status=hold.status,
        display_variant="hold",
        guest_name=hold.guest_email,
        draggable=False,
        resizable=False,
        allocation_state="unallocated" if hold.assigned_room_id is None else "allocated",
        lane_kind="unallocated" if hold.assigned_room_id is None else "room",
        metadata=metadata,
        search_parts=[
            hold.hold_code,
            hold.guest_email or "",
            metadata["roomNumber"],
            metadata["roomTypeCode"],
        ],
        extra_fields={
            "holdId": str(hold.id),
            "checkInAt": hold.check_in_date.isoformat(),
            "checkOutAt": hold.check_out_date.isoformat(),
        },
    )


def _override_block(*, override: InventoryOverride, window_start: date, window_end: date, row: dict[str, Any]) -> dict[str, Any]:
    visible_start = max(window_start, override.start_date)
    visible_end = min(window_end, override.end_date + timedelta(days=1))
    target = "Room closure" if override.scope_type == "room" else "Type closure"
    metadata = {
        "reason": override.reason,
        "roomNumber": row.get("room_number"),
        "roomTypeCode": row.get("room_type_code"),
        "updatedAt": override.updated_at.isoformat() if getattr(override, "updated_at", None) else None,
        "sequence": 0,
    }
    return _base_block(
        block_id=f"override-{override.id}",
        source_type="closure",
        source_id=str(override.id),
        room_id=row.get("room_id"),
        room_type_id=row.get("room_type_id"),
        start_date=override.start_date,
        end_date=override.end_date + timedelta(days=1),
        display_end_date=override.end_date,
        visible_start=visible_start,
        visible_end=visible_end,
        window_start=window_start,
        window_end=window_end,
        label=override.name or target,
        subtitle=override.reason,
        status="closure",
        display_variant="closure",
        guest_name=None,
        draggable=False,
        resizable=False,
        allocation_state="allocated",
        lane_kind="room",
        metadata=metadata,
        search_parts=[override.name or target, override.reason or "", row.get("room_number"), row.get("room_type_code")],
        extra_fields={"overrideId": str(override.id)},
    )


def _inventory_state_blocks(
    *,
    room: dict[str, Any],
    rows: list[InventoryDay],
    window_start: date,
    window_end: date,
    covered_days: set[date],
) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    active_kind: str | None = None
    active_reason: str | None = None
    segment_start: date | None = None
    previous_day: date | None = None
    current_row_ref: InventoryDay | None = None

    def flush(segment_end: date | None) -> None:
        nonlocal active_kind, active_reason, segment_start, current_row_ref
        if not active_kind or segment_start is None or segment_end is None:
            return
        visible_start = max(window_start, segment_start)
        visible_end = min(window_end, segment_end)
        if visible_start >= visible_end:
            active_kind = None
            active_reason = None
            segment_start = None
            current_row_ref = None
            return
        label = {
            "blocked": "Blocked",
            "maintenance": "Maintenance",
            "closure": "Closed",
        }.get(active_kind, active_kind.title())
        blocks.append(
            _base_block(
                block_id=f"{active_kind}-{room['room_id']}-{segment_start.isoformat()}",
                source_type=active_kind,
                source_id=f"{room['room_id']}-{segment_start.isoformat()}",
                room_id=room["room_id"],
                room_type_id=room["room_type_id"],
                start_date=segment_start,
                end_date=segment_end,
                display_end_date=segment_end - timedelta(days=1),
                visible_start=visible_start,
                visible_end=visible_end,
                window_start=window_start,
                window_end=window_end,
                label=label,
                subtitle=active_reason,
                status=active_kind,
                display_variant=active_kind,
                guest_name=None,
                draggable=False,
                resizable=False,
                allocation_state="allocated",
                lane_kind="room",
                metadata={
                    "reason": active_reason,
                    "roomNumber": room.get("room_number"),
                    "roomTypeCode": room.get("room_type_code"),
                    "updatedAt": current_row_ref.updated_at.isoformat()
                    if current_row_ref and getattr(current_row_ref, "updated_at", None)
                    else None,
                    "sequence": 0,
                },
                search_parts=[label, active_reason or "", room.get("room_number"), room.get("room_type_code")],
            )
        )
        active_kind = None
        active_reason = None
        segment_start = None
        current_row_ref = None

    for row in rows:
        if row.business_date in covered_days:
            flush(row.business_date)
            previous_day = row.business_date
            continue
        if row.is_blocked:
            row_kind = "blocked"
            row_reason = row.blocked_reason or row.notes or "Blocked from sale"
        elif row.maintenance_flag:
            row_kind = "maintenance"
            row_reason = row.maintenance_note or row.notes or "Maintenance"
        elif row.availability_status in CLOSED_INVENTORY_STATUSES:
            row_kind = "closure"
            row_reason = row.notes or row.availability_status.replace("_", " ")
        else:
            row_kind = None
            row_reason = None
        contiguous = previous_day is not None and row.business_date == previous_day + timedelta(days=1)
        if row_kind and active_kind == row_kind and active_reason == row_reason and contiguous:
            previous_day = row.business_date
            current_row_ref = row
            continue
        flush(row.business_date)
        if row_kind:
            active_kind = row_kind
            active_reason = row_reason
            segment_start = row.business_date
            current_row_ref = row
        previous_day = row.business_date
    flush(previous_day + timedelta(days=1) if previous_day is not None else None)
    return blocks


def _external_block(
    *,
    block: ExternalCalendarBlock,
    window_start: date,
    window_end: date,
    row: dict[str, Any],
    room: Room,
) -> dict[str, Any]:
    visible_start = max(window_start, block.starts_on)
    visible_end = min(window_end, block.ends_on)
    label = block.summary or "External block"
    metadata = {
        "externalUid": block.external_uid,
        "roomNumber": room.room_number,
        "roomTypeCode": row.get("room_type_code"),
        "updatedAt": (block.event_updated_at or block.last_seen_at).isoformat()
        if block.event_updated_at or block.last_seen_at
        else None,
        "reason": block.conflict_reason or "Provider calendar block",
        "sequence": (block.metadata_json or {}).get("sequence"),
    }
    return _base_block(
        block_id=f"external-{block.id}",
        source_type="external",
        source_id=str(block.id),
        room_id=str(block.room_id),
        room_type_id=row.get("room_type_id"),
        start_date=block.starts_on,
        end_date=block.ends_on,
        visible_start=visible_start,
        visible_end=visible_end,
        window_start=window_start,
        window_end=window_end,
        label=label,
        subtitle=block.conflict_reason or "Provider calendar block",
        status="external",
        display_variant="external",
        guest_name=None,
        draggable=False,
        resizable=False,
        allocation_state="allocated",
        lane_kind="room",
        metadata=metadata,
        search_parts=[label, "provider calendar", room.room_number],
    )


def _base_block(
    *,
    block_id: str,
    source_type: str,
    source_id: str,
    room_id: str | None,
    room_type_id: str | None,
    start_date: date,
    end_date: date,
    display_end_date: date | None = None,
    visible_start: date,
    visible_end: date,
    window_start: date,
    window_end: date,
    label: str,
    subtitle: str | None,
    status: str,
    display_variant: str,
    guest_name: str | None,
    draggable: bool,
    resizable: bool,
    allocation_state: str,
    lane_kind: str,
    metadata: dict[str, Any],
    search_parts: list[Any],
    extra_fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    resolved_end_date = display_end_date or end_date
    grid_start = (visible_start - window_start).days + 1
    grid_span = max((visible_end - visible_start).days, 1)
    clipped_start = start_date < window_start
    clipped_end = end_date > window_end
    block = {
        "id": block_id,
        "kind": source_type,
        "sourceType": source_type,
        "sourceId": source_id,
        "source_id": source_id,
        "reservationId": None,
        "reservation_id": None,
        "holdId": None,
        "hold_id": None,
        "overrideId": None,
        "override_id": None,
        "roomId": room_id,
        "room_id": room_id,
        "roomTypeId": room_type_id,
        "room_type_id": room_type_id,
        "guestName": guest_name,
        "guest_name": guest_name,
        "status": status,
        "startDate": start_date.isoformat(),
        "start_date": start_date.isoformat(),
        "endDate": resolved_end_date.isoformat(),
        "end_date": resolved_end_date.isoformat(),
        "endDateExclusive": end_date.isoformat(),
        "end_date_exclusive": end_date.isoformat(),
        "checkInAt": None,
        "checkOutAt": None,
        "check_in_at": None,
        "check_out_at": None,
        "displayVariant": display_variant,
        "display_variant": display_variant,
        "draggable": draggable,
        "resizable": resizable,
        "allocationState": allocation_state,
        "allocation_state": allocation_state,
        "laneKind": lane_kind,
        "lane_kind": lane_kind,
        "metadata": metadata,
        "label": label,
        "subtitle": subtitle,
        "gridStart": grid_start,
        "grid_start": grid_start,
        "gridSpan": grid_span,
        "grid_span": grid_span,
        "span": grid_span,
        "clippedStart": clipped_start,
        "clipped_start": clipped_start,
        "clippedEnd": clipped_end,
        "clipped_end": clipped_end,
        "searchText": " ".join(str(part).lower() for part in search_parts if part),
        "search_text": " ".join(str(part).lower() for part in search_parts if part),
        "laneIndex": 1,
        "lane_index": 1,
        "detailUrl": None,
        "frontDeskUrl": None,
        "reassignUrl": None,
        "moveUrl": None,
        "resizeUrl": None,
        "releaseUrl": None,
        "editUrl": None,
        "reassignOptions": [],
        "canRelease": False,
        "canEdit": False,
    }
    if extra_fields:
        block.update(extra_fields)
    block["reservation_id"] = block.get("reservationId")
    block["hold_id"] = block.get("holdId")
    block["override_id"] = block.get("overrideId")
    block["check_in_at"] = block.get("checkInAt")
    block["check_out_at"] = block.get("checkOutAt")
    return block


def _reservation_display_variant(current_status: str, *, allocation_state: str, block_end: date) -> str:
    if allocation_state == "unallocated":
        return "unallocated"
    if current_status == "tentative":
        return "pending"
    if current_status == "checked_in":
        return "in_house"
    if current_status == "checked_out" or block_end <= date.today():
        return "past"
    return current_status


def _rows_by_room_and_date(rows: list[InventoryDay]) -> dict[uuid.UUID, list[InventoryDay]]:
    grouped: dict[uuid.UUID, list[InventoryDay]] = {}
    for row in rows:
        grouped.setdefault(row.room_id, []).append(row)
    return grouped


def _assign_block_lanes(blocks: list[dict[str, Any]]) -> int:
    if not blocks:
        return 1
    lane_end_dates: list[date] = []
    for block in blocks:
        block_start = date.fromisoformat(block["startDate"])
        block_end = date.fromisoformat(block["endDateExclusive"])
        for lane_index, lane_end in enumerate(lane_end_dates, start=1):
            if block_start >= lane_end:
                block["laneIndex"] = lane_index
                lane_end_dates[lane_index - 1] = block_end
                break
        else:
            lane_end_dates.append(block_end)
            block["laneIndex"] = len(lane_end_dates)
    return max(len(lane_end_dates), 1)


def _serialize_value(value: Any) -> Any:
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: _serialize_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_serialize_value(item) for item in value]
    return value


def _count_arrivals(target_date: date, room_type_id: str) -> int:
    query = Reservation.query.filter(
        Reservation.check_in_date == target_date,
        Reservation.current_status.in_(["tentative", "confirmed"]),
    )
    if room_type_id:
        query = query.filter(Reservation.room_type_id == uuid.UUID(room_type_id))
    return query.count()


def _count_departures(target_date: date, room_type_id: str) -> int:
    query = Reservation.query.filter(
        Reservation.check_out_date == target_date,
        Reservation.current_status.in_(["checked_in", "checked_out"]),
    )
    if room_type_id:
        query = query.filter(Reservation.room_type_id == uuid.UUID(room_type_id))
    return query.count()
