from __future__ import annotations

from datetime import date, timedelta

from werkzeug.security import generate_password_hash

from pms.extensions import db
from pms.models import ActivityLog, AuditLog, ExternalCalendarBlock, ExternalCalendarSource, InventoryDay, InventoryOverride, Reservation, Role, Room, RoomType, User
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

    login_as(client, provider_user)
    unauthorized = client.get("/staff/front-desk/board")
    assert unauthorized.status_code == 403


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
