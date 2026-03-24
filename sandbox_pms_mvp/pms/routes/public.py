from __future__ import annotations

import json
import logging
from datetime import date
from decimal import Decimal
from time import perf_counter
from uuid import UUID

import sqlalchemy as sa
from flask import Blueprint, Response, abort, current_app, flash, g, jsonify, redirect, render_template, request, url_for
from markupsafe import escape

from ..activity import write_activity_log
from ..branding import branding_settings_context
from ..helpers import absolute_public_url
from ..models import PaymentRequest, ReservationHold, RoomType
from ..extensions import db
from ..i18n import LANGUAGE_LABELS, normalize_language, t
from ..security import public_error_message, request_client_ip
from ..services.public_booking_service import (
    HoldRequestPayload,
    PublicBookingPayload,
    VerificationRequestPayload,
    complete_public_digital_checkout,
    confirm_public_booking,
    create_reservation_hold,
    load_public_confirmation,
    public_digital_checkout_context,
    submit_cancellation_request,
    submit_modification_request,
)
from ..services.payment_integration_service import (
    DEPOSIT_HOSTED_REQUEST_TYPES,
    create_or_reuse_deposit_request,
    create_or_reuse_payment_request,
    handle_public_payment_start,
    load_public_payment_return,
    payments_enabled,
    process_payment_webhook,
)
from ..services.ical_service import export_feed_ical
from ..services.pre_checkin_service import (
    PreCheckInSavePayload,
    get_pre_checkin_context,
    load_pre_checkin_by_token,
    mark_opened,
    save_pre_checkin,
    upload_document,
    validate_token_access,
)
from ..services.messaging_service import fire_automation_event
from ..services.housekeeping_service import create_maintenance_request

logger = logging.getLogger(__name__)

public_bp = Blueprint("public", __name__)


def _get_app_helpers():
    """Lazy import of helpers from app.py to avoid circular dependencies."""
    from .. import app as app_module
    return {
        "build_public_booking_entry_context": app_module.build_public_booking_entry_context,
        "public_booking_form_context": app_module.public_booking_form_context,
        "public_request_form_defaults": app_module.public_request_form_defaults,
        "resolve_booking_source_channel": app_module.resolve_booking_source_channel,
        "source_metadata_from_request": app_module.source_metadata_from_request,
        "current_language": app_module.current_language,
        "current_settings": app_module.current_settings,
        "current_booking_attribution": app_module.current_booking_attribution,
        "reservation_extra_summary": app_module.reservation_extra_summary,
        "parse_booking_extra_ids": app_module.parse_booking_extra_ids,
    }


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
    settings = helpers["current_settings"]()
    published_terms_version = settings.get("booking.terms_version", {}).get("value", "2026-03")
    selected_extra_ids: tuple[UUID, ...] = ()
    hold = db.session.execute(sa.select(ReservationHold).filter_by(hold_code=request.form.get("hold_code"))).scalar_one_or_none()
    try:
        selected_extra_ids = helpers["parse_booking_extra_ids"](request.form.getlist("extra_ids"))
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
                create_or_reuse_deposit_request(
                    reservation.id,
                    actor_user_id=None,
                    send_email=True,
                    language=language,
                    source="public_confirmation",
                )
            except Exception:  # noqa: BLE001
                logger.exception("Deposit payment request failed for reservation %s", reservation.id)
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
    helpers = _get_app_helpers()
    reservation = load_public_confirmation(reservation_code, request.args.get("token", ""))
    if not reservation:
        abort(404)
    g.public_language = reservation.booking_language
    payment_request = db.session.execute(
        sa.select(PaymentRequest).filter(
            PaymentRequest.reservation_id == reservation.id,
            PaymentRequest.request_type.in_(DEPOSIT_HOSTED_REQUEST_TYPES),
        )
        .order_by(PaymentRequest.created_at.desc())
    ).scalar_one_or_none()
    return render_template(
        "public_confirmation.html",
        reservation=reservation,
        guest=reservation.primary_guest,
        payment_request=payment_request,
        extras_summary=helpers["reservation_extra_summary"](reservation),
    )


