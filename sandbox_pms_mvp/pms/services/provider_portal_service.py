from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.orm import joinedload

from ..activity import write_activity_log
from ..extensions import db
from ..models import ActivityLog, Guest, PaymentEvent, PaymentRequest, Reservation, User
from .cashier_service import folio_summary
from .communication_service import query_notification_history
from .ical_service import overlapping_external_blocks, provider_calendar_context
from .payment_integration_service import (
    create_or_reuse_deposit_request,
    resend_payment_link,
    sync_payment_request_status,
)
from .reporting_service import arrivals_today_report, departures_today_report, occupancy_today_report
from .staff_reservations_service import build_reservation_summary, cancel_reservation_workspace, payment_summary


@dataclass(slots=True)
class ProviderBookingFilters:
    search: str = ""
    status: str = ""
    date_from: str = ""
    date_to: str = ""
    deposit_state: str = ""
    page: int = 1
    per_page: int = 20


def provider_dashboard_context(*, business_date: date) -> dict:
    upcoming_query = _base_booking_query().where(
        Reservation.current_status.in_(["tentative", "confirmed", "checked_in"]),
        Reservation.check_out_date >= business_date,
    )
    upcoming_reservations = (
        db.session.execute(
            upcoming_query.order_by(
                Reservation.check_in_date.asc(),
                Reservation.booked_at.asc(),
            ).limit(30)
        )
        .unique()
        .scalars()
        .all()
    )
    upcoming_rows = [_provider_booking_summary(item) for item in upcoming_reservations]

    pending_deposit_rows = [row for row in upcoming_rows if row["deposit_state"] in {"missing", "partial"}][:8]
    unpaid_rows = [row for row in upcoming_rows if row["remaining_balance"] > Decimal("0.00")][:8]
    calendar = provider_calendar_context()

    return {
        "business_date": business_date,
        "arrivals": arrivals_today_report(business_date),
        "departures": departures_today_report(business_date),
        "occupancy": occupancy_today_report(business_date),
        "upcoming_bookings": upcoming_rows[:10],
        "pending_deposit_count": len([row for row in upcoming_rows if row["deposit_state"] in {"missing", "partial"}]),
        "pending_deposit_bookings": pending_deposit_rows,
        "unpaid_count": len([row for row in upcoming_rows if row["remaining_balance"] > Decimal("0.00")]),
        "unpaid_bookings": unpaid_rows,
        "recent_activity": _recent_provider_activity(),
        "calendar": calendar,
        "calendar_error_count": sum(1 for item in calendar["sources"] if item["last_status"] == "failed"),
        "calendar_conflict_count": sum(item["conflict_count"] for item in calendar["sources"]),
    }


