"""Front desk workspace, detail, and check-in/out routes."""

from __future__ import annotations

from .front_desk_base import *  # noqa: F401,F403
from . import front_desk_base as _base

_build_check_in_form_state = _base._build_check_in_form_state
_build_checkout_form_state = _base._build_checkout_form_state
_check_in_blockers = _base._check_in_blockers
_map_check_in_error = _base._map_check_in_error
_parse_check_in_form_values = _base._parse_check_in_form_values
_unexpected_check_in_reference = _base._unexpected_check_in_reference


@front_desk_bp.route("/staff/front-desk")
def staff_front_desk():
    require_permission("reservation.view")
    target_date = parse_request_date_arg("date", default=date.today())
    filters = FrontDeskFilters(
        business_date=target_date,
        mode=request.args.get("mode", "arrivals"),
        room_type_id=parse_request_uuid_arg("room_type_id") or "",
        assigned=request.args.get("assigned", ""),
        ready=request.args.get("ready", ""),
        payment_state=request.args.get("payment_state", ""),
        booking_source=request.args.get("booking_source", ""),
        flagged=request.args.get("flagged", ""),
    )
    workspace = list_front_desk_workspace(filters)
    return render_template(
        "front_desk_workspace.html",
        workspace=workspace,
        filters=filters,
        room_types=db.session.execute(sa.select(RoomType).order_by(RoomType.code.asc())).scalars().all(),
        booking_sources=BOOKING_SOURCE_CHANNELS,
        walk_in_checkout_default=target_date + timedelta(days=1),
        can_folio=can("folio.view"),
        can_check_in=can("reservation.check_in"),
        can_check_out=can("reservation.check_out"),
        can_edit=can("reservation.edit"),
        can_create=can("reservation.create"),
        can_collect_payment=can("payment.create"),
        can_charge=can("folio.charge_add"),
    )


@front_desk_bp.route("/staff/front-desk/walk-in", methods=["POST"])
def staff_front_desk_walk_in():
    user = require_permission("reservation.create")
    if not user.has_permission("reservation.check_in"):
        abort(403)
    collect_payment_amount = Decimal(request.form.get("collect_payment_amount") or "0.00")
    if collect_payment_amount > Decimal("0.00") and not user.has_permission("payment.create"):
        abort(403)
    if request.form.get("apply_early_fee") == "on" and not user.has_permission("folio.charge_add"):
        abort(403)
    try:
        reservation = create_walk_in_and_check_in(
            WalkInCheckInPayload(
                first_name=request.form.get("first_name", ""),
                last_name=request.form.get("last_name", ""),
                phone=request.form.get("phone", ""),
                email=request.form.get("email"),
                room_type_id=UUID(request.form["room_type_id"]),
                check_in_date=date.fromisoformat(request.form["check_in_date"]),
                check_out_date=date.fromisoformat(request.form["check_out_date"]),
                adults=int(request.form.get("adults", 1)),
                children=int(request.form.get("children", 0)),
                extra_guests=int(request.form.get("extra_guests", 0)),
                room_id=UUID(request.form["room_id"]) if request.form.get("room_id") else None,
                special_requests=request.form.get("special_requests"),
                internal_notes=request.form.get("internal_notes"),
                nationality=request.form.get("nationality"),
                id_document_type=request.form.get("id_document_type"),
                id_document_number=request.form.get("id_document_number"),
                preferred_language=request.form.get("preferred_language"),
                notes_summary=request.form.get("notes_summary"),
                identity_verified=request.form.get("identity_verified") == "on",
                collect_payment_amount=collect_payment_amount,
                payment_method=request.form.get("payment_method", "front_desk"),
                apply_early_fee=request.form.get("apply_early_fee") == "on",
                waive_early_fee=request.form.get("waive_early_fee") == "on",
                waiver_reason=request.form.get("waiver_reason"),
            ),
            actor_user_id=user.id,
        )
        flash(f"Walk-in checked in under {reservation.reservation_code}.", "success")
        return redirect(
            url_for(
                "front_desk.staff_front_desk_detail",
                reservation_id=reservation.id,
                back=url_for("front_desk.staff_front_desk", mode="in_house"),
            )
        )
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
        return redirect(
            url_for(
                "front_desk.staff_front_desk",
                mode=request.form.get("back_mode", "arrivals"),
                date=request.form.get("back_date"),
            )
        )


