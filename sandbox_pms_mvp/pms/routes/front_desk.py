"""Front desk blueprint — workspace, detail, check-in/out, walk-in, dashboard.

Board-specific routes are in sibling modules:
  - ``front_desk_board``         — board view routes and shared helpers
  - ``front_desk_board_actions`` — board mutation routes (move, resize, closures)
  - ``front_desk_board_panel``   — board reservation panel and status transitions

All modules share the ``front_desk_bp`` Blueprint from ``front_desk_core``.
"""

from __future__ import annotations

import logging
import secrets
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

import sqlalchemy as sa
from flask import (
    Response,
    abort,
    current_app,
    flash,
    redirect,
    render_template,
    request,
    url_for,
)

from ..activity import write_activity_log
from ..constants import BOOKING_SOURCE_CHANNELS
from ..extensions import db
from ..helpers import (
    action_datetime_for_form_date,
    can,
    parse_request_date_arg,
    parse_request_uuid_arg,
    require_permission,
    require_user,
    safe_back_path,
)
from ..models import (
    EmailOutbox,
    Reservation,
    ReservationReviewQueue,
    Room,
    RoomType,
    StaffNotification,
    utc_now,
)
from ..normalization import normalize_phone
from ..security import public_error_message
from ..services.front_desk_service import (
    CheckInPayload,
    CheckoutPayload,
    FrontDeskFilters,
    NoShowPayload,
    WalkInCheckInPayload,
    complete_check_in,
    complete_checkout,
    create_walk_in_and_check_in,
    get_front_desk_detail,
    list_front_desk_workspace,
    prepare_checkout,
    process_no_show,
)
from ..services.loyalty_service import award_checkout_points
from ..services.messaging_service import (
    fire_automation_event,
    reservation_messages,
)
from ..services.reporting_service import build_front_desk_dashboard
from ..services.staff_reservations_service import (
    assign_room,
)

# Import the shared blueprint and trigger route registration in sub-modules.
from .front_desk_core import front_desk_bp  # noqa: F401 — re-exported
import pms.routes.front_desk_board as _board_mod  # noqa: F401 — registers board view routes
import pms.routes.front_desk_board_actions as _actions_mod  # noqa: F401 — registers board action routes
import pms.routes.front_desk_board_panel as _panel_mod  # noqa: F401 — registers board panel routes

# Backward-compatible re-exports so existing callers keep working.
from .front_desk_board import front_desk_board_context  # noqa: F401

logger = logging.getLogger(__name__)


# ── Check-in form helpers ────────────────────────────────────────────

CHECK_IN_FIELD_TARGETS = {
    "first_name": "check-in-first-name",
    "last_name": "check-in-last-name",
    "phone": "check-in-phone",
    "email": "check-in-email",
    "room_id": "check-in-room-id",
    "payment_method": "check-in-payment-method",
    "collect_payment_amount": "check-in-collect-payment-amount",
    "waiver_reason": "check-in-waiver-reason",
    "override_payment": "check-in-override-payment",
}
CHECK_IN_SECTION_TARGETS = {
    "identity": "check-in-identity-section",
    "contact": "check-in-contact-section",
    "room": "check-in-room-section",
    "payment": "check-in-payment-section",
    "fees": "check-in-fee-section",
}
CHECK_IN_UNEXPECTED_FALLBACK = (
    "Check-in could not be completed due to an unexpected system error. "
    "No data was lost. Please retry. If the issue continues, contact support and provide reference: {reference}"
)


def _check_in_issue(message: str, *, field: str | None = None, section: str | None = None) -> dict[str, str]:
    target_id = CHECK_IN_FIELD_TARGETS.get(field or "") or CHECK_IN_SECTION_TARGETS.get(section or "") or "check-in-errors"
    issue = {"message": message, "target_id": target_id, "href": f"#{target_id}"}
    if field:
        issue["field"] = field
    if section:
        issue["section"] = section
    return issue


