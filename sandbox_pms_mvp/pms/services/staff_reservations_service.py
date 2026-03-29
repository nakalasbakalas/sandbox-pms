from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.orm import joinedload

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..extensions import db
from ..models import (
    ActivityLog,
    AuditLog,
    CancellationRequest,
    ConversationThread,
    EmailOutbox,
    FolioCharge,
    Guest,
    GuestNote,
    InventoryDay,
    ModificationRequest,
    PaymentRequest,
    Reservation,
    ReservationDocument,
    ReservationNote,
    ReservationReviewQueue,
    ReservationStatusHistory,
    Room,
    RoomType,
    User,
    utc_now,
)
from ..permissions import allowed_note_visibility_scopes
from ..normalization import clean_optional, normalize_email, normalize_phone
from ..pricing import money, quote_reservation
from .communication_service import (
    dispatch_notification_deliveries,
    query_notification_history,
    queue_cancellation_confirmation,
    queue_modification_confirmation,
    queue_reservation_confirmation,
)
from .extras_service import (
    post_reservation_extras_to_folio,
    recompute_reservation_grand_total,
    reprice_reservation_extras,
    reservation_extra_summary,
)
from .ical_service import room_has_external_block
from .reservation_service import (
    calculate_deposit_required,
    inventory_row_can_allocate,
    reservation_snapshot,
    validate_occupancy,
)

_log = logging.getLogger(__name__)



@dataclass
class ReservationWorkspaceFilters:
    q: str = ""
    status: str = ""
    room_type_id: str = ""
    arrival_date: str = ""
    departure_date: str = ""
    payment_state: str = ""
    booking_source: str = ""
    review_status: str = ""
    assigned: str = ""
    include_closed: bool = False
    page: int = 1
    per_page: int = 25
    sort: str = ""          # arrival | departure | status | reference
    sort_dir: str = "asc"   # asc | desc


@dataclass
class GuestUpdatePayload:
    first_name: str
    last_name: str
    phone: str
    email: str | None
    nationality: str | None = None
    id_document_type: str | None = None
    id_document_number: str | None = None
    preferred_language: str | None = None
    notes_summary: str | None = None


@dataclass
class StayDateChangePayload:
    check_in_date: date
    check_out_date: date
    adults: int
    children: int
    extra_guests: int
    requested_room_id: uuid.UUID | None = None


@dataclass
class ReservationNotePayload:
    note_text: str
    note_type: str = "general"
    is_important: bool = False
    visibility_scope: str = "all_staff"


