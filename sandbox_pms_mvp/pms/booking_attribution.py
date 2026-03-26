"""Booking attribution tracking logic.

Extracts UTM parameters, referrer, entry pages, and source channels from
public booking requests and persists them in session state for downstream
reservation creation.
"""

from __future__ import annotations

from urllib.parse import urlparse

from flask import current_app, g, request, session

from .constants import BOOKING_SOURCE_CHANNELS
from .helpers import (
    current_language,
    is_staff_or_provider_endpoint,
)

BOOKING_ATTRIBUTION_SESSION_KEY = "_booking_attribution"
BOOKING_ATTRIBUTION_FIRST_TOUCH_KEYS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "source_label",
    "referrer_host",
    "entry_page",
    "landing_path",
    "entry_cta_source",
}
BOOKING_ATTRIBUTION_TRACKED_ENDPOINTS = {
    "index",
    "public.index",
    "availability",
    "booking_entry",
    "booking_hold",
    "booking_confirm",
    "public.availability",
    "public.booking_entry",
    "public.booking_hold",
    "public.booking_confirm",
}
PUBLIC_BOOKING_LANDING_ENDPOINTS = {
    "index",
    "public.index",
    "availability",
    "booking_entry",
    "public.availability",
    "public.booking_entry",
}
PUBLIC_NON_CACHEABLE_ENDPOINTS = {
    "booking_confirmation",
    "booking_cancel_request",
    "booking_modify_request",
    "public_payment_return",
    "public_payment_start",
    "public.booking_confirmation",
    "public.booking_cancel_request",
    "public.public_digital_checkout",
    "public.public_digital_checkout_complete",
    "public.public_digital_checkout_pay_balance",
    "public.booking_modify_request",
    "public.public_payment_return",
    "public.public_payment_start",
}
PUBLIC_WEBHOOK_ENDPOINTS = {"payment_webhook", "public.payment_webhook"}


# ── Core attribution functions ────────────────────────────────────────


def capture_public_booking_attribution() -> None:
    existing = dict(session.get(BOOKING_ATTRIBUTION_SESSION_KEY) or {})
    if not _should_track_booking_attribution():
        g.booking_attribution = existing
        return

    incoming = booking_attribution_from_request()
    if incoming:
        base = {} if booking_request_starts_new_attribution() else existing
        merged = merge_booking_attribution(base, incoming)
    elif existing:
        merged = existing
    else:
        merged = default_booking_attribution()

    if merged:
        merged["source_channel"] = resolve_booking_source_channel(merged.get("source_channel"), merged)
        if merged != existing:
            session[BOOKING_ATTRIBUTION_SESSION_KEY] = merged
            session.modified = True
        g.booking_attribution = merged
        return

    g.booking_attribution = {}


def current_booking_attribution() -> dict:
    return dict(getattr(g, "booking_attribution", None) or session.get(BOOKING_ATTRIBUTION_SESSION_KEY) or {})


def booking_attribution_from_request() -> dict:
    if not _should_track_booking_attribution():
        return {}

    referrer_host = external_referrer_host()
    entry_page = clean_public_path(request.values.get("entry_page")) or clean_public_path(request.path)
    source_label = derive_source_label(
        request.values.get("source_label"),
        request.values.get("utm_source"),
        referrer_host,
        request.values.get("source_channel"),
    )
    entry_cta_source = clean_tracking_value(request.values.get("cta_source") or request.values.get("entry_cta_source"))
    incoming = {
        "utm_source": clean_tracking_value(request.values.get("utm_source")),
        "utm_medium": clean_tracking_value(request.values.get("utm_medium")),
        "utm_campaign": clean_tracking_value(request.values.get("utm_campaign")),
        "utm_content": clean_tracking_value(request.values.get("utm_content")),
        "source_label": source_label,
        "referrer_host": referrer_host or clean_tracking_value(request.values.get("referrer_host")),
        "entry_page": entry_page,
        "landing_path": clean_public_path(request.values.get("landing_path")) or entry_page,
        "entry_cta_source": entry_cta_source,
        "source_channel": clean_tracking_value(request.values.get("source_channel"), limit=40),
    }
    return {key: value for key, value in incoming.items() if value not in {None, ""}}


def booking_request_starts_new_attribution() -> bool:
    if request.method != "GET":
        return False
    if clean_public_path(request.args.get("entry_page")):
        return False
    if any(
        clean_tracking_value(request.args.get(key))
        for key in ("utm_source", "utm_medium", "utm_campaign", "utm_content", "source_label")
    ):
        return True
    return bool(external_referrer_host() and request.endpoint in PUBLIC_BOOKING_LANDING_ENDPOINTS)


def default_booking_attribution() -> dict:
    if request.method != "GET" or request.endpoint not in PUBLIC_BOOKING_LANDING_ENDPOINTS:
        return {}
    entry_page = clean_public_path(request.path)
    referrer_host = external_referrer_host()
    default = {
        "source_label": derive_source_label(None, None, referrer_host, "direct_web"),
        "referrer_host": referrer_host,
        "entry_page": entry_page,
        "landing_path": entry_page,
        "entry_cta_source": clean_tracking_value(request.args.get("cta_source") or request.args.get("entry_cta_source")),
        "source_channel": "direct_web",
    }
    return {key: value for key, value in default.items() if value not in {None, ""}}


