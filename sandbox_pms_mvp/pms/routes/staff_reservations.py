"""Staff reservations blueprint — reservation list, detail, create, notes, pre-check-in, and documents."""

from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

import sqlalchemy as sa
from flask import Blueprint, Response, abort, current_app, flash, g, jsonify, redirect, render_template, request, url_for
from markupsafe import Markup, escape

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..constants import BOOKING_SOURCE_CHANNELS, RESERVATION_STATUSES, REVIEW_QUEUE_STATUSES
from ..extensions import db
from ..helpers import (
    can,
    current_user,
    parse_optional_uuid,
    parse_request_date_arg,
    parse_request_int_arg,
    parse_request_uuid_arg,
    require_any_permission,
    require_permission,
    safe_back_path,
)
from ..models import (
    PreCheckIn,
    Reservation,
    ReservationDocument,
    ReservationReviewQueue,
    RoomType,
    utc_now,
)
from ..pricing import quote_reservation
from ..security import public_error_message
from ..services.extras_service import list_booking_extras
from ..services.messaging_service import (
    fire_automation_event,
    reservation_messages,
)
from ..services.pre_checkin_service import (
    DocumentVerifyPayload,
    build_pre_checkin_link,
    generate_pre_checkin,
    get_document_serve_url,
    get_documents_for_reservation,
    get_pre_checkin_for_reservation,
    mark_rejected,
    mark_verified,
    read_document_bytes,
    send_pre_checkin_link_email,
    verify_document,
)
from ..services.reservation_service import ReservationCreatePayload, create_reservation
from ..services.staff_reservations_service import (
    GuestUpdatePayload,
    ReservationNotePayload,
    ReservationWorkspaceFilters,
    StayDateChangePayload,
    add_reservation_note,
    approve_modification_request,
    assign_room,
    build_reservation_summary,
    cancel_reservation_workspace,
    change_stay_dates,
    decline_modification_request,
    get_guest_detail,
    get_reservation_detail,
    list_arrivals,
    list_departures,
    list_in_house,
    list_reservations,
    quote_modification_request,
    resend_confirmation,
    search_guests,
    update_guest_details,
)

logger = logging.getLogger(__name__)

staff_reservations_bp = Blueprint("staff_reservations", __name__)


# ── Guest search ───────────────────────────────────────────────────────

@staff_reservations_bp.route("/staff/guests")
def staff_guests():
    require_permission("reservation.view")
    q = (request.args.get("q") or "").strip()
    guests = search_guests(q) if q else []
    return render_template("staff_guests.html", q=q, guests=guests)


@staff_reservations_bp.route("/staff/guests/<uuid:guest_id>")
def staff_guest_detail(guest_id):
    require_permission("reservation.view")
    try:
        detail = get_guest_detail(guest_id)
    except ValueError:
        abort(404)
    back_url = safe_back_path(request.args.get("back"), url_for("staff_reservations.staff_guests"))
    return render_template("staff_guest_detail.html", detail=detail, back_url=back_url)


# ── Reservation list and operational views ─────────────────────────────

@staff_reservations_bp.route("/staff/reservations")
def staff_reservations():
    require_permission("reservation.view")
    arrival_date = parse_request_date_arg("arrival_date", default=None)
    departure_date = parse_request_date_arg("departure_date", default=None)
    sort_val = request.args.get("sort", "")
    sort_dir = request.args.get("sort_dir", "asc")
    if sort_val not in ("arrival", "departure", "status", "reference"):
        sort_val = ""
    if sort_dir not in ("asc", "desc"):
        sort_dir = "asc"
    filters = ReservationWorkspaceFilters(
        q=(request.args.get("q") or "").strip(),
        status=request.args.get("status", ""),
        room_type_id=parse_request_uuid_arg("room_type_id") or "",
        arrival_date=arrival_date.isoformat() if arrival_date else "",
        departure_date=departure_date.isoformat() if departure_date else "",
        payment_state=request.args.get("payment_state", ""),
        booking_source=request.args.get("booking_source", ""),
        review_status=request.args.get("review_status", ""),
        assigned=request.args.get("assigned", ""),
        include_closed=request.args.get("include_closed") == "1",
        page=parse_request_int_arg("page", default=1, minimum=1),
        per_page=25,
        sort=sort_val,
        sort_dir=sort_dir,
    )
    result = list_reservations(filters)
    if result["items"]:
        _res_ids = [item["id"] for item in result["items"]]
        _pc_rows = db.session.query(PreCheckIn).filter(PreCheckIn.reservation_id.in_(_res_ids)).all()
        _pc_map = {str(pc.reservation_id): pc for pc in _pc_rows}
        for item in result["items"]:
            item["pre_checkin"] = _pc_map.get(str(item["id"]))
    return render_template(
        "staff_reservations.html",
        result=result,
        filters=filters,
        room_types=db.session.execute(sa.select(RoomType).order_by(RoomType.code.asc())).scalars().all(),
        reservation_statuses=RESERVATION_STATUSES,
        booking_sources=BOOKING_SOURCE_CHANNELS,
        review_statuses=REVIEW_QUEUE_STATUSES,
        today=date.today(),
        tomorrow=date.today() + timedelta(days=1),
        can_folio=can("folio.view"),
    )


