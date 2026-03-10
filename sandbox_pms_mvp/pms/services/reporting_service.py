from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.orm import aliased, joinedload

from ..extensions import db
from ..models import (
    AuditLog,
    CashierActivityLog,
    FolioCharge,
    InventoryDay,
    PaymentRequest,
    Reservation,
    ReservationStatusHistory,
    Room,
    RoomType,
    User,
)
from .cashier_service import folio_summary, money
from .front_desk_service import FrontDeskFilters, list_front_desk_arrivals, list_front_desk_departures, list_front_desk_in_house
from .housekeeping_service import HousekeepingBoardFilters, list_housekeeping_board
from .staff_reservations_service import build_reservation_summary


CONSUMING_INVENTORY_STATUSES = {"reserved", "occupied", "house_use"}
CLOSED_INVENTORY_STATUSES = {"out_of_service", "out_of_order"}
ACTIVE_REPORTABLE_RESERVATION_STATUSES = {"tentative", "confirmed", "checked_in", "checked_out"}
SOLD_RESERVATION_STATUSES = {"confirmed", "checked_in", "checked_out"}
ADMIN_AUDIT_ENTITIES = {
    "app_settings",
    "blackout_periods",
    "inventory_overrides",
    "notification_templates",
    "payment_requests",
    "policy_documents",
    "rate_rules",
    "roles",
    "room_types",
    "rooms",
    "users",
}
RESERVATION_AUDIT_ENTITIES = {"reservations", "reservation_status_history", "reservation_review_queue", "guests"}
CASHIER_AUDIT_ENTITIES = {"folio_charges", "cashier_documents", "payment_requests", "payment_events"}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def report_metric_definitions() -> dict[str, str]:
    return {
        "occupancy_today": (
            "Confirmed or in-house occupied room-nights for the business date divided by total saleable room inventory for that date. "
            "The denominator excludes default non-sellable rooms, blocked rooms, out-of-order rooms, and out-of-service rooms."
        ),
        "occupancy_range": (
            "Daily occupancy uses the same definition as Occupancy Today for every date in the selected range."
        ),
        "pending_reservations": (
            "Reservations currently in tentative status with arrival dates inside the selected reporting range."
        ),
        "confirmed_reservations": (
            "Reservations currently in confirmed status with arrival dates inside the selected reporting range."
        ),
        "checked_in_guests": (
            "Reservations currently in checked_in status whose stay is active on the selected business date."
        ),
        "folio_balances_outstanding": (
            "Reservations overlapping the selected reporting range whose authoritative folio balance due is greater than zero."
        ),
        "deposit_requested_vs_paid": (
            "Reservations arriving in the selected reporting range with a deposit requirement, using the latest deposit request "
            "status and authoritative deposit received totals from folio/payment posting."
        ),
        "revenue_summary": (
            "Posted folio activity by service date in the selected reporting range. This is posted room and operational charge "
            "revenue, not booked revenue or cash collected."
        ),
        "room_type_performance": (
            "Reservation count is based on confirmed or stayed reservations overlapping the selected reporting range. "
            "Sold nights come from consuming inventory ledger rows for confirmed or in-house stays, and room revenue "
            "comes from posted room charges in the same range."
        ),
        "cancellations": (
            "Cancellation count is based on reservation status history entries changed to cancelled inside the selected reporting range."
        ),
        "no_shows": (
            "No-show count is based on reservation status history entries changed to no_show inside the selected reporting range."
        ),
        "audit_activity": (
            "Audit activity summarizes authoritative audit log entries inside the selected reporting range, grouped for operational review."
        ),
    }


