"""Housekeeping routes blueprint — board, room detail, tasks, readiness API."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from uuid import UUID

import sqlalchemy as sa
from flask import Blueprint, flash, jsonify, redirect, render_template, request, url_for

from ..constants import ROOM_NOTE_TYPES
from ..extensions import db
from ..helpers import (
    parse_request_date_arg,
    parse_request_uuid_arg,
    require_any_permission,
    require_permission,
    safe_back_path,
)
from ..models import RoomType
from ..permissions import can_manage_operational_overrides
from ..security import public_error_message
from ..services.housekeeping_service import (
    BlockRoomPayload,
    BulkHousekeepingPayload,
    CreateTaskPayload,
    HousekeepingBoardFilters,
    MaintenanceFlagPayload,
    RoomNotePayload,
    RoomStatusUpdatePayload,
    TaskListFilters,
    add_room_note,
    assign_housekeeping_task,
    bulk_update_housekeeping,
    cancel_housekeeping_task,
    complete_housekeeping_task,
    create_housekeeping_task,
    get_housekeeping_room_detail,
    inspect_housekeeping_task,
    list_housekeeping_board,
    list_housekeeping_tasks,
    set_blocked_state,
    set_maintenance_flag,
    start_housekeeping_task,
    submit_for_inspection,
    supervisor_inspect_task,
    update_housekeeping_status,
)
from ..services.room_readiness_service import is_room_assignable, room_readiness_board

housekeeping_bp = Blueprint("housekeeping", __name__)

HOUSEKEEPING_SHIFTS = ["morning", "afternoon", "evening", "night"]


def _housekeeping_filter_query(
    filters: HousekeepingBoardFilters,
    *,
    business_date: date | None = None,
    mobile: bool | None = None,
) -> dict[str, str]:
    params = {"date": (business_date or filters.business_date).isoformat()}
    if filters.floor:
        params["floor"] = filters.floor
    if filters.status:
        params["status"] = filters.status
    if filters.priority:
        params["priority"] = filters.priority
    if filters.room_type_id:
        params["room_type_id"] = str(filters.room_type_id)
    if filters.arrival_today:
        params["arrival_today"] = filters.arrival_today
    if filters.departure_today:
        params["departure_today"] = filters.departure_today
    if filters.blocked:
        params["blocked"] = filters.blocked
    if filters.maintenance:
        params["maintenance"] = filters.maintenance
    if filters.notes:
        params["notes"] = filters.notes
    if filters.mobile if mobile is None else mobile:
        params["view"] = "mobile"
    return params


@housekeeping_bp.route("/staff/housekeeping")
def staff_housekeeping():
    user = require_permission("housekeeping.view")
    target_date = parse_request_date_arg("date", default=date.today())
    filters = HousekeepingBoardFilters(
        business_date=target_date,
        floor=request.args.get("floor", ""),
        status=request.args.get("status", ""),
        priority=request.args.get("priority", ""),
        room_type_id=parse_request_uuid_arg("room_type_id") or "",
        arrival_today=request.args.get("arrival_today", ""),
        departure_today=request.args.get("departure_today", ""),
        blocked=request.args.get("blocked", ""),
        maintenance=request.args.get("maintenance", ""),
        notes=request.args.get("notes", ""),
        mobile=request.args.get("view") == "mobile",
    )
    board = list_housekeeping_board(filters, actor_user=user)
    tomorrow_date = target_date + timedelta(days=1)
    tomorrow_filters = HousekeepingBoardFilters(
        business_date=tomorrow_date,
        floor=filters.floor,
        status=filters.status,
        priority=filters.priority,
        room_type_id=filters.room_type_id,
        arrival_today=filters.arrival_today,
        departure_today=filters.departure_today,
        blocked=filters.blocked,
        maintenance=filters.maintenance,
        notes=filters.notes,
        mobile=filters.mobile,
    )
    tomorrow_board = list_housekeeping_board(tomorrow_filters, actor_user=user)
    tasks = list_housekeeping_tasks(TaskListFilters(business_date=target_date, shift=request.args.get("shift", "")))
    return render_template(
        "housekeeping_board.html",
        board=board,
        tomorrow_board=tomorrow_board,
        today_date=date.today(),
        tasks=tasks,
        filters=filters,
        shift_filter=request.args.get("shift", ""),
        housekeeping_shifts=HOUSEKEEPING_SHIFTS,
        room_types=(
            db.session.execute(sa.select(RoomType).order_by(RoomType.code.asc()))
            .scalars()
            .all()
        ),
        housekeeping_statuses=["dirty", "clean", "inspected", "pickup", "occupied_clean", "occupied_dirty", "do_not_disturb", "sleep", "out_of_order", "out_of_service", "cleaning_in_progress"],
        room_note_types=ROOM_NOTE_TYPES,
        can_manage_controls=can_manage_operational_overrides(user),
        today_url=url_for("housekeeping.staff_housekeeping", **_housekeeping_filter_query(filters, business_date=target_date)),
        tomorrow_url=url_for("housekeeping.staff_housekeeping", **_housekeeping_filter_query(filters, business_date=tomorrow_date)),
        desk_view_url=url_for("housekeeping.staff_housekeeping", **_housekeeping_filter_query(filters, mobile=False)),
        mobile_view_url=url_for("housekeeping.staff_housekeeping", **_housekeeping_filter_query(filters, mobile=True)),
    )


@housekeeping_bp.route("/staff/housekeeping/rooms/<uuid:room_id>")
def staff_housekeeping_room_detail(room_id):
    user = require_permission("housekeeping.view")
    business_date = parse_request_date_arg("date", default=date.today())
    detail = get_housekeeping_room_detail(room_id, business_date=business_date, actor_user=user)
    return render_template(
        "housekeeping_room_detail.html",
        detail=detail,
        business_date=business_date,
        back_url=safe_back_path(
            request.args.get("back"),
            url_for("housekeeping.staff_housekeeping", date=business_date.isoformat()),
        ),
        housekeeping_statuses=["dirty", "clean", "inspected", "pickup", "occupied_clean", "occupied_dirty", "do_not_disturb", "sleep", "out_of_order", "out_of_service"],
        room_note_types=ROOM_NOTE_TYPES,
        can_manage_controls=can_manage_operational_overrides(user),
        can_view_audit=user.has_permission("audit.view"),
    )


@housekeeping_bp.route("/staff/housekeeping/rooms/<uuid:room_id>/status", methods=["POST"])
def staff_housekeeping_room_status(room_id):
    user = require_permission("housekeeping.status_change")
    business_date = date.fromisoformat(request.form["business_date"])
    try:
        update_housekeeping_status(
            room_id,
            business_date=business_date,
            payload=RoomStatusUpdatePayload(
                status_code=request.form.get("status_code", ""),
                note=request.form.get("note"),
            ),
            actor_user_id=user.id,
        )
        flash("Room status updated.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("housekeeping.staff_housekeeping_room_detail", room_id=room_id, date=business_date.isoformat(), back=request.form.get("back_url")))


@housekeeping_bp.route("/staff/housekeeping/rooms/<uuid:room_id>/notes", methods=["POST"])
def staff_housekeeping_room_note(room_id):
    user = require_permission("housekeeping.status_change")
    business_date = date.fromisoformat(request.form["business_date"])
    try:
        add_room_note(
            room_id,
            business_date=business_date,
            payload=RoomNotePayload(
                note_text=request.form.get("note_text", ""),
                note_type=request.form.get("note_type", "housekeeping"),
                is_important=request.form.get("is_important") == "on",
                visibility_scope=request.form.get("visibility_scope", "all_staff"),
            ),
            actor_user_id=user.id,
        )
        flash("Room note added.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("housekeeping.staff_housekeeping_room_detail", room_id=room_id, date=business_date.isoformat(), back=request.form.get("back_url")))


@housekeeping_bp.route("/staff/housekeeping/rooms/<uuid:room_id>/maintenance", methods=["POST"])
def staff_housekeeping_room_maintenance(room_id):
    user = require_permission("housekeeping.status_change")
    business_date = date.fromisoformat(request.form["business_date"])
    try:
        set_maintenance_flag(
            room_id,
            business_date=business_date,
            payload=MaintenanceFlagPayload(
                enabled=request.form.get("enabled") == "1",
                note=request.form.get("note"),
            ),
            actor_user_id=user.id,
        )
        flash("Maintenance flag updated.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("housekeeping.staff_housekeeping_room_detail", room_id=room_id, date=business_date.isoformat(), back=request.form.get("back_url")))


@housekeeping_bp.route("/staff/housekeeping/rooms/<uuid:room_id>/block", methods=["POST"])
def staff_housekeeping_room_block(room_id):
    user = require_permission("housekeeping.status_change")
    business_date = date.fromisoformat(request.form["business_date"])
    blocked_until_raw = request.form.get("blocked_until")
    blocked_until = datetime.fromisoformat(blocked_until_raw) if blocked_until_raw else None
    try:
        set_blocked_state(
            room_id,
            business_date=business_date,
            payload=BlockRoomPayload(
                blocked=request.form.get("blocked") == "1",
                reason=request.form.get("reason"),
                blocked_until=blocked_until,
            ),
            actor_user_id=user.id,
        )
        flash("Blocked-room state updated.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("housekeeping.staff_housekeeping_room_detail", room_id=room_id, date=business_date.isoformat(), back=request.form.get("back_url")))


@housekeeping_bp.route("/staff/housekeeping/bulk", methods=["POST"])
def staff_housekeeping_bulk():
    user = require_permission("housekeeping.status_change")
    business_date = date.fromisoformat(request.form["business_date"])
    room_ids = [UUID(item) for item in request.form.getlist("room_ids") if item]
    blocked_until_raw = request.form.get("blocked_until")
    blocked_until = datetime.fromisoformat(blocked_until_raw) if blocked_until_raw else None
    try:
        result = bulk_update_housekeeping(
            BulkHousekeepingPayload(
                room_ids=room_ids,
                business_date=business_date,
                action=request.form.get("action", ""),
                status_code=request.form.get("status_code") or None,
                note=request.form.get("note") or None,
                room_note_type=request.form.get("room_note_type", "housekeeping"),
                is_important=request.form.get("is_important") == "on",
                blocked_until=blocked_until,
            ),
            actor_user_id=user.id,
        )
        flash(
            f"Bulk update completed: {result['success_count']} success, {result['failure_count']} failed.",
            "success" if result["failure_count"] == 0 else "warning",
        )
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(url_for("housekeeping.staff_housekeeping", date=business_date.isoformat(), view=request.form.get("view")))


# ------------------------------------------------------------------
# Housekeeping task management routes
# ------------------------------------------------------------------

@housekeeping_bp.route("/staff/housekeeping/tasks")
def staff_housekeeping_tasks():
    require_permission("housekeeping.view")
    target_date = parse_request_date_arg("date", default=date.today())
    filters = TaskListFilters(
        business_date=target_date,
        status=request.args.get("status", ""),
        room_id=request.args.get("room_id", ""),
        assigned_to_user_id=request.args.get("assigned_to_user_id", ""),
        task_type=request.args.get("task_type", ""),
        priority=request.args.get("priority", ""),
    )
    tasks = list_housekeeping_tasks(filters)
    return jsonify({"tasks": tasks, "business_date": target_date.isoformat()})


@housekeeping_bp.route("/staff/housekeeping/tasks", methods=["POST"])
def staff_housekeeping_task_create():
    user = require_permission("housekeeping.task_manage")
    try:
        room_id = UUID(request.form["room_id"])
        business_date = date.fromisoformat(request.form["business_date"])
        assigned_to = request.form.get("assigned_to_user_id")
        due_at_raw = request.form.get("due_at")
        create_housekeeping_task(
            CreateTaskPayload(
                room_id=room_id,
                business_date=business_date,
                task_type=request.form.get("task_type", "checkout_clean"),
                priority=request.form.get("priority", "normal"),
                notes=request.form.get("notes"),
                assigned_to_user_id=UUID(assigned_to) if assigned_to else None,
                reservation_id=UUID(request.form["reservation_id"]) if request.form.get("reservation_id") else None,
                due_at=datetime.fromisoformat(due_at_raw) if due_at_raw else None,
                shift=request.form.get("shift") or None,
            ),
            actor_user_id=user.id,
        )
        flash("Housekeeping task created.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(safe_back_path(request.form.get("back_url"), url_for("housekeeping.staff_housekeeping", date=request.form.get("business_date", date.today().isoformat()))))


@housekeeping_bp.route("/staff/housekeeping/tasks/<task_id>/assign", methods=["POST"])
def staff_housekeeping_task_assign(task_id):
    user = require_permission("housekeeping.task_manage")
    try:
        assigned_to = UUID(request.form["assigned_to_user_id"])
        assign_housekeeping_task(UUID(task_id), assigned_to_user_id=assigned_to, actor_user_id=user.id)
        flash("Task assigned.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(safe_back_path(request.form.get("back_url"), url_for("housekeeping.staff_housekeeping")))


@housekeeping_bp.route("/staff/housekeeping/tasks/<task_id>/start", methods=["POST"])
def staff_housekeeping_task_start(task_id):
    user = require_permission("housekeeping.task_manage")
    try:
        start_housekeeping_task(UUID(task_id), actor_user_id=user.id)
        flash("Task started — room set to cleaning in progress.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(safe_back_path(request.form.get("back_url"), url_for("housekeeping.staff_housekeeping")))


@housekeeping_bp.route("/staff/housekeeping/tasks/<task_id>/complete", methods=["POST"])
def staff_housekeeping_task_complete(task_id):
    user = require_permission("housekeeping.task_manage")
    try:
        complete_housekeeping_task(UUID(task_id), actor_user_id=user.id, notes=request.form.get("notes"))
        flash("Task completed — room marked clean.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(safe_back_path(request.form.get("back_url"), url_for("housekeeping.staff_housekeeping")))


@housekeeping_bp.route("/staff/housekeeping/tasks/<task_id>/inspect", methods=["POST"])
def staff_housekeeping_task_inspect(task_id):
    user = require_permission("housekeeping.task_manage")
    try:
        inspect_housekeeping_task(UUID(task_id), actor_user_id=user.id, notes=request.form.get("notes"))
        flash("Inspection passed — room ready for assignment.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(safe_back_path(request.form.get("back_url"), url_for("housekeeping.staff_housekeeping")))


@housekeeping_bp.route("/staff/housekeeping/tasks/<uuid:task_id>/submit-inspection", methods=["POST"])
def staff_housekeeping_task_submit_inspection(task_id):
    user = require_permission("housekeeping.task_manage")
    try:
        submit_for_inspection(task_id, actor_user_id=user.id)
        flash("Task submitted for supervisor inspection.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(request.form.get("back_url") or url_for("housekeeping.staff_housekeeping"))


@housekeeping_bp.route("/staff/housekeeping/tasks/<uuid:task_id>/supervisor-inspect", methods=["POST"])
def staff_housekeeping_task_supervisor_inspect(task_id):
    user = require_permission("housekeeping.task_manage")
    try:
        result = request.form.get("result", "pass")
        supervisor_inspect_task(task_id, result=result, notes=request.form.get("notes"), actor_user_id=user.id)
        if result == "pass":
            flash("Inspection passed — room ready for assignment.", "success")
        else:
            flash("Inspection failed — task reset to in-progress.", "warning")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(request.form.get("back_url") or url_for("housekeeping.staff_housekeeping"))


@housekeeping_bp.route("/staff/housekeeping/tasks/<task_id>/cancel", methods=["POST"])
def staff_housekeeping_task_cancel(task_id):
    user = require_permission("housekeeping.task_manage")
    try:
        cancel_housekeeping_task(UUID(task_id), actor_user_id=user.id, reason=request.form.get("reason"))
        flash("Task cancelled.", "success")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(safe_back_path(request.form.get("back_url"), url_for("housekeeping.staff_housekeeping")))


# ------------------------------------------------------------------
# Room readiness API
# ------------------------------------------------------------------

@housekeeping_bp.route("/staff/api/room-readiness")
def staff_api_room_readiness():
    """JSON endpoint returning readiness state of all rooms for a given date."""
    require_any_permission("reservation.view", "housekeeping.view")
    target_date = parse_request_date_arg("date", default=date.today())
    board = room_readiness_board(target_date)
    return jsonify({
        "business_date": target_date.isoformat(),
        "rooms": [
            {
                "room_id": str(r.room_id),
                "room_number": r.room_number,
                "room_type_code": r.room_type_code,
                "floor_number": r.floor_number,
                "is_ready": r.is_ready,
                "label": r.label,
                "reason": r.reason,
                "housekeeping_status_code": r.housekeeping_status_code,
                "availability_status": r.availability_status,
                "is_blocked": r.is_blocked,
                "is_maintenance": r.is_maintenance,
                "has_active_task": r.has_active_task,
                "active_task_status": r.active_task_status,
                "reservation_code": r.reservation_code,
            }
            for r in board
        ],
    })


@housekeeping_bp.route("/staff/api/room-readiness/<room_id>")
def staff_api_room_readiness_single(room_id):
    """JSON endpoint returning readiness state of a single room."""
    require_any_permission("reservation.view", "housekeeping.view")
    target_date = parse_request_date_arg("date", default=date.today())
    try:
        r = is_room_assignable(UUID(room_id), target_date)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404
    return jsonify({
        "room_id": str(r.room_id),
        "room_number": r.room_number,
        "room_type_code": r.room_type_code,
        "floor_number": r.floor_number,
        "is_ready": r.is_ready,
        "label": r.label,
        "reason": r.reason,
        "housekeeping_status_code": r.housekeeping_status_code,
        "availability_status": r.availability_status,
        "is_blocked": r.is_blocked,
        "is_maintenance": r.is_maintenance,
        "has_active_task": r.has_active_task,
        "active_task_status": r.active_task_status,
        "reservation_code": r.reservation_code,
    })


# ------------------------------------------------------------------
# Quick actions for room status changes
# ------------------------------------------------------------------

@housekeeping_bp.route("/staff/housekeeping/quick-action", methods=["POST"])
def staff_housekeeping_quick_action():
    """Compact front-desk / supervisor quick actions for room status changes."""
    user = require_permission("housekeeping.status_change")
    action = request.form.get("action", "")
    room_id = UUID(request.form["room_id"])
    business_date = date.fromisoformat(request.form.get("business_date", date.today().isoformat()))
    try:
        if action == "mark_dirty":
            update_housekeeping_status(room_id, business_date=business_date, payload=RoomStatusUpdatePayload(status_code="dirty"), actor_user_id=user.id)
            flash("Room marked dirty.", "success")
        elif action == "mark_cleaning":
            update_housekeeping_status(room_id, business_date=business_date, payload=RoomStatusUpdatePayload(status_code="cleaning_in_progress"), actor_user_id=user.id)
            flash("Room marked cleaning in progress.", "success")
        elif action == "mark_clean":
            update_housekeeping_status(room_id, business_date=business_date, payload=RoomStatusUpdatePayload(status_code="clean"), actor_user_id=user.id)
            flash("Room marked clean.", "success")
        elif action == "mark_inspected":
            update_housekeeping_status(room_id, business_date=business_date, payload=RoomStatusUpdatePayload(status_code="inspected"), actor_user_id=user.id)
            flash("Room marked inspected / ready.", "success")
        elif action == "block_room":
            reason = request.form.get("reason", "")
            set_blocked_state(room_id, business_date=business_date, payload=BlockRoomPayload(blocked=True, reason=reason or "Blocked via quick action"), actor_user_id=user.id)
            flash("Room blocked.", "success")
        elif action == "unblock_room":
            set_blocked_state(room_id, business_date=business_date, payload=BlockRoomPayload(blocked=False), actor_user_id=user.id)
            flash("Room unblocked.", "success")
        elif action == "maintenance_on":
            note = request.form.get("note", "")
            set_maintenance_flag(room_id, business_date=business_date, payload=MaintenanceFlagPayload(enabled=True, note=note or "Maintenance issue via quick action"), actor_user_id=user.id)
            flash("Maintenance flag set.", "success")
        elif action == "maintenance_off":
            set_maintenance_flag(room_id, business_date=business_date, payload=MaintenanceFlagPayload(enabled=False), actor_user_id=user.id)
            flash("Maintenance flag cleared.", "success")
        elif action == "rush_clean":
            create_housekeeping_task(
                CreateTaskPayload(room_id=room_id, business_date=business_date, task_type="rush_clean", priority="urgent", notes=request.form.get("notes", "Urgent clean requested")),
                actor_user_id=user.id,
            )
            flash("Rush clean task created.", "success")
        else:
            flash("Unknown quick action.", "error")
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
    return redirect(safe_back_path(request.form.get("back_url"), url_for("housekeeping.staff_housekeeping", date=business_date.isoformat())))