def _format_money_amount(value: Decimal) -> str:
    return f"{value:,.2f}"


def _as_decimal_amount(value: object) -> Decimal:
    try:
        return Decimal(str(value or "0.00"))
    except Exception:  # noqa: BLE001
        return Decimal("0.00")


def _format_number_input_amount(value: Decimal) -> str:
    return f"{value:.2f}"


def _check_in_deposit_shortfall(reservation: Reservation) -> Decimal:
    return max(
        Decimal("0.00"),
        _as_decimal_amount(reservation.deposit_required_amount) - _as_decimal_amount(reservation.deposit_received_amount),
    )


def _check_in_form_defaults(detail: dict) -> dict[str, str]:
    reservation = detail["reservation"]
    guest = reservation.primary_guest
    defaults: dict[str, str] = {
        "first_name": guest.first_name or "" if guest else "",
        "last_name": guest.last_name or "" if guest else "",
        "phone": guest.phone or "" if guest else "",
        "email": guest.email or "" if guest else "",
        "nationality": guest.nationality or "" if guest else "",
        "id_document_type": guest.id_document_type or "" if guest else "",
        "id_document_number": guest.id_document_number or "" if guest else "",
        "preferred_language": (guest.preferred_language if guest else None) or reservation.booking_language or "",
        "notes_summary": guest.notes_summary or "" if guest else "",
        "identity_verified": "",
        "room_id": str(reservation.assigned_room_id) if reservation.assigned_room_id else "",
        "collect_payment_amount": _format_number_input_amount(_check_in_deposit_shortfall(reservation)),
        "payment_method": "front_desk",
        "arrival_note": "",
        "apply_early_fee": "",
        "waive_early_fee": "",
        "waiver_reason": "",
        "override_payment": "",
    }
    # Pre-fill from submitted pre-check-in if available
    pc_list = getattr(reservation, "pre_checkin", [])
    if pc_list:
        pc = pc_list[0] if isinstance(pc_list, list) else pc_list
        if getattr(pc, "status", None) in ("submitted", "verified"):
            if pc.primary_contact_phone:
                defaults["phone"] = pc.primary_contact_phone
            if pc.primary_contact_email:
                defaults["email"] = pc.primary_contact_email
            if pc.nationality:
                defaults["nationality"] = pc.nationality
            if pc.notes_for_staff:
                defaults["arrival_note"] = pc.notes_for_staff
    return defaults


def _checkout_form_defaults(checkout_prep: dict) -> dict[str, str]:
    return {
        "collect_payment_amount": _format_number_input_amount(max(Decimal("0.00"), _as_decimal_amount(checkout_prep.get("balance_due")))),
        "payment_method": "front_desk",
        "departure_note": "",
        "apply_late_fee": "",
        "waive_late_fee": "",
        "waiver_reason": "",
        "override_balance": "",
        "process_refund": "",
        "refund_note": "",
    }


def _build_checkout_form_state(checkout_prep: dict, *, values: dict[str, str] | None = None) -> dict[str, object]:
    return {"defaults": _checkout_form_defaults(checkout_prep), "values": values or _checkout_form_defaults(checkout_prep)}


