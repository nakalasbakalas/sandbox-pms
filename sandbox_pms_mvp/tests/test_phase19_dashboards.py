"""Tests for the front-desk daily dashboard and daily operational reports.

These tests validate:
- Front-desk dashboard metrics (arrivals, departures, in-house, room status,
  urgent tasks, balances due)
- Daily report routing and rendering
- Permission gating on dashboards and reports
- Metric accuracy using the same reporting dataset as test_phase12_reporting
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import inspect as sa_inspect
from werkzeug.security import generate_password_hash

from pms.extensions import db
from pms.models import (
    HousekeepingStatus,
    HousekeepingTask,
    Reservation,
    Role,
    Room,
    RoomType,
    User,
)
from pms.seeds import bootstrap_inventory_horizon
from pms.services.cashier_service import ManualAdjustmentPayload, ensure_room_charges_posted, post_manual_adjustment
from pms.services.front_desk_service import NoShowPayload, process_no_show
from pms.services.housekeeping_service import RoomStatusUpdatePayload, update_housekeeping_status
from pms.services.payment_integration_service import create_or_reuse_deposit_request
from pms.services.reporting_service import build_daily_report, build_front_desk_dashboard, build_manager_dashboard
from pms.services.reservation_service import ReservationCreatePayload, create_reservation
from pms.services.staff_reservations_service import cancel_reservation_workspace


def utc_dt(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(day, datetime.min.time().replace(hour=hour, minute=minute), tzinfo=timezone.utc)


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
    identity = sa_inspect(user).identity
    user_id = identity[0] if identity else user.id
    with client.session_transaction() as session:
        session["staff_user_id"] = str(user_id)
        session["_csrf_token"] = "test-csrf-token"


def create_staff_reservation(
    *,
    first_name: str,
    last_name: str,
    phone: str,
    room_type_code: str,
    check_in_date: date,
    check_out_date: date,
    source_channel: str = "admin_manual",
) -> Reservation:
    room_type = RoomType.query.filter_by(code=room_type_code).one()
    return create_reservation(
        ReservationCreatePayload(
            first_name=first_name,
            last_name=last_name,
            phone=phone,
            email=f"{first_name.lower()}@example.com",
            room_type_id=room_type.id,
            check_in_date=check_in_date,
            check_out_date=check_out_date,
            adults=2,
            children=0,
            source_channel=source_channel,
        )
    )


def mark_confirmed(reservation: Reservation) -> Reservation:
    reservation.current_status = "confirmed"
    db.session.commit()
    return reservation


def mark_checked_in(reservation: Reservation) -> Reservation:
    reservation.current_status = "checked_in"
    reservation.checked_in_at = utc_dt(reservation.check_in_date, 14)
    occupied_clean = HousekeepingStatus.query.filter_by(code="occupied_clean").one()
    from pms.models import InventoryDay
    for row in InventoryDay.query.filter_by(reservation_id=reservation.id).all():
        row.availability_status = "occupied"
        row.housekeeping_status_id = occupied_clean.id
    db.session.commit()
    return reservation


def ensure_inventory_date(business_date: date) -> None:
    bootstrap_inventory_horizon(business_date, 1)
    db.session.commit()


def build_dashboard_dataset() -> dict:
    """Build a minimal dataset to validate front-desk dashboard metrics."""
    today = date.today()
    manager = make_staff_user("manager", "mgr-dash@example.com")
    front_desk = make_staff_user("front_desk", "fd-dash@example.com")
    housekeeper = make_staff_user("housekeeping", "hk-dash@example.com")

    ensure_inventory_date(today - timedelta(days=1))

    arrival_today = mark_confirmed(
        create_staff_reservation(
            first_name="ArrivalDash",
            last_name="Today",
            phone="+66830010001",
            room_type_code="TWN",
            check_in_date=today,
            check_out_date=today + timedelta(days=2),
            source_channel="google_business",
        )
    )
    arrival_today.deposit_required_amount = Decimal("500.00")
    db.session.commit()

    in_house = mark_checked_in(
        create_staff_reservation(
            first_name="InHouseDash",
            last_name="Guest",
            phone="+66830010002",
            room_type_code="TWN",
            check_in_date=today,
            check_out_date=today + timedelta(days=1),
            source_channel="admin_manual",
        )
    )
    ensure_room_charges_posted(in_house.id, through_date=in_house.check_out_date, actor_user_id=manager.id)
    post_manual_adjustment(
        in_house.id,
        ManualAdjustmentPayload(
            charge_type="manual_charge",
            amount=Decimal("100.00"),
            description="Minibar",
            note="Test charge",
        ),
        actor_user_id=manager.id,
    )

    departure_due = mark_checked_in(
        create_staff_reservation(
            first_name="DepartDash",
            last_name="Due",
            phone="+66830010003",
            room_type_code="DBL",
            check_in_date=today - timedelta(days=1),
            check_out_date=today,
            source_channel="walk_in",
        )
    )

    # Set room statuses for housekeeping metrics
    reserved_room_ids = {
        arrival_today.assigned_room_id,
        in_house.assigned_room_id,
        departure_due.assigned_room_id,
    }
    free_rooms = (
        Room.query.filter(Room.is_active.is_(True), Room.is_sellable.is_(True), Room.id.notin_(reserved_room_ids))
        .order_by(Room.room_number.asc())
        .limit(3)
        .all()
    )
    update_housekeeping_status(
        free_rooms[0].id,
        business_date=today,
        payload=RoomStatusUpdatePayload(status_code="dirty", note="Turn first"),
        actor_user_id=manager.id,
    )
    update_housekeeping_status(
        free_rooms[1].id,
        business_date=today,
        payload=RoomStatusUpdatePayload(status_code="clean"),
        actor_user_id=manager.id,
    )
    update_housekeeping_status(
        free_rooms[2].id,
        business_date=today,
        payload=RoomStatusUpdatePayload(status_code="out_of_order", note="AC repair"),
        actor_user_id=manager.id,
    )

    # Create urgent housekeeping task
    task = HousekeepingTask(
        room_id=free_rooms[0].id,
        task_type="rush_clean",
        priority="urgent",
        status="open",
        business_date=today,
    )
    db.session.add(task)
    db.session.commit()

    return {
        "today": today,
        "manager": manager,
        "front_desk": front_desk,
        "housekeeper": housekeeper,
        "arrival_today": arrival_today,
        "in_house": db.session.get(Reservation, in_house.id),
        "departure_due": departure_due,
    }


# ── Service-level tests ──────────────────────────────────────────────────────


def test_front_desk_dashboard_returns_arrivals_departures_in_house(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        dataset = build_dashboard_dataset()
        dashboard = build_front_desk_dashboard(
            business_date=dataset["today"],
        )

        assert dashboard["arrivals"]["count"] >= 1
        assert dataset["arrival_today"].reservation_code in {item["reservation_code"] for item in dashboard["arrivals"]["items"]}
        assert dashboard["departures"]["count"] >= 1
        assert dataset["departure_due"].reservation_code in {item["reservation_code"] for item in dashboard["departures"]["items"]}
        assert dashboard["in_house"]["count"] >= 1
        assert dataset["in_house"].reservation_code in {item["reservation_code"] for item in dashboard["in_house"]["items"]}


def test_front_desk_dashboard_includes_room_status_and_urgent_tasks(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        dataset = build_dashboard_dataset()
        dashboard = build_front_desk_dashboard(
            business_date=dataset["today"],
            include_housekeeping=True,
        )

        assert "housekeeping" in dashboard
        assert dashboard["housekeeping"]["counts"]["dirty"] >= 1
        assert dashboard["housekeeping"]["counts"]["out_of_order"] >= 1
        assert "urgent_tasks" in dashboard
        assert dashboard["urgent_tasks"]["count"] >= 1
        assert dashboard["urgent_tasks"]["items"][0]["priority"] == "urgent"


def test_front_desk_dashboard_includes_balances_due(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        dataset = build_dashboard_dataset()
        dashboard = build_front_desk_dashboard(
            business_date=dataset["today"],
            include_financials=True,
        )

        assert "balances_due" in dashboard
        assert dashboard["balances_due"]["count"] >= 1
        assert dashboard["balances_due"]["total_balance_due"] > Decimal("0.00")


def test_front_desk_dashboard_headline_has_expected_cards(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        dataset = build_dashboard_dataset()
        dashboard = build_front_desk_dashboard(
            business_date=dataset["today"],
            include_housekeeping=True,
            include_financials=True,
        )

        labels = {card["label"] for card in dashboard["headline"]}
        assert "Arrivals" in labels
        assert "Departures" in labels
        assert "In-house" in labels
        assert "Occupancy" in labels
        assert "Rooms ready" in labels
        assert "Rooms dirty" in labels
        assert "Balance due" in labels
        assert "Urgent tasks" in labels


def test_front_desk_dashboard_excludes_housekeeping_when_not_permitted(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        dataset = build_dashboard_dataset()
        dashboard = build_front_desk_dashboard(
            business_date=dataset["today"],
            include_housekeeping=False,
            include_financials=False,
        )

        assert "housekeeping" not in dashboard
        assert "urgent_tasks" not in dashboard
        assert "balances_due" not in dashboard
        labels = {card["label"] for card in dashboard["headline"]}
        assert "Rooms ready" not in labels
        assert "Balance due" not in labels


# ── Daily report service-level tests ─────────────────────────────────────────


def test_daily_report_arrivals_returns_correct_data(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        dataset = build_dashboard_dataset()
        report = build_daily_report(
            report_type="arrivals",
            business_date=dataset["today"],
            date_from=dataset["today"],
            date_to=dataset["today"],
        )

        assert report["report_type"] == "arrivals"
        assert report["data"]["count"] >= 1
        assert dataset["arrival_today"].reservation_code in {item["reservation_code"] for item in report["data"]["items"]}


def test_daily_report_room_status_returns_housekeeping_data(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        dataset = build_dashboard_dataset()
        report = build_daily_report(
            report_type="room_status",
            business_date=dataset["today"],
            date_from=dataset["today"],
            date_to=dataset["today"],
        )

        assert report["report_type"] == "room_status"
        assert report["data"]["counts"]["dirty"] >= 1


def test_daily_report_no_show_cancellation_returns_both_sections(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        dataset = build_dashboard_dataset()
        # Add a cancellation and no-show for this test
        cancel_target = mark_confirmed(
            create_staff_reservation(
                first_name="CancelDash",
                last_name="Guest",
                phone="+66830010010",
                room_type_code="TWN",
                check_in_date=dataset["today"] + timedelta(days=4),
                check_out_date=dataset["today"] + timedelta(days=6),
                source_channel="line",
            )
        )
        cancel_reservation_workspace(cancel_target.id, actor_user_id=dataset["manager"].id, reason="guest_request")

        no_show_target = mark_confirmed(
            create_staff_reservation(
                first_name="NoShowDash",
                last_name="Guest",
                phone="+66830010011",
                room_type_code="DBL",
                check_in_date=dataset["today"],
                check_out_date=dataset["today"] + timedelta(days=1),
                source_channel="whatsapp",
            )
        )
        process_no_show(no_show_target.id, NoShowPayload(reason="cutoff passed"), actor_user_id=dataset["manager"].id)

        report = build_daily_report(
            report_type="no_show_cancellation",
            business_date=dataset["today"],
            date_from=dataset["today"],
            date_to=dataset["today"] + timedelta(days=6),
        )

        assert "cancellations" in report["data"]
        assert "no_shows" in report["data"]
        assert report["data"]["cancellations"]["count"] >= 1
        assert report["data"]["no_shows"]["count"] >= 1


# ── Route-level tests ────────────────────────────────────────────────────────


def test_staff_dashboard_renders_for_front_desk_user(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    client = app.test_client()
    with app.app_context():
        dataset = build_dashboard_dataset()

    login_as(client, dataset["front_desk"])
    response = client.get("/staff")
    assert response.status_code == 200
    assert b"Front Desk Dashboard" in response.data
    assert b"Daily operations" in response.data
    assert b"Arrivals today" in response.data
    assert b"Departures today" in response.data


def test_staff_dashboard_renders_for_manager_with_all_sections(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    client = app.test_client()
    with app.app_context():
        dataset = build_dashboard_dataset()

    login_as(client, dataset["manager"])
    response = client.get("/staff")
    assert response.status_code == 200
    assert b"Front Desk Dashboard" in response.data
    assert b"Room status" in response.data
    assert b"Urgent tasks" in response.data
    assert b"Outstanding balances" in response.data


def test_manager_dashboard_includes_revenue_management_trends(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    client = app.test_client()
    with app.app_context():
        dataset = build_dashboard_dataset()
        ensure_room_charges_posted(
            dataset["in_house"].id,
            through_date=dataset["today"],
            actor_user_id=dataset["manager"].id,
        )
        future_reservation = mark_confirmed(
            create_staff_reservation(
                first_name="Forecast",
                last_name="Guest",
                phone="+66830019999",
                room_type_code="DBL",
                check_in_date=dataset["today"] + timedelta(days=1),
                check_out_date=dataset["today"] + timedelta(days=3),
                source_channel="booking_engine",
            )
        )
        dashboard = build_manager_dashboard(
            business_date=dataset["today"],
            date_from=dataset["today"],
            date_to=dataset["today"] + timedelta(days=2),
            include_housekeeping=False,
            include_payments=False,
            include_audit=False,
        )

        revenue = dashboard["revenue_management"]
        assert len(revenue["rows"]) == 3
        assert revenue["total_actual_room_revenue"] > Decimal("0.00")
        assert revenue["total_projected_room_revenue"] >= revenue["total_actual_room_revenue"]
        assert revenue["average_adr"] >= Decimal("0.00")
        assert revenue["average_revpar"] >= Decimal("0.00")
        assert any(row["pace_label"] in {"posted", "forecast"} for row in revenue["rows"])
        assert any(row["date"] == future_reservation.check_in_date for row in revenue["rows"])

    login_as(client, dataset["manager"])
    response = client.get("/staff/reports?preset=next_7_days")
    assert response.status_code == 200
    assert b"Revenue management" in response.data
    assert b"RevPAR" in response.data


def test_daily_report_routes_render_for_authorized_users(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    client = app.test_client()
    with app.app_context():
        dataset = build_dashboard_dataset()

    login_as(client, dataset["manager"])

    # Test each report type
    for report_type in ["arrivals", "departures", "room_status", "payment_due", "occupancy", "booking_source", "no_show_cancellation"]:
        response = client.get(f"/staff/daily-reports/{report_type}")
        assert response.status_code == 200, f"Report {report_type} failed with {response.status_code}"
        assert b"Daily Report" in response.data


def test_daily_report_unknown_type_returns_404(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    client = app.test_client()
    with app.app_context():
        dataset = build_dashboard_dataset()

    login_as(client, dataset["manager"])
    response = client.get("/staff/daily-reports/nonexistent")
    assert response.status_code == 404


def test_daily_report_blocks_unauthorized_user(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    client = app.test_client()
    with app.app_context():
        dataset = build_dashboard_dataset()

    login_as(client, dataset["housekeeper"])

    # Housekeeper should be able to access room_status (needs housekeeping.view)
    response = client.get("/staff/daily-reports/room_status")
    assert response.status_code == 200

    # Housekeeper should NOT be able to access payment_due (needs folio.view)
    response = client.get("/staff/daily-reports/payment_due")
    assert response.status_code == 403

    # Housekeeper should NOT be able to access occupancy (needs reports.view)
    response = client.get("/staff/daily-reports/occupancy")
    assert response.status_code == 403


def test_daily_report_arrivals_has_drill_through_links(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    client = app.test_client()
    with app.app_context():
        dataset = build_dashboard_dataset()

    login_as(client, dataset["manager"])
    response = client.get(f"/staff/daily-reports/arrivals?date={dataset['today'].isoformat()}")
    assert response.status_code == 200
    assert dataset["arrival_today"].reservation_code.encode("utf-8") in response.data
    assert b"staff/front-desk/" in response.data


def test_daily_report_supports_date_filtering(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    client = app.test_client()
    with app.app_context():
        dataset = build_dashboard_dataset()
        empty_date = max(item.check_in_date for item in Reservation.query.all()) + timedelta(days=30)

    login_as(client, dataset["manager"])

    response = client.get(f"/staff/daily-reports/arrivals?date={empty_date.isoformat()}")
    assert response.status_code == 200
    assert b"No arrivals for this date" in response.data
