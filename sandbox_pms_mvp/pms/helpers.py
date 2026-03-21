"""View-layer helpers shared between app.py and route blueprints.

These are lightweight Flask-context utilities for request parsing,
auth enforcement, CSRF, and path manipulation. They depend only on
Flask, SQLAlchemy, and internal models/extensions — no circular
imports with app.py.
"""

from __future__ import annotations

import hmac
import secrets
from datetime import date, datetime, timedelta
from decimal import Decimal
from urllib.parse import urlencode
from uuid import UUID

from flask import abort, current_app, g, redirect, request, session, url_for
from markupsafe import Markup, escape

from .extensions import db
from .models import AppSetting, Permission, User
from .services.ical_service import calendar_timezone


# ---------------------------------------------------------------------------
# App / context utilities
# ---------------------------------------------------------------------------

def current_app_testing() -> bool:
    """Return True when running under the test suite."""
    try:
        return bool(current_app.config.get("TESTING"))
    except RuntimeError:
        return False


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def current_user() -> User | None:
    """Return the authenticated staff user, or None."""
    if getattr(g, "current_staff_user", None) is not None:
        return g.current_staff_user
    if current_app_testing() and session.get("staff_user_id"):
        return db.session.get(User, UUID(session["staff_user_id"]))
    return None


def require_user() -> User:
    """Return the authenticated staff user or abort 401."""
    user = current_user()
    if not user:
        abort(401)
    return user


def require_permission(permission_code: str) -> User:
    """Return the authenticated user or abort 403 if permission is missing."""
    user = require_user()
    if not user.has_permission(permission_code):
        abort(403)
    return user


def require_any_permission(*permission_codes: str) -> User:
    """Return the authenticated user or abort 403 if none of the permissions match."""
    user = require_user()
    if not any(user.has_permission(code) for code in permission_codes):
        abort(403)
    return user


def can(permission_code: str) -> bool:
    """Return True if the current user holds *permission_code*."""
    user = current_user()
    if not user:
        return False
    return user.has_permission(permission_code)


# ---------------------------------------------------------------------------
# CSRF helpers
# ---------------------------------------------------------------------------

def ensure_csrf_token() -> str:
    """Return (and lazily create) the session CSRF token."""
    token = session.get("_csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["_csrf_token"] = token
    return token


# ---------------------------------------------------------------------------
# Path / URL helpers
# ---------------------------------------------------------------------------

def safe_back_path(value: str | None, fallback: str) -> str:
    """Validate *value* as a safe relative redirect path, else return *fallback*."""
    candidate = (value or "").strip()
    if candidate.startswith("/") and not candidate.startswith("//"):
        return candidate
    return fallback


def add_anchor_to_path(path: str, anchor: str | None) -> str:
    """Append a URL fragment to *path*, stripping any existing fragment first."""
    candidate = (path or "").strip()
    fragment = (anchor or "").strip().lstrip("#")
    if not fragment:
        return candidate
    base = candidate.split("#", 1)[0]
    return f"{base}#{fragment}"


# ---------------------------------------------------------------------------
# Request parsing helpers
# ---------------------------------------------------------------------------

def parse_optional_uuid(value: str | None) -> UUID | None:
    """Parse an optional UUID string, returning None for blank input.

    Raises ValueError on malformed input so callers can decide how to handle it.
    """
    candidate = (value or "").strip()
    if not candidate:
        return None
    try:
        return UUID(candidate)
    except ValueError as exc:
        raise ValueError(f"Invalid UUID value: {candidate!r}") from exc


def parse_optional_datetime(value: str | None) -> datetime | None:
    """Parse an optional ISO-8601 datetime string, returning None for blank input.

    Naive (tz-less) datetimes are assumed to be in the hotel's configured timezone.
    """
    candidate = (value or "").strip()
    if not candidate:
        return None
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=calendar_timezone())
    return parsed


def parse_request_date_arg(name: str, *, default: date | None) -> date | None:
    """Parse a query-string date argument, aborting 400 on bad input."""
    candidate = (request.args.get(name) or "").strip()
    if not candidate:
        return default
    try:
        return date.fromisoformat(candidate)
    except ValueError:
        abort(400, description=f"Invalid {name} query parameter.")


