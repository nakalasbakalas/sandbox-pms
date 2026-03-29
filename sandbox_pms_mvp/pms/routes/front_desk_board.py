"""Front desk board — view routes and shared board helpers.

All board route handlers register on the shared ``front_desk_bp`` Blueprint
defined in ``front_desk_core``, so no new blueprint is created here.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from time import perf_counter
from uuid import UUID

import sqlalchemy as sa
from flask import (
    Response,
    abort,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    url_for,
)

from ..extensions import db
from ..front_desk_board_preferences import (
    extract_front_desk_board_state,
)
from ..front_desk_board_runtime import (
    front_desk_board_v2_enabled,
    log_front_desk_board_metric,
)
from ..helpers import (
    add_anchor_to_path,
    can,
    parse_request_date_arg,
    parse_request_int_arg,
    parse_request_uuid_arg,
    safe_back_path,
)
from ..models import (
    ExternalCalendarBlock,
    RoomType,
)
from ..security import public_error_message
from ..services.front_desk_board_service import (
    FrontDeskBoardFilters,
    build_front_desk_board,
    flatten_front_desk_blocks,
    list_front_desk_room_groups,
    serialize_front_desk_board,
)
from ..services.ical_service import (
    export_front_desk_blocks_ical,
    stage_ical_import,
)
from .front_desk_core import front_desk_bp

logger = logging.getLogger(__name__)


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
        group_by=(
            request.args.get("group_by", "type")
            if request.args.get("group_by") in {"type", "floor", "action", "turnover"}
            else "type"
        ),
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
    user = getattr(g, "current_staff_user", None)
    board_state = extract_front_desk_board_state(user.preferences.preferences if user and user.preferences else {})

    return {
        "board": board,
        "board_v2_enabled": board_v2_enabled,
        "filters": filters,
        "room_types": room_types,
        "user_density": board_state["density"],
        "board_state": board_state,
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
        "board_create_url": url_for("staff_reservations.staff_reservation_create") if can("reservation.create") else "",
        "board_filter_query": front_desk_board_filter_query(filters),
        "board_current_url": back_url,
        "ical_import_report": ical_import_report,
    }


def board_request_wants_json() -> bool:
    accept = request.headers.get("Accept", "")
    return request.is_json or "application/json" in accept.lower()


def board_json_or_redirect(
    *,
    ok: bool,
    message: str,
    status_code: int,
    error: str | None = None,
    **payload: object,
):
    body = {"ok": ok, "message": message, **payload}
    if error:
        body["error"] = error
    if board_request_wants_json():
        return jsonify(body), status_code
    from flask import flash
    flash(error or message, "success" if ok else "error")
    back_url = safe_back_path(request.form.get("back_url"), url_for("front_desk.staff_front_desk_board"))
    return redirect(add_anchor_to_path(back_url, request.form.get("return_anchor")))


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
    if filters.group_by != "type":
        query["group_by"] = filters.group_by
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
    from ..activity import write_activity_log
    from ..audit import write_audit_log

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


# ── Board view routes ────────────────────────────────────────────────


@front_desk_bp.route("/staff/front-desk/board")
def staff_front_desk_board():
    from ..helpers import require_permission
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
    from ..helpers import require_permission
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
    from ..helpers import require_permission
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
                "boardState": serialize_front_desk_board(context["board_state"]),
                "permissions": {
                    "canCreate": context["can_create"],
                    "canEdit": context["can_edit"],
                    "canManageClosures": context["can_manage_closures"],
                    "canCheckIn": context["can_check_in"],
                    "canCheckOut": context["can_check_out"],
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
    from ..helpers import require_permission
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


@front_desk_bp.route("/staff/front-desk/board/export.ics")
def staff_front_desk_board_export_ical():
    from ..helpers import require_permission
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
    from flask import flash
    from ..helpers import require_permission
    require_permission("reservation.edit")
    filters = front_desk_board_filters_from_request()
    try:
        ical_data = read_ical_upload_payload()
        report = stage_ical_import(
            ical_data,
            known_uids=set(db.session.execute(sa.select(ExternalCalendarBlock.external_uid)).scalars().all()),
        )
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
        report = None
    return render_template("front_desk_board.html", **front_desk_board_context(filters, ical_import_report=report))


@front_desk_bp.route("/staff/front-desk/board/stats-panel")
def staff_front_desk_board_stats_panel():
    from ..helpers import require_permission
    require_permission("reservation.view")
    try:
        filters = front_desk_board_filters_from_request()
        context = front_desk_board_context(filters)
        return render_template("_front_desk_board_stats_panel.html", **context)
    except Exception:  # noqa: BLE001
        return "<p class='small muted'>Stats unavailable.</p>", 200


@front_desk_bp.route("/staff/front-desk/board/handover-panel")
def staff_front_desk_board_handover_panel():
    from ..helpers import require_permission
    require_permission("reservation.view")
    try:
        filters = front_desk_board_filters_from_request()
        context = front_desk_board_context(filters)
        return render_template("_front_desk_board_handover_panel.html", **context)
    except Exception:  # noqa: BLE001
        return "<p class='small muted'>Handover data unavailable.</p>", 200
