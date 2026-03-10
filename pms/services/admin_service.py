from __future__ import annotations

import string
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

import sqlalchemy as sa
from flask import current_app

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..constants import (
    BLACKOUT_TYPES,
    BOOKING_LANGUAGES,
    INVENTORY_OVERRIDE_ACTIONS,
    INVENTORY_OVERRIDE_SCOPE_TYPES,
    NOTIFICATION_TEMPLATE_CHANNELS,
    POLICY_DOCUMENT_CODES,
    RATE_ADJUSTMENT_TYPES,
    RATE_RULE_TYPES,
    ROOM_OPERATIONAL_STATUSES,
)
from ..extensions import db
from ..models import (
    AppSetting,
    AuditLog,
    BlackoutPeriod,
    HousekeepingStatus,
    InventoryDay,
    InventoryOverride,
    NotificationTemplate,
    Permission,
    PolicyDocument,
    RateRule,
    Reservation,
    Role,
    Room,
    RoomType,
)
from ..pricing import get_setting_value
from ..settings import NOTIFICATION_TEMPLATE_PLACEHOLDERS, POLICY_DOCUMENTS_SEED


ACTIVE_RESERVATION_STATUSES = {"tentative", "confirmed", "checked_in", "waitlist", "house_use"}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def clean_optional(value: str | None, *, limit: int) -> str | None:
    cleaned = (value or "").strip()
    if not cleaned:
        return None
    return cleaned[:limit]


def _decimal(value, *, default: str | None = None) -> Decimal:
    candidate = default if value in {None, ""} and default is not None else value
    try:
        return Decimal(str(candidate))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("A valid decimal value is required.") from exc


def _bool(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "on", "yes"}


def _int(value, *, default: int | None = None) -> int:
    candidate = default if value in {None, ""} and default is not None else value
    try:
        return int(str(candidate))
    except (TypeError, ValueError) as exc:
        raise ValueError("A valid integer value is required.") from exc


def _date_overlap(start_a: date | None, end_a: date | None, start_b: date | None, end_b: date | None) -> bool:
    start_left = start_a or date.min
    end_left = end_a or date.max
    start_right = start_b or date.min
    end_right = end_b or date.max
    return start_left <= end_right and start_right <= end_left


def _setting_value_for_type(value, value_type: str):
    if value_type == "boolean":
        return _bool(value)
    if value_type == "integer":
        return _int(value)
    if value_type in {"money", "decimal"}:
        return f"{_decimal(value):.2f}"
    return str(value or "").strip()


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
    setting = AppSetting.query.filter_by(key=key, deleted_at=None).first()
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

    setting.value_json = {"value": _setting_value_for_type(value, value_type)}
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
    description: str | None
    standard_occupancy: int
    max_occupancy: int
    extra_bed_allowed: bool
    is_active: bool


def upsert_room_type(room_type_id: uuid.UUID | None, payload: RoomTypePayload, *, actor_user_id: uuid.UUID) -> RoomType:
    code = payload.code.strip().upper()
    if not code:
        raise ValueError("Room type code is required.")
    existing = RoomType.query.filter(sa.func.upper(RoomType.code) == code).first()
    if existing and existing.id != room_type_id:
        raise ValueError("Room type code must be unique.")
    room_type = db.session.get(RoomType, room_type_id) if room_type_id else None
    if room_type_id and not room_type:
        raise ValueError("Room type not found.")
    if payload.standard_occupancy < 1 or payload.max_occupancy < payload.standard_occupancy:
        raise ValueError("Occupancy values are invalid.")

    if room_type:
        before = _room_type_snapshot(room_type)
        active_room_count = Room.query.filter_by(room_type_id=room_type.id, is_active=True).count()
        active_reservations = Reservation.query.filter(
            Reservation.room_type_id == room_type.id,
            Reservation.current_status.in_(ACTIVE_RESERVATION_STATUSES),
        ).count()
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
    room_type.description = clean_optional(payload.description, limit=2000)
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
    existing = Room.query.filter_by(room_number=room_number).first()
    if existing and existing.id != room_id:
        raise ValueError("Room number must be unique.")
    if payload.default_operational_status not in ROOM_OPERATIONAL_STATUSES:
        raise ValueError("Default operational status is invalid.")

    room = db.session.get(Room, room_id) if room_id else None
    if room_id and not room:
        raise ValueError("Room not found.")
    if room:
        before = _room_snapshot(room)
        active_reservations = Reservation.query.filter(
            Reservation.assigned_room_id == room.id,
            Reservation.current_status.in_(ACTIVE_RESERVATION_STATUSES),
        ).count()
        if room.room_number != room_number and Reservation.query.filter_by(assigned_room_id=room.id).count():
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


