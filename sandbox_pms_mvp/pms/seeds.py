from __future__ import annotations

import logging
import os
import uuid
from datetime import date, timedelta
from decimal import Decimal

import sqlalchemy as sa
from flask import current_app

logger = logging.getLogger(__name__)

from .constants import (
    BOOKING_LANGUAGES,
    BOOKING_SOURCE_CHANNELS,
    DOCUMENT_TYPES,
    HOUSEKEEPING_STATUS_CODES,
    PERMISSION_SEEDS,
    RESERVATION_STATUSES,
    ROLE_PERMISSION_SEEDS,
    ROLE_SEEDS,
)
from .extensions import db
from .models import (
    AppSetting,
    AutomationRule,
    BlackoutPeriod,
    Guest,
    HousekeepingStatus,
    InventoryDay,
    MessageTemplate,
    NotificationTemplate,
    Permission,
    PolicyDocument,
    RateRule,
    Reservation,
    Role,
    Room,
    RoomType,
    User,
    utc_now,
)
from .services.auth_service import hash_password
from .settings import APP_SETTINGS_SEED, AUTOMATION_RULES_SEED, MESSAGE_TEMPLATES_SEED, NOTIFICATION_TEMPLATES_SEED, POLICY_DOCUMENTS_SEED


def seed_all(inventory_days: int = 730) -> None:
    seed_reference_data(sync_existing_roles=True)
    bootstrap_inventory_horizon(date.today(), inventory_days)
    if not _is_demo_data_already_seeded():
        seed_demo_guests_and_reservations()
    db.session.commit()


def seed_reference_data(*, sync_existing_roles: bool = False) -> None:
    seed_roles_permissions(sync_existing_roles=sync_existing_roles)
    seed_housekeeping_statuses()
    room_types = seed_room_types()
    seed_rooms(room_types)
    seed_rate_rules(room_types)
    seed_app_settings()
    seed_policy_documents()
    seed_notification_templates()
    seed_message_templates()
    seed_initial_admin()
    seed_employee_accounts()
    db.session.commit()


def seed_roles_permissions(*, sync_existing_roles: bool = True) -> None:
    for code, name, description, module in PERMISSION_SEEDS:
        permission = db.session.execute(
            sa.select(Permission).where(Permission.code == code)
        ).scalar_one_or_none()
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
    permissions = {
        permission.code: permission
        for permission in db.session.execute(sa.select(Permission)).scalars().all()
    }
    for code, name, description, is_system_role, sort_order in ROLE_SEEDS:
        role = (
            db.session.execute(sa.select(Role).where(Role.code == code))
            .unique()
            .scalars()
            .first()
        )
        role_created = False
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
            role_created = True
        if role_created or sync_existing_roles:
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
        "cleaning_in_progress": ("Cleaning In Progress", "Housekeeper is cleaning the room", False, 11),
    }
    for code in HOUSEKEEPING_STATUS_CODES:
        if db.session.execute(
            sa.select(HousekeepingStatus).where(HousekeepingStatus.code == code)
        ).scalar_one_or_none():
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
        room_type = db.session.execute(
            sa.select(RoomType).where(RoomType.code == code)
        ).scalar_one_or_none()
        if not room_type:
            room_type = RoomType(
                code=code,
                name=payload[0],
                summary=None,
                description=payload[1],
                bed_details=payload[1],
                media_urls=None,
                amenities=None,
                policy_callouts=None,
                standard_occupancy=payload[2],
                max_occupancy=payload[3],
                extra_bed_allowed=payload[4],
                is_active=True,
            )
            db.session.add(room_type)
            db.session.flush()
        elif room_type.description and not room_type.bed_details:
            room_type.bed_details = room_type.description
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
    if db.session.execute(
        sa.select(Room).where(Room.room_number == room_number)
    ).scalar_one_or_none():
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
        if db.session.execute(
            sa.select(RateRule).where(RateRule.name == name)
        ).scalar_one_or_none():
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
        setting = db.session.execute(
            sa.select(AppSetting).where(AppSetting.key == key)
        ).scalar_one_or_none()
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
    cfg_email = current_app.config.get("ADMIN_EMAIL")
    cfg_password = current_app.config.get("ADMIN_PASSWORD")
    admin_email = str(cfg_email if cfg_email is not None else (os.getenv("ADMIN_EMAIL") or "")).strip()
    admin_password = str(cfg_password if cfg_password is not None else (os.getenv("ADMIN_PASSWORD") or ""))
    admin_role = (
        db.session.execute(sa.select(Role).where(Role.code == "admin"))
        .unique()
        .scalars()
        .first()
    )
    existing_admin_user = None
    if admin_role:
        existing_admin_user = (
            db.session.execute(
                sa.select(User)
                .join(User.roles)
                .where(Role.id == admin_role.id)
            )
            .unique()
            .scalars()
            .first()
        )
    if existing_admin_user:
        if not admin_email:
            return
        existing_user = (
            db.session.execute(sa.select(User).where(User.email == admin_email))
            .unique()
            .scalars()
            .first()
        )
        if existing_user:
            return
    if not admin_email or not admin_password.strip():
        raise RuntimeError("ADMIN_EMAIL and ADMIN_PASSWORD are required to bootstrap the initial admin account.")
    user = (
        db.session.execute(sa.select(User).where(User.email == admin_email))
        .unique()
        .scalars()
        .first()
    )
    if user:
        return
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


