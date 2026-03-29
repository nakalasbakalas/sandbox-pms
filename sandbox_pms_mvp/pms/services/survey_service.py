"""Guest satisfaction survey service.

Provides survey generation, token validation, submission handling,
statistics aggregation, and email delivery for post-stay surveys.
"""
from __future__ import annotations

import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import sqlalchemy as sa
from flask import current_app, url_for

from ..activity import write_activity_log
from ..branding import resolve_public_base_url
from ..extensions import db
from ..models import (
    Guest,
    GuestSurvey,
    Reservation,
    utc_now,
)

logger = logging.getLogger(__name__)

SURVEY_CATEGORIES = ("cleanliness", "service", "comfort", "location", "value")
DEFAULT_EXPIRY_DAYS = 14


def _generate_token() -> str:
    """Return a URL-safe random token for survey access."""
    return secrets.token_urlsafe(32)


def _expiry_from_now(days: int | None = None) -> datetime:
    """Return a timezone-aware expiry datetime *days* from now."""
    delta = timedelta(days=days or DEFAULT_EXPIRY_DAYS)
    return datetime.now(timezone.utc) + delta


# ---------------------------------------------------------------------------
# Core service functions
# ---------------------------------------------------------------------------


def generate_survey(
    reservation_id: uuid.UUID,
    guest_id: uuid.UUID,
    *,
    expiry_days: int | None = None,
) -> GuestSurvey:
    """Create a GuestSurvey with a random token and configurable expiry.

    If a survey already exists for the reservation that has not been submitted,
    the token and expiry are refreshed. If it has already been submitted, return
    the existing record without modification.
    """
    reservation = db.session.get(Reservation, reservation_id)
    if reservation is None:
        raise ValueError("Reservation not found.")

    guest = db.session.get(Guest, guest_id)
    if guest is None:
        raise ValueError("Guest not found.")

    existing: GuestSurvey | None = db.session.execute(
        sa.select(GuestSurvey).filter_by(reservation_id=reservation_id)
    ).scalar_one_or_none()

    if existing is not None:
        if existing.submitted_at is not None:
            return existing
        # Refresh token / expiry for an unsubmitted survey
        existing.token = _generate_token()
        existing.expires_at = _expiry_from_now(expiry_days)
        return existing

    survey = GuestSurvey(
        reservation_id=reservation_id,
        guest_id=guest_id,
        token=_generate_token(),
        expires_at=_expiry_from_now(expiry_days),
    )
    db.session.add(survey)
    db.session.flush()
    return survey


def validate_survey_token(token: str) -> GuestSurvey | None:
    """Return the GuestSurvey for *token* if valid and not expired, else None."""
    if not token:
        return None
    survey: GuestSurvey | None = db.session.execute(
        sa.select(GuestSurvey).filter_by(token=token)
    ).scalar_one_or_none()
    if survey is None:
        return None
    now = utc_now()
    expires = survey.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if now > expires:
        return None
    return survey


def submit_survey(
    token: str,
    rating: int,
    feedback: str | None = None,
    category_ratings: dict[str, int] | None = None,
) -> GuestSurvey:
    """Validate and save a guest's survey submission.

    Raises ValueError on invalid input.
    """
    survey = validate_survey_token(token)
    if survey is None:
        raise ValueError("Survey link is invalid or has expired.")
    if survey.submitted_at is not None:
        raise ValueError("This survey has already been submitted.")
    if not isinstance(rating, int) or rating < 1 or rating > 5:
        raise ValueError("Rating must be an integer between 1 and 5.")

    # Validate category ratings if provided
    validated_categories: dict[str, int] | None = None
    if category_ratings:
        validated_categories = {}
        for key in SURVEY_CATEGORIES:
            val = category_ratings.get(key)
            if val is not None:
                try:
                    int_val = int(val)
                except (TypeError, ValueError):
                    continue
                if 1 <= int_val <= 5:
                    validated_categories[key] = int_val

    survey.rating = rating
    survey.feedback = (feedback or "").strip() or None
    survey.category_ratings = validated_categories or None
    survey.submitted_at = utc_now()

    write_activity_log(
        actor_user_id=None,
        event_type="survey.submitted",
        entity_table="guest_surveys",
        entity_id=str(survey.id),
        metadata={
            "reservation_id": str(survey.reservation_id),
            "rating": rating,
        },
    )

    return survey


