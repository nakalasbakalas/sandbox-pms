"""Front desk blueprint — workspace, board, check-in/out, walk-in, no-show."""

from __future__ import annotations

import logging
import secrets
from datetime import date, timedelta
from decimal import Decimal
from time import perf_counter
from uuid import UUID

import sqlalchemy as sa
from flask import (
    Blueprint,
    Response,
    abort,
    current_app,
    flash,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    url_for,
)

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..constants import BOOKING_SOURCE_CHANNELS
from ..extensions import db
from ..front_desk_board_runtime import (
    front_desk_board_v2_enabled,
    log_front_desk_board_metric,
)
from ..helpers import (
    action_datetime_for_form_date,
    add_anchor_to_path,
    can,
    ensure_csrf_token,
    parse_optional_datetime,
    parse_optional_uuid,
    parse_request_date_arg,
    parse_request_int_arg,
    parse_request_uuid_arg,
    require_permission,
    require_user,
    safe_back_path,
)
from ..models import (
    EmailOutbox,
    ExternalCalendarBlock,
    HousekeepingStatus,
    InventoryDay,
    InventoryOverride,
    Reservation,
    ReservationReviewQueue,
    Room,
    RoomType,
    StaffNotification,
    UserPreference,
    utc_now,
)
from ..normalization import normalize_phone
from ..security import public_error_message
from ..services.admin_service import (
    GroupRoomBlockPayload,
    InventoryOverridePayload,
    create_group_room_block,
    create_inventory_override,
    release_group_room_block,
    release_inventory_override,
    update_inventory_override,
)
from ..services.front_desk_board_service import (
    FrontDeskBoardFilters,
    build_front_desk_board,
    flatten_front_desk_blocks,
    list_front_desk_room_groups,
    serialize_front_desk_board,
)
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
from ..services.ical_service import (
    export_front_desk_blocks_ical,
    stage_ical_import,
)
from ..services.messaging_service import (
    fire_automation_event,
    reservation_messages,
)
from ..services.reporting_service import build_front_desk_dashboard
from ..services.loyalty_service import award_checkout_points
from ..services.staff_reservations_service import (
    StayDateChangePayload,
    assign_room,
    change_stay_dates,
)

logger = logging.getLogger(__name__)

front_desk_bp = Blueprint("front_desk", __name__)


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


# ── Board helper functions ────────────────────────────────────────────

def front_desk_board_filters_from_request() -> FrontDeskBoardFilters:
    start_date = parse_request_date_arg("start_date", default=date.today())
    days = parse_request_int_arg("days", default=14, minimum=7, maximum=30)
    if days not in {7, 14, 30}:
        abort(400, description="Invalid days query parameter.")
    return FrontDeskBoardFilters(
        start_date=start_date,
        days=days,
        q=(request.args.get("q") or "").strip(),
        room_type_id=parse_request_uuid_arg("room_type_id") or "",
        show_unallocated=request.args.get("show_unallocated", "1") != "0",
        show_closed=request.args.get("show_closed") == "1",
        group_by=request.args.get("group_by", "type") if request.args.get("group_by") in {"type", "floor"} else "type",
    )


def front_desk_board_context(
    filters: FrontDeskBoardFilters,
    *,
    ical_import_report: dict | None = None,
) -> dict:
    board = build_front_desk_board(filters)
    back_url = front_desk_board_url(filters)
    hydrate_front_desk_board_urls(board, back_url=back_url, board_date=filters.start_date)
    room_types = db.session.execute(sa.select(RoomType).order_by(RoomType.code.asc())).scalars().all()
    board_v2_enabled = front_desk_board_v2_enabled()

    # Load user density preference
    user_density = "compact"  # default
    user = getattr(g, "current_staff_user", None)
    if user and user.preferences:
        user_density = (user.preferences.preferences or {}).get("frontDeskBoard", {}).get("density", "compact")

    return {
        "board": board,
        "board_v2_enabled": board_v2_enabled,
        "filters": filters,
        "room_types": room_types,
        "user_density": user_density,
        "default_checkout_date": filters.start_date + timedelta(days=1),
        "can_create": can("reservation.create"),
        "can_edit": can("reservation.edit"),
        "can_manage_closures": can("operations.override"),
        "can_check_in": can("reservation.check_in"),
        "can_check_out": can("reservation.check_out"),
        "board_url": url_for("front_desk.staff_front_desk_board"),
        "board_fragment_url": url_for("front_desk.staff_front_desk_board_fragment"),
        "board_data_url": url_for("front_desk.staff_front_desk_board_data"),
        "board_rooms_url": url_for("front_desk.staff_front_desk_board_rooms"),
        "board_export_url": url_for("front_desk.staff_front_desk_board_export_ical"),
        "board_filter_query": front_desk_board_filter_query(filters),
        "board_current_url": back_url,
        "ical_import_report": ical_import_report,
    }


def front_desk_board_filter_query(filters: FrontDeskBoardFilters) -> dict[str, str]:
    query = {
        "start_date": filters.start_date.isoformat(),
        "days": str(filters.days),
        "show_unallocated": "1" if filters.show_unallocated else "0",
    }
    if filters.q:
        query["q"] = filters.q
    if filters.room_type_id:
        query["room_type_id"] = filters.room_type_id
    if filters.show_closed:
        query["show_closed"] = "1"
    if filters.group_by == "floor":
        query["group_by"] = "floor"
    return query