def parse_request_int_arg(
    name: str,
    *,
    default: int,
    minimum: int = 1,
    maximum: int | None = None,
) -> int:
    """Parse a query-string integer argument, aborting 400 on bad or out-of-range input."""
    candidate = (request.args.get(name) or "").strip()
    if not candidate:
        return default
    try:
        value = int(candidate)
    except ValueError:
        abort(400, description=f"Invalid {name} query parameter.")
    if value < minimum or (maximum is not None and value > maximum):
        abort(400, description=f"Invalid {name} query parameter.")
    return value


def parse_request_uuid_arg(name: str) -> str | None:
    """Parse an optional UUID query-string argument, aborting 400 on bad input."""
    candidate = (request.args.get(name) or "").strip()
    if not candidate:
        return None
    try:
        return str(UUID(candidate))
    except ValueError:
        abort(400, description=f"Invalid {name} query parameter.")


def parse_request_form_date(name: str, *, default: date | None) -> date | None:
    """Parse a form-body date field, aborting 400 on bad input."""
    candidate = (request.form.get(name) or "").strip()
    if not candidate:
        return default
    try:
        return date.fromisoformat(candidate)
    except ValueError:
        abort(400, description=f"Invalid {name} form value.")


def action_datetime_for_form_date(
    name: str,
    *,
    default: date | None = None,
) -> datetime:
    """Build a timezone-aware datetime from a form date field using the hotel timezone."""
    business_date = parse_request_form_date(name, default=default or date.today())
    hotel_tz = calendar_timezone()
    now = datetime.now(hotel_tz)
    return datetime.combine(
        business_date,
        now.time().replace(tzinfo=None),
        tzinfo=hotel_tz,
    )


# ---------------------------------------------------------------------------
# CSRF rotation
# ---------------------------------------------------------------------------

def rotate_csrf_token() -> str:
    """Issue a new CSRF token and store it in the session."""
    token = secrets.token_urlsafe(32)
    session["_csrf_token"] = token
    return token


def validate_csrf_request() -> None:
    """Abort 400 if the current mutating request lacks a valid CSRF token."""
    if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return
    if request.endpoint in {
        None,
        "static",
        "payment_webhook",
        "pre_checkin_save",
        "pre_checkin_upload",
        "staff_messaging_inbound_webhook",
        "integration_scanner_capture",
        "integration_pos_charge",
        # Blueprint-prefixed equivalents
        "public.payment_webhook",
        "public.pre_checkin_save",
        "public.pre_checkin_upload",
        "messaging.staff_messaging_inbound_webhook",
    }:
        return
    expected = session.get("_csrf_token")
    provided = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token")
    if not expected or not provided or not hmac.compare_digest(expected, provided):
        abort(400, description="CSRF validation failed.")


# ---------------------------------------------------------------------------
# Endpoint classification
# ---------------------------------------------------------------------------

def is_staff_or_provider_endpoint(endpoint: str | None) -> bool:
    """Return True if *endpoint* belongs to the staff or provider/integration surfaces."""
    if not endpoint:
        return False
    # Strip blueprint prefix (e.g. "auth.staff_login" -> "staff_login")
    bare = endpoint.rsplit(".", 1)[-1] if "." in endpoint else endpoint
    return bare.startswith(("staff_", "integration_", "provider_"))


# ---------------------------------------------------------------------------
# Language / URL helpers
# ---------------------------------------------------------------------------

def current_language() -> str:
    """Return the active public-site language code for the current request."""
    from .i18n import normalize_language
    return normalize_language(
        getattr(g, "public_language", None)
        or request.args.get("lang")
        or request.form.get("language")
        or "th"
    )


def make_language_url(language_code: str) -> str:
    """Return the current URL with the ``lang`` query parameter replaced."""
    from .i18n import normalize_language
    args = request.args.to_dict(flat=False)
    args["lang"] = [normalize_language(language_code)]
    query_string = urlencode(args, doseq=True)
    if query_string:
        return f"{request.path}?{query_string}"
    return request.path


# ---------------------------------------------------------------------------
# Branding / URL helpers (thin wrappers over pms.branding)
# ---------------------------------------------------------------------------

