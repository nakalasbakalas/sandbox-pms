"""Admin inventory override and blackout operations."""

from __future__ import annotations

from .admin_base import *  # noqa: F401,F403
from . import admin_base as _base

_date_overlap = _base._date_overlap

@dataclass
class InventoryOverridePayload:
    name: str
    scope_type: str
    override_action: str
    room_id: uuid.UUID | None
    room_type_id: uuid.UUID | None
    start_date: date
    end_date: date
    reason: str
    expires_at: datetime | None = None


@dataclass
class GroupRoomBlockPayload:
    group_code: str
    room_type_id: uuid.UUID
    room_count: int
    start_date: date
    end_date: date
    reason: str | None = None


def create_group_room_block(
    payload: GroupRoomBlockPayload,
    *,
    actor_user_id: uuid.UUID,
) -> list[InventoryOverride]:
    if payload.room_count < 1:
        raise ValueError("At least one room must be blocked for a group room block.")
    if payload.start_date > payload.end_date:
        raise ValueError("Group room block start date must be before the end date.")
    room_type = db.session.get(RoomType, payload.room_type_id)
    if not room_type or not room_type.is_active:
        raise ValueError("Selected room type is not available.")

    group_code = _normalize_group_block_code(payload.group_code)
    group_name = _group_room_block_name(group_code)
    reason = clean_optional(payload.reason, limit=255) or f"Group room block {group_code}"
    candidate_rooms = _available_rooms_for_group_block(
        room_type_id=payload.room_type_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    if len(candidate_rooms) < payload.room_count:
        raise ValueError(
            f"Only {len(candidate_rooms)} rooms are available for this room block. Reduce the room count or change the stay dates."
        )

    selected_rooms = candidate_rooms[: payload.room_count]
    overrides: list[InventoryOverride] = []
    try:
        for room in selected_rooms:
            override = InventoryOverride(
                name=group_name,
                scope_type="room",
                override_action="close",
                room_id=room.id,
                room_type_id=None,
                start_date=payload.start_date,
                end_date=payload.end_date,
                reason=reason,
                is_active=True,
                created_by_user_id=actor_user_id,
                updated_by_user_id=actor_user_id,
            )
            db.session.add(override)
            db.session.flush()
            _apply_inventory_override(override, actor_user_id=actor_user_id)
            write_audit_log(
                actor_user_id=actor_user_id,
                entity_table="inventory_overrides",
                entity_id=str(override.id),
                action="inventory_override_created",
                after_data={**(_inventory_override_snapshot(override) or {}), "group_code": group_code},
            )
            write_activity_log(
                actor_user_id=actor_user_id,
                event_type="admin.inventory_override_created",
                entity_table="inventory_overrides",
                entity_id=str(override.id),
                metadata={"scope_type": override.scope_type, "action": override.override_action, "group_code": group_code},
            )
            overrides.append(override)

        write_activity_log(
            actor_user_id=actor_user_id,
            event_type="admin.group_room_block_created",
            entity_table="inventory_overrides",
            entity_id=group_name,
            metadata={
                "group_code": group_code,
                "room_type_code": room_type.code,
                "room_count": len(overrides),
                "room_numbers": [room.room_number for room in selected_rooms],
                "start_date": payload.start_date.isoformat(),
                "end_date": payload.end_date.isoformat(),
            },
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return overrides


def release_group_room_block(group_code: str, *, actor_user_id: uuid.UUID) -> list[InventoryOverride]:
    normalized_code = _normalize_group_block_code(group_code)
    group_name = _group_room_block_name(normalized_code)
    overrides = (
        db.session.execute(
            sa.select(InventoryOverride)
            .where(
                InventoryOverride.is_active.is_(True),
                InventoryOverride.scope_type == "room",
                InventoryOverride.name == group_name,
            )
            .order_by(InventoryOverride.start_date.asc(), InventoryOverride.room_id.asc())
            .with_for_update()
        )
        .scalars()
        .all()
    )
    if not overrides:
        raise ValueError("Active group room block not found.")

    try:
        for override in overrides:
            for row in _inventory_rows_for_override(override, lock=True):
                if row.reservation_id or row.hold_id:
                    raise ValueError("The room block cannot be released because one or more affected dates are now allocated.")
                _restore_inventory_row_to_room_default(row, actor_user_id=actor_user_id)

            before = _inventory_override_snapshot(override)
            override.is_active = False
            override.released_at = utc_now()
            override.released_by_user_id = actor_user_id
            override.updated_by_user_id = actor_user_id
            write_audit_log(
                actor_user_id=actor_user_id,
                entity_table="inventory_overrides",
                entity_id=str(override.id),
                action="inventory_override_released",
                before_data=before,
                after_data={**(_inventory_override_snapshot(override) or {}), "group_code": normalized_code},
            )
            write_activity_log(
                actor_user_id=actor_user_id,
                event_type="admin.inventory_override_released",
                entity_table="inventory_overrides",
                entity_id=str(override.id),
                metadata={"scope_type": override.scope_type, "group_code": normalized_code},
            )

        write_activity_log(
            actor_user_id=actor_user_id,
            event_type="admin.group_room_block_released",
            entity_table="inventory_overrides",
            entity_id=group_name,
            metadata={"group_code": normalized_code, "room_count": len(overrides)},
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return overrides


def create_inventory_override(payload: InventoryOverridePayload, *, actor_user_id: uuid.UUID) -> InventoryOverride:
    _validate_inventory_override_payload(payload)
    if db.session.execute(_inventory_override_overlap_query(payload)).scalars().first():
        raise ValueError("An active inventory override already covers that room scope and date range.")

    override = InventoryOverride(
        name=payload.name.strip(),
        scope_type=payload.scope_type,
        override_action=payload.override_action,
        room_id=payload.room_id,
        room_type_id=payload.room_type_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        reason=payload.reason.strip(),
        is_active=True,
        expires_at=payload.expires_at,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.session.add(override)
    db.session.flush()
    _apply_inventory_override(override, actor_user_id=actor_user_id)

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="inventory_overrides",
        entity_id=str(override.id),
        action="inventory_override_created",
        after_data=_inventory_override_snapshot(override),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="admin.inventory_override_created",
        entity_table="inventory_overrides",
        entity_id=str(override.id),
        metadata={"scope_type": override.scope_type, "action": override.override_action},
    )
    db.session.commit()
    return override


def update_inventory_override(
    override_id: uuid.UUID,
    payload: InventoryOverridePayload,
    *,
    actor_user_id: uuid.UUID,
) -> InventoryOverride:
    _validate_inventory_override_payload(payload)
    override = (
        db.session.execute(
            sa.select(InventoryOverride).where(InventoryOverride.id == override_id).with_for_update()
        )
        .scalars()
        .first()
    )
    if not override:
        raise ValueError("Inventory override not found.")
    if not override.is_active:
        raise ValueError("Only active inventory overrides can be edited.")
    if db.session.execute(_inventory_override_overlap_query(payload, exclude_override_id=override.id)).scalars().first():
        raise ValueError("An active inventory override already covers that room scope and date range.")

    before = _inventory_override_snapshot(override)
    for row in _inventory_rows_for_override(override, lock=True):
        if row.reservation_id or row.hold_id:
            raise ValueError("The override cannot be edited because one or more covered dates are already allocated.")
        _restore_inventory_row_to_room_default(row, actor_user_id=actor_user_id)

    override.name = payload.name.strip()
    override.scope_type = payload.scope_type
    override.override_action = payload.override_action
    override.room_id = payload.room_id
    override.room_type_id = payload.room_type_id
    override.start_date = payload.start_date
    override.end_date = payload.end_date
    override.reason = payload.reason.strip()
    override.expires_at = payload.expires_at
    override.updated_by_user_id = actor_user_id

    _apply_inventory_override(override, actor_user_id=actor_user_id)

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="inventory_overrides",
        entity_id=str(override.id),
        action="inventory_override_updated",
        before_data=before,
        after_data=_inventory_override_snapshot(override),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="admin.inventory_override_updated",
        entity_table="inventory_overrides",
        entity_id=str(override.id),
        metadata={"scope_type": override.scope_type, "action": override.override_action},
    )
    db.session.commit()
    return override


def release_inventory_override(override_id: uuid.UUID, *, actor_user_id: uuid.UUID) -> InventoryOverride:
    override = (
        db.session.execute(
            sa.select(InventoryOverride).where(InventoryOverride.id == override_id).with_for_update()
        )
        .scalars()
        .first()
    )
    if not override:
        raise ValueError("Inventory override not found.")
    if not override.is_active:
        raise ValueError("Inventory override is already inactive.")

    for row in _inventory_rows_for_override(override, lock=True):
        if row.reservation_id or row.hold_id:
            raise ValueError("The override cannot be released because one or more affected dates are now allocated.")
        _restore_inventory_row_to_room_default(row, actor_user_id=actor_user_id)

    before = _inventory_override_snapshot(override)
    override.is_active = False
    override.released_at = utc_now()
    override.released_by_user_id = actor_user_id
    override.updated_by_user_id = actor_user_id

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="inventory_overrides",
        entity_id=str(override.id),
        action="inventory_override_released",
        before_data=before,
        after_data=_inventory_override_snapshot(override),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="admin.inventory_override_released",
        entity_table="inventory_overrides",
        entity_id=str(override.id),
        metadata={"scope_type": override.scope_type},
    )
    db.session.commit()
    return override


@dataclass
class BlackoutPayload:
    name: str
    blackout_type: str
    start_date: date
    end_date: date
    reason: str
    is_active: bool


def upsert_blackout_period(blackout_id: uuid.UUID | None, payload: BlackoutPayload, *, actor_user_id: uuid.UUID) -> BlackoutPeriod:
    if payload.blackout_type not in BLACKOUT_TYPES:
        raise ValueError("Blackout type is invalid.")
    if payload.start_date > payload.end_date:
        raise ValueError("Blackout start date must be before the end date.")

    query = sa.select(BlackoutPeriod).where(
        BlackoutPeriod.is_active.is_(True),
        BlackoutPeriod.blackout_type == payload.blackout_type,
        BlackoutPeriod.start_date <= payload.end_date,
        BlackoutPeriod.end_date >= payload.start_date,
    )
    if blackout_id:
        query = query.where(BlackoutPeriod.id != blackout_id)
    if db.session.execute(query).scalars().first():
        raise ValueError("An active blackout already overlaps that date range for the selected type.")

    blackout = db.session.get(BlackoutPeriod, blackout_id) if blackout_id else None
    if blackout_id and not blackout:
        raise ValueError("Blackout period not found.")
    before = _blackout_snapshot(blackout) if blackout else None

    if not blackout:
        blackout = BlackoutPeriod(created_by_user_id=actor_user_id)
        db.session.add(blackout)
    blackout.name = payload.name.strip()
    blackout.blackout_type = payload.blackout_type
    blackout.start_date = payload.start_date
    blackout.end_date = payload.end_date
    blackout.reason = payload.reason.strip()
    blackout.is_active = payload.is_active
    blackout.updated_by_user_id = actor_user_id
    db.session.flush()

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="blackout_periods",
        entity_id=str(blackout.id),
        action="blackout_upserted",
        before_data=before,
        after_data=_blackout_snapshot(blackout),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="admin.blackout_updated",
        entity_table="blackout_periods",
        entity_id=str(blackout.id),
        metadata={"blackout_type": blackout.blackout_type},
    )
    db.session.commit()

    conflicting_reservation_count = 0
    if blackout.is_active and blackout.blackout_type in ("closed_to_booking", "property_closed"):
        active_statuses = {"tentative", "confirmed", "checked_in"}
        conflicting_reservation_count = db.session.execute(
            sa.select(sa.func.count()).select_from(Reservation).where(
                Reservation.current_status.in_(active_statuses),
                Reservation.check_in_date < blackout.end_date,
                Reservation.check_out_date > blackout.start_date,
            )
        ).scalar_one()

    return blackout, conflicting_reservation_count


