from __future__ import annotations

import string
import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import sqlalchemy as sa

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..constants import BOOKING_EXTRA_PRICING_MODES
from ..extensions import db
from ..models import BookingExtra, FolioCharge, Reservation, ReservationExtra
from ..pricing import money
from .cashier_service import post_fee_charge


@dataclass
class BookingExtraPayload:
    code: str
    name: str
    description: str | None
    pricing_mode: str
    unit_price: Decimal
    is_active: bool
    is_public: bool
    sort_order: int = 100


@dataclass
class BookingExtraQuoteLine:
    booking_extra_id: uuid.UUID
    code: str
    name: str
    description: str | None
    pricing_mode: str
    quantity: int
    unit_price: Decimal
    total_amount: Decimal
    sort_order: int


@dataclass
class BookingExtrasQuote:
    lines: list[BookingExtraQuoteLine]
    total_amount: Decimal


def list_booking_extras(*, include_inactive: bool = False, public_only: bool = False) -> list[BookingExtra]:
    query = sa.select(BookingExtra).order_by(BookingExtra.sort_order.asc(), BookingExtra.name.asc())
    if not include_inactive:
        query = query.where(BookingExtra.is_active.is_(True))
    if public_only:
        query = query.where(BookingExtra.is_public.is_(True), BookingExtra.is_active.is_(True))
    return db.session.execute(query).scalars().all()


def upsert_booking_extra(
    extra_id: uuid.UUID | None,
    payload: BookingExtraPayload,
    *,
    actor_user_id: uuid.UUID,
) -> BookingExtra:
    code = _normalize_code(payload.code)
    if payload.pricing_mode not in BOOKING_EXTRA_PRICING_MODES:
        raise ValueError("Extra pricing mode is invalid.")
    name = (payload.name or "").strip()
    if not name:
        raise ValueError("Extra name is required.")
    if len(name) > 120:
        raise ValueError("Extra name is too long.")
    if payload.sort_order < 0:
        raise ValueError("Sort order must be zero or greater.")

    existing = db.session.execute(
        sa.select(BookingExtra).where(sa.func.upper(BookingExtra.code) == code)
    ).scalar_one_or_none()
    if existing and existing.id != extra_id:
        raise ValueError("Extra code must be unique.")

    booking_extra = db.session.get(BookingExtra, extra_id) if extra_id else None
    if extra_id and not booking_extra:
        raise ValueError("Extra not found.")

    before_data = _booking_extra_snapshot(booking_extra) if booking_extra else None
    if not booking_extra:
        booking_extra = BookingExtra(created_by_user_id=actor_user_id)
        db.session.add(booking_extra)

    booking_extra.code = code
    booking_extra.name = name
    booking_extra.description = _clean_optional(payload.description, limit=1000)
    booking_extra.pricing_mode = payload.pricing_mode
    booking_extra.unit_price = money(payload.unit_price)
    booking_extra.is_active = bool(payload.is_active)
    booking_extra.is_public = bool(payload.is_public)
    booking_extra.sort_order = int(payload.sort_order)
    booking_extra.updated_by_user_id = actor_user_id
    db.session.flush()

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="booking_extras",
        entity_id=str(booking_extra.id),
        action="booking_extra_upserted",
        before_data=before_data,
        after_data=_booking_extra_snapshot(booking_extra),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="admin.booking_extra_updated",
        entity_table="booking_extras",
        entity_id=str(booking_extra.id),
        metadata={"code": booking_extra.code, "pricing_mode": booking_extra.pricing_mode},
    )
    db.session.commit()
    return booking_extra


def resolve_booking_extras(
    extra_ids: list[uuid.UUID] | tuple[uuid.UUID, ...] | None,
    *,
    public_only: bool = False,
) -> list[BookingExtra]:
    ordered_ids = _dedupe_ids(extra_ids or [])
    if not ordered_ids:
        return []

    query = sa.select(BookingExtra).where(BookingExtra.id.in_(ordered_ids))
    if public_only:
        query = query.where(BookingExtra.is_active.is_(True), BookingExtra.is_public.is_(True))
    else:
        query = query.where(BookingExtra.is_active.is_(True))
    extras = db.session.execute(query).scalars().all()
    extras_by_id = {item.id: item for item in extras}
    if len(extras_by_id) != len(ordered_ids):
        raise ValueError("One or more selected extras are unavailable.")
    return [extras_by_id[item_id] for item_id in ordered_ids]


