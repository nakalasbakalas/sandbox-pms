"""Shared front-desk board imports, filters, and helper functions."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import joinedload

from ..extensions import db
from ..models import ExternalCalendarBlock, FolioCharge, HousekeepingStatus, InventoryDay, InventoryOverride, ModificationRequest, Reservation, ReservationHold, Room, utc_now


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



def _room_query(room_type_id: str) -> list[Room]:
    stmt = sa.select(Room).options(joinedload(Room.room_type)).where(Room.is_active.is_(True))
    if room_type_id:
        stmt = stmt.where(Room.room_type_id == uuid.UUID(room_type_id))
    return db.session.execute(
        stmt.order_by(Room.room_type_id.asc(), Room.room_number.asc())
    ).scalars().all()


def _reservation_query(*, room_type_id: str, window_start: date, window_end: date) -> list[Reservation]:
    stmt = sa.select(Reservation).options(
        joinedload(Reservation.primary_guest),
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
        "track_height": 74,
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
