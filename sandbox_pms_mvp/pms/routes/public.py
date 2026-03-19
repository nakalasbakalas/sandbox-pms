"""Public blueprint — booking engine, payments, cancel/modify requests, calendar feeds, pre-check-in guest form."""

from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal
from uuid import UUID

import sqlalchemy as sa
from flask import Blueprint, Response, abort, current_app, flash, g, jsonify, redirect, render_template, request, url_for

from ..extensions import db
from ..helpers import (
    current_language,
    current_settings,
    parse_booking_extra_ids,
)
from ..i18n import normalize_language, t
from ..models import (
    PaymentRequest,
    ReservationHold,
    RoomType,
)
from ..security import public_error_message, request_client_ip
from ..services.extras_service import reservation_extra_summary
from ..services.ical_service import export_feed_ical
from ..services.messaging_service import fire_automation_event
from ..services.payment_integration_service import (
    DEPOSIT_HOSTED_REQUEST_TYPES,
    create_or_reuse_payment_request,
    handle_public_payment_start,
    load_public_payment_return,
    payments_enabled,
    process_payment_webhook,
)
from ..services.pre_checkin_service import (
    PreCheckInSavePayload,
    get_pre_checkin_context,
    load_pre_checkin_by_token,
    mark_opened,
    save_pre_checkin,
    upload_document,
    validate_token_access,
)
from ..services.public_booking_service import (
    HoldRequestPayload,
    PublicBookingPayload,
    PublicSearchPayload,
    VerificationRequestPayload,
    complete_public_digital_checkout,
    confirm_public_booking,
    create_reservation_hold,
    load_public_confirmation,
    public_digital_checkout_context,
    submit_cancellation_request,
    submit_modification_request,
)
from ..activity import write_activity_log

logger = logging.getLogger(__name__)

public_bp = Blueprint("public", __name__)


# ── Helper imports from app.py module scope ──────────────────────────
# These functions are defined at module scope in app.py and used by
# the public booking routes. We import them lazily to avoid circular
# imports during the blueprint extraction.

def _get_app_helpers():
    """Lazy import of helpers defined in app.py module scope."""
    from ..app import (
        build_public_booking_entry_context,
        public_booking_form_context,
        public_request_form_defaults,
        resolve_booking_source_channel,
        source_metadata_from_request,
    )
    return {
        "build_public_booking_entry_context": build_public_booking_entry_context,
        "public_booking_form_context": public_booking_form_context,
        "public_request_form_defaults": public_request_form_defaults,
        "resolve_booking_source_channel": resolve_booking_source_channel,
        "source_metadata_from_request": source_metadata_from_request,
    }


# ── Routes ────────────────────────────────────────────────────────────

@public_bp.route("/book")
def booking_entry():
    helpers = _get_app_helpers()
    return render_template("availability.html", **helpers["build_public_booking_entry_context"]())


@public_bp.route("/availability")
def availability():
    return redirect(url_for("public.booking_entry", **request.args.to_dict(flat=True)), code=308)


@public_bp.route("/booking/hold", methods=["POST"])
def booking_hold():
    helpers = _get_app_helpers()
    language = normalize_language(request.form.get("language"))
    try:
        attribution = helpers["source_metadata_from_request"](language)
        hold = create_reservation_hold(
            HoldRequestPayload(
                check_in_date=date.fromisoformat(request.form["check_in_date"]),
                check_out_date=date.fromisoformat(request.form["check_out_date"]),
                adults=int(request.form["adults"]),
                children=int(request.form.get("children", 0)),
                room_type_id=UUID(request.form["room_type_id"]),
                guest_email=request.form.get("email"),
                idempotency_key=request.form["idempotency_key"],
                language=language,
                source_channel=helpers["resolve_booking_source_channel"](request.form.get("source_channel"), attribution),
                source_metadata=attribution,
                request_ip=request_client_ip(),
                user_agent=request.user_agent.string,
                extra_guests=int(request.form.get("extra_guests", 0)),
            )
        )
        room_type = db.session.get(RoomType, hold.room_type_id)
        return render_template(
            "public_booking_form.html",
            **helpers["public_booking_form_context"](hold, room_type),
        )
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
        return redirect(
            url_for(
                "public.booking_entry",
                check_in=request.form.get("check_in_date"),
                check_out=request.form.get("check_out_date"),
                adults=request.form.get("adults"),
                children=request.form.get("children", 0),
                room_type=request.form.get("room_type"),
                room_type_id=request.form.get("room_type_id"),
                utm_source=request.form.get("utm_source"),
                utm_medium=request.form.get("utm_medium"),
                utm_campaign=request.form.get("utm_campaign"),
                utm_content=request.form.get("utm_content"),
                source_label=request.form.get("source_label"),
                referrer_host=request.form.get("referrer_host"),
                entry_page=request.form.get("entry_page"),
                landing_path=request.form.get("landing_path"),
                source_channel=request.form.get("source_channel"),
                cta_source=request.form.get("cta_source"),
                lang=language,
            )
        )


