"""Admin property, room, rate, and setting operations."""

from __future__ import annotations

from .admin_base import *  # noqa: F401,F403
from . import admin_base as _base
from . import admin_inventory_ops as _inventory_ops

_bool = _base._bool
_date_overlap = _base._date_overlap
_decimal = _base._decimal
_int = _base._int
_normalize_setting_by_key = _base._normalize_setting_by_key
_setting_value_for_type = _base._setting_value_for_type
_restore_inventory_row_to_room_default = _inventory_ops._restore_inventory_row_to_room_default

def upsert_setting(
    key: str,
    *,
    value,
    value_type: str,
    actor_user_id: uuid.UUID,
    description: str | None = None,
    is_public: bool | None = None,
    sort_order: int | None = None,
    commit: bool = True,
) -> AppSetting:
    setting = (
        db.session.execute(
            sa.select(AppSetting).where(
                AppSetting.key == key,
                AppSetting.deleted_at.is_(None),
            )
        )
        .scalars()
        .first()
    )
    before_data = None
    if setting:
        before_data = {"value": setting.value_json.get("value"), "value_type": setting.value_type}
    else:
        setting = AppSetting(
            key=key,
            value_json={"value": None},
            value_type=value_type,
            description=description,
            is_public=bool(is_public),
            sort_order=sort_order or 0,
            created_by_user_id=actor_user_id,
        )
        db.session.add(setting)

    normalized_value = _setting_value_for_type(value, value_type)
    normalized_value = _normalize_setting_by_key(key, normalized_value)
    setting.value_json = {"value": normalized_value}
    setting.value_type = value_type
    setting.description = description or setting.description
    if is_public is not None:
        setting.is_public = is_public
    if sort_order is not None:
        setting.sort_order = sort_order
    setting.updated_by_user_id = actor_user_id

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="app_settings",
        entity_id=str(setting.id) if setting.id else key,
        action="setting_upserted",
        before_data=before_data,
        after_data={"key": key, "value": setting.value_json.get("value"), "value_type": value_type},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="admin.setting_updated",
        entity_table="app_settings",
        entity_id=key,
        metadata={"value": setting.value_json.get("value")},
    )
    if commit:
        db.session.commit()
    return setting


def upsert_settings_bundle(
    items: list[dict[str, object]],
    *,
    actor_user_id: uuid.UUID,
) -> list[AppSetting]:
    updated: list[AppSetting] = []
    for item in items:
        updated.append(
            upsert_setting(
                str(item["key"]),
                value=item.get("value"),
                value_type=str(item["value_type"]),
                actor_user_id=actor_user_id,
                description=str(item["description"]) if item.get("description") is not None else None,
                is_public=item.get("is_public"),
                sort_order=int(item["sort_order"]) if item.get("sort_order") is not None else None,
                commit=False,
            )
        )
    db.session.commit()
    return updated


@dataclass
class RoomTypePayload:
    code: str
    name: str
    summary: str | None
    description: str | None
    bed_details: str | None
    media_urls: str | None
    amenities: str | None
    policy_callouts: str | None
    standard_occupancy: int
    max_occupancy: int
    extra_bed_allowed: bool
    is_active: bool


