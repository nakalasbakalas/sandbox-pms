"""Setup completeness check and first-run detection."""

from __future__ import annotations

import sqlalchemy as sa

from ..extensions import db
from ..models import AppSetting, Room, RoomType, User
from ..pricing import get_setting_value


# Keys that should have meaningful (non-empty) values for the system to be
# considered fully configured.
REQUIRED_SETUP_KEYS = [
    "hotel.name",
    "hotel.contact_phone",
    "hotel.contact_email",
    "hotel.address",
    "hotel.currency",
    "hotel.check_in_time",
    "hotel.check_out_time",
]

# Default placeholder values that indicate a setting has not been configured.
_PLACEHOLDER_VALUES = {"My Hotel", ""}


def setup_completeness() -> dict:
    """Return a dict describing the setup state of the system.

    Keys:
        complete (bool): True if all required settings are configured.
        missing (list[str]): List of setting keys that need attention.
        has_rooms (bool): Whether any rooms exist.
        has_room_types (bool): Whether any room types exist.
        has_staff (bool): Whether at least one active admin exists.
        pct (int): Percentage of setup completeness (0-100).
    """
    missing: list[str] = []
    for key in REQUIRED_SETUP_KEYS:
        val = get_setting_value(key, "")
        if not val or str(val).strip() in _PLACEHOLDER_VALUES:
            missing.append(key)

    has_room_types = db.session.execute(
        sa.select(sa.func.count()).select_from(RoomType)
    ).scalar() > 0

    has_rooms = db.session.execute(
        sa.select(sa.func.count()).select_from(Room)
    ).scalar() > 0

    has_staff = db.session.execute(
        sa.select(sa.func.count()).select_from(User).where(
            User.is_active.is_(True),
            User.deleted_at.is_(None),
        )
    ).scalar() > 0

    total_checks = len(REQUIRED_SETUP_KEYS) + 2  # +room_types +rooms
    passed = (len(REQUIRED_SETUP_KEYS) - len(missing)) + int(has_room_types) + int(has_rooms)
    pct = int(round(passed / total_checks * 100)) if total_checks else 100

    return {
        "complete": len(missing) == 0 and has_room_types and has_rooms,
        "missing": missing,
        "has_rooms": has_rooms,
        "has_room_types": has_room_types,
        "has_staff": has_staff,
        "pct": pct,
    }


def setup_context() -> dict:
    """Return all current setup-related settings for the setup page form."""
    return {
        "hotel_name": _sv("hotel.name", ""),
        "brand_mark": _sv("hotel.brand_mark", ""),
        "contact_phone": _sv("hotel.contact_phone", ""),
        "contact_email": _sv("hotel.contact_email", ""),
        "address": _sv("hotel.address", ""),
        "check_in_time": _sv("hotel.check_in_time", "14:00"),
        "check_out_time": _sv("hotel.check_out_time", "11:00"),
        "timezone": _sv("hotel.timezone", "Asia/Bangkok"),
        "currency": _sv("hotel.currency", "THB"),
        "logo_url": _sv("hotel.logo_url", ""),
        "accent_color": _sv("hotel.accent_color", "#C57C35"),
        "vat_rate": _sv("hotel.vat_rate", "0.07"),
        "service_charge_rate": _sv("hotel.service_charge_rate", "0.00"),
        "deposit_percentage": _sv("reservation.deposit_percentage", "50.00"),
        "code_prefix": _sv("reservation.code_prefix", "RES"),
        "cancellation_hours": _sv("reservation.standard_cancellation_hours", 24),
        "notifications_sender_name": _sv("notifications.sender_name", "Hotel"),
        "tax_id": _sv("hotel.tax_id", ""),
        "support_contact_text": _sv("hotel.support_contact_text", ""),
        "public_base_url": _sv("hotel.public_base_url", ""),
    }


def _sv(key: str, default):
    """Shortcut for get_setting_value with string coercion."""
    val = get_setting_value(key, default)
    return str(val) if val is not None else str(default)
