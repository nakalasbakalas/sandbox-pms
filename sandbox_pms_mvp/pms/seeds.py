from __future__ import annotations

import os
import uuid
from datetime import date, timedelta
from decimal import Decimal

from .constants import (
    HOUSEKEEPING_STATUS_CODES,
    PERMISSION_SEEDS,
    ROLE_PERMISSION_SEEDS,
    ROLE_SEEDS,
)
from .extensions import db
from .models import (
    AppSetting,
    BlackoutPeriod,
    HousekeepingStatus,
    InventoryDay,
    NotificationTemplate,
    Permission,
    PolicyDocument,
    RateRule,
    Role,
    Room,
    RoomType,
    User,
    utc_now,
)
from .services.auth_service import hash_password
from .settings import APP_SETTINGS_SEED, NOTIFICATION_TEMPLATES_SEED, POLICY_DOCUMENTS_SEED


def seed_all(inventory_days: int = 730) -> None:
    seed_roles_permissions()
    seed_housekeeping_statuses()
    room_types = seed_room_types()
    seed_rooms(room_types)
    seed_rate_rules(room_types)
    seed_app_settings()
    seed_policy_documents()
    seed_notification_templates()
    seed_initial_admin()
    db.session.commit()
    bootstrap_inventory_horizon(date.today(), inventory_days)
    db.session.commit()


def seed_roles_permissions() -> None:
    for code, name, description, module in PERMISSION_SEEDS:
        permission = Permission.query.filter_by(code=code).first()
        if not permission:
            db.session.add(
                Permission(
                    code=code,
                    name=name,
                    description=description,
                    module=module,
                )
            )
    db.session.flush()
    permissions = {permission.code: permission for permission in Permission.query.all()}
    for code, name, description, is_system_role, sort_order in ROLE_SEEDS:
        role = Role.query.filter_by(code=code).first()
        if not role:
            role = Role(
                code=code,
                name=name,
                description=description,
                is_system_role=is_system_role,
                sort_order=sort_order,
            )
            db.session.add(role)
            db.session.flush()
        role.permissions = [permissions[item] for item in ROLE_PERMISSION_SEEDS[code]]


def seed_housekeeping_statuses() -> None:
    status_details = {
        "clean": ("Clean", "Vacant clean and ready", True, 1),
        "dirty": ("Dirty", "Needs cleaning", False, 2),
        "inspected": ("Inspected", "Supervisor approved", True, 3),
        "pickup": ("Pickup", "Quick touch-up needed", False, 4),
        "occupied_clean": ("Occupied Clean", "In-house and clean", False, 5),
        "occupied_dirty": ("Occupied Dirty", "In-house and dirty", False, 6),
        "do_not_disturb": ("Do Not Disturb", "Guest requested no service", False, 7),
        "sleep": ("Sleep", "Sleeping guest", False, 8),
        "out_of_service": ("Out of Service", "Temporarily not sellable", False, 9),
        "out_of_order": ("Out of Order", "Major maintenance outage", False, 10),
    }
    for code in HOUSEKEEPING_STATUS_CODES:
        if HousekeepingStatus.query.filter_by(code=code).first():
            continue
        name, description, is_sellable_state, sort_order = status_details[code]
        db.session.add(
            HousekeepingStatus(
                code=code,
                name=name,
                description=description,
                is_sellable_state=is_sellable_state,
                sort_order=sort_order,
            )
        )


def seed_room_types() -> dict[str, RoomType]:
    room_type_definitions = {
        "TWN": ("Standard Twin", "Two single beds", 2, 3, True),
        "DBL": ("Standard Double", "One double bed", 2, 3, True),
    }
    room_types: dict[str, RoomType] = {}
    for code, payload in room_type_definitions.items():
        room_type = RoomType.query.filter_by(code=code).first()
        if not room_type:
            room_type = RoomType(
                code=code,
                name=payload[0],
                description=payload[1],
                standard_occupancy=payload[2],
                max_occupancy=payload[3],
                extra_bed_allowed=payload[4],
                is_active=True,
            )
            db.session.add(room_type)
            db.session.flush()
        room_types[code] = room_type
    return room_types


def seed_rooms(room_types: dict[str, RoomType]) -> None:
    for room_number in range(201, 216):
        create_room_if_missing(str(room_number), room_types["TWN"].id, 2, True, True, "available", None)
    create_room_if_missing("216", room_types["TWN"].id, 2, False, False, "out_of_service", "Swing room / emergency use")
    for room_number in range(301, 316):
        create_room_if_missing(str(room_number), room_types["DBL"].id, 3, True, True, "available", None)
    create_room_if_missing("316", room_types["DBL"].id, 3, False, False, "out_of_service", "Maintenance buffer")


def create_room_if_missing(room_number: str, room_type_id, floor_number: int, is_active: bool, is_sellable: bool, status: str, notes: str | None) -> None:
    if Room.query.filter_by(room_number=room_number).first():
        return
    db.session.add(
        Room(
            room_number=room_number,
            room_type_id=room_type_id,
            floor_number=floor_number,
            is_active=is_active,
            is_sellable=is_sellable,
            default_operational_status=status,
            notes=notes,
        )
    )