def list_reservations(filters: ReservationWorkspaceFilters) -> dict:
    filters.page = max(filters.page or 1, 1)
    filters.per_page = min(max(filters.per_page or 25, 1), 100)

    query = _reservation_workspace_query()
    query = _apply_workspace_filters(query, filters)
    today = date.today()
    operational_rank = sa.case(
        (Reservation.check_in_date == today, 0),
        (Reservation.check_out_date == today, 1),
        (Reservation.current_status == "checked_in", 2),
        else_=3,
    )
    total = db.session.execute(
        sa.select(sa.func.count()).select_from(query.order_by(None).subquery())
    ).scalar()

    _sort_cols = {
        "arrival": Reservation.check_in_date,
        "departure": Reservation.check_out_date,
        "status": Reservation.current_status,
        "reference": Reservation.reservation_code,
    }
    if filters.sort in _sort_cols:
        col = _sort_cols[filters.sort]
        primary_order = col.desc() if filters.sort_dir == "desc" else col.asc()
        order_args = [primary_order, Reservation.booked_at.desc()]
    else:
        order_args = [operational_rank.asc(), Reservation.check_in_date.asc(), Reservation.booked_at.desc()]

    items = (
        db.session.execute(
            query.order_by(*order_args)
            .limit(filters.per_page)
            .offset((filters.page - 1) * filters.per_page)
        )
        .unique()
        .scalars()
        .all()
    )
    return {
        "items": _build_summaries_batched(items),
        "total": total,
        "page": filters.page,
        "per_page": filters.per_page,
        "pages": max((total + filters.per_page - 1) // filters.per_page, 1),
    }


def list_arrivals(*, arrival_date: date, room_type_id: str = "", payment_state: str = "", assigned: str = "") -> list[dict]:
    filters = ReservationWorkspaceFilters(
        arrival_date=arrival_date.isoformat(),
        room_type_id=room_type_id,
        payment_state=payment_state,
        assigned=assigned,
        include_closed=False,
        per_page=200,
    )
    query = _apply_workspace_filters(_reservation_workspace_query(), filters)
    query = query.where(Reservation.current_status.in_(["tentative", "confirmed", "checked_in"]))
    items = (
        db.session.execute(query.order_by(Reservation.check_in_date.asc(), Reservation.booked_at.asc()))
        .unique()
        .scalars()
        .all()
    )
    return _build_summaries_batched(items)


def list_departures(*, departure_date: date, room_type_id: str = "", payment_state: str = "") -> list[dict]:
    filters = ReservationWorkspaceFilters(
        departure_date=departure_date.isoformat(),
        room_type_id=room_type_id,
        payment_state=payment_state,
        include_closed=True,
        per_page=200,
    )
    query = _apply_workspace_filters(_reservation_workspace_query(), filters)
    query = query.where(Reservation.current_status.in_(["checked_in", "checked_out"]))
    items = (
        db.session.execute(query.order_by(Reservation.check_out_date.asc(), Reservation.booked_at.asc()))
        .unique()
        .scalars()
        .all()
    )
    return _build_summaries_batched(items)


def list_in_house(*, business_date: date) -> list[dict]:
    query = _reservation_workspace_query().where(
        Reservation.current_status == "checked_in",
        Reservation.check_in_date <= business_date,
        Reservation.check_out_date > business_date,
    )
    items = (
        db.session.execute(query.order_by(Reservation.check_out_date.asc()))
        .unique()
        .scalars()
        .all()
    )
    return _build_summaries_batched(items)


def get_reservation_detail(reservation_id: uuid.UUID, *, actor_user: User | None = None) -> dict:
    reservation = _load_reservation(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    detail = build_reservation_summary(reservation)
    detail["reservation"] = reservation
    detail["visible_notes"] = [
        note for note in reservation.notes
        if note.visibility_scope in allowed_note_visibility_scopes(actor_user)
    ]
    detail["payment_summary"] = payment_summary(reservation)
    detail["extras"] = reservation_extra_summary(reservation)
    detail["eligible_rooms"] = eligible_rooms(reservation)
    detail["timeline"] = reservation_timeline(reservation)
    detail["pending_cancellation_requests"] = db.session.execute(
        sa.select(sa.func.count())
        .select_from(CancellationRequest)
        .where(
            CancellationRequest.reservation_id == reservation.id,
            CancellationRequest.status.in_(["submitted", "needs_review"]),
        )
    ).scalar()
    detail["modification_requests"] = list_modification_requests(reservation.id)
    detail["pending_modification_requests"] = sum(
        1 for mr in detail["modification_requests"] if mr["status"] in ("submitted", "reviewed")
    )
    detail["communication_history"] = query_notification_history(reservation_id=reservation.id, limit=40)
    detail["room_types"] = (
        db.session.execute(
            sa.select(RoomType)
            .where(RoomType.is_active.is_(True))
            .order_by(RoomType.code.asc())
        )
        .scalars()
        .all()
    )
    return detail


def reservation_attribution_summary(reservation: Reservation) -> dict:
    metadata = dict(reservation.source_metadata_json or {})
    entry_page = metadata.get("entry_page") or metadata.get("landing_path")
    source_label = metadata.get("source_label") or metadata.get("utm_source")
    if not source_label:
        source_label = "direct" if reservation.source_channel == "direct_web" else reservation.source_channel
    return {
        "source_label": source_label,
        "utm_source": metadata.get("utm_source"),
        "utm_medium": metadata.get("utm_medium"),
        "utm_campaign": metadata.get("utm_campaign"),
        "utm_content": metadata.get("utm_content"),
        "referrer_host": metadata.get("referrer_host"),
        "entry_page": entry_page,
        "entry_cta_source": metadata.get("entry_cta_source"),
        "has_marketing_context": bool(
            metadata.get("utm_source")
            or metadata.get("utm_medium")
            or metadata.get("utm_campaign")
            or metadata.get("utm_content")
            or metadata.get("referrer_host")
            or metadata.get("entry_cta_source")
        ),
    }


def build_reservation_summary(reservation: Reservation, *, _review_map: dict | None = None) -> dict:
    payment = payment_summary(reservation)
    if _review_map is not None:
        review_entry = _review_map.get(reservation.id)
    else:
        review_entry = (
            db.session.execute(
                sa.select(ReservationReviewQueue).where(ReservationReviewQueue.reservation_id == reservation.id)
            )
            .scalars()
            .first()
        )
    attribution = reservation_attribution_summary(reservation)
    return {
        "id": reservation.id,
        "reservation_code": reservation.reservation_code,
        "guest_name": reservation.primary_guest.full_name if reservation.primary_guest else "Unknown guest",
        "guest_phone": reservation.primary_guest.phone if reservation.primary_guest else "",
        "guest_email": reservation.primary_guest.email if reservation.primary_guest else None,
        "room_type_name": reservation.room_type.name if reservation.room_type else "",
        "room_type_code": reservation.room_type.code if reservation.room_type else "",
        "room_type_id": str(reservation.room_type_id),
        "assigned_room_number": reservation.assigned_room.room_number if reservation.assigned_room else None,
        "arrival_date": reservation.check_in_date,
        "departure_date": reservation.check_out_date,
        "nights": (reservation.check_out_date - reservation.check_in_date).days,
        "status": reservation.current_status,
        "deposit_state": payment["deposit_state"],
        "payment_state": payment["payment_state"],
        "deposit_required_amount": Decimal(str(reservation.deposit_required_amount)),
        "deposit_received_amount": payment["deposit_received_amount"],
        "balance_due": payment["balance_due"],
        "quoted_extras_total": Decimal(str(getattr(reservation, "quoted_extras_total", 0))),
        "source_channel": reservation.source_channel,
        "attribution": attribution,
        "review_status": review_entry.review_status if review_entry else None,
        "needs_follow_up": bool(review_entry and review_entry.review_status in {"needs_follow_up", "issue_flagged"}),
        "special_requests_present": bool(reservation.special_requests),
        "duplicate_suspected": reservation.duplicate_suspected,
        "created_from_public_booking_flow": reservation.created_from_public_booking_flow,
    }


def _batch_review_map(reservation_ids: list[uuid.UUID]) -> dict[uuid.UUID, ReservationReviewQueue]:
    """Batch-fetch review queue entries for a list of reservation IDs (1 query)."""
    if not reservation_ids:
        return {}
    entries = db.session.execute(
        sa.select(ReservationReviewQueue).where(ReservationReviewQueue.reservation_id.in_(reservation_ids))
    ).scalars().all()
    return {entry.reservation_id: entry for entry in entries}


def _build_summaries_batched(items: list[Reservation]) -> list[dict]:
    """Build reservation summaries with batch-fetched review queue data."""
    review_map = _batch_review_map([r.id for r in items])
    return [build_reservation_summary(item, _review_map=review_map) for item in items]

def payment_summary(reservation: Reservation) -> dict:
    from .cashier_service import folio_summary

    summary = folio_summary(reservation)
    lines = [
        line
        for line in db.session.execute(
            sa.select(FolioCharge)
            .where(FolioCharge.reservation_id == reservation.id)
            .order_by(FolioCharge.service_date.asc(), FolioCharge.posted_at.asc())
        )
        .scalars()
        .all()
        if line.voided_at is None
    ]
    paid_requests = (
        db.session.execute(
            sa.select(PaymentRequest).where(
                PaymentRequest.reservation_id == reservation.id,
                PaymentRequest.status == "paid",
            )
        )
        .scalars()
        .all()
    )

    legacy_deposit_total = sum(
        (
            money(item.amount)
            for item in paid_requests
            if "deposit" in (item.request_type or "")
        ),
        Decimal("0.00"),
    )
    legacy_payment_total = sum(
        (
            money(item.amount)
            for item in paid_requests
            if "deposit" not in (item.request_type or "")
        ),
        Decimal("0.00"),
    )
    deposit_received = summary["deposit_received_amount"] or legacy_deposit_total
    payment_total = summary["payment_total"] or legacy_payment_total

    posted_room_total = sum(
        (money(line.total_amount) for line in lines if line.charge_type == "room"),
        Decimal("0.00"),
    )
    posted_extra_total = sum(
        (
            money(line.total_amount)
            for line in lines
            if (
                line.charge_code == "XTR"
                or (line.metadata_json or {}).get("source") == "booking_extra"
            )
        ),
        Decimal("0.00"),
    )
    posted_other_total = sum(
        (
            money(line.total_amount)
            for line in lines
            if line.charge_type not in {"room", "deposit", "payment"}
            and line.charge_code != "XTR"
            and (line.metadata_json or {}).get("source") != "booking_extra"
        ),
        Decimal("0.00"),
    )
    quoted_room_total = Decimal("0.00")
    quoted_extra_total = Decimal("0.00")
    if reservation.current_status not in {"cancelled", "no_show"}:
        quoted_room_total = money(reservation.quoted_room_total) + money(reservation.quoted_tax_total)
        quoted_extra_total = money(getattr(reservation, "quoted_extras_total", 0))
    expected_total = max(posted_room_total, quoted_room_total) + max(posted_extra_total, quoted_extra_total) + posted_other_total
    credits_total = deposit_received + payment_total
    balance_due = max(expected_total - credits_total, Decimal("0.00"))
    refund_due = max(credits_total - expected_total, Decimal("0.00"))

    if reservation.deposit_required_amount == Decimal("0.00"):
        deposit_state = "not_required"
    elif deposit_received == Decimal("0.00"):
        deposit_state = "missing"
    elif deposit_received < money(reservation.deposit_required_amount):
        deposit_state = "partial"
    else:
        deposit_state = "paid"

    if balance_due == Decimal("0.00") and refund_due == Decimal("0.00"):
        settlement_state = "settled"
    elif refund_due > Decimal("0.00"):
        settlement_state = "overpaid"
    elif credits_total == Decimal("0.00"):
        settlement_state = "unpaid"
    else:
        settlement_state = "partially_paid"

    summary.update(
        {
            "deposit_received_amount": deposit_received.quantize(Decimal("0.01")),
            "deposit_applied_amount": min(deposit_received, expected_total).quantize(Decimal("0.01")),
            "unused_deposit_amount": max(deposit_received - expected_total, Decimal("0.00")).quantize(Decimal("0.01")),
            "payment_total": payment_total.quantize(Decimal("0.01")),
            "credits_total": credits_total.quantize(Decimal("0.01")),
            "balance_due": balance_due.quantize(Decimal("0.01")),
            "refund_due": refund_due.quantize(Decimal("0.01")),
            "net_balance": (expected_total - credits_total).quantize(Decimal("0.01")),
            "deposit_state": deposit_state,
            "payment_state": settlement_state,
            "settlement_state": settlement_state,
        }
    )
    return summary


def eligible_rooms(reservation: Reservation) -> list[Room]:
    effective_start = max(date.today(), reservation.check_in_date) if reservation.current_status == "checked_in" else reservation.check_in_date
    return _eligible_room_list(
        reservation=reservation,
        room_type_id=reservation.room_type_id,
        check_in_date=effective_start,
        check_out_date=reservation.check_out_date,
        include_current_reservation_rows=True,
    )


def reservation_timeline(reservation: Reservation) -> list[dict]:
    # Collect all timeline items first, batch-fetch actor names after
    raw_notes = [
        {
            "kind": "note",
            "created_at": note.created_at,
            "label": note.note_type.replace("_", " ").title(),
            "text": note.note_text,
            "important": note.is_important,
            "_actor_id": note.created_by_user_id,
        }
        for note in reservation.notes
    ]
    raw_history = [
        {
            "kind": "status",
            "created_at": item.changed_at,
            "label": f"{item.old_status or 'new'} -> {item.new_status}",
            "text": item.note or item.reason or "",
            "important": item.new_status in {"cancelled", "no_show"},
            "_actor_id": item.changed_by_user_id,
        }
        for item in reservation.status_history
    ]
    raw_audits = [
        {
            "kind": "audit",
            "created_at": item.created_at,
            "label": item.action.replace("_", " "),
            "text": item.entity_table,
            "important": False,
            "_actor_id": item.actor_user_id,
        }
        for item in db.session.execute(
            sa.select(AuditLog)
            .where(
                AuditLog.entity_table == "reservations",
                AuditLog.entity_id == str(reservation.id),
            )
            .order_by(AuditLog.created_at.desc())
            .limit(20)
        )
        .scalars()
        .all()
    ]
    raw_activities = [
        {
            "kind": "activity",
            "created_at": item.created_at,
            "label": item.event_type.replace(".", " "),
            "text": item.metadata_json.get("reservation_code", "") if item.metadata_json else "",
            "important": False,
            "_actor_id": item.actor_user_id,
        }
        for item in db.session.execute(
            sa.select(ActivityLog)
            .where(
                ActivityLog.entity_table == "reservations",
                ActivityLog.entity_id == str(reservation.id),
            )
            .order_by(ActivityLog.created_at.desc())
            .limit(30)
        )
        .scalars()
        .all()
    ]
    all_items = raw_notes + raw_history + raw_audits + raw_activities

    # Batch-fetch all actor names in a single query
    actor_ids = {item["_actor_id"] for item in all_items if item["_actor_id"]}
    actor_map: dict = {}
    if actor_ids:
        actors = db.session.execute(
            sa.select(User).where(User.id.in_(actor_ids))
        ).scalars().all()
        actor_map = {a.id: a.full_name for a in actors}

    timeline = []
    for item in all_items:
        actor_id = item.pop("_actor_id")
        if actor_id:
            item["actor"] = actor_map.get(actor_id, str(actor_id))
        else:
            item["actor"] = None
        timeline.append(item)

    timeline.sort(key=lambda item: item["created_at"], reverse=True)
    return timeline[:40]


def update_guest_details(
    reservation_id: uuid.UUID,
    payload: GuestUpdatePayload,
    *,
    actor_user_id: uuid.UUID,
) -> Reservation:
    reservation = _load_reservation(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    guest = reservation.primary_guest
    if not guest:
        raise ValueError("Guest record not found.")

    payload = GuestUpdatePayload(
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        phone=normalize_phone(payload.phone),
        email=normalize_email(payload.email),
        nationality=clean_optional(payload.nationality),
        id_document_type=clean_optional(payload.id_document_type),
        id_document_number=clean_optional(payload.id_document_number),
        preferred_language=clean_optional(payload.preferred_language),
        notes_summary=clean_optional(payload.notes_summary, limit=255),
    )
    if not payload.first_name or not payload.last_name:
        raise ValueError("First name and last name are required.")
    if not payload.phone:
        raise ValueError("A valid mobile phone is required.")
    if payload.email and "@" not in payload.email:
        raise ValueError("A valid email address is required.")

    before_data = guest_snapshot(guest)
    guest.first_name = payload.first_name
    guest.last_name = payload.last_name
    guest.full_name = f"{payload.first_name} {payload.last_name}".strip()
    guest.phone = payload.phone
    guest.email = payload.email
    guest.nationality = payload.nationality
    guest.id_document_type = payload.id_document_type
    guest.id_document_number = payload.id_document_number
    guest.preferred_language = payload.preferred_language
    guest.notes_summary = payload.notes_summary
    guest.updated_by_user_id = actor_user_id

    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="guests",
        entity_id=str(guest.id),
        action="staff_guest_update",
        before_data=before_data,
        after_data=guest_snapshot(guest),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="reservation.guest_updated",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"reservation_code": reservation.reservation_code},
    )
    db.session.commit()
    return reservation


def change_stay_dates(
    reservation_id: uuid.UUID,
    payload: StayDateChangePayload,
    *,
    actor_user_id: uuid.UUID,
) -> dict:
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    if reservation.current_status not in {"tentative", "confirmed"}:
        raise ValueError("Only tentative or confirmed reservations can have stay dates edited.")
    if payload.check_in_date >= payload.check_out_date:
        raise ValueError("Check-in date must be before check-out date.")

    room_type = reservation.room_type
    validate_occupancy(room_type, payload.adults + payload.extra_guests, payload.children)
    before_data = reservation_snapshot(reservation)
    previous_room_id = reservation.assigned_room_id
    before_check_in = reservation.check_in_date
    before_check_out = reservation.check_out_date
    before_adults = reservation.adults
    before_children = reservation.children
    before_extra_guests = reservation.extra_guests

    quote = quote_reservation(
        room_type=room_type,
        check_in_date=payload.check_in_date,
        check_out_date=payload.check_out_date,
        adults=payload.adults + payload.extra_guests,
        children=payload.children,
    )
    candidate_room = _find_eligible_room(
        reservation=reservation,
        room_type_id=reservation.room_type_id,
        check_in_date=payload.check_in_date,
        check_out_date=payload.check_out_date,
        requested_room_id=payload.requested_room_id or reservation.assigned_room_id,
        include_current_reservation_rows=True,
    )
    current_rows = _reservation_inventory_rows(reservation.id)
    for row in current_rows:
        row.availability_status = "available"
        row.reservation_id = None
        row.nightly_rate = None
        row.updated_by_user_id = actor_user_id

    reservation.check_in_date = payload.check_in_date
    reservation.check_out_date = payload.check_out_date
    reservation.adults = payload.adults
    reservation.children = payload.children
    reservation.extra_guests = payload.extra_guests
    reservation.assigned_room_id = candidate_room.id
    reservation.quoted_room_total = quote.room_total
    reservation.quoted_tax_total = quote.tax_total
    reprice_reservation_extras(reservation, actor_user_id=actor_user_id)
    post_reservation_extras_to_folio(reservation, actor_user_id=actor_user_id)
    new_grand_total = recompute_reservation_grand_total(reservation)
    reservation.deposit_required_amount = calculate_deposit_required(payload.check_in_date, payload.check_out_date, new_grand_total)
    reservation.updated_by_user_id = actor_user_id

    _allocate_inventory_range(
        reservation=reservation,
        room=candidate_room,
        nightly_rates=quote.nightly_rates,
        actor_user_id=actor_user_id,
    )
    db.session.add(
        ReservationStatusHistory(
            reservation_id=reservation.id,
            old_status=before_data["status"],
            new_status=reservation.current_status,
            reason="stay_dates_changed",
            note="Stay dates repriced by staff",
            changed_by_user_id=actor_user_id,
        )
    )
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="reservations",
        entity_id=str(reservation.id),
        action="staff_stay_dates_changed",
        before_data=before_data,
        after_data=reservation_snapshot(reservation),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="reservation.dates_changed",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={
            "reservation_code": reservation.reservation_code,
            "room_changed": previous_room_id != candidate_room.id,
            "grand_total": str(reservation.quoted_grand_total),
        },
    )
    notification_delivery_ids = queue_modification_confirmation(
        reservation,
        actor_user_id=actor_user_id,
        summary=(
            f"Stay updated from {before_check_in.isoformat()} to {before_check_out.isoformat()} "
            f"to {reservation.check_in_date.isoformat()} to {reservation.check_out_date.isoformat()}; "
            f"occupancy {before_adults}/{before_children}/{before_extra_guests} "
            f"to {reservation.adults}/{reservation.children}/{reservation.extra_guests}."
        ),
        language_code=reservation.booking_language,
        manual=False,
    )
    db.session.commit()
    try:
        dispatch_notification_deliveries(notification_delivery_ids)
    except Exception:  # noqa: BLE001
        _log.exception("dispatch_notification_deliveries failed after reservation modification")
    return {
        "reservation": reservation,
        "room_changed": previous_room_id != candidate_room.id,
        "old_total": Decimal(before_data["quoted_grand_total"]),
        "new_total": Decimal(str(reservation.quoted_grand_total)),
    }