def quote_booking_extras(
    extras: list[BookingExtra],
    *,
    check_in_date: date,
    check_out_date: date,
) -> BookingExtrasQuote:
    stay_nights = max((check_out_date - check_in_date).days, 0)
    lines: list[BookingExtraQuoteLine] = []
    total_amount = Decimal("0.00")
    for extra in extras:
        quantity = stay_nights if extra.pricing_mode == "per_night" else 1
        unit_price = money(extra.unit_price)
        line_total = money(unit_price * Decimal(str(quantity)))
        lines.append(
            BookingExtraQuoteLine(
                booking_extra_id=extra.id,
                code=extra.code,
                name=extra.name,
                description=extra.description,
                pricing_mode=extra.pricing_mode,
                quantity=quantity,
                unit_price=unit_price,
                total_amount=line_total,
                sort_order=extra.sort_order,
            )
        )
        total_amount += line_total
    return BookingExtrasQuote(lines=lines, total_amount=money(total_amount))


def attach_extras_quote_to_reservation(
    reservation: Reservation,
    extras_quote: BookingExtrasQuote,
    *,
    actor_user_id: uuid.UUID | None,
    source: str = "public_booking",
) -> list[ReservationExtra]:
    recompute_reservation_grand_total(reservation, extras_total=extras_quote.total_amount)
    created: list[ReservationExtra] = []
    for line in extras_quote.lines:
        row = ReservationExtra(
            reservation_id=reservation.id,
            booking_extra_id=line.booking_extra_id,
            extra_code=line.code,
            extra_name=line.name,
            description=line.description,
            pricing_mode=line.pricing_mode,
            quantity=line.quantity,
            unit_price=line.unit_price,
            total_amount=line.total_amount,
            sort_order=line.sort_order,
            source=source,
            created_by_user_id=actor_user_id,
            updated_by_user_id=actor_user_id,
        )
        db.session.add(row)
        created.append(row)
    db.session.flush()
    return created


def reprice_reservation_extras(
    reservation: Reservation,
    *,
    actor_user_id: uuid.UUID | None,
) -> Decimal:
    extras = _sorted_reservation_extras(reservation)
    stay_nights = max((reservation.check_out_date - reservation.check_in_date).days, 0)
    total_amount = Decimal("0.00")
    for item in extras:
        item.quantity = stay_nights if item.pricing_mode == "per_night" else 1
        item.unit_price = money(item.unit_price)
        item.total_amount = money(item.unit_price * Decimal(str(item.quantity)))
        item.updated_by_user_id = actor_user_id
        total_amount += money(item.total_amount)
    recompute_reservation_grand_total(reservation, extras_total=total_amount)
    return money(total_amount)


def recompute_reservation_grand_total(
    reservation: Reservation,
    *,
    extras_total: Decimal | None = None,
) -> Decimal:
    resolved_extras_total = money(
        extras_total if extras_total is not None else getattr(reservation, "quoted_extras_total", Decimal("0.00"))
    )
    reservation.quoted_extras_total = resolved_extras_total
    reservation.quoted_grand_total = money(money(reservation.quoted_room_total) + money(reservation.quoted_tax_total) + resolved_extras_total)
    return money(reservation.quoted_grand_total)


def reservation_extra_summary(reservation: Reservation) -> list[dict]:
    extras = _sorted_reservation_extras(reservation)
    return [
        {
            "id": item.id,
            "code": item.extra_code,
            "name": item.extra_name,
            "description": item.description,
            "pricing_mode": item.pricing_mode,
            "pricing_label": "Per night" if item.pricing_mode == "per_night" else "Per stay",
            "quantity": item.quantity,
            "unit_price": money(item.unit_price),
            "total_amount": money(item.total_amount),
            "is_complimentary": money(item.total_amount) == Decimal("0.00"),
        }
        for item in extras
    ]


