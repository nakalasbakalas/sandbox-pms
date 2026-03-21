"""Reporting dashboard builders."""

from __future__ import annotations

from .reporting_base import *  # noqa: F401,F403
from .reporting_reports import (
    arrivals_today_report,
    audit_activity_summary_report,
    booking_attribution_report,
    cancellation_summary_report,
    channel_performance_report,
    checked_in_guests_report,
    confirmed_reservations_report,
    deposit_requested_vs_paid_report,
    departures_today_report,
    folio_balances_outstanding_report,
    housekeeping_performance_report,
    housekeeping_room_status_summary_report,
    no_show_summary_report,
    occupancy_by_date_range_report,
    occupancy_today_report,
    occupancy_year_over_year_report,
    pending_reservations_report,
    report_metric_definitions,
    revenue_management_report,
    revenue_summary_report,
    room_type_performance_report,
)

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
        dashboard["revenue_management"] = revenue_management_report(date_from, date_to)
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