@public_bp.route("/payments/request/<request_code>")
def public_payment_start(request_code):
    helpers = _get_app_helpers()
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
        return redirect(url_for("public.index", lang=helpers["current_language"]()))
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
    # Add context-dependent return link
    if reservation.current_status in ("checked_in",):
        context["return_url"] = url_for(
            "public.public_digital_checkout",
            reservation_code=reservation.reservation_code,
            token=request.args.get("token", ""),
        )
        context["return_label"] = "Return to checkout"
    else:
        context["return_url"] = url_for(
            "public.booking_confirmation",
            reservation_code=reservation.reservation_code,
            token=request.args.get("token", ""),
        )
        context["return_label"] = "Return to booking"
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
            language=helpers["current_language"](),
            reason=request.form.get("reason"),
            request_ip=request_client_ip(),
            user_agent=request.user_agent.string,
        )
        try:
            request_row = submit_cancellation_request(payload)
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        else:
            if request_row:
                flash(t(helpers["current_language"](), "cancellation_received"), "success")
            else:
                flash(t(helpers["current_language"](), "booking_lookup_not_found"), "error")
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
            language=helpers["current_language"](),
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
            if request_row:
                flash(t(helpers["current_language"](), "modification_received"), "success")
            else:
                flash(t(helpers["current_language"](), "booking_lookup_not_found"), "error")
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


# ── Pre-Check-In: Guest-facing routes ───────────────────────────────


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
    # Parse occupant details from form
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


@public_bp.route("/booking/checkout/<reservation_code>")
def public_digital_checkout(reservation_code):
    token = request.args.get("token", "")
    helpers = _get_app_helpers()
    context = public_digital_checkout_context(reservation_code, token)
    if not context:
        return render_template("public_booking_form.html", **helpers["build_public_booking_entry_context"]()), 404
    settings = helpers["current_settings"]()
    return render_template(
        "public_digital_checkout.html",
        **context,
        hotel_name=settings.get("hotel.name", ""),
        hotel_support_contact_text=settings.get("hotel.support_contact_text", ""),
    )


@public_bp.route("/booking/checkout/<reservation_code>/pay-balance", methods=["POST"])
def public_digital_checkout_pay_balance(reservation_code):
    token = request.form.get("token", "")
    context = public_digital_checkout_context(reservation_code, token)
    if not context:
        abort(404)
    reservation = context["reservation"]
    try:
        pr = create_or_reuse_payment_request(
            reservation.id,
            request_kind="balance",
            actor_user_id=None,
        )
        db.session.commit()
        return redirect(url_for(
            "public.public_payment_start",
            request_code=pr.request_code,
            reservation_code=reservation.reservation_code,
            token=reservation.public_confirmation_token,
        ))
    except Exception as exc:
        db.session.rollback()
        logger.warning("Digital checkout pay-balance failed: %s", exc)
        flash(str(exc), "error")
        return redirect(url_for("public.public_digital_checkout", reservation_code=reservation_code, token=token))


@public_bp.route("/booking/checkout/<reservation_code>/complete", methods=["POST"])
def public_digital_checkout_complete(reservation_code):
    token = request.form.get("token", "")
    try:
        complete_public_digital_checkout(reservation_code, token)
        db.session.commit()
    except (LookupError, ValueError) as exc:
        db.session.rollback()
        flash(str(exc), "error")
        return redirect(url_for("public.public_digital_checkout", reservation_code=reservation_code, token=token))
    return redirect(url_for("public.public_digital_checkout", reservation_code=reservation_code, token=token))


# ── Public pages (index, health, robots, favicon, manifest, sitemap) ──


@public_bp.route("/")
def index():
    return render_template(
        "index.html",
        room_types=db.session.execute(sa.select(RoomType).order_by(RoomType.code.asc())).scalars().all(),
    )


@public_bp.route("/health")
def health():
    started_at = perf_counter()
    threshold_ms = int(current_app.config.get("HEALTHCHECK_SLA_MS", 1000) or 0)
    try:
        db.session.execute(sa.text("SELECT 1"))
    except Exception:  # noqa: BLE001
        elapsed_ms = round((perf_counter() - started_at) * 1000, 2)
        return jsonify(
            {
                "status": "db_error",
                "db": "error",
                "response_ms": elapsed_ms,
                "sla_ms": threshold_ms,
                "within_sla": False,
            }
        ), 503
    elapsed_ms = round((perf_counter() - started_at) * 1000, 2)
    within_sla = threshold_ms <= 0 or elapsed_ms <= threshold_ms
    return jsonify(
        {
            "status": "ok" if within_sla else "degraded",
            "db": "ok",
            "response_ms": elapsed_ms,
            "sla_ms": threshold_ms,
            "within_sla": within_sla,
        }
    )


@public_bp.route("/robots.txt")
def robots_txt():
    body = "\n".join(
        [
            "User-agent: *",
            "Disallow: /staff/",
            "Disallow: /booking/hold",
            "Disallow: /booking/confirmation/",
            "Disallow: /booking/checkout/",
            "Disallow: /payments/",
            "Disallow: /pre-checkin/",
            "Disallow: /survey/",
            f"Sitemap: {absolute_public_url(url_for('public.sitemap_xml'))}",
        ]
    )
    return Response(f"{body}\n", mimetype="text/plain")


@public_bp.route("/favicon.ico")
def favicon_ico():
    return redirect(url_for("static", filename="branding/sandbox-hotel-favicon.ico"), code=302)


