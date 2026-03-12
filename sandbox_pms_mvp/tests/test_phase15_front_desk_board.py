from __future__ import annotations

from datetime import date, timedelta

from werkzeug.security import generate_password_hash

from pms.extensions import db
from pms.models import ExternalCalendarBlock, ExternalCalendarSource, InventoryDay, InventoryOverride, Reservation, Role, Room, RoomType, User
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


def create_staff_reservation(
    *,
    first_name: str,
    last_name: str,
    phone: str,
    room_type_code: str,
    check_in_date: date,
    check_out_date: date,
    initial_status: str | None = None,
) -> Reservation:
    room_type = RoomType.query.filter_by(code=room_type_code).one()
    return create_reservation(
        ReservationCreatePayload(
            first_name=first_name,
            last_name=last_name,
            phone=phone,
            email=f"{first_name.lower()}.{last_name.lower()}@example.com",
            room_type_id=room_type.id,
            check_in_date=check_in_date,
            check_out_date=check_out_date,
            adults=2,
            children=0,
            source_channel="admin_manual",
            initial_status=initial_status,
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
        assert refreshed.assigned_room_id == alternate_room.id
        old_rows = InventoryDay.query.filter_by(room_id=original_room_id, reservation_id=reservation.id).all()
        new_rows = InventoryDay.query.filter_by(room_id=alternate_room.id, reservation_id=reservation.id).all()
        assert not old_rows
        assert len(new_rows) == 2


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
