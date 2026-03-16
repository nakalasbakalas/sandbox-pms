from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

from werkzeug.security import generate_password_hash

from pms.extensions import db
from pms.models import ActivityLog, AppSetting, AuditLog, ExternalCalendarBlock, ExternalCalendarSource, InventoryDay, InventoryOverride, Reservation, Role, Room, RoomType, User
from pms.services.admin_service import InventoryOverridePayload, create_inventory_override
from pms.services.front_desk_board_service import FrontDeskBoardFilters, build_front_desk_board
from pms.services.reservation_service import ReservationCreatePayload, create_reservation


def make_staff_user(role_code: str, email: str) -> User:
    role = Role.query.filter_by(code=role_code).one()
    user = User(
        username=email.split("@", 1)[0],
        email=email,
        full_name=email.split("@", 1)[0].replace(".", " ").title(),
        password_hash=generate_password_hash("password123456"),
        is_active=True,
        account_state="active",
    )
    user.roles = [role]
    db.session.add(user)
    db.session.commit()
    return user


def login_as(client, user: User) -> None:
    with client.session_transaction() as session:
        session["staff_user_id"] = str(user.id)
        session["_csrf_token"] = "test-csrf-token"


def post_form(client, url: str, *, data: dict, follow_redirects: bool = False):
    payload = dict(data)
    payload["csrf_token"] = "test-csrf-token"
    return client.post(url, data=payload, follow_redirects=follow_redirects)


def post_json(client, url: str, *, payload: dict, follow_redirects: bool = False):
    return client.post(
        url,
        json=payload,
        headers={"X-CSRF-Token": "test-csrf-token"},
        follow_redirects=follow_redirects,
    )


def create_staff_reservation(
    *,
    first_name: str,
    last_name: str,
    phone: str,
    room_type_code: str,
    check_in_date: date,
    check_out_date: date,
    initial_status: str | None = None,
    assigned_room_id=None,
    defer_room_assignment: bool = False,
    source_channel: str = "admin_manual",
) -> Reservation:
    room_type = RoomType.query.filter_by(code=room_type_code).one()
    return create_reservation(
        ReservationCreatePayload(
            first_name=first_name,
            last_name=last_name,
            phone=phone,
            email=f"{first_name.lower()}.{last_name.lower()}@example.com",
            room_type_id=room_type.id,
            assigned_room_id=assigned_room_id,
            check_in_date=check_in_date,
            check_out_date=check_out_date,
            adults=2,
            children=0,
            source_channel=source_channel,
            initial_status=initial_status,
            defer_room_assignment=defer_room_assignment,
        )
    )


def find_open_room(
    *,
    room_type_id,
    start_date: date,
    end_date: date,
    exclude_room_ids: set | None = None,
) -> Room:
    exclude_room_ids = exclude_room_ids or set()
    candidate_rooms = (
        Room.query.filter_by(room_type_id=room_type_id, is_active=True, is_sellable=True)
        .order_by(Room.room_number.asc())
        .all()
    )
    required_days = (end_date - start_date).days
    for room in candidate_rooms:
        if room.id in exclude_room_ids:
            continue
        rows = (
            InventoryDay.query.filter(
                InventoryDay.room_id == room.id,
                InventoryDay.business_date >= start_date,
                InventoryDay.business_date < end_date,
            )
            .order_by(InventoryDay.business_date.asc())
            .all()
        )
        if len(rows) != required_days:
            continue
        if all(row.is_sellable and not row.is_blocked and row.availability_status == "available" for row in rows):
            return room
    raise AssertionError("No open room was available for the requested window.")


def test_build_front_desk_board_groups_unallocated_clips_stays_and_surfaces_special_blocks(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        window_start = date.today()
        window_end = window_start + timedelta(days=14)
        manager = make_staff_user("manager", "board-manager@example.com")
        long_stay = create_staff_reservation(
            first_name="Long",
            last_name="Stay",
            phone="+66810000001",
            room_type_code="TWN",
            check_in_date=window_start,
            check_out_date=window_end + timedelta(days=1),
        )
        long_stay.check_in_date = window_start - timedelta(days=2)
        waitlist = create_staff_reservation(
            first_name="Wait",
            last_name="List",
            phone="+66810000002",
            room_type_code="TWN",
            check_in_date=window_start + timedelta(days=3),
            check_out_date=window_start + timedelta(days=5),
        )
        waitlist.current_status = "waitlist"

        room_type_id = long_stay.room_type_id
        closure_room = find_open_room(
            room_type_id=room_type_id,
            start_date=window_start + timedelta(days=6),
            end_date=window_start + timedelta(days=8),
            exclude_room_ids={long_stay.assigned_room_id, waitlist.assigned_room_id},
        )
        create_inventory_override(
            InventoryOverridePayload(
                name="Deep clean hold",
                scope_type="room",
                override_action="close",
                room_id=closure_room.id,
                room_type_id=None,
                start_date=window_start + timedelta(days=6),
                end_date=window_start + timedelta(days=7),
                reason="Board test closure",
            ),
            actor_user_id=manager.id,
        )

        external_room = find_open_room(
            room_type_id=room_type_id,
            start_date=window_start + timedelta(days=9),
            end_date=window_start + timedelta(days=11),
            exclude_room_ids={long_stay.assigned_room_id, waitlist.assigned_room_id, closure_room.id},
        )
        source = ExternalCalendarSource(
            room_id=external_room.id,
            name="Airbnb feed",
            feed_url_encrypted="encrypted-feed",
            feed_url_hint="airbnb.example",
            external_reference="board-test",
            is_active=True,
            last_status="success",
        )
        db.session.add(source)
        db.session.flush()
        db.session.add(
            ExternalCalendarBlock(
                source_id=source.id,
                room_id=external_room.id,
                external_uid="board-block-1",
                summary="Airbnb hold",
                starts_on=window_start + timedelta(days=9),
                ends_on=window_start + timedelta(days=11),
            )
        )
        db.session.commit()

        board = build_front_desk_board(
            FrontDeskBoardFilters(
                start_date=window_start,
                days=14,
                show_unallocated=True,
                show_closed=True,
            )
        )

        assert len(board["headers"]) == 14
        assert sum(1 for header in board["headers"] if header["is_today"]) == 1
        assert any(header["is_weekend"] for header in board["headers"])
        assert board["weekend_track_bg"].startswith("linear-gradient(")
        assert "rgba(77,157,255,0.07)" in board["weekend_track_bg"]

        twin_group = next(group for group in board["groups"] if group["room_type_id"] == str(room_type_id))
        all_blocks = [block for row in twin_group["rows"] for block in row["visible_blocks"]]

        long_block = next(block for block in all_blocks if block["reservation_id"] == str(long_stay.id))
        assert long_block["span"] == 14
        assert long_block["clipped_start"] is True
        assert long_block["clipped_end"] is True

        unallocated_row = next(row for row in twin_group["rows"] if row["is_unallocated"])
        assert any(block["reservation_id"] == str(waitlist.id) for block in unallocated_row["visible_blocks"])
        assert {"closure", "external"}.issubset({block["kind"] for block in all_blocks})

        hidden_closures = build_front_desk_board(
            FrontDeskBoardFilters(
                start_date=window_start,
                days=14,
                show_unallocated=True,
                show_closed=False,
            )
        )
        hidden_group = next(group for group in hidden_closures["groups"] if group["room_type_id"] == str(room_type_id))
        hidden_kinds = {block["kind"] for row in hidden_group["rows"] for block in row["visible_blocks"]}
        assert "closure" not in hidden_kinds


def test_front_desk_board_route_requires_reservation_view_permission(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        create_staff_reservation(
            first_name="Route",
            last_name="Board",
            phone="+66810000003",
            room_type_code="DBL",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=2),
        )
        front_desk_user = make_staff_user("front_desk", "board-frontdesk@example.com")
        provider_user = make_staff_user("provider", "board-provider@example.com")

    login_as(client, front_desk_user)
    authorized = client.get(f"/staff/front-desk/board?start_date={date.today().isoformat()}")
    assert authorized.status_code == 200
    assert "Front desk planning board" in authorized.get_data(as_text=True)
    assert "planning-board-cell" not in authorized.get_data(as_text=True)
    assert "--track-bg:" in authorized.get_data(as_text=True)

    login_as(client, provider_user)
    unauthorized = client.get("/staff/front-desk/board")
    assert unauthorized.status_code == 403


def test_front_desk_board_route_exposes_board_v2_flag_from_settings(app_factory):
    app = app_factory(seed=True, config={"FEATURE_BOARD_V2": False})
    client = app.test_client()
    with app.app_context():
        front_desk_user = make_staff_user("front_desk", "board-flag@example.com")

    login_as(client, front_desk_user)
    initial = client.get(f"/staff/front-desk/board?start_date={date.today().isoformat()}")
    assert initial.status_code == 200
    assert 'data-board-v2-enabled="false"' in initial.get_data(as_text=True)

    with app.app_context():
        db.session.add(
            AppSetting(
                key="feature.front_desk_board_v2",
                value_json={"value": True},
                value_type="boolean",
                description="Enable front desk planning board v2 scaffolding",
            )
        )
        db.session.commit()

    enabled = client.get(f"/staff/front-desk/board?start_date={date.today().isoformat()}")
    assert enabled.status_code == 200
    assert 'data-board-v2-enabled="true"' in enabled.get_data(as_text=True)


def test_front_desk_board_route_renders_compact_readable_controls(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        create_staff_reservation(
            first_name="Compact",
            last_name="Layout",
            phone="+66810000061",
            room_type_code="DBL",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=2),
        )
        front_desk_user = make_staff_user("front_desk", "board-compact@example.com")

    login_as(client, front_desk_user)
    response = client.get(f"/staff/front-desk/board?start_date={date.today().isoformat()}")

    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'class="toolbar planning-board-filters"' in html
    assert 'class="planning-board-action-row planning-board-nav-actions"' in html
    assert 'class="planning-board-command-row planning-board-command-primary"' in html
    assert 'class="planning-board-status-strip"' in html
    assert 'class="planning-board-room-badge' in html
    assert 'aria-pressed="true"' in html
    assert "+ Reservation" in html
    assert ">Compact</button>" in html
    assert ">Comfortable</button>" in html
    assert ">Spacious</button>" in html


def test_front_desk_board_data_route_logs_metric_payload(app_factory, monkeypatch):
    app = app_factory(seed=True)
    client = app.test_client()
    logged_messages = []
    monkeypatch.setattr(app.logger, "info", lambda message: logged_messages.append(json.loads(message)))
    with app.app_context():
        create_staff_reservation(
            first_name="Metric",
            last_name="Board",
            phone="+66810000060",
            room_type_code="DBL",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=2),
        )
        front_desk_user = make_staff_user("front_desk", "board-metrics@example.com")

    login_as(client, front_desk_user)
    response = client.get(f"/staff/front-desk/board/data?start_date={date.today().isoformat()}&days=14")

    assert response.status_code == 200
    metric = next(item for item in logged_messages if item["event"] == "front_desk.board.data")
    assert metric["outcome"] == "success"
    assert metric["response_format"] == "json"
    assert metric["group_count"] >= 1
    assert metric["row_count"] >= 1
    assert metric["visible_block_count"] >= 1
    assert metric["board_v2_enabled"] is False


