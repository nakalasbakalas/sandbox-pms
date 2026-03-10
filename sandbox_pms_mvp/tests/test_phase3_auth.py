from __future__ import annotations

from datetime import timedelta

import pytest
import pyotp

from pms.extensions import db
from pms.models import ActivityLog, AuthAttempt, MfaFactor, PasswordResetToken, Role, User, UserSession, utc_now
from pms.services.auth_service import (
    confirm_totp_enrollment,
    create_totp_factor,
    decrypt_secret,
    hash_password,
    request_password_reset,
    verify_mfa_for_session,
)

def make_staff_user(
    *,
    email: str,
    password: str,
    role_codes: tuple[str, ...],
    account_state: str = "active",
    is_active: bool = True,
    mfa_required: bool = False,
) -> User:
    user = User(
        username=email.split("@", 1)[0],
        email=email,
        full_name=email.split("@", 1)[0].replace(".", " ").title(),
        password_hash=hash_password(password),
        is_active=is_active,
        account_state=account_state,
        mfa_required=mfa_required,
    )
    user.roles = Role.query.filter(Role.code.in_(role_codes)).all()
    db.session.add(user)
    db.session.commit()
    return user


def csrf_token_for(client) -> str:
    with client.session_transaction() as client_session:
        token = client_session.get("_csrf_token")
        if not token:
            token = "test-csrf-token"
            client_session["_csrf_token"] = token
        return token


def post_form(client, url: str, *, data: dict, follow_redirects: bool = False):
    payload = dict(data)
    payload["csrf_token"] = csrf_token_for(client)
    return client.post(url, data=payload, follow_redirects=follow_redirects)


def login(client, *, identifier: str, password: str, follow_redirects: bool = False):
    return post_form(
        client,
        "/staff/login",
        data={"username": identifier, "password": password},
        follow_redirects=follow_redirects,
    )


def test_login_succeeds_with_correct_credentials(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="frontdesk@example.com", password="correct horse 123", role_codes=("front_desk",))

    response = login(client, identifier=user.email, password="correct horse 123")

    assert response.status_code == 302
    assert response.headers["Location"].endswith("/staff")
    set_cookie = response.headers["Set-Cookie"]
    assert "sbx_staff_session=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=Lax" in set_cookie
    with app.app_context():
        session_row = UserSession.query.filter_by(user_id=user.id).one()
        refreshed = db.session.get(User, user.id)
        assert session_row.revoked_at is None
        assert refreshed.last_login_at is not None


def test_login_fails_with_wrong_credentials(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="audit@example.com", password="correct horse 123", role_codes=("front_desk",))

    response = login(client, identifier=user.email, password="wrong password")

    assert response.status_code == 401
    assert b"Invalid credentials or account unavailable." in response.data
    with app.app_context():
        assert UserSession.query.count() == 0
        assert AuthAttempt.query.filter_by(user_id=user.id, success=False).count() == 1
        assert ActivityLog.query.filter_by(event_type="auth.login_failure").count() == 1


