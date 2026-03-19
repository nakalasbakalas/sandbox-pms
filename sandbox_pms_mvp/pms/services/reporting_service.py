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
    HousekeepingTask,
    InventoryDay,
    PaymentRequest,
    Reservation,
    ReservationStatusHistory,
    Room,
    RoomType,
    User,
    utc_now,
)
from ..pricing import money
from .cashier_service import folio_summary
from .front_desk_service import FrontDeskFilters, list_front_desk_arrivals, list_front_desk_departures, list_front_desk_in_house
from .housekeeping_service import HousekeepingBoardFilters, list_housekeeping_board
from .staff_reservations_service import build_reservation_summary, reservation_attribution_summary


CONSUMING_INVENTORY_STATUSES = {"reserved", "occupied", "house_use"}
CLOSED_INVENTORY_STATUSES = {"out_of_service", "out_of_order"}
ACTIVE_REPORTABLE_RESERVATION_STATUSES = {"tentative", "confirmed", "checked_in", "checked_out"}
SOLD_RESERVATION_STATUSES = {"confirmed", "checked_in", "checked_out"}
ACTIVE_HOUSEKEEPING_TASK_STATUSES = {"open", "assigned", "in_progress"}
COMPLETED_HOUSEKEEPING_TASK_STATUSES = {"completed", "inspected"}
HOUSEKEEPING_REPORT_TASK_TYPES = (
    "checkout_clean",
    "daily_service",
    "rush_clean",
    "deep_clean",
    "inspection",
    "turndown",
)
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