_EMPLOYEE_ACCOUNTS = [
    # (username, password, full_name, role_code)
    ("hui.admin", "6astxSjtq9RF", "Hui", "admin"),
    ("manager", "jyVCLAzMXL6U", "Manager", "manager"),
    ("housekeeping", "X3Hp9bnTdKTn", "Housekeeping", "housekeeping"),
    ("frontdesk", "3Y5vyMujqXwU", "Front Desk", "front_desk"),
]


def seed_employee_accounts() -> None:
    """Create built-in employee accounts (idempotent).

    These are bootstrap staff credentials for core operational roles.
    Rotate passwords after deployment to a live environment.
    """
    existing = {
        username
        for username in db.session.execute(
            sa.select(User.username).where(
                User.username.in_([account[0] for account in _EMPLOYEE_ACCOUNTS])
            )
        )
        .scalars()
        .all()
    }
    roles: dict[str, Role] = {
        role.code: role
        for role in db.session.execute(sa.select(Role)).unique().scalars().all()
    }
    for username, password, full_name, role_code in _EMPLOYEE_ACCOUNTS:
        if username in existing:
            continue
        role = roles.get(role_code)
        if not role:
            continue
        user = User(
            username=username,
            email=f"{username}@internal.sandbox.local",
            full_name=full_name,
            password_hash=hash_password(password),
            is_active=True,
            account_state="active",
            password_changed_at=utc_now(),
        )
        user.roles = [role]
        db.session.add(user)


def seed_policy_documents() -> None:
    for code, payload in POLICY_DOCUMENTS_SEED.items():
        document = db.session.execute(
            sa.select(PolicyDocument).where(PolicyDocument.code == code)
        ).scalar_one_or_none()
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
        template = db.session.execute(
            sa.select(NotificationTemplate).where(
                NotificationTemplate.template_key == template_key,
                NotificationTemplate.channel == channel,
                NotificationTemplate.language_code == language_code,
            )
        ).scalar_one_or_none()
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


