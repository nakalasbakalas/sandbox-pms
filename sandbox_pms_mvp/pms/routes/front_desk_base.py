"""Shared front desk blueprint state and helpers."""

from __future__ import annotations

import logging
import secrets
import sys
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
    current_app_testing,
    current_user,
    ensure_csrf_token,
    parse_optional_datetime,
    parse_optional_uuid,
    parse_request_date_arg,
    parse_request_int_arg,
    parse_request_uuid_arg,
    require_any_permission,
    require_permission,
    require_user,
    safe_back_path,
)
from ..models import (
    ExternalCalendarBlock,
    InventoryOverride,
    Reservation,
    Room,
    RoomType,
    UserPreference,
)
from ..normalization import normalize_phone
from ..security import public_error_message
from ..services.admin_inventory_ops import (
    GroupRoomBlockPayload,
    create_group_room_block,
    release_group_room_block,
)
from ..services.admin_service import (
    InventoryOverridePayload,
    create_inventory_override,
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
from ..services.staff_reservations_service import (
    StayDateChangePayload,
    assign_room,
    change_stay_dates,
)

logger = logging.getLogger(__name__)

front_desk_bp = Blueprint("front_desk", __name__)

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
BOARD_DENSITY_OPTIONS = {"comfortable", "compact", "spacious", "ultra"}


def _check_in_issue(message: str, *, field: str | None = None, section: str | None = None) -> dict[str, str]:
    target_id = CHECK_IN_FIELD_TARGETS.get(field or "") or CHECK_IN_SECTION_TARGETS.get(section or "") or "check-in-errors"
    issue = {"message": message, "target_id": target_id, "href": f"#{target_id}"}
    if field:
        issue["field"] = field
    if section:
        issue["section"] = section
    return issue


def _route_module_current_app_testing() -> bool:
    route_module = sys.modules.get("pms.routes.front_desk")
    checker = getattr(route_module, "current_app_testing", None) if route_module else None
    if callable(checker):
        return checker()
    return current_app_testing()


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
        "phone": normalize_phone(form_data.get("phone") or ""),
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
    if not _route_module_current_app_testing() and values.get("identity_verified") != "on" and not reservation.identity_verified_at:
        blockers.append(_check_in_issue("Identity verification must be completed before check-in.", section="identity"))
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
    return {
        "defaults": defaults,
        "values": form_values,
        "errors": summary_errors,
        "field_errors": _build_check_in_field_errors(summary_errors),
        "summary_errors": summary_errors,
        "blockers": form_blockers,
        "allow_override": allow_override,
        "unexpected_message": unexpected_message,
    }


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


def _front_desk_board_start_date_from_request() -> date:
    if request.args.get("start_date"):
        return parse_request_date_arg("start_date", default=date.today())
    if request.args.get("date"):
        return parse_request_date_arg("date", default=date.today())
    return date.today()


def _front_desk_board_user_density() -> str:
    user = current_user()
    if not user:
        return "compact"
    preference = db.session.get(UserPreference, user.id)
    density = (((preference.preferences if preference else {}) or {}).get("frontDeskBoard") or {}).get("density")
    return density if density in BOARD_DENSITY_OPTIONS else "compact"


def front_desk_board_filters_from_request() -> FrontDeskBoardFilters:
    return FrontDeskBoardFilters(
        start_date=_front_desk_board_start_date_from_request(),
        days=parse_request_int_arg("days", default=14, minimum=1, maximum=90),
        room_type_id=parse_request_uuid_arg("room_type_id") or "",
        q=(request.args.get("q") or "").strip(),
        show_unallocated=request.args.get("show_unallocated", "1") == "1",
        show_closed=request.args.get("show_closed", "0") == "1",
    )


def front_desk_board_context(
    filters: FrontDeskBoardFilters,
    *,
    ical_import_report: dict | None = None,
) -> dict:
    from ..helpers import can as can_perm

    board = build_front_desk_board(filters)
    board_current_url = front_desk_board_url(filters)
    board_fragment_url = url_for("front_desk.staff_front_desk_board_fragment", **front_desk_board_filter_query(filters))
    hydrate_front_desk_board_urls(board, back_url=board_current_url, board_date=filters.start_date)
    can_create = can_perm("reservation.create")
    can_edit = can_perm("reservation.edit")
    can_manage_closures = can_perm("operations.override")
    return {
        "board": board,
        "board_v2_enabled": front_desk_board_v2_enabled(),
        "board_current_url": board_current_url,
        "board_fragment_url": board_fragment_url,
        "default_checkout_date": filters.start_date + timedelta(days=1),
        "filters": filters,
        "room_types": db.session.execute(sa.select(RoomType).order_by(RoomType.code.asc())).scalars().all(),
        "user_density": _front_desk_board_user_density(),
        "can_create": can_create,
        "can_edit": can_edit,
        "can_manage_closures": can_manage_closures,
        "can_check_in": can_perm("reservation.check_in"),
        "can_check_out": can_perm("reservation.check_out"),
        "ical_import_report": ical_import_report,
    }


def front_desk_board_filter_query(filters: FrontDeskBoardFilters) -> dict[str, str]:
    params: dict[str, str] = {}
    if filters.start_date != date.today():
        params["start_date"] = filters.start_date.isoformat()
    if filters.days != 14:
        params["days"] = str(filters.days)
    if filters.room_type_id:
        params["room_type_id"] = str(filters.room_type_id)
    if filters.q:
        params["q"] = filters.q
    if not filters.show_unallocated:
        params["show_unallocated"] = "0"
    if not filters.show_closed:
        params["show_closed"] = "0"
    return params


def front_desk_board_url(filters: FrontDeskBoardFilters) -> str:
    return url_for("front_desk.staff_front_desk_board", **front_desk_board_filter_query(filters))


def hydrate_front_desk_board_urls(board: dict, *, back_url: str, board_date: date) -> None:
    for group in board.get("groups", []):
        reassign_options = list(group.get("room_options", []))
        for row in group.get("rows", []):
            for block in row.get("blocks", []):
                reservation_id = block.get("reservation_id") or block.get("reservationId")
                source_type = block.get("sourceType") or block.get("source_type") or block.get("type")
                if source_type == "reservation" and reservation_id:
                    front_desk_url = url_for(
                        "front_desk.staff_front_desk_detail",
                        reservation_id=reservation_id,
                        back=back_url,
                        date=board_date.isoformat(),
                    )
                    reservation_detail_url = url_for(
                        "staff_reservations.staff_reservation_detail",
                        reservation_id=reservation_id,
                        back=back_url,
                    )
                    cashier_url = url_for(
                        "cashier.staff_cashier_detail",
                        reservation_id=reservation_id,
                        back=back_url,
                    )
                    block["detail_url"] = front_desk_url
                    block["frontDeskUrl"] = front_desk_url
                    block["reservation_detail_url"] = reservation_detail_url
                    block["detailUrl"] = reservation_detail_url
                    block["cashier_url"] = cashier_url
                    block["cashierUrl"] = cashier_url
                    block["reassignUrl"] = url_for("front_desk.staff_front_desk_board_assign_room", reservation_id=reservation_id)
                    block["moveUrl"] = url_for("front_desk.staff_front_desk_board_move_reservation", reservation_id=reservation_id)
                    block["resizeUrl"] = url_for("front_desk.staff_front_desk_board_resize_reservation", reservation_id=reservation_id)
                    block["datesFormUrl"] = block["resizeUrl"]
                    block["reassignOptions"] = reassign_options
                override_id = block.get("override_id") or block.get("overrideId")
                if override_id:
                    block["editUrl"] = url_for("front_desk.staff_front_desk_board_update_closure", override_id=override_id)
                    block["releaseUrl"] = url_for("front_desk.staff_front_desk_board_release_closure", override_id=override_id)


def _front_desk_filters_payload(filters: FrontDeskBoardFilters) -> dict[str, str | bool]:
    return {
        "start_date": filters.start_date.isoformat(),
        "days": filters.days,
        "room_type_id": str(filters.room_type_id) if filters.room_type_id else "",
        "q": filters.q,
        "show_unallocated": filters.show_unallocated,
        "show_closed": filters.show_closed,
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
    try:
        request_payload = {k: str(v) for k, v in (payload or {}).items()}
        write_audit_log(
            actor_user_id=actor_user_id,
            entity_table=entity_table,
            entity_id=entity_id,
            action=action,
            before_data=before_data,
            after_data={"request": request_payload, "failure_reason": reason},
        )
        write_activity_log(
            actor_user_id=actor_user_id,
            event_type="front_desk.board_mutation_rejected",
            entity_table=entity_table,
            entity_id=entity_id,
            metadata={"action": action, "failure_reason": reason, "request": request_payload},
        )
        db.session.commit()
    except Exception:  # noqa: BLE001
        db.session.rollback()
        logger.warning("Failed to write board mutation rejection audit log", exc_info=True)


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