@dataclass
class SurveyStats:
    """Aggregated survey statistics."""
    total_responses: int = 0
    average_rating: float | None = None
    rating_distribution: dict[int, int] | None = None
    category_averages: dict[str, float] | None = None


def get_survey_stats(
    from_date: date | None = None,
    to_date: date | None = None,
) -> SurveyStats:
    """Return aggregated survey statistics for the given date range.

    Dates filter on ``submitted_at``.
    """
    base_q = sa.select(GuestSurvey).where(GuestSurvey.submitted_at.isnot(None))
    if from_date:
        base_q = base_q.where(sa.func.date(GuestSurvey.submitted_at) >= from_date)
    if to_date:
        base_q = base_q.where(sa.func.date(GuestSurvey.submitted_at) <= to_date)

    surveys = db.session.execute(base_q).scalars().all()

    stats = SurveyStats()
    if not surveys:
        return stats

    stats.total_responses = len(surveys)
    ratings = [s.rating for s in surveys if s.rating is not None]
    if ratings:
        stats.average_rating = round(sum(ratings) / len(ratings), 2)
        stats.rating_distribution = {}
        for r in range(1, 6):
            stats.rating_distribution[r] = sum(1 for x in ratings if x == r)

    # Category averages
    category_sums: dict[str, list[int]] = {cat: [] for cat in SURVEY_CATEGORIES}
    for s in surveys:
        if s.category_ratings and isinstance(s.category_ratings, dict):
            for cat in SURVEY_CATEGORIES:
                val = s.category_ratings.get(cat)
                if isinstance(val, (int, float)) and 1 <= val <= 5:
                    category_sums[cat].append(int(val))
    category_avgs: dict[str, float] = {}
    for cat, vals in category_sums.items():
        if vals:
            category_avgs[cat] = round(sum(vals) / len(vals), 2)
    if category_avgs:
        stats.category_averages = category_avgs

    return stats


def build_survey_link(token: str) -> str:
    """Return the absolute public URL for a survey token."""
    try:
        path = url_for("public.guest_survey_form", token=token)
    except RuntimeError:
        path = f"/survey/{token}"
    base = resolve_public_base_url().rstrip("/")
    if base:
        return f"{base}{path}"
    return path


def send_survey_link(
    reservation_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID | None = None,
) -> GuestSurvey | None:
    """Generate a survey and send the link to the guest via the messaging hub.

    Returns the GuestSurvey record, or None if the guest has no email.
    """
    from .messaging_service import ComposePayload, send_message  # local import avoids circular dep

    reservation = db.session.get(Reservation, reservation_id)
    if reservation is None:
        raise ValueError("Reservation not found.")

    guest = reservation.primary_guest
    if guest is None:
        raise ValueError("Reservation has no primary guest.")

    survey = generate_survey(reservation.id, guest.id)
    db.session.flush()

    link = build_survey_link(survey.token)
    hotel_name = current_app.config.get("HOTEL_NAME", "the hotel")
    res_code = reservation.reservation_code
    guest_name = guest.full_name if guest else "Guest"

    subject = f"How was your stay? - {res_code}"
    body = (
        f"Dear {guest_name},\n\n"
        f"Thank you for staying at {hotel_name}. "
        f"We hope you had a wonderful experience.\n\n"
        f"We would love to hear your feedback. Please take a moment to "
        f"complete our short satisfaction survey:\n\n"
        f"{link}\n\n"
        f"Your feedback helps us improve and serve you better.\n\n"
        f"Warm regards,\n{hotel_name}"
    )

    recipient_email = guest.email if guest else None
    if not recipient_email:
        return None

    payload = ComposePayload(
        reservation_id=str(reservation.id),
        guest_id=str(guest.id),
        channel="email",
        subject=subject,
        body_text=body,
        recipient_address=recipient_email,
    )
    send_message(payload, actor_user_id=str(actor_user_id) if actor_user_id else None, commit=False)

    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="survey.link_sent",
        entity_table="guest_surveys",
        entity_id=str(survey.id),
        metadata={
            "reservation_id": str(reservation.id),
            "recipient": recipient_email,
        },
    )

    return survey
