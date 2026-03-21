"""Shared admin service imports and helper primitives."""

from __future__ import annotations

import re
import string
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

import sqlalchemy as sa
from flask import current_app

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..branding import branding_settings_context
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
    utc_now,
)
from ..normalization import clean_optional
from ..pricing import get_setting_value
from ..settings import NOTIFICATION_TEMPLATE_PLACEHOLDERS, POLICY_DOCUMENTS_SEED
from ..url_topology import build_booking_url


ACTIVE_RESERVATION_STATUSES = {"tentative", "confirmed", "checked_in", "waitlist", "house_use"}
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE_RE = re.compile(r"^[0-9+()./\-\s]{6,30}$")
_TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
_CURRENCY_RE = re.compile(r"^[A-Z]{3,10}$")
_GROUP_BLOCK_CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{1,31}$")


def clean_multiline_list(
    value: str | None,
    *,
    item_limit: int,
    max_items: int,
) -> list[str] | None:
    if not value:
        return None
    items: list[str] = []
    seen: set[str] = set()
    for raw_line in value.replace("\r", "\n").split("\n"):
        cleaned = raw_line.strip()
        while cleaned[:1] in {"-", "*", "\u2022"}:
            cleaned = cleaned[1:].strip()
        if not cleaned:
            continue
        cleaned = cleaned[:item_limit]
        key = cleaned.casefold()
        if key in seen:
            continue
        seen.add(key)
        items.append(cleaned)
        if len(items) >= max_items:
            break
    return items or None


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
    if value_type == "time":
        candidate = str(value or "").strip()
        if not _TIME_RE.fullmatch(candidate):
            raise ValueError("Time values must use 24-hour HH:MM format.")
        return candidate
    return str(value or "").strip()


def _normalize_setting_by_key(key: str, value):
    if key == "hotel.currency":
        candidate = str(value or "").strip().upper()
        if not _CURRENCY_RE.fullmatch(candidate):
            raise ValueError("Currency must be 3 to 10 letters.")
        return candidate
    if key == "hotel.contact_email":
        candidate = str(value or "").strip().lower()
        if candidate and not _EMAIL_RE.fullmatch(candidate):
            raise ValueError("Email must be a valid address.")
        return candidate
    if key == "hotel.contact_phone":
        candidate = str(value or "").strip()
        if candidate and not _PHONE_RE.fullmatch(candidate):
            raise ValueError("Phone must contain 6 to 30 digits and standard phone punctuation only.")
        return candidate
    return value