def assign_room(
    reservation_id: uuid.UUID,
    room_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID,
    reason: str | None = None,
    commit: bool = True,
) -> Reservation:
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    if reservation.current_status not in {"tentative", "confirmed", "checked_in"}:
        raise ValueError("This reservation cannot be reassigned right now.")
    room = db.session.get(Room, room_id)
    if not room:
        raise ValueError("Selected room was not found.")
    if room.room_type_id != reservation.room_type_id:
        raise ValueError("Room assignment must stay within the booked room type.")

    if reservation.assigned_room_id == room.id:
        return reservation

    effective_start = max(date.today(), reservation.check_in_date) if reservation.current_status == "checked_in" else reservation.check_in_date
    if effective_start >= reservation.check_out_date:
        raise ValueError("No future inventory remains to reassign.")
    current_rows = _reservation_inventory_rows(reservation.id, start_date=effective_start)
    target_rows = _lock_inventory_rows(room.id, effective_start, reservation.check_out_date)
    if room_has_external_block(room.id, effective_start, reservation.check_out_date, for_update=True):
        raise ValueError("Selected room is blocked by an external calendar sync.")
    if len(target_rows) != (reservation.check_out_date - effective_start).days:
        raise ValueError("Selected room is not available for the full remaining stay.")
    if not all(inventory_row_can_allocate(row) for row in target_rows):
        raise ValueError("Selected room is not available for the full remaining stay.")

    before_data = reservation_snapshot(reservation)
    if current_rows:
        rate_lookup = {row.business_date: row.nightly_rate for row in current_rows}
    else:
        quote = quote_reservation(
            room_type=reservation.room_type,
            check_in_date=reservation.check_in_date,
            check_out_date=reservation.check_out_date,
            adults=reservation.adults + reservation.extra_guests,
            children=reservation.children,
        )
        rate_lookup = {
            business_date: nightly_rate
            for business_date, nightly_rate in quote.nightly_rates
            if business_date >= effective_start
        }
    for row in current_rows:
        row.availability_status = "available"
        row.reservation_id = None
        row.nightly_rate = None
        row.updated_by_user_id = actor_user_id
    for row in target_rows:
        row.availability_status = "occupied" if reservation.current_status == "checked_in" else "reserved"
        row.reservation_id = reservation.id
        row.nightly_rate = rate_lookup.get(row.business_date)
        row.updated_by_user_id = actor_user_id

    reservation.assigned_room_id = room.id
    reservation.updated_by_user_id = actor_user_id
    db.session.add(
        ReservationStatusHistory(
            reservation_id=reservation.id,
            old_status=reservation.current_status,
            new_status=reservation.current_status,
            reason="room_changed",
            note=f"Room changed to {room.room_number}" + (f" ({clean_optional(reason, limit=120)})" if reason else ""),
            changed_by_user_id=actor_user_id,
        )
    )
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="reservations",
        entity_id=str(reservation.id),
        action="staff_room_changed",
        before_data=before_data,
        after_data=reservation_snapshot(reservation),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="reservation.room_changed",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={
            "reservation_code": reservation.reservation_code,
            "room_number": room.room_number,
            "reason": clean_optional(reason, limit=120),
        },
    )
    if commit:
        db.session.commit()
    return reservation