@public_bp.route("/booking/confirm", methods=["POST"])
def booking_confirm():
    helpers = _get_app_helpers()
    language = normalize_language(request.form.get("language"))
    settings = current_settings()
    published_terms_version = settings.get("booking.terms_version", {}).get("value", "2026-03")
    selected_extra_ids: tuple[UUID, ...] = ()
    hold = db.session.execute(
        sa.select(ReservationHold).where(ReservationHold.hold_code == request.form.get("hold_code"))
    ).scalar_one_or_none()
    try:
        selected_extra_ids = parse_booking_extra_ids(request.form.getlist("extra_ids"))
        attribution = helpers["source_metadata_from_request"](
            language,
            fallback=hold.source_metadata_json if hold and isinstance(hold.source_metadata_json, dict) else None,
        )
        reservation = confirm_public_booking(
            PublicBookingPayload(
                hold_code=request.form["hold_code"],
                idempotency_key=request.form["idempotency_key"],
                first_name=request.form["first_name"].strip(),
                last_name=request.form["last_name"].strip(),
                phone=request.form["phone"].strip(),
                email=request.form["email"].strip(),
                special_requests=request.form.get("special_requests"),
                language=language,
                source_channel=helpers["resolve_booking_source_channel"](request.form.get("source_channel"), attribution),
                source_metadata=attribution,
                terms_accepted=request.form.get("accept_terms") == "on",
                terms_version=published_terms_version,
                extra_ids=selected_extra_ids,
            )
        )
        if payments_enabled() and Decimal(str(reservation.deposit_required_amount or "0.00")) > Decimal("0.00"):
            try:
                create_or_reuse_payment_request(
                    reservation.id,
                    actor_user_id=None,
                    send_email=True,
                    language=language,
                    source="public_confirmation",
                )
            except Exception:  # noqa: BLE001
                pass
        try:
            fire_automation_event(
                "reservation_created",
                reservation_id=str(reservation.id),
                guest_id=str(reservation.primary_guest_id) if reservation.primary_guest_id else None,
                context={
                    "reservation_code": reservation.reservation_code,
                    "guest_name": reservation.primary_guest.full_name if reservation.primary_guest else "",
                    "check_in_date": str(reservation.check_in_date),
                    "check_out_date": str(reservation.check_out_date),
                    "room_type": reservation.room_type.name if reservation.room_type else "",
                    "hotel_name": current_app.config.get("HOTEL_NAME", ""),
                },
            )
        except Exception:  # noqa: BLE001
            logger.exception("Automation hook failed for reservation_created (public)")
        return redirect(
            url_for(
                "public.booking_confirmation",
                reservation_code=reservation.reservation_code,
                token=reservation.public_confirmation_token,
            )
        )
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
        if not hold:
            return redirect(url_for("public.booking_entry", lang=language))
        room_type = db.session.get(RoomType, hold.room_type_id)
        return render_template(
            "public_booking_form.html",
            **helpers["public_booking_form_context"](
                hold,
                room_type,
                settings=settings,
                selected_extra_ids=selected_extra_ids,
                form_values={
                    "first_name": request.form.get("first_name", ""),
                    "last_name": request.form.get("last_name", ""),
                    "phone": request.form.get("phone", ""),
                    "email": request.form.get("email", hold.guest_email or ""),
                    "special_requests": request.form.get("special_requests", ""),
                },
            ),
        )