def report_metric_definitions() -> dict[str, str]:
    return {
        "occupancy_today": (
            "Confirmed or in-house occupied room-nights for the business date divided by total saleable room inventory for that date. "
            "The denominator excludes default non-sellable rooms, blocked rooms, out-of-order rooms, and out-of-service rooms."
        ),
        "occupancy_range": (
            "Daily occupancy uses the same definition as Occupancy Today for every date in the selected range."
        ),
        "occupancy_year_over_year": (
            "Compares the selected occupancy window with the same calendar dates one year earlier, using authoritative "
            "inventory-day occupancy where historical inventory exists."
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
        "housekeeping_performance": (
            "Housekeeping performance groups tasks by assigned attendant and task business date, with raw start and "
            "completion timestamps preserved because the schema does not yet store explicit roster shift codes."
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
        "booking_attribution": (
            "Booking attribution summarizes first-touch source metadata captured during the public booking flow. "
            "Counts use reservations booked inside the selected reporting range."
        ),
        "channel_performance": (
            "Channel performance groups reservations by source channel using arrivals inside the selected reporting range. "
            "Cancellation rate uses the same arrival cohort, while ADR uses posted room revenue divided by sold nights "
            "inside the range."
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
        "occupancy_year_over_year": occupancy_year_over_year_report(date_from, date_to),
        "pending_reservations": pending_reservations_report(date_from, date_to),
        "confirmed_reservations": confirmed_reservations_report(date_from, date_to),
        "checked_in_guests": checked_in_guests_report(business_date),
        "channel_performance": channel_performance_report(date_from, date_to),
        "room_type_performance": room_type_performance_report(date_from, date_to),
        "cancellation_summary": cancellation_summary_report(date_from, date_to),
        "no_show_summary": no_show_summary_report(date_from, date_to),
        "booking_attribution": booking_attribution_report(date_from, date_to),
        "housekeeping_performance": housekeeping_performance_report(date_from, date_to, limit=8),
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


def build_front_desk_dashboard(
    *,
    business_date: date,
    include_housekeeping: bool = True,
    include_financials: bool = True,
) -> dict:
    """Compact operational dashboard for front-desk daily planning.

    Reuses the same authoritative metric functions as the manager dashboard
    but selects only the data a front-desk agent needs for shift preparation.
    """
    arrivals = arrivals_today_report(business_date)
    departures = departures_today_report(business_date)
    in_house = checked_in_guests_report(business_date)
    occupancy = occupancy_today_report(business_date)

    dashboard: dict = {
        "business_date": business_date,
        "arrivals": arrivals,
        "departures": departures,
        "in_house": in_house,
        "occupancy_today": occupancy,
    }

    if include_housekeeping:
        hk = housekeeping_room_status_summary_report(business_date)
        dashboard["housekeeping"] = hk
        dashboard["urgent_tasks"] = _urgent_tasks_summary(business_date)

    if include_financials:
        balances = folio_balances_outstanding_report(
            business_date, business_date, limit=10,
        )
        dashboard["balances_due"] = balances

    dashboard["headline"] = _front_desk_headline(dashboard)
    return dashboard


def _urgent_tasks_summary(business_date: date) -> dict:
    """Open or in-progress housekeeping tasks with urgent or high priority."""
    query = (
        sa.select(HousekeepingTask)
        .where(
            HousekeepingTask.status.in_(["open", "assigned", "in_progress"]),
            HousekeepingTask.priority.in_(["urgent", "high"]),
            HousekeepingTask.business_date == business_date,
        )
        .order_by(
            sa.case({"urgent": 0, "high": 1}, value=HousekeepingTask.priority, else_=2),
            HousekeepingTask.due_at.asc().nullslast(),
        )
    )
    tasks = db.session.execute(query).scalars().all()
    items = []
    for task in tasks[:10]:
        room = db.session.get(Room, task.room_id) if task.room_id else None
        items.append({
            "id": task.id,
            "room_number": room.room_number if room else "-",
            "room_id": task.room_id,
            "task_type": task.task_type,
            "priority": task.priority,
            "status": task.status,
            "due_at": task.due_at,
        })
    return {
        "count": len(tasks),
        "items": items,
    }


def _front_desk_headline(dashboard: dict) -> list[dict]:
    cards = [
        {"label": "Arrivals", "value": dashboard["arrivals"]["count"], "tone": "default"},
        {"label": "Departures", "value": dashboard["departures"]["count"], "tone": "default"},
        {"label": "In-house", "value": dashboard["in_house"]["count"], "tone": "default"},
        {
            "label": "Occupancy",
            "value": f"{dashboard['occupancy_today']['occupancy_percentage']:.0f}%",
            "tone": "accent",
        },
    ]
    if "housekeeping" in dashboard:
        counts = dashboard["housekeeping"]["counts"]
        ready = counts.get("sellable_ready", 0)
        dirty = counts.get("dirty", 0)
        cards.append({"label": "Rooms ready", "value": ready, "tone": "default"})
        cards.append({"label": "Rooms dirty", "value": dirty, "tone": "warning" if dirty else "default"})
    if "balances_due" in dashboard:
        cards.append({
            "label": "Balance due",
            "value": f"{dashboard['balances_due']['total_balance_due']:,.0f}",
            "tone": "danger" if dashboard["balances_due"]["count"] else "default",
        })
    if "urgent_tasks" in dashboard:
        cards.append({
            "label": "Urgent tasks",
            "value": dashboard["urgent_tasks"]["count"],
            "tone": "danger" if dashboard["urgent_tasks"]["count"] else "default",
        })
    return cards


def build_daily_report(
    *,
    report_type: str,
    business_date: date,
    date_from: date,
    date_to: date,
) -> dict:
    """Build a single focused daily report by type.

    Supports: arrivals, departures, room_status, payment_due,
    occupancy, booking_source, channel_performance, no_show_cancellation.
    """
    report: dict = {
        "report_type": report_type,
        "business_date": business_date,
        "date_from": date_from,
        "date_to": date_to,
        "definitions": report_metric_definitions(),
    }
    if report_type == "arrivals":
        report["data"] = arrivals_today_report(business_date)
    elif report_type == "departures":
        report["data"] = departures_today_report(business_date)
    elif report_type == "room_status":
        report["data"] = housekeeping_room_status_summary_report(business_date)
    elif report_type == "payment_due":
        report["data"] = folio_balances_outstanding_report(date_from, date_to, limit=50)
    elif report_type == "housekeeping_performance":
        report["data"] = housekeeping_performance_report(date_from, date_to, limit=50)
    elif report_type == "occupancy":
        report["data"] = occupancy_by_date_range_report(date_from, date_to)
        report["data"]["today"] = occupancy_today_report(business_date)
        report["data"]["year_over_year"] = occupancy_year_over_year_report(date_from, date_to)
    elif report_type == "booking_source":
        report["data"] = booking_attribution_report(date_from, date_to, limit=50)
    elif report_type == "channel_performance":
        report["data"] = channel_performance_report(date_from, date_to, limit=50)
    elif report_type == "no_show_cancellation":
        report["data"] = {
            "cancellations": cancellation_summary_report(date_from, date_to, limit=50),
            "no_shows": no_show_summary_report(date_from, date_to, limit=50),
        }
    else:
        report["data"] = {}
    return report


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


def occupancy_year_over_year_report(date_from: date, date_to: date) -> dict:
    previous_from = _shift_year_safe(date_from, years=-1)
    previous_to = _shift_year_safe(date_to, years=-1)
    current = occupancy_by_date_range_report(date_from, date_to)
    previous = occupancy_by_date_range_report(previous_from, previous_to)
    previous_by_date = {row["date"]: row for row in previous["items"]}

    comparison_rows: list[dict] = []
    previous_rows: list[dict] = []
    for current_row in current["items"]:
        previous_date = _shift_year_safe(current_row["date"], years=-1)
        previous_row = previous_by_date.get(previous_date)
        previous_has_data = bool(previous_row and previous_row["saleable_rooms"] > 0)
        previous_occupancy = previous_row["occupancy_percentage"] if previous_has_data else None
        if previous_has_data:
            previous_rows.append(previous_row)
        delta = (
            (current_row["occupancy_percentage"] - previous_occupancy).quantize(Decimal("0.01"))
            if previous_occupancy is not None
            else None
        )
        comparison_rows.append(
            {
                "current_date": current_row["date"],
                "current_occupied_rooms": current_row["occupied_rooms"],
                "current_saleable_rooms": current_row["saleable_rooms"],
                "current_occupancy_percentage": current_row["occupancy_percentage"],
                "previous_date": previous_date,
                "previous_occupied_rooms": previous_row["occupied_rooms"] if previous_has_data else None,
                "previous_saleable_rooms": previous_row["saleable_rooms"] if previous_has_data else None,
                "previous_occupancy_percentage": previous_occupancy,
                "delta_percentage_points": delta,
            }
        )

    average_previous = (
        (
            sum((row["occupancy_percentage"] for row in previous_rows), Decimal("0.00"))
            / Decimal(len(previous_rows))
        ).quantize(Decimal("0.01"))
        if previous_rows
        else None
    )
    peak_previous = (
        max(previous_rows, key=lambda item: item["occupancy_percentage"])
        if previous_rows
        else None
    )
    average_delta = (
        (current["average_occupancy_percentage"] - average_previous).quantize(Decimal("0.01"))
        if average_previous is not None
        else None
    )
    return {
        "current_date_from": date_from,
        "current_date_to": date_to,
        "previous_date_from": previous_from,
        "previous_date_to": previous_to,
        "has_previous_data": bool(previous_rows),
        "current_average_occupancy_percentage": current["average_occupancy_percentage"],
        "previous_average_occupancy_percentage": average_previous,
        "average_delta_percentage_points": average_delta,
        "previous_peak_date": peak_previous["date"] if peak_previous else None,
        "previous_peak_occupancy_percentage": peak_previous["occupancy_percentage"] if peak_previous else None,
        "items": comparison_rows,
    }


def pending_reservations_report(date_from: date, date_to: date, *, limit: int = 10) -> dict:
    query = _reservation_listing_query().where(
        Reservation.current_status == "tentative",
        Reservation.check_in_date >= date_from,
        Reservation.check_in_date <= date_to,
    )
    total = db.session.execute(
        sa.select(sa.func.count()).select_from(query.order_by(None).subquery())
    ).scalar_one()
    items = (
        db.session.execute(query.order_by(Reservation.check_in_date.asc(), Reservation.booked_at.asc()).limit(limit))
        .unique()
        .scalars()
        .all()
    )
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
        "older_than_48h_count": db.session.execute(
            sa.select(sa.func.count()).select_from(
                query.where(Reservation.booked_at <= now - timedelta(hours=48)).order_by(None).subquery()
            )
        ).scalar_one(),
        "items": rows,
    }


def confirmed_reservations_report(date_from: date, date_to: date, *, limit: int = 10) -> dict:
    query = _reservation_listing_query().where(
        Reservation.current_status == "confirmed",
        Reservation.check_in_date >= date_from,
        Reservation.check_in_date <= date_to,
    )
    total = db.session.execute(
        sa.select(sa.func.count()).select_from(query.order_by(None).subquery())
    ).scalar_one()
    items = (
        db.session.execute(query.order_by(Reservation.check_in_date.asc(), Reservation.booked_at.asc()).limit(limit))
        .unique()
        .scalars()
        .all()
    )
    rows = [build_reservation_summary(item) for item in items]
    return {
        "count": total,
        "public_booking_count": sum(1 for item in rows if item["created_from_public_booking_flow"]),
        "deposit_pending_count": sum(1 for item in rows if item["deposit_state"] in {"missing", "partial"}),
        "items": rows,
    }


def booking_attribution_report(date_from: date, date_to: date, *, limit: int = 10) -> dict:
    start_dt = datetime.combine(date_from, datetime.min.time(), tzinfo=timezone.utc)
    end_dt = datetime.combine(date_to + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    reservations = (
        db.session.execute(
            _reservation_listing_query().where(
            Reservation.created_from_public_booking_flow.is_(True),
            Reservation.booked_at >= start_dt,
            Reservation.booked_at < end_dt,
        )
            .order_by(Reservation.booked_at.desc())
        )
        .unique()
        .scalars()
        .all()
    )

    source_counts: dict[str, int] = {}
    campaign_counts: dict[str, int] = {}
    rows: list[dict] = []
    campaign_tagged_count = 0
    direct_or_unknown_count = 0

    for reservation in reservations:
        attribution = reservation_attribution_summary(reservation)
        source_label = str(attribution["source_label"] or "direct")
        source_counts[source_label] = source_counts.get(source_label, 0) + 1
        if attribution["utm_campaign"]:
            campaign = str(attribution["utm_campaign"])
            campaign_counts[campaign] = campaign_counts.get(campaign, 0) + 1
            campaign_tagged_count += 1
        else:
            direct_or_unknown_count += 1
        if len(rows) >= limit:
            continue
        rows.append(
            {
                "reservation_id": reservation.id,
                "reservation_code": reservation.reservation_code,
                "booked_at": reservation.booked_at,
                "guest_name": reservation.primary_guest.full_name if reservation.primary_guest else "Unknown guest",
                "source_channel": reservation.source_channel,
                "source_label": source_label,
                "utm_campaign": attribution["utm_campaign"],
                "utm_medium": attribution["utm_medium"],
                "entry_page": attribution["entry_page"],
                "entry_cta_source": attribution["entry_cta_source"],
            }
        )

    top_sources = [
        {"label": label, "count": count}
        for label, count in sorted(source_counts.items(), key=lambda item: (-item[1], item[0]))[:5]
    ]
    top_campaigns = [
        {"label": label, "count": count}
        for label, count in sorted(campaign_counts.items(), key=lambda item: (-item[1], item[0]))[:5]
    ]
    return {
        "count": len(reservations),
        "campaign_tagged_count": campaign_tagged_count,
        "direct_or_unknown_count": direct_or_unknown_count,
        "top_source_label": top_sources[0]["label"] if top_sources else None,
        "top_sources": top_sources,
        "top_campaigns": top_campaigns,
        "items": rows,
    }


def channel_performance_report(date_from: date, date_to: date, *, limit: int = 12) -> dict:
    base_counts = db.session.execute(
        sa.select(
            Reservation.source_channel,
            sa.func.count(Reservation.id),
            sa.func.sum(sa.case((Reservation.current_status == "cancelled", 1), else_=0)),
            sa.func.sum(sa.case((Reservation.current_status == "no_show", 1), else_=0)),
        )
        .where(
            Reservation.check_in_date >= date_from,
            Reservation.check_in_date <= date_to,
        )
        .group_by(Reservation.source_channel)
    ).all()
    rows_by_channel: dict[str, dict] = {}
    for source_channel, reservation_count, cancelled_count, no_show_count in base_counts:
        channel = str(source_channel or "unknown")
        rows_by_channel[channel] = {
            "source_channel": channel,
            "source_label": channel.replace("_", " "),
            "reservation_count": int(reservation_count or 0),
            "cancelled_count": int(cancelled_count or 0),
            "no_show_count": int(no_show_count or 0),
            "sold_nights": 0,
            "room_revenue_total": Decimal("0.00"),
        }

    sold_nights = db.session.execute(
        sa.select(
            Reservation.source_channel,
            sa.func.count(InventoryDay.id),
        )
        .join(Reservation, Reservation.id == InventoryDay.reservation_id)
        .join(Room, Room.id == InventoryDay.room_id)
        .where(
            InventoryDay.business_date >= date_from,
            InventoryDay.business_date <= date_to,
            Room.is_active.is_(True),
            Room.is_sellable.is_(True),
            InventoryDay.availability_status.in_(tuple(CONSUMING_INVENTORY_STATUSES)),
            Reservation.current_status.in_(tuple(SOLD_RESERVATION_STATUSES)),
        )
        .group_by(Reservation.source_channel)
    ).all()
    for source_channel, count in sold_nights:
        channel = str(source_channel or "unknown")
        row = rows_by_channel.setdefault(
            channel,
            {
                "source_channel": channel,
                "source_label": channel.replace("_", " "),
                "reservation_count": 0,
                "cancelled_count": 0,
                "no_show_count": 0,
                "sold_nights": 0,
                "room_revenue_total": Decimal("0.00"),
            },
        )
        row["sold_nights"] = int(count or 0)

    room_revenue = db.session.execute(
        sa.select(
            Reservation.source_channel,
            sa.func.coalesce(sa.func.sum(FolioCharge.total_amount), 0),
        )
        .join(Reservation, Reservation.id == FolioCharge.reservation_id)
        .where(
            FolioCharge.voided_at.is_(None),
            FolioCharge.charge_type == "room",
            FolioCharge.service_date >= date_from,
            FolioCharge.service_date <= date_to,
        )
        .group_by(Reservation.source_channel)
    ).all()
    for source_channel, amount in room_revenue:
        channel = str(source_channel or "unknown")
        row = rows_by_channel.setdefault(
            channel,
            {
                "source_channel": channel,
                "source_label": channel.replace("_", " "),
                "reservation_count": 0,
                "cancelled_count": 0,
                "no_show_count": 0,
                "sold_nights": 0,
                "room_revenue_total": Decimal("0.00"),
            },
        )
        row["room_revenue_total"] = money(amount or Decimal("0.00"))

    rows: list[dict] = []
    total_reservations = 0
    total_cancelled = 0
    total_no_shows = 0
    total_sold_nights = 0
    total_room_revenue = Decimal("0.00")
    for row in rows_by_channel.values():
        reservation_count = row["reservation_count"]
        cancelled_count = row["cancelled_count"]
        sold_nights_count = row["sold_nights"]
        revenue_total = money(row["room_revenue_total"])
        cancellation_rate = (
            ((Decimal(cancelled_count) / Decimal(reservation_count)) * Decimal("100.00")).quantize(Decimal("0.01"))
            if reservation_count
            else Decimal("0.00")
        )
        adr = (
            (revenue_total / Decimal(sold_nights_count)).quantize(Decimal("0.01"))
            if sold_nights_count
            else Decimal("0.00")
        )
        row["room_revenue_total"] = revenue_total
        row["cancellation_rate_percentage"] = cancellation_rate
        row["adr"] = adr
        rows.append(row)
        total_reservations += reservation_count
        total_cancelled += cancelled_count
        total_no_shows += row["no_show_count"]
        total_sold_nights += sold_nights_count
        total_room_revenue += revenue_total

    rows.sort(
        key=lambda item: (
            -item["reservation_count"],
            -item["room_revenue_total"],
            item["source_channel"],
        )
    )
    overall_adr = (
        (total_room_revenue / Decimal(total_sold_nights)).quantize(Decimal("0.01"))
        if total_sold_nights
        else Decimal("0.00")
    )
    overall_cancellation_rate = (
        ((Decimal(total_cancelled) / Decimal(total_reservations)) * Decimal("100.00")).quantize(Decimal("0.01"))
        if total_reservations
        else Decimal("0.00")
    )
    return {
        "channel_count": len(rows),
        "reservation_count": total_reservations,
        "cancelled_count": total_cancelled,
        "no_show_count": total_no_shows,
        "sold_nights": total_sold_nights,
        "room_revenue_total": total_room_revenue.quantize(Decimal("0.01")),
        "overall_adr": overall_adr,
        "overall_cancellation_rate_percentage": overall_cancellation_rate,
        "top_channel": rows[0]["source_channel"] if rows else None,
        "items": rows[:limit],
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


def housekeeping_performance_report(date_from: date, date_to: date, *, limit: int = 12) -> dict:
    tasks = (
        db.session.execute(
            sa.select(HousekeepingTask)
            .options(
                joinedload(HousekeepingTask.assigned_to_user),
                joinedload(HousekeepingTask.room),
            )
            .where(
                HousekeepingTask.business_date >= date_from,
                HousekeepingTask.business_date <= date_to,
            )
            .order_by(
                HousekeepingTask.business_date.asc(),
                HousekeepingTask.created_at.asc(),
            )
        )
        .unique()
        .scalars()
        .all()
    )

    grouped_rows: dict[tuple[date, str | None], dict] = {}
    total_completed = 0
    total_inspected = 0
    total_unassigned = 0
    duration_total = Decimal("0.00")
    duration_samples = 0
    attendant_ids: set[str] = set()

    for task in tasks:
        attendant_id = str(task.assigned_to_user_id) if task.assigned_to_user_id else None
        if attendant_id:
            attendant_ids.add(attendant_id)
        else:
            total_unassigned += 1
        key = (task.business_date, attendant_id)
        row = grouped_rows.setdefault(
            key,
            {
                "business_date": task.business_date,
                "attendant_name": task.assigned_to_user.full_name if task.assigned_to_user else "Unassigned",
                "attendant_email": task.assigned_to_user.email if task.assigned_to_user else None,
                "task_count": 0,
                "completed_count": 0,
                "inspected_count": 0,
                "cancelled_count": 0,
                "active_count": 0,
                "room_ids": set(),
                "duration_total_minutes": Decimal("0.00"),
                "duration_samples": 0,
                "first_started_at": None,
                "last_completed_at": None,
                "task_type_counts": {task_type: 0 for task_type in HOUSEKEEPING_REPORT_TASK_TYPES},
            },
        )
        row["task_count"] += 1
        if task.room_id:
            row["room_ids"].add(str(task.room_id))
        if task.task_type in row["task_type_counts"]:
            row["task_type_counts"][task.task_type] += 1
        if task.status in ACTIVE_HOUSEKEEPING_TASK_STATUSES:
            row["active_count"] += 1
        if task.status in COMPLETED_HOUSEKEEPING_TASK_STATUSES:
            row["completed_count"] += 1
            total_completed += 1
        if task.status == "inspected":
            row["inspected_count"] += 1
            total_inspected += 1
        if task.status == "cancelled":
            row["cancelled_count"] += 1
        if task.started_at and (row["first_started_at"] is None or task.started_at < row["first_started_at"]):
            row["first_started_at"] = task.started_at
        completion_point = task.completed_at or task.verified_at
        if completion_point and (row["last_completed_at"] is None or completion_point > row["last_completed_at"]):
            row["last_completed_at"] = completion_point
        if task.started_at and task.completed_at:
            duration_minutes = Decimal(
                max(int((_as_aware(task.completed_at) - _as_aware(task.started_at)).total_seconds() // 60), 0)
            )
            row["duration_total_minutes"] += duration_minutes
            row["duration_samples"] += 1
            duration_total += duration_minutes
            duration_samples += 1

    rows: list[dict] = []
    for row in grouped_rows.values():
        task_count = row["task_count"]
        average_completion_minutes = (
            (row["duration_total_minutes"] / Decimal(row["duration_samples"])).quantize(Decimal("0.01"))
            if row["duration_samples"]
            else None
        )
        completion_rate = (
            (Decimal(row["completed_count"]) / Decimal(task_count) * Decimal("100.00")).quantize(Decimal("0.01"))
            if task_count
            else Decimal("0.00")
        )
        rows.append(
            {
                "business_date": row["business_date"],
                "attendant_name": row["attendant_name"],
                "attendant_email": row["attendant_email"],
                "task_count": task_count,
                "completed_count": row["completed_count"],
                "inspected_count": row["inspected_count"],
                "cancelled_count": row["cancelled_count"],
                "active_count": row["active_count"],
                "room_count": len(row["room_ids"]),
                "completion_rate_percentage": completion_rate,
                "average_completion_minutes": average_completion_minutes,
                "first_started_at": row["first_started_at"],
                "last_completed_at": row["last_completed_at"],
                "checkout_clean_count": row["task_type_counts"]["checkout_clean"],
                "daily_service_count": row["task_type_counts"]["daily_service"],
                "rush_clean_count": row["task_type_counts"]["rush_clean"],
                "deep_clean_count": row["task_type_counts"]["deep_clean"],
                "inspection_count": row["task_type_counts"]["inspection"],
                "turndown_count": row["task_type_counts"]["turndown"],
            }
        )

    rows.sort(
        key=lambda item: (
            item["business_date"],
            -item["completed_count"],
            item["attendant_name"],
        )
    )
    average_duration = (
        (duration_total / Decimal(duration_samples)).quantize(Decimal("0.01"))
        if duration_samples
        else None
    )
    return {
        "attendant_count": len(attendant_ids),
        "row_count": len(rows),
        "task_count": len(tasks),
        "completed_count": total_completed,
        "inspected_count": total_inspected,
        "unassigned_task_count": total_unassigned,
        "average_completion_minutes": average_duration,
        "has_explicit_shifts": False,
        "items": rows[:limit],
    }


def folio_balances_outstanding_report(date_from: date, date_to: date, *, limit: int = 12) -> dict:
    candidates = (
        db.session.execute(
            _reservation_listing_query().where(
                Reservation.current_status.in_(ACTIVE_REPORTABLE_RESERVATION_STATUSES),
                _reservation_overlaps_range(date_from, date_to),
            )
        )
        .unique()
        .scalars()
        .all()
    )
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
    reservations = (
        db.session.execute(
            _reservation_listing_query().where(
                Reservation.current_status.in_(["tentative", "confirmed", "checked_in"]),
                Reservation.check_in_date >= date_from,
                Reservation.check_in_date <= date_to,
                Reservation.deposit_required_amount > 0,
            )
        )
        .unique()
        .scalars()
        .all()
    )
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
            db.session.execute(
                sa.select(PaymentRequest)
                .where(
                    PaymentRequest.reservation_id == reservation.id,
                    PaymentRequest.request_type.like("deposit%"),
                )
                .order_by(PaymentRequest.created_at.desc())
            )
            .scalars()
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
    room_types = (
        db.session.execute(
            sa.select(RoomType).where(RoomType.is_active.is_(True)).order_by(RoomType.code.asc())
        )
        .scalars()
        .all()
    )
    reservation_counts = {
        room_type_id: count
        for room_type_id, count in db.session.execute(
            sa.select(
                Reservation.room_type_id,
                sa.func.count(Reservation.id),
            )
            .where(
                Reservation.current_status.in_(SOLD_RESERVATION_STATUSES),
                _reservation_overlaps_range(date_from, date_to),
            )
            .group_by(Reservation.room_type_id)
        ).all()
    }
    sold_reservation = aliased(Reservation)
    sold_nights = {
        room_type_id: count
        for room_type_id, count in db.session.execute(
            sa.select(
                InventoryDay.room_type_id,
                sa.func.count(InventoryDay.id),
            )
            .join(Room, Room.id == InventoryDay.room_id)
            .outerjoin(sold_reservation, sold_reservation.id == InventoryDay.reservation_id)
            .where(
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
        ).all()
    }
    room_revenue = {
        room_type_id: amount
        for room_type_id, amount in db.session.execute(
            sa.select(
                Reservation.room_type_id,
                sa.func.coalesce(sa.func.sum(FolioCharge.total_amount), 0),
            )
            .join(Reservation, Reservation.id == FolioCharge.reservation_id)
            .where(
                FolioCharge.voided_at.is_(None),
                FolioCharge.charge_type == "room",
                FolioCharge.service_date >= date_from,
                FolioCharge.service_date <= date_to,
            )
            .group_by(Reservation.room_type_id)
        ).all()
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
    base_query = sa.select(AuditLog).where(AuditLog.created_at >= start_dt, AuditLog.created_at < end_dt)
    total = db.session.execute(
        sa.select(sa.func.count()).select_from(base_query.subquery())
    ).scalar_one()
    actor_ids = [
        item
        for item in db.session.execute(
            sa.select(AuditLog.actor_user_id)
            .where(AuditLog.created_at >= start_dt, AuditLog.created_at < end_dt)
            .distinct()
        ).scalars().all()
        if item
    ]
    actors = {
        user_id: full_name
        for user_id, full_name in db.session.execute(
            sa.select(User.id, User.full_name).where(User.id.in_(actor_ids))
        ).all()
    } if actor_ids else {}
    top_actions = [
        {"action": action, "count": count}
        for action, count in db.session.execute(
            sa.select(AuditLog.action, sa.func.count(AuditLog.id))
            .where(AuditLog.created_at >= start_dt, AuditLog.created_at < end_dt)
            .group_by(AuditLog.action)
            .order_by(sa.func.count(AuditLog.id).desc(), AuditLog.action.asc())
            .limit(8)
        ).all()
    ]
    recent_entries = (
        db.session.execute(base_query.order_by(AuditLog.created_at.desc()).limit(limit))
        .unique()
        .scalars()
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
    admin_changes = db.session.execute(
        sa.select(sa.func.count())
        .select_from(AuditLog)
        .where(
            AuditLog.created_at >= start_dt,
            AuditLog.created_at < end_dt,
            AuditLog.entity_table.in_(tuple(ADMIN_AUDIT_ENTITIES)),
        )
    ).scalar_one()
    reservation_changes = db.session.execute(
        sa.select(sa.func.count())
        .select_from(AuditLog)
        .where(
            AuditLog.created_at >= start_dt,
            AuditLog.created_at < end_dt,
            AuditLog.entity_table.in_(tuple(RESERVATION_AUDIT_ENTITIES)),
        )
    ).scalar_one()
    cashier_payment_changes = db.session.execute(
        sa.select(sa.func.count())
        .select_from(AuditLog)
        .where(
            AuditLog.created_at >= start_dt,
            AuditLog.created_at < end_dt,
            AuditLog.entity_table.in_(tuple(CASHIER_AUDIT_ENTITIES)),
        )
    ).scalar_one()
    cashier_events = (
        db.session.execute(
            sa.select(sa.func.count())
            .select_from(CashierActivityLog)
            .where(CashierActivityLog.created_at >= start_dt, CashierActivityLog.created_at < end_dt)
        )
        .scalar_one()
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
        db.session.execute(
            sa.select(FolioCharge)
            .where(
                FolioCharge.voided_at.is_(None),
                FolioCharge.service_date >= date_from,
                FolioCharge.service_date <= date_to,
                FolioCharge.charge_type.in_(["room", "manual_charge", "manual_discount", "fee", "refund", "correction"]),
            )
            .order_by(FolioCharge.service_date.asc(), FolioCharge.posted_at.asc())
        )
        .scalars()
        .all()
    )


def _occupancy_rows(date_from: date, date_to: date) -> list[dict]:
    sold_reservation = aliased(Reservation)
    raw_rows = {
        business_date: {
            "saleable_rooms": int(saleable_rooms or 0),
            "occupied_rooms": int(occupied_rooms or 0),
        }
        for business_date, saleable_rooms, occupied_rooms in db.session.execute(
            sa.select(
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
            .where(
                InventoryDay.business_date >= date_from,
                InventoryDay.business_date <= date_to,
                Room.is_active.is_(True),
                Room.is_sellable.is_(True),
                InventoryDay.is_blocked.is_(False),
                InventoryDay.availability_status.notin_(tuple(CLOSED_INVENTORY_STATUSES)),
            )
            .group_by(InventoryDay.business_date)
            .order_by(InventoryDay.business_date.asc())
        ).all()
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
    return sa.select(Reservation).options(
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
        sa.select(ReservationStatusHistory).options(
            joinedload(ReservationStatusHistory.reservation).joinedload(Reservation.primary_guest),
            joinedload(ReservationStatusHistory.reservation).joinedload(Reservation.room_type),
        )
        .where(
            ReservationStatusHistory.new_status == status_code,
            ReservationStatusHistory.changed_at >= start_dt,
            ReservationStatusHistory.changed_at < end_dt,
        )
    )
    histories = (
        db.session.execute(query.order_by(ReservationStatusHistory.changed_at.desc()))
        .unique()
        .scalars()
        .all()
    )
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


def _shift_year_safe(day: date, *, years: int) -> date:
    try:
        return day.replace(year=day.year + years)
    except ValueError:
        # Feb 29 falls back to Feb 28 in non-leap years.
        return day.replace(month=2, day=28, year=day.year + years)


# ---------------------------------------------------------------------------
# CSV export helpers
# ---------------------------------------------------------------------------

CSV_COLUMN_MAPS: dict[str, list[tuple[str, str]]] = {
    "arrivals": [
        ("reservation_code", "Reservation"),
        ("guest_name", "Guest"),
        ("assigned_room_number", "Room"),
        ("room_type_code", "Room Type"),
        ("status", "Status"),
        ("adults", "Adults"),
        ("children", "Children"),
        ("arrival_date", "Arrival"),
        ("departure_date", "Departure"),
        ("nights", "Nights"),
    ],
    "departures": [
        ("reservation_code", "Reservation"),
        ("guest_name", "Guest"),
        ("assigned_room_number", "Room"),
        ("room_type_code", "Room Type"),
        ("status", "Status"),
        ("arrival_date", "Arrival"),
        ("departure_date", "Departure"),
    ],
    "room_status": [
        ("room_number", "Room"),
        ("room_type_code", "Type"),
        ("housekeeping_status_code", "HK Status"),
        ("operational_state", "Operational"),
        ("priority", "Priority"),
        ("priority_label", "Priority Reason"),
        ("arrival_today", "Arrival Today"),
        ("departure_today", "Departure Today"),
    ],
    "payment_due": [
        ("reservation_code", "Reservation"),
        ("guest_name", "Guest"),
        ("status", "Status"),
        ("arrival_date", "Arrival"),
        ("departure_date", "Departure"),
        ("quoted_grand_total", "Grand Total"),
        ("balance_due", "Balance Due"),
    ],
    "housekeeping_performance": [
        ("business_date", "Business Date"),
        ("attendant_name", "Attendant"),
        ("attendant_email", "Email"),
        ("task_count", "Tasks"),
        ("completed_count", "Completed"),
        ("inspected_count", "Inspected"),
        ("active_count", "Active"),
        ("cancelled_count", "Cancelled"),
        ("room_count", "Rooms"),
        ("completion_rate_percentage", "Completion Rate %"),
        ("average_completion_minutes", "Avg Completion Minutes"),
        ("first_started_at", "First Started At"),
        ("last_completed_at", "Last Completed At"),
        ("checkout_clean_count", "Checkout Clean"),
        ("daily_service_count", "Daily Service"),
        ("rush_clean_count", "Rush Clean"),
        ("deep_clean_count", "Deep Clean"),
        ("inspection_count", "Inspection"),
        ("turndown_count", "Turndown"),
    ],
    "occupancy": [
        ("date", "Date"),
        ("saleable_rooms", "Saleable Rooms"),
        ("occupied_rooms", "Occupied Rooms"),
        ("occupancy_percentage", "Occupancy %"),
    ],
    "channel_performance": [
        ("source_channel", "Channel"),
        ("source_label", "Label"),
        ("reservation_count", "Reservations"),
        ("cancelled_count", "Cancelled"),
        ("no_show_count", "No-show"),
        ("cancellation_rate_percentage", "Cancellation Rate %"),
        ("sold_nights", "Sold Nights"),
        ("adr", "ADR"),
        ("room_revenue_total", "Room Revenue"),
    ],
    "booking_source": [
        ("reservation_code", "Reservation"),
        ("guest_name", "Guest"),
        ("booked_at", "Booked"),
        ("source_channel", "Channel"),
        ("source_label", "Source"),
        ("utm_campaign", "Campaign"),
        ("utm_medium", "Medium"),
        ("entry_page", "Entry Page"),
        ("entry_cta_source", "CTA Source"),
    ],
    "no_show_cancellation": [
        ("reservation_code", "Reservation"),
        ("guest_name", "Guest"),
        ("arrival_date", "Arrival"),
        ("departure_date", "Departure"),
        ("source_channel", "Channel"),
        ("room_type_code", "Room Type"),
        ("changed_at", "Date"),
        ("reason", "Reason"),
        ("type", "Type"),
    ],
}


def build_csv_rows(report_type: str, business_date: date, date_from: date, date_to: date) -> tuple[list[str], list[list[str]]]:
    """Return (headers, rows) for CSV export of a daily report.

    Items are returned without the dashboard-level limits so the full
    dataset is exported.
    """
    if report_type == "arrivals":
        data = arrivals_today_report(business_date)
    elif report_type == "departures":
        data = departures_today_report(business_date)
    elif report_type == "room_status":
        data = housekeeping_room_status_summary_report(business_date)
    elif report_type == "payment_due":
        data = folio_balances_outstanding_report(date_from, date_to, limit=5000)
    elif report_type == "housekeeping_performance":
        data = housekeeping_performance_report(date_from, date_to, limit=5000)
    elif report_type == "occupancy":
        data = occupancy_by_date_range_report(date_from, date_to)
    elif report_type == "channel_performance":
        data = channel_performance_report(date_from, date_to, limit=5000)
    elif report_type == "booking_source":
        data = booking_attribution_report(date_from, date_to, limit=5000)
    elif report_type == "no_show_cancellation":
        cancellation_data = cancellation_summary_report(date_from, date_to, limit=5000)
        no_show_data = no_show_summary_report(date_from, date_to, limit=5000)
        items = [dict(row, type="Cancellation") for row in cancellation_data.get("items", [])]
        items += [dict(row, type="No-show") for row in no_show_data.get("items", [])]
        data = {"items": items}
    else:
        return [], []

    col_map = CSV_COLUMN_MAPS.get(report_type, [])
    headers = [label for _, label in col_map]
    keys = [key for key, _ in col_map]
    items = data.get("items", [])

    rows: list[list[str]] = []
    for item in items:
        row = []
        for key in keys:
            val = item.get(key, "")
            if isinstance(val, (date, datetime)):
                val = val.isoformat() if val else ""
            elif isinstance(val, Decimal):
                val = str(val)
            elif isinstance(val, bool):
                val = "Yes" if val else "No"
            elif val is None:
                val = ""
            else:
                val = str(val)
            row.append(val)
        rows.append(row)
    return headers, rows
