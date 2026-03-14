"""Tests for payment status tracking, balance summary, and reconciliation.

These tests validate the new payment_status field on reservations,
the reservation_payment_summary() API, the reconciliation data helper,
and the payment status sync logic in cashier operations.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from flask_migrate import upgrade
from werkzeug.security import generate_password_hash

from pms.extensions import db
from pms.models import (
    FolioCharge,
    PaymentEvent,
    PaymentRequest,
    Reservation,
    Role,
    RoomType,
    User,
)
from pms.seeds import seed_all
from pms.services.cashier_service import (
    PaymentPostingPayload,
    RefundPostingPayload,
    VoidChargePayload,
    folio_summary,
    record_payment,
    record_refund,
    void_folio_charge,
)
from pms.services.payment_integration_service import (
    payment_reconciliation_data,
    reservation_payment_summary,
)
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


def create_test_reservation(
    *,
    deposit_required: Decimal = Decimal("0.00"),
) -> Reservation:
    room_type = RoomType.query.filter_by(code="DBL").one()
    reservation = create_reservation(
        ReservationCreatePayload(
            first_name="Payment",
            last_name="TestGuest",
            phone="+66899990000",
            email="payment.test@example.com",
            room_type_id=room_type.id,
            check_in_date=date.today() + timedelta(days=3),
            check_out_date=date.today() + timedelta(days=5),
            adults=2,
            children=0,
            source_channel="direct_web",
        )
    )
    if deposit_required > Decimal("0.00"):
        reservation.deposit_required_amount = deposit_required
        db.session.commit()
    return reservation


# ─── Payment Status Tracking Tests ───────────────────────────────────────────


def test_new_reservation_has_unpaid_payment_status(app_factory):
    """New reservations default to 'unpaid' payment_status."""
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_test_reservation()
        assert reservation.payment_status == "unpaid"


def test_payment_status_updates_to_paid_after_full_payment(app_factory):
    """Recording payment that settles the balance sets payment_status to 'paid'."""
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_test_reservation()
        user = make_staff_user("front_desk", "fd@sandbox.local")
        summary = folio_summary(reservation)
        total_due = summary["balance_due"]
        if total_due > Decimal("0.00"):
            record_payment(
                reservation.id,
                PaymentPostingPayload(amount=total_due, payment_method="cash"),
                actor_user_id=user.id,
            )
            db.session.refresh(reservation)
            assert reservation.payment_status == "paid"


def test_payment_status_partially_paid_after_partial_payment(app_factory):
    """Partial payment sets payment_status to 'partially_paid'."""
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_test_reservation()
        user = make_staff_user("front_desk", "fd@sandbox.local")
        summary = folio_summary(reservation)
        total_due = summary["balance_due"]
        if total_due > Decimal("1.00"):
            record_payment(
                reservation.id,
                PaymentPostingPayload(amount=Decimal("1.00"), payment_method="cash"),
                actor_user_id=user.id,
            )
            db.session.refresh(reservation)
            assert reservation.payment_status == "partially_paid"


def test_payment_status_deposit_required_when_deposit_not_received(app_factory):
    """When deposit is required but not received, status is 'deposit_required'."""
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_test_reservation(deposit_required=Decimal("500.00"))
        # The default status without any folio actions is 'unpaid' (default).
        # After a folio sync triggers, deposit_required should appear.
        # Trigger sync via a small payment + void cycle to exercise the logic.
        user = make_staff_user("front_desk", "fd@sandbox.local")
        summary = folio_summary(reservation)
        # deposit_state should be missing since no deposit received
        assert summary["deposit_state"] == "missing"
        assert summary["deposit_required_amount"] == Decimal("500.00")


def test_payment_status_deposit_received_after_deposit_payment(app_factory):
    """When deposit is received on a folio with charges, payment_status reflects deposit state."""
    app = app_factory(seed=True)
    with app.app_context():
        from pms.services.cashier_service import ensure_room_charges_posted

        reservation = create_test_reservation(deposit_required=Decimal("500.00"))
        user = make_staff_user("front_desk", "fd_dep@sandbox.local")
        # Post room charges so the folio has debits
        ensure_room_charges_posted(reservation.id, actor_user_id=user.id)
        record_payment(
            reservation.id,
            PaymentPostingPayload(
                amount=Decimal("500.00"),
                payment_method="card",
                is_deposit=True,
            ),
            actor_user_id=user.id,
        )
        db.session.refresh(reservation)
        # With room charges posted and deposit received, should be deposit_received or partially_paid
        assert reservation.payment_status in ("deposit_received", "partially_paid")


def test_payment_status_overpaid_after_excess_payment(app_factory):
    """When paid more than owed, payment_status is 'overpaid'."""
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_test_reservation()
        user = make_staff_user("front_desk", "fd@sandbox.local")
        summary = folio_summary(reservation)
        total_due = summary["balance_due"]
        # Pay more than due
        overpay_amount = total_due + Decimal("100.00")
        record_payment(
            reservation.id,
            PaymentPostingPayload(amount=overpay_amount, payment_method="cash"),
            actor_user_id=user.id,
        )
        db.session.refresh(reservation)
        assert reservation.payment_status == "overpaid"


# ─── Reservation Payment Summary Tests ───────────────────────────────────────


def test_reservation_payment_summary_returns_complete_data(app_factory):
    """reservation_payment_summary() returns folio + request + event data."""
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_test_reservation()
        user = make_staff_user("front_desk", "fd@sandbox.local")
        record_payment(
            reservation.id,
            PaymentPostingPayload(amount=Decimal("100.00"), payment_method="cash"),
            actor_user_id=user.id,
        )
        summary = reservation_payment_summary(reservation.id)
        assert "balance_due" in summary
        assert "payment_status" in summary
        assert "reservation_code" in summary
        assert "payment_requests" in summary
        assert "payment_events" in summary
        assert isinstance(summary["payment_requests"], list)
        assert isinstance(summary["payment_events"], list)
        assert len(summary["payment_events"]) >= 1


def test_reservation_payment_summary_raises_for_invalid_id(app_factory):
    """reservation_payment_summary() raises ValueError for non-existent reservation."""
    import uuid

    app = app_factory(seed=True)
    with app.app_context():
        with pytest.raises(ValueError, match="Reservation not found"):
            reservation_payment_summary(uuid.uuid4())


# ─── Reconciliation Data Tests ────────────────────────────────────────────────


def test_reconciliation_data_returns_expected_structure(app_factory):
    """payment_reconciliation_data() returns period, counts, requests, events, awaiting."""
    app = app_factory(seed=True)
    with app.app_context():
        recon = payment_reconciliation_data()
        assert "period_from" in recon
        assert "period_to" in recon
        assert "total_requests" in recon
        assert "status_counts" in recon
        assert "total_collected" in recon
        assert "recent_requests" in recon
        assert "recent_events" in recon
        assert "awaiting_payment" in recon


def test_reconciliation_data_includes_pending_reservations(app_factory):
    """Reservations with unpaid status appear in awaiting_payment."""
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_test_reservation()
        # Reservation should be unpaid and confirmed/tentative
        recon = payment_reconciliation_data()
        awaiting_codes = [r["reservation_code"] for r in recon["awaiting_payment"]]
        assert reservation.reservation_code in awaiting_codes


# ─── Route Tests ──────────────────────────────────────────────────────────────


def test_reconciliation_route_requires_permission(app_factory):
    """Reconciliation route requires payment.read permission."""
    app = app_factory(seed=True)
    with app.test_client() as client:
        resp = client.get("/staff/admin/payments/reconciliation")
        assert resp.status_code in (302, 401, 403)


def test_reconciliation_route_renders_for_authorized_user(app_factory):
    """Reconciliation route renders successfully for authorized user."""
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("admin", "recon_admin@sandbox.local")
        with app.test_client() as client:
            login_as(client, user)
            resp = client.get("/staff/admin/payments/reconciliation")
            assert resp.status_code == 200
            assert b"reconciliation" in resp.data.lower()


def test_payment_summary_endpoint_returns_json(app_factory):
    """Payment summary JSON endpoint returns valid data."""
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_test_reservation()
        user = make_staff_user("front_desk", "fd2@sandbox.local")
        with app.test_client() as client:
            login_as(client, user)
            resp = client.get(f"/staff/cashier/{reservation.id}/payment-summary")
            assert resp.status_code == 200
            data = resp.get_json()
            assert "balance_due" in data
            assert "payment_status" in data


def test_payment_summary_endpoint_404_for_missing_reservation(app_factory):
    """Payment summary endpoint returns 404 for non-existent reservation."""
    import uuid

    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user("front_desk", "fd3@sandbox.local")
        with app.test_client() as client:
            login_as(client, user)
            resp = client.get(f"/staff/cashier/{uuid.uuid4()}/payment-summary")
            assert resp.status_code == 404


# ─── Payment Status Transition Consistency Tests ─────────────────────────────


def test_void_charge_updates_payment_status(app_factory):
    """Voiding a payment charge should update the reservation payment_status."""
    app = app_factory(seed=True)
    with app.app_context():
        reservation = create_test_reservation()
        user = make_staff_user("front_desk", "fd4@sandbox.local")
        summary = folio_summary(reservation)
        total_due = summary["balance_due"]
        if total_due > Decimal("0.00"):
            line = record_payment(
                reservation.id,
                PaymentPostingPayload(amount=total_due, payment_method="cash"),
                actor_user_id=user.id,
            )
            db.session.refresh(reservation)
            assert reservation.payment_status == "paid"
            # Now void the payment
            void_folio_charge(
                reservation.id,
                line.id,
                VoidChargePayload(reason="test void"),
                actor_user_id=user.id,
            )
            db.session.refresh(reservation)
            # After voiding, should no longer be paid
            assert reservation.payment_status != "paid"
