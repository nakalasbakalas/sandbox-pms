from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from sqlalchemy import inspect as sa_inspect
from werkzeug.security import generate_password_hash

from pms.extensions import db
from pms.models import HousekeepingStatus, Reservation, Role, Room, RoomType, User
from pms.seeds import bootstrap_inventory_horizon
from pms.services.cashier_service import ManualAdjustmentPayload, ensure_room_charges_posted, post_manual_adjustment
from pms.services.front_desk_service import NoShowPayload, process_no_show
from pms.services.housekeeping_service import RoomStatusUpdatePayload, update_housekeeping_status
from pms.services.payment_integration_service import (
    create_or_reuse_deposit_request,
    process_payment_webhook,
    sign_test_hosted_webhook,
)
from pms.services.reporting_service import build_manager_dashboard
from pms.services.reservation_service import ReservationCreatePayload, create_reservation
from pms.services.staff_reservations_service import cancel_reservation_workspace


def utc_dt(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour=hour, minute=minute), tzinfo=timezone.utc)


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
    for row in reservation_inventory_rows(reservation):
        row.availability_status = "occupied"
        row.housekeeping_status_id = occupied_clean.id
    db.session.commit()
    return reservation


def reservation_inventory_rows(reservation: Reservation):
    from pms.models import InventoryDay

    return InventoryDay.query.filter_by(reservation_id=reservation.id).all()


def pay_deposit_request(reservation: Reservation) -> None:
    request_row = create_or_reuse_deposit_request(
        reservation.id,
        actor_user_id=None,
        send_email=False,
        language="en",
        source="test",
    )
    payload = json.dumps(
        {
            "event_id": f"evt-paid-{request_row.request_code}",
            "payment_request_code": request_row.request_code,
            "payment_request_id": str(request_row.id),
            "status": "paid",
            "provider_reference": request_row.provider_reference,
            "provider_payment_reference": f"pi-{request_row.request_code}",
            "amount": str(request_row.amount),
            "currency_code": "THB",
        }
    ).encode("utf-8")
    process_payment_webhook(
        "test_hosted",
        payload,
        {"X-Test-Hosted-Signature": sign_test_hosted_webhook(payload)},
    )
    db.session.expire_all()


def set_deposit_required(reservation: Reservation, amount: str) -> Reservation:
    reservation.deposit_required_amount = Decimal(amount)
    db.session.commit()
    return reservation


def ensure_inventory_date(business_date: date) -> None:
    bootstrap_inventory_horizon(business_date, 1)
    db.session.commit()