def upsert_room_type(room_type_id: uuid.UUID | None, payload: RoomTypePayload, *, actor_user_id: uuid.UUID) -> RoomType:
    code = payload.code.strip().upper()
    if not code:
        raise ValueError("Room type code is required.")
    existing = (
        db.session.execute(sa.select(RoomType).where(sa.func.upper(RoomType.code) == code))
        .scalars()
        .first()
    )
    if existing and existing.id != room_type_id:
        raise ValueError("Room type code must be unique.")
    room_type = db.session.get(RoomType, room_type_id) if room_type_id else None
    if room_type_id and not room_type:
        raise ValueError("Room type not found.")
    if payload.standard_occupancy < 1 or payload.max_occupancy < payload.standard_occupancy:
        raise ValueError("Occupancy values are invalid.")

    if room_type:
        before = _room_type_snapshot(room_type)
        active_room_count = db.session.execute(
            sa.select(sa.func.count())
            .select_from(Room)
            .where(Room.room_type_id == room_type.id, Room.is_active.is_(True))
        ).scalar()
        active_reservations = db.session.execute(
            sa.select(sa.func.count())
            .select_from(Reservation)
            .where(
                Reservation.room_type_id == room_type.id,
                Reservation.current_status.in_(ACTIVE_RESERVATION_STATUSES),
            )
        ).scalar()
        if room_type.code != code and (active_room_count or active_reservations):
            raise ValueError("Room type code cannot be changed while rooms or reservations depend on it.")
        if not payload.is_active and (active_room_count or active_reservations):
            raise ValueError("Deactivate rooms or complete active reservations before disabling this room type.")
    else:
        room_type = RoomType(created_by_user_id=actor_user_id)
        db.session.add(room_type)
        before = None

    room_type.code = code
    room_type.name = payload.name.strip()
    room_type.summary = clean_optional(payload.summary, limit=280)
    room_type.description = clean_optional(payload.description, limit=5000)
    room_type.bed_details = clean_optional(payload.bed_details, limit=255)
    room_type.media_urls = clean_multiline_list(payload.media_urls, item_limit=500, max_items=12)
    room_type.amenities = clean_multiline_list(payload.amenities, item_limit=120, max_items=16)
    room_type.policy_callouts = clean_multiline_list(payload.policy_callouts, item_limit=200, max_items=8)
    room_type.standard_occupancy = payload.standard_occupancy
    room_type.max_occupancy = payload.max_occupancy
    room_type.extra_bed_allowed = payload.extra_bed_allowed
    room_type.is_active = payload.is_active
    room_type.updated_by_user_id = actor_user_id
    db.session.flush()

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="room_types",
        entity_id=str(room_type.id),
        action="room_type_upserted",
        before_data=before,
        after_data=_room_type_snapshot(room_type),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="admin.room_type_updated",
        entity_table="room_types",
        entity_id=str(room_type.id),
        metadata={"code": room_type.code},
    )
    db.session.commit()
    return room_type


@dataclass
class RoomPayload:
    room_number: str
    room_type_id: uuid.UUID
    floor_number: int
    is_active: bool
    is_sellable: bool
    default_operational_status: str
    notes: str | None


def upsert_room(room_id: uuid.UUID | None, payload: RoomPayload, *, actor_user_id: uuid.UUID) -> Room:
    room_type = db.session.get(RoomType, payload.room_type_id)
    if not room_type:
        raise ValueError("Room type not found.")
    room_number = payload.room_number.strip()
    if not room_number:
        raise ValueError("Room number is required.")
    existing = (
        db.session.execute(sa.select(Room).where(Room.room_number == room_number))
        .scalars()
        .first()
    )
    if existing and existing.id != room_id:
        raise ValueError("Room number must be unique.")
    if payload.default_operational_status not in ROOM_OPERATIONAL_STATUSES:
        raise ValueError("Default operational status is invalid.")

    room = db.session.get(Room, room_id) if room_id else None
    if room_id and not room:
        raise ValueError("Room not found.")
    if room:
        before = _room_snapshot(room)
        active_reservations = db.session.execute(
            sa.select(sa.func.count())
            .select_from(Reservation)
            .where(
                Reservation.assigned_room_id == room.id,
                Reservation.current_status.in_(ACTIVE_RESERVATION_STATUSES),
            )
        ).scalar()
        reservation_history_count = db.session.execute(
            sa.select(sa.func.count())
            .select_from(Reservation)
            .where(Reservation.assigned_room_id == room.id)
        ).scalar()
        if room.room_number != room_number and reservation_history_count:
            raise ValueError("Room number cannot be changed once reservations exist for this room.")
        if active_reservations and (
            room.room_type_id != payload.room_type_id or not payload.is_active or (room.is_sellable and not payload.is_sellable)
        ):
            raise ValueError("This room has active reservations and cannot be made unavailable or changed to another type.")
    else:
        room = Room(created_by_user_id=actor_user_id)
        db.session.add(room)
        before = None

    room.room_number = room_number
    room.room_type_id = payload.room_type_id
    room.floor_number = payload.floor_number
    room.is_active = payload.is_active
    room.is_sellable = payload.is_sellable
    room.default_operational_status = payload.default_operational_status
    room.notes = clean_optional(payload.notes, limit=255)
    room.updated_by_user_id = actor_user_id
    db.session.flush()
    _ensure_room_inventory(room, actor_user_id=actor_user_id)

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="rooms",
        entity_id=str(room.id),
        action="room_upserted",
        before_data=before,
        after_data=_room_snapshot(room),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="admin.room_updated",
        entity_table="rooms",
        entity_id=str(room.id),
        metadata={"room_number": room.room_number},
    )
    db.session.commit()
    return room


