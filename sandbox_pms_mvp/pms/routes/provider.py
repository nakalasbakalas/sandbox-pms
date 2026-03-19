"""Provider portal routes blueprint — bookings, payments, calendar feeds."""
from __future__ import annotations

from datetime import date
from uuid import UUID

import sqlalchemy as sa
from flask import Blueprint, flash, redirect, render_template, request, url_for

from ..constants import RESERVATION_STATUSES
from ..extensions import db
from ..helpers import (
    can,
    parse_optional_uuid,
    parse_request_date_arg,
    parse_request_int_arg,
    require_permission,
    safe_back_path,
)
from ..models import Room
from ..security import public_error_message
from ..services.ical_service import (
    create_calendar_feed,
    create_external_calendar_source,
    provider_calendar_context,
    rotate_calendar_feed,
    sync_external_calendar_source,
)
from ..services.provider_portal_service import (
    ProviderBookingFilters,
    get_provider_booking_detail,
    list_provider_bookings,
    provider_cancel_booking,
    provider_create_deposit_request,
    provider_dashboard_context,
    provider_refresh_payment_status,
    provider_resend_payment_link,
)

provider_bp = Blueprint("provider", __name__)


@provider_bp.route("/provider")
def provider_dashboard():
    require_permission("provider.dashboard.view")
    target_date = parse_request_date_arg("date", default=date.today())
    dashboard = provider_dashboard_context(business_date=target_date)
    return render_template(
        "provider_dashboard.html",
        dashboard=dashboard,
        target_date=target_date,
        can_manage_payments=can("provider.payment_request.create"),
        can_manage_calendar=can("provider.calendar.manage"),
    )


@provider_bp.route("/provider/bookings")
def provider_bookings():
    require_permission("provider.booking.view")
    filters = ProviderBookingFilters(
        search=(request.args.get("q") or "").strip(),
        status=request.args.get("status", ""),
        date_from=request.args.get("date_from", ""),
        date_to=request.args.get("date_to", ""),
        deposit_state=request.args.get("deposit_state", ""),
        page=parse_request_int_arg("page", default=1, minimum=1),
        per_page=20,
    )
    result = list_provider_bookings(filters)
    return render_template(
        "provider_bookings.html",
        result=result,
        filters=filters,
        reservation_statuses=RESERVATION_STATUSES,
    )


@provider_bp.route("/provider/bookings/<uuid:reservation_id>")
def provider_booking_detail(reservation_id):
    require_permission("provider.booking.view")
    detail = get_provider_booking_detail(reservation_id)
    return render_template(
        "provider_booking_detail.html",
        detail=detail,
        back_url=safe_back_path(request.args.get("back"), url_for("provider.provider_bookings")),
        can_manage_payments=can("provider.payment_request.create"),
        can_cancel=can("provider.booking.cancel"),
    )


@provider_bp.route("/provider/bookings/<uuid:reservation_id>/payment-requests", methods=["POST"])
def provider_booking_payment_request(reservation_id):
    user = require_permission("provider.payment_request.create")
    try:
        provider_create_deposit_request(reservation_id, actor_user_id=user.id)
        flash("Deposit payment request sent to the guest.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("provider.provider_booking_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@provider_bp.route("/provider/payment-requests/<uuid:payment_request_id>/resend", methods=["POST"])
def provider_payment_request_resend(payment_request_id):
    user = require_permission("provider.payment_request.create")
    reservation_id = request.form.get("reservation_id")
    try:
        provider_resend_payment_link(
            payment_request_id,
            actor_user_id=user.id,
            force_new=request.form.get("force_new_link") == "on",
        )
        flash("Payment link resent.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("provider.provider_booking_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@provider_bp.route("/provider/payment-requests/<uuid:payment_request_id>/refresh", methods=["POST"])
def provider_payment_request_refresh(payment_request_id):
    user = require_permission("provider.payment_request.create")
    reservation_id = request.form.get("reservation_id")
    try:
        provider_refresh_payment_status(payment_request_id, actor_user_id=user.id)
        flash("Payment status refreshed.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("provider.provider_booking_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@provider_bp.route("/provider/bookings/<uuid:reservation_id>/cancel", methods=["POST"])
def provider_booking_cancel(reservation_id):
    user = require_permission("provider.booking.cancel")
    try:
        provider_cancel_booking(
            reservation_id,
            actor_user_id=user.id,
            reason=request.form.get("reason", ""),
        )
        flash("Booking cancelled.", "success")
        return redirect(url_for("provider.provider_bookings"))
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
        return redirect(url_for("provider.provider_booking_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@provider_bp.route("/provider/calendar")
def provider_calendar():
    require_permission("provider.calendar.view")
    return render_template(
        "provider_calendar.html",
        calendar=provider_calendar_context(),
        rooms=(
            db.session.execute(
                sa.select(Room)
                .where(Room.is_active.is_(True))
                .order_by(Room.room_number.asc())
            )
            .scalars()
            .all()
        ),
        can_manage_calendar=can("provider.calendar.manage"),
    )


@provider_bp.route("/provider/calendar/feeds", methods=["POST"])
def provider_calendar_feed_create():
    user = require_permission("provider.calendar.manage")
    scope_type = request.form.get("scope_type", "property")
    room_id = parse_optional_uuid(request.form.get("room_id"))
    try:
        create_calendar_feed(
            scope_type=scope_type,
            room_id=room_id,
            name=request.form.get("name"),
            actor_user_id=user.id,
        )
        flash("Private calendar feed created.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("provider.provider_calendar"))


@provider_bp.route("/provider/calendar/feeds/<uuid:feed_id>/rotate", methods=["POST"])
def provider_calendar_feed_rotate(feed_id):
    user = require_permission("provider.calendar.manage")
    try:
        rotate_calendar_feed(feed_id, actor_user_id=user.id)
        flash("Calendar feed rotated. Replace the old URL anywhere it was subscribed.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("provider.provider_calendar"))


@provider_bp.route("/provider/calendar/sources", methods=["POST"])
def provider_calendar_source_create():
    user = require_permission("provider.calendar.manage")
    try:
        source = create_external_calendar_source(
            room_id=UUID(request.form["room_id"]),
            name=request.form.get("name", ""),
            feed_url=request.form.get("feed_url", ""),
            actor_user_id=user.id,
        )
        if request.form.get("sync_now") == "on":
            sync_external_calendar_source(source.id, actor_user_id=user.id)
        flash("External calendar source saved.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("provider.provider_calendar"))


@provider_bp.route("/provider/calendar/sources/<uuid:source_id>/sync", methods=["POST"])
def provider_calendar_source_sync(source_id):
    user = require_permission("provider.calendar.manage")
    try:
        result = sync_external_calendar_source(source_id, actor_user_id=user.id)
        flash(
            f"Calendar sync completed with status {result['run'].status}.",
            "success" if result["run"].status == "success" else "warning",
        )
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("provider.provider_calendar"))
