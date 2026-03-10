from __future__ import annotations

import os
import threading
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
import sqlalchemy as sa
from flask_migrate import upgrade
from werkzeug.security import generate_password_hash

from pms.app import create_app
from pms.extensions import db
from pms.models import CashierActivityLog, CashierDocument, FolioCharge, Reservation, Role, RoomType, User
from pms.seeds import seed_all
from pms.services.cashier_service import (
    DocumentIssuePayload,
    ManualAdjustmentPayload,
    PaymentPostingPayload,
    RefundPostingPayload,
    VoidChargePayload,
    ensure_room_charges_posted,
    folio_summary,
    issue_cashier_document,
    post_manual_adjustment,
    record_payment,
    record_refund,
    void_folio_charge,
)
from pms.services.front_desk_service import CheckoutPayload, complete_checkout
from pms.services.reservation_service import ReservationCreatePayload, create_reservation


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = PROJECT_ROOT / "migrations"


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


def postgres_seeded_app():
    database_url = os.environ["TEST_DATABASE_URL"]
    app = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": database_url,
            "AUTO_BOOTSTRAP_SCHEMA": False,
            "AUTO_SEED_REFERENCE_DATA": False,
            "INVENTORY_BOOTSTRAP_DAYS": 30,
        }
    )
    with app.app_context():
        db.session.remove()
        with db.engine.begin() as connection:
            connection.execute(sa.text("DROP SCHEMA IF EXISTS public CASCADE"))
            connection.execute(sa.text("CREATE SCHEMA public"))
        upgrade(directory=str(MIGRATIONS_DIR))
        seed_all(app.config["INVENTORY_BOOTSTRAP_DAYS"])
    return app


def test_room_charge_auto_posting_creates_duplicate_safe_room_lines(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Room",
            last_name="Charge",
            phone="+66810000001",
            room_type_code="DBL",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=2),
        )
        actor = make_staff_user("front_desk", "cashier-room@example.com")

        created_first = ensure_room_charges_posted(
            reservation.id,
            through_date=reservation.check_out_date,
            actor_user_id=actor.id,
        )
        created_second = ensure_room_charges_posted(
            reservation.id,
            through_date=reservation.check_out_date,
            actor_user_id=actor.id,
        )

        assert len(created_first) == 2
        assert created_second == []
        assert FolioCharge.query.filter_by(reservation_id=reservation.id, charge_type="room").count() == 2