def front_desk_board_url(filters: FrontDeskBoardFilters) -> str:
    return url_for("front_desk.staff_front_desk_board", **front_desk_board_filter_query(filters))


def hydrate_front_desk_board_urls(board: dict, *, back_url: str, board_date: date) -> None:
    for group in board.get("groups", []):
        reassign_options = group.get("room_options", [])
        for row in group.get("rows", []):
            for block in row.get("blocks", []):
                block["backUrl"] = back_url
                block["returnAnchor"] = row.get("anchor_id")
                reservation_id = block.get("reservationId")
                override_id = block.get("overrideId")
                if reservation_id:
                    block["detailUrl"] = url_for(
                        "staff_reservations.staff_reservation_detail",
                        reservation_id=UUID(reservation_id),
                        back=back_url,
                    )
                    block["frontDeskUrl"] = url_for(
                        "front_desk.staff_front_desk_detail",
                        reservation_id=UUID(reservation_id),
                        back=back_url,
                        date=board_date.isoformat(),
                    )
                    block["reassignUrl"] = url_for(
                        "front_desk.staff_front_desk_board_assign_room",
                        reservation_id=UUID(reservation_id),
                    )
                    block["moveUrl"] = url_for(
                        "front_desk.staff_front_desk_board_move_reservation",
                        reservation_id=UUID(reservation_id),
                    )
                    block["resizeUrl"] = url_for(
                        "front_desk.staff_front_desk_board_resize_reservation",
                        reservation_id=UUID(reservation_id),
                    )
                    block["datesFormUrl"] = url_for(
                        "front_desk.staff_front_desk_board_change_dates",
                        reservation_id=UUID(reservation_id),
                    )
                    block["reassignOptions"] = reassign_options
                if override_id:
                    block["releaseUrl"] = url_for(
                        "front_desk.staff_front_desk_board_release_closure",
                        override_id=UUID(override_id),
                    )
                    block["editUrl"] = url_for(
                        "front_desk.staff_front_desk_board_update_closure",
                        override_id=UUID(override_id),
                    )
                    block["canRelease"] = True
                    block["canEdit"] = True


def _front_desk_filters_payload(filters: FrontDeskBoardFilters) -> dict[str, str | int | bool]:
    return {
        "startDate": filters.start_date.isoformat(),
        "days": filters.days,
        "q": filters.q,
        "roomTypeId": filters.room_type_id,
        "showUnallocated": filters.show_unallocated,
        "showClosed": filters.show_closed,
        "groupBy": getattr(filters, "group_by", "type"),
    }


class BoardMutationRequestError(ValueError):
    """Raised when a board mutation request has an invalid payload."""


def board_request_payload() -> dict:
    if request.is_json:
        return request.get_json(force=True) or {}
    return request.form.to_dict()


def parse_board_date(payload: dict, label: str, *field_names: str) -> date:
    raw = _first_board_payload_value(payload, *field_names)
    if not raw:
        raise BoardMutationRequestError(f"{label.capitalize()} is required.")
    try:
        return date.fromisoformat(str(raw))
    except ValueError as exc:
        raise BoardMutationRequestError(f"{label.capitalize()} must be a valid ISO date.") from exc


def parse_board_room_id(payload: dict, *, required: bool) -> UUID | None:
    raw = _first_board_payload_value(payload, "room_id", "roomId")
    if not raw:
        if required:
            raise BoardMutationRequestError("Room is required.")
        return None
    raw = str(raw).strip()
    if not raw:
        if required:
            raise BoardMutationRequestError("Room is required.")
        return None
    try:
        return UUID(raw)
    except ValueError as exc:
        raise BoardMutationRequestError("Room identifier is invalid.") from exc


def parse_board_reason(payload: dict) -> str | None:
    raw = _first_board_payload_value(payload, "reason")
    return str(raw).strip() if raw else None


def _first_board_payload_value(payload: dict, *field_names: str):
    for name in field_names:
        val = payload.get(name)
        if val is not None:
            return val
    return None


def read_ical_upload_payload() -> bytes:
    uploaded = request.files.get("ical_file")
    if uploaded:
        return uploaded.read()
    raw = request.form.get("ical_text", "").strip()
    if raw:
        return raw.encode("utf-8")
    raise ValueError("No iCalendar data provided. Upload a .ics file or paste raw iCal text.")


def record_board_mutation_rejection(
    *,
    actor_user_id: UUID,
    entity_table: str,
    entity_id: str,
    action: str,
    before_data: dict | None,
    payload: dict,
    reason: str,
) -> None:
    db.session.rollback()
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table=entity_table,
        entity_id=entity_id,
        action=action,
        before_data=before_data,
        after_data={"request": payload, "failure_reason": reason},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="front_desk.board_mutation_rejected",
        entity_table=entity_table,
        entity_id=entity_id,
        metadata={"action": action, "failure_reason": reason},
    )
    db.session.commit()


def _reservation_snapshot_for_audit(reservation_id: UUID) -> dict | None:
    reservation = db.session.get(Reservation, reservation_id)
    if not reservation:
        return None
    return {
        "assigned_room_id": str(reservation.assigned_room_id) if reservation.assigned_room_id else None,
        "current_status": reservation.current_status,
        "check_in_date": reservation.check_in_date.isoformat(),
        "check_out_date": reservation.check_out_date.isoformat(),
    }