@staff_reservations_bp.route("/staff/reservations/arrivals")
def staff_reservation_arrivals():
    require_permission("reservation.view")
    target_date = parse_request_date_arg("date", default=date.today())
    items = list_arrivals(
        arrival_date=target_date,
        room_type_id=parse_request_uuid_arg("room_type_id") or "",
        payment_state=request.args.get("payment_state", ""),
        assigned=request.args.get("assigned", ""),
    )
    return render_template(
        "staff_operational_list.html",
        title="Arrivals",
        subtitle="Reservations arriving today",
        items=items,
        target_date=target_date,
        mode="arrivals",
        room_types=db.session.execute(sa.select(RoomType).order_by(RoomType.code.asc())).scalars().all(),
        can_folio=can("folio.view"),
    )


@staff_reservations_bp.route("/staff/reservations/departures")
def staff_reservation_departures():
    require_permission("reservation.view")
    target_date = parse_request_date_arg("date", default=date.today())
    items = list_departures(
        departure_date=target_date,
        room_type_id=parse_request_uuid_arg("room_type_id") or "",
        payment_state=request.args.get("payment_state", ""),
    )
    return render_template(
        "staff_operational_list.html",
        title="Departures",
        subtitle="Reservations departing today",
        items=items,
        target_date=target_date,
        mode="departures",
        room_types=db.session.execute(sa.select(RoomType).order_by(RoomType.code.asc())).scalars().all(),
        can_folio=can("folio.view"),
    )


@staff_reservations_bp.route("/staff/reservations/in-house")
def staff_reservation_in_house():
    require_permission("reservation.view")
    target_date = parse_request_date_arg("date", default=date.today())
    items = list_in_house(business_date=target_date)
    return render_template(
        "staff_operational_list.html",
        title="In-House Guests",
        subtitle="Guests currently checked in",
        items=items,
        target_date=target_date,
        mode="in_house",
        room_types=db.session.execute(sa.select(RoomType).order_by(RoomType.code.asc())).scalars().all(),
        can_folio=can("folio.view"),
    )


# ── Reservation create + rate preview ──────────────────────────────────

