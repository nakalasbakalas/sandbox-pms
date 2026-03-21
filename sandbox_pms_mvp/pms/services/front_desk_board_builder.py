"""Front-desk board builders and serialization helpers."""

from __future__ import annotations

from .front_desk_board_base import *  # noqa: F401,F403
from . import front_desk_board_base as _base

_assign_block_lanes = _base._assign_block_lanes
_build_headers = _base._build_headers
_build_weekend_track_bg = _base._build_weekend_track_bg
_compute_extended_counts = _base._compute_extended_counts
_compute_operational_alerts = _base._compute_operational_alerts
_count_arrivals = _base._count_arrivals
_count_departures = _base._count_departures
_ensure_group = _base._ensure_group
_ensure_unallocated_row = _base._ensure_unallocated_row
_external_block = _base._external_block
_hold_block = _base._hold_block
_hold_query = _base._hold_query
_inventory_state_blocks = _base._inventory_state_blocks
_override_block = _base._override_block
_reservation_block = _base._reservation_block
_reservation_query = _base._reservation_query
_room_query = _base._room_query
_room_status_badges = _base._room_status_badges
_rows_by_room_and_date = _base._rows_by_room_and_date
_search_text = _base._search_text
_serialize_value = _base._serialize_value

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
            "track_height": 74,
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
        )
        # Flag reservation as ready for check-in: confirmed, arriving today, room assigned & ready
        block["readyForCheckIn"] = (
            reservation.current_status == "confirmed"
            and reservation.check_in_date <= today
            and allocation_state == "allocated"
            and target_row is not None
            and target_row.get("is_room_ready", False)
        )
        # Flag reservation with pending modification request(s)
        block["pendingModification"] = _pending_mod_map.get(reservation.id, 0) > 0
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
            row["track_height"] = max(74, 18 + (row["lane_count"] * 54))
            rows.append(row)
        if not filters.show_unallocated:
            rows = [row for row in rows if not row["is_unallocated"]]
        if rows:
            groups.append(group | {"rows": rows})

    today_offset = (today - window_start).days + 1 if window_start <= today < window_end else None
    headers = _build_headers(window_start, filters.days, today=today)
    weekend_columns = [h["column"] for h in headers if h["is_weekend"]]
    room_rows = list(room_map.values())
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


