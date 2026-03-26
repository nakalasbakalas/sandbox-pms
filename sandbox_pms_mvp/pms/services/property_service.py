"""Property service -- multi-property CRUD and context resolution.

Provides helpers for creating/listing properties and resolving the
"current" property for a request (via ``g.current_property``).
"""

from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from flask import g

from ..audit import write_audit_log
from ..activity import write_activity_log
from ..extensions import db
from ..models import Property


# ---------------------------------------------------------------------------
# Current property resolution
# ---------------------------------------------------------------------------


def get_current_property() -> Property | None:
    """Return the current property from ``g.current_property``.

    Falls back to the first active property in the database if the request
    context has not been populated yet (e.g. single-property installations).
    """
    prop = getattr(g, "current_property", None)
    if prop is not None:
        return prop

    prop = (
        db.session.execute(
            sa.select(Property)
            .where(Property.is_active.is_(True))
            .order_by(Property.created_at.asc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    g.current_property = prop
    return prop


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------


def list_properties(*, include_inactive: bool = False) -> list[Property]:
    """Return all properties, optionally including inactive ones."""
    query = sa.select(Property).order_by(Property.name.asc())
    if not include_inactive:
        query = query.where(Property.is_active.is_(True))
    return list(db.session.execute(query).scalars().all())


def get_property(property_id: uuid.UUID) -> Property | None:
    """Look up a single property by primary key."""
    return db.session.get(Property, property_id)


def get_property_by_code(code: str) -> Property | None:
    """Look up a property by its unique short code."""
    return (
        db.session.execute(
            sa.select(Property).where(Property.code == code)
        )
        .scalars()
        .first()
    )


# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------


def create_property(
    *,
    name: str,
    code: str,
    timezone: str = "Asia/Bangkok",
    currency: str = "THB",
    address: str | None = None,
    settings_json: dict[str, Any] | None = None,
    actor_user_id: uuid.UUID | None = None,
) -> Property:
    """Create a new property."""
    name = name.strip()
    code = code.strip().upper()
    if not name:
        raise ValueError("Property name is required.")
    if not code or len(code) > 20:
        raise ValueError("Property code is required and must be at most 20 characters.")

    existing = get_property_by_code(code)
    if existing is not None:
        raise ValueError(f"A property with code '{code}' already exists.")

    prop = Property(
        name=name,
        code=code,
        timezone=timezone.strip() or "Asia/Bangkok",
        currency=currency.strip() or "THB",
        address=(address or "").strip() or None,
        settings_json=settings_json,
        is_active=True,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.session.add(prop)
    db.session.flush()

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="properties",
        entity_id=str(prop.id),
        action="create",
        after_data={"name": prop.name, "code": prop.code, "timezone": prop.timezone, "currency": prop.currency},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="property.created",
        entity_table="properties",
        entity_id=str(prop.id),
        metadata={"name": prop.name, "code": prop.code},
    )
    db.session.commit()
    return prop


def update_property(
    property_id: uuid.UUID,
    *,
    name: str | None = None,
    timezone: str | None = None,
    currency: str | None = None,
    address: str | None = None,
    settings_json: dict[str, Any] | None = None,
    is_active: bool | None = None,
    actor_user_id: uuid.UUID | None = None,
) -> Property:
    """Update an existing property."""
    prop = db.session.get(Property, property_id)
    if prop is None:
        raise ValueError("Property not found.")

    before_data = {"name": prop.name, "timezone": prop.timezone, "currency": prop.currency, "is_active": prop.is_active}

    if name is not None:
        prop.name = name.strip()
    if timezone is not None:
        prop.timezone = timezone.strip()
    if currency is not None:
        prop.currency = currency.strip()
    if address is not None:
        prop.address = address.strip() or None
    if settings_json is not None:
        prop.settings_json = settings_json
    if is_active is not None:
        prop.is_active = is_active
    prop.updated_by_user_id = actor_user_id

    db.session.flush()

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="properties",
        entity_id=str(prop.id),
        action="update",
        before_data=before_data,
        after_data={"name": prop.name, "timezone": prop.timezone, "currency": prop.currency, "is_active": prop.is_active},
    )
    db.session.commit()
    return prop