def post_reservation_extras_to_folio(
    reservation: Reservation,
    *,
    actor_user_id: uuid.UUID | None,
) -> list[ReservationExtra]:
    posted: list[ReservationExtra] = []
    active_folio_lines = [
        line
        for line in db.session.execute(
            sa.select(FolioCharge).where(FolioCharge.reservation_id == reservation.id)
        )
        .scalars()
        .all()
        if line.voided_at is None
    ]
    for item in _sorted_reservation_extras(reservation):
        matching_lines = [
            line
            for line in active_folio_lines
            if _folio_line_matches_reservation_extra(line, item)
        ]
        current_posted_total = sum(
            (money(line.total_amount) for line in matching_lines),
            Decimal("0.00"),
        )
        target_total = money(item.total_amount)
        should_seed_zero_line = not matching_lines and target_total == Decimal("0.00")
        delta_amount = money(target_total - current_posted_total)
        if delta_amount == Decimal("0.00") and not should_seed_zero_line:
            if matching_lines:
                item.posted_folio_charge_id = matching_lines[-1].id
            item.updated_by_user_id = actor_user_id
            posted.append(item)
            continue

        description = _extra_folio_description(item)
        if matching_lines and delta_amount != Decimal("0.00"):
            description = f"Adjustment for {description}"
        folio_line = post_fee_charge(
            reservation.id,
            charge_code="XTR",
            description=description,
            amount=Decimal("0.00") if should_seed_zero_line else delta_amount,
            service_date=reservation.check_in_date,
            actor_user_id=actor_user_id,
            metadata={
                "source": "booking_extra",
                "reservation_extra_id": str(item.id),
                "extra_code": item.extra_code,
                "pricing_mode": item.pricing_mode,
                "quantity": item.quantity,
                "is_adjustment": bool(matching_lines),
            },
            posting_key=_reservation_extra_posting_key(reservation, item),
            commit=False,
        )
        item.posted_folio_charge_id = folio_line.id
        item.updated_by_user_id = actor_user_id
        active_folio_lines.append(folio_line)
        posted.append(item)
    return posted


def _booking_extra_snapshot(extra: BookingExtra | None) -> dict | None:
    if not extra:
        return None
    return {
        "code": extra.code,
        "name": extra.name,
        "pricing_mode": extra.pricing_mode,
        "unit_price": str(extra.unit_price),
        "is_active": extra.is_active,
        "is_public": extra.is_public,
        "sort_order": extra.sort_order,
    }


def _clean_optional(value: str | None, *, limit: int) -> str | None:
    cleaned = (value or "").strip()
    if not cleaned:
        return None
    if len(cleaned) > limit:
        raise ValueError("Text is too long.")
    return cleaned


def _normalize_code(value: str) -> str:
    candidate = (value or "").strip().upper()
    if not candidate:
        raise ValueError("Extra code is required.")
    allowed = set(string.ascii_uppercase + string.digits + "-_")
    if any(char not in allowed for char in candidate):
        raise ValueError("Extra code may only contain letters, numbers, hyphens, and underscores.")
    return candidate[:40]


def _dedupe_ids(extra_ids: list[uuid.UUID] | tuple[uuid.UUID, ...]) -> list[uuid.UUID]:
    ordered: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for item in extra_ids:
        if item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return ordered


def _sorted_reservation_extras(reservation: Reservation) -> list[ReservationExtra]:
    return sorted(
        list(getattr(reservation, "extras", []) or []),
        key=lambda item: (item.sort_order, item.extra_name.lower(), str(item.id)),
    )


def _extra_folio_description(item: ReservationExtra) -> str:
    description = item.extra_name
    if item.pricing_mode == "per_night":
        suffix = "night" if item.quantity == 1 else "nights"
        description = f"{item.extra_name} ({item.quantity} {suffix})"
    return description[:255]


def _folio_line_matches_reservation_extra(
    folio_line: FolioCharge,
    reservation_extra: ReservationExtra,
) -> bool:
    metadata = dict(folio_line.metadata_json or {})
    if metadata.get("source") != "booking_extra":
        return False
    if metadata.get("reservation_extra_id"):
        return metadata["reservation_extra_id"] == str(reservation_extra.id)
    return metadata.get("extra_code") == reservation_extra.extra_code


def _reservation_extra_posting_key(
    reservation: Reservation,
    reservation_extra: ReservationExtra,
) -> str:
    target_amount = str(money(reservation_extra.total_amount)).replace(".", "_")
    return (
        f"extra:{reservation.id}:{reservation_extra.id}:"
        f"{reservation_extra.quantity}:{target_amount}"
    )[:160]