def merge_booking_attribution(base: dict | None, incoming: dict | None) -> dict:
    merged = dict(base or {})
    for key, value in (incoming or {}).items():
        if value in {None, ""}:
            continue
        if key in BOOKING_ATTRIBUTION_FIRST_TOUCH_KEYS and merged.get(key):
            continue
        merged[key] = value
    return merged


# ── Tracking value helpers ────────────────────────────────────────────


def clean_tracking_value(value: str | None, *, limit: int = 120) -> str | None:
    cleaned = " ".join((value or "").strip().split())
    if not cleaned:
        return None
    return cleaned[:limit]


def clean_public_path(value: str | None) -> str | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    parsed = urlparse(candidate)
    path = parsed.path or "/"
    if not path.startswith("/"):
        path = f"/{path.lstrip('/')}"
    return path[:200]


def normalize_tracking_slug(value: str | None) -> str | None:
    cleaned = clean_tracking_value(value)
    if not cleaned:
        return None
    return cleaned.lower().replace(" ", "_").replace("-", "_")


def external_referrer_host() -> str | None:
    referrer = (request.referrer or "").strip()
    if not referrer:
        return None
    try:
        host = (urlparse(referrer).hostname or "").lower()
    except ValueError:
        return None
    if not host:
        return None
    request_host = (request.host.split(":", 1)[0] or "").lower()
    app_base_url = str(current_app.config.get("APP_BASE_URL") or "").strip()
    app_base_host = (urlparse(app_base_url).hostname or "").lower() if app_base_url else ""
    if host in {request_host, app_base_host}:
        return None
    return host[:120]


def derive_source_label(
    explicit_source_label: str | None,
    utm_source: str | None,
    referrer_host: str | None,
    source_channel: str | None,
) -> str:
    explicit = clean_tracking_value(explicit_source_label)
    if explicit:
        return explicit
    utm = clean_tracking_value(utm_source)
    if utm:
        return utm
    host = clean_tracking_value(referrer_host)
    if host:
        return referrer_source_label(host)
    channel = normalize_tracking_slug(source_channel)
    if channel in BOOKING_SOURCE_CHANNELS:
        return "direct" if channel == "direct_web" else channel
    return "direct"


def referrer_source_label(referrer_host: str) -> str:
    normalized = normalize_tracking_slug(referrer_host) or "referral"
    if "google" in normalized:
        return "google"
    if "facebook" in normalized or normalized.startswith("fb"):
        return "facebook"
    if "instagram" in normalized:
        return "instagram"
    if "line" in normalized:
        return "line"
    if "whatsapp" in normalized:
        return "whatsapp"
    if "tiktok" in normalized:
        return "tiktok"
    labels = [part for part in referrer_host.split(".") if part and part not in {"www", "m", "l"}]
    return labels[0][:80] if labels else referrer_host[:80]


def resolve_booking_source_channel(explicit_source_channel: str | None, attribution: dict | None = None) -> str:
    explicit = normalize_tracking_slug(explicit_source_channel)
    if explicit in BOOKING_SOURCE_CHANNELS:
        return explicit

    attribution = attribution or {}
    candidates = [
        normalize_tracking_slug(attribution.get("source_label")),
        normalize_tracking_slug(attribution.get("utm_source")),
        normalize_tracking_slug(attribution.get("referrer_host")),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        if candidate in {"direct", "direct_web"}:
            return "direct_web"
        if candidate in {"google_business", "gmb"}:
            return "google_business"
        if candidate in {"facebook", "fb"}:
            return "facebook"
        if "line" == candidate:
            return "line"
        if "whatsapp" == candidate:
            return "whatsapp"
        if candidate in {"qr", "qr_code"}:
            return "qr"
        if candidate in {"referral", "partner", "affiliate"}:
            return "referral"
        return "referral"
    return "direct_web"


def _should_track_booking_attribution() -> bool:
    if request.endpoint in {None, "static", *PUBLIC_WEBHOOK_ENDPOINTS}:
        return False
    if is_staff_or_provider_endpoint(request.endpoint):
        return False
    return request.endpoint in BOOKING_ATTRIBUTION_TRACKED_ENDPOINTS


def source_metadata_from_request(language: str, fallback: dict | None = None) -> dict:
    metadata = merge_booking_attribution(fallback, current_booking_attribution())
    metadata = merge_booking_attribution(metadata, booking_attribution_from_request())
    if not metadata:
        metadata = dict(fallback or {}) or default_booking_attribution()
    if not metadata.get("entry_page"):
        metadata["entry_page"] = clean_public_path(request.path) or "/"
    if not metadata.get("landing_path"):
        metadata["landing_path"] = metadata["entry_page"]
    if not metadata.get("source_label"):
        metadata["source_label"] = derive_source_label(
            None,
            metadata.get("utm_source"),
            metadata.get("referrer_host"),
            metadata.get("source_channel"),
        )
    metadata["device_class"] = "mobile" if "Mobile" in request.user_agent.string else "desktop"
    metadata["language"] = language
    metadata["created_from_public_booking_flow"] = True
    return {key: value for key, value in metadata.items() if value not in {None, ""}}