def list_provider_bookings(filters: ProviderBookingFilters) -> dict:
    filters.page = max(filters.page or 1, 1)
    filters.per_page = min(max(filters.per_page or 20, 1), 100)
    query = _base_booking_query()
    query = _apply_provider_search(query, (filters.search or "").strip().lower())
    if filters.status:
        query = query.where(Reservation.current_status == filters.status)
    date_from = _parse_date(filters.date_from)
    if date_from:
        query = query.where(Reservation.check_in_date >= date_from)
    date_to = _parse_date(filters.date_to)
    if date_to:
        query = query.where(Reservation.check_in_date <= date_to)

    rows = [
        _provider_booking_summary(item)
        for item in db.session.execute(
            query.order_by(Reservation.check_in_date.asc(), Reservation.booked_at.desc())
        )
        .unique()
        .scalars()
        .all()
    ]
    if filters.deposit_state:
        rows = [row for row in rows if row["deposit_state"] == filters.deposit_state]

    total = len(rows)
    start = (filters.page - 1) * filters.per_page
    page_items = rows[start : start + filters.per_page]
    return {
        "items": page_items,
        "total": total,
        "page": filters.page,
        "per_page": filters.per_page,
        "pages": max((total + filters.per_page - 1) // filters.per_page, 1),
    }


def get_provider_booking_detail(reservation_id: uuid.UUID) -> dict:
    reservation = _load_reservation(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    summary = _provider_booking_summary(reservation)
    latest_payment_request = (
        db.session.execute(
            sa.select(PaymentRequest)
            .where(PaymentRequest.reservation_id == reservation.id)
            .order_by(PaymentRequest.created_at.desc())
        )
        .scalars()
        .first()
    )
    payment_requests = (
        db.session.execute(
            sa.select(PaymentRequest)
            .where(PaymentRequest.reservation_id == reservation.id)
            .order_by(PaymentRequest.created_at.desc())
        )
        .scalars()
        .all()
    )
    payment_events = (
        db.session.execute(
            sa.select(PaymentEvent)
            .where(PaymentEvent.reservation_id == reservation.id)
            .order_by(PaymentEvent.created_at.desc())
            .limit(20)
        )
        .scalars()
        .all()
    )
    calendar_conflicts = []
    if reservation.assigned_room_id:
        calendar_conflicts = [
            {
                "summary": block.summary,
                "starts_on": block.starts_on,
                "ends_on": block.ends_on,
                "conflict_reason": block.conflict_reason,
                "last_seen_at": block.last_seen_at,
            }
            for block in overlapping_external_blocks(
                reservation.assigned_room_id,
                reservation.check_in_date,
                reservation.check_out_date,
            )
        ]
    return {
        "reservation": reservation,
        "summary": summary,
        "payment_summary": payment_summary(reservation),
        "folio_summary": folio_summary(reservation),
        "latest_payment_request": latest_payment_request,
        "payment_requests": payment_requests,
        "payment_events": payment_events,
        "communication_history": query_notification_history(
            reservation_id=reservation.id,
            audience_type="guest",
            limit=20,
        ),
        "calendar_conflicts": calendar_conflicts,
    }


def provider_create_deposit_request(reservation_id: uuid.UUID, *, actor_user_id: uuid.UUID) -> PaymentRequest:
    reservation = _load_reservation(reservation_id)
    if not reservation:
        raise ValueError("Reservation not found.")
    payment_request = create_or_reuse_deposit_request(
        reservation.id,
        actor_user_id=actor_user_id,
        send_email=True,
        language=reservation.booking_language,
        source="provider",
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="provider.deposit_request_created",
        entity_table="payment_requests",
        entity_id=str(payment_request.id),
        metadata={"reservation_id": str(reservation.id), "request_code": payment_request.request_code},
    )
    db.session.commit()
    return payment_request


def provider_resend_payment_link(
    payment_request_id: uuid.UUID,
    *,
    actor_user_id: uuid.UUID,
    force_new: bool = False,
) -> PaymentRequest:
    payment_request = resend_payment_link(payment_request_id, actor_user_id=actor_user_id, force_new=force_new)
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="provider.payment_link_resent",
        entity_table="payment_requests",
        entity_id=str(payment_request.id),
        metadata={"request_code": payment_request.request_code, "force_new": force_new},
    )
    db.session.commit()
    return payment_request


def provider_refresh_payment_status(payment_request_id: uuid.UUID, *, actor_user_id: uuid.UUID) -> PaymentRequest | None:
    payment_request = sync_payment_request_status(
        payment_request_id,
        actor_user_id=actor_user_id,
        swallow_errors=False,
    )
    if payment_request:
        write_activity_log(
            actor_user_id=actor_user_id,
            event_type="provider.payment_status_refreshed",
            entity_table="payment_requests",
            entity_id=str(payment_request.id),
            metadata={"request_code": payment_request.request_code, "status": payment_request.status},
        )
        db.session.commit()
    return payment_request


def provider_cancel_booking(reservation_id: uuid.UUID, *, actor_user_id: uuid.UUID, reason: str) -> Reservation:
    reservation = cancel_reservation_workspace(
        reservation_id,
        actor_user_id=actor_user_id,
        reason=(reason or "").strip() or "provider_cancelled",
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="provider.booking_cancelled",
        entity_table="reservations",
        entity_id=str(reservation.id),
        metadata={"reservation_code": reservation.reservation_code},
    )
    db.session.commit()
    return reservation


def _base_booking_query():
    return sa.select(Reservation).options(
        joinedload(Reservation.primary_guest),
        joinedload(Reservation.room_type),
        joinedload(Reservation.assigned_room),
    )


def _apply_provider_search(query, search: str):
    if not search:
        return query
    digits = "".join(ch for ch in search if ch.isdigit())
    predicate = [
        sa.func.lower(Reservation.reservation_code).like(f"{search}%"),
        sa.func.lower(Guest.full_name).like(f"%{search}%"),
        sa.func.lower(sa.func.coalesce(Guest.email, "")).like(f"%{search}%"),
    ]
    if digits:
        predicate.append(
            sa.func.replace(
                sa.func.replace(
                    sa.func.replace(sa.func.coalesce(Guest.phone, ""), "+", ""),
                    "-",
                    "",
                ),
                " ",
                "",
            ).like(f"%{digits}%")
        )
    return query.join(Guest, Reservation.primary_guest_id == Guest.id).where(sa.or_(*predicate))


def _load_reservation(reservation_id: uuid.UUID) -> Reservation | None:
    return (
        db.session.execute(
            sa.select(Reservation).options(
                joinedload(Reservation.primary_guest),
                joinedload(Reservation.room_type),
                joinedload(Reservation.assigned_room),
            )
            .where(Reservation.id == reservation_id)
        )
        .unique()
        .scalars()
        .first()
    )


def _provider_booking_summary(reservation: Reservation) -> dict:
    summary = build_reservation_summary(reservation)
    folio = folio_summary(reservation)
    latest_request = (
        db.session.execute(
            sa.select(PaymentRequest)
            .where(PaymentRequest.reservation_id == reservation.id)
            .order_by(PaymentRequest.created_at.desc())
        )
        .scalars()
        .first()
    )
    return {
        "id": summary["id"],
        "reservation_code": summary["reservation_code"],
        "guest_name": summary["guest_name"],
        "guest_phone": summary["guest_phone"],
        "guest_email": summary["guest_email"],
        "room_type_name": summary["room_type_name"],
        "room_type_code": summary["room_type_code"],
        "assigned_room_number": summary["assigned_room_number"],
        "arrival_date": summary["arrival_date"],
        "departure_date": summary["departure_date"],
        "nights": summary["nights"],
        "status": summary["status"],
        "deposit_state": summary["deposit_state"],
        "payment_state": summary["payment_state"],
        "deposit_required_amount": Decimal(str(summary["deposit_required_amount"])),
        "deposit_received_amount": Decimal(str(summary["deposit_received_amount"])),
        "balance_due": Decimal(str(summary["balance_due"])),
        "source_channel": summary["source_channel"],
        "special_requests_present": summary["special_requests_present"],
        "duplicate_suspected": summary["duplicate_suspected"],
        "booking_total": Decimal(str(reservation.quoted_grand_total)),
        "remaining_balance": Decimal(str(folio["balance_due"])),
        "settlement_state": folio["settlement_state"],
        "latest_payment_request_id": latest_request.id if latest_request else None,
        "latest_payment_request_status": latest_request.status if latest_request else None,
        "latest_payment_request_code": latest_request.request_code if latest_request else None,
        "latest_payment_reference": latest_request.provider_payment_reference if latest_request else None,
        "latest_payment_paid_at": latest_request.paid_at if latest_request else None,
    }


def _recent_provider_activity(limit: int = 15) -> list[dict]:
    rows = (
        db.session.execute(
            sa.select(ActivityLog).where(
                ActivityLog.event_type.in_(
                    [
                        "booking.public_confirmed",
                        "reservation.cancelled",
                        "payment.deposit_received",
                        "provider.deposit_request_created",
                        "provider.payment_link_resent",
                        "provider.booking_cancelled",
                        "calendar.sync_completed",
                        "calendar.sync_failed",
                        "calendar.feed_created",
                        "calendar.feed_rotated",
                    ]
                )
            )
            .order_by(ActivityLog.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    actor_ids = [item.actor_user_id for item in rows if item.actor_user_id]
    actors = (
        {
            item_id: full_name
            for item_id, full_name in db.session.execute(
                sa.select(User.id, User.full_name).where(User.id.in_(actor_ids))
            ).all()
        }
        if actor_ids
        else {}
    )
    return [
        {
            "created_at": row.created_at,
            "event_type": row.event_type,
            "entity_table": row.entity_table,
            "entity_id": row.entity_id,
            "actor_name": actors.get(row.actor_user_id, "System"),
            "metadata": row.metadata_json or {},
        }
        for row in rows
    ]


def _parse_date(value: str | None) -> date | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    return datetime.strptime(candidate, "%Y-%m-%d").date()
