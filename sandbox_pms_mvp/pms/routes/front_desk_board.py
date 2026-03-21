"""Front desk board routes."""

from __future__ import annotations

from .front_desk_base import *  # noqa: F401,F403
from . import front_desk_base as _base

_front_desk_filters_payload = _base._front_desk_filters_payload
_reservation_snapshot_for_audit = _base._reservation_snapshot_for_audit
_inventory_override_snapshot_for_audit = _base._inventory_override_snapshot_for_audit


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
            return jsonify({"ok": True, "message": message})
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
        db.session.rollback()
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
        db.session.rollback()
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
        return jsonify({"ok": True, "message": message})
    except BoardMutationRequestError as exc:
        db.session.rollback()
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
        db.session.rollback()
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


@front_desk_bp.route("/staff/front-desk/board/group-blocks", methods=["POST"])
def staff_front_desk_board_create_group_block():
    user = require_permission("operations.override")
    back_url = safe_back_path(request.form.get("back_url"), url_for("front_desk.staff_front_desk_board"))
    payload = request.form.to_dict()
    try:
        overrides = create_group_room_block(
            GroupRoomBlockPayload(
                group_code=payload.get("group_code", ""),
                room_type_id=UUID(payload["room_type_id"]),
                room_count=int(payload.get("room_count", 1)),
                start_date=parse_board_date(payload, "group block start date", "start_date"),
                end_date=parse_board_date(payload, "group block end date", "end_date"),
                reason=payload.get("reason"),
            ),
            actor_user_id=user.id,
        )
        flash(f"Group room block created for {len(overrides)} room(s).", "success")
    except Exception as exc:  # noqa: BLE001
        record_board_mutation_rejection(
            actor_user_id=user.id,
            entity_table="inventory_overrides",
            entity_id=str(payload.get("group_code") or "group-block"),
            action="front_desk_board_group_block_create_rejected",
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


@front_desk_bp.route("/staff/front-desk/board/group-blocks/release", methods=["POST"])
def staff_front_desk_board_release_group_block():
    user = require_permission("operations.override")
    back_url = safe_back_path(request.form.get("back_url"), url_for("front_desk.staff_front_desk_board"))
    payload = request.form.to_dict()
    try:
        overrides = release_group_room_block(payload.get("group_code", ""), actor_user_id=user.id)
        flash(f"Released group room block across {len(overrides)} room(s).", "success")
    except Exception as exc:  # noqa: BLE001
        record_board_mutation_rejection(
            actor_user_id=user.id,
            entity_table="inventory_overrides",
            entity_id=str(payload.get("group_code") or "group-block"),
            action="front_desk_board_group_block_release_rejected",
            before_data=None,
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
    user = require_permission("reservation.view")
    payload = request.get_json() or {}
    density = payload.get("density", "compact")
    if density not in BOARD_DENSITY_OPTIONS:
        abort(400, "Invalid density value")
    pref = db.session.get(UserPreference, user.id)
    if not pref:
        pref = UserPreference(user_id=user.id, preferences={})
        db.session.add(pref)
    preferences = dict(pref.preferences or {})
    board_preferences = dict(preferences.get("frontDeskBoard") or {})
    board_preferences["density"] = density
    preferences["frontDeskBoard"] = board_preferences
    pref.preferences = preferences
    db.session.commit()
    write_activity_log(
        actor_user_id=user.id,
        event_type="front_desk.board_density_changed",
        metadata={"density": density},
    )
    return jsonify(ok=True, density=density)


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/check_in", methods=["POST"])
def staff_front_desk_board_check_in(reservation_id):
    user = require_permission("reservation.check_in")
    reservation = db.session.get(Reservation, reservation_id)
    if not reservation:
        abort(404)
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
    except Exception as exc:  # noqa: BLE001
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
    user = require_permission("reservation.check_out")
    reservation = db.session.get(Reservation, reservation_id)
    if not reservation:
        abort(404)
    if reservation.current_status in ("checked_out", "canceled"):
        return jsonify(ok=False, error=f"Cannot check out a {reservation.current_status} reservation.")
    try:
        complete_checkout(reservation_id, actor_user_id=user.id)
        write_activity_log(
            actor_user_id=user.id,
            event_type="front_desk.board_check_out",
            entity_table="reservations",
            entity_id=str(reservation_id),
            metadata={"via": "board_keyboard"},
        )
        db.session.refresh(reservation)
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
    except Exception as exc:  # noqa: BLE001
        write_audit_log(
            actor_user_id=user.id,
            entity_table="reservations",
            entity_id=str(reservation_id),
            action="front_desk_board_check_out_failed",
            after_data={"error": str(exc)},
        )
        return jsonify(ok=False, error=str(exc)), 409


@front_desk_bp.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/panel", methods=["GET"])
def staff_front_desk_board_reservation_panel(reservation_id):
    user = require_permission("reservation.view")
    reservation = db.session.get(Reservation, reservation_id)
    if not reservation:
        abort(404)
    can_reassign = user.has_permission("reservation.edit")
    can_change_dates = user.has_permission("reservation.edit")
    can_check_in_perm = user.has_permission("reservation.check_in") and reservation.current_status in ["tentative", "confirmed"]
    can_check_out_perm = user.has_permission("reservation.check_out") and reservation.current_status == "checked_in"
    available_rooms = []
    if can_reassign and reservation.room_type_id:
        all_rooms = (
            db.session.execute(
                sa.select(Room)
                .where(Room.room_type_id == reservation.room_type_id, Room.is_active.is_(True))
                .order_by(Room.room_number)
            )
            .scalars()
            .all()
        )
        conflict_statuses = {"tentative", "confirmed", "checked_in", "house_use"}
        conflicting_room_ids = set(
            db.session.execute(
                sa.select(Reservation.assigned_room_id).where(
                    Reservation.id != reservation.id,
                    Reservation.assigned_room_id.is_not(None),
                    Reservation.current_status.in_(conflict_statuses),
                    Reservation.check_in_date < reservation.check_out_date,
                    Reservation.check_out_date > reservation.check_in_date,
                )
            )
            .scalars()
            .all()
        )
        for room in all_rooms:
            label = f"Room {room.room_number} - Floor {room.floor_number}"
            if room.id in conflicting_room_ids:
                label += " (unavailable)"
            available_rooms.append({"id": str(room.id), "label": label, "available": room.id not in conflicting_room_ids})
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
    }
    return render_template("_panel_reservation_details.html", **context)