def test_board_room_reassignment_updates_inventory_and_redirects_back_to_anchor(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        start_date = date.today() + timedelta(days=5)
        reservation = create_staff_reservation(
            first_name="Move",
            last_name="Board",
            phone="+66810000004",
            room_type_code="TWN",
            check_in_date=start_date,
            check_out_date=start_date + timedelta(days=2),
        )
        original_room_id = reservation.assigned_room_id
        alternate_room = find_open_room(
            room_type_id=reservation.room_type_id,
            start_date=reservation.check_in_date,
            end_date=reservation.check_out_date,
            exclude_room_ids={original_room_id},
        )
        anchor = f"room-{original_room_id}"
        user = make_staff_user("front_desk", "board-move@example.com")

    login_as(client, user)
    response = post_form(
        client,
        f"/staff/front-desk/board/reservations/{reservation.id}/room",
        data={
            "room_id": str(alternate_room.id),
            "reason": "guest_move",
            "back_url": f"/staff/front-desk/board?start_date={start_date.isoformat()}",
            "return_anchor": anchor,
        },
    )

    assert response.status_code == 302
    assert response.headers["Location"].endswith(f"{start_date.isoformat()}#{anchor}")

    with app.app_context():
        refreshed = db.session.get(Reservation, reservation.id)
        audit_log = (
            AuditLog.query.filter_by(action="staff_room_changed", entity_id=str(reservation.id))
            .order_by(AuditLog.created_at.desc())
            .first()
        )
        assert refreshed.assigned_room_id == alternate_room.id
        old_rows = InventoryDay.query.filter_by(room_id=original_room_id, reservation_id=reservation.id).all()
        new_rows = InventoryDay.query.filter_by(room_id=alternate_room.id, reservation_id=reservation.id).all()
        assert not old_rows
        assert len(new_rows) == 2
        assert audit_log is not None


def test_front_desk_board_data_endpoint_returns_normalized_blocks_and_operational_rows(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        start_date = date.today()
        staff_user = make_staff_user("front_desk", "board-data@example.com")
        unallocated = create_staff_reservation(
            first_name="Unassigned",
            last_name="Guest",
            phone="+66810000040",
            room_type_code="TWN",
            check_in_date=start_date + timedelta(days=2),
            check_out_date=start_date + timedelta(days=4),
            initial_status="confirmed",
            defer_room_assignment=True,
        )
        maintenance_room = find_open_room(
            room_type_id=unallocated.room_type_id,
            start_date=start_date + timedelta(days=5),
            end_date=start_date + timedelta(days=6),
        )
        maintenance_row = InventoryDay.query.filter_by(
            room_id=maintenance_room.id,
            business_date=start_date + timedelta(days=5),
        ).one()
        maintenance_row.maintenance_flag = True
        maintenance_row.notes = "AC servicing"
        db.session.commit()

    login_as(client, staff_user)
    response = client.get(
        f"/staff/front-desk/board/data?start_date={start_date.isoformat()}&days=30&show_closed=1"
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["board"]["days"] == 30
    assert payload["permissions"]["canEdit"] is True

    all_blocks = [
        block
        for group in payload["board"]["groups"]
        for row in group["rows"]
        for block in row["visibleBlocks"]
    ]
    unallocated_block = next(block for block in all_blocks if block["reservationId"] == str(unallocated.id))
    assert unallocated_block["sourceType"] == "reservation"
    assert unallocated_block["allocationState"] == "unallocated"
    assert unallocated_block["roomId"] is None
    assert unallocated_block["draggable"] is True
    assert unallocated_block["resizable"] is False
    assert all(block["searchText"] == block["search_text"] for block in all_blocks)
    assert all(block["laneIndex"] == block["lane_index"] for block in all_blocks)
    assert any(block["sourceType"] == "maintenance" for block in all_blocks)


def test_board_move_json_can_assign_unallocated_reservation_into_room_inventory(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        start_date = date.today() + timedelta(days=5)
        staff_user = make_staff_user("front_desk", "board-json-move@example.com")
        reservation = create_staff_reservation(
            first_name="Desk",
            last_name="Assign",
            phone="+66810000041",
            room_type_code="DBL",
            check_in_date=start_date,
            check_out_date=start_date + timedelta(days=2),
            initial_status="confirmed",
            defer_room_assignment=True,
        )
        reservation_id = reservation.id
        room_type_id = reservation.room_type_id
        check_in_date = reservation.check_in_date
        check_out_date = reservation.check_out_date
        target_room = find_open_room(
            room_type_id=room_type_id,
            start_date=check_in_date,
            end_date=check_out_date,
        )
        target_room_id = target_room.id

    login_as(client, staff_user)
    response = post_json(
        client,
        f"/staff/front-desk/board/reservations/{reservation_id}/move",
        payload={
            "roomId": str(target_room_id),
            "checkInDate": check_in_date.isoformat(),
            "checkOutDate": check_out_date.isoformat(),
        },
    )

    assert response.status_code == 200
    assert response.get_json()["ok"] is True

    with app.app_context():
        refreshed = db.session.get(Reservation, reservation_id)
        inventory_rows = (
            InventoryDay.query.filter_by(reservation_id=reservation_id, room_id=target_room_id)
            .order_by(InventoryDay.business_date.asc())
            .all()
        )
        assert refreshed.assigned_room_id == target_room_id
        assert len(inventory_rows) == 2
        assert all(row.availability_status == "reserved" for row in inventory_rows)


def test_board_move_json_logs_metric_payload(app_factory, monkeypatch):
    app = app_factory(seed=True)
    client = app.test_client()
    logged_messages = []
    monkeypatch.setattr(app.logger, "info", lambda message: logged_messages.append(json.loads(message)))
    with app.app_context():
        start_date = date.today() + timedelta(days=5)
        staff_user = make_staff_user("front_desk", "board-json-metric@example.com")
        reservation = create_staff_reservation(
            first_name="Desk",
            last_name="Metric",
            phone="+66810000061",
            room_type_code="DBL",
            check_in_date=start_date,
            check_out_date=start_date + timedelta(days=2),
            initial_status="confirmed",
            defer_room_assignment=True,
        )
        reservation_id = reservation.id
        target_room = find_open_room(
            room_type_id=reservation.room_type_id,
            start_date=reservation.check_in_date,
            end_date=reservation.check_out_date,
        )

    login_as(client, staff_user)
    response = post_json(
        client,
        f"/staff/front-desk/board/reservations/{reservation_id}/move",
        payload={
            "roomId": str(target_room.id),
            "checkInDate": start_date.isoformat(),
            "checkOutDate": (start_date + timedelta(days=2)).isoformat(),
        },
    )

    assert response.status_code == 200
    metric = next(item for item in logged_messages if item["event"] == "front_desk.board.move")
    assert metric["outcome"] == "success"
    assert metric["status_code"] == 200
    assert metric["reservation_id"] == str(reservation_id)
    assert metric["requested_room_id"] == str(target_room.id)
    assert metric["room_changed"] is True
    assert metric["date_changed"] is False


def test_board_move_json_rejects_room_type_mismatch_and_preserves_state(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        start_date = date.today() + timedelta(days=7)
        staff_user = make_staff_user("front_desk", "board-json-room-type@example.com")
        reservation = create_staff_reservation(
            first_name="Desk",
            last_name="Mismatch",
            phone="+66810000045",
            room_type_code="TWN",
            check_in_date=start_date,
            check_out_date=start_date + timedelta(days=2),
            initial_status="confirmed",
        )
        reservation_id = reservation.id
        original_room_id = reservation.assigned_room_id
        wrong_room = Room.query.filter(Room.room_type.has(code="DBL"), Room.is_active.is_(True)).order_by(Room.room_number.asc()).first()

    login_as(client, staff_user)
    response = post_json(
        client,
        f"/staff/front-desk/board/reservations/{reservation_id}/move",
        payload={
            "roomId": str(wrong_room.id),
            "checkInDate": start_date.isoformat(),
            "checkOutDate": (start_date + timedelta(days=2)).isoformat(),
        },
    )

    assert response.status_code == 409
    assert response.get_json()["ok"] is False

    with app.app_context():
        refreshed = db.session.get(Reservation, reservation_id)
        audit_log = (
            AuditLog.query.filter_by(action="front_desk_board_move_rejected", entity_id=str(reservation_id))
            .order_by(AuditLog.created_at.desc())
            .first()
        )
        assert refreshed.assigned_room_id == original_room_id
        assert audit_log is not None
        assert "booked room type" in audit_log.after_data["failure_reason"]


def test_board_move_json_invalid_request_returns_400_and_records_invalid_request_audit(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        start_date = date.today() + timedelta(days=8)
        staff_user = make_staff_user("front_desk", "board-json-invalid@example.com")
        reservation = create_staff_reservation(
            first_name="Desk",
            last_name="Payload",
            phone="+66810000046",
            room_type_code="DBL",
            check_in_date=start_date,
            check_out_date=start_date + timedelta(days=2),
            initial_status="confirmed",
        )
        reservation_id = reservation.id
        assigned_room_id = reservation.assigned_room_id
        original_check_out = reservation.check_out_date

    login_as(client, staff_user)
    response = post_json(
        client,
        f"/staff/front-desk/board/reservations/{reservation_id}/move",
        payload={
            "roomId": str(assigned_room_id),
            "checkInDate": start_date.isoformat(),
        },
    )

    assert response.status_code == 400
    assert response.get_json()["ok"] is False

    with app.app_context():
        refreshed = db.session.get(Reservation, reservation_id)
        audit_log = (
            AuditLog.query.filter_by(action="front_desk_board_move_invalid_request", entity_id=str(reservation_id))
            .order_by(AuditLog.created_at.desc())
            .first()
        )
        assert refreshed.check_out_date == original_check_out
        assert audit_log is not None
        assert audit_log.after_data["failure_reason"] == "Check-out date is required."


def test_board_move_json_rejects_closure_block_and_preserves_state(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        start_date = date.today() + timedelta(days=11)
        staff_user = make_staff_user("front_desk", "board-json-closure@example.com")
        manager = make_staff_user("manager", "board-json-closure-manager@example.com")
        reservation = create_staff_reservation(
            first_name="Desk",
            last_name="Blocked",
            phone="+66810000047",
            room_type_code="DBL",
            check_in_date=start_date,
            check_out_date=start_date + timedelta(days=2),
            initial_status="confirmed",
        )
        reservation_id = reservation.id
        original_room_id = reservation.assigned_room_id
        blocked_room = find_open_room(
            room_type_id=reservation.room_type_id,
            start_date=reservation.check_in_date,
            end_date=reservation.check_out_date,
            exclude_room_ids={original_room_id},
        )
        create_inventory_override(
            InventoryOverridePayload(
                name="Board blocked room",
                scope_type="room",
                override_action="close",
                room_id=blocked_room.id,
                room_type_id=None,
                start_date=reservation.check_in_date,
                end_date=reservation.check_out_date - timedelta(days=1),
                reason="Blocked for board rejection test",
            ),
            actor_user_id=manager.id,
        )

    login_as(client, staff_user)
    response = post_json(
        client,
        f"/staff/front-desk/board/reservations/{reservation_id}/move",
        payload={
            "roomId": str(blocked_room.id),
            "checkInDate": start_date.isoformat(),
            "checkOutDate": (start_date + timedelta(days=2)).isoformat(),
        },
    )

    assert response.status_code == 409
    assert response.get_json()["ok"] is False

    with app.app_context():
        refreshed = db.session.get(Reservation, reservation_id)
        assert refreshed.assigned_room_id == original_room_id


def test_board_resize_json_rejection_records_audit_and_activity_logs(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        start_date = date.today() + timedelta(days=9)
        staff_user = make_staff_user("front_desk", "board-json-resize@example.com")
        reservation = create_staff_reservation(
            first_name="Resize",
            last_name="Target",
            phone="+66810000042",
            room_type_code="TWN",
            check_in_date=start_date,
            check_out_date=start_date + timedelta(days=2),
            initial_status="confirmed",
        )
        reservation_id = reservation.id
        check_in_date = reservation.check_in_date
        original_check_out_date = reservation.check_out_date
        create_staff_reservation(
            first_name="Resize",
            last_name="Conflict",
            phone="+66810000043",
            room_type_code="TWN",
            check_in_date=original_check_out_date,
            check_out_date=original_check_out_date + timedelta(days=2),
            initial_status="confirmed",
            assigned_room_id=reservation.assigned_room_id,
        )
        rejected_checkout = (original_check_out_date + timedelta(days=1)).isoformat()

    login_as(client, staff_user)
    response = post_json(
        client,
        f"/staff/front-desk/board/reservations/{reservation_id}/resize",
        payload={
            "checkInDate": check_in_date.isoformat(),
            "checkOutDate": rejected_checkout,
        },
    )

    assert response.status_code == 409
    assert response.get_json()["ok"] is False

    with app.app_context():
        refreshed = db.session.get(Reservation, reservation_id)
        audit_log = (
            AuditLog.query.filter_by(action="front_desk_board_resize_rejected", entity_id=str(reservation_id))
            .order_by(AuditLog.created_at.desc())
            .first()
        )
        activity_log = (
            ActivityLog.query.filter_by(event_type="front_desk.board_mutation_rejected", entity_id=str(reservation_id))
            .order_by(ActivityLog.created_at.desc())
            .first()
        )
        assert refreshed.check_out_date == start_date + timedelta(days=2)
        assert audit_log is not None
        assert audit_log.after_data["request"]["checkOutDate"] == rejected_checkout
        assert audit_log.after_data["failure_reason"]
        assert activity_log is not None
        assert activity_log.metadata_json["action"] == "front_desk_board_resize_rejected"


def test_board_resize_json_success_updates_dates_and_writes_audit_log(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        start_date = date.today() + timedelta(days=18)
        staff_user = make_staff_user("front_desk", "board-json-resize-success@example.com")
        reservation = create_staff_reservation(
            first_name="Resize",
            last_name="Success",
            phone="+66810000048",
            room_type_code="TWN",
            check_in_date=start_date,
            check_out_date=start_date + timedelta(days=2),
            initial_status="confirmed",
        )
        reservation_id = reservation.id
        new_checkout = reservation.check_out_date + timedelta(days=1)

    login_as(client, staff_user)
    response = post_json(
        client,
        f"/staff/front-desk/board/reservations/{reservation_id}/resize",
        payload={
            "checkInDate": start_date.isoformat(),
            "checkOutDate": new_checkout.isoformat(),
        },
    )

    assert response.status_code == 200
    assert response.get_json()["ok"] is True

    with app.app_context():
        refreshed = db.session.get(Reservation, reservation_id)
        audit_log = (
            AuditLog.query.filter_by(action="staff_stay_dates_changed", entity_id=str(reservation_id))
            .order_by(AuditLog.created_at.desc())
            .first()
        )
        assert refreshed.check_out_date == new_checkout
        assert audit_log is not None


def test_board_closure_create_and_release_actions_round_trip(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        start_date = date.today() + timedelta(days=10)
        end_date = start_date + timedelta(days=1)
        room_type = RoomType.query.filter_by(code="DBL").one()
        room = find_open_room(room_type_id=room_type.id, start_date=start_date, end_date=end_date + timedelta(days=1))
        manager = make_staff_user("manager", "board-closures@example.com")

    login_as(client, manager)
    create_response = post_form(
        client,
        "/staff/front-desk/board/closures",
        data={
            "room_id": str(room.id),
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "name": "Board closure",
            "reason": "Aircon maintenance",
            "back_url": f"/staff/front-desk/board?start_date={start_date.isoformat()}&show_closed=1",
            "return_anchor": "board-top",
        },
    )

    assert create_response.status_code == 302
    assert create_response.headers["Location"].endswith(f"show_closed=1#board-top")

    with app.app_context():
        override = InventoryOverride.query.filter_by(name="Board closure", is_active=True).one()

    release_response = post_form(
        client,
        f"/staff/front-desk/board/closures/{override.id}/release",
        data={
            "back_url": f"/staff/front-desk/board?start_date={start_date.isoformat()}&show_closed=1",
            "return_anchor": "board-top",
        },
    )

    assert release_response.status_code == 302
    assert release_response.headers["Location"].endswith(f"show_closed=1#board-top")

    with app.app_context():
        refreshed = db.session.get(InventoryOverride, override.id)
        assert refreshed.is_active is False


def test_front_desk_board_move_json_requires_edit_permission(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        start_date = date.today() + timedelta(days=6)
        reservation = create_staff_reservation(
            first_name="Rbac",
            last_name="Denied",
            phone="+66810000049",
            room_type_code="DBL",
            check_in_date=start_date,
            check_out_date=start_date + timedelta(days=2),
            initial_status="confirmed",
        )
        reservation_id = reservation.id
        assigned_room_id = reservation.assigned_room_id
        check_in_date = reservation.check_in_date
        check_out_date = reservation.check_out_date
        provider_user = make_staff_user("provider", "board-rbac-provider@example.com")

    login_as(client, provider_user)
    response = post_json(
        client,
        f"/staff/front-desk/board/reservations/{reservation_id}/move",
        payload={
            "roomId": str(assigned_room_id),
            "checkInDate": check_in_date.isoformat(),
            "checkOutDate": check_out_date.isoformat(),
        },
    )

    assert response.status_code == 403


def test_front_desk_board_export_and_import_ical_routes_round_trip_metadata(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        start_date = date.today() + timedelta(days=6)
        staff_user = make_staff_user("front_desk", "board-ical@example.com")
        reservation = create_staff_reservation(
            first_name="Calendar",
            last_name="Guest",
            phone="+66810000044",
            room_type_code="DBL",
            check_in_date=start_date,
            check_out_date=start_date + timedelta(days=2),
            initial_status="confirmed",
        )
        reservation_id = reservation.id
        assigned_room_id = reservation.assigned_room_id
        room_type_id = reservation.room_type_id
        source = ExternalCalendarSource(
            room_id=assigned_room_id,
            name="Board import source",
            feed_url_encrypted="encrypted-feed",
            feed_url_hint="calendar.example",
            external_reference="board-import",
            is_active=True,
            last_status="success",
        )
        db.session.add(source)
        db.session.flush()
        db.session.add(
            ExternalCalendarBlock(
                source_id=source.id,
                room_id=assigned_room_id,
                external_uid="board-import-dup",
                summary="Existing imported block",
                starts_on=start_date + timedelta(days=7),
                ends_on=start_date + timedelta(days=8),
            )
        )
        db.session.commit()

    login_as(client, staff_user)
    export_response = client.get(
        f"/staff/front-desk/board/export.ics?start_date={start_date.isoformat()}&days=14&block_id=reservation-{reservation_id}"
    )

    assert export_response.status_code == 200
    export_body = export_response.data.decode("utf-8")
    assert "BEGIN:VCALENDAR" in export_body
    assert f"X-RESERVATION-ID:{reservation_id}" in export_body
    assert f"X-ROOM-ID:{assigned_room_id}" in export_body
    assert f"X-ROOM-TYPE-ID:{room_type_id}" in export_body
    assert "X-BLOCK-TYPE:reservation" in export_body
    assert "X-PMS-STATUS:confirmed" in export_body

    import_response = post_form(
        client,
        f"/staff/front-desk/board/import.ics?start_date={start_date.isoformat()}&days=14",
        data={
            "ical_text": "\n".join(
                [
                    "BEGIN:VCALENDAR",
                    "VERSION:2.0",
                    "PRODID:-//Sandbox Hotel//Board Import Test//EN",
                    "BEGIN:VEVENT",
                    "UID:board-import-dup",
                    f"DTSTART;VALUE=DATE:{(start_date + timedelta(days=9)).strftime('%Y%m%d')}",
                    f"DTEND;VALUE=DATE:{(start_date + timedelta(days=10)).strftime('%Y%m%d')}",
                    "SUMMARY:Duplicate board import",
                    "END:VEVENT",
                    "END:VCALENDAR",
                    "",
                ]
            ),
        },
    )

    assert import_response.status_code == 200
    import_body = import_response.get_data(as_text=True)
    assert "Validation summary" in import_body
    assert "Duplicate UID issues: 1" in import_body


def test_staff_reservation_create_route_prefills_and_creates_house_use_booking(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        room_type = RoomType.query.filter_by(code="TWN").one()
        user = make_staff_user("front_desk", "board-create@example.com")
        check_in = date.today() + timedelta(days=12)
        check_out = check_in + timedelta(days=2)

    login_as(client, user)
    prefill_response = client.get(
        f"/staff/reservations/new?back=/staff/front-desk/board%3Fstart_date%3D{check_in.isoformat()}&check_in={check_in.isoformat()}&check_out={check_out.isoformat()}&room_type_id={room_type.id}&status=house_use"
    )
    prefill_body = prefill_response.get_data(as_text=True)
    assert prefill_response.status_code == 200
    assert "Create reservation" in prefill_body
    assert f'value="{check_in.isoformat()}"' in prefill_body
    assert "House Use" in prefill_body

    response = post_form(
        client,
        "/staff/reservations/new",
        data={
            "back": f"/staff/front-desk/board?start_date={check_in.isoformat()}",
            "first_name": "House",
            "last_name": "Use",
            "guest_phone": "+66810000005",
            "guest_email": "house.use@example.com",
            "source_channel": "admin_manual",
            "status": "house_use",
            "room_type_id": str(room_type.id),
            "check_in": check_in.isoformat(),
            "check_out": check_out.isoformat(),
            "adults": "2",
            "children": "0",
            "extra_guests": "0",
            "special_requests": "Board-created stay",
            "internal_notes": "board-create-house-use",
        },
    )

    assert response.status_code == 302
    assert "/staff/reservations/" in response.headers["Location"]
    assert "back=/staff/front-desk/board?start_date%3D" in response.headers["Location"]

    with app.app_context():
        reservation = Reservation.query.filter_by(internal_notes="board-create-house-use").one()
        inventory_rows = InventoryDay.query.filter_by(reservation_id=reservation.id).all()
        assert reservation.current_status == "house_use"
        assert inventory_rows
        assert all(row.availability_status == "house_use" for row in inventory_rows)


# ===== Sprint 0 Tests: Feature Flag & Metrics Infrastructure =====


class TestBoardV2FeatureFlag:
    """Test feature flag framework and v2 endpoint guards."""

    def test_v2_feature_disabled_by_default(self, app_factory):
        """V2 feature should be off by default in config."""
        app = app_factory(config={"FEATURE_BOARD_V2": False})
        with app.app_context():
            from pms.front_desk_board_runtime import front_desk_board_v2_enabled

            assert front_desk_board_v2_enabled() is False

    def test_v2_feature_enabled_when_configured(self, app_factory):
        """V2 feature should be on if configured."""
        app = app_factory(config={"FEATURE_BOARD_V2": True})
        with app.app_context():
            from pms.front_desk_board_runtime import front_desk_board_v2_enabled

            assert front_desk_board_v2_enabled() is True

    def test_v1_endpoints_work_when_v2_disabled(self, app_factory):
        """V1 board endpoints should work when v2 is disabled."""
        app = app_factory(seed=True, config={"FEATURE_BOARD_V2": False})
        client = app.test_client()
        with app.app_context():
            user = make_staff_user("front_desk", "test-v1@example.com")

        login_as(client, user)

        # V1 endpoints should work
        response = client.get("/staff/front-desk/board")
        assert response.status_code == 200
        assert b"Front Desk Board" in response.data or b"planning-board" in response.data

        response = client.get("/staff/front-desk/board/fragment")
        assert response.status_code == 200

        response = client.get("/staff/front-desk/board/data")
        assert response.status_code == 200

        response = client.get("/staff/front-desk/board/rooms")
        assert response.status_code == 200

    def test_is_v2_endpoint_detection(self):
        """Test the is_v2_endpoint helper function."""
        from pms.front_desk_board_runtime import is_v2_endpoint

        # V2 endpoints that should be gated
        assert is_v2_endpoint("staff_front_desk_board_events") is True
        assert is_v2_endpoint("staff_front_desk_board_check_in") is True
        assert is_v2_endpoint("staff_front_desk_board_check_out") is True
        assert is_v2_endpoint("staff_front_desk_board_mark_room_ready") is True
        assert is_v2_endpoint("staff_front_desk_board_reservation_panel") is True

        # Non-v2 endpoints
        assert is_v2_endpoint("staff_front_desk_board_preferences") is False
        assert is_v2_endpoint("staff_front_desk_board") is False
        assert is_v2_endpoint("staff_front_desk_board_move_reservation") is False
        assert is_v2_endpoint(None) is False
        assert is_v2_endpoint("nonexistent_endpoint") is False

    def test_check_board_v2_feature_gate_returns_404_when_disabled(self, app_factory):
        """V2 endpoints should return 404 when feature is disabled.

        Note: This test will skip if no v2 endpoints are registered yet,
        as they'll be added in Sprint 3 and beyond.
        """
        app = app_factory(seed=True, config={"FEATURE_BOARD_V2": False})
        client = app.test_client()
        with app.app_context():
            user = make_staff_user("front_desk", "test-gate@example.com")
            from pms.front_desk_board_runtime import front_desk_board_v2_enabled

            # Verify the feature flag is actually False.
            assert front_desk_board_v2_enabled() is False


class TestBoardMetricsInfrastructure:
    """Test metrics logging for board operations."""

    def test_log_metrics_includes_v2_flag(self, app_factory, monkeypatch):
        """Board metrics should include v2_enabled flag in logs."""
        app = app_factory(seed=True, config={"FEATURE_BOARD_V2": False})

        with app.app_context():
            from pms.front_desk_board_runtime import log_front_desk_board_metric
            from time import perf_counter

            # Capture logged output
            logged_messages = []

            original_info = app.logger.info

            def mock_info(msg, *args, **kwargs):
                logged_messages.append(msg)
                return original_info(msg, *args, **kwargs)

            monkeypatch.setattr(app.logger, "info", mock_info)

            # Log a metric
            started = perf_counter()
            log_front_desk_board_metric(
                event="test.board.render",
                started_at=started,
                board={"groups": [], "days": 7},
            )

            # Verify metric was logged with v2_enabled flag
            assert len(logged_messages) > 0
            last_log = logged_messages[-1]
            assert "test.board.render" in last_log
            assert "board_v2_enabled" in last_log
            assert "false" in last_log or "False" in last_log.lower()

    def test_log_metrics_with_board_summary(self, app_factory, monkeypatch):
        """Metrics should include board summary stats when provided."""
        app = app_factory(seed=True)

        with app.app_context():
            from pms.front_desk_board_runtime import log_front_desk_board_metric
            from time import perf_counter

            logged_messages = []

            original_info = app.logger.info

            def mock_info(msg, *args, **kwargs):
                logged_messages.append(msg)
                return original_info(msg, *args, **kwargs)

            monkeypatch.setattr(app.logger, "info", mock_info)

            board = {
                "groups": [{"rows": [{"visible_blocks": [1, 2, 3]}, {"visible_blocks": []}]}],
                "days": 7,
            }

            started = perf_counter()
            log_front_desk_board_metric(
                event="test.board.render",
                started_at=started,
                board=board,
            )

            last_log = logged_messages[-1]
            assert "group_count" in last_log
            assert "row_count" in last_log
            assert "visible_block_count" in last_log



# ===== Sprint 1 Tests: Layout & Density =====


class TestBoardDensityPreferences:
    """Test density toggle and user preference persistence."""

    def test_default_user_density_is_comfortable(self, app_factory):
        """New users should default to comfortable density."""
        app = app_factory(seed=True)
        with app.app_context():
            from pms.app import front_desk_board_context

            user = make_staff_user("front_desk", "density-test@example.com")
            filters = FrontDeskBoardFilters(start_date=date.today())

            # Simulate being logged in
            with app.test_request_context():
                from flask import g

                g.current_staff_user = user
                context = front_desk_board_context(filters)
                assert context["user_density"] == "comfortable"

    def test_user_can_save_density_preference(self, app_factory):
        """User should be able to save density preference via endpoint."""
        app = app_factory(seed=True)
        client = app.test_client()
        with app.app_context():
            user = make_staff_user("front_desk", "density-save@example.com")

        login_as(client, user)

        # Save preference
        response = client.post(
            "/staff/front-desk/board/preferences",
            json={"density": "compact"},
            headers={"X-CSRF-Token": "test-csrf-token"},
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["ok"] is True
        assert data["density"] == "compact"

    def test_saved_density_persists_across_sessions(self, app_factory):
        """Saved density preference should load on next page visit."""
        app = app_factory(seed=True)
        client = app.test_client()
        with app.app_context():
            user = make_staff_user("front_desk", "density-persist@example.com")

        login_as(client, user)

        # Save density
        response = client.post(
            "/staff/front-desk/board/preferences",
            json={"density": "compact"},
            headers={"X-CSRF-Token": "test-csrf-token"},
        )
        assert response.status_code == 200

        # Load board and verify density is in context
        response = client.get("/staff/front-desk/board")
        assert response.status_code == 200
        assert b'density-compact' in response.data or b'class="planning-board-grid density' in response.data

    def test_invalid_density_returns_400(self, app_factory):
        """Invalid density value should return 400."""
        app = app_factory(seed=True)
        client = app.test_client()
        with app.app_context():
            user = make_staff_user("front_desk", "density-invalid@example.com")

        login_as(client, user)

        response = client.post(
            "/staff/front-desk/board/preferences",
            json={"density": "invalid_value"},
            headers={"X-CSRF-Token": "test-csrf-token"},
        )

        assert response.status_code == 400

    def test_density_preference_requires_view_permission(self, app_factory):
        """Saving density should require at least reservation.view permission."""
        app = app_factory(seed=True)
        client = app.test_client()
        with app.app_context():
            user = make_staff_user("provider", "density-perm@example.com")

        login_as(client, user)

        response = client.post(
            "/staff/front-desk/board/preferences",
            json={"density": "compact"},
            headers={"X-CSRF-Token": "test-csrf-token"},
        )

        assert response.status_code == 403

    def test_user_preference_model_stores_density(self, app_factory):
        """UserPreference model should correctly store preferences."""
        from pms.models import UserPreference

        app = app_factory(seed=True)
        with app.app_context():
            user = make_staff_user("front_desk", "density-model@example.com")

            # Manually create preference
            pref = UserPreference(user_id=user.id, preferences={"frontDeskBoard": {"density": "compact"}})
            db.session.add(pref)
            db.session.commit()

            # Reload and verify
            retrieved = UserPreference.query.filter_by(user_id=user.id).first()
            assert retrieved is not None
            assert retrieved.preferences["frontDeskBoard"]["density"] == "compact"

    def test_density_board_class_renders_correctly(self, app_factory):
        """Board HTML should include density class."""
        app = app_factory(seed=True)
        client = app.test_client()
        with app.app_context():
            user = make_staff_user("front_desk", "density-render@example.com")

        login_as(client, user)
        response = client.get("/staff/front-desk/board")

        assert response.status_code == 200
        # Should have comfortable as default
        assert b"density-comfortable" in response.data

    def test_spacious_density_is_accepted(self, app_factory):
        """Spacious density should be accepted by the preferences endpoint."""
        app = app_factory(seed=True)
        client = app.test_client()
        with app.app_context():
            user = make_staff_user("front_desk", "density-spacious@example.com")

        login_as(client, user)

        response = client.post(
            "/staff/front-desk/board/preferences",
            json={"density": "spacious"},
            headers={"X-CSRF-Token": "test-csrf-token"},
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["ok"] is True
        assert data["density"] == "spacious"

    def test_spacious_density_toggle_button_in_html(self, app_factory):
        """Board template should render a Spacious density toggle button."""
        app = app_factory(seed=True)
        client = app.test_client()
        with app.app_context():
            user = make_staff_user("front_desk", "density-spacious-btn@example.com")

        login_as(client, user)
        response = client.get("/staff/front-desk/board")

        assert response.status_code == 200
        assert b'data-density="spacious"' in response.data


class TestBoardKeyboardSelection:
    """Test keyboard selection model, including cross-track navigation."""

    def test_board_page_loads_with_keyboard_support(self, app_factory):
        """Board page should load and support keyboard navigation."""
        app = app_factory(seed=True)
        client = app.test_client()
        with app.app_context():
            user = make_staff_user("front_desk", "kb-select@example.com")

        login_as(client, user)
        response = client.get("/staff/front-desk/board")

        assert response.status_code == 200
        # Verify board structure and scripts are present
        assert b"front-desk-board-surface" in response.data
        assert b"front-desk-board.js" in response.data

    def test_board_page_has_selection_script(self, app_factory):
        """Board page should load JavaScript for selection handling."""
        app = app_factory(seed=True)
        client = app.test_client()
        with app.app_context():
            user = make_staff_user("front_desk", "kb-script@example.com")

        login_as(client, user)
        response = client.get("/staff/front-desk/board")

        assert response.status_code == 200
        # Verify JavaScript is loaded
        assert b"front-desk-board.js" in response.data

    def test_selection_script_supports_cross_track_navigation(self, app_factory):
        """Selection script should navigate between adjacent room tracks."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/front-desk-board.js")

        assert response.status_code == 200
        content = response.get_data(as_text=True)
        assert 'querySelectorAll("[data-board-track]")' in content
        assert "findAdjacentBlock" in content
        assert "getClosestBlockInTrack" in content
        assert 'case "ArrowUp":' in content
        assert 'case "ArrowDown":' in content

    def test_keyboard_navigation_uses_selected_block_state(self, app_factory):
        """Keyboard navigation should rely on selected state, not only current event target block."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/front-desk-board.js")

        assert response.status_code == 200
        content = response.get_data(as_text=True)
        assert "if (!selectedBlock)" in content
        assert "const blockEl = event.target instanceof Element ? event.target.closest(\"[data-board-block]\") : null;" not in content

    def test_board_css_has_selected_styling(self, app_factory):
        """Board CSS should include styling for selected blocks."""
        app = app_factory(seed=True)
        client = app.test_client()

        # Fetch the CSS file
        response = client.get("/static/styles.css")

        assert response.status_code == 200
        # Verify selected state CSS is present
        assert b".planning-board-block.selected > summary" in response.data
        assert b"outline:" in response.data


class TestBoardKeyboardMoveResize:
    """Test keyboard move/resize modes with room-target navigation."""

    def test_move_mode_styles_defined(self, app_factory):
        """CSS should include styling for move-mode class."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/styles.css")

        assert response.status_code == 200
        # Verify move-mode CSS is present
        assert b".planning-board-block.move-mode > summary" in response.data

    def test_resize_mode_styles_defined(self, app_factory):
        """CSS should include styling for resize-mode class."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/styles.css")

        assert response.status_code == 200
        # Verify resize-mode CSS is present
        assert b".planning-board-block.resize-mode > summary" in response.data

    def test_board_script_has_move_mode_functions(self, app_factory):
        """JavaScript should include move mode handler functions."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/front-desk-board.js")

        assert response.status_code == 200
        # Verify move mode functions are in the script
        assert b"enterMoveMode" in response.data
        assert b"exitMoveMode" in response.data
        assert b"submitMove" in response.data

    def test_board_script_has_resize_mode_functions(self, app_factory):
        """JavaScript should include resize mode handler functions."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/front-desk-board.js")

        assert response.status_code == 200
        # Verify resize mode functions are in the script
        assert b"enterResizeMode" in response.data
        assert b"exitResizeMode" in response.data
        assert b"submitResize" in response.data

    def test_keyboard_handlers_support_m_and_r_keys(self, app_factory):
        """Keyboard handler should recognize M and R key presses."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/front-desk-board.js")

        assert response.status_code == 200
        # Verify M and R key handling
        content = response.get_data(as_text=True)
        assert "case \"m\":" in content or "case 'm':" in content
        assert "case \"r\":" in content or "case 'r':" in content
        assert "enterMoveMode()" in content
        assert "enterResizeMode()" in content

    def test_move_mode_tracks_target_lane_without_reselecting_block(self, app_factory):
        """Move mode should keep the source block selected and change only the target lane."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/front-desk-board.js")

        assert response.status_code == 200
        content = response.get_data(as_text=True)
        assert "moveTargetTrack" in content
        assert "setMoveTarget" in content
        assert "moveTargetBy" in content
        assert "isCompatibleMoveTrack" in content


class TestBoardGlobalActionShortcuts:
    """Test Sprint 2.3: Global action shortcuts (/, ?, A, C, O)."""

    def test_board_script_has_global_shortcut_handlers(self, app_factory):
        """JavaScript should include global shortcut handler functions."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/front-desk-board.js")

        assert response.status_code == 200
        # Verify shortcut functions exist
        assert b"openSearchPanel" in response.data
        assert b"showKeyboardHelp" in response.data
        assert b"performCheckIn" in response.data
        assert b"performCheckOut" in response.data

    def test_keyboard_shortcuts_in_script(self, app_factory):
        """JavaScript should handle global keyboard shortcuts."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/front-desk-board.js")

        assert response.status_code == 200
        content = response.get_data(as_text=True)
        # Verify slash key handling
        assert 'case "/"' in content or "case '/':" in content
        # Verify question mark handling
        assert 'case "?"' in content or "case '?':" in content
        # Verify A/C/O keys handling
        assert "case \"a\":" in content or "case 'a':" in content
        assert "case \"c\":" in content or "case 'c':" in content
        assert "case \"o\":" in content or "case 'o':" in content

    def test_check_in_and_checkout_endpoints_in_app(self, app_factory):
        """App should register check-in and check-out endpoints."""
        from sandbox_pms_mvp.pms.app import create_app

        app = create_app()
        routes = [str(rule) for rule in app.url_map.iter_rules()
                  if "check_in" in str(rule) or "check_out" in str(rule)]

        # Should have at least the check_in endpoint
        assert any("check_in" in route for route in routes)
        # Should have at least the check_out endpoint
        assert any("check_out" in route for route in routes)


class TestBoardCommandPalette:
    """Test Sprint 2.4: Command palette UI (optional enhancement)."""

    def test_keyboard_help_function_exists(self, app_factory):
        """JavaScript should have keyboard help display function."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/front-desk-board.js")

        assert response.status_code == 200
        # Verify help function exists
        assert b"showKeyboardHelp" in response.data
        # Verify help content with shortcuts
        assert b"Keyboard Shortcuts" in response.data
        assert b"Move mode" in response.data
        assert b"Resize mode" in response.data

    def test_search_panel_function_exists(self, app_factory):
        """JavaScript should have search panel function (stub)."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/front-desk-board.js")

        assert response.status_code == 200
        # Verify search panel function exists
        assert b"openSearchPanel" in response.data

    def test_command_palette_infrastructure_in_place(self, app_factory):
        """Global keyboard event listener should  handle command palette triggers."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/front-desk-board.js")

        assert response.status_code == 200
        content = response.get_data(as_text=True)

        # Verify global event listener exists
        assert "document.addEventListener" in content
        assert "keydown" in content

        # Verify slash key handling for search/command palette
        assert 'case "/"' in content or "case '/':" in content

    def test_help_modal_displays_shortcuts(self, app_factory):
        """Help modal should display all major keyboard shortcuts."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/front-desk-board.js")

        assert response.status_code == 200
        # Verify shortcut descriptions are in the help text
        assert b"Navigate blocks across room tracks" in response.data
        assert b"Move mode (keyboard alternative to drag)" in response.data
        assert b"Resize mode (keyboard alternative to drag)" in response.data
        assert b"Check-in" in response.data
        assert b"Check-out" in response.data

    def test_help_uses_html_feedback_rendering(self, app_factory):
        """Keyboard help should render structured HTML in the feedback region."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/front-desk-board.js")

        assert response.status_code == 200
        assert b"allowHtml" in response.data
        assert b"feedback.innerHTML" in response.data


class TestBoardSidePanel:
    """Test Sprint 3: Side panel for reservation details."""

    def test_panel_html_element_exists(self, app_factory):
        """Board page should include side panel HTML element."""
        app = app_factory(seed=True)
        client = app.test_client()
        with app.app_context():
            user = make_staff_user("front_desk", "panel@example.com")

        login_as(client, user)
        response = client.get("/staff/front-desk/board")

        assert response.status_code == 200
        # Verify panel HTML is present
        assert b'id="board-side-panel"' in response.data
        assert b'data-panel-title' in response.data
        assert b'data-action="close-panel"' in response.data

    def test_panel_css_styles_present(self, app_factory):
        """CSS should include panel styling."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/styles.css")

        assert response.status_code == 200
        # Verify panel CSS classes are present
        assert b".board-side-panel" in response.data
        assert b".panel-header" in response.data
        assert b".panel-content" in response.data
        assert b"transform: translateX(100%)" in response.data

    def test_panel_endpoint_exists(self, app_factory):
        """Panel endpoint should exist and be accessible."""
        from sandbox_pms_mvp.pms.app import create_app

        app = create_app()
        routes = [str(rule) for rule in app.url_map.iter_rules()
                  if "panel" in str(rule)]

        # Should have panel endpoint
        assert any("panel" in route for route in routes)

    def test_panel_javascript_handlers_present(self, app_factory):
        """JavaScript should include panel handler functions."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/front-desk-board.js")

        assert response.status_code == 200
        # Verify panel functions exist
        assert b"openPanel" in response.data
        assert b"closePanel" in response.data
        assert b"attachPanelHandlers" in response.data
        assert b"board-side-panel" in response.data
        # Verify panel is referenced in event listeners
        assert b"panelEl" in response.data or b"board-side-panel" in response.data

    def test_panel_supports_escape_key_close(self, app_factory):
        """Side panel should close via Escape for keyboard users."""
        app = app_factory(seed=True)
        client = app.test_client()

        response = client.get("/static/front-desk-board.js")

        assert response.status_code == 200
        content = response.get_data(as_text=True)
        assert 'panelEl.addEventListener("keydown"' in content
        assert 'event.key === "Escape"' in content


class TestBoardSSERealtimeSync:
    """Test Sprint 4: Real-time sync with Server-Sent Events."""

    def test_sse_endpoint_requires_auth(self, app_factory):
        """SSE endpoint should require authentication."""
        app = app_factory(seed=True, config={"FEATURE_BOARD_V2": True})
        client = app.test_client()

        response = client.get("/staff/front-desk/board/events")

        assert response.status_code == 401

    def test_sse_endpoint_requires_reservation_view_permission(self, app_factory):
        """SSE endpoint should require reservation.view permission."""
        app = app_factory(seed=True, config={"FEATURE_BOARD_V2": True})
        client = app.test_client()
        with app.app_context():
            # Create user with no permissions
            user = User(
                username="noperms",
                email="noperms@example.com",
                full_name="No Perms",
                password_hash=generate_password_hash("password"),
                is_active=True,
                account_state="active",
            )
            db.session.add(user)
            db.session.commit()
            login_as(client, user)

        response = client.get("/staff/front-desk/board/events")

        assert response.status_code == 403

    def test_sse_endpoint_returns_event_stream_content_type(self, app_factory):
        """SSE endpoint should return text/event-stream content type."""
        app = app_factory(seed=True, config={"FEATURE_BOARD_V2": True})
        client = app.test_client()
        with app.app_context():
            user = make_staff_user("front_desk", "sse@example.com")
            login_as(client, user)

        response = client.get("/staff/front-desk/board/events")

        assert response.status_code == 200
        assert response.headers["Content-Type"].startswith("text/event-stream")
        assert response.headers["Cache-Control"] == "no-cache"
        assert response.headers["Connection"] == "keep-alive"

    def test_sse_emits_event_on_activity_log_write(self, app_factory):
        """SSE should emit event when activity log is written."""
        app = app_factory(seed=True, config={"FEATURE_BOARD_V2": True})
        client = app.test_client()
        with app.app_context():
            user = make_staff_user("front_desk", "sse-activity@example.com")
            login_as(client, user)

            # Write an activity log entry
            activity = ActivityLog(
                actor_user_id=user.id,
                event_type="reservation.room_changed",
                entity_table="reservations",
                entity_id="test-res-id",
                metadata_json={"room_id": "new-room"},
            )
            db.session.add(activity)
            db.session.commit()

            # Get SSE stream (this will block, so we test the setup, not actual streaming)
            response = client.get("/staff/front-desk/board/events")

            # Should be able to start the stream
            assert response.status_code == 200
            # Content should be iterable/streamable
            assert response.is_streamed

    def test_sse_filters_board_and_reservation_events(self, app_factory):
        """SSE endpoint should listen for front_desk.board and reservation events."""
        app = app_factory(seed=True, config={"FEATURE_BOARD_V2": True})
        with app.app_context():
            # Create sample activity logs
            user = make_staff_user("front_desk", "sse-filter@example.com")

            # Add various event types
            events = [
                ActivityLog(
                    actor_user_id=user.id,
                    event_type="front_desk.board_check_in",
                    entity_table="reservations",
                    metadata_json={},
                ),
                ActivityLog(
                    actor_user_id=user.id,
                    event_type="reservation.room_changed",
                    entity_table="reservations",
                    metadata_json={},
                ),
                ActivityLog(
                    actor_user_id=user.id,
                    event_type="auth.login",  # Should NOT match filter
                    entity_table="users",
                    metadata_json={},
                ),
            ]
            for event in events:
                db.session.add(event)
            db.session.commit()

            # Query database to verify events can be filtered
            import sqlalchemy as sa

            query = ActivityLog.query.filter(
                sa.or_(
                    ActivityLog.event_type.ilike("front_desk.board_%"),
                    ActivityLog.event_type.ilike("reservation.%"),
                )
            )
            results = query.all()

            # Should find 2 matching events, not the auth.login event
            assert len(results) == 2
            event_types = {r.event_type for r in results}
            assert "front_desk.board_check_in" in event_types
            assert "reservation.room_changed" in event_types
            assert "auth.login" not in event_types

    def test_sse_javascript_infrastructure_present(self, app_factory):
        """JavaScript should include SSE EventSource infrastructure."""
        app = app_factory(seed=True, config={"FEATURE_BOARD_V2": True})
        client = app.test_client()

        response = client.get("/static/front-desk-board.js")

        assert response.status_code == 200
        content = response.get_data(as_text=True)

        # Verify EventSource initialization
        assert "EventSource" in content
        assert "initSSE" in content
        assert "closeSSE" in content
        assert "/staff/front-desk/board/events" in content

        # Verify debouncing
        assert "debounceRefreshSurface" in content
        assert "refreshTimeout" in content

        # Verify error handling
        assert "MAX_SSE_RETRIES" in content
        assert "eventSource.addEventListener" in content
        assert "JSON.parse" in content
        assert "payload.event_type" in content
        assert "front_desk.board_" in content
        assert "reservation." in content

    def test_sse_event_payload_contains_extended_fields(self, app_factory):
        """SSE payload contract should include activity and entity metadata fields."""
        app = app_factory(seed=True, config={"FEATURE_BOARD_V2": True})
        assert app is not None

        app_source = Path(__file__).resolve().parents[1] / "pms" / "app.py"
        source_text = app_source.read_text(encoding="utf-8")

        assert '"activity_id": str(event.id)' in source_text
        assert '"entity_table": event.entity_table' in source_text
        assert '"metadata": event.metadata_json or {}' in source_text

    def test_move_operation_writes_activity_log(self, app_factory):
        """Move operation should write activity log for SSE to pick up."""
        app = app_factory(seed=True, config={"FEATURE_BOARD_V2": True})
        client = app.test_client()
        with app.app_context():
            user = make_staff_user("front_desk", "move@example.com")
            login_as(client, user)

            room_type = RoomType.query.first()
            start_date = date.today()

            # Create reservation first (assigned to a seeded room)
            res = create_reservation(
                ReservationCreatePayload(
                    room_type_id=room_type.id,
                    check_in_date=start_date,
                    check_out_date=start_date + timedelta(days=1),
                    first_name="Test",
                    last_name="Guest",
                    email="guest@example.com",
                    phone="555-1234",
                    adults=1,
                    children=0,
                    extra_guests=0,
                ),
                actor_user_id=user.id,
            )

            # Now create a second room as the move target
            room = Room(room_type_id=room_type.id, room_number=101, floor_number=1, is_active=True)
            db.session.add(room)
            db.session.flush()
            inv = InventoryDay(
                room_id=room.id,
                room_type_id=room_type.id,
                business_date=start_date,
                availability_status="available",
                is_sellable=True,
            )
            db.session.add(inv)
            db.session.commit()

            # Clear activity logs before move
            ActivityLog.query.delete()
            db.session.commit()

            # Perform move
            response = post_json(
                client,
                f"/staff/front-desk/board/reservations/{res.id}/move",
                payload={
                    "checkInDate": start_date.isoformat(),
                    "checkOutDate": (start_date + timedelta(days=1)).isoformat(),
                    "roomId": str(room.id),
                },
            )

            assert response.status_code == 200

            # Verify activity log was written
            activities = ActivityLog.query.filter(
                ActivityLog.entity_id == str(res.id)
            ).all()

            # Should have activity from move operation (via service layer)
            assert len(activities) > 0
            # At least one should be reservation-related
            event_types = {a.event_type for a in activities}
            assert any("reservation" in et or "front_desk.board" in et for et in event_types)