def cancel_reservation_workspace(
    reservation_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID,
    reason: str,
) -> Reservation:
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    if reservation.current_status not in {"tentative", "confirmed"}:
        raise ValueError("Only tentative or confirmed reservations can be cancelled here.")

    before_data = reservation_snapshot(reservation)
    rows = _reservation_inventory_rows(reservation.id)
    for row in rows:
        row.availability_status = "available"
        row.reservation_id = None
        row.nightly_rate = None
        row.updated_by_user_id = actor_user_id

    reservation.current_status = "cancelled"
    reservation.cancelled_at = utc_now()
    reservation.cancellation_reason = clean_optional(reason, limit=255) or "staff_cancelled"
    reservation.updated_by_user_id = actor_user_id
    db.session.add(
        ReservationStatusHistory(
            reservation_id=reservation.id,
            old_status=before_data["status"],
            new_status="cancelled",
            reason=reservation.cancellation_reason,
            note="Cancelled via reservation workspace",
            changed_by_user_id=actor_user_id,
        )
    )
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="reservations",
        entity_id=str(reservation.id),
        action="staff_cancelled",
        before_data=before_data,
        after_data=reservation_snapshot(reservation),
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="reservation.cancelled",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"reservation_code": reservation.reservation_code, "reason": reservation.cancellation_reason},
    )
    notification_delivery_ids = queue_cancellation_confirmation(
        reservation,
        actor_user_id=actor_user_id,
        language_code=reservation.booking_language,
    )
    db.session.commit()
    try:
        dispatch_notification_deliveries(notification_delivery_ids)
    except Exception:  # noqa: BLE001
        _log.exception("dispatch_notification_deliveries failed after reservation cancellation")
    return reservation


