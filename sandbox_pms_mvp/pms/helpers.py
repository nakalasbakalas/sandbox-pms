"""Shared helpers used across Flask routes, templates, and blueprints."""
from __future__ import annotations

import hmac
import secrets
from datetime import date, datetime, timedelta
from decimal import Decimal
from urllib.parse import urlencode
from uuid import UUID

from flask import abort, current_app, g, request, session, url_for
from markupsafe import Markup, escape

from .branding import (
    absolute_public_url as branding_absolute_public_url,
    email_href as branding_email_href,
    phone_href as branding_phone_href,
    resolve_public_base_url,
)
from .extensions import db
from .i18n import normalize_language
from .models import AppSetting, User
from .permissions import default_dashboard_endpoint_for_user


# ---------------------------------------------------------------------------
# Auth / permission helpers
# ---------------------------------------------------------------------------

def current_app_testing() -> bool:
    try:
        return bool(current_app.config.get("TESTING"))
    except RuntimeError:
        return False


def current_user() -> User | None:
    if getattr(g, "current_staff_user", None) is not None:
        return g.current_staff_user
    if current_app_testing() and session.get("staff_user_id"):
        return db.session.get(User, UUID(session["staff_user_id"]))
    return None


def require_user() -> User:
    user = current_user()
    if not user:
        abort(401)
    return user


def require_permission(permission_code: str) -> User:
    user = require_user()
    if not user.has_permission(permission_code):
        abort(403)
    return user


def require_any_permission(*permission_codes: str) -> User:
    user = require_user()
    if not any(user.has_permission(pc) for pc in permission_codes):
        abort(403)
    return user


def can(permission_code: str) -> bool:
    user = current_user()
    if not user:
        return False
    return user.has_permission(permission_code)


def default_dashboard_endpoint(user: User | None) -> str:
    return default_dashboard_endpoint_for_user(user)


def default_dashboard_url(user: User | None) -> str:
    return url_for(default_dashboard_endpoint(user))


def is_admin_user(user: User | None = None) -> bool:
    subject = user or current_user()
    if not subject:
        return False
    return any(role.code == "admin" for role in subject.roles)


def require_admin_role(user: User | None = None) -> User:
    subject = user or require_user()
    if not is_admin_user(subject):
        abort(403)
    return subject


def can_access_admin_workspace(user: User | None = None) -> bool:
    subject = user or current_user()
    if not subject:
        return False
    required = {"settings.view", "user.view", "rate_rule.view", "audit.view"}
    return bool(subject.permission_codes.intersection(required))


def require_admin_workspace_access() -> User:
    user = require_user()
    if not can_access_admin_workspace(user):
        abort(403)
    return user


def available_admin_sections() -> list[dict[str, str]]:
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
            {"key": "audit", "label": "Audit", "endpoint": "staff_admin_audit", "description": "Configuration and system history"}
        )
    return sections


# ---------------------------------------------------------------------------
# CSRF helpers
# ---------------------------------------------------------------------------

def ensure_csrf_token() -> str:
    token = session.get("_csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["_csrf_token"] = token
    return token


def rotate_csrf_token() -> str:
    token = secrets.token_urlsafe(32)
    session["_csrf_token"] = token
    return token


def validate_csrf_request() -> None:
    if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return
    if request.endpoint in {None, "static", "payment_webhook", "pre_checkin_save", "pre_checkin_upload", "messaging.staff_messaging_inbound_webhook"}:
        return
    expected = session.get("_csrf_token")
    provided = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token")
    if not expected or not provided or not hmac.compare_digest(expected, provided):
        abort(400, description="CSRF validation failed.")


# ---------------------------------------------------------------------------
# Settings / utility helpers
# ---------------------------------------------------------------------------

def current_settings() -> dict[str, dict]:
    return {s.key: s.value_json for s in AppSetting.query.filter_by(deleted_at=None).all()}


def truthy_setting(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "on", "yes"}


def safe_back_path(value: str | None, fallback: str) -> str:
    candidate = (value or "").strip()
    if candidate.startswith("/") and not candidate.startswith("//"):
        return candidate
    return fallback


def add_anchor_to_path(path: str, anchor: str | None) -> str:
    candidate = (path or "").strip()
    fragment = (anchor or "").strip().lstrip("#")
    if not fragment:
        return candidate
    base = candidate.split("#", 1)[0]
    return f"{base}#{fragment}"


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def parse_optional_uuid(value: str | None) -> UUID | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    return UUID(candidate)


def parse_booking_extra_ids(values: list[str] | tuple[str, ...] | None) -> tuple[UUID, ...]:
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


def parse_optional_date(value: str | None) -> date | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    return date.fromisoformat(candidate)


def parse_request_form_date(name: str, *, default: date | None) -> date | None:
    candidate = (request.form.get(name) or "").strip()
    if not candidate:
        return default
    try:
        return date.fromisoformat(candidate)
    except ValueError:
        abort(400, description=f"Invalid {name} form value.")


def action_datetime_for_form_date(name: str, *, default: date | None = None) -> datetime:
    from .services.ical_service import calendar_timezone

    business_date = parse_request_form_date(name, default=default or date.today())
    hotel_tz = calendar_timezone()
    now = datetime.now(hotel_tz)
    return datetime.combine(
        business_date,
        now.time().replace(tzinfo=None),
        tzinfo=hotel_tz,
    )


def parse_request_date_arg(name: str, *, default: date | None) -> date | None:
    candidate = (request.args.get(name) or "").strip()
    if not candidate:
        return default
    try:
        return date.fromisoformat(candidate)
    except ValueError:
        abort(400, description=f"Invalid {name} query parameter.")


def parse_request_int_arg(name: str, *, default: int, minimum: int = 1, maximum: int | None = None) -> int:
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
    candidate = (request.args.get(name) or "").strip()
    if not candidate:
        return None
    try:
        return str(UUID(candidate))
    except ValueError:
        abort(400, description=f"Invalid {name} query parameter.")


def parse_optional_datetime(value: str | None) -> datetime | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    parsed = datetime.fromisoformat(candidate)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=datetime.now().astimezone().tzinfo)
    return parsed


