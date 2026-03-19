"""Reports blueprint — staff reports, daily reports, CSV exports, and audit log."""

from __future__ import annotations

import csv
import io
from datetime import date

import sqlalchemy as sa
from flask import Blueprint, Response, abort, render_template, request

from ..extensions import db
from ..helpers import (
    format_report_date_range,
    parse_optional_date,
    parse_optional_uuid,
    parse_request_date_arg,
    report_date_presets,
    require_permission,
    resolve_report_date_range,
)
from ..models import AuditLog, User
from ..services.admin_service import query_audit_entries, summarize_audit_entry
from ..services.reporting_service import build_csv_rows, build_daily_report, build_manager_dashboard

reports_bp = Blueprint("reports", __name__)

DAILY_REPORT_TYPES = {
    "arrivals": ("reservation.view", "Arrivals Report"),
    "departures": ("reservation.view", "Departures Report"),
    "room_status": ("housekeeping.view", "Room Status Report"),
    "payment_due": ("folio.view", "Payment Due Report"),
    "housekeeping_performance": ("reports.view", "Housekeeping Performance Report"),
    "occupancy": ("reports.view", "Occupancy Report"),
    "channel_performance": ("reports.view", "Channel Performance Report"),
    "booking_source": ("reports.view", "Booking Source Report"),
    "no_show_cancellation": ("reports.view", "No-show & Cancellation Report"),
}


@reports_bp.route("/staff/reports")
def staff_reports():
    user = require_permission("reports.view")
    preset, date_from, date_to = resolve_report_date_range(
        preset=(request.args.get("preset") or "next_7_days").strip(),
        requested_start=parse_optional_date(request.args.get("date_from")),
        requested_end=parse_optional_date(request.args.get("date_to")),
    )
    dashboard = build_manager_dashboard(
        business_date=date.today(),
        date_from=date_from,
        date_to=date_to,
        include_housekeeping=user.has_permission("housekeeping.view"),
        include_financials=user.has_permission("folio.view"),
        include_payments=user.has_permission("payment.read"),
        include_audit=user.has_permission("audit.view"),
    )
    return render_template(
        "staff_reports.html",
        dashboard=dashboard,
        filters={
            "preset": preset,
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
        },
        report_presets=report_date_presets(),
        report_range_label=format_report_date_range(date_from, date_to),
        can_reservation=user.has_permission("reservation.view"),
        can_folio=user.has_permission("folio.view"),
        can_payments=user.has_permission("payment.read"),
        can_housekeeping=user.has_permission("housekeeping.view"),
        can_audit=user.has_permission("audit.view"),
    )


@reports_bp.route("/staff/daily-reports/<report_type>")
def staff_daily_report(report_type):
    if report_type not in DAILY_REPORT_TYPES:
        abort(404)
    permission_code, report_title = DAILY_REPORT_TYPES[report_type]
    user = require_permission(permission_code)
    target_date = parse_request_date_arg("date", default=date.today())
    preset, date_from, date_to = resolve_report_date_range(
        preset=(request.args.get("preset") or "next_7_days").strip(),
        requested_start=parse_optional_date(request.args.get("date_from")),
        requested_end=parse_optional_date(request.args.get("date_to")),
    )
    report = build_daily_report(
        report_type=report_type,
        business_date=target_date,
        date_from=date_from,
        date_to=date_to,
    )
    return render_template(
        "staff_daily_report.html",
        report=report,
        report_type=report_type,
        report_title=report_title,
        target_date=target_date,
        filters={
            "preset": preset,
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
        },
        report_presets=report_date_presets(),
        report_range_label=format_report_date_range(date_from, date_to),
        can_reservation=user.has_permission("reservation.view"),
        can_folio=user.has_permission("folio.view"),
        can_housekeeping=user.has_permission("housekeeping.view"),
    )


@reports_bp.route("/staff/daily-reports/<report_type>/csv")
def staff_daily_report_csv(report_type):
    if report_type not in DAILY_REPORT_TYPES:
        abort(404)
    permission_code, report_title = DAILY_REPORT_TYPES[report_type]
    require_permission(permission_code)
    target_date = parse_request_date_arg("date", default=date.today())
    preset, date_from, date_to = resolve_report_date_range(
        preset=(request.args.get("preset") or "next_7_days").strip(),
        requested_start=parse_optional_date(request.args.get("date_from")),
        requested_end=parse_optional_date(request.args.get("date_to")),
    )
    headers, rows = build_csv_rows(report_type, target_date, date_from, date_to)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows(rows)
    filename = f"{report_type}_{date_from.isoformat()}_{date_to.isoformat()}.csv"
    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@reports_bp.route("/staff/admin/audit", endpoint="staff_admin_audit")
@reports_bp.route("/staff/audit")
def staff_audit():
    require_permission("audit.view")
    actor_user_id = parse_optional_uuid(request.args.get("actor_user_id"))
    date_from = parse_optional_date(request.args.get("date_from"))
    date_to = parse_optional_date(request.args.get("date_to"))
    entity_table = (request.args.get("entity_table") or "").strip() or None
    action = (request.args.get("action") or "").strip() or None
    entries = query_audit_entries(
        actor_user_id=actor_user_id,
        entity_table=entity_table,
        action=action,
        date_from=date_from,
        date_to=date_to,
        limit=200,
    )
    users = (
        db.session.execute(
            sa.select(User)
            .where(User.deleted_at.is_(None))
            .order_by(User.full_name.asc())
        )
        .unique()
        .scalars()
        .all()
    )
    entity_tables = sorted(
        item
        for item in db.session.execute(
            sa.select(AuditLog.entity_table).distinct()
        ).scalars().all()
        if item
    )
    action_codes = sorted(
        item
        for item in db.session.execute(
            sa.select(AuditLog.action).distinct()
        ).scalars().all()
        if item
    )
    return render_template(
        "admin_audit.html",
        active_section="audit",
        entries=entries,
        users=users,
        entity_tables=entity_tables,
        action_codes=action_codes,
        summarize_audit_entry=summarize_audit_entry,
        filters={
            "actor_user_id": str(actor_user_id) if actor_user_id else "",
            "entity_table": entity_table or "",
            "action": action or "",
            "date_from": date_from.isoformat() if date_from else "",
            "date_to": date_to.isoformat() if date_to else "",
        },
    )