@staff_reservations_bp.route("/staff/reservations/new", methods=["GET", "POST"])
def staff_reservation_create():
    user = require_permission("reservation.create")
    default_back = url_for("staff_reservations.staff_reservations")
    back_url = safe_back_path(request.values.get("back"), default_back)
    initial = {
        "first_name": (request.values.get("first_name") or "").strip(),
        "last_name": (request.values.get("last_name") or "").strip(),
        "guest_phone": (request.values.get("guest_phone") or "").strip(),
        "guest_email": (request.values.get("guest_email") or "").strip(),
        "source_channel": (request.values.get("source_channel") or request.values.get("source") or "admin_manual").strip(),
        "check_in": (request.values.get("check_in") or "").strip(),
        "check_out": (request.values.get("check_out") or "").strip(),
        "adults": (request.values.get("adults") or "2").strip(),
        "children": (request.values.get("children") or "0").strip(),
        "extra_guests": (request.values.get("extra_guests") or "0").strip(),
        "room_type_id": parse_optional_uuid(request.values.get("room_type_id")),
        "status": (request.values.get("status") or "confirmed").strip(),
        "special_requests": request.values.get("special_requests") or "",
        "internal_notes": request.values.get("internal_notes") or request.values.get("notes") or "",
    }
    if initial["check_in"] and not initial["check_out"]:
        try:
            initial["check_out"] = (date.fromisoformat(initial["check_in"]) + timedelta(days=1)).isoformat()
        except ValueError:
            initial["check_out"] = ""
    if request.method == "POST":
        try:
            reservation = create_reservation(
                ReservationCreatePayload(
                    first_name=initial["first_name"],
                    last_name=initial["last_name"],
                    phone=initial["guest_phone"],
                    email=initial["guest_email"] or None,
                    room_type_id=UUID(request.form["room_type_id"]),
                    check_in_date=date.fromisoformat(request.form["check_in"]),
                    check_out_date=date.fromisoformat(request.form["check_out"]),
                    adults=int(request.form.get("adults", 2)),
                    children=int(request.form.get("children", 0)),
                    extra_guests=int(request.form.get("extra_guests", 0)),
                    source_channel=initial["source_channel"] or "admin_manual",
                    special_requests=request.form.get("special_requests"),
                    internal_notes=request.form.get("internal_notes"),
                    initial_status=request.form.get("status") or "confirmed",
                ),
                actor_user_id=user.id,
            )
            flash(f"Reservation {reservation.reservation_code} created.", "success")
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
                logger.exception("Automation hook failed for reservation_created")
            return redirect(url_for("staff_reservations.staff_reservation_detail", reservation_id=reservation.id, back=back_url))
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
    return render_template(
        "reservation_form.html",
        is_staff=True,
        initial=initial,
        room_types=(
            db.session.execute(
                sa.select(RoomType)
                .where(RoomType.is_active.is_(True))
                .order_by(RoomType.code.asc())
            )
            .scalars()
            .all()
        ),
        back_url=back_url,
        booking_sources=BOOKING_SOURCE_CHANNELS,
        staff_status_options=["confirmed", "tentative", "house_use"],
    )


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/duplicate")
def staff_reservation_duplicate(reservation_id):
    require_permission("reservation.view")
    require_permission("reservation.create")
    reservation = db.session.get(Reservation, reservation_id)
    if reservation is None:
        abort(404)
    guest = reservation.primary_guest
    stay_length = max((reservation.check_out_date - reservation.check_in_date).days, 1)
    clone_check_in = max(date.today() + timedelta(days=1), reservation.check_out_date)
    clone_check_out = clone_check_in + timedelta(days=stay_length)
    clone_status = reservation.current_status if reservation.current_status in {"tentative", "house_use"} else "confirmed"
    back_url = safe_back_path(request.args.get("back"), url_for("staff_reservations.staff_reservations"))
    return redirect(
        url_for(
            "staff_reservations.staff_reservation_create",
            back=back_url,
            first_name=guest.first_name if guest else "",
            last_name=guest.last_name if guest else "",
            guest_phone=guest.phone if guest else "",
            guest_email=guest.email if guest else "",
            source_channel=reservation.source_channel or "admin_manual",
            room_type_id=reservation.room_type_id,
            check_in=clone_check_in.isoformat(),
            check_out=clone_check_out.isoformat(),
            adults=reservation.adults,
            children=reservation.children,
            extra_guests=reservation.extra_guests,
            status=clone_status,
            special_requests=reservation.special_requests or "",
            internal_notes=f"Cloned from {reservation.reservation_code}",
        )
    )