def build_reporting_dataset() -> dict:
    today = date.today()
    manager = make_staff_user("manager", "manager-reports@example.com")
    housekeeper = make_staff_user("housekeeping", "housekeeper-reports@example.com")
    ensure_inventory_date(today - timedelta(days=1))

    arrival_today = set_deposit_required(
        mark_confirmed(
        create_staff_reservation(
            first_name="Arrival",
            last_name="Today",
            phone="+66830000001",
            room_type_code="TWN",
            check_in_date=today,
            check_out_date=today + timedelta(days=2),
            source_channel="google_business",
        )
        ),
        "500.00",
    )
    create_or_reuse_deposit_request(arrival_today.id, actor_user_id=manager.id, send_email=False, language="en", source="report-test")

    pending_future = create_staff_reservation(
        first_name="Pending",
        last_name="Future",
        phone="+66830000002",
        room_type_code="DBL",
        check_in_date=today + timedelta(days=2),
        check_out_date=today + timedelta(days=4),
        source_channel="facebook",
    )
    pending_future.booked_at = datetime.now(timezone.utc) - timedelta(days=3)
    db.session.commit()

    confirmed_paid = set_deposit_required(
        create_staff_reservation(
        first_name="Deposit",
        last_name="Paid",
        phone="+66830000003",
        room_type_code="DBL",
        check_in_date=today + timedelta(days=3),
        check_out_date=today + timedelta(days=5),
        source_channel="direct_web",
        ),
        "600.00",
    )
    pay_deposit_request(confirmed_paid)

    in_house = mark_checked_in(
        create_staff_reservation(
            first_name="Inside",
            last_name="Guest",
            phone="+66830000004",
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
            amount=Decimal("150.00"),
            description="Minibar",
            note="Water and snacks",
        ),
        actor_user_id=manager.id,
    )
    post_manual_adjustment(
        in_house.id,
        ManualAdjustmentPayload(
            charge_type="manual_discount",
            amount=Decimal("50.00"),
            description="Goodwill",
            note="Minor service recovery",
        ),
        actor_user_id=manager.id,
    )

    departure_due = mark_checked_in(
        create_staff_reservation(
            first_name="Departure",
            last_name="Due",
            phone="+66830000005",
            room_type_code="DBL",
            check_in_date=today - timedelta(days=1),
            check_out_date=today,
            source_channel="walk_in",
        )
    )

    cancel_target = mark_confirmed(
        create_staff_reservation(
            first_name="Cancel",
            last_name="Guest",
            phone="+66830000006",
            room_type_code="TWN",
            check_in_date=today + timedelta(days=4),
            check_out_date=today + timedelta(days=6),
            source_channel="line",
        )
    )
    cancel_reservation_workspace(cancel_target.id, actor_user_id=manager.id, reason="guest_request")

    no_show_target = mark_confirmed(
        create_staff_reservation(
            first_name="NoShow",
            last_name="Guest",
            phone="+66830000007",
            room_type_code="DBL",
            check_in_date=today,
            check_out_date=today + timedelta(days=1),
            source_channel="whatsapp",
        )
    )
    process_no_show(no_show_target.id, NoShowPayload(reason="cutoff passed"), actor_user_id=manager.id)

    reserved_room_ids = {
        arrival_today.assigned_room_id,
        pending_future.assigned_room_id,
        confirmed_paid.assigned_room_id,
        in_house.assigned_room_id,
        departure_due.assigned_room_id,
        cancel_target.assigned_room_id,
        no_show_target.assigned_room_id,
    }
    free_rooms = (
        Room.query.filter(Room.is_active.is_(True), Room.is_sellable.is_(True), Room.id.notin_(reserved_room_ids))
        .order_by(Room.room_number.asc())
        .limit(4)
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
        payload=RoomStatusUpdatePayload(status_code="inspected"),
        actor_user_id=manager.id,
    )
    update_housekeeping_status(
        free_rooms[3].id,
        business_date=today,
        payload=RoomStatusUpdatePayload(status_code="out_of_order", note="AC repair"),
        actor_user_id=manager.id,
    )

    return {
        "today": today,
        "manager": manager,
        "housekeeper": housekeeper,
        "arrival_today": arrival_today,
        "pending_future": pending_future,
        "confirmed_paid": db.session.get(Reservation, confirmed_paid.id),
        "in_house": db.session.get(Reservation, in_house.id),
        "departure_due": departure_due,
        "cancel_target": db.session.get(Reservation, cancel_target.id),
        "no_show_target": db.session.get(Reservation, no_show_target.id),
    }


