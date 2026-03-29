"""Tests for the Café POS module — models, service, routes, permissions."""
from __future__ import annotations

from datetime import date
from pathlib import Path
from uuid import UUID

import pytest
import sqlalchemy as sa
from flask_migrate import upgrade
from werkzeug.security import generate_password_hash

from pms.app import create_app
from pms.extensions import db
from pms.models import (
    CafeAuditLog,
    CafeCategory,
    CafeItem,
    CafeModifier,
    CafeModifierGroup,
    CafeOrder,
    CafeOrderItem,
    CafeOrderItemModifier,
    CafePayment,
    CafeShift,
    Role,
    User,
)
from pms.seeds import seed_all
from pms.services.cafe_service import (
    CategoryPayload,
    CreateOrderPayload,
    ItemPayload,
    ModifierGroupPayload,
    ModifierPayload,
    OrderItemPayload,
    PaymentPayload,
    cancel_order,
    close_shift,
    complete_order,
    create_category,
    create_item,
    create_modifier_group,
    create_order,
    daily_report,
    get_current_shift,
    get_order,
    list_categories,
    list_items,
    list_orders,
    open_shift,
    record_payment,
    refund_order,
    seed_cafe_defaults,
    send_order_to_prep,
    toggle_item_availability,
    update_prep_status,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = PROJECT_ROOT / "migrations"


def _make_user(role_code: str, email: str) -> User:
    role = db.session.execute(sa.select(Role).where(Role.code == role_code)).scalars().unique().one()
    user = User(
        username=email.split("@")[0],
        email=email,
        full_name=email.split("@")[0].replace(".", " ").title(),
        password_hash=generate_password_hash("password123456"),
        is_active=True,
        account_state="active",
    )
    user.roles = [role]
    db.session.add(user)
    db.session.commit()
    return user


def _login(client, user: User) -> None:
    with client.session_transaction() as sess:
        sess["staff_user_id"] = str(user.id)
        sess["_csrf_token"] = "test-csrf"


def _post(client, url: str, *, data: dict | None = None, follow_redirects: bool = False):
    payload = dict(data or {})
    payload["csrf_token"] = "test-csrf"
    return client.post(url, data=payload, follow_redirects=follow_redirects)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def app(app_factory):
    return app_factory(seed=True)


@pytest.fixture()
def cafe_manager(app):
    with app.app_context():
        return _make_user("cafe_manager", "cafe.mgr@test.local")


@pytest.fixture()
def cafe_staff_user(app):
    with app.app_context():
        return _make_user("cafe_staff", "cafe.staff@test.local")


@pytest.fixture()
def admin_user(app):
    with app.app_context():
        return db.session.execute(
            sa.select(User).where(User.email == "admin@sandbox.local")
        ).unique().scalar_one()


@pytest.fixture()
def front_desk_user(app):
    with app.app_context():
        return _make_user("front_desk", "fd@test.local")


# ---------------------------------------------------------------------------
# Permission / access control tests
# ---------------------------------------------------------------------------

class TestCafeAccessControl:
    def test_cafe_pos_requires_login(self, app):
        with app.test_client() as c:
            resp = c.get("/cafe")
            assert resp.status_code == 401

    def test_front_desk_cannot_access_cafe(self, app, front_desk_user):
        with app.test_client() as c:
            _login(c, front_desk_user)
            resp = c.get("/cafe")
            assert resp.status_code == 403

    def test_cafe_staff_can_access_pos(self, app, cafe_staff_user):
        with app.test_client() as c:
            _login(c, cafe_staff_user)
            resp = c.get("/cafe")
            assert resp.status_code == 200

    def test_admin_can_access_cafe(self, app, admin_user):
        with app.test_client() as c:
            _login(c, admin_user)
            resp = c.get("/cafe")
            assert resp.status_code == 200

    def test_cafe_staff_cannot_manage_menu(self, app, cafe_staff_user):
        with app.test_client() as c:
            _login(c, cafe_staff_user)
            resp = c.get("/cafe/menu")
            assert resp.status_code == 403

    def test_cafe_manager_can_manage_menu(self, app, cafe_manager):
        with app.test_client() as c:
            _login(c, cafe_manager)
            resp = c.get("/cafe/menu")
            assert resp.status_code == 200

    def test_cafe_staff_cannot_view_reports(self, app, cafe_staff_user):
        with app.test_client() as c:
            _login(c, cafe_staff_user)
            resp = c.get("/cafe/reports")
            assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Service layer tests
# ---------------------------------------------------------------------------

class TestCafeService:
    def test_seed_defaults(self, app):
        with app.app_context():
            seed_cafe_defaults()
            db.session.commit()
            cats = list_categories()
            assert len(cats) >= 4

    def test_create_category(self, app, cafe_manager):
        with app.app_context():
            cat = create_category(CategoryPayload(name="Drinks", sort_order=1), actor_id=cafe_manager.id)
            db.session.commit()
            assert cat.name == "Drinks"
            assert cat.id is not None

    def test_create_item(self, app, cafe_manager):
        with app.app_context():
            cat = create_category(CategoryPayload(name="Coffee"), actor_id=cafe_manager.id)
            db.session.flush()
            item = create_item(ItemPayload(
                name="Latte", category_id=cat.id, price=65, prep_station="bar",
            ), actor_id=cafe_manager.id)
            db.session.commit()
            assert item.name == "Latte"
            assert item.price == 65

    def test_toggle_availability(self, app, cafe_manager):
        with app.app_context():
            cat = create_category(CategoryPayload(name="Tea"), actor_id=cafe_manager.id)
            db.session.flush()
            item = create_item(ItemPayload(name="Green Tea", category_id=cat.id, price=50), actor_id=cafe_manager.id)
            db.session.commit()
            assert item.is_available is True
            toggle_item_availability(item.id, actor_id=cafe_manager.id)
            db.session.commit()
            assert item.is_available is False

    def test_full_order_lifecycle(self, app, cafe_manager):
        with app.app_context():
            cat = create_category(CategoryPayload(name="Coffee"), actor_id=cafe_manager.id)
            db.session.flush()
            item = create_item(ItemPayload(name="Americano", category_id=cat.id, price=55, prep_station="bar"), actor_id=cafe_manager.id)
            db.session.flush()

            order = create_order(CreateOrderPayload(
                order_type="dine_in",
                items=[OrderItemPayload(item_id=item.id, quantity=2)],
            ), actor_id=cafe_manager.id)
            db.session.commit()

            assert order.status == "open"
            assert order.subtotal == 110
            assert order.grand_total == 110
            assert len(order.items) == 1
            assert order.items[0].quantity == 2

            # Send to prep
            send_order_to_prep(order.id, actor_id=cafe_manager.id)
            db.session.commit()
            assert order.status == "sent"

            # Pay
            record_payment(order.id, PaymentPayload(method="cash", amount=110, amount_received=200), actor_id=cafe_manager.id)
            db.session.commit()
            assert order.status == "paid"
            assert order.payment_status == "paid"
            assert len(order.payments) == 1
            assert order.payments[0].change_given == 90

            # Complete
            complete_order(order.id, actor_id=cafe_manager.id)
            db.session.commit()
            assert order.status == "completed"

    def test_order_with_modifiers(self, app, cafe_manager):
        with app.app_context():
            cat = create_category(CategoryPayload(name="Coffee"), actor_id=cafe_manager.id)
            db.session.flush()
            mg = create_modifier_group(
                ModifierGroupPayload(name="Size"),
                modifiers=[ModifierPayload(name="Large", price_delta=20)],
                actor_id=cafe_manager.id,
            )
            db.session.flush()
            item = create_item(ItemPayload(
                name="Latte", category_id=cat.id, price=65,
                modifier_group_ids=[mg.id],
            ), actor_id=cafe_manager.id)
            db.session.flush()

            mod = db.session.execute(sa.select(CafeModifier).where(CafeModifier.group_id == mg.id)).scalar_one()
            order = create_order(CreateOrderPayload(
                order_type="takeaway",
                items=[OrderItemPayload(item_id=item.id, quantity=1, modifier_ids=[mod.id])],
            ), actor_id=cafe_manager.id)
            db.session.commit()

            assert order.grand_total == 85  # 65 + 20
            oi = order.items[0]
            assert oi.unit_price == 85
            assert len(oi.modifiers) == 1

    def test_cancel_order(self, app, cafe_manager):
        with app.app_context():
            cat = create_category(CategoryPayload(name="Tea"), actor_id=cafe_manager.id)
            db.session.flush()
            item = create_item(ItemPayload(name="Matcha", category_id=cat.id, price=75), actor_id=cafe_manager.id)
            db.session.flush()
            order = create_order(CreateOrderPayload(
                items=[OrderItemPayload(item_id=item.id)],
            ), actor_id=cafe_manager.id)
            db.session.commit()

            cancel_order(order.id, reason="Customer left", actor_id=cafe_manager.id)
            db.session.commit()
            assert order.status == "cancelled"

    def test_refund_order(self, app, cafe_manager):
        with app.app_context():
            cat = create_category(CategoryPayload(name="Juice"), actor_id=cafe_manager.id)
            db.session.flush()
            item = create_item(ItemPayload(name="OJ", category_id=cat.id, price=60), actor_id=cafe_manager.id)
            db.session.flush()
            order = create_order(CreateOrderPayload(
                items=[OrderItemPayload(item_id=item.id)],
            ), actor_id=cafe_manager.id)
            db.session.flush()
            record_payment(order.id, PaymentPayload(method="card", amount=60), actor_id=cafe_manager.id)
            db.session.commit()
            assert order.status == "paid"

            refund_order(order.id, reason="Wrong item", actor_id=cafe_manager.id)
            db.session.commit()
            assert order.status == "refunded"
            assert order.payment_status == "refunded"

    def test_shift_open_close(self, app, cafe_manager):
        with app.app_context():
            shift = open_shift(opening_cash=1000, actor_id=cafe_manager.id)
            db.session.commit()
            assert shift.status == "open"
            assert get_current_shift() is not None

            close_shift(shift.id, actual_cash=1050, notes="Good day", actor_id=cafe_manager.id)
            db.session.commit()
            assert shift.status == "closed"
            assert shift.variance == 50  # 1050 - 1000 (no orders)
            assert get_current_shift() is None

    def test_cannot_open_two_shifts(self, app, cafe_manager):
        with app.app_context():
            open_shift(opening_cash=500, actor_id=cafe_manager.id)
            db.session.commit()
            with pytest.raises(ValueError, match="already open"):
                open_shift(opening_cash=500, actor_id=cafe_manager.id)

    def test_daily_report(self, app, cafe_manager):
        with app.app_context():
            cat = create_category(CategoryPayload(name="Coffee"), actor_id=cafe_manager.id)
            db.session.flush()
            item = create_item(ItemPayload(name="Espresso", category_id=cat.id, price=45), actor_id=cafe_manager.id)
            db.session.flush()
            order = create_order(CreateOrderPayload(
                items=[OrderItemPayload(item_id=item.id, quantity=3)],
            ), actor_id=cafe_manager.id)
            db.session.flush()
            record_payment(order.id, PaymentPayload(method="cash", amount=135, amount_received=200), actor_id=cafe_manager.id)
            db.session.commit()

            report = daily_report(date.today())
            assert report["total_orders"] >= 1
            assert report["total_sales"] >= 135

    def test_audit_log_created(self, app, cafe_manager):
        with app.app_context():
            cat = create_category(CategoryPayload(name="Audit Test"), actor_id=cafe_manager.id)
            db.session.commit()
            logs = db.session.execute(
                sa.select(CafeAuditLog).where(CafeAuditLog.entity_type == "cafe_category")
            ).scalars().all()
            assert len(logs) >= 1


# ---------------------------------------------------------------------------
# Route tests
# ---------------------------------------------------------------------------

class TestCafeRoutes:
    def test_pos_page_loads(self, app, cafe_staff_user):
        with app.test_client() as c:
            _login(c, cafe_staff_user)
            with app.app_context():
                seed_cafe_defaults()
                db.session.commit()
            resp = c.get("/cafe")
            assert resp.status_code == 200
            assert b"Caf" in resp.data

    def test_orders_page_loads(self, app, cafe_staff_user):
        with app.test_client() as c:
            _login(c, cafe_staff_user)
            resp = c.get("/cafe/orders")
            assert resp.status_code == 200

    def test_prep_page_loads(self, app, cafe_staff_user):
        with app.test_client() as c:
            _login(c, cafe_staff_user)
            resp = c.get("/cafe/prep")
            assert resp.status_code == 200

    def test_shifts_page_loads(self, app, cafe_staff_user):
        with app.test_client() as c:
            _login(c, cafe_staff_user)
            resp = c.get("/cafe/shifts")
            assert resp.status_code == 200

    def test_create_order_via_route(self, app, cafe_staff_user):
        with app.test_client() as c:
            _login(c, cafe_staff_user)
            with app.app_context():
                seed_cafe_defaults()
                db.session.commit()
                cat = db.session.execute(sa.select(CafeCategory).limit(1)).scalar_one()
                item = create_item(ItemPayload(name="Test Coffee", category_id=cat.id, price=50), actor_id=cafe_staff_user.id)
                db.session.commit()
                item_id = str(item.id)

            resp = _post(c, "/cafe/order/create", data={
                "order_type": "dine_in",
                "item_id": item_id,
                "item_quantity": "1",
                "item_notes": "",
                "item_modifiers": "",
            }, follow_redirects=True)
            assert resp.status_code == 200

    def test_payment_page_loads(self, app, cafe_staff_user):
        with app.test_client() as c:
            _login(c, cafe_staff_user)
            with app.app_context():
                seed_cafe_defaults()
                db.session.commit()
                cat = db.session.execute(sa.select(CafeCategory).limit(1)).scalar_one()
                item = create_item(ItemPayload(name="Pay Test", category_id=cat.id, price=40), actor_id=cafe_staff_user.id)
                db.session.flush()
                order = create_order(CreateOrderPayload(
                    items=[OrderItemPayload(item_id=item.id)],
                ), actor_id=cafe_staff_user.id)
                db.session.commit()
                order_id = str(order.id)

            resp = c.get(f"/cafe/order/{order_id}/pay")
            assert resp.status_code == 200

    def test_menu_seed_setup(self, app, cafe_manager):
        with app.test_client() as c:
            _login(c, cafe_manager)
            resp = _post(c, "/cafe/setup", follow_redirects=True)
            assert resp.status_code == 200

    def test_reports_page_loads(self, app, cafe_manager):
        with app.test_client() as c:
            _login(c, cafe_manager)
            resp = c.get("/cafe/reports")
            assert resp.status_code == 200

    def test_stock_page_loads(self, app, cafe_manager):
        with app.test_client() as c:
            _login(c, cafe_manager)
            resp = c.get("/cafe/stock")
            assert resp.status_code == 200