def build_manager_dashboard(
    *,
    business_date: date,
    date_from: date,
    date_to: date,
    include_housekeeping: bool = True,
    include_financials: bool = True,
    include_payments: bool = True,
    include_audit: bool = True,
) -> dict:
    dashboard = {
        "business_date": business_date,
        "date_from": date_from,
        "date_to": date_to,
        "definitions": report_metric_definitions(),
        "arrivals": arrivals_today_report(business_date),
        "departures": departures_today_report(business_date),
        "occupancy_today": occupancy_today_report(business_date),
        "occupancy_range": occupancy_by_date_range_report(date_from, date_to),
        "pending_reservations": pending_reservations_report(date_from, date_to),
        "confirmed_reservations": confirmed_reservations_report(date_from, date_to),
        "checked_in_guests": checked_in_guests_report(business_date),
        "room_type_performance": room_type_performance_report(date_from, date_to),
        "cancellation_summary": cancellation_summary_report(date_from, date_to),
        "no_show_summary": no_show_summary_report(date_from, date_to),
    }
    if include_housekeeping:
        dashboard["housekeeping"] = housekeeping_room_status_summary_report(business_date)
    if include_financials:
        dashboard["folio_balances"] = folio_balances_outstanding_report(date_from, date_to)
        dashboard["revenue_summary"] = revenue_summary_report(date_from, date_to)
    if include_payments:
        dashboard["deposit_pipeline"] = deposit_requested_vs_paid_report(date_from, date_to)
    if include_audit:
        dashboard["audit_activity"] = audit_activity_summary_report(date_from, date_to)
    dashboard["headline"] = _headline_metrics(dashboard)
    return dashboard


def arrivals_today_report(business_date: date) -> dict:
    items = list_front_desk_arrivals(business_date, filters=FrontDeskFilters(business_date=business_date, mode="arrivals"))
    return {
        "count": len(items),
        "unassigned_count": sum(1 for item in items if not item["assigned_room_number"]),
        "not_ready_count": sum(1 for item in items if not item["room_ready"]),
        "deposit_missing_count": sum(1 for item in items if item["payment_summary"]["deposit_state"] in {"missing", "partial"}),
        "flagged_count": sum(1 for item in items if item["flagged_issue"]),
        "items": items,
    }


def departures_today_report(business_date: date) -> dict:
    items = list_front_desk_departures(business_date, filters=FrontDeskFilters(business_date=business_date, mode="departures"))
    return {
        "count": len(items),
        "outstanding_balance_count": sum(1 for item in items if money(item["payment_summary"]["balance_due"]) > Decimal("0.00")),
        "pending_checkout_count": sum(1 for item in items if item["status"] != "checked_out"),
        "items": items,
    }


def checked_in_guests_report(business_date: date) -> dict:
    items = list_front_desk_in_house(business_date, filters=FrontDeskFilters(business_date=business_date, mode="in_house"))
    tomorrow = business_date + timedelta(days=1)
    return {
        "count": len(items),
        "due_out_today_count": sum(1 for item in items if item["departure_date"] == business_date),
        "due_out_tomorrow_count": sum(1 for item in items if item["departure_date"] == tomorrow),
        "balance_issue_count": sum(1 for item in items if money(item["payment_summary"]["balance_due"]) > Decimal("0.00")),
        "items": items,
    }


def occupancy_today_report(business_date: date) -> dict:
    row = _occupancy_rows(business_date, business_date)[0]
    return row


def occupancy_by_date_range_report(date_from: date, date_to: date) -> dict:
    rows = _occupancy_rows(date_from, date_to)
    average_occupancy = (
        sum((item["occupancy_percentage"] for item in rows), Decimal("0.00")) / Decimal(len(rows))
        if rows
        else Decimal("0.00")
    )
    peak = max(rows, key=lambda item: item["occupancy_percentage"], default=None)
    return {
        "count": len(rows),
        "average_occupancy_percentage": average_occupancy.quantize(Decimal("0.01")),
        "peak_date": peak["date"] if peak else None,
        "peak_occupancy_percentage": peak["occupancy_percentage"] if peak else Decimal("0.00"),
        "items": rows,
    }


