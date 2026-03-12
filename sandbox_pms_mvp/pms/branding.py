from __future__ import annotations

import re
from collections.abc import Mapping
from urllib.parse import urlparse

from flask import current_app, has_request_context, request

from .pricing import get_setting_value

DEFAULT_ACCENT_COLOR = "#C57C35"
DEFAULT_SUPPORT_CONTACT_TEXT = "Questions before you book? Contact our reservations team for direct booking support."

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
_PHONE_RE = re.compile(r"^[0-9+()./\-\s]{6,30}$")
_TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


def _string_setting(key: str, default: str) -> str:
    return str(get_setting_value(key, default) or default)


def _clamp_channel(value: float) -> int:
    return max(0, min(255, round(value)))


def _normalize_hex_color(value: str, *, field_label: str) -> str:
    candidate = str(value or "").strip().upper()
    if not candidate:
        raise ValueError(f"{field_label} is required.")
    if not candidate.startswith("#"):
        candidate = f"#{candidate}"
    if not _HEX_COLOR_RE.fullmatch(candidate):
        raise ValueError(f"{field_label} must be a valid hex color like #C57C35.")
    return candidate


def _soften_hex_color(value: str, *, ratio: float) -> str:
    red = int(value[1:3], 16)
    green = int(value[3:5], 16)
    blue = int(value[5:7], 16)
    mix = lambda channel: _clamp_channel(channel + ((255 - channel) * ratio))
    return f"#{mix(red):02X}{mix(green):02X}{mix(blue):02X}"


def _darken_hex_color(value: str, *, ratio: float) -> str:
    red = int(value[1:3], 16)
    green = int(value[3:5], 16)
    blue = int(value[5:7], 16)
    shade = lambda channel: _clamp_channel(channel * (1 - ratio))
    return f"#{shade(red):02X}{shade(green):02X}{shade(blue):02X}"


def _rgb_triplet(value: str) -> str:
    return f"{int(value[1:3], 16)}, {int(value[3:5], 16)}, {int(value[5:7], 16)}"


def _coerce_hex_color(value: str | None, fallback: str) -> str:
    try:
        return _normalize_hex_color(str(value or ""), field_label="Accent color")
    except ValueError:
        return fallback


def _normalize_public_url(value: str | None, *, field_label: str, allow_relative: bool = False) -> str:
    candidate = str(value or "").strip()
    if not candidate:
        return ""
    if allow_relative and candidate.startswith("/"):
        return f"/{candidate.lstrip('/')}"
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{field_label} must be a valid http or https URL.")
    return candidate.rstrip("/")


def resolve_public_base_url() -> str:
    try:
        configured = _normalize_public_url(
            get_setting_value("hotel.public_base_url", ""),
            field_label="Canonical public base URL",
        )
    except ValueError:
        configured = ""
    if configured:
        return configured
    configured = str(current_app.config.get("APP_BASE_URL") or "").strip().rstrip("/")
    if configured:
        return configured
    if has_request_context():
        return request.url_root.rstrip("/")
    return ""


def absolute_public_url(value: str | None) -> str:
    candidate = (value or "").strip()
    if not candidate:
        return ""
    if candidate.startswith(("http://", "https://")):
        return candidate
    if not candidate.startswith("/"):
        candidate = f"/{candidate.lstrip('/')}"
    base_url = resolve_public_base_url()
    return f"{base_url}{candidate}" if base_url else candidate


def email_href(value: str | None) -> str:
    candidate = (value or "").strip()
    if not candidate:
        return ""
    return f"mailto:{candidate}"