def seed_message_templates() -> None:
    """Seed Phase 18 messaging hub templates and automation rules."""
    for template_key, template_type, channel, language_code, name, subject_template, body_template in MESSAGE_TEMPLATES_SEED:
        existing = db.session.execute(
            sa.select(MessageTemplate).where(
                MessageTemplate.template_key == template_key,
                MessageTemplate.channel == channel,
                MessageTemplate.language_code == language_code,
            )
        ).scalar_one_or_none()
        if existing:
            continue
        db.session.add(
            MessageTemplate(
                template_key=template_key,
                template_type=template_type,
                channel=channel,
                language_code=language_code,
                name=name,
                subject_template=subject_template,
                body_template=body_template,
                is_active=True,
            )
        )
    db.session.flush()

    for event_type, template_key, channel, is_active, delay_minutes in AUTOMATION_RULES_SEED:
        existing = db.session.execute(
            sa.select(AutomationRule).where(
                AutomationRule.event_type == event_type,
                AutomationRule.channel == channel,
                AutomationRule.deleted_at.is_(None),
            )
        ).scalar_one_or_none()
        if existing:
            continue
        template = db.session.execute(
            sa.select(MessageTemplate).where(
                MessageTemplate.template_key == template_key,
                MessageTemplate.channel == channel,
            )
        ).scalar_one_or_none()
        db.session.add(
            AutomationRule(
                event_type=event_type,
                template_id=template.id if template else None,
                channel=channel,
                is_active=is_active,
                delay_minutes=delay_minutes,
            )
        )


