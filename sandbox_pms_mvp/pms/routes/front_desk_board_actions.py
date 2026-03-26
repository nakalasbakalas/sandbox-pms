"""Front desk board — mutation / action routes.

Handles reservation moves, resizes, date changes, room assignments,
closures, group blocks, and board preferences.
"""

from __future__ import annotations

import logging
from datetime import date
from time import perf_counter
from uuid import UUID

import sqlalchemy as sa
from flask import (
    abort,
    flash,
    jsonify,
    redirect,
    request,
    url_for,
)

from ..activity import write_activity_log
from ..extensions import db
from ..front_desk_board_preferences import merge_front_desk_board_state
from ..helpers import (
    add_anchor_to_path,
    parse_optional_datetime,
    parse_optional_uuid,
    require_permission,
    safe_back_path,
)
from ..front_desk_board_runtime import log_front_desk_board_metric
from ..models import (
    InventoryOverride,
    Reservation,
    Room,
    UserPreference,
)
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
from ..services.staff_reservations_service import (
    StayDateChangePayload,
    assign_room,
    change_stay_dates,
)
from .front_desk_board import (
    BoardMutationRequestError,
    board_json_or_redirect,
    board_request_payload,
    parse_board_date,
    parse_board_reason,
    parse_board_room_id,
    record_board_mutation_rejection,
)
from .front_desk_core import front_desk_bp

logger = logging.getLogger(__name__)


# ── Snapshot helpers ──────────────────────────────────────────────────


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


# ── Board action routes ──────────────────────────────────────────────


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/room", methods=["POST"])
def staff_front_desk_board_assign_room(reservation_id):
    user = require_permission("reservation.edit")
    try:
        assign_room(
            reservation_id,
            UUID(request.form["room_id"]),
            actor_user_id=user.id,
            reason=request.form.get("reason") or "front_desk_board_reassign",
        )
        return board_json_or_redirect(ok=True, message="Room assignment updated from the planning board.", status_code=200)
    except Exception as exc:  # noqa: BLE001
        return board_json_or_redirect(
            ok=False,
            message="Room assignment could not be updated.",
            error=public_error_message(exc),
            status_code=409,
        )


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/dates", methods=["POST"])
def staff_front_desk_board_change_dates(reservation_id):
    user = require_permission("reservation.edit")
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
        return board_json_or_redirect(ok=True, message="Stay dates updated from the planning board.", status_code=200)
    except Exception as exc:  # noqa: BLE001
        return board_json_or_redirect(
            ok=False,
            message="Stay dates could not be updated.",
            error=public_error_message(exc),
            status_code=409,
        )


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


# ── Closure routes ────────────────────────────────────────────────────


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


# ── Group block routes ────────────────────────────────────────────────


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


# ── Board preferences ────────────────────────────────────────────────


@front_desk_bp.route("/staff/front-desk/board/preferences", methods=["POST"])
def staff_front_desk_board_preferences():
    """Save user's front desk board preferences (density, layout, etc)."""
    user = require_permission("reservation.view")
    payload = request.get_json() or {}
    pref = db.session.execute(sa.select(UserPreference).filter_by(user_id=user.id)).scalar_one_or_none()
    if not pref:
        pref = UserPreference(user_id=user.id, preferences={})
        db.session.add(pref)
    current_preferences = pref.preferences or {}
    try:
        board_state = merge_front_desk_board_state(current_preferences, payload)
    except ValueError as exc:
        abort(400, str(exc))

    pref.preferences = {**current_preferences, "frontDeskBoard": board_state}
    db.session.commit()

    density = board_state["density"]
    write_activity_log(
        actor_user_id=user.id,
        event_type="front_desk.board_preferences_changed",
        metadata={
            "density": density,
            "activeRoleView": board_state["activeRoleView"],
            "activeFilters": board_state["activeFilters"],
            "hkOverlay": board_state["hkOverlay"],
            "toolbarCollapsed": board_state["toolbarCollapsed"],
        },
    )

    return jsonify(ok=True, density=density, boardState=board_state)