def test_missing_csrf_token_is_rejected(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    response = client.post("/staff/login", data={"username": "missing@example.com", "password": "password"})
    assert response.status_code == 400
    assert b"CSRF validation failed." in response.data


def test_password_is_hashed_not_plaintext(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        user = make_staff_user(email="hash@example.com", password="correct horse 123", role_codes=("front_desk",))
        assert user.password_hash != "correct horse 123"
        assert user.password_hash.startswith("$argon2")


def test_session_cookie_changes_between_logins(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    with app.app_context():
        make_staff_user(email="rotate@example.com", password="correct horse 123", role_codes=("front_desk",))

    client_a = app.test_client()
    client_b = app.test_client()
    response_a = login(client_a, identifier="rotate@example.com", password="correct horse 123")
    response_b = login(client_b, identifier="rotate@example.com", password="correct horse 123")

    cookie_a = response_a.headers["Set-Cookie"]
    cookie_b = response_b.headers["Set-Cookie"]
    assert cookie_a != cookie_b


def test_logout_invalidates_session(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="logout@example.com", password="correct horse 123", role_codes=("front_desk",))

    login(client, identifier=user.email, password="correct horse 123")
    response = post_form(client, "/staff/logout", data={})

    assert response.status_code == 302
    with app.app_context():
        session_row = UserSession.query.filter_by(user_id=user.id).one()
        assert session_row.revoked_at is not None
        assert ActivityLog.query.filter_by(event_type="auth.logout").count() == 1


def test_idle_timeout_expires_session(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="idle@example.com", password="correct horse 123", role_codes=("front_desk",))

    login(client, identifier=user.email, password="correct horse 123")
    with app.app_context():
        session_row = UserSession.query.filter_by(user_id=user.id).one()
        session_row.last_activity_at = utc_now() - timedelta(minutes=16)
        db.session.commit()

    response = client.get("/staff")

    assert response.status_code == 401
    with app.app_context():
        session_row = UserSession.query.filter_by(user_id=user.id).one()
        assert session_row.revoked_at is not None


def test_absolute_timeout_expires_session(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="absolute@example.com", password="correct horse 123", role_codes=("front_desk",))

    login(client, identifier=user.email, password="correct horse 123")
    with app.app_context():
        session_row = UserSession.query.filter_by(user_id=user.id).one()
        session_row.expires_at = utc_now() - timedelta(minutes=1)
        db.session.commit()

    response = client.get("/staff")

    assert response.status_code == 401
    with app.app_context():
        session_row = UserSession.query.filter_by(user_id=user.id).one()
        assert session_row.revoked_at is not None


def test_password_reset_token_is_single_use(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="reset@example.com", password="correct horse 123", role_codes=("front_desk",))
        token_result = request_password_reset(user.email, ip_address="127.0.0.1")

    first = post_form(client, f"/staff/reset-password/{token_result.token}", data={"password": "brand new pass 123"})
    second = post_form(client, f"/staff/reset-password/{token_result.token}", data={"password": "second new pass 123"})

    assert first.status_code == 302
    assert second.status_code == 400
    with app.app_context():
        token_row = PasswordResetToken.query.filter_by(user_id=user.id).one()
        refreshed = db.session.get(User, user.id)
        assert token_row.used_at is not None
        assert refreshed.password_hash != "brand new pass 123"
        assert ActivityLog.query.filter_by(event_type="auth.password_reset_completed").count() == 1
    assert login(client, identifier=user.email, password="correct horse 123").status_code == 401
    assert login(client, identifier=user.email, password="brand new pass 123").status_code == 302


def test_password_reset_token_expires(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="expired@example.com", password="correct horse 123", role_codes=("front_desk",))
        token_result = request_password_reset(user.email, ip_address="127.0.0.1")
        token_row = PasswordResetToken.query.filter_by(user_id=user.id).one()
        token_row.expires_at = utc_now() - timedelta(minutes=1)
        db.session.commit()

    response = post_form(client, f"/staff/reset-password/{token_result.token}", data={"password": "brand new pass 123"})

    assert response.status_code == 400
    assert b"Reset link is invalid or expired." in response.data


def test_login_lockout_triggers_after_repeated_failures(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="lock@example.com", password="correct horse 123", role_codes=("front_desk",))

    for _ in range(5):
        assert login(client, identifier=user.email, password="wrong password").status_code == 401

    with app.app_context():
        refreshed = db.session.get(User, user.id)
        assert refreshed.locked_until is not None
        assert ActivityLog.query.filter_by(event_type="auth.account_locked").count() == 1
    assert login(client, identifier=user.email, password="correct horse 123").status_code == 401


def test_locked_account_can_log_in_after_lock_window(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="unlock@example.com", password="correct horse 123", role_codes=("front_desk",))

    for _ in range(5):
        login(client, identifier=user.email, password="wrong password")
    with app.app_context():
        refreshed = db.session.get(User, user.id)
        refreshed.locked_until = utc_now() - timedelta(minutes=1)
        refreshed.account_state = "active"
        db.session.commit()

    assert login(client, identifier=user.email, password="correct horse 123").status_code == 302


def test_admin_and_manager_permissions_allow_operational_admin_pages(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))
        manager = make_staff_user(email="manager@example.com", password="correct horse 123", role_codes=("manager",))

    for email, password in [(admin.email, "sandbox-admin-123"), (manager.email, "correct horse 123")]:
        client = app.test_client()
        assert login(client, identifier=email, password=password).status_code == 302
        assert client.get("/staff/settings").status_code == 200
        assert client.get("/staff/rates").status_code == 200
        assert client.get("/staff/reports").status_code == 200
        assert client.get("/staff/users").status_code == 200
        assert client.get("/staff/audit").status_code == 200


def test_front_desk_permission_limits(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="desk@example.com", password="correct horse 123", role_codes=("front_desk",))

    assert login(client, identifier=user.email, password="correct horse 123").status_code == 302
    assert client.get("/staff/reservations").status_code == 200
    assert client.get("/staff/settings").status_code == 403
    assert client.get("/staff/reports").status_code == 403
    assert client.get("/staff/users").status_code == 403


def test_housekeeping_permission_limits(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="hk@example.com", password="correct horse 123", role_codes=("housekeeping",))

    assert login(client, identifier=user.email, password="correct horse 123").status_code == 302
    assert client.get("/staff/reservations").status_code == 200
    assert client.get("/staff/rates").status_code == 403
    assert client.get("/staff/settings").status_code == 403


def test_backend_blocks_unauthorized_mutation(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="unauth@example.com", password="correct horse 123", role_codes=("front_desk",))

    assert login(client, identifier=user.email, password="correct horse 123").status_code == 302
    response = post_form(client, "/staff/settings", data={"key": "hotel.name", "value": "Unsafe"})
    assert response.status_code == 403


def test_activity_log_records_login_success_and_logout(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="activity@example.com", password="correct horse 123", role_codes=("front_desk",))

    login(client, identifier=user.email, password="correct horse 123")
    post_form(client, "/staff/logout", data={})

    with app.app_context():
        events = [row.event_type for row in ActivityLog.query.order_by(ActivityLog.created_at.asc()).all()]
        assert "auth.login_success" in events
        assert "auth.logout" in events


def test_mfa_enrollment_and_verification_flow(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="mfa@example.com", password="correct horse 123", role_codes=("manager",))

    assert login(client, identifier=user.email, password="correct horse 123").status_code == 302
    start = post_form(client, "/staff/security", data={"action": "start_mfa"}, follow_redirects=True)
    assert start.status_code == 200
    with app.app_context():
        factor = MfaFactor.query.filter_by(user_id=user.id, disabled_at=None).one()
        secret = decrypt_secret(factor.secret_encrypted)
        code = pyotp.TOTP(secret).now()
    confirm = post_form(
        client,
        "/staff/security",
        data={"action": "confirm_mfa", "factor_id": str(factor.id), "code": code},
        follow_redirects=True,
    )
    assert confirm.status_code == 200
    post_form(client, "/staff/logout", data={})

    login_response = login(client, identifier=user.email, password="correct horse 123")
    assert login_response.status_code == 302
    assert login_response.headers["Location"].endswith("/staff/mfa/verify")
    verify = post_form(client, "/staff/mfa/verify", data={"code": pyotp.TOTP(secret).now()})
    assert verify.status_code == 302
    assert verify.headers["Location"].endswith("/staff")
    with app.app_context():
        factor = MfaFactor.query.filter_by(user_id=user.id, disabled_at=None).one()
        assert factor.verified_at is not None
        assert ActivityLog.query.filter_by(event_type="auth.mfa_enabled").count() == 1
        assert ActivityLog.query.filter_by(event_type="auth.mfa_verified").count() >= 1


def test_mfa_recovery_code_is_one_time_use(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="recovery@example.com", password="correct horse 123", role_codes=("manager",))
        factor, _ = create_totp_factor(user)
        secret = decrypt_secret(factor.secret_encrypted)
        recovery_codes = confirm_totp_enrollment(user, factor.id, pyotp.TOTP(secret).now())
    result = login(client, identifier=user.email, password="correct horse 123")
    assert result.status_code == 302
    assert result.headers["Location"].endswith("/staff/mfa/verify")
    with app.app_context():
        session_row = UserSession.query.filter_by(user_id=user.id).order_by(UserSession.created_at.desc()).first()
        verify_mfa_for_session(session_row, recovery_codes[0])
        with pytest.raises(ValueError):
            another_session = UserSession.query.filter_by(user_id=user.id).order_by(UserSession.created_at.desc()).first()
            verify_mfa_for_session(another_session, recovery_codes[0])