def test_manual_charge_discount_and_correction_lines_work(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Manual",
            last_name="Adjust",
            phone="+66810000002",
            room_type_code="TWN",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        front_desk = make_staff_user("front_desk", "cashier-adjust-fd@example.com")
        manager = make_staff_user("manager", "cashier-adjust-mgr@example.com")

        charge = post_manual_adjustment(
            reservation.id,
            ManualAdjustmentPayload(
                charge_type="manual_charge",
                amount=Decimal("150.00"),
                description="Laundry charge",
                note="Guest requested express service",
            ),
            actor_user_id=front_desk.id,
        )
        discount = post_manual_adjustment(
            reservation.id,
            ManualAdjustmentPayload(
                charge_type="manual_discount",
                amount=Decimal("50.00"),
                description="Service recovery discount",
                note="AC issue on first night",
            ),
            actor_user_id=manager.id,
        )
        correction = post_manual_adjustment(
            reservation.id,
            ManualAdjustmentPayload(
                charge_type="correction",
                amount=Decimal("1.00"),
                description="Reverse laundry charge",
                note="Laundry posted to wrong room",
                reference_charge_id=charge.id,
            ),
            actor_user_id=manager.id,
        )

        assert charge.charge_type == "manual_charge"
        assert discount.total_amount == Decimal("-50.00")
        assert discount.tax_amount < Decimal("0.00")
        assert correction.reversed_charge_id == charge.id
        assert correction.total_amount == Decimal("-150.00")


def test_folio_summary_and_deposit_handling_are_authoritative(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Summary",
            last_name="Guest",
            phone="+66810000003",
            room_type_code="DBL",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=2),
        )
        manager = make_staff_user("manager", "cashier-summary@example.com")
        ensure_room_charges_posted(reservation.id, through_date=reservation.check_out_date, actor_user_id=manager.id)
        post_manual_adjustment(
            reservation.id,
            ManualAdjustmentPayload(
                charge_type="manual_charge",
                amount=Decimal("107.00"),
                description="Minibar",
                note="Snacks and drinks",
            ),
            actor_user_id=manager.id,
        )
        post_manual_adjustment(
            reservation.id,
            ManualAdjustmentPayload(
                charge_type="manual_discount",
                amount=Decimal("53.50"),
                description="Goodwill discount",
                note="Noise complaint recovery",
            ),
            actor_user_id=manager.id,
        )
        record_payment(
            reservation.id,
            PaymentPostingPayload(
                amount=Decimal("300.00"),
                payment_method="cash",
                note="Deposit at check-in",
                is_deposit=True,
            ),
            actor_user_id=manager.id,
        )

        summary = folio_summary(reservation.id)

        assert summary["charges_subtotal"] > Decimal("0.00")
        assert summary["discounts_subtotal"] == Decimal("53.50")
        assert summary["deposit_received_amount"] == Decimal("300.00")
        assert summary["deposit_applied_amount"] > Decimal("0.00")
        assert summary["unused_deposit_amount"] >= Decimal("0.00")
        assert summary["settlement_state"] in {"partially_paid", "settled"}