def _inventory_override_snapshot_for_audit(override_id: UUID) -> dict | None:
    override = db.session.get(InventoryOverride, override_id)
    if not override:
        return None
    return {
        "name": override.name,
        "scope_type": override.scope_type,
        "override_action": override.override_action,
        "room_id": str(override.room_id) if override.room_id else None,
        "room_type_id": str(override.room_type_id) if override.room_type_id else None,
        "start_date": override.start_date.isoformat(),
        "end_date": override.end_date.isoformat(),
        "is_active": override.is_active,
    }


# ── Routes ────────────────────────────────────────────────────────────
#
# Planned split target (Phase 3 architecture debt reduction):
#   routes/front_desk.py        → Section: View Routes
#   routes/front_desk_board.py  → Section: Board Routes
#   routes/front_desk_actions.py → Section: Action Routes
# Each sub-module would import front_desk_bp from a shared location or
# register its own sub-blueprint. Full split is deferred until after
# beta stabilisation to avoid import-cycle risk.

# --- Section: View Routes ---


@front_desk_bp.route("/staff/front-desk")
def staff_front_desk():
    require_permission("reservation.view")
    target_date = parse_request_date_arg("date", default=date.today()) or date.today()
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


# --- Section: Board Routes ---


@front_desk_bp.route("/staff/front-desk/board")
def staff_front_desk_board():
    require_permission("reservation.view")
    filters = front_desk_board_filters_from_request()
    started_at = perf_counter()
    outcome = "error"
    context = None
    try:
        context = front_desk_board_context(filters)
        outcome = "success"
        return render_template("front_desk_board.html", **context)
    finally:
        log_front_desk_board_metric(
            event="front_desk.board.render",
            started_at=started_at,
            board=context["board"] if context else None,
            board_v2_enabled=context["board_v2_enabled"] if context else front_desk_board_v2_enabled(),
            outcome=outcome,
            response_format="html",
            days=filters.days,
            room_type_id=filters.room_type_id or None,
            has_search=bool(filters.q),
            show_unallocated=filters.show_unallocated,
            show_closed=filters.show_closed,
        )


@front_desk_bp.route("/staff/front-desk/board/fragment")
def staff_front_desk_board_fragment():
    require_permission("reservation.view")
    filters = front_desk_board_filters_from_request()
    started_at = perf_counter()
    outcome = "error"
    context = None
    try:
        context = front_desk_board_context(filters)
        outcome = "success"
        return render_template("_front_desk_board_surface.html", **context)
    finally:
        log_front_desk_board_metric(
            event="front_desk.board.fragment",
            started_at=started_at,
            board=context["board"] if context else None,
            board_v2_enabled=context["board_v2_enabled"] if context else front_desk_board_v2_enabled(),
            outcome=outcome,
            response_format="html_fragment",
            days=filters.days,
            room_type_id=filters.room_type_id or None,
            has_search=bool(filters.q),
            show_unallocated=filters.show_unallocated,
            show_closed=filters.show_closed,
        )


@front_desk_bp.route("/staff/front-desk/board/data")
def staff_front_desk_board_data():
    require_permission("reservation.view")
    filters = front_desk_board_filters_from_request()
    started_at = perf_counter()
    outcome = "error"
    context = None
    try:
        context = front_desk_board_context(filters)
        outcome = "success"
        return jsonify(
            {
                "filters": serialize_front_desk_board(_front_desk_filters_payload(filters)),
                "board": serialize_front_desk_board(context["board"]),
                "permissions": {
                    "canCreate": context["can_create"],
                    "canEdit": context["can_edit"],
                    "canManageClosures": context["can_manage_closures"],
                },
            }
        )
    finally:
        log_front_desk_board_metric(
            event="front_desk.board.data",
            started_at=started_at,
            board=context["board"] if context else None,
            board_v2_enabled=context["board_v2_enabled"] if context else front_desk_board_v2_enabled(),
            outcome=outcome,
            response_format="json",
            days=filters.days,
            room_type_id=filters.room_type_id or None,
            has_search=bool(filters.q),
            show_unallocated=filters.show_unallocated,
            show_closed=filters.show_closed,
        )