def public_base_url() -> str:
    """Return the canonical public base URL for the hotel booking engine."""
    from .branding import resolve_public_base_url
    return resolve_public_base_url()


def absolute_public_url(value: str | None) -> str:
    """Return an absolute public URL for *value*, using the configured base URL."""
    from .branding import absolute_public_url as _absolute_public_url
    return _absolute_public_url(value)


def email_href(value: str | None) -> str:
    """Return a ``mailto:`` href for *value*, or an empty string."""
    from .branding import email_href as _email_href
    return _email_href(value)


def phone_href(value: str | None) -> str:
    """Return a ``tel:`` href for *value*, or an empty string."""
    from .branding import phone_href as _phone_href
    return _phone_href(value)


def _contact_link(href: str, label: str) -> Markup | str:
    """Return an HTML anchor for a contact link, or a plain-text label."""
    safe_label = escape(label or "")
    if not href:
        return safe_label
    return Markup('<a class="contact-link subtle" href="{0}">{1}</a>').format(escape(href), safe_label)


# ---------------------------------------------------------------------------
# Settings helpers
# ---------------------------------------------------------------------------

def current_settings() -> dict[str, dict]:
    """Return all active AppSettings as a key→value_json mapping."""
    return {setting.key: setting.value_json for setting in AppSetting.query.filter_by(deleted_at=None).all()}


def truthy_setting(value) -> bool:
    """Return True when *value* is a truthy boolean or truthy string flag."""
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "on", "yes"}


# ---------------------------------------------------------------------------
# Dashboard routing
# ---------------------------------------------------------------------------

def default_dashboard_endpoint(user: User | None) -> str:
    """Return the Flask endpoint name for *user*'s default landing dashboard."""
    from .permissions import default_dashboard_endpoint_for_user
    return default_dashboard_endpoint_for_user(user)


def default_dashboard_url(user: User | None) -> str:
    """Return the URL for *user*'s default landing dashboard."""
    return url_for(default_dashboard_endpoint(user))


# ---------------------------------------------------------------------------
# Admin role / workspace helpers
# ---------------------------------------------------------------------------

def is_admin_user(user: User | None = None) -> bool:
    """Return True if *user* (or the current user) holds the admin role."""
    subject = user or current_user()
    if not subject:
        return False
    return any(role.code == "admin" for role in subject.roles)


def require_admin_role(user: User | None = None) -> User:
    """Return the current user or abort 403 if they are not an admin."""
    subject = user or require_user()
    if not is_admin_user(subject):
        abort(403)
    return subject


def can_access_admin_workspace(user: User | None = None) -> bool:
    """Return True if *user* holds at least one admin-workspace permission."""
    subject = user or current_user()
    if not subject:
        return False
    required = {"settings.view", "user.view", "rate_rule.view", "audit.view"}
    return bool(subject.permission_codes.intersection(required))


def require_admin_workspace_access() -> User:
    """Return the current user or abort 403 if they lack admin-workspace access."""
    user = require_user()
    if not can_access_admin_workspace(user):
        abort(403)
    return user


def available_admin_sections() -> list[dict[str, str]]:
    """Return the admin navigation sections visible to the current user."""
    user = current_user()
    if not user:
        return []
    sections: list[dict[str, str]] = []
    if can("settings.view"):
        sections.append(
            {"key": "property", "label": "Property Setup", "endpoint": "staff_admin_property", "description": "Rooms, room types, branding"}
        )
        sections.append(
            {"key": "operations", "label": "Operations Settings", "endpoint": "staff_admin_operations", "description": "Policies, templates, housekeeping defaults"}
        )
        sections.append(
            {"key": "communications", "label": "Communications", "endpoint": "staff_admin_communications", "description": "Notification settings, delivery history, reminder runs"}
        )
        sections.append(
            {"key": "payments", "label": "Payments", "endpoint": "staff_admin_payments", "description": "Hosted payment behavior"}
        )
    if can("rate_rule.view") or can("settings.view"):
        sections.append(
            {"key": "rates_inventory", "label": "Rates & Inventory", "endpoint": "staff_admin_rates_inventory", "description": "Rate rules, overrides, blackout dates"}
        )
    if can("user.view"):
        sections.append(
            {"key": "staff_access", "label": "Staff & Access", "endpoint": "staff_admin_staff_access", "description": "Users, roles, permissions"}
        )
    if can("audit.view"):
        sections.append(
            {"key": "audit", "label": "Audit", "endpoint": "reports.staff_admin_audit", "description": "Configuration and system history"}
        )
    return sections