def test_outstanding_balance_refund_and_void_preserve_auditability(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Refund",
            last_name="Guest",
            phone="+66810000004",
            room_type_code="TWN",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        manager = make_staff_user("manager", "cashier-refund@example.com")
        charge = post_manual_adjustment(
            reservation.id,
            ManualAdjustmentPayload(
                charge_type="manual_charge",
                amount=Decimal("500.00"),
                description="Room service",
                note="Dinner tray",
            ),
            actor_user_id=manager.id,
        )
        record_payment(
            reservation.id,
            PaymentPostingPayload(amount=Decimal("700.00"), payment_method="cash", note="Collected in advance"),
            actor_user_id=manager.id,
        )
        before_refund = folio_summary(reservation.id)
        refund = record_refund(
            reservation.id,
            RefundPostingPayload(amount=Decimal("200.00"), reason="Return overpayment"),
            actor_user_id=manager.id,
        )
        reversal = void_folio_charge(
            reservation.id,
            charge.id,
            VoidChargePayload(reason="Posted to wrong room"),
            actor_user_id=manager.id,
        )
        after_void = folio_summary(reservation.id)

        refreshed_charge = db.session.get(FolioCharge, charge.id)
        assert before_refund["refund_due"] == Decimal("200.00")
        assert refund is not None and refund.charge_type == "refund"
        assert refreshed_charge.voided_at is not None
        assert reversal.is_reversal is True
        assert reversal.reversed_charge_id == charge.id
        assert after_void["refund_due"] >= Decimal("0.00")
        assert CashierActivityLog.query.filter_by(reservation_id=reservation.id, event_type="cashier.line_voided").count() == 1


def test_issue_document_numbers_are_unique_and_stable(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        actor = make_staff_user("manager", "cashier-docs@example.com")
        first = create_staff_reservation(
            first_name="Invoice",
            last_name="One",
            phone="+66810000005",
            room_type_code="DBL",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        second = create_staff_reservation(
            first_name="Invoice",
            last_name="Two",
            phone="+66810000006",
            room_type_code="DBL",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        ensure_room_charges_posted(first.id, through_date=first.check_out_date, actor_user_id=actor.id)
        ensure_room_charges_posted(second.id, through_date=second.check_out_date, actor_user_id=actor.id)

        invoice_one = issue_cashier_document(first.id, DocumentIssuePayload(document_type="invoice"), actor_user_id=actor.id)
        invoice_two = issue_cashier_document(second.id, DocumentIssuePayload(document_type="invoice"), actor_user_id=actor.id)
        receipt = issue_cashier_document(first.id, DocumentIssuePayload(document_type="receipt"), actor_user_id=actor.id)
        invoice_repeat = issue_cashier_document(first.id, DocumentIssuePayload(document_type="invoice"), actor_user_id=actor.id)

        assert invoice_one.document_number.startswith("INV-")
        assert invoice_two.document_number.startswith("INV-")
        assert invoice_one.document_number != invoice_two.document_number
        assert receipt.document_number.startswith("RCT-")
        assert invoice_repeat.id == invoice_one.id
        assert CashierDocument.query.count() == 3


def test_settlement_states_derive_correctly(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        actor = make_staff_user("manager", "cashier-state@example.com")
        reservation = create_staff_reservation(
            first_name="State",
            last_name="Guest",
            phone="+66810000007",
            room_type_code="TWN",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        assert folio_summary(reservation.id)["settlement_state"] == "settled"
        ensure_room_charges_posted(reservation.id, through_date=reservation.check_out_date, actor_user_id=actor.id)
        assert folio_summary(reservation.id)["settlement_state"] == "unpaid"
        record_payment(
            reservation.id,
            PaymentPostingPayload(amount=Decimal("200.00"), payment_method="cash", note="Partial payment"),
            actor_user_id=actor.id,
        )
        assert folio_summary(reservation.id)["settlement_state"] == "partially_paid"
        remaining = folio_summary(reservation.id)["balance_due"]
        record_payment(
            reservation.id,
            PaymentPostingPayload(amount=remaining + Decimal("100.00"), payment_method="cash", note="Overpayment"),
            actor_user_id=actor.id,
        )
        assert folio_summary(reservation.id)["settlement_state"] == "overpaid"
        record_refund(
            reservation.id,
            RefundPostingPayload(amount=Decimal("100.00"), reason="Return overpayment"),
            actor_user_id=actor.id,
        )
        assert folio_summary(reservation.id)["settlement_state"] == "settled"


def test_checkout_linked_settlement_uses_cashier_lines(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Checkout",
            last_name="Cashier",
            phone="+66810000008",
            room_type_code="DBL",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        actor = make_staff_user("front_desk", "cashier-checkout@example.com")
        reservation.current_status = "checked_in"
        reservation.checked_in_at = db.func.now()
        db.session.commit()

        checked_out = complete_checkout(
            reservation.id,
            CheckoutPayload(
                collect_payment_amount=Decimal(str(reservation.quoted_grand_total)),
            ),
            actor_user_id=actor.id,
        )
        summary = folio_summary(reservation.id)

        assert checked_out.current_status == "checked_out"
        assert summary["settlement_state"] == "settled"
        assert FolioCharge.query.filter_by(reservation_id=reservation.id, charge_type="room").count() >= 1
        assert FolioCharge.query.filter_by(reservation_id=reservation.id, charge_type="payment").count() >= 1


def test_cashier_routes_render_and_store_internal_notes(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Route",
            last_name="Cashier",
            phone="+66810000009",
            room_type_code="TWN",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        user = make_staff_user("manager", "cashier-route@example.com")
    login_as(client, user)

    detail_response = client.get(f"/staff/cashier/{reservation.id}")
    adjustment_response = post_form(
        client,
        f"/staff/cashier/{reservation.id}/adjustments",
        data={
            "charge_type": "manual_discount",
            "amount": "25.00",
            "description": "Goodwill",
            "note": "Late room handover",
            "back_url": f"/staff/cashier/{reservation.id}",
        },
        follow_redirects=True,
    )

    assert detail_response.status_code == 200
    assert "Cashier" in detail_response.get_data(as_text=True)
    assert adjustment_response.status_code == 200
    assert "Late room handover" in adjustment_response.get_data(as_text=True)


def test_unauthorized_user_cannot_void_restricted_folio_lines(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Void",
            last_name="Blocked",
            phone="+66810000010",
            room_type_code="TWN",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        manager = make_staff_user("manager", "cashier-void-manager@example.com")
        front_desk = make_staff_user("front_desk", "cashier-void-fd@example.com")
        charge = post_manual_adjustment(
            reservation.id,
            ManualAdjustmentPayload(
                charge_type="manual_charge",
                amount=Decimal("120.00"),
                description="Minibar",
                note="Water and soda",
            ),
            actor_user_id=manager.id,
        )
    login_as(client, front_desk)

    response = post_form(
        client,
        f"/staff/cashier/{reservation.id}/lines/{charge.id}/void",
        data={"reason": "Trying to void", "back_url": f"/staff/cashier/{reservation.id}"},
    )

    assert response.status_code == 403


def test_printable_folio_and_document_issue_routes_work(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        reservation = create_staff_reservation(
            first_name="Print",
            last_name="Guest",
            phone="+66810000011",
            room_type_code="DBL",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        user = make_staff_user("manager", "cashier-print@example.com")
        ensure_room_charges_posted(reservation.id, through_date=reservation.check_out_date, actor_user_id=user.id)
    login_as(client, user)

    issue_response = post_form(
        client,
        f"/staff/cashier/{reservation.id}/documents",
        data={"document_type": "invoice", "note": "Guest copy", "back_url": f"/staff/cashier/{reservation.id}"},
        follow_redirects=False,
    )
    print_response = client.get(f"/staff/cashier/{reservation.id}/print?document_type=invoice")

    assert issue_response.status_code == 302
    assert print_response.status_code == 200
    text = print_response.get_data(as_text=True)
    assert reservation.reservation_code in text
    assert "Invoice" in text


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is not configured for Postgres cashier testing")
def test_postgres_concurrent_invoice_issuance_produces_unique_numbers():
    app = postgres_seeded_app()
    with app.app_context():
        actor = make_staff_user("manager", "cashier-postgres@example.com")
        first = create_staff_reservation(
            first_name="Pg",
            last_name="One",
            phone="+66810000012",
            room_type_code="DBL",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        second = create_staff_reservation(
            first_name="Pg",
            last_name="Two",
            phone="+66810000013",
            room_type_code="DBL",
            check_in_date=date.today(),
            check_out_date=date.today() + timedelta(days=1),
        )
        ensure_room_charges_posted(first.id, through_date=first.check_out_date, actor_user_id=actor.id)
        ensure_room_charges_posted(second.id, through_date=second.check_out_date, actor_user_id=actor.id)
        actor_id = actor.id
        first_id = first.id
        second_id = second.id

    results: list[str] = []
    errors: list[str] = []

    def worker(reservation_id):
        worker_app = create_app(
            {
                "TESTING": True,
                "SQLALCHEMY_DATABASE_URI": os.environ["TEST_DATABASE_URL"],
                "AUTO_BOOTSTRAP_SCHEMA": False,
                "AUTO_SEED_REFERENCE_DATA": False,
                "INVENTORY_BOOTSTRAP_DAYS": 30,
            }
        )
        with worker_app.app_context():
            try:
                document = issue_cashier_document(
                    reservation_id,
                    DocumentIssuePayload(document_type="invoice"),
                    actor_user_id=actor_id,
                )
                results.append(document.document_number)
            except Exception as exc:  # noqa: BLE001
                errors.append(str(exc))

    first_thread = threading.Thread(target=worker, args=(first_id,))
    second_thread = threading.Thread(target=worker, args=(second_id,))
    first_thread.start()
    second_thread.start()
    first_thread.join()
    second_thread.join()

    assert not errors
    assert len(results) == 2
    assert len(set(results)) == 2