@front_desk_bp.route("/staff/front-desk/<uuid:reservation_id>")
def staff_front_desk_detail(reservation_id):
    user = require_permission("reservation.view")
    business_date = parse_request_date_arg("date", default=date.today())
    detail = get_front_desk_detail(reservation_id, business_date=business_date)
    checkout_prep = prepare_checkout(reservation_id) if detail["reservation"].current_status == "checked_in" else None
    comm_messages = reservation_messages(str(reservation_id)) if can("messaging.view") else []
    return render_template(
        "front_desk_detail.html",
        detail=detail,
        checkout_prep=checkout_prep,
        back_url=safe_back_path(request.args.get("back"), url_for("front_desk.staff_front_desk")),
        business_date=business_date,
        can_folio=can("folio.view"),
        can_charge=can("folio.charge_add"),
        can_collect_payment=can("payment.create"),
        check_in_form=_build_check_in_form_state(
            detail,
            allow_override=any(role.code in {"admin", "manager"} for role in user.roles),
        ),
        checkout_form=_build_checkout_form_state(checkout_prep) if checkout_prep else None,
        comm_messages=comm_messages,
    )


@front_desk_bp.route("/staff/front-desk/<uuid:reservation_id>/room", methods=["POST"])
def staff_front_desk_assign_room(reservation_id):
    user = require_permission("reservation.edit")
    try:
        assign_room(
            reservation_id,
            UUID(request.form["room_id"]),
            actor_user_id=user.id,
            reason=request.form.get("reason") or "front_desk_move",
        )
        flash("Room assignment updated.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(
        url_for(
            "front_desk.staff_front_desk_detail",
            reservation_id=reservation_id,
            back=request.form.get("back_url"),
            date=request.form.get("business_date"),
        )
    )


@front_desk_bp.route("/staff/front-desk/<uuid:reservation_id>/check-in", methods=["POST"])
def staff_front_desk_check_in(reservation_id):
    user = require_permission("reservation.check_in")
    business_date_raw = (request.form.get("business_date") or "").strip()
    try:
        business_date = date.fromisoformat(business_date_raw) if business_date_raw else date.today()
    except ValueError:
        business_date = date.today()
    back_url = safe_back_path(request.form.get("back_url"), url_for("front_desk.staff_front_desk"))

    def render_check_in_error(
        *,
        errors: list[dict[str, str]] | None = None,
        blockers: list[dict[str, str]] | None = None,
        unexpected_message: str | None = None,
        status_code: int = 400,
        values: dict[str, str] | None = None,
    ):
        detail = get_front_desk_detail(reservation_id, business_date=business_date)
        checkout_prep = prepare_checkout(reservation_id) if detail["reservation"].current_status == "checked_in" else None
        comm_messages = reservation_messages(str(reservation_id)) if can("messaging.view") else []
        return (
            render_template(
                "front_desk_detail.html",
                detail=detail,
                checkout_prep=checkout_prep,
                back_url=back_url,
                business_date=business_date,
                can_folio=can("folio.view"),
                can_charge=can("folio.charge_add"),
                can_collect_payment=can("payment.create"),
                check_in_form=_build_check_in_form_state(
                    detail,
                    values=values,
                    errors=errors,
                    blockers=blockers,
                    allow_override=any(role.code in {"admin", "manager"} for role in user.roles),
                    unexpected_message=unexpected_message,
                ),
                checkout_form=_build_checkout_form_state(checkout_prep) if checkout_prep else None,
                comm_messages=comm_messages,
            ),
            status_code,
        )

    values, parsed, parse_errors = _parse_check_in_form_values(request.form)
    collect_payment_amount = parsed["collect_payment_amount"] if isinstance(parsed["collect_payment_amount"], Decimal) else Decimal("0.00")
    if parse_errors:
        detail = get_front_desk_detail(reservation_id, business_date=business_date)
        validation_errors = list(parse_errors)
        seen_messages = {issue["message"] for issue in validation_errors}
        for blocker in _check_in_blockers(
            detail,
            values,
            allow_override=any(role.code in {"admin", "manager"} for role in user.roles),
        ):
            if blocker["message"] not in seen_messages:
                validation_errors.append(blocker)
                seen_messages.add(blocker["message"])
        return render_check_in_error(errors=validation_errors, values=values)
    if collect_payment_amount > Decimal("0.00") and not user.has_permission("payment.create"):
        abort(403)
    if request.form.get("apply_early_fee") == "on" and not user.has_permission("folio.charge_add"):
        abort(403)
    if values["room_id"]:
        reservation = db.session.get(Reservation, reservation_id)
        if reservation and str(reservation.assigned_room_id) != values["room_id"] and not user.has_permission("reservation.edit"):
            abort(403)
    detail = get_front_desk_detail(reservation_id, business_date=business_date)
    blockers = _check_in_blockers(
        detail,
        values,
        allow_override=any(role.code in {"admin", "manager"} for role in user.roles),
    )
    if blockers:
        return render_check_in_error(blockers=blockers, values=values)
    try:
        from .. import app as pms_app

        pms_app.complete_check_in(
            reservation_id,
            CheckInPayload(
                room_id=parsed["room_uuid"],
                first_name=values["first_name"],
                last_name=values["last_name"],
                phone=values["phone"],
                email=values["email"],
                nationality=values["nationality"],
                id_document_type=values["id_document_type"],
                id_document_number=values["id_document_number"],
                preferred_language=values["preferred_language"],
                notes_summary=values["notes_summary"],
                identity_verified=bool(parsed["identity_verified"]),
                collect_payment_amount=collect_payment_amount,
                payment_method=values["payment_method"],
                arrival_note=values["arrival_note"],
                apply_early_fee=bool(parsed["apply_early_fee"]),
                waive_early_fee=bool(parsed["waive_early_fee"]),
                waiver_reason=values["waiver_reason"],
                override_payment=bool(parsed["override_payment"]),
            ),
            actor_user_id=user.id,
        )
        flash("Guest checked in.", "success")
        try:
            res = db.session.get(Reservation, reservation_id)
            if res:
                fire_automation_event(
                    "arrival_today",
                    reservation_id=str(reservation_id),
                    guest_id=str(res.primary_guest_id) if res.primary_guest_id else None,
                    context={
                        "reservation_code": res.reservation_code,
                        "guest_name": res.primary_guest.full_name if res.primary_guest else "",
                        "check_in_date": str(res.check_in_date),
                        "check_out_date": str(res.check_out_date),
                        "hotel_name": current_app.config.get("HOTEL_NAME", ""),
                    },
                )
        except Exception:  # noqa: BLE001
            logger.exception("Automation hook failed for arrival_today")
    except ValueError as exc:
        db.session.rollback()
        return render_check_in_error(errors=[_map_check_in_error(str(exc))], values=values)
    except Exception:  # noqa: BLE001
        db.session.rollback()
        error_reference = _unexpected_check_in_reference()
        current_app.logger.exception("check-in completion failed", extra={"check_in_reference": error_reference})
        return render_check_in_error(
            unexpected_message=CHECK_IN_UNEXPECTED_FALLBACK.format(reference=error_reference),
            status_code=500,
            values=values,
        )
    return redirect(
        url_for(
            "front_desk.staff_front_desk_detail",
            reservation_id=reservation_id,
            back=back_url,
            date=business_date.isoformat(),
        )
    )