@public_bp.route("/booking/confirmation/<reservation_code>")
def booking_confirmation(reservation_code):
    reservation = load_public_confirmation(reservation_code, request.args.get("token", ""))
    if not reservation:
        abort(404)
    g.public_language = reservation.booking_language
    payment_request = (
        db.session.execute(
            sa.select(PaymentRequest)
            .where(
                PaymentRequest.reservation_id == reservation.id,
                PaymentRequest.request_type.in_(DEPOSIT_HOSTED_REQUEST_TYPES),
            )
            .order_by(PaymentRequest.created_at.desc())
        ).scalars().first()
    )
    return render_template(
        "public_confirmation.html",
        reservation=reservation,
        guest=reservation.primary_guest,
        payment_request=payment_request,
        extras_summary=reservation_extra_summary(reservation),
        digital_checkout_url=(
            url_for(
                "public.public_digital_checkout",
                reservation_code=reservation.reservation_code,
                token=reservation.public_confirmation_token,
                lang=current_language(),
            )
            if reservation.current_status == "checked_in"
            else None
        ),
    )


@public_bp.route("/booking/checkout/<reservation_code>")
def public_digital_checkout(reservation_code):
    context = public_digital_checkout_context(reservation_code, request.args.get("token", ""))
    if not context:
        abort(404)
    reservation = context["reservation"]
    g.public_language = reservation.booking_language
    return render_template("public_digital_checkout.html", **context)


@public_bp.route("/booking/checkout/<reservation_code>/pay-balance", methods=["POST"])
def public_digital_checkout_pay_balance(reservation_code):
    token = (request.form.get("token") or "").strip()
    context = public_digital_checkout_context(reservation_code, token)
    if not context:
        abort(404)
    reservation = context["reservation"]
    g.public_language = reservation.booking_language
    if not context["can_create_balance_payment"]:
        flash(public_error_message(ValueError("Balance payment link is not available for this stay.")), "error")
        return redirect(
            url_for(
                "public.public_digital_checkout",
                reservation_code=reservation.reservation_code,
                token=reservation.public_confirmation_token,
                lang=current_language(),
            )
        )
    try:
        payment_request = create_or_reuse_payment_request(
            reservation.id,
            actor_user_id=None,
            request_kind="balance",
            send_email=False,
            language=reservation.booking_language,
            source="public_digital_checkout",
        )
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
        return redirect(
            url_for(
                "public.public_digital_checkout",
                reservation_code=reservation.reservation_code,
                token=reservation.public_confirmation_token,
                lang=current_language(),
            )
        )
    return redirect(
        url_for(
            "public.public_payment_start",
            request_code=payment_request.request_code,
            reservation_code=reservation.reservation_code,
            token=reservation.public_confirmation_token,
            lang=current_language(),
        )
    )


@public_bp.route("/booking/checkout/<reservation_code>/complete", methods=["POST"])
def public_digital_checkout_complete(reservation_code):
    token = (request.form.get("token") or "").strip()
    checkout_context = public_digital_checkout_context(reservation_code, token)
    if not checkout_context:
        abort(404)
    reservation = checkout_context["reservation"]
    g.public_language = reservation.booking_language
    try:
        reservation = complete_public_digital_checkout(reservation_code, token)
        try:
            fire_automation_event(
                "checkout_completed",
                reservation_id=str(reservation.id),
                guest_id=str(reservation.primary_guest_id) if reservation.primary_guest_id else None,
                context={
                    "reservation_code": reservation.reservation_code,
                    "guest_name": reservation.primary_guest.full_name if reservation.primary_guest else "",
                    "check_in_date": str(reservation.check_in_date),
                    "check_out_date": str(reservation.check_out_date),
                    "hotel_name": current_app.config.get("HOTEL_NAME", ""),
                },
            )
        except Exception:  # noqa: BLE001
            logger.exception("Automation hook failed for checkout_completed (public)")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(
        url_for(
            "public.public_digital_checkout",
            reservation_code=reservation.reservation_code,
            token=reservation.public_confirmation_token,
            lang=current_language(),
        )
    )


