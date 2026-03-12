from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, timedelta

import sqlalchemy as sa
from sqlalchemy.orm import joinedload

from ..models import ExternalCalendarBlock, InventoryDay, InventoryOverride, Reservation, Room


ACTIVE_BOARD_RESERVATION_STATUSES = {"tentative", "confirmed", "checked_in", "house_use", "waitlist"}
CLOSED_INVENTORY_STATUSES = {"out_of_service", "out_of_order"}


@dataclass
class FrontDeskBoardFilters:
    start_date: date
    days: int = 14
    q: str = ""
    room_type_id: str = ""
    show_unallocated: bool = True
    show_closed: bool = False


def build_front_desk_board(filters: FrontDeskBoardFilters) -> dict:
    filters.days = 7 if filters.days == 7 else 14
    window_start = filters.start_date
    window_end = window_start + timedelta(days=filters.days)
    today = date.today()
    query_text = (filters.q or "").strip().lower()

    room_query = Room.query.options(joinedload(Room.room_type)).filter(Room.is_active.is_(True))
    if filters.room_type_id:
        room_query = room_query.filter(Room.room_type_id == uuid.UUID(filters.room_type_id))
    rooms = room_query.order_by(Room.room_type_id.asc(), Room.room_number.asc()).all()
    room_by_id = {room.id: room for room in rooms}
    room_ids = [room.id for room in rooms]
    room_id_set = set(room_ids)
    room_type_ids = {room.room_type_id for room in rooms}

    reservation_query = Reservation.query.options(
        joinedload(Reservation.primary_guest),
        joinedload(Reservation.room_type),
        joinedload(Reservation.assigned_room),
    ).filter(
        Reservation.current_status.in_(tuple(ACTIVE_BOARD_RESERVATION_STATUSES)),
        Reservation.check_in_date < window_end,
        Reservation.check_out_date > window_start,
    )
    if filters.room_type_id:
        reservation_query = reservation_query.filter(Reservation.room_type_id == uuid.UUID(filters.room_type_id))
    reservations = reservation_query.order_by(Reservation.check_in_date.asc(), Reservation.booked_at.asc()).all()

    inventory_rows = []
    overrides = []
    external_blocks = []
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

    group_map: dict[uuid.UUID, dict] = {}
    room_map: dict[uuid.UUID, dict] = {}
    for room in rooms:
        group = group_map.setdefault(
            room.room_type_id,
            {
                "room_type_id": str(room.room_type_id),
                "room_type_code": room.room_type.code if room.room_type else "",
                "room_type_name": room.room_type.name if room.room_type else "",
                "room_options": [],
                "rows": [],
            },
        )
        group["room_options"].append(
            {
                "id": str(room.id),
                "label": f"Room {room.room_number} - Floor {room.floor_number}",
            }
        )
        row = {
            "anchor_id": f"room-{room.id}",
            "room_id": str(room.id),
            "room_number": room.room_number,
            "floor_number": room.floor_number,
            "room_type_code": group["room_type_code"],
            "room_type_name": group["room_type_name"],
            "label": f"Room {room.room_number}",
            "secondary_label": f"Floor {room.floor_number}",
            "is_unallocated": False,
            "blocks": [],
            "search_text": " ".join(
                part.lower()
                for part in [room.room_number, group["room_type_code"], group["room_type_name"]]
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
        target_group = group_map.setdefault(
            reservation.room_type_id,
            {
                "room_type_id": str(reservation.room_type_id),
                "room_type_code": reservation.room_type.code if reservation.room_type else "",
                "room_type_name": reservation.room_type.name if reservation.room_type else "",
                "room_options": [],
                "rows": [],
            },
        )
        block = _reservation_block(
            reservation=reservation,
            window_start=window_start,
            window_end=window_end,
            status="conflict" if str(reservation.id) in conflict_reservation_ids else reservation.current_status,
        )
        target_row = room_map.get(reservation.assigned_room_id)
        if reservation.current_status == "waitlist" or target_row is None or reservation.assigned_room_id not in room_id_set:
            unallocated_row = _ensure_unallocated_row(target_group)
            unallocated_row["blocks"].append(block | {"can_reassign": bool(target_group["room_options"])})
            continue
        target_row["blocks"].append(block | {"can_reassign": bool(target_group["room_options"])})

    override_coverage: dict[str, set[date]] = {}
    for override in overrides:
        if override.override_action != "close":
            continue
        if override.scope_type == "room":
            target_rows = [room_map[override.room_id]] if override.room_id in room_map else []
        else:
            target_rows = [
                room_map[room.id]
                for room in rooms
                if room.room_type_id == override.room_type_id and room.id in room_map
            ]
        for row in target_rows:
            block = _override_block(override=override, window_start=window_start, window_end=window_end)
            row["blocks"].append(block)
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
        row_inventory = room_rows.get(room.id, [])
        row["blocks"].extend(
            _inventory_state_blocks(
                room_id=str(room.id),
                rows=row_inventory,
                window_start=window_start,
                window_end=window_end,
                covered_days=override_coverage.get(str(room.id), set()),
            )
        )

    for block in external_blocks:
        if block.is_conflict and block.conflict_reservation_id is not None:
            continue
        row = room_map.get(block.room_id)
        if row and room_by_id.get(block.room_id):
            row["blocks"].append(_external_block(block=block, window_start=window_start, window_end=window_end))

    closed_room_ids = set()
    unallocated_count = 0
    groups = []
    for group in sorted(group_map.values(), key=lambda item: (item["room_type_code"], item["room_type_name"])):
        rows = []
        for row in group["rows"]:
            row["blocks"] = sorted(row["blocks"], key=lambda item: (item["start_offset"], item["kind"], item["label"]))
            visible_blocks = [
                item
                for item in row["blocks"]
                if filters.show_closed or item["kind"] not in {"closure", "blocked"}
            ]
            if any(item["kind"] in {"closure", "blocked"} for item in row["blocks"]):
                closed_room_ids.add(row["room_id"])
            room_match = not query_text or query_text in row["search_text"]
            if query_text and not room_match:
                visible_blocks = [item for item in visible_blocks if query_text in item["search_text"]]
            row["visible_blocks"] = visible_blocks
            if row["is_unallocated"]:
                unallocated_count += len(visible_blocks)
            if query_text and not room_match and not visible_blocks:
                continue
            rows.append(row)
        if not filters.show_unallocated:
            rows = [row for row in rows if not row["is_unallocated"]]
        if rows:
            groups.append(group | {"rows": rows})

    return {
        "start_date": window_start,
        "end_date": window_end,
        "days": filters.days,
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
            "closed_or_blocked": len(closed_room_ids),
            "arrivals_today": _count_arrivals(today, filters.room_type_id),
            "departures_today": _count_departures(today, filters.room_type_id),
        },
        "current_window_label": f"{window_start.strftime('%d %b %Y')} - {(window_end - timedelta(days=1)).strftime('%d %b %Y')}",
        "prev_start_date": window_start - timedelta(days=filters.days),
        "next_start_date": window_start + timedelta(days=filters.days),
        "today": today,
    }


def _build_headers(window_start: date, days: int, *, today: date) -> list[dict]:
    headers = []
    for offset in range(days):
        business_date = window_start + timedelta(days=offset)
        headers.append(
            {
                "date": business_date,
                "day_label": business_date.strftime("%a").upper(),
                "day_number": business_date.strftime("%d"),
                "month_label": business_date.strftime("%b").upper(),
                "is_weekend": business_date.weekday() >= 5,
                "is_today": business_date == today,
            }
        )
    return headers


def _ensure_unallocated_row(group: dict) -> dict:
    for row in group["rows"]:
        if row["is_unallocated"]:
            return row
    row = {
        "anchor_id": f"unallocated-{group['room_type_id']}",
        "room_id": None,
        "room_number": "Unallocated",
        "floor_number": None,
        "room_type_code": group["room_type_code"],
        "room_type_name": group["room_type_name"],
        "label": "Unallocated",
        "secondary_label": group["room_type_code"],
        "is_unallocated": True,
        "blocks": [],
        "search_text": f"unallocated {group['room_type_code'].lower()} {group['room_type_name'].lower()}",
    }
    group["rows"].append(row)
    return row


def _reservation_block(*, reservation: Reservation, window_start: date, window_end: date, status: str) -> dict:
    visible_start = max(window_start, reservation.check_in_date)
    visible_end = min(window_end, reservation.check_out_date)
    guest_name = reservation.primary_guest.full_name if reservation.primary_guest else "Unknown guest"
    return {
        "id": f"reservation-{reservation.id}",
        "kind": "reservation",
        "reservation_id": str(reservation.id),
        "override_id": None,
        "start_offset": (visible_start - window_start).days + 1,
        "span": max((visible_end - visible_start).days, 1),
        "clipped_start": reservation.check_in_date < window_start,
        "clipped_end": reservation.check_out_date > window_end,
        "label": guest_name,
        "subtitle": f"{reservation.reservation_code} - {reservation.current_status.replace('_', ' ')}",
        "status": status,
        "detail_url": None,
        "front_desk_url": None,
        "can_reassign": True,
        "can_release": False,
        "search_text": " ".join(
            part.lower()
            for part in [
                guest_name,
                reservation.reservation_code,
                reservation.current_status.replace("_", " "),
                reservation.source_channel,
                reservation.room_type.code if reservation.room_type else "",
            ]
            if part
        ),
    }


def _override_block(*, override: InventoryOverride, window_start: date, window_end: date) -> dict:
    visible_start = max(window_start, override.start_date)
    visible_end = min(window_end, override.end_date + timedelta(days=1))
    target = "Room closure" if override.scope_type == "room" else "Type closure"
    return {
        "id": f"override-{override.id}",
        "kind": "closure",
        "reservation_id": None,
        "override_id": str(override.id),
        "start_offset": (visible_start - window_start).days + 1,
        "span": max((visible_end - visible_start).days, 1),
        "clipped_start": override.start_date < window_start,
        "clipped_end": override.end_date >= window_end,
        "label": override.name or target,
        "subtitle": override.reason,
        "status": "closure",
        "detail_url": None,
        "front_desk_url": None,
        "can_reassign": False,
        "can_release": True,
        "search_text": " ".join(part.lower() for part in [override.name or target, override.reason or ""] if part),
    }


def _inventory_state_blocks(
    *,
    room_id: str,
    rows: list[InventoryDay],
    window_start: date,
    window_end: date,
    covered_days: set[date],
) -> list[dict]:
    blocks: list[dict] = []
    active_kind = None
    active_reason = None
    segment_start = None
    previous_day = None

    def flush(segment_end: date | None) -> None:
        nonlocal active_kind, active_reason, segment_start
        if not active_kind or segment_start is None or segment_end is None:
            return
        visible_start = max(window_start, segment_start)
        visible_end = min(window_end, segment_end)
        if visible_start >= visible_end:
            active_kind = None
            active_reason = None
            segment_start = None
            return
        label = "Blocked" if active_kind == "blocked" else "Closed"
        blocks.append(
            {
                "id": f"{active_kind}-{room_id}-{segment_start.isoformat()}",
                "kind": active_kind,
                "reservation_id": None,
                "override_id": None,
                "start_offset": (visible_start - window_start).days + 1,
                "span": max((visible_end - visible_start).days, 1),
                "clipped_start": segment_start < window_start,
                "clipped_end": segment_end > window_end,
                "label": label,
                "subtitle": active_reason,
                "status": active_kind,
                "detail_url": None,
                "front_desk_url": None,
                "can_reassign": False,
                "can_release": False,
                "search_text": f"{label.lower()} {(active_reason or '').lower()}",
            }
        )
        active_kind = None
        active_reason = None
        segment_start = None

    for row in rows:
        if row.business_date in covered_days:
            flush(row.business_date)
            previous_day = row.business_date
            continue
        if row.is_blocked:
            row_kind = "blocked"
            row_reason = row.blocked_reason or row.notes or "Blocked from sale"
        elif row.availability_status in CLOSED_INVENTORY_STATUSES:
            row_kind = "closure"
            row_reason = row.notes or row.availability_status.replace("_", " ")
        else:
            row_kind = None
            row_reason = None
        contiguous = previous_day is not None and row.business_date == previous_day + timedelta(days=1)
        if row_kind and active_kind == row_kind and active_reason == row_reason and contiguous:
            previous_day = row.business_date
            continue
        flush(row.business_date)
        if row_kind:
            active_kind = row_kind
            active_reason = row_reason
            segment_start = row.business_date
        previous_day = row.business_date
    flush(previous_day + timedelta(days=1) if previous_day is not None else None)
    return blocks


def _external_block(*, block: ExternalCalendarBlock, window_start: date, window_end: date) -> dict:
    visible_start = max(window_start, block.starts_on)
    visible_end = min(window_end, block.ends_on)
    label = block.summary or "External block"
    return {
        "id": f"external-{block.id}",
        "kind": "external",
        "reservation_id": None,
        "override_id": None,
        "start_offset": (visible_start - window_start).days + 1,
        "span": max((visible_end - visible_start).days, 1),
        "clipped_start": block.starts_on < window_start,
        "clipped_end": block.ends_on > window_end,
        "label": label,
        "subtitle": block.conflict_reason or "Provider calendar block",
        "status": "external",
        "detail_url": None,
        "front_desk_url": None,
        "can_reassign": False,
        "can_release": False,
        "search_text": f"{label.lower()} provider calendar",
    }


def _rows_by_room_and_date(rows: list[InventoryDay]) -> dict[uuid.UUID, list[InventoryDay]]:
    grouped: dict[uuid.UUID, list[InventoryDay]] = {}
    for row in rows:
        grouped.setdefault(row.room_id, []).append(row)
    return grouped


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