def assert_blackout_allows_booking(check_in_date: date, check_out_date: date) -> None:
    overlapping = (
        db.session.execute(
            sa.select(BlackoutPeriod).where(
                BlackoutPeriod.is_active.is_(True),
                BlackoutPeriod.start_date <= check_out_date,
                BlackoutPeriod.end_date >= check_in_date,
            )
        )
        .scalars()
        .all()
    )
    for item in overlapping:
        if item.blackout_type in {"property_closed", "closed_to_booking"}:
            raise ValueError(item.reason or f"Bookings are closed for '{item.name}'.")
        if item.blackout_type == "no_arrival" and item.start_date <= check_in_date <= item.end_date:
            raise ValueError(item.reason or f"Arrival is closed for '{item.name}'.")
        if item.blackout_type == "no_departure" and item.start_date <= check_out_date <= item.end_date:
            raise ValueError(item.reason or f"Departure is closed for '{item.name}'.")

def _inventory_override_snapshot(override: InventoryOverride | None) -> dict | None:
    if not override:
        return None
    return {
        "name": override.name,
        "scope_type": override.scope_type,
        "override_action": override.override_action,
        "room_id": str(override.room_id) if override.room_id else None,
        "room_type_id": str(override.room_type_id) if override.room_type_id else None,
        "start_date": override.start_date.isoformat(),
        "end_date": override.end_date.isoformat(),
        "reason": override.reason,
        "is_active": override.is_active,
    }