def create_inventory_override(payload: InventoryOverridePayload, *, actor_user_id: uuid.UUID) -> InventoryOverride:
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

    overlap_query = InventoryOverride.query.filter(
        InventoryOverride.is_active.is_(True),
        InventoryOverride.start_date <= payload.end_date,
        InventoryOverride.end_date >= payload.start_date,
        InventoryOverride.scope_type == payload.scope_type,
    )
    if payload.room_id:
        overlap_query = overlap_query.filter(InventoryOverride.room_id == payload.room_id)
    if payload.room_type_id:
        overlap_query = overlap_query.filter(InventoryOverride.room_type_id == payload.room_type_id)
    if overlap_query.first():
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

    query = BlackoutPeriod.query.filter(
        BlackoutPeriod.is_active.is_(True),
        BlackoutPeriod.blackout_type == payload.blackout_type,
        BlackoutPeriod.start_date <= payload.end_date,
        BlackoutPeriod.end_date >= payload.start_date,
    )
    if blackout_id:
        query = query.filter(BlackoutPeriod.id != blackout_id)
    if query.first():
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
    return blackout


def assert_blackout_allows_booking(check_in_date: date, check_out_date: date) -> None:
    overlapping = BlackoutPeriod.query.filter(
        BlackoutPeriod.is_active.is_(True),
        BlackoutPeriod.start_date <= check_out_date,
        BlackoutPeriod.end_date >= check_in_date,
    ).all()
    for item in overlapping:
        if item.blackout_type in {"property_closed", "closed_to_booking"}:
            raise ValueError(item.reason or f"Bookings are closed for '{item.name}'.")
        if item.blackout_type == "no_arrival" and item.start_date <= check_in_date <= item.end_date:
            raise ValueError(item.reason or f"Arrival is closed for '{item.name}'.")
        if item.blackout_type == "no_departure" and item.start_date <= check_out_date <= item.end_date:
            raise ValueError(item.reason or f"Departure is closed for '{item.name}'.")


@dataclass
class PolicyPayload:
    code: str
    name: str
    version: str
    content: dict[str, str]
    is_active: bool


def upsert_policy_document(payload: PolicyPayload, *, actor_user_id: uuid.UUID) -> PolicyDocument:
    if payload.code not in POLICY_DOCUMENT_CODES:
        raise ValueError("Policy document code is invalid.")
    normalized_content = {}
    for language_code in BOOKING_LANGUAGES:
        text = clean_optional(payload.content.get(language_code), limit=5000)
        if not text:
            raise ValueError(f"Policy content is required for {language_code}.")
        normalized_content[language_code] = text

    document = PolicyDocument.query.filter_by(code=payload.code).first()
    before = _policy_snapshot(document) if document else None
    if not document:
        document = PolicyDocument(code=payload.code, created_by_user_id=actor_user_id)
        db.session.add(document)
    document.name = payload.name.strip()
    document.version = payload.version.strip()
    document.content_json = normalized_content
    document.is_active = payload.is_active
    document.updated_by_user_id = actor_user_id
    db.session.flush()

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="policy_documents",
        entity_id=str(document.id),
        action="policy_upserted",
        before_data=before,
        after_data=_policy_snapshot(document),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="admin.policy_updated",
        entity_table="policy_documents",
        entity_id=str(document.id),
        metadata={"code": document.code, "version": document.version},
    )
    db.session.commit()
    return document