@front_desk_bp.route("/staff/front-desk/<uuid:reservation_id>/check-out", methods=["POST"])
def staff_front_desk_check_out(reservation_id):
    user = require_permission("reservation.check_out")
    collect_payment_amount = Decimal(request.form.get("collect_payment_amount") or "0.00")
    if collect_payment_amount > Decimal("0.00") and not user.has_permission("payment.create"):
        abort(403)
    if request.form.get("apply_late_fee") == "on" and not user.has_permission("folio.charge_add"):
        abort(403)
    try:
        complete_checkout(
            reservation_id,
            CheckoutPayload(
                collect_payment_amount=collect_payment_amount,
                payment_method=request.form.get("payment_method", "front_desk"),
                departure_note=request.form.get("departure_note"),
                apply_late_fee=request.form.get("apply_late_fee") == "on",
                waive_late_fee=request.form.get("waive_late_fee") == "on",
                waiver_reason=request.form.get("waiver_reason"),
                override_balance=request.form.get("override_balance") == "on",
                process_refund=request.form.get("process_refund") == "on",
                refund_note=request.form.get("refund_note"),
            ),
            actor_user_id=user.id,
        )
        flash("Guest checked out and room handed to housekeeping.", "success")
        try:
            res = db.session.get(Reservation, reservation_id)
            if res:
                fire_automation_event(
                    "checkout_completed",
                    reservation_id=str(reservation_id),
                    guest_id=str(res.primary_guest_id) if res.primary_guest_id else None,
                    context={
                        "reservation_code": res.reservation_code,
                        "guest_name": res.primary_guest.full_name if res.primary_guest else "",
                        "check_in_date": str(res.check_in_date),
                        "check_out_date": str(res.check_out_date),
                        "hotel_name": current_app.config.get("HOTEL_NAME", ""),
                    },
                )
        except Exception:  # noqa: BLE001
            logger.exception("Automation hook failed for checkout_completed")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(
        url_for(
            "front_desk.staff_front_desk_detail",
            reservation_id=reservation_id,
            back=request.form.get("back_url"),
            date=request.form.get("business_date"),
        )
    )


@front_desk_bp.route("/staff/front-desk/<uuid:reservation_id>/no-show", methods=["POST"])
def staff_front_desk_no_show(reservation_id):
    user = require_user()
    if not (user.has_permission("reservation.cancel") or user.has_permission("reservation.check_in")):
        abort(403)
    try:
        process_no_show(
            reservation_id,
            NoShowPayload(reason=request.form.get("reason")),
            actor_user_id=user.id,
        )
        flash("Reservation marked as no-show.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("front_desk.staff_front_desk", mode="arrivals", date=request.form.get("business_date")))