def test_dashboard_operational_reports_return_expected_reservations(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        dataset = build_reporting_dataset()
        dashboard = build_manager_dashboard(
            business_date=dataset["today"],
            date_from=dataset["today"],
            date_to=dataset["today"] + timedelta(days=6),
        )

        assert dashboard["arrivals"]["count"] == 1
        assert dashboard["arrivals"]["items"][0]["reservation_code"] == dataset["arrival_today"].reservation_code
        assert dashboard["departures"]["count"] == 1
        assert dashboard["departures"]["items"][0]["reservation_code"] == dataset["departure_due"].reservation_code
        assert dashboard["pending_reservations"]["count"] == 1
        assert dashboard["pending_reservations"]["items"][0]["reservation_code"] == dataset["pending_future"].reservation_code
        assert dashboard["confirmed_reservations"]["count"] == 2
        assert {item["reservation_code"] for item in dashboard["confirmed_reservations"]["items"]} == {
            dataset["arrival_today"].reservation_code,
            dataset["confirmed_paid"].reservation_code,
        }
        assert dashboard["checked_in_guests"]["count"] == 1
        assert dashboard["checked_in_guests"]["items"][0]["reservation_code"] == dataset["in_house"].reservation_code


def test_occupancy_reports_are_authoritative_and_exclude_tentative_sold_nights(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        dataset = build_reporting_dataset()
        dashboard = build_manager_dashboard(
            business_date=dataset["today"],
            date_from=dataset["today"],
            date_to=dataset["today"] + timedelta(days=6),
        )

        assert dashboard["occupancy_today"]["saleable_rooms"] == 29
        assert dashboard["occupancy_today"]["occupied_rooms"] == 2
        assert dashboard["occupancy_today"]["occupancy_percentage"] == Decimal("6.90")
        by_date = {item["date"]: item for item in dashboard["occupancy_range"]["items"]}
        assert by_date[dataset["today"] + timedelta(days=2)]["occupied_rooms"] == 0
        assert by_date[dataset["today"] + timedelta(days=3)]["occupied_rooms"] == 1


def test_housekeeping_and_folio_reports_reflect_operational_truth(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        dataset = build_reporting_dataset()
        dashboard = build_manager_dashboard(
            business_date=dataset["today"],
            date_from=dataset["today"],
            date_to=dataset["today"] + timedelta(days=6),
        )

        assert dashboard["housekeeping"]["counts"]["dirty"] >= 1
        assert dashboard["housekeeping"]["counts"]["clean"] >= 1
        assert dashboard["housekeeping"]["counts"]["inspected"] >= 1
        assert dashboard["housekeeping"]["counts"]["out_of_order"] >= 1
        assert dashboard["folio_balances"]["count"] >= 1
        assert dashboard["folio_balances"]["total_balance_due"] > Decimal("0.00")
        assert dataset["in_house"].reservation_code in {item["reservation_code"] for item in dashboard["folio_balances"]["items"]}


def test_deposit_pipeline_and_revenue_summary_use_authoritative_financial_data(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        dataset = build_reporting_dataset()
        dashboard = build_manager_dashboard(
            business_date=dataset["today"],
            date_from=dataset["today"],
            date_to=dataset["today"] + timedelta(days=6),
        )

        assert dashboard["deposit_pipeline"]["reservation_count"] == 2
        assert dashboard["deposit_pipeline"]["pending_count"] == 1
        assert dashboard["deposit_pipeline"]["total_requested_amount"] > Decimal("0.00")
        assert dashboard["deposit_pipeline"]["total_paid_amount"] > Decimal("0.00")
        assert dashboard["revenue_summary"]["room_revenue_total"] > Decimal("0.00")
        assert dashboard["revenue_summary"]["manual_charge_total"] == Decimal("150.00")
        assert dashboard["revenue_summary"]["discount_total"] == Decimal("50.00")
        assert dashboard["revenue_summary"]["net_revenue_total"] > Decimal("0.00")


def test_room_type_performance_and_exception_summaries_are_correct(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        dataset = build_reporting_dataset()
        dashboard = build_manager_dashboard(
            business_date=dataset["today"],
            date_from=dataset["today"],
            date_to=dataset["today"] + timedelta(days=6),
        )

        by_type = {item["room_type_code"]: item for item in dashboard["room_type_performance"]["items"]}
        assert by_type["TWN"]["reservation_count"] == 2
        assert by_type["DBL"]["reservation_count"] == 1
        assert by_type["TWN"]["sold_nights"] == 3
        assert by_type["DBL"]["sold_nights"] == 2
        assert dashboard["cancellation_summary"]["count"] == 1
        assert dashboard["cancellation_summary"]["items"][0]["reservation_code"] == dataset["cancel_target"].reservation_code
        assert dashboard["no_show_summary"]["count"] == 1
        assert dashboard["no_show_summary"]["items"][0]["reservation_code"] == dataset["no_show_target"].reservation_code


def test_audit_activity_summary_includes_recent_operational_changes(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        dataset = build_reporting_dataset()
        dashboard = build_manager_dashboard(
            business_date=dataset["today"],
            date_from=dataset["today"],
            date_to=dataset["today"] + timedelta(days=6),
        )

        assert dashboard["audit_activity"]["count"] > 0
        assert dashboard["audit_activity"]["reservation_changes_count"] > 0
        assert dashboard["audit_activity"]["cashier_payment_changes_count"] > 0
        assert dashboard["audit_activity"]["top_actions"]
        assert dashboard["audit_activity"]["recent_entries"]


def test_reports_route_renders_for_manager_and_blocks_unauthorized_user(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    client = app.test_client()
    with app.app_context():
        dataset = build_reporting_dataset()

    login_as(client, dataset["manager"])
    response = client.get("/staff/reports?preset=next_7_days")
    assert response.status_code == 200
    assert b"Operational reporting" in response.data
    assert dataset["arrival_today"].reservation_code.encode("utf-8") in response.data
    assert b"Occupancy" in response.data

    login_as(client, dataset["housekeeper"])
    forbidden = client.get("/staff/reports")
    assert forbidden.status_code == 403


def test_custom_date_range_filters_consistently_change_report_counts(app_factory):
    app = app_factory(seed=True, config={"PAYMENT_PROVIDER": "test_hosted", "PAYMENT_BASE_URL": "https://hosted.test"})
    with app.app_context():
        dataset = build_reporting_dataset()
        dashboard = build_manager_dashboard(
            business_date=dataset["today"],
            date_from=dataset["today"],
            date_to=dataset["today"],
        )

        assert dashboard["pending_reservations"]["count"] == 0
        assert dashboard["confirmed_reservations"]["count"] == 1
        assert dashboard["arrivals"]["count"] == 1
        assert dashboard["deposit_pipeline"]["reservation_count"] == 1