def add_reservation_note(
    reservation_id: uuid.UUID,
    payload: ReservationNotePayload,
    *,
    actor_user_id: uuid.UUID,
) -> ReservationNote:
    reservation = _load_reservation(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    note_text = (payload.note_text or "").strip()
    if not note_text:
        raise ValueError("A note is required.")
    note = ReservationNote(
        reservation_id=reservation.id,
        note_text=note_text[:2000],
        note_type=payload.note_type,
        is_important=payload.is_important,
        visibility_scope=payload.visibility_scope,
        created_by_user_id=actor_user_id,
    )
    db.session.add(note)
    db.session.flush()
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="reservation_notes",
        entity_id=str(note.id),
        action="create",
        after_data={"reservation_id": str(reservation.id), "note_type": note.note_type, "is_important": note.is_important},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="reservation.note_added",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"reservation_code": reservation.reservation_code, "note_type": note.note_type},
    )
    db.session.commit()
    return note


def resend_confirmation(reservation_id: uuid.UUID, *, actor_user_id: uuid.UUID, language: str | None = None) -> EmailOutbox:
    reservation = _load_reservation(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    guest = reservation.primary_guest
    if not guest or not guest.email:
        raise ValueError("This reservation does not have a guest email address.")

    recent_send = (
        db.session.execute(
            sa.select(EmailOutbox)
            .where(
                EmailOutbox.reservation_id == reservation.id,
                EmailOutbox.email_type == "guest_confirmation",
            )
            .order_by(EmailOutbox.created_at.desc())
        )
        .scalars()
        .first()
    )
    if recent_send and recent_send.created_at >= utc_now() - timedelta(minutes=5):
        raise ValueError("A confirmation was already sent recently. Please wait before resending.")

    selected_language = language or reservation.booking_language or guest.preferred_language or "th"
    notification_delivery_ids = queue_reservation_confirmation(
        reservation,
        actor_user_id=actor_user_id,
        language_code=selected_language,
        manual=True,
    )
    if not notification_delivery_ids:
        raise ValueError("Confirmation email could not be queued.")
    delivery_id = notification_delivery_ids[0]
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="notification_deliveries",
        entity_id=str(delivery_id),
        action="guest_confirmation_resend",
        after_data={"reservation_id": str(reservation.id), "recipient_email": guest.email, "language": selected_language},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="reservation.confirmation_resent",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"reservation_code": reservation.reservation_code, "recipient_email": guest.email},
    )
    db.session.commit()
    try:
        dispatch_notification_deliveries(notification_delivery_ids)
    except Exception:  # noqa: BLE001
        _log.exception("dispatch_notification_deliveries failed after resend confirmation")
    delivery = query_notification_history(reservation_id=reservation.id, limit=10)
    for item in delivery:
        if item.id == delivery_id and item.email_outbox_id:
            return db.session.get(EmailOutbox, item.email_outbox_id)
    raise ValueError("Confirmation email outbox entry could not be loaded.")


def _reservation_workspace_query():
    return (
        sa.select(Reservation)
        .options(
            joinedload(Reservation.primary_guest),
            joinedload(Reservation.room_type),
            joinedload(Reservation.assigned_room),
            joinedload(Reservation.notes),
            joinedload(Reservation.status_history),
        )
        .outerjoin(ReservationReviewQueue, ReservationReviewQueue.reservation_id == Reservation.id)
    )


def _apply_workspace_filters(query, filters: ReservationWorkspaceFilters):
    if not filters.include_closed and not filters.status:
        query = query.where(Reservation.current_status.not_in(["cancelled", "no_show", "checked_out"]))
    if filters.status:
        query = query.where(Reservation.current_status == filters.status)
    if filters.room_type_id:
        query = query.where(Reservation.room_type_id == uuid.UUID(filters.room_type_id))
    if filters.arrival_date:
        query = query.where(Reservation.check_in_date == date.fromisoformat(filters.arrival_date))
    if filters.departure_date:
        query = query.where(Reservation.check_out_date == date.fromisoformat(filters.departure_date))
    if filters.booking_source:
        query = query.where(Reservation.source_channel == filters.booking_source)
    if filters.review_status:
        query = query.where(ReservationReviewQueue.review_status == filters.review_status)
    if filters.assigned == "assigned":
        query = query.where(Reservation.assigned_room_id.is_not(None))
    if filters.assigned == "unassigned":
        query = query.where(Reservation.assigned_room_id.is_(None))
    if filters.payment_state:
        query = _apply_payment_state_filter(query, filters.payment_state)
    if filters.q:
        query = _apply_search_filter(query, filters.q)
    return query


def _apply_search_filter(query, raw_query: str):
    q = raw_query.strip()
    like = f"%{q.lower()}%"
    digits = phone_digits(q)
    query = query.join(Guest, Guest.id == Reservation.primary_guest_id)
    conditions = [
        sa.func.lower(Guest.full_name).like(like),
        sa.func.lower(Reservation.reservation_code).like(f"{q.lower()}%"),
        sa.func.lower(sa.func.coalesce(Guest.email, "")).like(like),
    ]
    if digits:
        conditions.append(_normalized_phone_expression(Guest.phone).like(f"%{digits}%"))
    parsed_date = _maybe_date(q)
    if parsed_date:
        conditions.extend(
            [
                Reservation.check_in_date == parsed_date,
                Reservation.check_out_date == parsed_date,
                sa.and_(Reservation.check_in_date <= parsed_date, Reservation.check_out_date > parsed_date),
            ]
        )
    return query.where(sa.or_(*conditions))


