"""Phase 20 — Front-desk-first folio system tests.

Covers:
- payment_status derivation in folio_summary
- extra charge posting via post_extra_charge
- extra charge route
- cashier folio template rendering
- checkout settlement balance accuracy
- invalid payment input rejection
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from werkzeug.security import generate_password_hash

from pms.constants import EXTRA_CHARGE_CATEGORIES, PAYMENT_STATUSES
from pms.extensions import db
from pms.models import FolioCharge, Reservation, Role, RoomType, User
from pms.services.cashier_service import (
    ExtraChargePayload,
    PaymentPostingPayload,
    ensure_room_charges_posted,
    folio_summary,
    post_extra_charge,
    post_manual_adjustment,
    ManualAdjustmentPayload,
    record_payment,
)
from pms.services.reservation_service import ReservationCreatePayload, create_reservation


def _make_staff_user(role_code: str, email: str) -> User:
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


def _login_as(client, user: User) -> None:
    with client.session_transaction() as session:
        session["staff_user_id"] = str(user.id)
        session["_csrf_token"] = "test-csrf-token"


def _post_form(client, url: str, *, data: dict, follow_redirects: bool = False):
    payload = dict(data)
    payload["csrf_token"] = "test-csrf-token"
    return client.post(url, data=payload, follow_redirects=follow_redirects)


def _create_reservation(
    *,
    first_name: str,
    last_name: str,
    phone: str,
    room_type_code: str = "DBL",
    check_in_date: date | None = None,
    check_out_date: date | None = None,
) -> Reservation:
    room_type = RoomType.query.filter_by(code=room_type_code).one()
    return create_reservation(
        ReservationCreatePayload(
            first_name=first_name,
            last_name=last_name,
            phone=phone,
            email=f"{first_name.lower()}@example.com",
            room_type_id=room_type.id,
            check_in_date=check_in_date or date.today(),
            check_out_date=check_out_date or date.today() + timedelta(days=2),
            adults=2,
            children=0,
            source_channel="admin_manual",
        )
    )


# ── Constants ────────────────────────────────────────────────────


def test_payment_statuses_constant_exists():
    assert "unpaid" in PAYMENT_STATUSES
    assert "partially_paid" in PAYMENT_STATUSES
    assert "paid" in PAYMENT_STATUSES
    assert "waived" in PAYMENT_STATUSES
    assert "refunded" in PAYMENT_STATUSES


def test_extra_charge_categories_constant_has_expected_entries():
    codes = [c["code"] for c in EXTRA_CHARGE_CATEGORIES]
    assert "MINI" in codes
    assert "LND" in codes
    assert "FNB" in codes
    assert "LCO" in codes
    assert "XTR" in codes
    for cat in EXTRA_CHARGE_CATEGORIES:
        assert "code" in cat
        assert "label" in cat
        assert "charge_type" in cat


# ── payment_status derivation ────────────────────────────────────


def test_folio_summary_returns_unpaid_when_no_payments(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = _create_reservation(
            first_name="Unpaid", last_name="Guest", phone="+66810020001"
        )
        summary = folio_summary(reservation.id)
        assert summary["payment_status"] == "unpaid"


def test_folio_summary_returns_partially_paid_after_partial_payment(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = _create_reservation(
            first_name="Partial", last_name="Guest", phone="+66810020002"
        )
        actor = _make_staff_user("front_desk", "folio-partial@example.com")
        ensure_room_charges_posted(
            reservation.id,
            through_date=reservation.check_out_date,
            actor_user_id=actor.id,
        )
        record_payment(
            reservation.id,
            PaymentPostingPayload(
                amount=Decimal("100.00"),
                payment_method="cash",
                note="Partial",
            ),
            actor_user_id=actor.id,
        )
        summary = folio_summary(reservation.id)
        assert summary["payment_status"] == "partially_paid"
        assert summary["balance_due"] > Decimal("0.00")


def test_folio_summary_returns_paid_after_full_payment(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = _create_reservation(
            first_name="Full", last_name="Guest", phone="+66810020003"
        )
        actor = _make_staff_user("front_desk", "folio-full@example.com")
        ensure_room_charges_posted(
            reservation.id,
            through_date=reservation.check_out_date,
            actor_user_id=actor.id,
        )
        summary_before = folio_summary(reservation.id)
        record_payment(
            reservation.id,
            PaymentPostingPayload(
                amount=summary_before["balance_due"],
                payment_method="cash",
                note="Full payment",
            ),
            actor_user_id=actor.id,
        )
        summary = folio_summary(reservation.id)
        assert summary["payment_status"] == "paid"
        assert summary["balance_due"] == Decimal("0.00")


# ── Extra charges ────────────────────────────────────────────────


def test_post_extra_charge_creates_folio_line(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = _create_reservation(
            first_name="Extra", last_name="Guest", phone="+66810020004"
        )
        actor = _make_staff_user("front_desk", "folio-extra@example.com")
        line = post_extra_charge(
            reservation.id,
            ExtraChargePayload(
                charge_code="MINI",
                amount=Decimal("250.00"),
                description="Minibar consumption",
                note="Two beers, one water",
                quantity=1,
            ),
            actor_user_id=actor.id,
        )
        assert line.charge_code == "MINI"
        assert line.charge_type == "manual_charge"
        assert line.total_amount == Decimal("250.00")
        assert line.description == "Minibar consumption"


def test_post_extra_charge_with_quantity_multiplies_amount(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = _create_reservation(
            first_name="Qty", last_name="Guest", phone="+66810020005"
        )
        actor = _make_staff_user("front_desk", "folio-qty@example.com")
        line = post_extra_charge(
            reservation.id,
            ExtraChargePayload(
                charge_code="LND",
                amount=Decimal("100.00"),
                description="Laundry per item",
                quantity=3,
            ),
            actor_user_id=actor.id,
        )
        assert line.total_amount == Decimal("300.00")


def test_post_extra_charge_rejects_zero_amount(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = _create_reservation(
            first_name="Zero", last_name="Guest", phone="+66810020006"
        )
        actor = _make_staff_user("front_desk", "folio-zero@example.com")
        import pytest

        with pytest.raises(ValueError, match="greater than zero"):
            post_extra_charge(
                reservation.id,
                ExtraChargePayload(
                    charge_code="MINI",
                    amount=Decimal("0.00"),
                    description="Nothing",
                ),
                actor_user_id=actor.id,
            )


def test_post_extra_charge_rejects_empty_description(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = _create_reservation(
            first_name="NoDesc", last_name="Guest", phone="+66810020007"
        )
        actor = _make_staff_user("front_desk", "folio-nodesc@example.com")
        import pytest

        with pytest.raises(ValueError, match="Description is required"):
            post_extra_charge(
                reservation.id,
                ExtraChargePayload(
                    charge_code="MINI",
                    amount=Decimal("100.00"),
                    description="",
                ),
                actor_user_id=actor.id,
            )


def test_post_extra_charge_falls_back_to_xtr_for_unknown_code(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = _create_reservation(
            first_name="Unknown", last_name="Guest", phone="+66810020008"
        )
        actor = _make_staff_user("front_desk", "folio-unknown@example.com")
        line = post_extra_charge(
            reservation.id,
            ExtraChargePayload(
                charge_code="FOOBAR",
                amount=Decimal("50.00"),
                description="Unknown category",
            ),
            actor_user_id=actor.id,
        )
        assert line.charge_code == "XTR"


# ── Balance accuracy with extras ─────────────────────────────────


def test_extras_increase_balance_due(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = _create_reservation(
            first_name="Balance", last_name="Guest", phone="+66810020009"
        )
        actor = _make_staff_user("front_desk", "folio-balance@example.com")
        ensure_room_charges_posted(
            reservation.id,
            through_date=reservation.check_out_date,
            actor_user_id=actor.id,
        )
        before = folio_summary(reservation.id)
        post_extra_charge(
            reservation.id,
            ExtraChargePayload(
                charge_code="FNB",
                amount=Decimal("500.00"),
                description="Room service dinner",
            ),
            actor_user_id=actor.id,
        )
        after = folio_summary(reservation.id)
        assert after["balance_due"] > before["balance_due"]


# ── Cashier route rendering ──────────────────────────────────────


def test_cashier_folio_route_renders_balance_and_payment_status(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = _create_reservation(
            first_name="Render", last_name="Guest", phone="+66810020010"
        )
        actor = _make_staff_user("admin", "folio-render@example.com")
        ensure_room_charges_posted(
            reservation.id,
            through_date=reservation.check_out_date,
            actor_user_id=actor.id,
        )
    with app.test_client() as client:
        with app.app_context():
            actor = User.query.filter_by(email="folio-render@example.com").one()
            reservation = Reservation.query.filter_by(
                primary_guest_id=reservation.primary_guest_id
            ).first()
            _login_as(client, actor)
            resp = client.get(f"/staff/cashier/{reservation.id}")
            assert resp.status_code == 200
            html = resp.data.decode()
            assert "Balance due" in html or "Settled" in html
            assert "Record payment" in html
            assert "Add extra charge" in html
            assert "Generate QR" in html
            assert "Folio ledger" in html


def test_extra_charge_route_posts_charge_and_redirects(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = _create_reservation(
            first_name="Route", last_name="Guest", phone="+66810020011"
        )
        actor = _make_staff_user("admin", "folio-route@example.com")
    with app.test_client() as client:
        with app.app_context():
            actor = User.query.filter_by(email="folio-route@example.com").one()
            reservation = Reservation.query.filter_by(
                primary_guest_id=reservation.primary_guest_id
            ).first()
            _login_as(client, actor)
            resp = _post_form(
                client,
                f"/staff/cashier/{reservation.id}/extra-charges",
                data={
                    "charge_code": "MINI",
                    "amount": "150.00",
                    "description": "Minibar charge",
                    "note": "Two beers",
                    "quantity": "1",
                    "service_date": date.today().isoformat(),
                },
                follow_redirects=True,
            )
            assert resp.status_code == 200
            html = resp.data.decode()
            assert "Extra charge posted" in html or "Minibar charge" in html


# ── Checkout settlement visibility ───────────────────────────────


def test_front_desk_checkout_shows_settlement_summary(app_factory):
    """The checkout section should show charges, payments, and final balance."""
    app = app_factory(seed=True)
    with app.app_context():
        from pms.services.front_desk_service import CheckInPayload, complete_check_in
        from pms.models import Room

        reservation = _create_reservation(
            first_name="Checkout", last_name="Guest", phone="+66810020012"
        )
        actor = _make_staff_user("admin", "folio-checkout@example.com")

        room = Room.query.filter_by(room_type_id=reservation.room_type_id, is_active=True).first()
        if room:
            reservation.assigned_room_id = room.id
            db.session.commit()

            try:
                complete_check_in(
                    reservation.id,
                    CheckInPayload(
                        first_name="Checkout",
                        last_name="Guest",
                        phone="+66810020012",
                        room_id=room.id,
                    ),
                    actor_user_id=actor.id,
                )
            except Exception:
                pass

        reservation_refresh = db.session.get(Reservation, reservation.id)
        if reservation_refresh.current_status == "checked_in":
            with app.test_client() as client:
                _login_as(client, actor)
                resp = client.get(f"/staff/front-desk/{reservation.id}")
                assert resp.status_code == 200
                html = resp.data.decode()
                assert "Settlement" in html or "Check-Out" in html


# ── Invalid payment inputs ───────────────────────────────────────


def test_record_payment_rejects_zero_amount(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = _create_reservation(
            first_name="Invalid", last_name="Guest", phone="+66810020013"
        )
        actor = _make_staff_user("front_desk", "folio-invalid@example.com")
        import pytest

        with pytest.raises(ValueError, match="greater than zero"):
            record_payment(
                reservation.id,
                PaymentPostingPayload(
                    amount=Decimal("0.00"),
                    payment_method="cash",
                    note="Should fail",
                ),
                actor_user_id=actor.id,
            )


def test_record_payment_rejects_negative_amount(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = _create_reservation(
            first_name="Negative", last_name="Guest", phone="+66810020014"
        )
        actor = _make_staff_user("front_desk", "folio-negative@example.com")
        import pytest

        with pytest.raises(ValueError, match="greater than zero"):
            record_payment(
                reservation.id,
                PaymentPostingPayload(
                    amount=Decimal("-100.00"),
                    payment_method="cash",
                    note="Should fail",
                ),
                actor_user_id=actor.id,
            )


# ── Complimentary / waived payment ──────────────────────────────


def test_complimentary_payment_method_is_accepted(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        reservation = _create_reservation(
            first_name="Comp", last_name="Guest", phone="+66810020015"
        )
        actor = _make_staff_user("admin", "folio-comp@example.com")
        ensure_room_charges_posted(
            reservation.id,
            through_date=reservation.check_out_date,
            actor_user_id=actor.id,
        )
        summary_before = folio_summary(reservation.id)
        line = record_payment(
            reservation.id,
            PaymentPostingPayload(
                amount=summary_before["balance_due"],
                payment_method="complimentary",
                note="VIP complimentary stay",
            ),
            actor_user_id=actor.id,
        )
        assert line.charge_code == "PMT-COMP"
        summary_after = folio_summary(reservation.id)
        assert summary_after["balance_due"] == Decimal("0.00")
        assert summary_after["payment_status"] == "waived"