def pending_reservations_report(date_from: date, date_to: date, *, limit: int = 10) -> dict:
    query = _reservation_listing_query().filter(
        Reservation.current_status == "tentative",
        Reservation.check_in_date >= date_from,
        Reservation.check_in_date <= date_to,
    )
    total = query.count()
    items = query.order_by(Reservation.check_in_date.asc(), Reservation.booked_at.asc()).limit(limit).all()
    rows = []
    now = utc_now()
    for item in items:
        summary = build_reservation_summary(item)
        age = now - _as_aware(item.booked_at)
        summary["pending_age_hours"] = int(age.total_seconds() // 3600)
        summary["pending_age_days"] = age.days
        rows.append(summary)
    return {
        "count": total,
        "older_than_48h_count": query.filter(Reservation.booked_at <= now - timedelta(hours=48)).count(),
        "items": rows,
    }


def confirmed_reservations_report(date_from: date, date_to: date, *, limit: int = 10) -> dict:
    query = _reservation_listing_query().filter(
        Reservation.current_status == "confirmed",
        Reservation.check_in_date >= date_from,
        Reservation.check_in_date <= date_to,
    )
    total = query.count()
    items = query.order_by(Reservation.check_in_date.asc(), Reservation.booked_at.asc()).limit(limit).all()
    rows = [build_reservation_summary(item) for item in items]
    return {
        "count": total,
        "public_booking_count": sum(1 for item in rows if item["created_from_public_booking_flow"]),
        "deposit_pending_count": sum(1 for item in rows if item["deposit_state"] in {"missing", "partial"}),
        "items": rows,
    }


def housekeeping_room_status_summary_report(business_date: date) -> dict:
    board = list_housekeeping_board(HousekeepingBoardFilters(business_date=business_date))
    items = board["items"]
    counts = dict(board["counts"])
    counts.update(
        {
            "urgent": sum(1 for item in items if item["priority"] == "urgent"),
            "high": sum(1 for item in items if item["priority"] == "high"),
            "sellable_ready": sum(
                1
                for item in items
                if item["operational_state"] == "sellable" and item["housekeeping_status_code"] in {"clean", "inspected"}
            ),
            "arrival_risk": sum(
                1
                for item in items
                if item["arrival_today"] and item["priority"] in {"urgent", "high"}
            ),
        }
    )
    return {
        "counts": counts,
        "priority_rooms": items[:10],
        "items": items,
    }


def folio_balances_outstanding_report(date_from: date, date_to: date, *, limit: int = 12) -> dict:
    candidates = _reservation_listing_query().filter(
        Reservation.current_status.in_(ACTIVE_REPORTABLE_RESERVATION_STATUSES),
        _reservation_overlaps_range(date_from, date_to),
    ).all()
    rows: list[dict] = []
    total_balance = Decimal("0.00")
    for reservation in candidates:
        payment = folio_summary(reservation)
        balance_due = money(payment["balance_due"])
        if balance_due <= Decimal("0.00"):
            continue
        summary = build_reservation_summary(reservation)
        summary["payment_summary"] = payment
        rows.append(summary)
        total_balance += balance_due
    rows.sort(
        key=lambda item: (
            0 if item["status"] == "checked_in" else 1,
            item["departure_date"],
            -money(item["balance_due"]),
        )
    )
    return {
        "count": len(rows),
        "total_balance_due": total_balance.quantize(Decimal("0.01")),
        "items": rows[:limit],
    }


def deposit_requested_vs_paid_report(date_from: date, date_to: date, *, limit: int = 12) -> dict:
    reservations = _reservation_listing_query().filter(
        Reservation.current_status.in_(["tentative", "confirmed", "checked_in"]),
        Reservation.check_in_date >= date_from,
        Reservation.check_in_date <= date_to,
        Reservation.deposit_required_amount > 0,
    ).all()
    rows: list[dict] = []
    total_requested = Decimal("0.00")
    total_paid = Decimal("0.00")
    pending_count = 0
    failed_count = 0
    expired_count = 0

    for reservation in reservations:
        deposit_required = money(reservation.deposit_required_amount)
        deposit_received = money(reservation.deposit_received_amount)
        latest_request = (
            PaymentRequest.query.filter(
                PaymentRequest.reservation_id == reservation.id,
                PaymentRequest.request_type.like("deposit%"),
            )
            .order_by(PaymentRequest.created_at.desc())
            .first()
        )
        if not latest_request and deposit_received <= Decimal("0.00"):
            continue
        total_requested += deposit_required
        total_paid += min(deposit_received, deposit_required)
        latest_status = latest_request.status if latest_request else "not_requested"
        if deposit_received < deposit_required:
            if latest_status == "failed":
                failed_count += 1
            elif latest_status == "expired":
                expired_count += 1
            else:
                pending_count += 1
        rows.append(
            {
                "reservation_id": reservation.id,
                "reservation_code": reservation.reservation_code,
                "guest_name": reservation.primary_guest.full_name if reservation.primary_guest else "Unknown guest",
                "arrival_date": reservation.check_in_date,
                "departure_date": reservation.check_out_date,
                "source_channel": reservation.source_channel,
                "status": reservation.current_status,
                "deposit_required_amount": deposit_required,
                "deposit_received_amount": deposit_received,
                "deposit_outstanding_amount": max(deposit_required - deposit_received, Decimal("0.00")).quantize(Decimal("0.01")),
                "latest_request_status": latest_status,
                "latest_request_code": latest_request.request_code if latest_request else None,
                "latest_request_amount": money(latest_request.amount) if latest_request else Decimal("0.00"),
                "latest_request_paid": bool(latest_request and latest_request.status == "paid"),
            }
        )

    rows.sort(
        key=lambda item: (
            0 if item["deposit_outstanding_amount"] > Decimal("0.00") else 1,
            item["arrival_date"],
            item["reservation_code"],
        )
    )
    return {
        "reservation_count": len(rows),
        "total_requested_amount": total_requested.quantize(Decimal("0.01")),
        "total_paid_amount": total_paid.quantize(Decimal("0.01")),
        "pending_count": pending_count,
        "failed_count": failed_count,
        "expired_count": expired_count,
        "items": rows[:limit],
    }


def revenue_summary_report(date_from: date, date_to: date) -> dict:
    lines = _folio_lines_in_range(date_from, date_to)
    room_total = sum((money(line.total_amount) for line in lines if line.charge_type == "room"), Decimal("0.00"))
    manual_charge_total = sum(
        (money(line.total_amount) for line in lines if line.charge_type in {"manual_charge", "fee"}),
        Decimal("0.00"),
    )
    discount_total = sum(
        (abs(money(line.total_amount)) for line in lines if line.charge_type == "manual_discount"),
        Decimal("0.00"),
    )
    correction_total = sum((money(line.total_amount) for line in lines if line.charge_type == "correction"), Decimal("0.00"))
    refund_total = sum((money(line.total_amount) for line in lines if line.charge_type == "refund"), Decimal("0.00"))
    net_revenue = (room_total + manual_charge_total + correction_total - discount_total - refund_total).quantize(Decimal("0.01"))
    return {
        "room_revenue_total": room_total.quantize(Decimal("0.01")),
        "manual_charge_total": manual_charge_total.quantize(Decimal("0.01")),
        "discount_total": discount_total.quantize(Decimal("0.01")),
        "correction_total": correction_total.quantize(Decimal("0.01")),
        "refund_total": refund_total.quantize(Decimal("0.01")),
        "net_revenue_total": net_revenue,
        "posted_line_count": len(lines),
    }


def room_type_performance_report(date_from: date, date_to: date) -> dict:
    room_types = RoomType.query.filter_by(is_active=True).order_by(RoomType.code.asc()).all()
    reservation_counts = {
        room_type_id: count
        for room_type_id, count in db.session.query(
            Reservation.room_type_id,
            sa.func.count(Reservation.id),
        )
        .filter(
            Reservation.current_status.in_(SOLD_RESERVATION_STATUSES),
            _reservation_overlaps_range(date_from, date_to),
        )
        .group_by(Reservation.room_type_id)
        .all()
    }
    sold_reservation = aliased(Reservation)
    sold_nights = {
        room_type_id: count
        for room_type_id, count in db.session.query(
            InventoryDay.room_type_id,
            sa.func.count(InventoryDay.id),
        )
        .join(Room, Room.id == InventoryDay.room_id)
        .outerjoin(sold_reservation, sold_reservation.id == InventoryDay.reservation_id)
        .filter(
            InventoryDay.business_date >= date_from,
            InventoryDay.business_date <= date_to,
            Room.is_active.is_(True),
            Room.is_sellable.is_(True),
            InventoryDay.availability_status.in_(tuple(CONSUMING_INVENTORY_STATUSES)),
            sa.or_(
                InventoryDay.availability_status == "house_use",
                sold_reservation.current_status.in_(tuple(SOLD_RESERVATION_STATUSES)),
            ),
        )
        .group_by(InventoryDay.room_type_id)
        .all()
    }
    room_revenue = {
        room_type_id: amount
        for room_type_id, amount in db.session.query(
            Reservation.room_type_id,
            sa.func.coalesce(sa.func.sum(FolioCharge.total_amount), 0),
        )
        .join(Reservation, Reservation.id == FolioCharge.reservation_id)
        .filter(
            FolioCharge.voided_at.is_(None),
            FolioCharge.charge_type == "room",
            FolioCharge.service_date >= date_from,
            FolioCharge.service_date <= date_to,
        )
        .group_by(Reservation.room_type_id)
        .all()
    }
    rows = []
    for room_type in room_types:
        rows.append(
            {
                "room_type_id": room_type.id,
                "room_type_code": room_type.code,
                "room_type_name": room_type.name,
                "reservation_count": int(reservation_counts.get(room_type.id, 0) or 0),
                "sold_nights": int(sold_nights.get(room_type.id, 0) or 0),
                "room_revenue_total": money(room_revenue.get(room_type.id, Decimal("0.00"))),
            }
        )
    return {"items": rows}


def cancellation_summary_report(date_from: date, date_to: date, *, limit: int = 12) -> dict:
    return _status_history_summary_report("cancelled", date_from, date_to, limit=limit)


def no_show_summary_report(date_from: date, date_to: date, *, limit: int = 12) -> dict:
    return _status_history_summary_report("no_show", date_from, date_to, limit=limit)


def audit_activity_summary_report(date_from: date, date_to: date, *, limit: int = 12) -> dict:
    start_dt = datetime.combine(date_from, datetime.min.time(), tzinfo=timezone.utc)
    end_dt = datetime.combine(date_to + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    base_query = AuditLog.query.filter(AuditLog.created_at >= start_dt, AuditLog.created_at < end_dt)
    total = base_query.count()
    actor_ids = [item[0] for item in base_query.with_entities(AuditLog.actor_user_id).distinct().all() if item[0]]
    actors = {
        user.id: user.full_name
        for user in User.query.filter(User.id.in_(actor_ids)).all()
    } if actor_ids else {}
    top_actions = [
        {"action": action, "count": count}
        for action, count in base_query.with_entities(AuditLog.action, sa.func.count(AuditLog.id))
        .group_by(AuditLog.action)
        .order_by(sa.func.count(AuditLog.id).desc(), AuditLog.action.asc())
        .limit(8)
        .all()
    ]
    recent_entries = (
        base_query.order_by(AuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    recent_rows = []
    for entry in recent_entries:
        recent_rows.append(
            {
                "id": entry.id,
                "actor_name": actors.get(entry.actor_user_id) or "System",
                "entity_table": entry.entity_table,
                "action": entry.action,
                "created_at": entry.created_at,
                "before_data": entry.before_data,
                "after_data": entry.after_data,
            }
        )
    admin_changes = base_query.filter(AuditLog.entity_table.in_(tuple(ADMIN_AUDIT_ENTITIES))).count()
    reservation_changes = base_query.filter(AuditLog.entity_table.in_(tuple(RESERVATION_AUDIT_ENTITIES))).count()
    cashier_payment_changes = base_query.filter(AuditLog.entity_table.in_(tuple(CASHIER_AUDIT_ENTITIES))).count()
    cashier_events = (
        CashierActivityLog.query.filter(CashierActivityLog.created_at >= start_dt, CashierActivityLog.created_at < end_dt)
        .count()
    )
    return {
        "count": total,
        "admin_changes_count": admin_changes,
        "reservation_changes_count": reservation_changes,
        "cashier_payment_changes_count": cashier_payment_changes,
        "cashier_activity_events_count": cashier_events,
        "top_actions": top_actions,
        "recent_entries": recent_rows,
    }


def _headline_metrics(dashboard: dict) -> list[dict]:
    cards = [
        {"label": "Arrivals Today", "value": dashboard["arrivals"]["count"], "tone": "default"},
        {"label": "Departures Today", "value": dashboard["departures"]["count"], "tone": "default"},
        {
            "label": "Occupancy Today",
            "value": f"{dashboard['occupancy_today']['occupancy_percentage']:.2f}%",
            "tone": "accent",
            "detail": f"{dashboard['occupancy_today']['occupied_rooms']} / {dashboard['occupancy_today']['saleable_rooms']} saleable rooms",
        },
        {"label": "Pending Reservations", "value": dashboard["pending_reservations"]["count"], "tone": "warning"},
        {"label": "Confirmed Reservations", "value": dashboard["confirmed_reservations"]["count"], "tone": "default"},
        {"label": "Checked-in Guests", "value": dashboard["checked_in_guests"]["count"], "tone": "default"},
    ]
    if "housekeeping" in dashboard:
        cards.append(
            {
                "label": "Arrival Rooms at Risk",
                "value": dashboard["housekeeping"]["counts"]["arrival_risk"],
                "tone": "warning",
            }
        )
    if "folio_balances" in dashboard:
        cards.append(
            {
                "label": "Outstanding Balance",
                "value": f"{dashboard['folio_balances']['total_balance_due']:,.2f}",
                "tone": "danger" if dashboard["folio_balances"]["count"] else "default",
                "detail": f"{dashboard['folio_balances']['count']} folio(s)",
            }
        )
    if "deposit_pipeline" in dashboard:
        cards.append(
            {
                "label": "Deposits Paid",
                "value": f"{dashboard['deposit_pipeline']['total_paid_amount']:,.2f}",
                "tone": "default",
                "detail": f"of {dashboard['deposit_pipeline']['total_requested_amount']:,.2f} requested",
            }
        )
    if "revenue_summary" in dashboard:
        cards.append(
            {
                "label": "Net Posted Revenue",
                "value": f"{dashboard['revenue_summary']['net_revenue_total']:,.2f}",
                "tone": "accent",
            }
        )
    if "audit_activity" in dashboard:
        cards.append(
            {
                "label": "Audit Actions",
                "value": dashboard["audit_activity"]["count"],
                "tone": "default",
            }
        )
    return cards


def _folio_lines_in_range(date_from: date, date_to: date) -> list[FolioCharge]:
    return (
        FolioCharge.query.filter(
            FolioCharge.voided_at.is_(None),
            FolioCharge.service_date >= date_from,
            FolioCharge.service_date <= date_to,
            FolioCharge.charge_type.in_(["room", "manual_charge", "manual_discount", "fee", "refund", "correction"]),
        )
        .order_by(FolioCharge.service_date.asc(), FolioCharge.posted_at.asc())
        .all()
    )


def _occupancy_rows(date_from: date, date_to: date) -> list[dict]:
    sold_reservation = aliased(Reservation)
    raw_rows = {
        business_date: {
            "saleable_rooms": int(saleable_rooms or 0),
            "occupied_rooms": int(occupied_rooms or 0),
        }
        for business_date, saleable_rooms, occupied_rooms in db.session.query(
            InventoryDay.business_date,
            sa.func.count(InventoryDay.id),
            sa.func.sum(
                sa.case(
                    (
                        sa.and_(
                            InventoryDay.availability_status.in_(tuple(CONSUMING_INVENTORY_STATUSES)),
                            sa.or_(
                                InventoryDay.availability_status == "house_use",
                                sold_reservation.current_status.in_(tuple(SOLD_RESERVATION_STATUSES)),
                            ),
                        ),
                        1,
                    ),
                    else_=0,
                )
            ),
        )
        .join(Room, Room.id == InventoryDay.room_id)
        .outerjoin(sold_reservation, sold_reservation.id == InventoryDay.reservation_id)
        .filter(
            InventoryDay.business_date >= date_from,
            InventoryDay.business_date <= date_to,
            Room.is_active.is_(True),
            Room.is_sellable.is_(True),
            InventoryDay.is_blocked.is_(False),
            InventoryDay.availability_status.notin_(tuple(CLOSED_INVENTORY_STATUSES)),
        )
        .group_by(InventoryDay.business_date)
        .order_by(InventoryDay.business_date.asc())
        .all()
    }
    rows = []
    current = date_from
    while current <= date_to:
        metrics = raw_rows.get(current, {"saleable_rooms": 0, "occupied_rooms": 0})
        saleable_rooms = metrics["saleable_rooms"]
        occupied_rooms = metrics["occupied_rooms"]
        occupancy_percentage = Decimal("0.00")
        if saleable_rooms:
            occupancy_percentage = (
                (Decimal(occupied_rooms) / Decimal(saleable_rooms)) * Decimal("100.00")
            ).quantize(Decimal("0.01"))
        rows.append(
            {
                "date": current,
                "saleable_rooms": saleable_rooms,
                "occupied_rooms": occupied_rooms,
                "occupancy_percentage": occupancy_percentage,
            }
        )
        current += timedelta(days=1)
    return rows


def _reservation_listing_query():
    return Reservation.query.options(
        joinedload(Reservation.primary_guest),
        joinedload(Reservation.room_type),
        joinedload(Reservation.assigned_room),
    )


def _reservation_overlaps_range(date_from: date, date_to: date):
    return sa.and_(
        Reservation.check_in_date < date_to + timedelta(days=1),
        Reservation.check_out_date > date_from,
    )


def _status_history_summary_report(status_code: str, date_from: date, date_to: date, *, limit: int) -> dict:
    start_dt = datetime.combine(date_from, datetime.min.time(), tzinfo=timezone.utc)
    end_dt = datetime.combine(date_to + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    query = (
        ReservationStatusHistory.query.options(
            joinedload(ReservationStatusHistory.reservation).joinedload(Reservation.primary_guest),
            joinedload(ReservationStatusHistory.reservation).joinedload(Reservation.room_type),
        )
        .filter(
            ReservationStatusHistory.new_status == status_code,
            ReservationStatusHistory.changed_at >= start_dt,
            ReservationStatusHistory.changed_at < end_dt,
        )
    )
    histories = query.order_by(ReservationStatusHistory.changed_at.desc()).all()
    total = len(histories)
    rows = []
    source_counts: dict[str, int] = {}
    room_type_counts: dict[str, int] = {}
    for item in histories:
        reservation = item.reservation
        source_counts[reservation.source_channel] = source_counts.get(reservation.source_channel, 0) + 1
        room_type_code = reservation.room_type.code if reservation.room_type else ""
        room_type_counts[room_type_code] = room_type_counts.get(room_type_code, 0) + 1
        if len(rows) >= limit:
            continue
        rows.append(
            {
                "reservation_id": reservation.id,
                "reservation_code": reservation.reservation_code,
                "guest_name": reservation.primary_guest.full_name if reservation.primary_guest else "Unknown guest",
                "arrival_date": reservation.check_in_date,
                "departure_date": reservation.check_out_date,
                "source_channel": reservation.source_channel,
                "room_type_code": room_type_code,
                "changed_at": item.changed_at,
                "reason": item.reason,
                "note": item.note,
                "deposit_received_amount": money(reservation.deposit_received_amount),
            }
        )
    return {
        "count": total,
        "source_counts": source_counts,
        "room_type_counts": room_type_counts,
        "items": rows,
    }


def _as_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