@public_bp.route("/manifest.json")
def web_manifest():
    branding = branding_settings_context()
    hotel_name = branding["hotel_name"]
    manifest = {
        "name": hotel_name,
        "short_name": branding["brand_mark"] or hotel_name[:12],
        "icons": [
            {
                "src": url_for("static", filename="branding/sandbox-hotel-logo-safe-192.png"),
                "sizes": "192x192",
                "type": "image/png",
            },
            {
                "src": url_for("static", filename="branding/sandbox-hotel-logo-safe-512.png"),
                "sizes": "512x512",
                "type": "image/png",
            },
        ],
        "theme_color": branding["accent_color"],
        "background_color": "#0b0d11",
        "display": "standalone",
        "start_url": "/",
    }
    return Response(json.dumps(manifest), mimetype="application/manifest+json")


@public_bp.route("/sitemap.xml")
def sitemap_xml():
    public_pages = [
        ("public.index", {}, "1.0", "daily"),
        ("public.booking_entry", {}, "0.9", "daily"),
        ("public.booking_cancel_request", {}, "0.5", "monthly"),
        ("public.booking_modify_request", {}, "0.5", "monthly"),
    ]
    body = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
        ' xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ]
    seen_urls: set[str] = set()
    for endpoint, values, priority, changefreq in public_pages:
        canonical = absolute_public_url(url_for(endpoint, **values))
        lang_urls = {
            code: absolute_public_url(url_for(endpoint, lang=code, **values))
            for code in LANGUAGE_LABELS
        }
        all_entries = [canonical] + list(lang_urls.values())
        for loc in all_entries:
            if loc in seen_urls:
                continue
            seen_urls.add(loc)
            xhtml_links = [
                f'    <xhtml:link rel="alternate" hreflang="{escape(code)}" href="{escape(href)}"/>'
                for code, href in lang_urls.items()
            ]
            xhtml_links.append(
                f'    <xhtml:link rel="alternate" hreflang="x-default" href="{escape(canonical)}"/>'
            )
            body.append("  <url>")
            body.append(f"    <loc>{escape(loc)}</loc>")
            body.extend(xhtml_links)
            body.append(f"    <changefreq>{changefreq}</changefreq>")
            body.append(f"    <priority>{priority}</priority>")
            body.append("  </url>")
    body.append("</urlset>")
    return Response("\n".join(body), mimetype="application/xml")


# -- Guest Maintenance Request: public routes ---------------------------------


@public_bp.route("/guest/maintenance", methods=["GET", "POST"])
def guest_maintenance_request():
    form_defaults = {
        "room_number": request.form.get("room_number", ""),
        "description": request.form.get("description", ""),
        "guest_name": request.form.get("guest_name", ""),
        "guest_contact": request.form.get("guest_contact", ""),
        "reservation_code": request.form.get("reservation_code", ""),
    }
    submitted = False
    if request.method == "POST":
        try:
            create_maintenance_request(
                room_number=request.form.get("room_number", ""),
                description=request.form.get("description", ""),
                guest_name=request.form.get("guest_name", ""),
                guest_contact=request.form.get("guest_contact", ""),
                reservation_code=request.form.get("reservation_code") or None,
            )
            submitted = True
            flash("Your maintenance request has been submitted. Our team will address it shortly.", "success")
        except ValueError as exc:
            flash(str(exc), "error")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
    return render_template(
        "guest_maintenance_request.html",
        form_defaults=form_defaults,
        submitted=submitted,
    )


# -- Guest Satisfaction Survey: public routes ---------------------------------

from ..services.survey_service import submit_survey, validate_survey_token


@public_bp.route("/survey/<token>", methods=["GET"])
def guest_survey_form(token):
    survey = validate_survey_token(token)
    if not survey:
        return render_template("guest_survey_form.html", error="This survey link is invalid or has expired.", survey=None), 403
    return render_template("guest_survey_form.html", error=None, survey=survey)


@public_bp.route("/survey/<token>/submit", methods=["POST"])
def guest_survey_submit(token):
    try:
        rating = int(request.form.get("rating", 0))
    except (TypeError, ValueError):
        rating = 0
    feedback = request.form.get("feedback", "").strip()
    category_ratings = {}
    for cat in ("cleanliness", "service", "comfort", "location", "value"):
        val = request.form.get(f"cat_{cat}")
        if val:
            try:
                category_ratings[cat] = int(val)
            except (TypeError, ValueError):
                pass
    try:
        survey = submit_survey(token, rating, feedback, category_ratings or None)
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        survey = validate_survey_token(token)
        return render_template("guest_survey_form.html", error=str(exc), survey=survey)
    return render_template("guest_survey_thanks.html", survey=survey)