def _apply_payment_state_filter(query, payment_state: str):
    paid_request_exists = sa.exists(
        sa.select(PaymentRequest.id).where(
            PaymentRequest.reservation_id == Reservation.id,
            PaymentRequest.status == "paid",
        )
    )
    failed_request_exists = sa.exists(
        sa.select(PaymentRequest.id).where(
            PaymentRequest.reservation_id == Reservation.id,
            PaymentRequest.status == "failed",
        )
    )
    if payment_state == "missing":
        return query.where(Reservation.deposit_required_amount > 0, Reservation.deposit_received_amount <= 0)
    if payment_state == "partial":
        return query.where(
            Reservation.deposit_required_amount > 0,
            Reservation.deposit_received_amount > 0,
            Reservation.deposit_received_amount < Reservation.deposit_required_amount,
        )
    if payment_state == "paid":
        return query.where(sa.or_(Reservation.deposit_received_amount >= Reservation.deposit_required_amount, paid_request_exists))
    if payment_state == "failed":
        return query.where(failed_request_exists)
    return query


def _load_reservation(reservation_id: uuid.UUID) -> Reservation | None:
    return (
        db.session.execute(
            sa.select(Reservation)
            .options(
                joinedload(Reservation.primary_guest),
                joinedload(Reservation.room_type),
                joinedload(Reservation.assigned_room),
                joinedload(Reservation.notes),
                joinedload(Reservation.status_history),
            )
            .where(Reservation.id == reservation_id)
        )
        .unique()
        .scalars()
        .first()
    )


def _load_reservation_for_update(reservation_id: uuid.UUID) -> Reservation | None:
    return (
        db.session.execute(
            sa.select(Reservation)
            .options(
                joinedload(Reservation.primary_guest),
                joinedload(Reservation.room_type),
                joinedload(Reservation.assigned_room),
                joinedload(Reservation.notes),
                joinedload(Reservation.status_history),
            )
            .where(Reservation.id == reservation_id)
            .with_for_update()
        )
        .unique()
        .scalars()
        .first()
    )


def _eligible_room_list(
    *,
    reservation: Reservation,
    room_type_id: uuid.UUID,
    check_in_date: date,
    check_out_date: date,
    include_current_reservation_rows: bool,
) -> list[Room]:
    rooms = (
        db.session.execute(
            sa.select(Room)
            .where(
                Room.room_type_id == room_type_id,
                Room.is_active.is_(True),
                Room.is_sellable.is_(True),
            )
            .order_by(Room.room_number.asc())
        )
        .scalars()
        .all()
    )
    eligible: list[Room] = []
    for room in rooms:
        if room_has_external_block(room.id, check_in_date, check_out_date, for_update=True):
            continue
        rows = _lock_inventory_rows(room.id, check_in_date, check_out_date)
        if len(rows) != (check_out_date - check_in_date).days:
            continue
        if all(
            (
                inventory_row_can_allocate(row)
                or (
                    include_current_reservation_rows
                    and row.reservation_id == reservation.id
                    and row.is_sellable
                    and not row.is_blocked
                    and not row.maintenance_flag
                    and row.availability_status in {"reserved", "occupied", "house_use"}
                )
            )
            for row in rows
        ):
            eligible.append(room)
    return eligible


def _find_eligible_room(
    *,
    reservation: Reservation,
    room_type_id: uuid.UUID,
    check_in_date: date,
    check_out_date: date,
    requested_room_id: uuid.UUID | None,
    include_current_reservation_rows: bool,
) -> Room:
    rooms = _eligible_room_list(
        reservation=reservation,
        room_type_id=room_type_id,
        check_in_date=check_in_date,
        check_out_date=check_out_date,
        include_current_reservation_rows=include_current_reservation_rows,
    )
    if requested_room_id:
        for room in rooms:
            if room.id == requested_room_id:
                return room
        raise ValueError("The requested room is not available for the requested stay.")
    if not rooms:
        raise ValueError("No eligible room is available for the requested change.")
    current_room = next((room for room in rooms if room.id == reservation.assigned_room_id), None)
    return current_room or rooms[0]


def _reservation_inventory_rows(reservation_id: uuid.UUID, start_date: date | None = None) -> list[InventoryDay]:
    query = sa.select(InventoryDay).where(InventoryDay.reservation_id == reservation_id)
    if start_date:
        query = query.where(InventoryDay.business_date >= start_date)
    return (
        db.session.execute(query.order_by(InventoryDay.business_date.asc()).with_for_update())
        .scalars()
        .all()
    )


def _lock_inventory_rows(room_id: uuid.UUID, check_in_date: date, check_out_date: date) -> list[InventoryDay]:
    return (
        db.session.execute(
            sa.select(InventoryDay)
            .where(
                InventoryDay.room_id == room_id,
                InventoryDay.business_date >= check_in_date,
                InventoryDay.business_date < check_out_date,
            )
            .order_by(InventoryDay.business_date.asc())
            .with_for_update()
        )
        .scalars()
        .all()
    )


def _allocate_inventory_range(
    *,
    reservation: Reservation,
    room: Room,
    nightly_rates: list[tuple[date, Decimal]],
    actor_user_id: uuid.UUID,
) -> None:
    if room_has_external_block(room.id, reservation.check_in_date, reservation.check_out_date, for_update=True):
        raise ValueError("Inventory could not be allocated because the room is blocked by an external calendar sync.")
    rate_lookup = {business_date: nightly_rate for business_date, nightly_rate in nightly_rates}
    rows = _lock_inventory_rows(room.id, reservation.check_in_date, reservation.check_out_date)
    if len(rows) != len(rate_lookup):
        raise ValueError("Inventory horizon is incomplete for the requested stay.")
    for row in rows:
        if not inventory_row_can_allocate(row):
            raise ValueError("Inventory could not be allocated without conflict.")
        row.availability_status = "occupied" if reservation.current_status == "checked_in" else "reserved"
        row.reservation_id = reservation.id
        row.nightly_rate = rate_lookup[row.business_date]
        row.updated_by_user_id = actor_user_id


def guest_snapshot(guest: Guest) -> dict:
    return {
        "first_name": guest.first_name,
        "last_name": guest.last_name,
        "full_name": guest.full_name,
        "phone": guest.phone,
        "email": guest.email,
        "nationality": guest.nationality,
        "id_document_type": guest.id_document_type,
        "id_document_number": guest.id_document_number,
        "preferred_language": guest.preferred_language,
        "notes_summary": guest.notes_summary,
    }


