from __future__ import annotations

from .staff_reservations_base import *  # noqa: F401,F403
from . import staff_reservations_base as _base

_actor_name = _base._actor_name
_apply_workspace_filters = _base._apply_workspace_filters
_eligible_room_list = _base._eligible_room_list
_load_reservation = _base._load_reservation
_maybe_date = _base._maybe_date
_normalized_phone_expression = _base._normalized_phone_expression
_reservation_workspace_query = _base._reservation_workspace_query
phone_digits = _base.phone_digits


def list_reservations(filters: ReservationWorkspaceFilters) -> dict:
    filters.page = max(filters.page or 1, 1)
    filters.per_page = min(max(filters.per_page or 25, 1), 100)

    query = _apply_workspace_filters(_reservation_workspace_query(), filters)
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

    sort_cols = {
        "arrival": Reservation.check_in_date,
        "departure": Reservation.check_out_date,
        "status": Reservation.current_status,
        "reference": Reservation.reservation_code,
    }
    if filters.sort in sort_cols:
        col = sort_cols[filters.sort]
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
        "items": [build_reservation_summary(item) for item in items],
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
    query = _apply_workspace_filters(_reservation_workspace_query(), filters).where(
        Reservation.current_status.in_(["tentative", "confirmed", "checked_in"])
    )
    items = (
        db.session.execute(query.order_by(Reservation.check_in_date.asc(), Reservation.booked_at.asc()))
        .unique()
        .scalars()
        .all()
    )
    return [build_reservation_summary(item) for item in items]


def list_departures(*, departure_date: date, room_type_id: str = "", payment_state: str = "") -> list[dict]:
    filters = ReservationWorkspaceFilters(
        departure_date=departure_date.isoformat(),
        room_type_id=room_type_id,
        payment_state=payment_state,
        include_closed=True,
        per_page=200,
    )
    query = _apply_workspace_filters(_reservation_workspace_query(), filters).where(
        Reservation.current_status.in_(["checked_in", "checked_out"])
    )
    items = (
        db.session.execute(query.order_by(Reservation.check_out_date.asc(), Reservation.booked_at.asc()))
        .unique()
        .scalars()
        .all()
    )
    return [build_reservation_summary(item) for item in items]


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
    return [build_reservation_summary(item) for item in items]


def get_reservation_detail(reservation_id: uuid.UUID, *, actor_user: User | None = None) -> dict:
    reservation = _load_reservation(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    detail = build_reservation_summary(reservation)
    detail["reservation"] = reservation
    detail["visible_notes"] = [
        note for note in reservation.notes if note.visibility_scope in allowed_note_visibility_scopes(actor_user)
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
    ).scalar_one()
    detail["modification_requests"] = list_modification_requests(reservation.id)
    detail["pending_modification_requests"] = sum(
        1 for mr in detail["modification_requests"] if mr["status"] in ("submitted", "reviewed")
    )
    detail["communication_history"] = query_notification_history(reservation_id=reservation.id, limit=40)
    detail["room_types"] = (
        db.session.execute(
            sa.select(RoomType).where(RoomType.is_active.is_(True)).order_by(RoomType.code.asc())
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


def build_reservation_summary(reservation: Reservation) -> dict:
    payment = payment_summary(reservation)
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
        (money(item.amount) for item in paid_requests if "deposit" in (item.request_type or "")),
        Decimal("0.00"),
    )
    legacy_payment_total = sum(
        (money(item.amount) for item in paid_requests if "deposit" not in (item.request_type or "")),
        Decimal("0.00"),
    )
    deposit_received = summary["deposit_received_amount"] or legacy_deposit_total
    payment_total = summary["payment_total"] or legacy_payment_total

    posted_room_total = sum((money(line.total_amount) for line in lines if line.charge_type == "room"), Decimal("0.00"))
    posted_extra_total = sum(
        (
            money(line.total_amount)
            for line in lines
            if line.charge_code == "XTR" or (line.metadata_json or {}).get("source") == "booking_extra"
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
    notes = [
        {
            "kind": "note",
            "created_at": note.created_at,
            "label": note.note_type.replace("_", " ").title(),
            "text": note.note_text,
            "important": note.is_important,
            "actor": _actor_name(note.created_by_user_id),
        }
        for note in reservation.notes
    ]
    history = [
        {
            "kind": "status",
            "created_at": item.changed_at,
            "label": f"{item.old_status or 'new'} -> {item.new_status}",
            "text": item.note or item.reason or "",
            "important": item.new_status in {"cancelled", "no_show"},
            "actor": _actor_name(item.changed_by_user_id),
        }
        for item in reservation.status_history
    ]
    audits = [
        {
            "kind": "audit",
            "created_at": item.created_at,
            "label": item.action.replace("_", " "),
            "text": item.entity_table,
            "important": False,
            "actor": _actor_name(item.actor_user_id),
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
    activities = [
        {
            "kind": "activity",
            "created_at": item.created_at,
            "label": item.event_type.replace(".", " "),
            "text": item.metadata_json.get("reservation_code", "") if item.metadata_json else "",
            "important": False,
            "actor": _actor_name(item.actor_user_id),
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
    timeline = sorted(notes + history + audits + activities, key=lambda item: item["created_at"], reverse=True)
    return timeline[:40]


def list_modification_requests(reservation_id: uuid.UUID) -> list[dict]:
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
        result.append(
            {
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
            }
        )
    return result


def quote_modification_request(reservation_id: uuid.UUID, mod_request_id: uuid.UUID) -> dict:
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


def search_guests(q: str, *, limit: int = 50) -> list[dict]:
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
            sa.select(Reservation).join(
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
        results.append(
            {
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
            }
        )
    return results


def get_guest_detail(guest_id: uuid.UUID) -> dict:
    guest = db.session.get(Guest, guest_id)
    if not guest or guest.deleted_at:
        raise ValueError("Guest not found.")

    reservations = (
        db.session.execute(
            sa.select(Reservation)
            .where(Reservation.primary_guest_id == guest.id)
            .options(joinedload(Reservation.room_type), joinedload(Reservation.assigned_room))
            .order_by(Reservation.check_in_date.desc())
        )
        .scalars()
        .all()
    )
    completed = [r for r in reservations if r.current_status == "checked_out"]
    cancelled = [r for r in reservations if r.current_status == "cancelled"]
    no_shows = [r for r in reservations if r.current_status == "no_show"]

    total_nights = sum((r.check_out_date - r.check_in_date).days for r in completed)
    total_revenue = sum(Decimal(str(r.quoted_grand_total or 0)) for r in completed)

    notes = (
        db.session.execute(
            sa.select(GuestNote)
            .where(
                GuestNote.guest_id == guest.id,
                GuestNote.deleted_at.is_(None),
            )
            .order_by(GuestNote.created_at.desc())
        )
        .scalars()
        .all()
    )
    threads = (
        db.session.execute(
            sa.select(ConversationThread)
            .where(ConversationThread.guest_id == guest.id)
            .order_by(ConversationThread.updated_at.desc())
            .limit(20)
        )
        .scalars()
        .all()
    )
    return {
        "guest": guest,
        "reservations": reservations,
        "notes": notes,
        "threads": threads,
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