def _blackout_snapshot(blackout: BlackoutPeriod | None) -> dict | None:
    if not blackout:
        return None
    return {
        "name": blackout.name,
        "blackout_type": blackout.blackout_type,
        "start_date": blackout.start_date.isoformat(),
        "end_date": blackout.end_date.isoformat(),
        "reason": blackout.reason,
        "is_active": blackout.is_active,
    }



def _inventory_rows_for_override(override: InventoryOverride, *, lock: bool) -> list[InventoryDay]:
    query = sa.select(InventoryDay).where(
        InventoryDay.business_date >= override.start_date,
        InventoryDay.business_date <= override.end_date,
    )
    if override.scope_type == "room":
        query = query.where(InventoryDay.room_id == override.room_id)
    else:
        query = query.where(InventoryDay.room_type_id == override.room_type_id)
    if lock:
        query = query.with_for_update()
    return db.session.execute(query).scalars().all()


def _validate_inventory_override_payload(payload: InventoryOverridePayload) -> None:
    if payload.scope_type not in INVENTORY_OVERRIDE_SCOPE_TYPES:
        raise ValueError("Override scope type is invalid.")
    if payload.override_action not in INVENTORY_OVERRIDE_ACTIONS:
        raise ValueError("Override action is invalid.")
    if payload.start_date > payload.end_date:
        raise ValueError("Override start date must be before the end date.")
    if payload.scope_type == "room" and not payload.room_id:
        raise ValueError("A room must be selected for room-level overrides.")
    if payload.scope_type == "room_type" and not payload.room_type_id:
        raise ValueError("A room type must be selected for room-type overrides.")