def _parse_check_in_form_values(form_data) -> tuple[dict[str, str], dict[str, object], list[dict[str, str]]]:
    errors: list[dict[str, str]] = []
    values: dict[str, str] = {
        "first_name": (form_data.get("first_name") or "").strip(),
        "last_name": (form_data.get("last_name") or "").strip(),
        "phone": normalize_phone(form_data.get("phone") or "") or "",
        "email": (form_data.get("email") or "").strip(),
        "nationality": (form_data.get("nationality") or "").strip(),
        "id_document_type": (form_data.get("id_document_type") or "").strip(),
        "id_document_number": (form_data.get("id_document_number") or "").strip(),
        "preferred_language": (form_data.get("preferred_language") or "").strip(),
        "notes_summary": (form_data.get("notes_summary") or "").strip(),
        "room_id": (form_data.get("room_id") or "").strip(),
        "collect_payment_amount": (form_data.get("collect_payment_amount") or "0.00").strip(),
        "payment_method": (form_data.get("payment_method") or "front_desk").strip(),
        "arrival_note": (form_data.get("arrival_note") or "").strip(),
        "waiver_reason": (form_data.get("waiver_reason") or "").strip(),
        "identity_verified": "on" if form_data.get("identity_verified") == "on" else "",
        "apply_early_fee": "on" if form_data.get("apply_early_fee") == "on" else "",
        "waive_early_fee": "on" if form_data.get("waive_early_fee") == "on" else "",
        "override_payment": "on" if form_data.get("override_payment") == "on" else "",
    }

    parsed: dict[str, object] = {
        "collect_payment_amount": Decimal("0.00"),
        "identity_verified": form_data.get("identity_verified") == "on",
        "apply_early_fee": form_data.get("apply_early_fee") == "on",
        "waive_early_fee": form_data.get("waive_early_fee") == "on",
        "override_payment": form_data.get("override_payment") == "on",
        "room_uuid": None,
    }

    if not values["first_name"]:
        errors.append(_check_in_issue("Primary guest first name is required before check-in can be completed.", field="first_name"))
    if not values["last_name"]:
        errors.append(_check_in_issue("Primary guest last name is required before check-in can be completed.", field="last_name"))
    if not values["phone"]:
        errors.append(_check_in_issue("Primary guest phone number is required before check-in can be completed.", field="phone"))

    if values["room_id"]:
        try:
            parsed["room_uuid"] = UUID(values["room_id"])
        except ValueError:
            errors.append(_check_in_issue("Invalid room selected.", field="room_id"))

    try:
        amount = Decimal(values["collect_payment_amount"])
        if amount < Decimal("0.00"):
            errors.append(_check_in_issue("Payment collected now cannot be negative.", field="collect_payment_amount"))
        parsed["collect_payment_amount"] = amount
    except Exception:  # noqa: BLE001
        errors.append(_check_in_issue("Payment collected now must be a valid amount in THB.", field="collect_payment_amount"))

    return values, parsed, errors


def _check_in_blockers(detail: dict, values: dict[str, str], *, allow_override: bool) -> list[dict[str, str]]:
    blockers: list[dict[str, str]] = []
    reservation = detail["reservation"]
    if reservation.current_status in ("checked_in", "checked_out", "canceled", "no_show"):
        blockers.append(_check_in_issue(f"This reservation is already {reservation.current_status.replace('_', ' ')}.", section="identity"))
        return blockers

    if not values["room_id"]:
        if not reservation.assigned_room_id:
            blockers.append(_check_in_issue("A room must be assigned before check-in.", field="room_id"))
    else:
        try:
            room_uuid = UUID(values["room_id"])
        except ValueError:
            blockers.append(_check_in_issue("Invalid room selected.", field="room_id"))
            return blockers
        room = db.session.get(Room, room_uuid)
        if not room:
            blockers.append(_check_in_issue("Selected room not found.", field="room_id"))

    outstanding = _check_in_deposit_shortfall(reservation)
    collect = _as_decimal_amount(values.get("collect_payment_amount"))
    if outstanding > Decimal("0.00") and collect < outstanding:
        override_payment = allow_override and values.get("override_payment") == "on"
        if not override_payment:
            blockers.append(_check_in_issue("Deposit is still outstanding.", section="payment"))

    early_fee = ((detail.get("front_desk") or {}).get("early_fee") or {})
    if early_fee.get("applies") and values.get("apply_early_fee") != "on" and values.get("waive_early_fee") != "on":
        blockers.append(_check_in_issue("Early check-in fee requires a decision.", section="fees"))

    return blockers