@dataclass
class RateRulePayload:
    name: str
    room_type_id: uuid.UUID | None
    priority: int
    is_active: bool
    rule_type: str
    adjustment_type: str
    adjustment_value: Decimal
    start_date: date | None
    end_date: date | None
    days_of_week: str | None
    min_nights: int | None
    max_nights: int | None
    extra_guest_fee_override: Decimal | None
    child_fee_override: Decimal | None


def upsert_rate_rule(rate_rule_id: uuid.UUID | None, payload: RateRulePayload, *, actor_user_id: uuid.UUID) -> RateRule:
    if payload.rule_type not in RATE_RULE_TYPES:
        raise ValueError("Rate rule type is invalid.")
    if payload.adjustment_type not in RATE_ADJUSTMENT_TYPES:
        raise ValueError("Adjustment type is invalid.")
    if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
        raise ValueError("Rate rule start date must be before the end date.")
    if payload.min_nights and payload.max_nights and payload.min_nights > payload.max_nights:
        raise ValueError("Minimum nights cannot exceed maximum nights.")
    normalized_days = _normalize_days_of_week(payload.days_of_week)

    rule = db.session.get(RateRule, rate_rule_id) if rate_rule_id else None
    if rate_rule_id and not rule:
        raise ValueError("Rate rule not found.")
    before = _rate_rule_snapshot(rule) if rule else None

    conflict = _find_conflicting_rate_rule(rate_rule_id, payload, normalized_days)
    if conflict:
        raise ValueError(f"Conflicts with active rule '{conflict.name}'. Adjust the priority or effective dates.")

    if not rule:
        rule = RateRule(created_by_user_id=actor_user_id)
        db.session.add(rule)

    rule.name = payload.name.strip()
    rule.room_type_id = payload.room_type_id
    rule.priority = payload.priority
    rule.is_active = payload.is_active
    rule.rule_type = payload.rule_type
    rule.adjustment_type = payload.adjustment_type
    rule.adjustment_value = payload.adjustment_value
    rule.start_date = payload.start_date
    rule.end_date = payload.end_date
    rule.days_of_week = normalized_days
    rule.min_nights = payload.min_nights
    rule.max_nights = payload.max_nights
    rule.extra_guest_fee_override = payload.extra_guest_fee_override
    rule.child_fee_override = payload.child_fee_override
    rule.updated_by_user_id = actor_user_id
    db.session.flush()

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="rate_rules",
        entity_id=str(rule.id),
        action="rate_rule_upserted",
        before_data=before,
        after_data=_rate_rule_snapshot(rule),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="admin.rate_rule_updated",
        entity_table="rate_rules",
        entity_id=str(rule.id),
        metadata={"name": rule.name, "rule_type": rule.rule_type},
    )
    db.session.commit()
    return rule

def _room_type_snapshot(room_type: RoomType | None) -> dict | None:
    if not room_type:
        return None
    return {
        "code": room_type.code,
        "name": room_type.name,
        "summary": room_type.summary,
        "description": room_type.description,
        "bed_details": room_type.bed_details,
        "media_urls": room_type.media_urls or [],
        "amenities": room_type.amenities or [],
        "policy_callouts": room_type.policy_callouts or [],
        "standard_occupancy": room_type.standard_occupancy,
        "max_occupancy": room_type.max_occupancy,
        "extra_bed_allowed": room_type.extra_bed_allowed,
        "is_active": room_type.is_active,
    }


def _room_snapshot(room: Room | None) -> dict | None:
    if not room:
        return None
    return {
        "room_number": room.room_number,
        "room_type_id": str(room.room_type_id),
        "floor_number": room.floor_number,
        "is_active": room.is_active,
        "is_sellable": room.is_sellable,
        "default_operational_status": room.default_operational_status,
        "notes": room.notes,
    }


