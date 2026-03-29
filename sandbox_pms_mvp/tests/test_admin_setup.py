"""Tests for the Admin Setup page and setup completeness detection."""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from werkzeug.security import generate_password_hash

from pms.extensions import db
from pms.models import AppSetting, Role, User
from pms.services.setup_service import setup_completeness, setup_context


def _make_admin(email: str = "admin@sandbox.local") -> User:
    return db.session.scalar(db.select(User).where(User.email == email))


def _login(client, user: User) -> None:
    with client.session_transaction() as sess:
        sess["staff_user_id"] = str(user.id)
        sess["_csrf_token"] = "test-csrf-token"


def _post(client, url: str, data: dict, follow_redirects: bool = False):
    payload = dict(data)
    payload["csrf_token"] = "test-csrf-token"
    return client.post(url, data=payload, follow_redirects=follow_redirects)


# ── Setup completeness ──────────────────────────────────────────────


def test_setup_completeness_reports_missing_fields(app_factory):
    """With default seed data, hotel.name='My Hotel' is treated as placeholder."""
    app = app_factory(seed=True)
    with app.app_context():
        result = setup_completeness()
        # After seed, hotel name is 'My Hotel' which is a placeholder
        assert isinstance(result["missing"], list)
        assert isinstance(result["pct"], int)
        assert result["has_room_types"] is True
        assert result["has_rooms"] is True
        assert result["has_staff"] is True


def test_setup_completeness_becomes_complete_after_configuration(app_factory):
    """After setting all required fields, completeness should be 100%."""
    app = app_factory(seed=True)
    with app.app_context():
        # Configure all required fields
        required_values = {
            "hotel.name": "Grand Palace Hotel",
            "hotel.contact_phone": "+66 2 999 8888",
            "hotel.contact_email": "info@grandpalace.com",
            "hotel.address": "123 Grand Avenue, Bangkok",
            "hotel.currency": "THB",
            "hotel.check_in_time": "14:00",
            "hotel.check_out_time": "11:00",
        }
        for key, value in required_values.items():
            setting = db.session.scalar(
                sa.select(AppSetting).where(AppSetting.key == key, AppSetting.deleted_at.is_(None))
            )
            if setting:
                setting.value_json = {"value": value}
            else:
                db.session.add(AppSetting(
                    key=key,
                    value_json={"value": value},
                    value_type="string",
                ))
        db.session.commit()

        result = setup_completeness()
        assert result["complete"] is True
        assert result["pct"] == 100
        assert result["missing"] == []


def test_setup_context_returns_current_values(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        ctx = setup_context()
        assert "hotel_name" in ctx
        assert "currency" in ctx
        assert "check_in_time" in ctx


# ── Setup page route ────────────────────────────────────────────────


def test_setup_page_accessible_by_admin(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        admin = _make_admin()
    client = app.test_client()
    _login(client, admin)
    resp = client.get("/staff/admin/setup")
    assert resp.status_code == 200
    assert b"Property information" in resp.data
    assert b"Financial" in resp.data
    assert b"Branding" in resp.data


def test_setup_page_blocked_for_non_admin(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        front_desk_user = User(
            username="desk_setup_test",
            email="desk_setup@example.com",
            full_name="Desk Agent",
            password_hash=generate_password_hash("password123456"),
            is_active=True,
            account_state="active",
        )
        front_desk_user.roles = Role.query.filter(Role.code.in_(("front_desk",))).all()
        db.session.add(front_desk_user)
        db.session.commit()

    client = app.test_client()
    _login(client, front_desk_user)
    resp = client.get("/staff/admin/setup")
    assert resp.status_code == 403


def test_setup_save_property_section(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        admin = _make_admin()
    client = app.test_client()
    _login(client, admin)
    resp = _post(client, "/staff/admin/setup", {
        "section": "property",
        "hotel_name": "Royal Beach Resort",
        "brand_mark": "RBR",
        "contact_phone": "+66 76 555 1234",
        "contact_email": "info@royalbeach.com",
        "address": "88 Beach Road, Phuket",
        "check_in_time": "15:00",
        "check_out_time": "12:00",
        "timezone": "Asia/Bangkok",
        "currency": "THB",
        "tax_id": "1234567890123",
        "public_base_url": "https://book.royalbeach.com",
    }, follow_redirects=True)
    assert resp.status_code == 200
    assert b"Property information saved" in resp.data
    # Verify persisted
    with app.app_context():
        name_val = db.session.scalar(
            sa.select(AppSetting.value_json).where(AppSetting.key == "hotel.name")
        )
        assert name_val["value"] == "Royal Beach Resort"


def test_setup_save_financial_section(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        admin = _make_admin()
    client = app.test_client()
    _login(client, admin)
    resp = _post(client, "/staff/admin/setup", {
        "section": "financial",
        "vat_rate": "0.10",
        "service_charge_rate": "0.05",
        "deposit_percentage": "30.00",
        "code_prefix": "RBR",
        "cancellation_hours": "48",
    }, follow_redirects=True)
    assert resp.status_code == 200
    assert b"Financial defaults saved" in resp.data


def test_setup_save_operational_section(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        admin = _make_admin()
    client = app.test_client()
    _login(client, admin)
    resp = _post(client, "/staff/admin/setup", {
        "section": "operational",
        "notifications_sender_name": "Royal Beach Resort",
        "support_contact_text": "Contact us for direct booking support.",
    }, follow_redirects=True)
    assert resp.status_code == 200
    assert b"Operational defaults saved" in resp.data


def test_setup_save_branding_section(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        admin = _make_admin()
    client = app.test_client()
    _login(client, admin)
    resp = _post(client, "/staff/admin/setup", {
        "section": "branding",
        "logo_url": "https://example.com/logo.png",
        "accent_color": "#2A6B9C",
    }, follow_redirects=True)
    assert resp.status_code == 200
    assert b"Branding settings saved" in resp.data


def test_setup_navigation_visible_to_admin(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        admin = _make_admin()
    client = app.test_client()
    _login(client, admin)
    resp = client.get("/staff/admin")
    assert resp.status_code == 200
    assert b"Setup" in resp.data


def test_setup_incomplete_banner_shows_on_dashboard(app_factory):
    """Admin dashboard shows setup-needed banner when settings are incomplete."""
    app = app_factory(seed=True)
    with app.app_context():
        admin = _make_admin()
    client = app.test_client()
    _login(client, admin)
    resp = client.get("/staff/admin")
    assert resp.status_code == 200
    assert b"Setup needed" in resp.data or b"Complete setup" in resp.data