def permission_groups() -> dict[str, list]:
    """Return all Permissions grouped by their module name."""
    grouped: dict[str, list] = {}
    permissions = Permission.query.order_by(Permission.module.asc(), Permission.code.asc()).all()
    for permission in permissions:
        grouped.setdefault(permission.module, []).append(permission)
    return grouped


# ---------------------------------------------------------------------------
# Data parsing helpers
# ---------------------------------------------------------------------------

def parse_optional_date(value: str | None) -> date | None:
    """Parse an optional ISO-8601 date string, returning None for blank input."""
    candidate = (value or "").strip()
    if not candidate:
        return None
    return date.fromisoformat(candidate)


def parse_optional_int(value: str | None) -> int | None:
    """Parse an optional integer string, returning None for blank input."""
    candidate = (value or "").strip()
    if not candidate:
        return None
    return int(candidate)


def parse_decimal(value: str | None, *, default: str | None = None) -> Decimal:
    """Parse a required decimal string, using *default* when *value* is blank."""
    candidate = default if (value is None or str(value).strip() == "") and default is not None else value
    if candidate is None:
        raise ValueError("A decimal value is required.")
    return Decimal(str(candidate))


def parse_optional_decimal(value: str | None) -> Decimal | None:
    """Parse an optional decimal string, returning None for blank input."""
    candidate = (value or "").strip()
    if not candidate:
        return None
    return Decimal(candidate)


def parse_booking_extra_ids(values: list[str] | tuple[str, ...] | None) -> tuple[UUID, ...]:
    """Parse a sequence of UUID strings for booking extras, raising ValueError on bad input."""
    parsed: list[UUID] = []
    for raw_value in values or []:
        candidate = (raw_value or "").strip()
        if not candidate:
            continue
        try:
            parsed.append(UUID(candidate))
        except ValueError as exc:
            raise ValueError("One or more selected extras are invalid.") from exc
    return tuple(parsed)


# ---------------------------------------------------------------------------
# Report date helpers
# ---------------------------------------------------------------------------

def resolve_report_date_range(
    *,
    preset: str,
    requested_start: date | None,
    requested_end: date | None,
) -> tuple[str, date, date]:
    """Resolve a named date preset or a custom range to a concrete (label, start, end) tuple."""
    today = date.today()
    normalized = preset or "next_7_days"
    if normalized == "today":
        return normalized, today, today
    if normalized == "tomorrow":
        tomorrow = today + timedelta(days=1)
        return normalized, tomorrow, tomorrow
    if normalized == "next_30_days":
        return normalized, today, today + timedelta(days=29)
    if normalized == "current_month":
        month_start = today.replace(day=1)
        if today.month == 12:
            month_end = today.replace(year=today.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            month_end = today.replace(month=today.month + 1, day=1) - timedelta(days=1)
        return normalized, month_start, month_end
    if normalized == "custom" and requested_start and requested_end and requested_start <= requested_end:
        return normalized, requested_start, requested_end
    return "next_7_days", today, today + timedelta(days=6)


def report_date_presets() -> list[dict[str, str]]:
    """Return the list of report date range preset options."""
    return [
        {"value": "today", "label": "Today"},
        {"value": "tomorrow", "label": "Tomorrow"},
        {"value": "next_7_days", "label": "Next 7 days"},
        {"value": "next_30_days", "label": "Next 30 days"},
        {"value": "current_month", "label": "Current month"},
        {"value": "custom", "label": "Custom"},
    ]


def format_report_date_range(start_date: date, end_date: date) -> str:
    """Format a date range as a human-readable string."""
    if start_date == end_date:
        return start_date.strftime("%d %b %Y")
    return f"{start_date.strftime('%d %b %Y')} - {end_date.strftime('%d %b %Y')}"