def _rate_rule_snapshot(rule: RateRule | None) -> dict | None:
    if not rule:
        return None
    return {
        "name": rule.name,
        "room_type_id": str(rule.room_type_id) if rule.room_type_id else None,
        "priority": rule.priority,
        "is_active": rule.is_active,
        "rule_type": rule.rule_type,
        "adjustment_type": rule.adjustment_type,
        "adjustment_value": str(rule.adjustment_value),
        "start_date": rule.start_date.isoformat() if rule.start_date else None,
        "end_date": rule.end_date.isoformat() if rule.end_date else None,
        "days_of_week": rule.days_of_week,
        "min_nights": rule.min_nights,
        "max_nights": rule.max_nights,
    }



def _normalize_days_of_week(value: str | None) -> str | None:
    raw = clean_optional(value, limit=50)
    if not raw:
        return None
    values = []
    for item in raw.split(","):
        day = item.strip()
        if not day:
            continue
        if day not in {"0", "1", "2", "3", "4", "5", "6"}:
            raise ValueError("Days of week must be comma-separated integers from 0 to 6.")
        values.append(day)
    return ",".join(sorted(set(values)))


def _find_conflicting_rate_rule(
    rate_rule_id: uuid.UUID | None,
    payload: RateRulePayload,
    normalized_days: str | None,
) -> RateRule | None:
    query = sa.select(RateRule).where(
        RateRule.deleted_at.is_(None),
        RateRule.is_active.is_(True),
        RateRule.rule_type == payload.rule_type,
        RateRule.priority == payload.priority,
    )
    if rate_rule_id:
        query = query.where(RateRule.id != rate_rule_id)
    if payload.room_type_id:
        query = query.where(RateRule.room_type_id == payload.room_type_id)
    else:
        query = query.where(RateRule.room_type_id.is_(None))
    for rule in db.session.execute(query).scalars().all():
        if not _date_overlap(rule.start_date, rule.end_date, payload.start_date, payload.end_date):
            continue
        if normalized_days and rule.days_of_week and not set(normalized_days.split(",")).intersection(set(rule.days_of_week.split(","))):
            continue
        if normalized_days != rule.days_of_week and normalized_days and rule.days_of_week:
            continue
        return rule
    return None


def _ensure_room_inventory(room: Room, *, actor_user_id: uuid.UUID) -> None:
    clean_status = (
        db.session.execute(sa.select(HousekeepingStatus).where(HousekeepingStatus.code == "clean"))
        .scalars()
        .first()
    )
    out_status = (
        db.session.execute(sa.select(HousekeepingStatus).where(HousekeepingStatus.code == "out_of_service"))
        .scalars()
        .first()
    )
    start_date = date.today()
    days = int(current_app.config.get("INVENTORY_BOOTSTRAP_DAYS", 30))
    existing_dates = {
        row.business_date
        for row in db.session.execute(
            sa.select(InventoryDay).where(
                InventoryDay.room_id == room.id,
                InventoryDay.business_date >= start_date,
                InventoryDay.business_date < start_date + timedelta(days=days),
            )
        )
        .scalars()
        .all()
    }
    for offset in range(days):
        business_date = start_date + timedelta(days=offset)
        if business_date not in existing_dates:
            is_default_sellable = room.is_active and room.is_sellable and room.default_operational_status == "available"
            db.session.add(
                InventoryDay(
                    room_id=room.id,
                    room_type_id=room.room_type_id,
                    business_date=business_date,
                    availability_status="available" if is_default_sellable else room.default_operational_status,
                    housekeeping_status_id=clean_status.id if is_default_sellable and clean_status else out_status.id if out_status else None,
                    is_sellable=is_default_sellable,
                    notes=room.notes,
                    created_by_user_id=actor_user_id,
                    updated_by_user_id=actor_user_id,
                )
            )

    future_rows = (
        db.session.execute(
            sa.select(InventoryDay)
            .where(
                InventoryDay.room_id == room.id,
                InventoryDay.business_date >= start_date,
                InventoryDay.reservation_id.is_(None),
                InventoryDay.hold_id.is_(None),
            )
            .with_for_update()
        )
        .scalars()
        .all()
    )
    for row in future_rows:
        row.room_type_id = room.room_type_id
        _restore_inventory_row_to_room_default(row, actor_user_id=actor_user_id)


