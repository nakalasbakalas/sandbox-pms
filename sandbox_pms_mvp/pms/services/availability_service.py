"""Centralized availability service.

All availability queries and inventory mutations flow through this module so
the rest of the codebase has a single source of truth for room sellability.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, timedelta

import sqlalchemy as sa

from ..extensions import db
from ..models import (
    BlackoutPeriod,
    ExternalCalendarBlock,
    InventoryDay,
    InventoryOverride,
    Reservation,
    Room,
    RoomType,
)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class RoomTypeAvailability:
    """Availability summary for a single room type over a date range."""

    room_type_id: uuid.UUID
    room_type_code: str
    room_type_name: str
    total_rooms: int
    available_rooms: int
    dates: list[DateAvailability]


@dataclass
class DateAvailability:
    """Per-date availability detail for a room type."""

    business_date: date
    total_rooms: int
    available_count: int
    is_sellable: bool


@dataclass
class RoomAssignability:
    """Whether a specific room can accept a reservation for given dates."""

    room_id: uuid.UUID
    room_number: str
    is_assignable: bool
    blocking_reason: str | None = None


@dataclass
class InventoryImpact:
    """Projected inventory change from a booking action."""

    action: str  # create, modify, cancel, extend, move
    room_type_id: uuid.UUID
    affected_dates: list[date]
    rooms_released: int
    rooms_consumed: int
    net_change: int


# ---------------------------------------------------------------------------
# Core queries
# ---------------------------------------------------------------------------

def _stay_dates(check_in: date, check_out: date):
    cursor = check_in
    while cursor < check_out:
        yield cursor
        cursor += timedelta(days=1)


def query_room_type_availability(
    check_in: date,
    check_out: date,
    room_type_id: uuid.UUID | None = None,
) -> list[RoomTypeAvailability]:
    """Return availability per room type for the requested date range.

    Checks InventoryDay, external calendar blocks, inventory overrides, and
    blackout periods.
    """
    nights = list(_stay_dates(check_in, check_out))
    if not nights:
        return []

    rt_filter = [RoomType.is_active.is_(True)]
    if room_type_id:
        rt_filter.append(RoomType.id == room_type_id)
    room_types = (
        db.session.execute(sa.select(RoomType).where(*rt_filter).order_by(RoomType.name.asc()))
        .scalars()
        .all()
    )

    # Pre-fetch blackout dates that block booking
    blackout_dates = _blackout_dates(check_in, check_out)

    results: list[RoomTypeAvailability] = []
    for rt in room_types:
        rooms = (
            db.session.execute(
                sa.select(Room).where(
                    Room.room_type_id == rt.id,
                    Room.is_active.is_(True),
                    Room.is_sellable.is_(True),
                )
            )
            .scalars()
            .all()
        )
        total_rooms = len(rooms)
        room_ids = [r.id for r in rooms]

        # Fetch inventory rows for all rooms of this type
        inv_rows = (
            db.session.execute(
                sa.select(InventoryDay).where(
                    InventoryDay.room_id.in_(room_ids),
                    InventoryDay.business_date.in_(nights),
                )
            )
            .scalars()
            .all()
            if room_ids
            else []
        )
        inv_map: dict[tuple[uuid.UUID, date], InventoryDay] = {
            (row.room_id, row.business_date): row for row in inv_rows
        }

        # External calendar blocks
        blocked_room_dates = _external_blocked_room_dates(room_ids, check_in, check_out)

        # Inventory overrides
        override_closed = _override_closed_room_dates(room_ids, rt.id, check_in, check_out)

        date_details: list[DateAvailability] = []
        min_available = total_rooms  # bottleneck across the range
        for night in nights:
            if night in blackout_dates:
                date_details.append(DateAvailability(
                    business_date=night, total_rooms=total_rooms,
                    available_count=0, is_sellable=False,
                ))
                min_available = 0
                continue

            avail_count = 0
            for room in rooms:
                if (room.id, night) in blocked_room_dates:
                    continue
                if (room.id, night) in override_closed:
                    continue
                inv = inv_map.get((room.id, night))
                if inv and _row_is_available(inv):
                    avail_count += 1
                elif not inv:
                    # No inventory row bootstrapped yet — treat as unavailable
                    pass
            date_details.append(DateAvailability(
                business_date=night, total_rooms=total_rooms,
                available_count=avail_count, is_sellable=avail_count > 0,
            ))
            min_available = min(min_available, avail_count)

        results.append(RoomTypeAvailability(
            room_type_id=rt.id,
            room_type_code=rt.code,
            room_type_name=rt.name,
            total_rooms=total_rooms,
            available_rooms=min_available,
            dates=date_details,
        ))
    return results


def count_available_rooms(
    room_type_id: uuid.UUID,
    check_in: date,
    check_out: date,
) -> int:
    """Return the minimum number of available rooms across the stay dates."""
    avail = query_room_type_availability(check_in, check_out, room_type_id)
    if not avail:
        return 0
    return avail[0].available_rooms


def can_move_reservation(
    reservation_id: uuid.UUID,
    target_room_id: uuid.UUID,
    check_in: date | None = None,
    check_out: date | None = None,
) -> RoomAssignability:
    """Check whether *reservation_id* can be moved to *target_room_id*."""
    reservation = db.session.get(Reservation, reservation_id)
    if not reservation:
        return RoomAssignability(
            room_id=target_room_id, room_number="?",
            is_assignable=False, blocking_reason="Reservation not found.",
        )
    room = db.session.get(Room, target_room_id)
    if not room:
        return RoomAssignability(
            room_id=target_room_id, room_number="?",
            is_assignable=False, blocking_reason="Target room not found.",
        )
    if not room.is_active or not room.is_sellable:
        return RoomAssignability(
            room_id=target_room_id, room_number=room.room_number,
            is_assignable=False, blocking_reason="Room is not active/sellable.",
        )
    if room.room_type_id != reservation.room_type_id:
        return RoomAssignability(
            room_id=target_room_id, room_number=room.room_number,
            is_assignable=False, blocking_reason="Room type mismatch.",
        )
    ci = check_in or reservation.check_in_date
    co = check_out or reservation.check_out_date
    nights = list(_stay_dates(ci, co))

    # Check external blocks
    if _room_has_external_block(room.id, ci, co):
        return RoomAssignability(
            room_id=target_room_id, room_number=room.room_number,
            is_assignable=False, blocking_reason="Room blocked by external calendar.",
        )

    # Check inventory
    rows = (
        db.session.execute(
            sa.select(InventoryDay).where(
                InventoryDay.room_id == room.id,
                InventoryDay.business_date.in_(nights),
            )
        )
        .scalars()
        .all()
    )
    if len(rows) != len(nights):
        return RoomAssignability(
            room_id=target_room_id, room_number=room.room_number,
            is_assignable=False, blocking_reason="Inventory not bootstrapped for all dates.",
        )
    for row in rows:
        # Allow if this row belongs to the same reservation (self-move)
        if row.reservation_id == reservation_id:
            continue
        if not _row_is_available(row):
            return RoomAssignability(
                room_id=target_room_id, room_number=room.room_number,
                is_assignable=False,
                blocking_reason=f"Room occupied/blocked on {row.business_date.isoformat()}.",
            )
    return RoomAssignability(
        room_id=target_room_id, room_number=room.room_number,
        is_assignable=True,
    )


def list_assignable_rooms(
    room_type_id: uuid.UUID,
    check_in: date,
    check_out: date,
    exclude_reservation_id: uuid.UUID | None = None,
) -> list[RoomAssignability]:
    """Return all rooms of *room_type_id* that are assignable for the dates."""
    rooms = (
        db.session.execute(
            sa.select(Room)
            .where(
                Room.room_type_id == room_type_id,
                Room.is_active.is_(True),
                Room.is_sellable.is_(True),
            )
            .order_by(Room.room_number.asc())
        )
        .scalars()
        .all()
    )
    nights = list(_stay_dates(check_in, check_out))
    result: list[RoomAssignability] = []
    for room in rooms:
        if _room_has_external_block(room.id, check_in, check_out):
            result.append(RoomAssignability(
                room_id=room.id, room_number=room.room_number,
                is_assignable=False, blocking_reason="External calendar block.",
            ))
            continue
        rows = (
            db.session.execute(
                sa.select(InventoryDay).where(
                    InventoryDay.room_id == room.id,
                    InventoryDay.business_date.in_(nights),
                )
            )
            .scalars()
            .all()
        )
        if len(rows) != len(nights):
            result.append(RoomAssignability(
                room_id=room.id, room_number=room.room_number,
                is_assignable=False, blocking_reason="Inventory not bootstrapped.",
            ))
            continue
        ok = True
        for row in rows:
            if exclude_reservation_id and row.reservation_id == exclude_reservation_id:
                continue
            if not _row_is_available(row):
                ok = False
                break
        result.append(RoomAssignability(
            room_id=room.id, room_number=room.room_number,
            is_assignable=ok,
            blocking_reason=None if ok else "Room not available for all dates.",
        ))
    return result


def estimate_inventory_impact(
    action: str,
    room_type_id: uuid.UUID,
    check_in: date,
    check_out: date,
    old_check_in: date | None = None,
    old_check_out: date | None = None,
) -> InventoryImpact:
    """Project how a booking action changes inventory counts.

    Useful for UI previews (e.g. "this will release 2 nights, consume 3").
    """
    new_dates = set(_stay_dates(check_in, check_out))
    old_dates = set()
    if old_check_in and old_check_out:
        old_dates = set(_stay_dates(old_check_in, old_check_out))

    if action == "create":
        return InventoryImpact(
            action=action, room_type_id=room_type_id,
            affected_dates=sorted(new_dates),
            rooms_released=0, rooms_consumed=len(new_dates), net_change=-len(new_dates),
        )
    if action == "cancel":
        return InventoryImpact(
            action=action, room_type_id=room_type_id,
            affected_dates=sorted(old_dates or new_dates),
            rooms_released=len(old_dates or new_dates), rooms_consumed=0,
            net_change=len(old_dates or new_dates),
        )
    if action in ("modify", "extend", "move"):
        released = old_dates - new_dates
        consumed = new_dates - old_dates
        return InventoryImpact(
            action=action, room_type_id=room_type_id,
            affected_dates=sorted(released | consumed),
            rooms_released=len(released), rooms_consumed=len(consumed),
            net_change=len(released) - len(consumed),
        )
    return InventoryImpact(
        action=action, room_type_id=room_type_id,
        affected_dates=[], rooms_released=0, rooms_consumed=0, net_change=0,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _row_is_available(row: InventoryDay) -> bool:
    return (
        row.availability_status == "available"
        and row.is_sellable
        and not row.is_blocked
        and not row.maintenance_flag
    )


def _blackout_dates(check_in: date, check_out: date) -> set[date]:
    """Return set of dates blocked by active blackout periods."""
    blackouts = (
        db.session.execute(
            sa.select(BlackoutPeriod).where(
                BlackoutPeriod.is_active.is_(True),
                BlackoutPeriod.start_date < check_out,
                BlackoutPeriod.end_date > check_in,
                BlackoutPeriod.blackout_type.in_(["closed_to_booking", "property_closed"]),
            )
        )
        .scalars()
        .all()
    )
    blocked: set[date] = set()
    for bp in blackouts:
        cursor = max(bp.start_date, check_in)
        end = min(bp.end_date, check_out)
        while cursor < end:
            blocked.add(cursor)
            cursor += timedelta(days=1)
    return blocked


def _external_blocked_room_dates(
    room_ids: list[uuid.UUID], check_in: date, check_out: date,
) -> set[tuple[uuid.UUID, date]]:
    if not room_ids:
        return set()
    blocks = (
        db.session.execute(
            sa.select(ExternalCalendarBlock).where(
                ExternalCalendarBlock.room_id.in_(room_ids),
                ExternalCalendarBlock.starts_on < check_out,
                ExternalCalendarBlock.ends_on > check_in,
            )
        )
        .scalars()
        .all()
    )
    result: set[tuple[uuid.UUID, date]] = set()
    for block in blocks:
        cursor = max(block.starts_on, check_in)
        end = min(block.ends_on, check_out)
        while cursor < end:
            result.add((block.room_id, cursor))
            cursor += timedelta(days=1)
    return result


def _override_closed_room_dates(
    room_ids: list[uuid.UUID], room_type_id: uuid.UUID,
    check_in: date, check_out: date,
) -> set[tuple[uuid.UUID, date]]:
    """Return (room_id, date) pairs closed by inventory overrides."""
    overrides = (
        db.session.execute(
            sa.select(InventoryOverride).where(
                InventoryOverride.is_active.is_(True),
                InventoryOverride.override_action == "close",
                InventoryOverride.start_date < check_out,
                InventoryOverride.end_date > check_in,
                sa.or_(
                    sa.and_(
                        InventoryOverride.scope_type == "room",
                        InventoryOverride.room_id.in_(room_ids),
                    ),
                    sa.and_(
                        InventoryOverride.scope_type == "room_type",
                        InventoryOverride.room_type_id == room_type_id,
                    ),
                ),
            )
        )
        .scalars()
        .all()
    )
    result: set[tuple[uuid.UUID, date]] = set()
    for ov in overrides:
        cursor = max(ov.start_date, check_in)
        end = min(ov.end_date, check_out)
        affected = room_ids if ov.scope_type == "room_type" else [ov.room_id]
        while cursor < end:
            for rid in affected:
                result.add((rid, cursor))
            cursor += timedelta(days=1)
    return result


def _room_has_external_block(
    room_id: uuid.UUID, check_in: date, check_out: date,
) -> bool:
    return bool(
        db.session.execute(
            sa.select(
                sa.exists().where(
                    ExternalCalendarBlock.room_id == room_id,
                    ExternalCalendarBlock.starts_on < check_out,
                    ExternalCalendarBlock.ends_on > check_in,
                )
            )
        ).scalar_one()
    )