def _inventory_override_overlap_query(
    payload: InventoryOverridePayload,
    *,
    exclude_override_id: uuid.UUID | None = None,
):
    query = sa.select(InventoryOverride).where(
        InventoryOverride.is_active.is_(True),
        InventoryOverride.start_date <= payload.end_date,
        InventoryOverride.end_date >= payload.start_date,
        InventoryOverride.scope_type == payload.scope_type,
    )
    if exclude_override_id:
        query = query.where(InventoryOverride.id != exclude_override_id)
    if payload.room_id:
        query = query.where(InventoryOverride.room_id == payload.room_id)
    if payload.room_type_id:
        query = query.where(InventoryOverride.room_type_id == payload.room_type_id)
    return query


def _normalize_group_block_code(value: str) -> str:
    candidate = re.sub(r"[^A-Z0-9-]+", "-", str(value or "").strip().upper()).strip("-")
    if not _GROUP_BLOCK_CODE_RE.fullmatch(candidate):
        raise ValueError("Group code must be 2 to 32 characters using letters, numbers, or dashes.")
    return candidate


def _group_room_block_name(group_code: str) -> str:
    return f"Group {group_code}"


def _available_rooms_for_group_block(
    *,
    room_type_id: uuid.UUID,
    start_date: date,
    end_date: date,
) -> list[Room]:
    requested_days = (end_date - start_date).days + 1
    stmt = (
        sa.select(Room)
        .join(InventoryDay, InventoryDay.room_id == Room.id)
        .where(
            Room.room_type_id == room_type_id,
            Room.is_active.is_(True),
            Room.is_sellable.is_(True),
            InventoryDay.business_date >= start_date,
            InventoryDay.business_date <= end_date,
            InventoryDay.availability_status == "available",
            InventoryDay.reservation_id.is_(None),
            InventoryDay.hold_id.is_(None),
            InventoryDay.is_blocked.is_(False),
            InventoryDay.maintenance_flag.is_(False),
        )
        .group_by(Room.id)
        .having(sa.func.count(InventoryDay.id) == requested_days)
        .order_by(Room.room_number.asc())
        .with_for_update()
    )
    return db.session.execute(stmt).scalars().all()