def policy_text(code: str, language: str, fallback: str) -> str:
    document = PolicyDocument.query.filter_by(code=code, is_active=True, deleted_at=None).first()
    if not document:
        default_document = POLICY_DOCUMENTS_SEED.get(code)
        if default_document:
            return default_document["content"].get(language) or default_document["content"].get("en") or fallback
        return fallback
    return (
        document.content_json.get(language)
        or document.content_json.get("en")
        or next(iter(document.content_json.values()))
        or fallback
    )


@dataclass
class NotificationTemplatePayload:
    template_key: str
    channel: str
    language_code: str
    description: str | None
    subject_template: str
    body_template: str
    is_active: bool


def upsert_notification_template(
    template_id: uuid.UUID | None,
    payload: NotificationTemplatePayload,
    *,
    actor_user_id: uuid.UUID,
) -> NotificationTemplate:
    if payload.channel not in NOTIFICATION_TEMPLATE_CHANNELS:
        raise ValueError("Notification channel is invalid.")
    if payload.language_code not in BOOKING_LANGUAGES:
        raise ValueError("Language code is invalid.")
    allowed_tokens = set(NOTIFICATION_TEMPLATE_PLACEHOLDERS.get(payload.template_key, []))
    if not allowed_tokens:
        raise ValueError("Notification template key is invalid.")
    _validate_template_tokens(payload.subject_template, allowed_tokens)
    _validate_template_tokens(payload.body_template, allowed_tokens)

    existing = NotificationTemplate.query.filter_by(
        template_key=payload.template_key,
        channel=payload.channel,
        language_code=payload.language_code,
        deleted_at=None,
    ).first()
    if existing and existing.id != template_id:
        raise ValueError("A template already exists for that key, channel, and language.")

    template = db.session.get(NotificationTemplate, template_id) if template_id else None
    if template_id and not template:
        raise ValueError("Notification template not found.")
    before = _notification_template_snapshot(template) if template else None

    if not template:
        template = NotificationTemplate(created_by_user_id=actor_user_id)
        db.session.add(template)
    template.template_key = payload.template_key
    template.channel = payload.channel
    template.language_code = payload.language_code
    template.description = clean_optional(payload.description, limit=255)
    template.subject_template = payload.subject_template.strip()
    template.body_template = payload.body_template.strip()
    template.is_active = payload.is_active
    template.updated_by_user_id = actor_user_id
    db.session.flush()

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="notification_templates",
        entity_id=str(template.id),
        action="notification_template_upserted",
        before_data=before,
        after_data=_notification_template_snapshot(template),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="admin.notification_template_updated",
        entity_table="notification_templates",
        entity_id=str(template.id),
        metadata={"template_key": template.template_key, "language_code": template.language_code},
    )
    db.session.commit()
    return template


def get_notification_template_variant(
    template_key: str,
    language_code: str,
    *,
    channel: str = "email",
) -> NotificationTemplate | None:
    fallback_channels = [channel]
    if channel != "email":
        fallback_channels.append("email")
    fallback_languages = [language_code]
    if language_code != "en":
        fallback_languages.append("en")
    for candidate_channel in fallback_channels:
        for candidate_language in fallback_languages:
            template = (
                NotificationTemplate.query.filter_by(
                    template_key=template_key,
                    channel=candidate_channel,
                    language_code=candidate_language,
                    is_active=True,
                    deleted_at=None,
                )
                .order_by(NotificationTemplate.updated_at.desc())
                .first()
            )
            if template:
                return template
    return None


def preview_notification_template(template_key: str, language_code: str, *, channel: str = "email") -> dict[str, str]:
    allowed_tokens = set(NOTIFICATION_TEMPLATE_PLACEHOLDERS.get(template_key, []))
    template = get_notification_template_variant(template_key, language_code, channel=channel)
    context = sample_notification_context(language_code)
    if template:
        return {
            "subject": _render_template_text(template.subject_template, context, allowed_tokens),
            "body": _render_template_text(template.body_template, context, allowed_tokens),
        }
    return {"subject": "", "body": ""}