@public_bp.route("/payments/request/<request_code>")
def public_payment_start(request_code):
    try:
        payment_request = handle_public_payment_start(
            request_code,
            request.args.get("reservation_code", ""),
            request.args.get("token", ""),
        )
    except LookupError:
        abort(404)
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
        return redirect(url_for("index", lang=current_language()))
    return redirect(payment_request.payment_url)


@public_bp.route("/payments/return/<request_code>")
def public_payment_return(request_code):
    try:
        context = load_public_payment_return(
            request_code,
            request.args.get("reservation_code", ""),
            request.args.get("token", ""),
        )
    except LookupError:
        abort(404)
    g.public_language = context["reservation"].booking_language
    reservation = context["reservation"]
    payment_request = context["payment_request"]
    if reservation.current_status == "checked_in" and "deposit" not in (payment_request.request_type or ""):
        context["return_url"] = url_for(
            "public.public_digital_checkout",
            reservation_code=reservation.reservation_code,
            token=reservation.public_confirmation_token,
            lang=current_language(),
        )
        context["return_label"] = t(current_language(), "digital_checkout_title")
    elif reservation.created_from_public_booking_flow:
        context["return_url"] = url_for(
            "public.booking_confirmation",
            reservation_code=reservation.reservation_code,
            token=reservation.public_confirmation_token,
            lang=current_language(),
        )
        context["return_label"] = t(current_language(), "confirmation_title")
    else:
        context["return_url"] = url_for(
            "public.public_digital_checkout",
            reservation_code=reservation.reservation_code,
            token=reservation.public_confirmation_token,
            lang=current_language(),
        )
        context["return_label"] = t(current_language(), "digital_checkout_title")
    context["payment_action_label"] = (
        t(current_language(), "payment_pay_deposit")
        if "deposit" in (payment_request.request_type or "")
        else t(current_language(), "digital_checkout_pay_balance")
    )
    return render_template("public_payment_return.html", **context)


@public_bp.route("/webhooks/payments/<provider_name>", methods=["POST"])
def payment_webhook(provider_name):
    try:
        result = process_payment_webhook(provider_name, request.get_data(), dict(request.headers))
    except Exception as exc:  # noqa: BLE001
        write_activity_log(
            actor_user_id=None,
            event_type="payment.webhook_failed",
            entity_table="payment_events",
            entity_id=provider_name,
            metadata={"provider": provider_name, "error": str(exc)[:255]},
        )
        return jsonify({"status": "error"}), 400
    return jsonify({"status": "ok", **result})


@public_bp.route("/booking/cancel", methods=["GET", "POST"])
def booking_cancel_request():
    helpers = _get_app_helpers()
    request_row = None
    form_defaults = helpers["public_request_form_defaults"]("booking_reference", "contact_value", "reason")
    if request.method == "POST":
        payload = VerificationRequestPayload(
            booking_reference=request.form["booking_reference"].strip(),
            contact_value=request.form["contact_value"].strip(),
            language=current_language(),
            reason=request.form.get("reason"),
            request_ip=request_client_ip(),
            user_agent=request.user_agent.string,
        )
        try:
            request_row = submit_cancellation_request(payload)
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        else:
            from ..i18n import t
            if request_row:
                flash(t(current_language(), "cancellation_received"), "success")
            else:
                flash(t(current_language(), "booking_lookup_not_found"), "error")
    return render_template("public_cancel_request.html", request_row=request_row, form_defaults=form_defaults)


@public_bp.route("/booking/modify", methods=["GET", "POST"])
def booking_modify_request():
    helpers = _get_app_helpers()
    request_row = None
    form_defaults = helpers["public_request_form_defaults"](
        "booking_reference",
        "contact_value",
        "requested_check_in",
        "requested_check_out",
        "requested_adults",
        "requested_children",
        "contact_correction",
        "special_requests",
    )
    if request.method == "POST":
        payload = VerificationRequestPayload(
            booking_reference=request.form["booking_reference"].strip(),
            contact_value=request.form["contact_value"].strip(),
            language=current_language(),
            requested_changes={
                "requested_check_in": request.form.get("requested_check_in"),
                "requested_check_out": request.form.get("requested_check_out"),
                "requested_adults": request.form.get("requested_adults"),
                "requested_children": request.form.get("requested_children"),
                "contact_correction": request.form.get("contact_correction"),
                "special_requests": request.form.get("special_requests"),
            },
            request_ip=request_client_ip(),
            user_agent=request.user_agent.string,
        )
        try:
            request_row = submit_modification_request(payload)
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        else:
            from ..i18n import t
            if request_row:
                flash(t(current_language(), "modification_received"), "success")
            else:
                flash(t(current_language(), "booking_lookup_not_found"), "error")
    return render_template("public_modify_request.html", request_row=request_row, form_defaults=form_defaults)