def _build_check_in_field_errors(issues: list[dict[str, str]]) -> dict[str, str]:
    field_errors: dict[str, str] = {}
    for issue in issues:
        field = issue.get("field")
        if field and field not in field_errors:
            field_errors[field] = issue["message"]
    return field_errors


def _build_check_in_form_state(
    detail: dict,
    *,
    values: dict[str, str] | None = None,
    errors: list[dict[str, str]] | None = None,
    blockers: list[dict[str, str]] | None = None,
    allow_override: bool = False,
    unexpected_message: str | None = None,
) -> dict[str, object]:
    defaults = _check_in_form_defaults(detail)
    form_values = dict(defaults)
    if values:
        form_values.update(values)
    summary_errors = list(errors or [])
    form_blockers = list(blockers or [])
    if not summary_errors and not unexpected_message and not form_blockers:
        form_blockers = _check_in_blockers(detail, form_values, allow_override=allow_override)
    form_state: dict[str, object] = {
        "defaults": defaults,
        "values": form_values,
        "errors": summary_errors,
        "field_errors": _build_check_in_field_errors(summary_errors),
        "summary_errors": summary_errors,
        "blockers": form_blockers,
        "allow_override": allow_override,
        "unexpected_message": unexpected_message,
    }
    return form_state


def _unexpected_check_in_reference() -> str:
    return f"CHKIN-{secrets.token_hex(4).upper()}"


def _map_check_in_error(message: str) -> dict[str, str]:
    lower = message.lower()
    if "identity verification must be completed before check-in" in lower:
        return _check_in_issue("Identity verification must be completed before check-in.", section="identity")
    if "primary guest first name" in lower:
        return _check_in_issue("Primary guest first name is required before check-in can be completed.", field="first_name")
    if "primary guest last name" in lower:
        return _check_in_issue("Primary guest last name is required before check-in can be completed.", field="last_name")
    if "primary guest phone number" in lower:
        return _check_in_issue("Primary guest phone number is required before check-in can be completed.", field="phone")
    if "payment collected now must be a valid amount" in lower or ("invalid" in lower and "payment amount" in lower):
        return _check_in_issue("Payment collected now must be a valid amount in THB.", field="collect_payment_amount")
    if "payment collected now cannot be negative" in lower or ("cannot be negative" in lower and "payment" in lower):
        return _check_in_issue("Payment collected now cannot be negative.", field="collect_payment_amount")
    if "deposit is still outstanding" in lower:
        return _check_in_issue("Deposit is still outstanding.", section="payment")
    if "early check-in fee" in lower and "decision is required" in lower:
        return _check_in_issue("Early check-in fee requires a decision.", section="fees")
    if "room" in lower and ("assign" in lower or "conflict" in lower or "occupied" in lower):
        return _check_in_issue(message, field="room_id")
    if "payment" in lower or "balance" in lower or "deposit" in lower:
        return _check_in_issue(message, section="payment")
    if "identity" in lower or "document" in lower:
        return _check_in_issue(message, section="identity")
    return _check_in_issue(message)


# ── View routes ──────────────────────────────────────────────────────


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


@front_desk_bp.route("/staff/front-desk/<uuid:reservation_id>")
def staff_front_desk_detail(reservation_id):
    require_permission("reservation.view")
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
        check_in_form=_build_check_in_form_state(detail),
        checkout_form=_build_checkout_form_state(checkout_prep) if checkout_prep else None,
        comm_messages=comm_messages,
    )