def _apply_inventory_override(override: InventoryOverride, *, actor_user_id: uuid.UUID) -> None:
    rows = _inventory_rows_for_override(override, lock=True)
    if not rows:
        raise ValueError("No inventory rows exist for the selected override date range.")
    clean_status = (
        db.session.execute(sa.select(HousekeepingStatus).where(HousekeepingStatus.code == "clean"))
        .scalars()
        .first()
    )
    closure_status = (
        db.session.execute(sa.select(HousekeepingStatus).where(HousekeepingStatus.code == "out_of_service"))
        .scalars()
        .first()
    )
    for row in rows:
        if row.reservation_id or row.hold_id or row.availability_status in {"reserved", "occupied", "held", "house_use"}:
            raise ValueError("One or more affected dates are already allocated and cannot be overridden.")
        if override.override_action == "close":
            row.availability_status = "out_of_service"
            row.is_sellable = False
            row.housekeeping_status_id = closure_status.id if closure_status else row.housekeeping_status_id
            row.notes = override.reason[:255]
        else:
            row.availability_status = "available"
            row.is_sellable = True
            if closure_status and row.housekeeping_status_id == closure_status.id and clean_status:
                row.housekeeping_status_id = clean_status.id
            row.notes = override.reason[:255]
        row.updated_by_user_id = actor_user_id


def _restore_inventory_row_to_room_default(row: InventoryDay, *, actor_user_id: uuid.UUID) -> None:
    room = db.session.get(Room, row.room_id)
    clean_status = (
        db.session.execute(sa.select(HousekeepingStatus).where(HousekeepingStatus.code == "clean"))
        .scalars()
        .first()
    )
    closure_status = (
        db.session.execute(sa.select(HousekeepingStatus).where(HousekeepingStatus.code == "out_of_service"))
        .scalars()
        .first()
    )
    default_sellable = bool(room and room.is_active and room.is_sellable and room.default_operational_status == "available")
    row.room_type_id = room.room_type_id if room else row.room_type_id
    row.availability_status = "available" if default_sellable else (room.default_operational_status if room else "out_of_service")
    row.is_sellable = default_sellable
    row.housekeeping_status_id = clean_status.id if default_sellable and clean_status else closure_status.id if closure_status else row.housekeeping_status_id
    row.notes = room.notes if room else row.notes
    row.updated_by_user_id = actor_user_id