def render_notification_template(
    template_key: str,
    language_code: str,
    context: dict[str, object],
    *,
    fallback_subject: str,
    fallback_body: str,
    channel: str = "email",
) -> tuple[str, str]:
    template = get_notification_template_variant(template_key, language_code, channel=channel)
    if not template:
        return fallback_subject, fallback_body
    allowed_tokens = set(NOTIFICATION_TEMPLATE_PLACEHOLDERS.get(template_key, []))
    return (
        _render_template_text(template.subject_template, context, allowed_tokens) or fallback_subject,
        _render_template_text(template.body_template, context, allowed_tokens) or fallback_body,
    )


def update_role_permissions(role_id: uuid.UUID, permission_codes: list[str], *, actor_user_id: uuid.UUID) -> Role:
    role = db.session.get(Role, role_id)
    if not role:
        raise ValueError("Role not found.")
    selected_permissions = Permission.query.filter(Permission.code.in_(permission_codes)).all()
    if len(selected_permissions) != len(set(permission_codes)):
        raise ValueError("One or more selected permissions are invalid.")
    before = {"permissions": [item.code for item in role.permissions]}
    role.permissions = selected_permissions
    role.updated_by_user_id = actor_user_id

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="roles",
        entity_id=str(role.id),
        action="role_permissions_updated",
        before_data=before,
        after_data={"permissions": sorted(permission_codes)},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="admin.role_permissions_updated",
        entity_table="roles",
        entity_id=str(role.id),
        metadata={"role_code": role.code, "permission_count": len(permission_codes)},
    )
    db.session.commit()
    return role


def query_audit_entries(
    *,
    actor_user_id: uuid.UUID | None = None,
    entity_table: str | None = None,
    action: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 200,
) -> list[AuditLog]:
    query = AuditLog.query
    if actor_user_id:
        query = query.filter(AuditLog.actor_user_id == actor_user_id)
    if entity_table:
        query = query.filter(AuditLog.entity_table == entity_table)
    if action:
        query = query.filter(AuditLog.action == action)
    if date_from:
        query = query.filter(AuditLog.created_at >= datetime.combine(date_from, datetime.min.time(), tzinfo=timezone.utc))
    if date_to:
        query = query.filter(AuditLog.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc))
    return query.order_by(AuditLog.created_at.desc()).limit(limit).all()


def summarize_audit_entry(entry: AuditLog) -> str:
    if entry.after_data and isinstance(entry.after_data, dict):
        interesting = list(entry.after_data.items())[:3]
        return ", ".join(f"{key}={value}" for key, value in interesting)
    if entry.before_data and isinstance(entry.before_data, dict):
        interesting = list(entry.before_data.items())[:3]
        return ", ".join(f"{key}={value}" for key, value in interesting)
    return ""


def sample_notification_context(language_code: str) -> dict[str, object]:
    return {
        "hotel_name": str(get_setting_value("hotel.name", "Sandbox Hotel")),
        "guest_name": "Sample Guest",
        "reservation_code": "SBX-00009999",
        "check_in_date": "2026-04-01",
        "check_out_date": "2026-04-03",
        "room_type_name": "Standard Double",
        "grand_total": "1500.00",
        "deposit_amount": "750.00",
        "payment_link": f"{current_app.config.get('APP_BASE_URL', 'https://sandbox-hotel.local').rstrip('/')}/payments/request/PAY-SAMPLE",
        "contact_phone": str(get_setting_value("hotel.contact_phone", "+66 000 000 000")),
        "contact_email": str(get_setting_value("hotel.contact_email", "reservations@sandbox-hotel.local")),
        "cancellation_policy": policy_text("cancellation_policy", language_code, ""),
        "check_in_policy": policy_text("check_in_policy", language_code, ""),
        "check_out_policy": policy_text("check_out_policy", language_code, ""),
        "source_channel": "direct_web",
    }