def parse_optional_int(value: str | None) -> int | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    return int(candidate)


def parse_decimal(value: str | None, *, default: str | None = None) -> Decimal:
    candidate = default if (value is None or str(value).strip() == "") and default is not None else value
    if candidate is None:
        raise ValueError("A decimal value is required.")
    return Decimal(str(candidate))


def parse_optional_decimal(value: str | None) -> Decimal | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    return Decimal(candidate)


# ---------------------------------------------------------------------------
# Branding wrappers
# ---------------------------------------------------------------------------

def public_base_url() -> str:
    return resolve_public_base_url()


def absolute_public_url(value: str | None) -> str:
    return branding_absolute_public_url(value)


def email_href(value: str | None) -> str:
    return branding_email_href(value)


def phone_href(value: str | None) -> str:
    return branding_phone_href(value)


def _contact_link(href: str, label: str) -> Markup | str:
    safe_label = escape(label or "")
    if not href:
        return safe_label
    return Markup('<a class="contact-link subtle" href="{0}">{1}</a>').format(escape(href), safe_label)


# ---------------------------------------------------------------------------
# Language / i18n
# ---------------------------------------------------------------------------

def current_language() -> str:
    return normalize_language(getattr(g, "public_language", None) or request.args.get("lang") or request.form.get("language") or "th")


def make_language_url(language_code: str) -> str:
    args = request.args.to_dict(flat=False)
    args["lang"] = [normalize_language(language_code)]
    query_string = urlencode(args, doseq=True)
    if query_string:
        return f"{request.path}?{query_string}"
    return request.path


# ---------------------------------------------------------------------------
# Report helpers
# ---------------------------------------------------------------------------

def resolve_report_date_range(*, preset: str, requested_start: date | None, requested_end: date | None) -> tuple[str, date, date]:
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
    return [
        {"value": "today", "label": "Today"},
        {"value": "tomorrow", "label": "Tomorrow"},
        {"value": "next_7_days", "label": "Next 7 days"},
        {"value": "next_30_days", "label": "Next 30 days"},
        {"value": "current_month", "label": "Current month"},
        {"value": "custom", "label": "Custom"},
    ]


def format_report_date_range(start_date: date, end_date: date) -> str:
    if start_date == end_date:
        return start_date.strftime("%d %b %Y")
    return f"{start_date.strftime('%d %b %Y')} - {end_date.strftime('%d %b %Y')}"


# ---------------------------------------------------------------------------
# Endpoint context helpers
# ---------------------------------------------------------------------------

_BLUEPRINT_STAFF_OR_PROVIDER = frozenset({"auth", "provider", "housekeeping", "messaging"})


def is_staff_or_provider_endpoint(endpoint: str | None) -> bool:
    """Return True if the endpoint belongs to a staff or provider context.

    Works for both legacy app-level endpoints (``staff_*``, ``provider_*``) and
    Blueprint-namespaced endpoints (``auth.staff_login``, ``provider.provider_dashboard``, etc.).
    """
    ep = endpoint or ""
    if ep.startswith("staff_") or ep.startswith("provider_"):
        return True
    bp_name = ep.split(".", 1)[0] if "." in ep else ""
    return bp_name in _BLUEPRINT_STAFF_OR_PROVIDER
