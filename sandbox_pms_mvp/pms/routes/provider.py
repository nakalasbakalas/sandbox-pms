from __future__ import annotations

from datetime import date, timedelta
from uuid import UUID

from flask import flash, redirect, render_template, request, url_for

from ..constants import RESERVATION_STATUSES
from ..models import Room, RoomType
from ..security import public_error_message
from ..services.channel_service import (
    ChannelSyncService,
    build_outbound_inventory_updates,
    get_provider,
    provider_push_context,
)
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


def _get_app_helpers():
    from .. import app as app_module

    return {
        "can": app_module.can,
        "parse_optional_uuid": app_module.parse_optional_uuid,
        "parse_request_date_arg": app_module.parse_request_date_arg,
        "parse_request_int_arg": app_module.parse_request_int_arg,
        "require_permission": app_module.require_permission,
        "safe_back_path": app_module.safe_back_path,
    }


def register_provider_routes(app) -> None:
    @app.route("/provider")
    def provider_dashboard():
        helpers = _get_app_helpers()
        helpers["require_permission"]("provider.dashboard.view")
        target_date = helpers["parse_request_date_arg"]("date", default=date.today())
        dashboard = provider_dashboard_context(business_date=target_date)
        return render_template(
            "provider_dashboard.html",
            dashboard=dashboard,
            target_date=target_date,
            can_manage_payments=helpers["can"]("provider.payment_request.create"),
            can_manage_calendar=helpers["can"]("provider.calendar.manage"),
        )

    @app.route("/provider/bookings")
    def provider_bookings():
        helpers = _get_app_helpers()
        helpers["require_permission"]("provider.booking.view")
        filters = ProviderBookingFilters(
            search=(request.args.get("q") or "").strip(),
            status=request.args.get("status", ""),
            date_from=request.args.get("date_from", ""),
            date_to=request.args.get("date_to", ""),
            deposit_state=request.args.get("deposit_state", ""),
            page=helpers["parse_request_int_arg"]("page", default=1, minimum=1),
            per_page=20,
        )
        result = list_provider_bookings(filters)
        return render_template(
            "provider_bookings.html",
            result=result,
            filters=filters,
            reservation_statuses=RESERVATION_STATUSES,
        )

    @app.route("/provider/bookings/<uuid:reservation_id>")
    def provider_booking_detail(reservation_id):
        helpers = _get_app_helpers()
        helpers["require_permission"]("provider.booking.view")
        detail = get_provider_booking_detail(reservation_id)
        return render_template(
            "provider_booking_detail.html",
            detail=detail,
            back_url=helpers["safe_back_path"](request.args.get("back"), url_for("provider_bookings")),
            can_manage_payments=helpers["can"]("provider.payment_request.create"),
            can_cancel=helpers["can"]("provider.booking.cancel"),
        )

    @app.route("/provider/bookings/<uuid:reservation_id>/payment-requests", methods=["POST"])
    def provider_booking_payment_request(reservation_id):
        helpers = _get_app_helpers()
        user = helpers["require_permission"]("provider.payment_request.create")
        try:
            provider_create_deposit_request(reservation_id, actor_user_id=user.id)
            flash("Deposit payment request sent to the guest.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("provider_booking_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/provider/payment-requests/<uuid:payment_request_id>/resend", methods=["POST"])
    def provider_payment_request_resend(payment_request_id):
        helpers = _get_app_helpers()
        user = helpers["require_permission"]("provider.payment_request.create")
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
        return redirect(url_for("provider_booking_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/provider/payment-requests/<uuid:payment_request_id>/refresh", methods=["POST"])
    def provider_payment_request_refresh(payment_request_id):
        helpers = _get_app_helpers()
        user = helpers["require_permission"]("provider.payment_request.create")
        reservation_id = request.form.get("reservation_id")
        try:
            provider_refresh_payment_status(payment_request_id, actor_user_id=user.id)
            flash("Payment status refreshed.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("provider_booking_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/provider/bookings/<uuid:reservation_id>/cancel", methods=["POST"])
    def provider_booking_cancel(reservation_id):
        helpers = _get_app_helpers()
        user = helpers["require_permission"]("provider.booking.cancel")
        try:
            provider_cancel_booking(
                reservation_id,
                actor_user_id=user.id,
                reason=request.form.get("reason", ""),
            )
            flash("Booking cancelled.", "success")
            return redirect(url_for("provider_bookings"))
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
            return redirect(url_for("provider_booking_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/provider/calendar")
    def provider_calendar():
        helpers = _get_app_helpers()
        helpers["require_permission"]("provider.calendar.view")
        today_value = date.today()
        return render_template(
            "provider_calendar.html",
            calendar=provider_calendar_context(),
            ota_push=provider_push_context(),
            rooms=Room.query.filter_by(is_active=True).order_by(Room.room_number.asc()).all(),
            room_types=RoomType.query.filter_by(is_active=True).order_by(RoomType.code.asc()).all(),
            push_defaults={
                "date_from": today_value,
                "date_to": today_value + timedelta(days=30),
            },
            can_manage_calendar=helpers["can"]("provider.calendar.manage"),
        )

    @app.route("/provider/calendar/feeds", methods=["POST"])
    def provider_calendar_feed_create():
        helpers = _get_app_helpers()
        user = helpers["require_permission"]("provider.calendar.manage")
        scope_type = request.form.get("scope_type", "property")
        room_id = helpers["parse_optional_uuid"](request.form.get("room_id"))
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
        return redirect(url_for("provider_calendar"))

    @app.route("/provider/calendar/feeds/<uuid:feed_id>/rotate", methods=["POST"])
    def provider_calendar_feed_rotate(feed_id):
        helpers = _get_app_helpers()
        user = helpers["require_permission"]("provider.calendar.manage")
        try:
            rotate_calendar_feed(feed_id, actor_user_id=user.id)
            flash("Calendar feed rotated. Replace the old URL anywhere it was subscribed.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("provider_calendar"))

    @app.route("/provider/calendar/sources", methods=["POST"])
    def provider_calendar_source_create():
        helpers = _get_app_helpers()
        user = helpers["require_permission"]("provider.calendar.manage")
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
        return redirect(url_for("provider_calendar"))

    @app.route("/provider/calendar/sources/<uuid:source_id>/sync", methods=["POST"])
    def provider_calendar_source_sync(source_id):
        helpers = _get_app_helpers()
        user = helpers["require_permission"]("provider.calendar.manage")
        try:
            result = sync_external_calendar_source(source_id, actor_user_id=user.id)
            flash(
                f"Calendar sync completed with status {result['run'].status}.",
                "success" if result["run"].status == "success" else "warning",
            )
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("provider_calendar"))

    @app.route("/provider/calendar/push", methods=["POST"])
    def provider_calendar_push():
        helpers = _get_app_helpers()
        user = helpers["require_permission"]("provider.calendar.manage")
        provider_key = (request.form.get("provider_key") or "").strip()
        room_type_id = helpers["parse_optional_uuid"](request.form.get("room_type_id"))
        try:
            date_from = date.fromisoformat(request.form.get("date_from") or date.today().isoformat())
            date_to = date.fromisoformat(request.form.get("date_to") or (date_from + timedelta(days=30)).isoformat())
            if date_to < date_from:
                raise ValueError("End date must be on or after start date.")
            updates = build_outbound_inventory_updates(
                date_from=date_from,
                date_to=date_to,
                room_type_id=room_type_id,
            )
            result = ChannelSyncService(get_provider(provider_key)).push_inventory_updates(
                updates,
                actor_user_id=user.id,
            )
            if result.success:
                flash(f"Pushed {result.records_processed} inventory update(s) to {provider_key.replace('_', ' ')}.", "success")
            else:
                flash("; ".join(result.errors) or f"{provider_key.replace('_', ' ')} push failed.", "error")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("provider_calendar"))