def seed_rate_rules(room_types: dict[str, RoomType]) -> None:
    rules = [
        ("Twin weekday", room_types["TWN"].id, 10, "base_rate", "fixed", "720.00", "0,1,2,3,6"),
        ("Twin weekend", room_types["TWN"].id, 20, "weekend_override", "fixed", "790.00", "4,5"),
        ("Twin holiday", room_types["TWN"].id, 30, "holiday_override", "fixed", "850.00", None),
        ("Twin peak holiday weekend", room_types["TWN"].id, 40, "seasonal_override", "fixed", "890.00", None),
        ("Double weekday", room_types["DBL"].id, 10, "base_rate", "fixed", "750.00", "0,1,2,3,6"),
        ("Double weekend", room_types["DBL"].id, 20, "weekend_override", "fixed", "820.00", "4,5"),
        ("Double holiday", room_types["DBL"].id, 30, "holiday_override", "fixed", "880.00", None),
        ("Double peak holiday weekend", room_types["DBL"].id, 40, "seasonal_override", "fixed", "920.00", None),
        ("Long stay 3-6 nights", None, 50, "long_stay_discount", "percent_delta", "-5.00", None),
        ("Long stay 7-13 nights", None, 51, "long_stay_discount", "percent_delta", "-10.00", None),
        ("Long stay 14-29 nights", None, 52, "long_stay_discount", "percent_delta", "-15.00", None),
    ]
    for name, room_type_id, priority, rule_type, adjustment_type, adjustment_value, days_of_week in rules:
        if RateRule.query.filter_by(name=name).first():
            continue
        db.session.add(
            RateRule(
                name=name,
                room_type_id=room_type_id,
                priority=priority,
                is_active=True,
                rule_type=rule_type,
                adjustment_type=adjustment_type,
                adjustment_value=Decimal(adjustment_value),
                days_of_week=days_of_week,
                min_nights=3 if "3-6" in name else 7 if "7-13" in name else 14 if "14-29" in name else None,
                max_nights=6 if "3-6" in name else 13 if "7-13" in name else 29 if "14-29" in name else None,
            )
        )


def seed_app_settings() -> None:
    for key, value_json, value_type, description, is_public, sort_order in APP_SETTINGS_SEED:
        setting = AppSetting.query.filter_by(key=key).first()
        if setting:
            continue
        db.session.add(
            AppSetting(
                key=key,
                value_json=value_json,
                value_type=value_type,
                description=description,
                is_public=is_public,
                sort_order=sort_order,
            )
        )


def seed_initial_admin() -> None:
    admin_email = os.getenv("ADMIN_EMAIL", "admin@sandbox.local")
    admin_password = os.getenv("ADMIN_PASSWORD", "sandbox-admin-123")
    user = User.query.filter_by(email=admin_email).first()
    if user:
        return
    admin_role = Role.query.filter_by(code="admin").first()
    user = User(
        username=admin_email.split("@", 1)[0].lower(),
        email=admin_email,
        full_name="Sandbox Admin",
        password_hash=hash_password(admin_password),
        is_active=True,
        account_state="active",
        password_changed_at=utc_now(),
    )
    user.roles = [admin_role]
    db.session.add(user)


def seed_policy_documents() -> None:
    for code, payload in POLICY_DOCUMENTS_SEED.items():
        document = PolicyDocument.query.filter_by(code=code).first()
        if document:
            continue
        db.session.add(
            PolicyDocument(
                code=code,
                name=payload["name"],
                version=payload["version"],
                content_json=payload["content"],
                is_active=True,
            )
        )


def seed_notification_templates() -> None:
    for template_key, channel, language_code, description, subject_template, body_template in NOTIFICATION_TEMPLATES_SEED:
        template = NotificationTemplate.query.filter_by(
            template_key=template_key,
            channel=channel,
            language_code=language_code,
        ).first()
        if template:
            continue
        db.session.add(
            NotificationTemplate(
                template_key=template_key,
                channel=channel,
                language_code=language_code,
                description=description,
                subject_template=subject_template,
                body_template=body_template,
                is_active=True,
            )
        )


def bootstrap_inventory_horizon(start_date: date, days: int) -> None:
    clean_status = HousekeepingStatus.query.filter_by(code="clean").first()
    oos_status = HousekeepingStatus.query.filter_by(code="out_of_service").first()
    rooms = Room.query.order_by(Room.room_number.asc()).all()
    end_date = start_date + timedelta(days=days - 1)
    existing = {
        (str(item.room_id), item.business_date)
        for item in InventoryDay.query.filter(
            InventoryDay.business_date >= start_date,
            InventoryDay.business_date <= end_date,
        ).all()
    }
    for room in rooms:
        for offset in range(days):
            business_date = start_date + timedelta(days=offset)
            if (str(room.id), business_date) in existing:
                continue
            db.session.add(
                InventoryDay(
                    id=uuid.uuid4(),
                    room_id=room.id,
                    room_type_id=room.room_type_id,
                    business_date=business_date,
                    availability_status="available" if room.is_sellable else "out_of_service",
                    housekeeping_status_id=(clean_status.id if room.is_sellable else oos_status.id),
                    is_sellable=room.is_sellable,
                    notes=room.notes,
                )
            )