def list_modification_requests(reservation_id: uuid.UUID) -> list[dict]:
    """Return all modification requests for a reservation, newest first."""
    rows = (
        db.session.execute(
            sa.select(ModificationRequest)
            .where(ModificationRequest.reservation_id == reservation_id)
            .order_by(ModificationRequest.requested_at.desc())
        )
        .scalars()
        .all()
    )
    result = []
    for mr in rows:
        reviewer = db.session.get(User, mr.reviewed_by_user_id) if mr.reviewed_by_user_id else None
        changes = mr.requested_changes_json or {}
        result.append({
            "id": mr.id,
            "request_code": mr.request_code,
            "status": mr.status,
            "requested_at": mr.requested_at,
            "reviewed_at": mr.reviewed_at,
            "reviewed_by": reviewer.full_name if reviewer else None,
            "internal_note": mr.internal_note,
            "requester_contact_hint": mr.requester_contact_hint,
            "requested_check_in": changes.get("requested_check_in"),
            "requested_check_out": changes.get("requested_check_out"),
            "requested_adults": changes.get("requested_adults"),
            "requested_children": changes.get("requested_children"),
            "contact_correction": changes.get("contact_correction"),
            "special_requests": changes.get("special_requests"),
        })
    return result


def quote_modification_request(reservation_id: uuid.UUID, mod_request_id: uuid.UUID) -> dict:
    """Generate a price comparison for a pending modification request."""
    reservation = db.session.get(Reservation, reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    mr = db.session.get(ModificationRequest, mod_request_id)
    if not mr or mr.reservation_id != reservation_id:
        raise ValueError("Modification request not found.")
    changes = mr.requested_changes_json or {}
    new_check_in = _maybe_date(changes.get("requested_check_in", "")) or reservation.check_in_date
    new_check_out = _maybe_date(changes.get("requested_check_out", "")) or reservation.check_out_date
    new_adults = int(changes.get("requested_adults") or reservation.adults)
    new_children = int(changes.get("requested_children") or reservation.children)
    if new_check_in >= new_check_out:
        raise ValueError("Requested check-in must be before check-out.")
    quote = quote_reservation(
        room_type=reservation.room_type,
        check_in_date=new_check_in,
        check_out_date=new_check_out,
        adults=new_adults + reservation.extra_guests,
        children=new_children,
    )
    return {
        "current_total": reservation.quoted_grand_total,
        "new_total": quote.grand_total,
        "delta": quote.grand_total - reservation.quoted_grand_total,
        "new_check_in": new_check_in,
        "new_check_out": new_check_out,
        "new_adults": new_adults,
        "new_children": new_children,
    }


def approve_modification_request(
    reservation_id: uuid.UUID,
    mod_request_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID,
    internal_note: str = "",
) -> dict:
    """Approve a modification request: apply the requested changes and reprice."""
    mr = db.session.get(ModificationRequest, mod_request_id)
    if not mr or mr.reservation_id != reservation_id:
        raise ValueError("Modification request not found.")
    if mr.status not in ("submitted", "reviewed"):
        raise ValueError("This modification request has already been processed.")
    changes = mr.requested_changes_json or {}
    reservation = _load_reservation_for_update(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    new_check_in = _maybe_date(changes.get("requested_check_in", "")) or reservation.check_in_date
    new_check_out = _maybe_date(changes.get("requested_check_out", "")) or reservation.check_out_date
    new_adults = int(changes.get("requested_adults") or reservation.adults)
    new_children = int(changes.get("requested_children") or reservation.children)
    result = change_stay_dates(
        reservation_id,
        StayDateChangePayload(
            check_in_date=new_check_in,
            check_out_date=new_check_out,
            adults=new_adults,
            children=new_children,
            extra_guests=reservation.extra_guests,
        ),
        actor_user_id=actor_user_id,
    )
    mr.status = "approved"
    mr.reviewed_at = utc_now()
    mr.reviewed_by_user_id = actor_user_id
    mr.internal_note = internal_note or None
    db.session.commit()
    return result


def decline_modification_request(
    reservation_id: uuid.UUID,
    mod_request_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID,
    internal_note: str = "",
) -> ModificationRequest:
    """Decline a modification request without changing the reservation."""
    mr = db.session.get(ModificationRequest, mod_request_id)
    if not mr or mr.reservation_id != reservation_id:
        raise ValueError("Modification request not found.")
    if mr.status not in ("submitted", "reviewed"):
        raise ValueError("This modification request has already been processed.")
    mr.status = "declined"
    mr.reviewed_at = utc_now()
    mr.reviewed_by_user_id = actor_user_id
    mr.internal_note = internal_note or None
    db.session.commit()
    return mr


def phone_digits(value: str | None) -> str:
    return "".join(ch for ch in (value or "") if ch.isdigit())


def _actor_name(actor_user_id) -> str | None:
    if not actor_user_id:
        return None
    actor = db.session.get(User, actor_user_id)
    return actor.full_name if actor else str(actor_user_id)


def _normalized_phone_expression(column):
    return sa.func.replace(
        sa.func.replace(
            sa.func.replace(
                sa.func.replace(sa.func.replace(column, "+", ""), "-", ""),
                " ",
                "",
            ),
            "(",
            "",
        ),
        ")",
        "",
    )


def _maybe_date(value: str) -> date | None:
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Guest search — fuzzy matching by name, phone, email
# ---------------------------------------------------------------------------


def search_guests(q: str, *, limit: int = 50) -> list[dict]:
    """Search guests by name, phone, or email with fuzzy (LIKE) matching.

    Returns a list of guest dicts with their most recent reservation info.
    """
    q = q.strip()
    if not q:
        return []

    like = f"%{q.lower()}%"
    digits = phone_digits(q)

    conditions = [
        sa.func.lower(Guest.full_name).like(like),
        sa.func.lower(sa.func.coalesce(Guest.email, "")).like(like),
    ]
    if digits:
        conditions.append(_normalized_phone_expression(Guest.phone).like(f"%{digits}%"))

    guests = (
        db.session.execute(
            sa.select(Guest)
            .where(Guest.deleted_at.is_(None), sa.or_(*conditions))
            .order_by(Guest.updated_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )

    if not guests:
        return []

    # Batch-fetch most recent reservation per guest
    guest_ids = [g.id for g in guests]
    latest_res_subq = (
        sa.select(
            Reservation.primary_guest_id,
            sa.func.max(Reservation.created_at).label("latest"),
        )
        .where(Reservation.primary_guest_id.in_(guest_ids))
        .group_by(Reservation.primary_guest_id)
        .subquery()
    )
    latest_reservations = (
        db.session.execute(
            sa.select(Reservation)
            .join(
                latest_res_subq,
                sa.and_(
                    Reservation.primary_guest_id == latest_res_subq.c.primary_guest_id,
                    Reservation.created_at == latest_res_subq.c.latest,
                ),
            )
        )
        .scalars()
        .all()
    )
    res_by_guest = {r.primary_guest_id: r for r in latest_reservations}

    # Count total reservations per guest
    count_rows = db.session.execute(
        sa.select(
            Reservation.primary_guest_id,
            sa.func.count(),
        )
        .where(Reservation.primary_guest_id.in_(guest_ids))
        .group_by(Reservation.primary_guest_id)
    ).all()
    count_by_guest = dict(count_rows)

    results = []
    for guest in guests:
        latest_res = res_by_guest.get(guest.id)
        results.append({
            "id": guest.id,
            "full_name": guest.full_name,
            "phone": guest.phone,
            "email": guest.email,
            "nationality": guest.nationality,
            "blacklist_flag": guest.blacklist_flag,
            "reservation_count": count_by_guest.get(guest.id, 0),
            "latest_reservation_code": latest_res.reservation_code if latest_res else None,
            "latest_reservation_id": latest_res.id if latest_res else None,
            "latest_reservation_status": latest_res.current_status if latest_res else None,
            "latest_check_in": latest_res.check_in_date if latest_res else None,
            "latest_check_out": latest_res.check_out_date if latest_res else None,
        })
    return results


# ---------------------------------------------------------------------------
# Guest detail — visit history + profile
# ---------------------------------------------------------------------------


def get_guest_detail(guest_id: uuid.UUID) -> dict:
    """Load a guest profile with reservation history and stats."""
    guest = db.session.get(Guest, guest_id)
    if not guest or guest.deleted_at:
        raise ValueError("Guest not found.")

    reservations = (
        Reservation.query
        .filter_by(primary_guest_id=guest.id)
        .options(joinedload(Reservation.room_type), joinedload(Reservation.assigned_room))
        .order_by(Reservation.check_in_date.desc())
        .all()
    )

    completed = [r for r in reservations if r.current_status == "checked_out"]
    cancelled = [r for r in reservations if r.current_status == "cancelled"]
    no_shows = [r for r in reservations if r.current_status == "no_show"]

    total_nights = sum(
        (r.check_out_date - r.check_in_date).days
        for r in completed
    )
    total_revenue = sum(Decimal(str(r.quoted_grand_total or 0)) for r in completed)

    notes = (
        GuestNote.query
        .filter_by(guest_id=guest.id)
        .filter(GuestNote.deleted_at.is_(None))
        .order_by(GuestNote.created_at.desc())
        .all()
    )

    threads = (
        ConversationThread.query
        .filter_by(guest_id=guest.id)
        .order_by(ConversationThread.updated_at.desc())
        .limit(20)
        .all()
    )

    # Loyalty — may not exist yet if the migration hasn't run
    loyalty = None
    try:
        from .loyalty_service import get_loyalty_summary

        loyalty = get_loyalty_summary(guest.id)
    except Exception:  # noqa: BLE001
        pass

    return {
        "guest": guest,
        "reservations": reservations,
        "notes": notes,
        "threads": threads,
        "loyalty": loyalty,
        "stats": {
            "total_reservations": len(reservations),
            "completed_stays": len(completed),
            "cancelled": len(cancelled),
            "no_shows": len(no_shows),
            "total_nights": total_nights,
            "total_revenue": total_revenue,
            "first_stay": min((r.check_in_date for r in reservations), default=None),
            "last_stay": max((r.check_in_date for r in reservations), default=None),
        },
    }


# ---------------------------------------------------------------------------
# Guest profile merge / dedup
# ---------------------------------------------------------------------------


def merge_guest_profiles(
    primary_id: uuid.UUID,
    secondary_id: uuid.UUID,
    actor_user_id: uuid.UUID,
) -> Guest:
    """Merge *secondary* guest into *primary*, moving all linked records.

    After the merge the secondary guest is soft-deleted and all reservations,
    notes, conversation threads, and documents point to the primary guest.
    """
    if primary_id == secondary_id:
        raise ValueError("Cannot merge a guest with itself.")

    primary = db.session.get(Guest, primary_id)
    if not primary or primary.deleted_at:
        raise ValueError("Primary guest not found.")

    secondary = db.session.get(Guest, secondary_id)
    if not secondary or secondary.deleted_at:
        raise ValueError("Secondary guest not found.")

    # 1. Move reservations
    db.session.execute(
        sa.update(Reservation)
        .where(Reservation.primary_guest_id == secondary_id)
        .values(primary_guest_id=primary_id, updated_by_user_id=actor_user_id)
    )

    # 2. Move guest notes
    db.session.execute(
        sa.update(GuestNote)
        .where(GuestNote.guest_id == secondary_id)
        .values(guest_id=primary_id, updated_by_user_id=actor_user_id)
    )

    # 3. Move conversation threads
    db.session.execute(
        sa.update(ConversationThread)
        .where(ConversationThread.guest_id == secondary_id)
        .values(guest_id=primary_id)
    )

    # 4. Move reservation documents that reference the secondary guest
    db.session.execute(
        sa.update(ReservationDocument)
        .where(ReservationDocument.guest_id == secondary_id)
        .values(guest_id=primary_id)
    )

    # 5. Move loyalty record if it exists (only if primary does not already have one)
    try:
        from ..models import GuestLoyalty

        secondary_loyalty = db.session.execute(
            sa.select(GuestLoyalty).where(GuestLoyalty.guest_id == secondary_id)
        ).scalars().first()
        if secondary_loyalty:
            primary_loyalty = db.session.execute(
                sa.select(GuestLoyalty).where(GuestLoyalty.guest_id == primary_id)
            ).scalars().first()
            if primary_loyalty:
                # Merge points into primary, keep higher tier
                primary_loyalty.points += secondary_loyalty.points
                from .loyalty_service import recalculate_tier

                recalculate_tier(primary_loyalty)
                db.session.delete(secondary_loyalty)
            else:
                secondary_loyalty.guest_id = primary_id
    except Exception:  # noqa: BLE001
        # GuestLoyalty may not exist yet (migration pending)
        pass

    # 6. Soft-delete the secondary guest
    secondary.deleted_at = utc_now()
    secondary.deleted_by_user_id = actor_user_id

    # 7. Audit log
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="guests",
        entity_id=str(primary_id),
        action="guest.merged",
        before_data={"secondary_guest_id": str(secondary_id), "secondary_name": secondary.full_name},
        after_data={"primary_guest_id": str(primary_id), "primary_name": primary.full_name},
    )

    # 8. Activity log
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="guest.merged",
        entity_table="guests",
        entity_id=str(primary_id),
        metadata={
            "primary_guest_id": str(primary_id),
            "secondary_guest_id": str(secondary_id),
            "primary_name": primary.full_name,
            "secondary_name": secondary.full_name,
        },
    )

    # 9. Commit and return
    db.session.commit()
    return primary