def bootstrap_inventory_horizon(start_date: date, days: int) -> None:
    clean_status = db.session.execute(
        sa.select(HousekeepingStatus).where(HousekeepingStatus.code == "clean")
    ).scalar_one_or_none()
    oos_status = db.session.execute(
        sa.select(HousekeepingStatus).where(HousekeepingStatus.code == "out_of_service")
    ).scalar_one_or_none()
    rooms = db.session.execute(
        sa.select(Room).order_by(Room.room_number.asc())
    ).scalars().all()
    end_date = start_date + timedelta(days=days - 1)
    existing = {
        (str(room_id), business_date)
        for room_id, business_date in db.session.execute(
            sa.select(InventoryDay.room_id, InventoryDay.business_date).where(
                InventoryDay.business_date >= start_date,
                InventoryDay.business_date <= end_date,
            )
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


def _is_demo_data_already_seeded() -> bool:
    """Check if demo data has already been seeded by looking for DEMO- phone prefix."""
    demo_guest_count = db.session.execute(
        sa.select(sa.func.count()).select_from(Guest).where(Guest.phone.like("DEMO-%"))
    ).scalar_one()
    return demo_guest_count > 0


def seed_demo_guests_and_reservations(
    num_guests: int = 30,
    num_reservations: int = 80
) -> None:
    """
    Create demo guests and reservations centered around today's date.

    Distribution:
    - ~30% checked_out (past 2 weeks)
    - ~20% checked_in (currently in-house)
    - ~25% confirmed (today + future 2 weeks)
    - ~10% cancelled (various dates)
    - ~5% no_show (past week)
    """
    logger.info("Seeding demo guests and reservations...")

    # Sample guest data: [(first_name, last_name, nationality)]
    guest_data = [
        ("Maria", "Garcia", "ES"),
        ("John", "Smith", "US"),
        ("Yuki", "Tanaka", "JP"),
        ("Carlos", "Rodriguez", "MX"),
        ("Aisha", "Ahmed", "EG"),
        ("Petra", "Mueller", "DE"),
        ("Raj", "Patel", "IN"),
        ("Sophie", "Bernard", "FR"),
        ("Chang", "Liu", "CN"),
        ("Nina", "Kowalski", "PL"),
        ("Lars", "Eriksson", "SE"),
        ("Olivia", "Silva", "BR"),
        ("Marco", "Rossi", "IT"),
        ("Emma", "Johnson", "AU"),
        ("Ahmed", "Hassan", "SA"),
        ("Ingrid", "Bergman", "NO"),
        ("Diego", "Sanchez", "AR"),
        ("Yuki", "Suzuki", "JP"),
        ("Anna", "Novak", "CZ"),
        ("David", "Cohen", "IL"),
        ("Lisa", "Schmidt", "AT"),
        ("Khalid", "Mohammed", "AE"),
        ("Gabriela", "Santos", "PT"),
        ("Thomas", "Larsen", "DK"),
        ("Zara", "Al-Rashid", "KW"),
        ("Miguel", "Flores", "CO"),
        ("Elena", "Petrov", "RU"),
        ("Hassan", "Ibrahim", "SD"),
        ("Natasha", "Sokolov", "LV"),
        ("Stefan", "Kovacs", "RO"),
    ]

    # Create guests
    admin_user = (
        db.session.execute(
            sa.select(User)
            .join(User.roles)
            .where(Role.code == "admin")
        )
        .unique()
        .scalars()
        .first()
    )
    admin_id = admin_user.id if admin_user else None

    created_guests = _create_demo_guests(guest_data[:num_guests], admin_id)

    # Get room types efficiently (1 query instead of 2)
    room_types = {
        room_type.code: room_type
        for room_type in db.session.execute(sa.select(RoomType)).scalars().all()
    }
    twin_room_type = room_types["TWN"]
    double_room_type = room_types["DBL"]

    # Pre-compute rooms by type to avoid repeated filtering
    sellable_rooms = db.session.execute(
        sa.select(Room).where(Room.is_sellable.is_(True))
    ).scalars().all()
    rooms_by_type = {
        twin_room_type.id: [r for r in sellable_rooms if r.room_type_id == twin_room_type.id],
        double_room_type.id: [r for r in sellable_rooms if r.room_type_id == double_room_type.id],
    }

    # Base rates (per night)
    base_rates = {
        "TWN": 120,
        "DBL": 150,
    }

    # Use dynamic dates centered on today
    today = date.today()
    past_start = today - timedelta(days=14)
    future_end = today + timedelta(days=14)

    # Distribution
    num_checked_out = int(num_reservations * 0.30)
    num_checked_in = int(num_reservations * 0.20)
    num_confirmed = int(num_reservations * 0.25)
    num_cancelled = int(num_reservations * 0.10)
    num_no_show = int(num_reservations * 0.05)
    # Fill remainder with confirmed
    remaining = num_reservations - num_checked_out - num_checked_in - num_confirmed - num_cancelled - num_no_show
    num_confirmed += max(0, remaining)

    # Generate all reservations with unified counter
    res_reservations = []
    res_counter = 1000

    # 1. Checked-out: past 2 weeks
    for i in range(num_checked_out):
        guest = created_guests[i % len(created_guests)]
        nights = 1 + (i % 5)
        start_offset = i % 14
        check_in = past_start + timedelta(days=start_offset)
        check_out = check_in + timedelta(days=nights)
        if check_out > today:
            check_out = today
            if check_in >= check_out:
                check_in = check_out - timedelta(days=1)
        room_type = double_room_type if i % 3 != 0 else twin_room_type
        reservation, res_counter = _create_single_reservation(
            res_counter, guest, check_in, check_out, room_type,
            RESERVATION_STATUSES[4], base_rates, admin_id,
            True, rooms_by_type,
        )
        res_reservations.append(reservation)

    # 2. Currently checked-in (in-house)
    for i in range(num_checked_in):
        guest = created_guests[(num_checked_out + i) % len(created_guests)]
        nights = 2 + (i % 5)
        check_in = today - timedelta(days=1 + (i % 3))
        check_out = check_in + timedelta(days=nights)
        if check_out <= today:
            check_out = today + timedelta(days=1 + (i % 3))
        room_type = double_room_type if i % 2 == 0 else twin_room_type
        reservation, res_counter = _create_single_reservation(
            res_counter, guest, check_in, check_out, room_type,
            "checked_in", base_rates, admin_id,
            True, rooms_by_type,
        )
        reservation.checked_in_at = utc_now()
        # Vary deposit status: some paid, some partial, some unpaid
        if i % 4 == 0:
            reservation.deposit_received_amount = reservation.quoted_grand_total
        elif i % 4 == 1:
            reservation.deposit_received_amount = Decimal(str(round(float(reservation.quoted_grand_total) * 0.5, 2)))
        elif i % 4 == 2:
            reservation.deposit_received_amount = Decimal("0.00")
        res_reservations.append(reservation)

    # 3. Confirmed (today arrivals + future)
    for i in range(num_confirmed):
        guest = created_guests[(num_checked_out + num_checked_in + i) % len(created_guests)]
        nights = 1 + (i % 6)
        # First few arrive today for realistic board view
        if i < 5:
            check_in = today
        else:
            check_in = today + timedelta(days=(i % 14))
        check_out = check_in + timedelta(days=nights)
        if check_out > future_end:
            check_out = future_end
            if check_in >= check_out:
                check_in = check_out - timedelta(days=1)
        room_type = double_room_type if i % 3 != 0 else twin_room_type
        # Assign rooms to today's arrivals, leave some future ones unallocated
        assign = (i < 5) or (i % 3 != 0)
        reservation, res_counter = _create_single_reservation(
            res_counter, guest, check_in, check_out, room_type,
            RESERVATION_STATUSES[2], base_rates, admin_id,
            assign, rooms_by_type if assign else None,
        )
        # Vary deposit status
        if i % 3 == 0:
            reservation.deposit_received_amount = reservation.deposit_required_amount
        elif i % 3 == 1:
            reservation.deposit_received_amount = Decimal("0.00")
        res_reservations.append(reservation)

    # 4. Cancelled
    for i in range(num_cancelled):
        guest = created_guests[(i * 3) % len(created_guests)]
        nights = 2 + (i % 4)
        check_in = past_start + timedelta(days=i * 2)
        check_out = check_in + timedelta(days=nights)
        room_type = double_room_type if i % 2 == 0 else twin_room_type
        reservation, res_counter = _create_single_reservation(
            res_counter, guest, check_in, check_out, room_type,
            RESERVATION_STATUSES[5], base_rates, admin_id,
            False, None,
        )
        res_reservations.append(reservation)

    # 5. No-show
    for i in range(num_no_show):
        guest = created_guests[(i * 5) % len(created_guests)]
        nights = 1 + (i % 3)
        check_in = today - timedelta(days=1 + (i % 5))
        check_out = check_in + timedelta(days=nights)
        room_type = twin_room_type
        reservation, res_counter = _create_single_reservation(
            res_counter, guest, check_in, check_out, room_type,
            RESERVATION_STATUSES[6], base_rates, admin_id,
            True, rooms_by_type,
        )
        res_reservations.append(reservation)

    # Flush reservations
    for reservation in res_reservations:
        db.session.add(reservation)
    db.session.flush()

    # ── Enrich seed data: folio charges, notes, HK statuses ──
    _seed_demo_folio_charges(res_reservations, admin_id)
    _seed_demo_notes(res_reservations, admin_id)
    _seed_demo_housekeeping_statuses(sellable_rooms)

    logger.info(
        f"Created demo data: {len(created_guests)} guests and {len(res_reservations)} reservations"
    )


def _create_demo_guests(guest_data: list, admin_id: uuid.UUID | None) -> list[Guest]:
    """Create demo guests from guest data."""
    created_guests = []
    for idx, (first_name, last_name, nationality) in enumerate(guest_data):
        phone = f"DEMO-{idx + 1:03d}"
        email = f"{first_name.lower()}.{last_name.lower()}@demo.example.com"
        full_name = f"{first_name} {last_name}"

        guest = Guest(
            first_name=first_name,
            last_name=last_name,
            full_name=full_name,
            phone=phone,
            email=email,
            nationality=nationality,
            id_document_type=DOCUMENT_TYPES[0],  # "passport"
            id_document_number=f"DEMO{idx + 1:05d}",
            date_of_birth=date(1980 + (idx % 40), 1 + (idx % 12), 1 + (idx % 27)),
            preferred_language=BOOKING_LANGUAGES[1],  # "en"
            marketing_opt_in=idx % 3 == 0,
            blacklist_flag=False,
            notes_summary=None,
            created_by_user_id=admin_id,
        )
        db.session.add(guest)
        db.session.flush()
        created_guests.append(guest)
    return created_guests


def _create_single_reservation(
    res_counter: int,
    guest: Guest,
    check_in: date,
    check_out: date,
    room_type: RoomType,
    status: str,
    base_rates: dict,
    admin_id: uuid.UUID | None,
    assign_room: bool = False,
    rooms_by_type: dict | None = None,
) -> tuple:
    """Create a single reservation. Returns (reservation, updated_counter)."""
    nights = (check_out - check_in).days
    room_total = _calculate_room_total(nights, base_rates.get(room_type.code, 140))
    tax_total = _calculate_tax(room_total)
    grand_total = room_total + tax_total

    res_code = f"SBX-{res_counter:05d}"
    res_counter += 1

    assigned_room = None
    if assign_room and rooms_by_type and room_type.id in rooms_by_type:
        available_rooms = rooms_by_type[room_type.id]
        if available_rooms:
            assigned_room = available_rooms[res_counter % len(available_rooms)]

    reservation = Reservation(
        reservation_code=res_code,
        primary_guest_id=guest.id,
        room_type_id=room_type.id,
        assigned_room_id=assigned_room.id if assigned_room else None,
        current_status=status,
        source_channel=BOOKING_SOURCE_CHANNELS[0],  # "direct"
        check_in_date=check_in,
        check_out_date=check_out,
        adults=1 + (res_counter % 3),
        children=0,
        extra_guests=0,
        special_requests=_get_random_special_request(res_counter),
        internal_notes=None,
        quoted_room_total=Decimal(str(round(room_total, 2))),
        quoted_tax_total=Decimal(str(round(tax_total, 2))),
        quoted_extras_total=Decimal("0.00"),
        quoted_grand_total=Decimal(str(round(grand_total, 2))),
        deposit_required_amount=Decimal(str(round(grand_total * 0.25, 2))),
        deposit_received_amount=Decimal(str(round(grand_total * 0.25, 2))),
        booking_language=BOOKING_LANGUAGES[1],  # "en"
        booked_at=utc_now(),
        created_by_user_id=admin_id,
    )

    _apply_status_timestamps(reservation, status, res_counter)
    return (reservation, res_counter)


def _calculate_room_total(nights: int, base_rate: float) -> float:
    """Calculate room total with long-stay discounts."""
    room_total = nights * base_rate
    if nights >= 14:
        return room_total * 0.85
    elif nights >= 7:
        return room_total * 0.90
    elif nights >= 3:
        return room_total * 0.95
    return room_total


def _calculate_tax(amount: float, tax_rate: float = 0.10) -> float:
    """Calculate tax on amount."""
    return amount * tax_rate


def _apply_status_timestamps(reservation: Reservation, status: str, seed: int) -> None:
    """Apply status-specific timestamps to reservation."""
    if status == RESERVATION_STATUSES[4]:  # checked_out
        reservation.checked_in_at = utc_now()
        reservation.checked_out_at = utc_now()
    elif status == RESERVATION_STATUSES[5]:  # cancelled
        reservation.cancelled_at = utc_now()
        reservation.cancellation_reason = _get_random_cancellation_reason(seed)
    elif status == RESERVATION_STATUSES[6]:  # no_show
        reservation.no_show_at = utc_now()


def _get_random_special_request(seed: int) -> str | None:
    """Get a random special request based on seed."""
    requests = [
        "Early check-in requested",
        "Late check-out needed",
        "Ground floor room preferred",
        "Quieter room away from elevator",
        "High floor view preferred",
        "Wheelchair accessible required",
        "Non-smoking room",
        "Baby crib needed",
        "High floor preferred",
        "Low floor preferred",
        None,
    ]
    return requests[seed % len(requests)]


def _get_random_cancellation_reason(seed: int) -> str:
    """Get a random cancellation reason based on seed."""
    reasons = [
        "Guest requested",
        "Overbooking resolution",
        "Invalid payment method",
        "Duplicate booking",
        "Change of plans",
    ]
    return reasons[seed % len(reasons)]


def _seed_demo_folio_charges(reservations: list, admin_id: uuid.UUID | None) -> None:
    """Add sample folio charges to in-house and checked-out reservations."""
    from .models import FolioCharge

    charge_templates = [
        ("SNK", "manual_charge", "Minibar charges", Decimal("180.00")),
        ("LND", "manual_charge", "Laundry service", Decimal("250.00")),
        ("XTR", "manual_charge", "Restaurant — dinner", Decimal("750.00")),
        ("XTR", "manual_charge", "Cafe — breakfast add-on", Decimal("120.00")),
        ("XTR", "fee", "Airport transfer", Decimal("350.00")),
        ("LCO", "fee", "Late check-out fee", Decimal("200.00")),
        ("EXB", "fee", "Extra bed", Decimal("300.00")),
    ]

    active_reservations = [r for r in reservations if r.current_status in ("checked_in", "checked_out")]
    for idx, res in enumerate(active_reservations):
        # Add 1-3 charges per active reservation
        num_charges = 1 + (idx % 3)
        for j in range(num_charges):
            template = charge_templates[(idx + j) % len(charge_templates)]
            charge = FolioCharge(
                reservation_id=res.id,
                charge_code=template[0],
                charge_type=template[1],
                description=template[2],
                quantity=1,
                unit_amount=template[3],
                line_amount=template[3],
                tax_amount=Decimal(str(round(float(template[3]) * 0.07, 2))),
                total_amount=template[3] + Decimal(str(round(float(template[3]) * 0.07, 2))),
                service_date=res.check_in_date + timedelta(days=j),
                posted_at=utc_now(),
                posted_by_user_id=admin_id,
                posting_key=f"DEMO-{res.reservation_code}-{j}",
            )
            db.session.add(charge)

    db.session.flush()
    logger.info(f"Seeded folio charges for {len(active_reservations)} active reservations")


def _seed_demo_notes(reservations: list, admin_id: uuid.UUID | None) -> None:
    """Add sample internal notes to some reservations."""
    from .models import ReservationNote

    note_templates = [
        ("Guest requested extra pillows", "general", False),
        ("VIP guest — arrange welcome amenity", "general", True),
        ("Guest mentioned food allergy — no peanuts", "general", True),
        ("Returning guest — preferred room 305", "general", False),
        ("Late arrival expected after 22:00", "general", False),
        ("Wedding anniversary celebration — room decoration requested", "general", True),
        ("Guest traveling with infant — baby cot placed", "general", False),
        ("Corporate rate verified with company HR", "general", False),
    ]

    for idx, res in enumerate(reservations):
        if idx % 4 != 0:
            continue
        template = note_templates[idx % len(note_templates)]
        note = ReservationNote(
            reservation_id=res.id,
            note_text=template[0],
            note_type=template[1],
            is_important=template[2],
            visibility_scope="all_staff",
            created_by_user_id=admin_id,
        )
        db.session.add(note)

    db.session.flush()
    logger.info("Seeded reservation notes")


def _seed_demo_housekeeping_statuses(rooms: list) -> None:
    """Set varied housekeeping statuses on today's inventory for a realistic board."""
    today = date.today()

    # Get HK status IDs
    hk_statuses = {
        row.code: row.id
        for row in db.session.execute(sa.select(HousekeepingStatus)).scalars().all()
    }

    # Distribution across rooms: clean, dirty, inspected, occupied_dirty, out_of_order
    hk_assignments = [
        "clean", "clean", "clean", "dirty", "dirty", "inspected",
        "clean", "occupied_clean", "dirty", "clean",
        "clean", "inspected", "dirty", "clean", "clean",
        "occupied_dirty", "clean", "clean", "occupied_clean", "clean",
        "inspected", "dirty", "clean", "clean", "clean",
        "clean", "dirty", "inspected", "clean", "out_of_order",
    ]

    for idx, room in enumerate(rooms):
        inv = db.session.execute(
            sa.select(InventoryDay).where(
                InventoryDay.room_id == room.id,
                InventoryDay.business_date == today,
            )
        ).scalar_one_or_none()
        if not inv:
            continue
        hk_code = hk_assignments[idx % len(hk_assignments)]
        if hk_code in hk_statuses:
            inv.housekeeping_status_id = hk_statuses[hk_code]
        if hk_code == "out_of_order":
            inv.maintenance_flag = True
            inv.maintenance_note = "Air conditioning repair scheduled"

    db.session.flush()
    logger.info("Seeded housekeeping statuses")
