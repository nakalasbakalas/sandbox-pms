"""View-layer helpers shared between app.py and route blueprints.

These are lightweight Flask-context utilities for request parsing,
auth enforcement, CSRF, and path manipulation. They depend only on
Flask, SQLAlchemy, and internal models/extensions — no circular
imports with app.py.
"""

from __future__ import annotations

import secrets
from datetime import date, datetime
from uuid import UUID

from flask import abort, current_app, g, request, session

from .extensions import db
from .models import User
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