# ── Action routes ────────────────────────────────────────────────────


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
    return redirect(url_for("front_desk.staff_front_desk_detail", reservation_id=reservation_id, back=request.form.get("back_url"), date=request.form.get("business_date")))


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
        action_at = action_datetime_for_form_date("business_date", default=business_date)
        complete_check_in(
            reservation_id,
            CheckInPayload(
                room_id=parsed["room_uuid"] if isinstance(parsed["room_uuid"], UUID) else None,
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
                action_at=action_at,
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
    return redirect(url_for("front_desk.staff_front_desk_detail", reservation_id=reservation_id, back=back_url, date=business_date.isoformat()))


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
                try:
                    award_checkout_points(res)
                except Exception:  # noqa: BLE001
                    logger.exception("Loyalty points award failed for checkout %s", reservation_id)
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
    return redirect(url_for("front_desk.staff_front_desk_detail", reservation_id=reservation_id, back=request.form.get("back_url"), date=request.form.get("business_date")))


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


# ── Walk-in ──────────────────────────────────────────────────────────


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
        return redirect(url_for("front_desk.staff_front_desk_detail", reservation_id=reservation.id, back=url_for("front_desk.staff_front_desk", mode="in_house")))
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
        return redirect(url_for("front_desk.staff_front_desk", mode=request.form.get("back_mode", "arrivals"), date=request.form.get("back_date")))


# ── Dashboard + notifications + service worker ───────────────────────


@front_desk_bp.route("/staff")
def staff_dashboard():
    user = require_permission("reservation.view")
    today = date.today()
    queue_entries = (
        db.session.execute(
            sa.select(ReservationReviewQueue)
            .order_by(ReservationReviewQueue.created_at.desc())
            .limit(10)
        )
        .scalars()
        .all()
    )
    notifications = (
        db.session.execute(
            sa.select(StaffNotification)
            .where(StaffNotification.status == "new")
            .order_by(StaffNotification.created_at.desc())
            .limit(10)
        )
        .scalars()
        .all()
    )
    pending_emails = db.session.execute(
        sa.select(sa.func.count())
        .select_from(EmailOutbox)
        .where(EmailOutbox.status.in_(["pending", "failed"]))
    ).scalar_one()
    dashboard = build_front_desk_dashboard(
        business_date=today,
        include_housekeeping=user.has_permission("housekeeping.view"),
        include_financials=user.has_permission("folio.view"),
    )
    # Survey stats for the last 30 days
    from ..services.survey_service import get_survey_stats
    survey_stats = get_survey_stats(
        from_date=today - timedelta(days=30),
        to_date=today,
    )
    return render_template(
        "staff_dashboard.html",
        dashboard=dashboard,
        queue_entries=queue_entries,
        notifications=notifications,
        pending_emails=pending_emails,
        arrivals_count=dashboard["arrivals"]["count"],
        departures_count=dashboard["departures"]["count"],
        in_house_count=dashboard["in_house"]["count"],
        can_housekeeping=user.has_permission("housekeeping.view"),
        can_folio=user.has_permission("folio.view"),
        can_reports=user.has_permission("reports.view"),
        survey_stats=survey_stats,
    )


@front_desk_bp.route("/staff/notifications/<uuid:notification_id>/read", methods=["POST"])
def staff_notification_read(notification_id):
    user = require_permission("reservation.view")
    notification = db.session.get(StaffNotification, notification_id)
    if not notification:
        abort(404)
    # Only allow marking your own notifications (or broadcast ones) as read
    if notification.user_id is not None and notification.user_id != user.id:
        abort(403)
    notification.status = "read"
    notification.read_at = utc_now()
    db.session.commit()
    return redirect(request.form.get("back_url") or url_for("front_desk.staff_dashboard"))


@front_desk_bp.route("/staff/sw.js")
def staff_service_worker():
    script = """
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }
  const url = new URL(event.request.url);
  const cacheName = "sandbox-hk-mobile-v1";
  if (url.pathname.startsWith("/staff/housekeeping")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(cacheName).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  if (url.pathname.startsWith("/static/") || url.pathname === "/manifest.json") {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          return cached;
        }
        return fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(cacheName).then((cache) => cache.put(event.request, copy));
          return response;
        });
      })
    );
  }
});
""".strip()
    return Response(script, mimetype="application/javascript")
