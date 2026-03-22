"""Guest loyalty / membership tier service.

Tier thresholds (cumulative points):
    bronze   – 0+
    silver   – 100+
    gold     – 500+
    platinum – 2 000+
"""

from __future__ import annotations

import logging
import uuid
from datetime import date

import sqlalchemy as sa

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..extensions import db
from ..models import GuestLoyalty, Guest, Reservation, utc_now

_log = logging.getLogger(__name__)

# Tier thresholds — ordered highest-first for the recalculation loop
_TIER_THRESHOLDS: list[tuple[str, int]] = [
    ("platinum", 2000),
    ("gold", 500),
    ("silver", 100),
    ("bronze", 0),
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def enroll_guest(guest_id: uuid.UUID, *, actor_user_id: uuid.UUID | None = None) -> GuestLoyalty:
    """Create a new loyalty record for *guest_id* with tier=bronze and points=0.

    Raises ``ValueError`` if the guest does not exist or is already enrolled.
    """
    guest = db.session.get(Guest, guest_id)
    if not guest or guest.deleted_at:
        raise ValueError("Guest not found.")

    existing = db.session.execute(
        sa.select(GuestLoyalty).where(GuestLoyalty.guest_id == guest_id)
    ).scalars().first()
    if existing:
        raise ValueError("Guest is already enrolled in the loyalty programme.")

    loyalty = GuestLoyalty(
        guest_id=guest_id,
        tier="bronze",
        points=0,
        enrolled_at=utc_now(),
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.session.add(loyalty)

    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="loyalty.enrolled",
        entity_table="guests",
        entity_id=str(guest_id),
        metadata={"tier": "bronze"},
    )

    db.session.commit()
    return loyalty


def award_points(
    guest_id: uuid.UUID,
    points: int,
    reason: str,
    *,
    actor_user_id: uuid.UUID | None = None,
) -> GuestLoyalty:
    """Add *points* to the guest's loyalty balance and recalculate tier."""
    if points <= 0:
        raise ValueError("Points must be a positive integer.")

    loyalty = db.session.execute(
        sa.select(GuestLoyalty).where(GuestLoyalty.guest_id == guest_id)
    ).scalars().first()
    if not loyalty:
        raise ValueError("Guest is not enrolled in the loyalty programme.")

    old_points = loyalty.points
    old_tier = loyalty.tier
    loyalty.points += points
    recalculate_tier(loyalty)
    loyalty.updated_by_user_id = actor_user_id

    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="loyalty.points_awarded",
        entity_table="guests",
        entity_id=str(guest_id),
        metadata={
            "points_added": points,
            "old_points": old_points,
            "new_points": loyalty.points,
            "old_tier": old_tier,
            "new_tier": loyalty.tier,
            "reason": reason,
        },
    )

    if loyalty.tier != old_tier:
        write_activity_log(
            actor_user_id=actor_user_id,
            event_type="loyalty.tier_changed",
            entity_table="guests",
            entity_id=str(guest_id),
            metadata={"old_tier": old_tier, "new_tier": loyalty.tier},
        )

    db.session.commit()
    return loyalty


def recalculate_tier(loyalty: GuestLoyalty) -> None:
    """Set ``loyalty.tier`` based on current points. Does NOT commit."""
    old_tier = loyalty.tier
    for tier_name, threshold in _TIER_THRESHOLDS:
        if loyalty.points >= threshold:
            loyalty.tier = tier_name
            break
    if loyalty.tier != old_tier:
        loyalty.tier_updated_at = utc_now()


def get_loyalty_summary(guest_id: uuid.UUID) -> GuestLoyalty | None:
    """Return the loyalty record for the guest, or ``None`` if not enrolled."""
    return db.session.execute(
        sa.select(GuestLoyalty).where(GuestLoyalty.guest_id == guest_id)
    ).scalars().first()


def award_checkout_points(reservation: Reservation) -> GuestLoyalty | None:
    """Award loyalty points for a completed stay: nights x 10.

    Silently returns ``None`` if the guest is not enrolled.
    """
    guest_id = reservation.primary_guest_id
    if not guest_id:
        return None

    loyalty = db.session.execute(
        sa.select(GuestLoyalty).where(GuestLoyalty.guest_id == guest_id)
    ).scalars().first()
    if not loyalty:
        return None

    nights = (reservation.check_out_date - reservation.check_in_date).days
    if nights <= 0:
        return None

    points = nights * 10
    reason = f"checkout:{reservation.reservation_code}:{nights}nights"

    old_points = loyalty.points
    old_tier = loyalty.tier
    loyalty.points += points
    recalculate_tier(loyalty)

    write_activity_log(
        actor_user_id=None,
        event_type="loyalty.checkout_points",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={
            "guest_id": str(guest_id),
            "nights": nights,
            "points_added": points,
            "old_points": old_points,
            "new_points": loyalty.points,
            "old_tier": old_tier,
            "new_tier": loyalty.tier,
            "reason": reason,
        },
    )

    # NOTE: We do NOT commit here — the caller (complete_checkout) has already
    # committed by the time this runs, so we commit ourselves.
    db.session.commit()
    return loyalty