def phone_href(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    candidate = "".join(char for char in raw if char.isdigit() or char == "+")
    if not candidate:
        return ""
    if not candidate.startswith("+") and candidate.isdigit():
        return f"tel:+{candidate}"
    return f"tel:{candidate}"


def branding_settings_context() -> dict[str, str]:
    hotel_name = _string_setting("hotel.name", current_app.config.get("HOTEL_NAME", "Hotel"))
    accent_color = _coerce_hex_color(get_setting_value("hotel.accent_color", DEFAULT_ACCENT_COLOR), DEFAULT_ACCENT_COLOR)
    accent_color_soft_default = _soften_hex_color(accent_color, ratio=0.48)
    accent_color_soft = _coerce_hex_color(
        get_setting_value("hotel.accent_color_soft", accent_color_soft_default),
        accent_color_soft_default,
    )
    return {
        "hotel_name": hotel_name,
        "brand_mark": _string_setting("hotel.brand_mark", "SBX"),
        "logo_url": _string_setting("hotel.logo_url", ""),
        "contact_phone": _string_setting("hotel.contact_phone", "+66 000 000 000"),
        "contact_email": _string_setting("hotel.contact_email", current_app.config.get("MAIL_FROM", "")),
        "address": _string_setting("hotel.address", hotel_name),
        "currency": _string_setting("hotel.currency", "THB"),
        "check_in_time": _string_setting("hotel.check_in_time", "14:00"),
        "check_out_time": _string_setting("hotel.check_out_time", "11:00"),
        "tax_id": _string_setting("hotel.tax_id", ""),
        "support_contact_text": _string_setting("hotel.support_contact_text", DEFAULT_SUPPORT_CONTACT_TEXT),
        "accent_color": accent_color,
        "accent_color_soft": accent_color_soft,
        "accent_color_dark": _darken_hex_color(accent_color, ratio=0.22),
        "accent_rgb": _rgb_triplet(accent_color),
        "accent_soft_rgb": _rgb_triplet(accent_color_soft),
        "public_base_url": resolve_public_base_url(),
    }


def clean_branding_form(form_data: Mapping[str, object]) -> dict[str, str]:
    hotel_name = str(form_data.get("hotel_name") or "").strip()
    if not hotel_name:
        raise ValueError("Hotel name is required.")
    if len(hotel_name) > 120:
        raise ValueError("Hotel name must be 120 characters or fewer.")

    brand_mark = str(form_data.get("brand_mark") or "").strip().upper()
    if brand_mark and len(brand_mark) > 12:
        raise ValueError("Brand mark must be 12 characters or fewer.")

    currency = str(form_data.get("currency") or "").strip().upper()
    if not currency or not re.fullmatch(r"[A-Z]{3,10}", currency):
        raise ValueError("Currency must be 3 to 10 letters.")

    check_in_time = str(form_data.get("check_in_time") or "").strip()
    if not _TIME_RE.fullmatch(check_in_time):
        raise ValueError("Check-in time must use 24-hour HH:MM format.")

    check_out_time = str(form_data.get("check_out_time") or "").strip()
    if not _TIME_RE.fullmatch(check_out_time):
        raise ValueError("Check-out time must use 24-hour HH:MM format.")

    logo_url = _normalize_public_url(form_data.get("logo_url"), field_label="Logo URL", allow_relative=True)

    contact_phone = str(form_data.get("contact_phone") or "").strip()
    if contact_phone and not _PHONE_RE.fullmatch(contact_phone):
        raise ValueError("Phone must contain 6 to 30 digits and standard phone punctuation only.")

    contact_email = str(form_data.get("contact_email") or "").strip().lower()
    if contact_email and not _EMAIL_RE.fullmatch(contact_email):
        raise ValueError("Email must be a valid address.")

    if not contact_phone and not contact_email:
        raise ValueError("Provide at least one guest-facing contact method: phone or email.")

    support_contact_text = str(form_data.get("support_contact_text") or "").strip()
    if support_contact_text and len(support_contact_text) > 255:
        raise ValueError("Support contact text must be 255 characters or fewer.")
    support_contact_text = support_contact_text or DEFAULT_SUPPORT_CONTACT_TEXT

    accent_color = _normalize_hex_color(
        str(form_data.get("accent_color") or DEFAULT_ACCENT_COLOR),
        field_label="Primary accent color",
    )
    accent_color_soft = str(form_data.get("accent_color_soft") or "").strip()
    if accent_color_soft:
        accent_color_soft = _normalize_hex_color(accent_color_soft, field_label="Secondary accent color")
    else:
        accent_color_soft = _soften_hex_color(accent_color, ratio=0.48)

    public_base_url = _normalize_public_url(
        form_data.get("public_base_url"),
        field_label="Canonical public base URL",
    )

    address = str(form_data.get("address") or "").strip()
    if len(address) > 255:
        raise ValueError("Address must be 255 characters or fewer.")

    tax_id = str(form_data.get("tax_id") or "").strip()
    if len(tax_id) > 80:
        raise ValueError("Tax or business ID must be 80 characters or fewer.")

    return {
        "hotel_name": hotel_name,
        "brand_mark": brand_mark,
        "logo_url": logo_url,
        "contact_phone": contact_phone,
        "contact_email": contact_email,
        "support_contact_text": support_contact_text,
        "accent_color": accent_color,
        "accent_color_soft": accent_color_soft,
        "public_base_url": public_base_url,
        "address": address,
        "currency": currency,
        "check_in_time": check_in_time,
        "check_out_time": check_out_time,
        "tax_id": tax_id,
    }