def _validate_template_tokens(template_text: str, allowed_tokens: set[str]) -> None:
    tokens = {field_name for _, field_name, _, _ in string.Formatter().parse(template_text) if field_name}
    unknown_tokens = sorted(tokens - allowed_tokens)
    if unknown_tokens:
        raise ValueError(f"Unknown template placeholders: {', '.join(unknown_tokens)}")


def _render_template_text(template_text: str, context: dict[str, object], allowed_tokens: set[str]) -> str:
    _validate_template_tokens(template_text, allowed_tokens)
    safe_context = {key: str(value or "") for key, value in context.items()}
    return template_text.format_map(_TemplateContext(safe_context))


class _TemplateContext(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def _room_type_snapshot(room_type: RoomType | None) -> dict | None:
    if not room_type:
        return None
    return {
        "code": room_type.code,
        "name": room_type.name,
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


def _policy_snapshot(document: PolicyDocument | None) -> dict | None:
    if not document:
        return None
    return {
        "code": document.code,
        "name": document.name,
        "version": document.version,
        "is_active": document.is_active,
        "content": document.content_json,
    }


def _notification_template_snapshot(template: NotificationTemplate | None) -> dict | None:
    if not template:
        return None
    return {
        "template_key": template.template_key,
        "channel": template.channel,
        "language_code": template.language_code,
        "is_active": template.is_active,
        "description": template.description,
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
    query = RateRule.query.filter(
        RateRule.deleted_at.is_(None),
        RateRule.is_active.is_(True),
        RateRule.rule_type == payload.rule_type,
        RateRule.priority == payload.priority,
    )
    if rate_rule_id:
        query = query.filter(RateRule.id != rate_rule_id)
    if payload.room_type_id:
        query = query.filter(RateRule.room_type_id == payload.room_type_id)
    else:
        query = query.filter(RateRule.room_type_id.is_(None))
    for rule in query.all():
        if not _date_overlap(rule.start_date, rule.end_date, payload.start_date, payload.end_date):
            continue
        if normalized_days and rule.days_of_week and not set(normalized_days.split(",")).intersection(set(rule.days_of_week.split(","))):
            continue
        if normalized_days != rule.days_of_week and normalized_days and rule.days_of_week:
            continue
        return rule
    return None


def _ensure_room_inventory(room: Room, *, actor_user_id: uuid.UUID) -> None:
    clean_status = HousekeepingStatus.query.filter_by(code="clean").first()
    out_status = HousekeepingStatus.query.filter_by(code="out_of_service").first()
    start_date = date.today()
    days = int(current_app.config.get("INVENTORY_BOOTSTRAP_DAYS", 30))
    existing_dates = {
        row.business_date
        for row in InventoryDay.query.filter(
            InventoryDay.room_id == room.id,
            InventoryDay.business_date >= start_date,
            InventoryDay.business_date < start_date + timedelta(days=days),
        ).all()
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


def _apply_inventory_override(override: InventoryOverride, *, actor_user_id: uuid.UUID) -> None:
    rows = _inventory_rows_for_override(override, lock=True)
    if not rows:
        raise ValueError("No inventory rows exist for the selected override date range.")
    clean_status = HousekeepingStatus.query.filter_by(code="clean").first()
    closure_status = HousekeepingStatus.query.filter_by(code="out_of_service").first()
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
    clean_status = HousekeepingStatus.query.filter_by(code="clean").first()
    closure_status = HousekeepingStatus.query.filter_by(code="out_of_service").first()
    default_sellable = bool(room and room.is_active and room.is_sellable and room.default_operational_status == "available")
    row.room_type_id = room.room_type_id if room else row.room_type_id
    row.availability_status = "available" if default_sellable else (room.default_operational_status if room else "out_of_service")
    row.is_sellable = default_sellable
    row.housekeeping_status_id = clean_status.id if default_sellable and clean_status else closure_status.id if closure_status else row.housekeeping_status_id
    row.notes = room.notes if room else row.notes
    row.updated_by_user_id = actor_user_id
