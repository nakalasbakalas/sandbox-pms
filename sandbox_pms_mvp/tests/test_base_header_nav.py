from __future__ import annotations

import pms.helpers as helpers
from werkzeug.security import generate_password_hash

from pms.extensions import db
from pms.models import AppSetting, Role, User


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


def test_public_header_groups_primary_nav_and_utility_menus(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()

    response = client.get("/")

    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'class="container app-header public-app-header"' in html
    assert 'class="header-main-nav"' in html
    assert 'data-analytics-label="header_search"' in html
    assert 'header-contact-menu' in html
    assert 'header-language-menu' in html
    assert 'nav-menu-toggle' in html
    assert 'id="nav-drawer"' in html
    assert "brand-contact" not in html


def test_staff_header_preserves_compact_nav_search_and_logout(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        user = make_staff_user("front_desk", "ops.frontdesk@example.com")

    login_as(client, user)
    response = client.get("/staff/reservations")

    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'class="header-search"' in html
    assert 'action="/staff/reservations"' in html
    assert 'href="/staff/front-desk"' in html
    assert 'href="/staff/reservations" aria-current="page"' in html
    assert "header-account-menu" in html
    assert 'action="/staff/logout"' in html
    assert 'name="csrf_token"' in html
    assert "brand-contact" not in html


def test_current_settings_uses_request_scoped_cache(app_factory, monkeypatch):
    app = app_factory(seed=False)
    with app.app_context():
        db.session.add(AppSetting(key="hotel.name", value_json="Sandbox Hotel", value_type="string"))
        db.session.commit()

    call_count = {"execute": 0}
    real_execute = db.session.execute

    def counting_execute(*args, **kwargs):
        call_count["execute"] += 1
        return real_execute(*args, **kwargs)

    with app.test_request_context("/"):
        monkeypatch.setattr(helpers.db.session, "execute", counting_execute)
        first = helpers.current_settings()
        second = helpers.current_settings()

    assert first["hotel.name"] == "Sandbox Hotel"
    assert second["hotel.name"] == "Sandbox Hotel"
    assert call_count["execute"] == 1