@staff_reservations_bp.route("/staff/reservations/rate-preview")
def staff_reservation_rate_preview():
    """Lightweight JSON endpoint for inline rate preview on the reservation form."""
    require_permission("reservation.create")
    try:
        room_type_id = UUID(request.args["room_type_id"])
        check_in = date.fromisoformat(request.args["check_in"])
        check_out = date.fromisoformat(request.args["check_out"])
        adults = int(request.args.get("adults", 2))
        children = int(request.args.get("children", 0))
        extra_guests = int(request.args.get("extra_guests", 0))
    except (KeyError, ValueError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    if check_out <= check_in:
        return jsonify({"ok": False, "error": "Check-out must be after check-in"}), 400

    room_type = db.session.get(RoomType, room_type_id)
    if not room_type or not room_type.is_active:
        return jsonify({"ok": False, "error": "Invalid room type"}), 400

    quote = quote_reservation(
        room_type=room_type,
        check_in_date=check_in,
        check_out_date=check_out,
        adults=adults + extra_guests,
        children=children,
    )
    nights = (check_out - check_in).days

    return jsonify({
        "ok": True,
        "nights": nights,
        "room_total": float(quote.room_total),
        "tax_total": float(quote.tax_total),
        "grand_total": float(quote.grand_total),
        "nightly_rates": [
            {"date": d.isoformat(), "rate": float(r)}
            for d, r in quote.nightly_rates
        ],
    })


# ── Reservation detail + mutations ─────────────────────────────────────

@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>")
def staff_reservation_detail(reservation_id):
    require_any_permission("reservation.view", "housekeeping.view")
    detail = get_reservation_detail(reservation_id, actor_user=current_user())
    comm_messages = reservation_messages(str(reservation_id)) if can("messaging.view") else []
    return render_template(
        "reservation_detail.html",
        detail=detail,
        back_url=safe_back_path(request.args.get("back"), url_for("staff_reservations.staff_reservations")),
        today=date.today(),
        can_folio=can("folio.view"),
        comm_messages=comm_messages,
    )


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/guest", methods=["POST"])
def staff_reservation_update_guest(reservation_id):
    user = require_permission("reservation.edit")
    try:
        update_guest_details(
            reservation_id,
            GuestUpdatePayload(
                first_name=request.form.get("first_name", ""),
                last_name=request.form.get("last_name", ""),
                phone=request.form.get("phone", ""),
                email=request.form.get("email"),
                nationality=request.form.get("nationality"),
                id_document_type=request.form.get("id_document_type"),
                id_document_number=request.form.get("id_document_number"),
                preferred_language=request.form.get("preferred_language"),
                notes_summary=request.form.get("notes_summary"),
            ),
            actor_user_id=user.id,
        )
        flash("Guest details updated.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("staff_reservations.staff_reservation_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/dates", methods=["POST"])
def staff_reservation_change_dates(reservation_id):
    user = require_permission("reservation.edit")
    try:
        result = change_stay_dates(
            reservation_id,
            StayDateChangePayload(
                check_in_date=date.fromisoformat(request.form["check_in_date"]),
                check_out_date=date.fromisoformat(request.form["check_out_date"]),
                adults=int(request.form.get("adults", 1)),
                children=int(request.form.get("children", 0)),
                extra_guests=int(request.form.get("extra_guests", 0)),
            ),
            actor_user_id=user.id,
        )
        delta = result["new_total"] - result["old_total"]
        flash(
            f"Stay updated. New total {result['new_total']:.2f} THB ({delta:+.2f} THB).",
            "success",
        )
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("staff_reservations.staff_reservation_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/room", methods=["POST"])
def staff_reservation_assign_room(reservation_id):
    user = require_permission("reservation.edit")
    try:
        assign_room(
            reservation_id,
            UUID(request.form["room_id"]),
            actor_user_id=user.id,
        )
        flash("Room assignment updated.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("staff_reservations.staff_reservation_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/cancel", methods=["POST"])
def staff_reservation_cancel(reservation_id):
    user = require_permission("reservation.cancel")
    try:
        cancel_reservation_workspace(
            reservation_id,
            actor_user_id=user.id,
            reason=request.form.get("reason", ""),
        )
        flash("Reservation cancelled.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("staff_reservations.staff_reservations"))


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/modification-requests/<uuid:mod_id>/approve", methods=["POST"])
def staff_modification_approve(reservation_id, mod_id):
    user = require_permission("reservation.edit")
    try:
        result = approve_modification_request(
            reservation_id,
            mod_id,
            actor_user_id=user.id,
            internal_note=request.form.get("internal_note", ""),
        )
        delta = result["new_total"] - result["old_total"]
        flash(
            f"Modification approved. New total {result['new_total']:.2f} THB ({delta:+.2f} THB).",
            "success",
        )
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("staff_reservations.staff_reservation_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/modification-requests/<uuid:mod_id>/decline", methods=["POST"])
def staff_modification_decline(reservation_id, mod_id):
    user = require_permission("reservation.edit")
    try:
        decline_modification_request(
            reservation_id,
            mod_id,
            actor_user_id=user.id,
            internal_note=request.form.get("internal_note", ""),
        )
        flash("Modification request declined.", "info")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("staff_reservations.staff_reservation_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/modification-requests/<uuid:mod_id>/quote")
def staff_modification_quote(reservation_id, mod_id):
    require_permission("reservation.view")
    try:
        quote = quote_modification_request(reservation_id, mod_id)
        return jsonify(quote)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 400


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/panel")
def staff_reservation_panel(reservation_id):
    """Mini HTML fragment for the reservations list drawer."""
    require_permission("reservation.view")
    reservation = db.session.get(Reservation, reservation_id)
    if not reservation:
        abort(404)
    summary = build_reservation_summary(reservation)
    return render_template(
        "_res_list_drawer.html",
        item=summary,
        can_cancel=can("reservation.cancel") and summary["status"] in ("tentative", "confirmed"),
        can_folio=can("folio.view"),
        back_url=request.args.get("back", url_for("staff_reservations.staff_reservations")),
    )


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/notes", methods=["POST"])
def staff_reservation_add_note(reservation_id):
    user = require_permission("reservation.edit")
    try:
        add_reservation_note(
            reservation_id,
            ReservationNotePayload(
                note_text=request.form.get("note_text", ""),
                note_type=request.form.get("note_type", "general"),
                is_important=request.form.get("is_important") == "on",
                visibility_scope=request.form.get("visibility_scope", "all_staff"),
            ),
            actor_user_id=user.id,
        )
        flash("Note added.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("staff_reservations.staff_reservation_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/resend-confirmation", methods=["POST"])
def staff_reservation_resend_confirmation(reservation_id):
    user = require_permission("reservation.edit")
    try:
        resend_confirmation(
            reservation_id,
            actor_user_id=user.id,
            language=request.form.get("language") or None,
        )
        flash("Confirmation email resent.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("staff_reservations.staff_reservation_detail", reservation_id=reservation_id, back=request.form.get("back_url")))


# ── Pre-Check-In: Staff-facing routes ──────────────────────────────────

@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/pre-checkin/generate", methods=["POST"])
def staff_pre_checkin_generate(reservation_id):
    user = require_permission("reservation.edit")
    try:
        pc = generate_pre_checkin(reservation_id, actor_user_id=user.id)
        db.session.commit()
        link = build_pre_checkin_link(pc.token)
        flash(Markup(f'Pre-check-in link generated: <code class="text-xs select-all">{escape(link)}</code>'), "success")
    except Exception as exc:  # noqa: BLE001
        db.session.rollback()
        flash(public_error_message(exc), "error")
    return redirect(url_for("staff_reservations.staff_reservation_detail", reservation_id=reservation_id))


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/pre-checkin/resend", methods=["POST"])
def staff_pre_checkin_resend(reservation_id):
    user = require_permission("reservation.edit")
    try:
        pc = generate_pre_checkin(reservation_id, actor_user_id=user.id)
        db.session.commit()
        link = build_pre_checkin_link(pc.token)
        flash(Markup(f'Pre-check-in link resent: <code class="text-xs select-all">{escape(link)}</code>'), "success")
    except Exception as exc:  # noqa: BLE001
        db.session.rollback()
        flash(public_error_message(exc), "error")
    return redirect(url_for("staff_reservations.staff_pre_checkin_detail", reservation_id=reservation_id))


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/pre-checkin/send-email", methods=["POST"])
def staff_pre_checkin_send_email(reservation_id):
    user = require_permission("reservation.edit")
    try:
        pc = generate_pre_checkin(reservation_id, actor_user_id=user.id)
        send_pre_checkin_link_email(pc, actor_user_id=user.id)
        db.session.commit()
        reservation = db.session.get(Reservation, reservation_id)
        guest_email = (
            pc.primary_contact_email
            or (reservation.primary_guest.email if reservation and reservation.primary_guest else None)
        )
        if guest_email:
            flash(f"Pre-check-in link sent to {guest_email}.", "success")
        else:
            link = build_pre_checkin_link(pc.token)
            flash(Markup(f'No guest email on file — link generated: <code class="text-xs select-all">{escape(link)}</code>'), "warning")
    except Exception as exc:  # noqa: BLE001
        db.session.rollback()
        flash(public_error_message(exc), "error")
    return redirect(url_for("staff_reservations.staff_pre_checkin_detail", reservation_id=reservation_id))


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/pre-checkin")
def staff_pre_checkin_detail(reservation_id):
    user = require_permission("reservation.view")
    reservation = db.session.get(Reservation, reservation_id)
    if not reservation:
        abort(404)
    pc = get_pre_checkin_for_reservation(reservation_id)
    docs = get_documents_for_reservation(reservation_id) if pc else []
    link = build_pre_checkin_link(pc.token) if pc else None
    return render_template(
        "staff_pre_checkin_detail.html",
        reservation=reservation,
        pc=pc,
        documents=docs,
        pre_checkin_link=link,
    )


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/pre-checkin/verify", methods=["POST"])
def staff_pre_checkin_verify(reservation_id):
    user = require_permission("reservation.check_in")
    pc = get_pre_checkin_for_reservation(reservation_id)
    if not pc:
        flash("No pre-check-in record found.", "error")
        return redirect(url_for("staff_reservations.staff_reservation_detail", reservation_id=reservation_id))
    try:
        mark_verified(pc, actor_user_id=user.id)
        db.session.commit()
        flash("Pre-check-in verified successfully.", "success")
    except Exception as exc:  # noqa: BLE001
        db.session.rollback()
        flash(public_error_message(exc), "error")
    return redirect(url_for("staff_reservations.staff_pre_checkin_detail", reservation_id=reservation_id))


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/pre-checkin/reject", methods=["POST"])
def staff_pre_checkin_reject(reservation_id):
    user = require_permission("reservation.check_in")
    pc = get_pre_checkin_for_reservation(reservation_id)
    if not pc:
        flash("No pre-check-in record found.", "error")
        return redirect(url_for("staff_reservations.staff_reservation_detail", reservation_id=reservation_id))
    reason = request.form.get("reason", "")
    try:
        mark_rejected(pc, actor_user_id=user.id, reason=reason)
        db.session.commit()
        flash("Pre-check-in rejected.", "warning")
    except Exception as exc:  # noqa: BLE001
        db.session.rollback()
        flash(public_error_message(exc), "error")
    return redirect(url_for("staff_reservations.staff_pre_checkin_detail", reservation_id=reservation_id))


@staff_reservations_bp.route("/staff/reservations/<uuid:reservation_id>/pre-checkin/update-guest-email", methods=["POST"])
def staff_pre_checkin_update_guest_email(reservation_id):
    """Update the primary guest's email with the address submitted via pre-check-in."""
    user = require_permission("reservation.edit")
    reservation = db.session.get(Reservation, reservation_id)
    if not reservation:
        abort(404)
    pc = get_pre_checkin_for_reservation(reservation_id)
    if not pc or not pc.primary_contact_email:
        flash("No pre-check-in email to apply.", "error")
        return redirect(url_for("staff_reservations.staff_pre_checkin_detail", reservation_id=reservation_id))
    guest = reservation.primary_guest
    if not guest:
        flash("No primary guest on this reservation.", "error")
        return redirect(url_for("staff_reservations.staff_pre_checkin_detail", reservation_id=reservation_id))
    new_email = pc.primary_contact_email.strip()
    old_email = guest.email
    if old_email == new_email:
        flash("Guest email is already up to date.", "info")
        return redirect(url_for("staff_reservations.staff_pre_checkin_detail", reservation_id=reservation_id))
    try:
        guest.email = new_email
        guest.updated_by_user_id = user.id
        db.session.flush()
        write_audit_log(
            actor_user_id=user.id,
            entity_table="guests",
            entity_id=str(guest.id),
            action="update",
            before_data={"email": old_email},
            after_data={"email": new_email, "source": "pre_checkin_write_back"},
        )
        write_activity_log(
            actor_user_id=user.id,
            event_type="guest.email_updated_from_pre_checkin",
            entity_table="guests",
            entity_id=str(guest.id),
            metadata={"reservation_id": str(reservation_id), "old_email": old_email or "", "new_email": new_email},
        )
        db.session.commit()
        flash(f"Guest email updated to {new_email}.", "success")
    except Exception as exc:  # noqa: BLE001
        db.session.rollback()
        flash(public_error_message(exc), "error")
    return redirect(url_for("staff_reservations.staff_pre_checkin_detail", reservation_id=reservation_id))


# ── Document verify/view ───────────────────────────────────────────────

@staff_reservations_bp.route("/staff/documents/<uuid:doc_id>/verify", methods=["POST"])
def staff_document_verify(doc_id):
    user = require_permission("reservation.check_in")
    status = request.form.get("verification_status", "verified")
    reason = request.form.get("rejection_reason")
    try:
        doc = verify_document(
            doc_id,
            DocumentVerifyPayload(verification_status=status, rejection_reason=reason),
            actor_user_id=user.id,
        )
        db.session.commit()
        flash(f"Document {status}.", "success" if status == "verified" else "warning")
    except Exception as exc:  # noqa: BLE001
        db.session.rollback()
        flash(public_error_message(exc), "error")
        return redirect(request.referrer or url_for("front_desk.staff_front_desk"))
    return redirect(url_for("staff_reservations.staff_pre_checkin_detail", reservation_id=doc.reservation_id))


@staff_reservations_bp.route("/staff/documents/<uuid:doc_id>/view")
def staff_document_view(doc_id):
    require_permission("reservation.view")
    doc = db.session.get(ReservationDocument, doc_id)
    if not doc:
        abort(404)
    url = get_document_serve_url(doc)
    if url is not None:
        return redirect(url)
    try:
        data = read_document_bytes(doc)
    except FileNotFoundError:
        abort(404)
    return Response(
        data,
        mimetype=doc.content_type,
        headers={"Content-Disposition": f'inline; filename="{doc.original_filename}"'},
    )


# ── Review queue ───────────────────────────────────────────────────────

@staff_reservations_bp.route("/staff/review-queue", methods=["GET", "POST"])
def staff_review_queue():
    user = require_permission("reservation.view")
    if request.method == "POST":
        entry = db.session.get(ReservationReviewQueue, UUID(request.form["entry_id"]))
        if not entry:
            abort(404)
        action = request.form["action"]
        if action == "reviewed":
            entry.review_status = "reviewed"
            entry.reviewed_at = utc_now()
            entry.reviewed_by_user_id = user.id
        elif action == "needs_follow_up":
            entry.review_status = "needs_follow_up"
        elif action == "issue_flagged":
            entry.review_status = "issue_flagged"
        elif action == "resolved":
            entry.review_status = "resolved"
        elif action == "contacted":
            entry.contacted_at = utc_now()
        entry.internal_note = request.form.get("internal_note") or entry.internal_note
        db.session.commit()
        return redirect(url_for("staff_reservations.staff_review_queue"))

    query = sa.select(ReservationReviewQueue).join(Reservation, Reservation.id == ReservationReviewQueue.reservation_id)
    arrival_date = parse_request_date_arg("arrival_date", default=None)
    if request.args.get("status"):
        query = query.where(ReservationReviewQueue.review_status == request.args["status"])
    if arrival_date:
        query = query.where(Reservation.check_in_date == arrival_date)
    if request.args.get("booking_source"):
        query = query.where(Reservation.source_channel == request.args["booking_source"])
    if request.args.get("deposit_state"):
        query = query.where(ReservationReviewQueue.deposit_state == request.args["deposit_state"])
    if request.args.get("flagged_duplicate") == "1":
        query = query.where(ReservationReviewQueue.flagged_duplicate_suspected.is_(True))
    if request.args.get("special_requests") == "1":
        query = query.where(ReservationReviewQueue.special_requests_present.is_(True))
    entries = db.session.execute(query.order_by(ReservationReviewQueue.created_at.desc())).scalars().all()
    return render_template("staff_review_queue.html", entries=entries)
