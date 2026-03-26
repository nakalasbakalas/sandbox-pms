from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import joinedload

from ..extensions import db
from ..models import ExternalCalendarBlock, FolioCharge, Guest, HousekeepingStatus, InventoryDay, InventoryOverride, ModificationRequest, Reservation, ReservationHold, Room, utc_now


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
MAX_ROOM_STATUS_BADGES = 4


@dataclass
class FrontDeskBoardFilters:
    start_date: date
    days: int = 14
    q: str = ""
    room_type_id: str = ""
    show_unallocated: bool = True
    show_closed: bool = False
    group_by: str = "type"  # "type" or "floor"


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

    # Batch-fetch folio balance for all visible reservations (single query)
    _res_ids = [r.id for r in reservations]
    _balance_map: dict[uuid.UUID, float] = {}
    if _res_ids:
        from ..extensions import db as _db
        _balance_rows = _db.session.execute(
            sa.select(
                FolioCharge.reservation_id,
                sa.func.sum(FolioCharge.total_amount),
            )
            .where(
                FolioCharge.reservation_id.in_(_res_ids),
                FolioCharge.voided_at.is_(None),
            )
            .group_by(FolioCharge.reservation_id)
        ).all()
        for rid, net in _balance_rows:
            _balance_map[rid] = max(float(net or 0), 0.0)

    # Batch-fetch pending modification request counts (single query)
    _pending_mod_map: dict[uuid.UUID, int] = {}
    if _res_ids:
        _mod_rows = _db.session.execute(
            sa.select(
                ModificationRequest.reservation_id,
                sa.func.count(),
            )
            .where(
                ModificationRequest.reservation_id.in_(_res_ids),
                ModificationRequest.status.in_(("submitted", "reviewed")),
            )
            .group_by(ModificationRequest.reservation_id)
        ).all()
        for rid, cnt in _mod_rows:
            _pending_mod_map[rid] = cnt

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
            db.session.execute(
                sa.select(InventoryDay)
                .where(
                    InventoryDay.room_id.in_(room_ids),
                    InventoryDay.business_date >= window_start,
                    InventoryDay.business_date < window_end,
                )
                .order_by(InventoryDay.room_id.asc(), InventoryDay.business_date.asc())
            )
            .scalars()
            .all()
        )
        overrides = (
            db.session.execute(
                sa.select(InventoryOverride)
                .where(
                    InventoryOverride.is_active.is_(True),
                    InventoryOverride.start_date < window_end,
                    InventoryOverride.end_date >= window_start,
                    sa.or_(
                        InventoryOverride.room_id.in_(room_ids),
                        InventoryOverride.room_type_id.in_(room_type_ids),
                    ),
                )
                .order_by(InventoryOverride.start_date.asc(), InventoryOverride.created_at.asc())
            )
            .scalars()
            .all()
        )
        external_blocks = (
            db.session.execute(
                sa.select(ExternalCalendarBlock)
                .options(joinedload(ExternalCalendarBlock.conflict_reservation))
                .where(
                    ExternalCalendarBlock.room_id.in_(room_ids),
                    ExternalCalendarBlock.starts_on < window_end,
                    ExternalCalendarBlock.ends_on > window_start,
                )
                .order_by(ExternalCalendarBlock.room_id.asc(), ExternalCalendarBlock.starts_on.asc())
            )
            .scalars()
            .all()
        )

    group_map: dict[uuid.UUID, dict[str, Any]] = {}
    room_map: dict[uuid.UUID, dict[str, Any]] = {}

    # Pre-fetch today's housekeeping state for each room
    _today = date.today()
    _today_inv: dict[uuid.UUID, InventoryDay] = {
        row.room_id: row
        for row in db.session.execute(
            sa.select(InventoryDay).where(InventoryDay.business_date == _today)
        ).scalars().all()
    }
    _hk_status_cache: dict[uuid.UUID, str] = {}

    def _hk_code(status_id: uuid.UUID | None) -> str | None:
        if not status_id:
            return None
        if status_id in _hk_status_cache:
            return _hk_status_cache[status_id]
        s = db.session.get(HousekeepingStatus, status_id)
        code = s.code if s else None
        _hk_status_cache[status_id] = code
        return code

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
        _inv = _today_inv.get(room.id)
        _hkc = _hk_code(_inv.housekeeping_status_id) if _inv else None
        _ready_codes = {"clean", "inspected"}
        _is_room_ready = (
            _hkc in _ready_codes
            and _inv is not None
            and not _inv.is_blocked
            and _inv.availability_status not in CLOSED_INVENTORY_STATUSES
            and not _inv.maintenance_flag
        ) if _inv else False
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
            "housekeeping_status": _hkc,
            "housekeepingStatus": _hkc,
            "is_room_ready": _is_room_ready,
            "isRoomReady": _is_room_ready,
            "is_blocked": bool(_inv.is_blocked) if _inv else False,
            "isBlocked": bool(_inv.is_blocked) if _inv else False,
            "is_maintenance": bool(_inv.maintenance_flag) if _inv else False,
            "isMaintenance": bool(_inv.maintenance_flag) if _inv else False,
            "has_arrival_today": False,
            "hasArrivalToday": False,
            "has_departure_today": False,
            "hasDepartureToday": False,
            "is_occupied": False,
            "isOccupied": False,
            "status_badges": [],
            "statusBadges": [],
            "blocks": [],
            "visible_blocks": [],
            "lane_count": 1,
            "track_height": None,
            "search_text": _search_text(
                room.room_number,
                group["room_type_code"],
                group["room_type_name"],
                room.floor_number,
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
        if target_row is not None:
            if reservation.check_in_date == today and reservation.current_status in {"tentative", "confirmed", "checked_in", "house_use"}:
                target_row["has_arrival_today"] = True
                target_row["hasArrivalToday"] = True
            if reservation.check_out_date == today and reservation.current_status in {"checked_in", "checked_out", "house_use"}:
                target_row["has_departure_today"] = True
                target_row["hasDepartureToday"] = True
            if (
                reservation.current_status in {"checked_in", "house_use"}
                and reservation.check_in_date <= today < reservation.check_out_date
            ):
                target_row["is_occupied"] = True
                target_row["isOccupied"] = True
        block = _reservation_block(
            reservation=reservation,
            window_start=window_start,
            window_end=window_end,
            room=room_by_id.get(reservation.assigned_room_id) if reservation.assigned_room_id else None,
            status="conflict" if str(reservation.id) in conflict_reservation_ids else reservation.current_status,
            allocation_state=allocation_state,
            balance_due=_balance_map.get(reservation.id, 0.0),
            is_vip=bool(
                reservation.primary_guest
                and reservation.primary_guest.loyalty
                and reservation.primary_guest.loyalty.tier in ("gold", "platinum")
            ),
        )
        _annotate_reservation_block(
            block=block,
            reservation=reservation,
            allocation_state=allocation_state,
            target_row=target_row,
            today=today,
            pending_modification_count=_pending_mod_map.get(reservation.id, 0),
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
            row["status_badges"] = _room_status_badges(row=row, today=today)
            row["statusBadges"] = row["status_badges"]
            row["lane_count"] = _assign_block_lanes(visible_blocks)
            if row["lane_count"] > 1:
                row["track_height"] = max(74, 18 + (row["lane_count"] * 54))
            row.update(_row_focus_state(row))
            rows.append(row)
        if not filters.show_unallocated:
            rows = [row for row in rows if not row["is_unallocated"]]
        if rows:
            groups.append(group | {"rows": rows})

    # Re-key groups for alternate operating layouts
    if filters.group_by == "floor":
        floor_group_map: dict[int | str, dict[str, Any]] = {}
        floor_order: list[int | str] = []
        for group in groups:
            for row in group["rows"]:
                floor = row.get("floor_number") or 0
                if floor not in floor_group_map:
                    floor_order.append(floor)
                    floor_group_map[floor] = {
                        "room_type_id": f"floor-{floor}",
                        "roomTypeId": f"floor-{floor}",
                        "room_type_code": f"Floor {floor}",
                        "roomTypeCode": f"Floor {floor}",
                        "room_type_name": "",
                        "roomTypeName": "",
                        "room_options": [],
                        "rows": [],
                    }
                floor_group_map[floor]["rows"].append(row)
                seen_ids: set[str] = {o["id"] for o in floor_group_map[floor]["room_options"]}
                for o in group.get("room_options", []):
                    if o.get("floorNumber") == floor and o["id"] not in seen_ids:
                        floor_group_map[floor]["room_options"].append(o)
                        seen_ids.add(o["id"])
        groups = [floor_group_map[f] for f in sorted(floor_order, key=lambda x: (x is None, x))]
        # sort key: None sorts last; numeric floors sort ascending
    elif filters.group_by == "action":
        groups = _group_rows_by_action(groups)
    elif filters.group_by == "turnover":
        groups = _group_rows_by_turnover(groups)

    today_offset = (today - window_start).days + 1 if window_start <= today < window_end else None
    headers = _build_headers(window_start, filters.days, today=today)
    weekend_columns = [h["column"] for h in headers if h["is_weekend"]]
    room_rows = list(room_map.values())

    # Per-day occupancy for heatmap headers (no extra DB queries)
    per_day_occupancy: list[int] = []
    total_room_count = len(room_ids)
    for offset in range(filters.days):
        day = window_start + timedelta(days=offset)
        occupied = set()
        for res in reservations:
            if (
                res.current_status in {"checked_in", "confirmed", "tentative", "house_use"}
                and res.check_in_date <= day < res.check_out_date
                and res.assigned_room_id is not None
                and res.assigned_room_id in room_id_set
            ):
                occupied.add(res.assigned_room_id)
        pct = round(len(occupied) / total_room_count * 100) if total_room_count else 0
        per_day_occupancy.append(pct)

    return {
        "start_date": window_start,
        "startDate": window_start.isoformat(),
        "end_date": window_end,
        "endDate": window_end.isoformat(),
        "days": filters.days,
        "day_options": list(BOARD_VISIBLE_DAY_OPTIONS),
        "headers": headers,
        "weekend_track_bg": _build_weekend_track_bg(weekend_columns, filters.days),
        "groups": groups,
        "room_options": [
            {
                "id": str(room.id),
                "label": f"Room {room.room_number} - {room.room_type.code if room.room_type else ''}",
            }
            for room in rooms
        ],
        "counts": _compute_extended_counts(
            base_counts={
                "unallocated": unallocated_count,
                "closed_or_blocked": len(operational_room_ids),
                "arrivals_today": _count_arrivals(today, filters.room_type_id),
                "departures_today": _count_departures(today, filters.room_type_id),
                "occupied": sum(1 for row in room_rows if row["is_occupied"]),
                "ready_rooms": sum(1 for row in room_rows if row["is_room_ready"] and not row["is_occupied"]),
            },
            room_rows=room_rows,
            today_inv=_today_inv,
            hk_code_fn=_hk_code,
            room_ids=room_ids,
            room_type_meta=room_type_meta,
            today=today,
            room_type_id_filter=filters.room_type_id,
        ),
        "alerts": _compute_operational_alerts(
            room_rows=room_rows,
            today=today,
            room_type_id_filter=filters.room_type_id,
        ),
        "exceptionQueues": _build_exception_queues(groups),
        "handover": _build_handover_snapshot(groups),
        "today_offset": today_offset,
        "todayOffset": today_offset,
        "current_window_label": f"{window_start.strftime('%d %b %Y')} - {(window_end - timedelta(days=1)).strftime('%d %b %Y')}",
        "prev_start_date": window_start - timedelta(days=filters.days),
        "next_start_date": window_start + timedelta(days=filters.days),
        "today": today,
        "per_day_occupancy": per_day_occupancy,
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
    stmt = sa.select(Room).options(joinedload(Room.room_type)).where(Room.is_active.is_(True))
    if room_type_id:
        stmt = stmt.where(Room.room_type_id == uuid.UUID(room_type_id))
    return db.session.execute(
        stmt.order_by(Room.room_type_id.asc(), Room.room_number.asc())
    ).scalars().all()


def _reservation_query(*, room_type_id: str, window_start: date, window_end: date) -> list[Reservation]:
    stmt = sa.select(Reservation).options(
        joinedload(Reservation.primary_guest).joinedload(Guest.loyalty),
        joinedload(Reservation.room_type),
        joinedload(Reservation.assigned_room),
    ).where(
        Reservation.current_status.in_(tuple(ACTIVE_BOARD_RESERVATION_STATUSES)),
        Reservation.check_in_date < window_end,
        Reservation.check_out_date > window_start,
    )
    if room_type_id:
        stmt = stmt.where(Reservation.room_type_id == uuid.UUID(room_type_id))
    return db.session.execute(
        stmt.order_by(Reservation.check_in_date.asc(), Reservation.booked_at.asc())
    ).scalars().all()


def _hold_query(*, room_type_id: str, window_start: date, window_end: date) -> list[ReservationHold]:
    stmt = sa.select(ReservationHold).where(
        ReservationHold.status.in_(tuple(ACTIVE_BOARD_HOLD_STATUSES)),
        ReservationHold.check_in_date < window_end,
        ReservationHold.check_out_date > window_start,
        ReservationHold.expires_at > utc_now(),
    )
    if room_type_id:
        stmt = stmt.where(ReservationHold.room_type_id == uuid.UUID(room_type_id))
    return db.session.execute(
        stmt.order_by(ReservationHold.check_in_date.asc(), ReservationHold.created_at.asc())
    ).scalars().all()


def _build_weekend_track_bg(weekend_columns: list[int], days: int) -> str:
    """Build a CSS linear-gradient string for weekend column highlights."""
    if not weekend_columns or not days:
        return "none"
    stops: list[str] = []
    for col in weekend_columns:
        stops.extend([
            f"transparent calc({col - 1} / {days} * 100%)",
            f"rgba(77,157,255,0.07) calc({col - 1} / {days} * 100%)",
            f"rgba(77,157,255,0.07) calc({col} / {days} * 100%)",
            f"transparent calc({col} / {days} * 100%)",
        ])
    return f"linear-gradient(90deg, {', '.join(stops)})"


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
                "is_month_boundary": business_date.day == 1 or offset == 0,
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
        "status_badges": [],
        "statusBadges": [],
        "blocks": [],
        "visible_blocks": [],
        "lane_count": 1,
        "track_height": None,
        "search_text": _search_text("unallocated", group["room_type_code"], group["room_type_name"]),
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
    balance_due: float = 0.0,
    is_vip: bool = False,
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
            "balanceDue": balance_due,
            "hasSpecialRequests": bool(reservation.special_requests),
            "isVip": is_vip,
        },
    )


def _annotate_reservation_block(
    *,
    block: dict[str, Any],
    reservation: Reservation,
    allocation_state: str,
    target_row: dict[str, Any] | None,
    today: date,
    pending_modification_count: int,
) -> None:
    deposit_gap = max(
        Decimal("0.00"),
        Decimal(str(reservation.deposit_required_amount or 0)) - Decimal(str(reservation.deposit_received_amount or 0)),
    )
    is_arrival_due = reservation.current_status in {"tentative", "confirmed"} and reservation.check_in_date <= today
    is_departure_due = reservation.current_status == "checked_in" and reservation.check_out_date == today
    room_assigned = allocation_state == "allocated" and target_row is not None
    room_ready = bool(target_row and target_row.get("is_room_ready"))
    dirty_turnaround = bool(
        is_arrival_due
        and target_row
        and target_row.get("has_departure_today")
        and target_row.get("housekeeping_status") in {"dirty", "occupied_dirty"}
    )

    blocker_reasons: list[dict[str, Any]] = []
    if is_arrival_due and not room_assigned:
        blocker_reasons.append({"code": "room_assignment", "label": "Assign room", "tone": "warning", "blocking": True})
    if is_arrival_due and dirty_turnaround:
        blocker_reasons.append({"code": "dirty_turnaround", "label": "Dirty turnaround", "tone": "danger", "blocking": True})
    elif is_arrival_due and room_assigned and not room_ready:
        blocker_reasons.append({"code": "room_not_ready", "label": "Room not ready", "tone": "warning", "blocking": True})
    if is_arrival_due and deposit_gap > Decimal("0.00"):
        blocker_reasons.append({"code": "unpaid_deposit", "label": "Collect deposit", "tone": "danger", "blocking": True})
    if reservation.special_requests and is_arrival_due:
        blocker_reasons.append({"code": "special_requests", "label": "Review requests", "tone": "info", "blocking": False})
    if pending_modification_count:
        blocker_reasons.append({"code": "pending_modification", "label": "Pending change request", "tone": "muted", "blocking": False})

    has_blocking_reason = any(item["blocking"] for item in blocker_reasons)
    ready_for_checkin = is_arrival_due and room_assigned and room_ready and deposit_gap <= Decimal("0.00")

    if ready_for_checkin:
        workflow_state = "arrival_ready"
        next_action = "Check in"
        urgency = "high"
        action_summary = "Ready to check in now"
    elif is_arrival_due and has_blocking_reason:
        workflow_state = "arrival_blocked"
        first_blocker = next((item for item in blocker_reasons if item["blocking"]), None)
        next_action = first_blocker["label"] if first_blocker else "Resolve blockers"
        urgency = "critical" if any(item["code"] in {"room_assignment", "dirty_turnaround"} for item in blocker_reasons) else "high"
        action_summary = "Resolve blockers before arrival"
    elif is_departure_due:
        workflow_state = "departure_due"
        next_action = "Check out"
        urgency = "high"
        action_summary = "Departure due today"
    elif reservation.current_status == "checked_in":
        workflow_state = "in_house"
        next_action = "Review stay"
        urgency = "normal"
        action_summary = "Guest currently in house"
    elif allocation_state == "unallocated":
        workflow_state = "unallocated"
        next_action = "Assign room"
        urgency = "medium"
        action_summary = "Room still needs assignment"
    else:
        workflow_state = "scheduled"
        next_action = "Open details"
        urgency = "normal"
        action_summary = "Scheduled stay"

    block["readyForCheckIn"] = ready_for_checkin
    block["pendingModification"] = pending_modification_count > 0
    block["depositGap"] = float(deposit_gap)
    block["arrivalDue"] = is_arrival_due
    block["departureDue"] = is_departure_due
    block["roomAssigned"] = room_assigned
    block["roomReady"] = room_ready
    block["turnaroundDirty"] = dirty_turnaround
    block["workflowState"] = workflow_state
    block["nextAction"] = next_action
    block["urgency"] = urgency
    block["actionSummary"] = action_summary
    block["blockerReasons"] = blocker_reasons


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
    search_text = _search_text(*search_parts)
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
        "searchText": search_text,
        "search_text": search_text,
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


def _room_status_badges(*, row: dict[str, Any], today: date) -> list[dict[str, str]]:
    if row.get("is_unallocated"):
        return []
    badges: list[dict[str, str]] = []
    has_operational_badge = False
    active_operational_block = None
    for block in row.get("blocks", []):
        if block.get("sourceType") not in BOARD_OPERATIONAL_BLOCK_TYPES:
            continue
        block_start = date.fromisoformat(block["startDate"])
        block_end = date.fromisoformat(block["endDateExclusive"])
        if block_start <= today < block_end:
            active_operational_block = block
            break
    if row.get("is_maintenance") or (active_operational_block and active_operational_block.get("sourceType") == "maintenance"):
        badges.append({"label": "Maintenance", "tone": "danger"})
        has_operational_badge = True
    elif row.get("is_blocked") or (active_operational_block and active_operational_block.get("sourceType") == "blocked"):
        badges.append({"label": "Blocked", "tone": "warning"})
        has_operational_badge = True
    elif active_operational_block:
        badges.append({"label": "Closed", "tone": "muted"})
        has_operational_badge = True
    if not has_operational_badge:
        badges.append({"label": "Occupied" if row.get("is_occupied") else "Vacant", "tone": "solid" if row.get("is_occupied") else "neutral"})
    if row.get("has_arrival_today"):
        badges.append({"label": "Arr today", "tone": "accent"})
    if row.get("has_departure_today"):
        badges.append({"label": "Dep today", "tone": "accent-soft"})
    hk_status = (row.get("housekeeping_status") or "").replace("_", " ").strip()
    if row.get("is_room_ready") and not row.get("is_occupied"):
        badges.append({"label": "Ready", "tone": "success"})
    elif hk_status:
        badges.append({"label": f"HK {hk_status}", "tone": "muted"})
    return badges[:MAX_ROOM_STATUS_BADGES]


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
                block["lane_index"] = lane_index
                lane_end_dates[lane_index - 1] = block_end
                break
        else:
            lane_end_dates.append(block_end)
            block["laneIndex"] = len(lane_end_dates)
            block["lane_index"] = len(lane_end_dates)
    return max(len(lane_end_dates), 1)


def _row_focus_state(row: dict[str, Any]) -> dict[str, Any]:
    reservation_blocks = [block for block in row.get("visible_blocks", []) if block.get("sourceType") == "reservation"]
    if not reservation_blocks:
        return {
            "focusAction": "",
            "focusUrgency": "",
            "focusSummary": "",
            "focusReservationId": None,
            "focusBlockers": [],
        }
    focus_block = sorted(
        reservation_blocks,
        key=lambda block: (
            _urgency_rank(block.get("urgency")),
            0 if block.get("arrivalDue") else 1,
            0 if block.get("workflowState") == "departure_due" else 1,
            block.get("label") or "",
        ),
    )[0]
    return {
        "focusAction": focus_block.get("nextAction") or "",
        "focusUrgency": focus_block.get("urgency") or "",
        "focusSummary": focus_block.get("actionSummary") or "",
        "focusReservationId": focus_block.get("reservationId"),
        "focusBlockers": focus_block.get("blockerReasons", [])[:2],
    }


def _build_exception_queues(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    queue_defs = [
        ("ready_arrivals", "Ready Arrivals", "success", lambda item: item["workflowState"] == "arrival_ready"),
        ("blocked_arrivals", "Blocked Arrivals", "danger", lambda item: item["workflowState"] == "arrival_blocked"),
        ("dirty_turnarounds", "Dirty Turnarounds", "danger", lambda item: "dirty_turnaround" in item["blockerCodes"]),
        ("unallocated_arrivals", "Unallocated Arrivals", "warning", lambda item: "room_assignment" in item["blockerCodes"]),
        ("unpaid_arrivals", "Unpaid Arrivals", "danger", lambda item: "unpaid_deposit" in item["blockerCodes"]),
        ("special_requests", "Special Requests", "info", lambda item: "special_requests" in item["blockerCodes"]),
    ]
    queue_items = _queue_items_for_blocks(groups)
    queues: list[dict[str, Any]] = []
    for queue_id, title, tone, matcher in queue_defs:
        items = [item for item in queue_items if matcher(item)]
        queues.append(
            {
                "id": queue_id,
                "title": title,
                "tone": tone,
                "count": len(items),
                "items": items[:6],
            }
        )
    return queues


def _build_handover_snapshot(groups: list[dict[str, Any]]) -> dict[str, Any]:
    unresolved = [
        item
        for item in _queue_items_for_blocks(groups)
        if item["workflowState"] in {"arrival_blocked", "departure_due"}
        or item["blockerCodes"]
    ]
    return {
        "items": unresolved[:10],
        "count": len(unresolved),
    }


def _group_rows_by_action(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bucket_defs = [
        ("blocked_arrivals", "Blocked Arrivals"),
        ("ready_arrivals", "Ready Arrivals"),
        ("dirty_turnarounds", "Dirty Turnarounds"),
        ("departures", "Departures"),
        ("in_house", "In-House Watch"),
        ("quiet", "Quiet Rooms"),
    ]
    bucket_map = {
        bucket_id: {
            "room_type_id": bucket_id,
            "roomTypeId": bucket_id,
            "room_type_code": title,
            "roomTypeCode": title,
            "room_type_name": "",
            "roomTypeName": "",
            "room_options": [],
            "rows": [],
        }
        for bucket_id, title in bucket_defs
    }
    for row in _flatten_group_rows(groups):
        bucket_map[_action_bucket_for_row(row)]["rows"].append(row)
    return [bucket_map[bucket_id] for bucket_id, _title in bucket_defs if bucket_map[bucket_id]["rows"]]


def _group_rows_by_turnover(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bucket_defs = [
        ("turnovers_now", "Turnovers Now"),
        ("arrivals", "Arrivals"),
        ("departures", "Departures"),
        ("watchlist", "Watchlist"),
        ("quiet", "Quiet Rooms"),
    ]
    bucket_map = {
        bucket_id: {
            "room_type_id": bucket_id,
            "roomTypeId": bucket_id,
            "room_type_code": title,
            "roomTypeCode": title,
            "room_type_name": "",
            "roomTypeName": "",
            "room_options": [],
            "rows": [],
        }
        for bucket_id, title in bucket_defs
    }
    for row in _flatten_group_rows(groups):
        bucket_map[_turnover_bucket_for_row(row)]["rows"].append(row)
    return [bucket_map[bucket_id] for bucket_id, _title in bucket_defs if bucket_map[bucket_id]["rows"]]


def _flatten_group_rows(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [row for group in groups for row in group.get("rows", [])]


def _action_bucket_for_row(row: dict[str, Any]) -> str:
    reservation_blocks = [block for block in row.get("visible_blocks", []) if block.get("sourceType") == "reservation"]
    if any(block.get("workflowState") == "arrival_blocked" for block in reservation_blocks):
        return "blocked_arrivals"
    if any(_block_has_reason(block, "dirty_turnaround") for block in reservation_blocks):
        return "dirty_turnarounds"
    if any(block.get("workflowState") == "arrival_ready" for block in reservation_blocks):
        return "ready_arrivals"
    if row.get("has_departure_today"):
        return "departures"
    if row.get("is_occupied") or any(block.get("displayVariant") == "in_house" for block in reservation_blocks):
        return "in_house"
    return "quiet"


def _turnover_bucket_for_row(row: dict[str, Any]) -> str:
    reservation_blocks = [block for block in row.get("visible_blocks", []) if block.get("sourceType") == "reservation"]
    if row.get("has_arrival_today") and row.get("has_departure_today"):
        return "turnovers_now"
    if row.get("has_arrival_today") or any(block.get("workflowState", "").startswith("arrival_") for block in reservation_blocks):
        return "arrivals"
    if row.get("has_departure_today"):
        return "departures"
    if row.get("focusUrgency") in {"critical", "high"}:
        return "watchlist"
    return "quiet"


def _block_has_reason(block: dict[str, Any], code: str) -> bool:
    return any(reason.get("code") == code for reason in block.get("blockerReasons", []))


def _queue_items_for_blocks(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for group in groups:
        for row in group.get("rows", []):
            for block in row.get("visible_blocks", []):
                if block.get("sourceType") != "reservation":
                    continue
                blocker_reasons = block.get("blockerReasons", [])
                items.append(
                    {
                        "reservationId": block.get("reservationId"),
                        "label": block.get("label"),
                        "roomLabel": row.get("label"),
                        "roomSecondaryLabel": row.get("secondary_label"),
                        "roomAnchorId": row.get("anchor_id"),
                        "roomTypeCode": group.get("room_type_code"),
                        "nextAction": block.get("nextAction"),
                        "workflowState": block.get("workflowState"),
                        "urgency": block.get("urgency"),
                        "actionSummary": block.get("actionSummary"),
                        "blockers": [reason.get("label") for reason in blocker_reasons],
                        "blockerCodes": [reason.get("code") for reason in blocker_reasons],
                    }
                )
    return sorted(
        items,
        key=lambda item: (
            _urgency_rank(item.get("urgency")),
            item.get("roomLabel") or "",
            item.get("label") or "",
        ),
    )


def _urgency_rank(value: str | None) -> int:
    return {"critical": 0, "high": 1, "medium": 2, "normal": 3}.get((value or "").strip(), 4)


def _search_text(*parts: Any) -> str:
    return " ".join(str(part).lower() for part in parts if part is not None and str(part).strip())


def _serialize_value(value: Any) -> Any:
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: _serialize_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_serialize_value(item) for item in value]
    return value


def _compute_extended_counts(
    *,
    base_counts: dict[str, Any],
    room_rows: list[dict[str, Any]],
    today_inv: dict[uuid.UUID, InventoryDay],
    hk_code_fn,
    room_ids: list[uuid.UUID],
    room_type_meta: dict[uuid.UUID, dict[str, str]],
    today: date,
    room_type_id_filter: str,
) -> dict[str, Any]:
    """Extend the base board counts with HK breakdown, availability by type, and payment alerts."""
    counts = dict(base_counts)
    counts["total_rooms"] = len(room_ids)
    counts["stayovers"] = sum(
        1 for row in room_rows
        if row.get("is_occupied") and not row.get("has_departure_today")
    )

    hk_dirty = 0
    hk_clean = 0
    hk_inspected = 0
    ooo = 0
    oos = 0
    room_id_set = set(room_ids)
    for inv in today_inv.values():
        if inv.room_id not in room_id_set:
            continue
        code = hk_code_fn(inv.housekeeping_status_id)
        if code in ("dirty", "occupied_dirty"):
            hk_dirty += 1
        elif code in ("clean", "occupied_clean"):
            hk_clean += 1
        elif code == "inspected":
            hk_inspected += 1
        if inv.availability_status == "out_of_order":
            ooo += 1
        elif inv.availability_status == "out_of_service":
            oos += 1
    counts["hk_dirty"] = hk_dirty
    counts["hk_clean"] = hk_clean
    counts["hk_inspected"] = hk_inspected
    counts["out_of_order"] = ooo
    counts["out_of_service"] = oos

    avail_by_type: dict[str, int] = {}
    for row in room_rows:
        if row.get("is_unallocated"):
            continue
        code = row.get("room_type_code", "")
        if not code:
            continue
        if code not in avail_by_type:
            avail_by_type[code] = 0
        is_available = (
            not row.get("is_occupied")
            and not row.get("is_blocked")
            and not row.get("is_maintenance")
        )
        if is_available:
            avail_by_type[code] += 1
    counts["available_by_type"] = avail_by_type

    # Total rooms per type (for bar charts)
    total_by_type: dict[str, int] = {}
    for row in room_rows:
        if row.get("is_unallocated"):
            continue
        code = row.get("room_type_code", "")
        if code:
            total_by_type[code] = total_by_type.get(code, 0) + 1
    counts["total_by_type"] = total_by_type

    # Available rooms (not occupied, not blocked, not maintenance)
    counts["available_rooms"] = sum(avail_by_type.values())

    # Maintenance/blocked count
    counts["maintenance_count"] = sum(
        1 for row in room_rows
        if row.get("is_maintenance") or row.get("is_blocked")
    )

    # Turnaround rooms needing attention
    counts["turnaround_dirty"] = sum(
        1 for row in room_rows
        if row.get("has_departure_today") and row.get("has_arrival_today")
        and row.get("housekeeping_status") in ("dirty", "occupied_dirty")
    )

    # Occupancy percentage (pre-computed to avoid duplicate template calculation)
    total = counts.get("total_rooms", 0)
    counts["occupancy_pct"] = round(counts.get("occupied", 0) / total * 100) if total else 0

    unpaid_conditions = [
        Reservation.check_in_date == today,
        Reservation.current_status.in_(["tentative", "confirmed"]),
        Reservation.deposit_required_amount > 0,
        Reservation.deposit_received_amount < Reservation.deposit_required_amount,
    ]
    if room_type_id_filter:
        unpaid_conditions.append(Reservation.room_type_id == uuid.UUID(room_type_id_filter))
    counts["unpaid_arrivals"] = int(
        db.session.execute(
            sa.select(sa.func.count()).select_from(Reservation).where(*unpaid_conditions)
        ).scalar_one()
        or 0
    )

    unassigned_conditions = [
        Reservation.check_in_date == today,
        Reservation.current_status.in_(["tentative", "confirmed"]),
        Reservation.assigned_room_id.is_(None),
    ]
    if room_type_id_filter:
        unassigned_conditions.append(Reservation.room_type_id == uuid.UUID(room_type_id_filter))
    counts["unassigned_arrivals_today"] = int(
        db.session.execute(
            sa.select(sa.func.count()).select_from(Reservation).where(*unassigned_conditions)
        ).scalar_one()
        or 0
    )

    # Conflict count: critical situations needing immediate staff attention
    counts["conflict_count"] = counts["turnaround_dirty"] + counts["unassigned_arrivals_today"]

    # Check-in readiness: % of today's arrivals that are actionable (assigned + not a dirty turnaround)
    _arrivals_today = counts.get("arrivals_today", 0)
    _blocked = counts["turnaround_dirty"] + counts["unassigned_arrivals_today"]
    counts["checkin_readiness_pct"] = (
        max(0, round((_arrivals_today - _blocked) / _arrivals_today * 100))
        if _arrivals_today > 0
        else 100
    )

    return counts


def _compute_operational_alerts(
    *,
    room_rows: list[dict[str, Any]],
    today: date,
    room_type_id_filter: str,
) -> list[dict[str, str]]:
    """Compute actionable alert messages for the board surface."""
    alerts: list[dict[str, str]] = []

    unpaid_conditions = [
        Reservation.check_in_date == today,
        Reservation.current_status.in_(["tentative", "confirmed"]),
        Reservation.deposit_required_amount > 0,
        Reservation.deposit_received_amount < Reservation.deposit_required_amount,
    ]
    if room_type_id_filter:
        unpaid_conditions.append(Reservation.room_type_id == uuid.UUID(room_type_id_filter))
    n = int(
        db.session.execute(
            sa.select(sa.func.count()).select_from(Reservation).where(*unpaid_conditions)
        ).scalar_one()
        or 0
    )
    if n > 0:
        alerts.append({"message": f"{n} arrival{'s' if n != 1 else ''} with unpaid deposit", "tone": "danger"})

    unassigned_conditions = [
        Reservation.check_in_date == today,
        Reservation.current_status.in_(["tentative", "confirmed"]),
        Reservation.assigned_room_id.is_(None),
    ]
    if room_type_id_filter:
        unassigned_conditions.append(Reservation.room_type_id == uuid.UUID(room_type_id_filter))
    n = int(
        db.session.execute(
            sa.select(sa.func.count()).select_from(Reservation).where(*unassigned_conditions)
        ).scalar_one()
        or 0
    )
    if n > 0:
        alerts.append({"message": f"{n} today's arrival{'s' if n != 1 else ''} unassigned", "tone": "warning"})

    turnaround_dirty = sum(
        1 for row in room_rows
        if row.get("has_departure_today") and row.get("has_arrival_today")
        and row.get("housekeeping_status") in ("dirty", "occupied_dirty")
    )
    if turnaround_dirty > 0:
        alerts.append({"message": f"{turnaround_dirty} turnaround room{'s' if turnaround_dirty != 1 else ''} still dirty", "tone": "danger"})

    specials_conditions = [
        Reservation.check_in_date == today,
        Reservation.current_status.in_(["tentative", "confirmed"]),
        Reservation.special_requests.isnot(None),
        Reservation.special_requests != "",
    ]
    if room_type_id_filter:
        specials_conditions.append(Reservation.room_type_id == uuid.UUID(room_type_id_filter))
    n = int(
        db.session.execute(
            sa.select(sa.func.count()).select_from(Reservation).where(*specials_conditions)
        ).scalar_one()
        or 0
    )
    if n > 0:
        alerts.append({"message": f"{n} arrival{'s' if n != 1 else ''} with special requests", "tone": "info"})

    return alerts


def _count_arrivals(target_date: date, room_type_id: str) -> int:
    conditions = [
        Reservation.check_in_date == target_date,
        Reservation.current_status.in_(["tentative", "confirmed"]),
    ]
    if room_type_id:
        conditions.append(Reservation.room_type_id == uuid.UUID(room_type_id))
    return int(
        db.session.execute(
            sa.select(sa.func.count()).select_from(Reservation).where(*conditions)
        ).scalar_one()
        or 0
    )


def _count_departures(target_date: date, room_type_id: str) -> int:
    conditions = [
        Reservation.check_out_date == target_date,
        Reservation.current_status.in_(["checked_in", "checked_out"]),
    ]
    if room_type_id:
        conditions.append(Reservation.room_type_id == uuid.UUID(room_type_id))
    return int(
        db.session.execute(
            sa.select(sa.func.count()).select_from(Reservation).where(*conditions)
        ).scalar_one()
        or 0
    )
