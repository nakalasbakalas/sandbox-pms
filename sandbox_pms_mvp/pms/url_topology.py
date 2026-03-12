from __future__ import annotations

from urllib.parse import urlsplit

from flask import current_app, request


BOOKING_CANONICAL_EXACT_PATHS = {
    "/",
    "/book",
    "/availability",
    "/booking/cancel",
    "/booking/modify",
}
BOOKING_CANONICAL_PREFIXES = ("/booking/", "/payments/")
STAFF_CANONICAL_PREFIX = "/staff"
PROVIDER_CANONICAL_PREFIX = "/provider"
SKIP_CANONICAL_PREFIXES = ("/webhooks/",)
SKIP_CANONICAL_PATHS = {"/health"}


def marketing_site_base_url(*, required: bool = False) -> str | None:
    value = _normalized_base_url(current_app.config.get("MARKETING_SITE_URL"))
    if value or not required:
        return value
    raise RuntimeError("MARKETING_SITE_URL must be configured.")


def booking_engine_base_url() -> str:
    value = _normalized_base_url(
        current_app.config.get("BOOKING_ENGINE_URL") or current_app.config.get("APP_BASE_URL")
    )
    if not value:
        raise RuntimeError("BOOKING_ENGINE_URL must be configured.")
    return value


def staff_app_base_url() -> str:
    value = _normalized_base_url(current_app.config.get("STAFF_APP_URL")) or booking_engine_base_url()
    if not value:
        raise RuntimeError("STAFF_APP_URL must be configured.")
    return value


def build_booking_url(path: str, *, query_string: str = "") -> str:
    return _join_url(booking_engine_base_url(), path, query_string=query_string)


def build_staff_url(path: str, *, query_string: str = "") -> str:
    return _join_url(staff_app_base_url(), path, query_string=query_string)


def build_marketing_url(path: str, *, query_string: str = "") -> str:
    base_url = marketing_site_base_url(required=True)
    return _join_url(base_url, path, query_string=query_string)


def canonical_redirect_url() -> str | None:
    if not current_app.config.get("ENFORCE_CANONICAL_HOSTS", False):
        return None
    if request.method not in {"GET", "HEAD"}:
        return None
    if request.endpoint == "static":
        return None
    if request.path in SKIP_CANONICAL_PATHS or request.path.startswith(SKIP_CANONICAL_PREFIXES):
        return None

    audience = route_audience_for_path(request.path)
    if audience == "staff":
        target_base_url = staff_app_base_url()
    elif audience == "booking":
        target_base_url = booking_engine_base_url()
    else:
        return None

    target_netloc = (urlsplit(target_base_url).netloc or "").strip().lower()
    request_netloc = (request.host or "").strip().lower()
    if not target_netloc or target_netloc == request_netloc:
        return None

    return _join_url(target_base_url, request.path, query_string=request.query_string.decode("utf-8"))


def route_audience_for_path(path: str) -> str | None:
    normalized = "/" + str(path or "").lstrip("/")
    if normalized.startswith(STAFF_CANONICAL_PREFIX) or normalized.startswith(PROVIDER_CANONICAL_PREFIX):
        return "staff"
    if normalized in BOOKING_CANONICAL_EXACT_PATHS:
        return "booking"
    if normalized.startswith(BOOKING_CANONICAL_PREFIXES):
        return "booking"
    return None


def _join_url(base_url: str, path: str, *, query_string: str = "") -> str:
    normalized_base = _normalized_base_url(base_url)
    if not normalized_base:
        raise RuntimeError("A base URL is required.")
    normalized_path = "/" + str(path or "").lstrip("/")
    if query_string:
        return f"{normalized_base}{normalized_path}?{query_string.lstrip('?')}"
    return f"{normalized_base}{normalized_path}"


def _normalized_base_url(value: str | None) -> str | None:
    cleaned = str(value or "").strip()
    if not cleaned:
        return None
    return cleaned.rstrip("/")