@front_desk_bp.route("/staff/front-desk/board/rooms")
def staff_front_desk_board_rooms():
    require_permission("reservation.view")
    room_type_id = parse_request_uuid_arg("room_type_id") or ""
    started_at = perf_counter()
    outcome = "error"
    groups = []
    try:
        groups = list_front_desk_room_groups(room_type_id=room_type_id)
        outcome = "success"
        return jsonify({"groups": groups})
    finally:
        log_front_desk_board_metric(
            event="front_desk.board.rooms",
            started_at=started_at,
            outcome=outcome,
            response_format="json",
            room_type_id=room_type_id or None,
            group_count=len(groups),
            row_count=sum(len(group.get("rooms", [])) for group in groups),
        )


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/room", methods=["POST"])
def staff_front_desk_board_assign_room(reservation_id):
    user = require_permission("reservation.edit")
    back_url = safe_back_path(request.form.get("back_url"), url_for("front_desk.staff_front_desk_board"))
    try:
        assign_room(
            reservation_id,
            UUID(request.form["room_id"]),
            actor_user_id=user.id,
            reason=request.form.get("reason") or "front_desk_board_reassign",
        )
        flash("Room assignment updated from the planning board.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(add_anchor_to_path(back_url, request.form.get("return_anchor")))


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/dates", methods=["POST"])
def staff_front_desk_board_change_dates(reservation_id):
    user = require_permission("reservation.edit")
    back_url = safe_back_path(request.form.get("back_url"), url_for("front_desk.staff_front_desk_board"))
    try:
        reservation = db.session.get(Reservation, reservation_id)
        if not reservation:
            raise ValueError("Reservation not found.")
        change_stay_dates(
            reservation_id,
            StayDateChangePayload(
                check_in_date=date.fromisoformat(request.form["check_in_date"]),
                check_out_date=date.fromisoformat(request.form["check_out_date"]),
                adults=int(request.form.get("adults", reservation.adults)),
                children=int(request.form.get("children", reservation.children)),
                extra_guests=int(request.form.get("extra_guests", reservation.extra_guests)),
                requested_room_id=parse_optional_uuid(request.form.get("requested_room_id")),
            ),
            actor_user_id=user.id,
        )
        flash("Stay dates updated from the planning board.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(add_anchor_to_path(back_url, request.form.get("return_anchor")))


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/move", methods=["POST"])
def staff_front_desk_board_move_reservation(reservation_id):
    user = require_permission("reservation.edit")
    started_at = perf_counter()
    payload = board_request_payload()
    before_data = _reservation_snapshot_for_audit(reservation_id)
    requested_room_id = None
    new_check_in = None
    new_check_out = None
    room_changed = False
    date_changed = False
    outcome = "error"
    status_code = 500
    message = None
    try:
        current = db.session.get(Reservation, reservation_id)
        if not current:
            raise ValueError("Reservation not found.")
        requested_room_id = parse_board_room_id(payload, required=False)
        new_check_in = parse_board_date(payload, "check-in date", "check_in_date", "checkInDate")
        new_check_out = parse_board_date(payload, "check-out date", "check_out_date", "checkOutDate")
        room_changed = requested_room_id != current.assigned_room_id
        date_changed = new_check_in != current.check_in_date or new_check_out != current.check_out_date
        if requested_room_id is None and current.assigned_room_id is not None:
            raise ValueError("Reservations cannot be moved into the unallocated lane.")
        if current.assigned_room_id is None and requested_room_id is None:
            raise ValueError("Unallocated reservations must be assigned to a room before moving dates.")
        if not room_changed and not date_changed:
            outcome = "noop"
            status_code = 200
            message = "No board change was needed."
            return jsonify({"ok": True, "message": message})
        if date_changed:
            result = change_stay_dates(
                reservation_id,
                StayDateChangePayload(
                    check_in_date=new_check_in,
                    check_out_date=new_check_out,
                    adults=current.adults,
                    children=current.children,
                    extra_guests=current.extra_guests,
                    requested_room_id=requested_room_id,
                ),
                actor_user_id=user.id,
            )
            outcome = "success"
            status_code = 200
            message = f"Reservation moved. New total {result['new_total']:.2f} THB."
            return jsonify(
                {
                    "ok": True,
                    "message": message,
                }
            )
        if requested_room_id is None:
            raise ValueError("A target room is required.")
        assign_room(
            reservation_id,
            requested_room_id,
            actor_user_id=user.id,
            reason=parse_board_reason(payload) or "front_desk_board_drag_move",
        )
        outcome = "success"
        status_code = 200
        message = "Room assignment updated."
        return jsonify({"ok": True, "message": message})
    except BoardMutationRequestError as exc:
        outcome = "invalid_request"
        status_code = 400
        message = str(exc)
        record_board_mutation_rejection(
            actor_user_id=user.id,
            entity_table="reservations",
            entity_id=str(reservation_id),
            action="front_desk_board_move_invalid_request",
            before_data=before_data,
            payload=payload,
            reason=str(exc),
        )
        return jsonify({"ok": False, "error": message}), 400
    except Exception as exc:  # noqa: BLE001
        outcome = "rejected"
        status_code = 409
        message = public_error_message(exc)
        record_board_mutation_rejection(
            actor_user_id=user.id,
            entity_table="reservations",
            entity_id=str(reservation_id),
            action="front_desk_board_move_rejected",
            before_data=before_data,
            payload=payload,
            reason=str(exc),
        )
        try:
            current_after = db.session.get(Reservation, reservation_id)
            server_state = {
                "currentRoomId": str(current_after.assigned_room_id) if current_after and current_after.assigned_room_id else None,
                "currentCheckInDate": current_after.check_in_date.isoformat() if current_after else None,
                "currentCheckOutDate": current_after.check_out_date.isoformat() if current_after else None,
            } if current_after else None
        except Exception:  # noqa: BLE001
            server_state = None
        return jsonify({"ok": False, "error": message, "code": "inventory_conflict", "serverState": server_state}), 409
    finally:
        log_front_desk_board_metric(
            event="front_desk.board.move",
            started_at=started_at,
            outcome=outcome,
            status_code=status_code,
            reservation_id=str(reservation_id),
            requested_room_id=str(requested_room_id) if requested_room_id else None,
            check_in_date=new_check_in.isoformat() if new_check_in else None,
            check_out_date=new_check_out.isoformat() if new_check_out else None,
            room_changed=room_changed,
            date_changed=date_changed,
            message=message,
        )


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/resize", methods=["POST"])
def staff_front_desk_board_resize_reservation(reservation_id):
    user = require_permission("reservation.edit")
    started_at = perf_counter()
    payload = board_request_payload()
    before_data = _reservation_snapshot_for_audit(reservation_id)
    requested_check_in = None
    requested_check_out = None
    outcome = "error"
    status_code = 500
    message = None
    try:
        current = db.session.get(Reservation, reservation_id)
        if not current:
            raise ValueError("Reservation not found.")
        if current.assigned_room_id is None:
            raise ValueError("Assign the reservation to a room before resizing stay dates.")
        requested_check_in = parse_board_date(payload, "check-in date", "check_in_date", "checkInDate")
        requested_check_out = parse_board_date(payload, "check-out date", "check_out_date", "checkOutDate")
        result = change_stay_dates(
            reservation_id,
            StayDateChangePayload(
                check_in_date=requested_check_in,
                check_out_date=requested_check_out,
                adults=current.adults,
                children=current.children,
                extra_guests=current.extra_guests,
                requested_room_id=current.assigned_room_id,
            ),
            actor_user_id=user.id,
        )
        outcome = "success"
        status_code = 200
        message = f"Stay resized. New total {result['new_total']:.2f} THB."
        return jsonify(
            {
                "ok": True,
                "message": message,
            }
        )
    except BoardMutationRequestError as exc:
        outcome = "invalid_request"
        status_code = 400
        message = str(exc)
        record_board_mutation_rejection(
            actor_user_id=user.id,
            entity_table="reservations",
            entity_id=str(reservation_id),
            action="front_desk_board_resize_invalid_request",
            before_data=before_data,
            payload=payload,
            reason=str(exc),
        )
        return jsonify({"ok": False, "error": message}), 400
    except Exception as exc:  # noqa: BLE001
        outcome = "rejected"
        status_code = 409
        message = public_error_message(exc)
        record_board_mutation_rejection(
            actor_user_id=user.id,
            entity_table="reservations",
            entity_id=str(reservation_id),
            action="front_desk_board_resize_rejected",
            before_data=before_data,
            payload=payload,
            reason=str(exc),
        )
        try:
            current_after = db.session.get(Reservation, reservation_id)
            server_state = {
                "currentRoomId": str(current_after.assigned_room_id) if current_after and current_after.assigned_room_id else None,
                "currentCheckInDate": current_after.check_in_date.isoformat() if current_after else None,
                "currentCheckOutDate": current_after.check_out_date.isoformat() if current_after else None,
            } if current_after else None
        except Exception:  # noqa: BLE001
            server_state = None
        return jsonify({"ok": False, "error": message, "code": "inventory_conflict", "serverState": server_state}), 409
    finally:
        log_front_desk_board_metric(
            event="front_desk.board.resize",
            started_at=started_at,
            outcome=outcome,
            status_code=status_code,
            reservation_id=str(reservation_id),
            check_in_date=requested_check_in.isoformat() if requested_check_in else None,
            check_out_date=requested_check_out.isoformat() if requested_check_out else None,
            message=message,
        )


@front_desk_bp.route("/staff/front-desk/board/closures", methods=["POST"])
def staff_front_desk_board_create_closure():
    user = require_permission("operations.override")
    back_url = safe_back_path(request.form.get("back_url"), url_for("front_desk.staff_front_desk_board"))
    payload = request.form.to_dict()
    try:
        room_id = parse_board_room_id(payload, required=True)
        room = db.session.get(Room, room_id)
        if not room:
            raise ValueError("Selected room was not found.")
        closure_name = (payload.get("name") or "").strip() or f"Room {room.room_number} closure"
        create_inventory_override(
            InventoryOverridePayload(
                name=closure_name,
                scope_type="room",
                override_action="close",
                room_id=room_id,
                room_type_id=None,
                start_date=parse_board_date(payload, "closure start date", "start_date"),
                end_date=parse_board_date(payload, "closure end date", "end_date"),
                reason=payload.get("reason", ""),
                expires_at=parse_optional_datetime(payload.get("expires_at")),
            ),
            actor_user_id=user.id,
        )
        flash("Room closure created from the planning board.", "success")
    except Exception as exc:  # noqa: BLE001
        record_board_mutation_rejection(
            actor_user_id=user.id,
            entity_table="inventory_overrides",
            entity_id=str(payload.get("room_id") or "new"),
            action="front_desk_board_closure_create_rejected",
            before_data=None,
            payload=payload,
            reason=str(exc),
        )
        flash(public_error_message(exc), "error")
    return redirect(add_anchor_to_path(back_url, request.form.get("return_anchor") or "board-top"))


@front_desk_bp.route("/staff/front-desk/board/closures/<uuid:override_id>", methods=["POST"])
def staff_front_desk_board_update_closure(override_id):
    user = require_permission("operations.override")
    back_url = safe_back_path(request.form.get("back_url"), url_for("front_desk.staff_front_desk_board"))
    override = db.session.get(InventoryOverride, override_id)
    payload = request.form.to_dict()
    before_data = _inventory_override_snapshot_for_audit(override_id)
    try:
        room_id = parse_board_room_id(payload, required=False)
        if room_id is None:
            room_id = override.room_id if override else None
        if room_id is None:
            raise ValueError("Selected room was not found.")
        room = db.session.get(Room, room_id)
        if not room:
            raise ValueError("Selected room was not found.")
        closure_name = (payload.get("name") or "").strip() or f"Room {room.room_number} closure"
        update_inventory_override(
            override_id,
            InventoryOverridePayload(
                name=closure_name,
                scope_type="room",
                override_action="close",
                room_id=room_id,
                room_type_id=None,
                start_date=parse_board_date(payload, "closure start date", "start_date"),
                end_date=parse_board_date(payload, "closure end date", "end_date"),
                reason=payload.get("reason", ""),
                expires_at=parse_optional_datetime(payload.get("expires_at")),
            ),
            actor_user_id=user.id,
        )
        flash("Room closure updated.", "success")
    except Exception as exc:  # noqa: BLE001
        record_board_mutation_rejection(
            actor_user_id=user.id,
            entity_table="inventory_overrides",
            entity_id=str(override_id),
            action="front_desk_board_closure_update_rejected",
            before_data=before_data,
            payload=payload,
            reason=str(exc),
        )
        flash(public_error_message(exc), "error")
    return redirect(add_anchor_to_path(back_url, request.form.get("return_anchor") or "board-top"))


@front_desk_bp.route("/staff/front-desk/board/closures/<uuid:override_id>/release", methods=["POST"])
def staff_front_desk_board_release_closure(override_id):
    user = require_permission("operations.override")
    back_url = safe_back_path(request.form.get("back_url"), url_for("front_desk.staff_front_desk_board"))
    payload = request.form.to_dict()
    before_data = _inventory_override_snapshot_for_audit(override_id)
    try:
        release_inventory_override(override_id, actor_user_id=user.id)
        flash("Room closure released.", "success")
    except Exception as exc:  # noqa: BLE001
        record_board_mutation_rejection(
            actor_user_id=user.id,
            entity_table="inventory_overrides",
            entity_id=str(override_id),
            action="front_desk_board_closure_release_rejected",
            before_data=before_data,
            payload=payload,
            reason=str(exc),
        )
        flash(public_error_message(exc), "error")
    return redirect(add_anchor_to_path(back_url, request.form.get("return_anchor")))


@front_desk_bp.route("/staff/front-desk/board/group-blocks", methods=["POST"])
def staff_front_desk_board_create_group_block():

    user = require_permission("operations.override")
    back_url = safe_back_path(request.form.get("back_url"), url_for("front_desk.staff_front_desk_board"))
    try:
        overrides = create_group_room_block(
            GroupRoomBlockPayload(
                group_code=request.form.get("group_code", ""),
                room_type_id=UUID(request.form["room_type_id"]),
                room_count=int(request.form.get("room_count") or "0"),
                start_date=date.fromisoformat(request.form["start_date"]),
                end_date=date.fromisoformat(request.form["end_date"]),
                reason=request.form.get("reason"),
            ),
            actor_user_id=user.id,
        )
        flash(f"Group block created with {len(overrides)} room(s).", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(add_anchor_to_path(back_url, request.form.get("return_anchor") or "board-top"))


@front_desk_bp.route("/staff/front-desk/board/group-blocks/release", methods=["POST"])
def staff_front_desk_board_release_group_block():

    user = require_permission("operations.override")
    back_url = safe_back_path(request.form.get("back_url"), url_for("front_desk.staff_front_desk_board"))
    group_code = request.form.get("group_code", "")
    try:
        release_group_room_block(group_code, actor_user_id=user.id)
        flash("Group room block released.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(add_anchor_to_path(back_url, request.form.get("return_anchor") or "board-top"))


@front_desk_bp.route("/staff/front-desk/board/export.ics")
def staff_front_desk_board_export_ical():
    require_permission("reservation.view")
    filters = front_desk_board_filters_from_request()
    context = front_desk_board_context(filters)
    selected_block_ids = {item for item in request.args.getlist("block_id") if item}
    blocks = flatten_front_desk_blocks(context["board"], visible_only=request.args.get("include_hidden") != "1")
    if selected_block_ids:
        blocks = [block for block in blocks if block["id"] in selected_block_ids]
    payload = export_front_desk_blocks_ical(
        blocks,
        calendar_name=f"Front Desk Board {context['board']['current_window_label']}",
    )
    response = Response(payload, mimetype="text/calendar")
    response.headers["Content-Disposition"] = 'inline; filename="front-desk-board.ics"'
    response.headers["Cache-Control"] = "private, max-age=60"
    return response


@front_desk_bp.route("/staff/front-desk/board/import.ics", methods=["POST"])
def staff_front_desk_board_import_ical():
    require_permission("reservation.edit")
    filters = front_desk_board_filters_from_request()
    try:
        payload = read_ical_upload_payload()
        report = stage_ical_import(
            payload,
            known_uids=set(db.session.execute(sa.select(ExternalCalendarBlock.external_uid)).scalars().all()),
        )
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
        report = None
    return render_template("front_desk_board.html", **front_desk_board_context(filters, ical_import_report=report))


@front_desk_bp.route("/staff/front-desk/board/preferences", methods=["POST"])
def staff_front_desk_board_preferences():
    """Save user's front desk board preferences (density, layout, etc)."""
    user = require_permission("reservation.view")
    payload = request.get_json() or {}
    density = payload.get("density", "compact")

    if density not in ["comfortable", "compact", "spacious", "ultra"]:
        abort(400, "Invalid density value")

    pref = db.session.execute(sa.select(UserPreference).filter_by(user_id=user.id)).scalar_one_or_none()
    if not pref:
        pref = UserPreference(user_id=user.id, preferences={})
        db.session.add(pref)

    if "frontDeskBoard" not in pref.preferences:
        pref.preferences["frontDeskBoard"] = {}

    pref.preferences["frontDeskBoard"]["density"] = density
    db.session.commit()

    write_activity_log(
        actor_user_id=user.id,
        event_type="front_desk.board_density_changed",
        metadata={"density": density},
    )

    return jsonify(ok=True, density=density)


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/check_in", methods=["POST"])
def staff_front_desk_board_check_in(reservation_id):
    """Check in a reservation via the front desk board."""
    user = require_permission("reservation.check_in")
    reservation = db.session.get(Reservation, reservation_id) or abort(404)

    if reservation.current_status in ("checked_in", "checked_out"):
        return jsonify(ok=False, error=f"Cannot check in a {reservation.current_status} reservation.")

    try:
        complete_check_in(
            reservation_id,
            CheckInPayload(
                room_id=reservation.assigned_room_id,
                first_name=reservation.primary_guest.first_name or "",
                last_name=reservation.primary_guest.last_name or "",
                phone=reservation.primary_guest.phone or "",
                email=reservation.primary_guest.email,
                nationality=reservation.primary_guest.nationality,
                id_document_type=reservation.primary_guest.id_document_type,
                id_document_number=reservation.primary_guest.id_document_number,
                preferred_language=reservation.primary_guest.preferred_language or reservation.booking_language,
                notes_summary=reservation.primary_guest.notes_summary,
                identity_verified=reservation.identity_verified_at is not None,
            ),
            actor_user_id=user.id,
        )

        write_activity_log(
            actor_user_id=user.id,
            event_type="front_desk.board_check_in",
            entity_table="reservations",
            entity_id=str(reservation_id),
            metadata={"via": "board_keyboard"},
        )

        db.session.refresh(reservation)
        try:
            fire_automation_event(
                "arrival_today",
                reservation_id=str(reservation_id),
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
            logger.exception("Automation hook failed for arrival_today (board)")
        return jsonify(ok=True, message="Checked in.", status=reservation.current_status)
    except Exception as exc:
        write_audit_log(
            actor_user_id=user.id,
            entity_table="reservations",
            entity_id=str(reservation_id),
            action="front_desk_board_check_in_failed",
            after_data={"error": str(exc)},
        )
        return jsonify(ok=False, error=str(exc)), 409


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/check_out", methods=["POST"])
def staff_front_desk_board_check_out(reservation_id):
    """Check out a reservation via the front desk board."""
    user = require_permission("reservation.check_out")
    reservation = db.session.get(Reservation, reservation_id) or abort(404)

    if reservation.current_status in ("checked_out", "canceled"):
        return jsonify(ok=False, error=f"Cannot check out a {reservation.current_status} reservation.")

    try:
        complete_checkout(reservation_id, CheckoutPayload(), actor_user_id=user.id)

        write_activity_log(
            actor_user_id=user.id,
            event_type="front_desk.board_check_out",
            entity_table="reservations",
            entity_id=str(reservation_id),
            metadata={"via": "board_keyboard"},
        )

        db.session.refresh(reservation)
        try:
            award_checkout_points(reservation)
        except Exception:  # noqa: BLE001
            logger.exception("Loyalty points award failed for board checkout %s", reservation_id)
        try:
            fire_automation_event(
                "checkout_completed",
                reservation_id=str(reservation_id),
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
            logger.exception("Automation hook failed for checkout_completed (board)")
        return jsonify(ok=True, message="Checked out.", status=reservation.current_status)
    except Exception as exc:
        write_audit_log(
            actor_user_id=user.id,
            entity_table="reservations",
            entity_id=str(reservation_id),
            action="front_desk_board_check_out_failed",
            after_data={"error": str(exc)},
        )
        return jsonify(ok=False, error=str(exc)), 409


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/room-ready", methods=["POST"])
def staff_front_desk_board_room_ready(reservation_id):
    """Mark the assigned room for a reservation as clean via the board context menu."""
    user = require_permission("reservation.edit")
    reservation = db.session.get(Reservation, reservation_id) or abort(404)
    if not reservation.assigned_room_id:
        return jsonify(ok=False, error="No room assigned to this reservation."), 400
    from ..services.housekeeping_service import RoomStatusUpdatePayload, update_housekeeping_status
    try:
        update_housekeeping_status(
            reservation.assigned_room_id,
            business_date=date.today(),
            payload=RoomStatusUpdatePayload(status_code="clean", note="Marked ready via front desk board"),
            actor_user_id=user.id,
        )
        write_audit_log(
            actor_user_id=user.id,
            entity_table="reservations",
            entity_id=str(reservation_id),
            action="board_mark_room_ready",
            after_data={"room_id": str(reservation.assigned_room_id)},
        )
        return jsonify(ok=True, message="Room marked clean.")
    except Exception as exc:  # noqa: BLE001
        return jsonify(ok=False, error=str(exc)), 409


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/panel", methods=["GET"])
def staff_front_desk_board_reservation_panel(reservation_id):
    """Load panel content for a reservation."""
    user = require_permission("reservation.view")
    reservation = db.session.get(Reservation, reservation_id) or abort(404)

    can_reassign = user.has_permission("reservation.edit")
    can_change_dates = user.has_permission("reservation.edit")
    can_check_in_perm = user.has_permission("reservation.check_in") and reservation.current_status in ["tentative", "confirmed"]
    can_check_out_perm = user.has_permission("reservation.check_out") and reservation.current_status == "checked_in"

    available_rooms = []
    if can_reassign and reservation.room_type_id:
        all_rooms = db.session.execute(
            sa.select(Room).filter(
                Room.room_type_id == reservation.room_type_id,
                Room.is_active.is_(True),
            ).order_by(Room.room_number)
        ).scalars().all()
        conflict_statuses = {"tentative", "confirmed", "checked_in", "house_use"}
        conflicting_room_ids = set(
            db.session.execute(
                sa.select(Reservation.assigned_room_id).filter(
                    Reservation.id != reservation.id,
                    Reservation.assigned_room_id.isnot(None),
                    Reservation.current_status.in_(conflict_statuses),
                    Reservation.check_in_date < reservation.check_out_date,
                    Reservation.check_out_date > reservation.check_in_date,
                )
            ).scalars().all()
        )
        for room in all_rooms:
            label = f"Room {room.room_number} — Floor {room.floor_number}"
            if room.id in conflicting_room_ids:
                label += " (unavailable)"
            available_rooms.append({"id": str(room.id), "label": label, "available": room.id not in conflicting_room_ids})

    # Check if arrival today and assigned room is dirty (turnaround conflict)
    is_conflict_room = False
    if (
        reservation.assigned_room_id
        and reservation.current_status in ("tentative", "confirmed")
        and reservation.check_in_date <= date.today()
    ):
        hk_code = db.session.execute(
            sa.select(HousekeepingStatus.code).join(
                InventoryDay, InventoryDay.housekeeping_status_id == HousekeepingStatus.id
            ).where(
                InventoryDay.room_id == reservation.assigned_room_id,
                InventoryDay.business_date == date.today(),
            )
        ).scalar_one_or_none()
        is_conflict_room = hk_code in ("dirty", "occupied_dirty")

    context = {
        "reservation": reservation,
        "can_reassign": can_reassign,
        "can_change_dates": can_change_dates,
        "can_check_in": can_check_in_perm,
        "can_check_out": can_check_out_perm,
        "available_rooms": available_rooms,
        "csrf_token": ensure_csrf_token(),
        "nights": (reservation.check_out_date - reservation.check_in_date).days,
        "balance": max(Decimal(0), Decimal(str(reservation.quoted_grand_total or 0)) - Decimal(str(reservation.deposit_received_amount or 0))),
        "payment_state": "paid" if Decimal(str(reservation.deposit_received_amount or 0)) >= Decimal(str(reservation.quoted_grand_total or 0)) and Decimal(str(reservation.quoted_grand_total or 0)) > 0 else ("partial" if Decimal(str(reservation.deposit_received_amount or 0)) > 0 else "unpaid"),
        "recent_notes": list(reservation.notes[:5]) if reservation.notes else [],
        "can_cancel": user.has_permission("reservation.edit") and reservation.current_status in ["tentative", "confirmed"],
        "can_no_show": user.has_permission("reservation.edit") and reservation.current_status in ["tentative", "confirmed"] and reservation.check_in_date <= date.today(),
        "is_conflict_room": is_conflict_room,
    }

    return render_template("_panel_reservation_details.html", **context)


# --- Section: View Routes (walk-in, detail) ---


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


# --- Section: Action Routes ---


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


# ── Dashboard + notifications + stats panel + service worker ──────────


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
    require_permission("reservation.view")
    notification = db.session.get(StaffNotification, notification_id)
    if not notification:
        abort(404)
    notification.status = "read"
    notification.read_at = utc_now()
    db.session.commit()
    return redirect(request.form.get("back_url") or url_for("front_desk.staff_dashboard"))


@front_desk_bp.route("/staff/front-desk/board/stats-panel")
def staff_front_desk_board_stats_panel():
    require_permission("reservation.view")
    try:
        filters = front_desk_board_filters_from_request()
        context = front_desk_board_context(filters)
        return render_template("_front_desk_board_stats_panel.html", **context)
    except Exception:  # noqa: BLE001
        return "<p class='small muted'>Stats unavailable.</p>", 200


@front_desk_bp.route("/staff/front-desk/board/handover-panel")
def staff_front_desk_board_handover_panel():
    require_permission("reservation.view")
    try:
        filters = front_desk_board_filters_from_request()
        context = front_desk_board_context(filters)
        return render_template("_front_desk_board_handover_panel.html", **context)
    except Exception:  # noqa: BLE001
        return "<p class='small muted'>Handover data unavailable.</p>", 200


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