@public_bp.route("/calendar/feed/<token>.ics")
def calendar_feed_export(token):
    try:
        feed, payload = export_feed_ical(token)
    except LookupError:
        abort(404)
    except Exception as exc:  # noqa: BLE001
        return public_error_message(exc), 400
    safe_name = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in feed.name.lower()).strip("-") or "availability"
    response = Response(payload, mimetype="text/calendar")
    response.headers["Content-Disposition"] = f'inline; filename="{safe_name}.ics"'
    response.headers["Cache-Control"] = "private, max-age=300"
    return response


# ── Pre-Check-In: Guest-facing routes ────────────────────────────────

@public_bp.route("/pre-checkin/<token>", methods=["GET"])
def pre_checkin_form(token):
    pc = load_pre_checkin_by_token(token)
    error = validate_token_access(pc)
    if error:
        return render_template("pre_checkin_form.html", error=error, ctx=None), 403
    mark_opened(pc)
    db.session.commit()
    ctx = get_pre_checkin_context(pc)
    return render_template("pre_checkin_form.html", error=None, ctx=ctx)


@public_bp.route("/pre-checkin/<token>/save", methods=["POST"])
def pre_checkin_save(token):
    pc = load_pre_checkin_by_token(token)
    error = validate_token_access(pc)
    if error:
        return render_template("pre_checkin_form.html", error=error, ctx=None), 403
    payload = PreCheckInSavePayload(
        primary_contact_name=request.form.get("primary_contact_name"),
        primary_contact_phone=request.form.get("primary_contact_phone"),
        primary_contact_email=request.form.get("primary_contact_email"),
        nationality=request.form.get("nationality"),
        number_of_occupants=int(request.form.get("number_of_occupants") or 0) or None,
        eta=request.form.get("eta"),
        special_requests=request.form.get("special_requests"),
        notes_for_staff=request.form.get("notes_for_staff"),
        vehicle_registration=request.form.get("vehicle_registration"),
        acknowledgment_accepted=request.form.get("acknowledgment_accepted") == "on",
        acknowledgment_name=request.form.get("acknowledgment_name"),
    )
    occupants = []
    for i in range(20):
        name = request.form.get(f"occupant_name_{i}", "").strip()
        if name:
            occupants.append({"name": name})
    if occupants:
        payload.occupant_details = occupants
    is_submit = request.form.get("action") == "submit"
    try:
        save_pre_checkin(pc, payload, submit=is_submit)
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        ctx = get_pre_checkin_context(pc)
        return render_template("pre_checkin_form.html", error=str(exc), ctx=ctx)
    if is_submit:
        return render_template("pre_checkin_confirmation.html", pc=pc, reservation=pc.reservation)
    ctx = get_pre_checkin_context(pc)
    return render_template("pre_checkin_form.html", error=None, ctx=ctx, saved=True)


@public_bp.route("/pre-checkin/<token>/upload", methods=["POST"])
def pre_checkin_upload(token):
    pc = load_pre_checkin_by_token(token)
    error = validate_token_access(pc)
    if error:
        return render_template("pre_checkin_form.html", error=error, ctx=None), 403
    document_type = request.form.get("document_type", "passport")
    uploaded_file = request.files.get("document_file")
    try:
        upload_document(pc, uploaded_file, document_type)
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        ctx = get_pre_checkin_context(pc)
        return render_template("pre_checkin_form.html", error=str(exc), ctx=ctx)
    ctx = get_pre_checkin_context(pc)
    return render_template("pre_checkin_form.html", error=None, ctx=ctx, uploaded=True)
