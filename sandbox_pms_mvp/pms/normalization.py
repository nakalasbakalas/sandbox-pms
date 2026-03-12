from __future__ import annotations


def clean_optional(value: str | None, *, limit: int | None = None) -> str | None:
    cleaned = (value or "").strip()
    if not cleaned:
        return None
    return cleaned[:limit] if limit else cleaned


def clean_optional_text(value: str | None, *, limit: int) -> str | None:
    cleaned = clean_optional(value)
    if not cleaned:
        return None
    if len(cleaned) > limit:
        raise ValueError("Free-text input is too long.")
    return cleaned


def normalize_email(value: str | None) -> str | None:
    cleaned = clean_optional(value)
    return cleaned.lower() if cleaned else None


def normalize_phone(value: str | None, *, limit: int | None = None) -> str | None:
    raw = "".join(ch for ch in (value or "") if ch.isdigit() or ch == "+").strip()
    if not raw:
        return None
    return raw[:limit] if limit else raw
