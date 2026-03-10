from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pyotp
import sqlalchemy as sa
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from cryptography.fernet import Fernet
from flask import current_app
from werkzeug.security import check_password_hash

from ..activity import write_activity_log
from ..audit import write_audit_log
from ..extensions import db
from ..models import (
    ActivityLog,
    AuthAttempt,
    EmailOutbox,
    MfaFactor,
    MfaRecoveryCode,
    PasswordResetToken,
    User,
    UserPasswordHistory,
    UserSession,
    utc_now,
)


@dataclass
class LoginResult:
    success: bool
    user: User | None = None
    session: UserSession | None = None
    cookie_value: str | None = None
    requires_mfa: bool = False
    error: str | None = None


@dataclass
class PasswordResetRequestResult:
    issued: bool
    token: str | None = None
    user: User | None = None


def password_hasher() -> PasswordHasher:
    return PasswordHasher(
        time_cost=current_app.config["ARGON2_TIME_COST"],
        memory_cost=current_app.config["ARGON2_MEMORY_COST"],
        parallelism=current_app.config["ARGON2_PARALLELISM"],
        hash_len=current_app.config["ARGON2_HASH_LEN"],
    )


def hash_password(password: str) -> str:
    validate_new_password(password)
    return password_hasher().hash(password)


def verify_password_hash(stored_hash: str, password: str) -> tuple[bool, bool]:
    if not stored_hash:
        return False, False
    if stored_hash.startswith("$argon2"):
        try:
            ok = password_hasher().verify(stored_hash, password)
            return bool(ok), password_hasher().check_needs_rehash(stored_hash)
        except (VerifyMismatchError, InvalidHashError):
            return False, False
    ok = check_password_hash(stored_hash, password)
    return ok, ok


def validate_new_password(password: str) -> None:
    if len(password or "") < 12:
        raise ValueError("Password must be at least 12 characters.")
    if not any(char.isalpha() for char in password):
        raise ValueError("Password must include at least one letter.")
    if not any(char.isdigit() for char in password):
        raise ValueError("Password must include at least one number.")


def user_has_active_mfa(user: User) -> bool:
    return active_mfa_factor(user) is not None


def active_mfa_factor(user: User) -> MfaFactor | None:
    return (
        MfaFactor.query.filter_by(user_id=user.id, factor_type="totp")
        .filter(MfaFactor.disabled_at.is_(None), MfaFactor.verified_at.is_not(None))
        .order_by(MfaFactor.enrolled_at.desc())
        .first()
    )


def pending_mfa_factor(user: User) -> MfaFactor | None:
    return (
        MfaFactor.query.filter_by(user_id=user.id, factor_type="totp")
        .filter(MfaFactor.disabled_at.is_(None), MfaFactor.verified_at.is_(None))
        .order_by(MfaFactor.enrolled_at.desc())
        .first()
    )


def normalize_identifier(identifier: str | None) -> str:
    return (identifier or "").strip().lower()


def login_with_password(identifier: str, password: str, *, ip_address: str | None, user_agent: str | None) -> LoginResult:
    normalized = normalize_identifier(identifier)
    generic_error = "Invalid credentials or account unavailable."
    if not normalized or not password:
        record_auth_attempt(normalized, None, ip_address, user_agent, success=False, failure_reason="invalid_credentials")
        write_activity_log(
            actor_user_id=None,
            event_type="auth.login_failure",
            entity_table="users",
            entity_id=None,
            metadata={"identifier": normalized, "reason": "invalid_credentials"},
        )
        db.session.commit()
        return LoginResult(success=False, error=generic_error)

    if ip_is_rate_limited(ip_address):
        record_auth_attempt(normalized, None, ip_address, user_agent, success=False, failure_reason="locked")
        write_activity_log(
            actor_user_id=None,
            event_type="auth.login_failure",
            entity_table="users",
            entity_id=None,
            metadata={"identifier": normalized, "reason": "ip_rate_limited"},
        )
        db.session.commit()
        return LoginResult(success=False, error=generic_error)

    user = User.query.filter(
        User.deleted_at.is_(None),
        sa.or_(sa.func.lower(User.email) == normalized, sa.func.lower(User.username) == normalized),
    ).first()
    if not user:
        record_auth_attempt(normalized, None, ip_address, user_agent, success=False, failure_reason="invalid_credentials")
        write_activity_log(
            actor_user_id=None,
            event_type="auth.login_failure",
            entity_table="users",
            entity_id=None,
            metadata={"identifier": normalized, "reason": "invalid_credentials"},
        )
        db.session.commit()
        return LoginResult(success=False, error=generic_error)

    if user.account_state in {"disabled", "invited", "locked"} or not user.is_active:
        record_auth_attempt(normalized, user, ip_address, user_agent, success=False, failure_reason="disabled")
        write_activity_log(
            actor_user_id=user.id,
            event_type="auth.login_failure",
            entity_table="users",
            entity_id=str(user.id),
            metadata={"reason": "disabled"},
        )
        db.session.commit()
        return LoginResult(success=False, error=generic_error)
    if user.is_locked():
        record_auth_attempt(normalized, user, ip_address, user_agent, success=False, failure_reason="locked")
        write_activity_log(
            actor_user_id=user.id,
            event_type="auth.login_failure",
            entity_table="users",
            entity_id=str(user.id),
            metadata={"reason": "locked"},
        )
        db.session.commit()
        return LoginResult(success=False, error=generic_error)

    ok, needs_rehash = verify_password_hash(user.password_hash, password)
    if not ok:
        register_failed_login(user, normalized, ip_address, user_agent)
        return LoginResult(success=False, error=generic_error)

    reset_failed_logins(user)
    if needs_rehash:
        update_user_password(user, password, actor_user_id=None, allow_reuse=True)
    requires_mfa = user.mfa_required or user_has_active_mfa(user)
    auth_session, cookie_value = create_user_session(
        user,
        ip_address=ip_address,
        user_agent=user_agent,
        mfa_completed=not requires_mfa,
    )
    user.last_login_at = utc_now()
    record_auth_attempt(normalized, user, ip_address, user_agent, success=True, failure_reason=None)
    write_activity_log(
        actor_user_id=user.id,
        event_type="auth.login_success",
        entity_table="users",
        entity_id=str(user.id),
        metadata={"requires_mfa": requires_mfa},
    )
    db.session.commit()
    return LoginResult(success=True, user=user, session=auth_session, cookie_value=cookie_value, requires_mfa=requires_mfa)


def load_session_from_cookie(cookie_value: str | None) -> tuple[UserSession | None, User | None]:
    if not cookie_value or "." not in cookie_value:
        return None, None
    selector, token = cookie_value.split(".", 1)
    auth_session = UserSession.query.filter_by(selector=selector).first()
    if not auth_session or auth_session.revoked_at is not None:
        return None, None
    if not hmac.compare_digest(auth_session.token_hash, _token_hash(token)):
        revoke_session(auth_session)
        db.session.commit()
        return None, None
    now = utc_now()
    if session_is_expired(auth_session, now):
        revoke_session(auth_session)
        db.session.commit()
        return None, None
    user = db.session.get(User, auth_session.user_id)
    if not user or user.deleted_at is not None or user.account_state in {"disabled", "invited", "locked"} or not user.is_active:
        revoke_session(auth_session)
        db.session.commit()
        return None, None
    auth_session.last_activity_at = now
    return auth_session, user


def session_is_expired(auth_session: UserSession, now: datetime | None = None) -> bool:
    now = now or utc_now()
    expires_at = _coerce_utc(auth_session.expires_at)
    last_activity_at = _coerce_utc(auth_session.last_activity_at)
    idle_limit = last_activity_at + timedelta(minutes=current_app.config["SESSION_IDLE_MINUTES"])
    return expires_at <= now or idle_limit <= now


def create_user_session(
    user: User,
    *,
    ip_address: str | None,
    user_agent: str | None,
    mfa_completed: bool,
) -> tuple[UserSession, str]:
    selector = secrets.token_urlsafe(18)
    token = secrets.token_urlsafe(32)
    auth_session = UserSession(
        user_id=user.id,
        selector=selector,
        token_hash=_token_hash(token),
        created_at=utc_now(),
        last_activity_at=utc_now(),
        expires_at=utc_now() + timedelta(hours=current_app.config["SESSION_ABSOLUTE_HOURS"]),
        mfa_completed_at=utc_now() if mfa_completed else None,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.session.add(auth_session)
    db.session.flush()
    return auth_session, f"{selector}.{token}"


def revoke_session(auth_session: UserSession) -> None:
    auth_session.revoked_at = utc_now()


def revoke_all_user_sessions(user_id, *, except_session_id=None) -> None:
    sessions = UserSession.query.filter_by(user_id=user_id).filter(UserSession.revoked_at.is_(None)).all()
    for auth_session in sessions:
        if except_session_id and auth_session.id == except_session_id:
            continue
        auth_session.revoked_at = utc_now()


def rotate_session_after_mfa(auth_session: UserSession) -> tuple[UserSession, str]:
    revoke_session(auth_session)
    user = db.session.get(User, auth_session.user_id)
    new_session, cookie_value = create_user_session(
        user,
        ip_address=auth_session.ip_address,
        user_agent=auth_session.user_agent,
        mfa_completed=True,
    )
    db.session.commit()
    return new_session, cookie_value


def request_password_reset(identifier: str, *, ip_address: str | None) -> PasswordResetRequestResult:
    normalized = normalize_identifier(identifier)
    generic = PasswordResetRequestResult(issued=False, token=None, user=None)
    if not normalized:
        return generic
    user = User.query.filter(
        User.deleted_at.is_(None),
        sa.or_(sa.func.lower(User.email) == normalized, sa.func.lower(User.username) == normalized),
    ).first()
    if not user:
        return generic
    window_start = utc_now() - timedelta(minutes=current_app.config["PASSWORD_RESET_REQUEST_WINDOW_MINUTES"])
    recent_count = (
        PasswordResetToken.query.filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.created_at >= window_start,
        ).count()
    )
    if recent_count >= current_app.config["PASSWORD_RESET_REQUEST_LIMIT"]:
        record_auth_attempt(normalized, user, ip_address, None, success=False, failure_reason="reset_rate_limited")
        write_activity_log(
            actor_user_id=user.id,
            event_type="auth.password_reset_rate_limited",
            entity_table="users",
            entity_id=str(user.id),
            metadata={"email": user.email},
        )
        db.session.commit()
        return generic

    token = secrets.token_urlsafe(32)
    reset_row = PasswordResetToken(
        user_id=user.id,
        token_hash=_token_hash(token),
        expires_at=utc_now() + timedelta(minutes=current_app.config["PASSWORD_RESET_TTL_MINUTES"]),
        created_by_ip=ip_address,
    )
    db.session.add(reset_row)
    db.session.flush()
    enqueue_password_reset_email(user, token)
    write_activity_log(
        actor_user_id=user.id,
        event_type="auth.password_reset_requested",
        entity_table="users",
        entity_id=str(user.id),
        metadata={"email": user.email},
    )
    db.session.commit()
    return PasswordResetRequestResult(issued=True, token=token, user=user)


def reset_password_with_token(token: str, new_password: str) -> User:
    validate_new_password(new_password)
    token_row = PasswordResetToken.query.filter_by(token_hash=_token_hash(token)).first()
    if not token_row or token_row.used_at is not None or _coerce_utc(token_row.expires_at) <= utc_now():
        raise ValueError("Reset link is invalid or expired.")
    user = db.session.get(User, token_row.user_id)
    if not user or user.deleted_at is not None:
        raise ValueError("Reset link is invalid or expired.")
    update_user_password(user, new_password, actor_user_id=user.id)
    token_row.used_at = utc_now()
    user.force_password_reset = False
    user.account_state = "active"
    user.locked_until = None
    user.failed_login_count = 0
    user.last_failed_login_at = None
    revoke_all_user_sessions(user.id)
    write_activity_log(
        actor_user_id=user.id,
        event_type="auth.password_reset_completed",
        entity_table="users",
        entity_id=str(user.id),
        metadata={"email": user.email},
    )
    enqueue_password_reset_completed_email(user)
    db.session.commit()
    return user


def update_user_password(user: User, new_password: str, *, actor_user_id, allow_reuse: bool = False) -> None:
    validate_new_password(new_password)
    if not allow_reuse:
        ensure_password_not_reused(user, new_password)
    if user.password_hash:
        db.session.add(UserPasswordHistory(user_id=user.id, password_hash=user.password_hash))
    user.password_hash = hash_password(new_password)
    user.password_changed_at = utc_now()
    user.updated_by_user_id = actor_user_id
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="users",
        entity_id=str(user.id),
        action="password_changed",
        after_data={"password_changed_at": user.password_changed_at.isoformat()},
    )


def ensure_password_not_reused(user: User, new_password: str) -> None:
    hashes = [user.password_hash] + [item.password_hash for item in UserPasswordHistory.query.filter_by(user_id=user.id).order_by(UserPasswordHistory.created_at.desc()).limit(5).all()]
    for stored_hash in hashes:
        ok, _ = verify_password_hash(stored_hash, new_password)
        if ok:
            raise ValueError("Choose a new password that has not been used recently.")


def register_failed_login(user: User, identifier: str, ip_address: str | None, user_agent: str | None) -> None:
    now = utc_now()
    window_start = now - timedelta(minutes=current_app.config["LOGIN_LOCK_WINDOW_MINUTES"])
    if not user.last_failed_login_at or _coerce_utc(user.last_failed_login_at) < window_start:
        user.failed_login_count = 1
    else:
        user.failed_login_count += 1
    user.last_failed_login_at = now
    if user.failed_login_count >= current_app.config["LOGIN_LOCK_THRESHOLD"]:
        user.locked_until = now + timedelta(minutes=current_app.config["LOGIN_LOCK_DURATION_MINUTES"])
        write_activity_log(
            actor_user_id=user.id,
            event_type="auth.account_locked",
            entity_table="users",
            entity_id=str(user.id),
            metadata={"locked_until": user.locked_until.isoformat()},
        )
    record_auth_attempt(identifier, user, ip_address, user_agent, success=False, failure_reason="invalid_credentials")
    write_activity_log(
        actor_user_id=user.id,
        event_type="auth.login_failure",
        entity_table="users",
        entity_id=str(user.id),
        metadata={"reason": "invalid_credentials"},
    )
    db.session.commit()


def reset_failed_logins(user: User) -> None:
    user.failed_login_count = 0
    user.last_failed_login_at = None
    user.locked_until = None


def record_auth_attempt(identifier: str, user: User | None, ip_address: str | None, user_agent: str | None, *, success: bool, failure_reason: str | None) -> None:
    db.session.add(
        AuthAttempt(
            attempted_identifier=identifier[:255],
            user_id=user.id if user else None,
            ip_address=ip_address,
            user_agent=user_agent,
            success=success,
            failure_reason=failure_reason,
        )
    )


def ip_is_rate_limited(ip_address: str | None) -> bool:
    if not ip_address:
        return False
    window_start = utc_now() - timedelta(minutes=current_app.config["LOGIN_LOCK_WINDOW_MINUTES"])
    failure_count = AuthAttempt.query.filter(
        AuthAttempt.ip_address == ip_address,
        AuthAttempt.success.is_(False),
        AuthAttempt.attempted_at >= window_start,
    ).count()
    return failure_count >= current_app.config["LOGIN_LOCK_THRESHOLD"] * 3


def create_totp_factor(user: User) -> tuple[MfaFactor, str]:
    factor = pending_mfa_factor(user)
    if factor:
        secret = decrypt_secret(factor.secret_encrypted)
        return factor, pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=current_app.config["MFA_ISSUER"])
    secret = pyotp.random_base32()
    factor = MfaFactor(
        user_id=user.id,
        factor_type="totp",
        secret_encrypted=encrypt_secret(secret),
        is_primary=True,
    )
    db.session.add(factor)
    db.session.flush()
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=current_app.config["MFA_ISSUER"])
    write_activity_log(
        actor_user_id=user.id,
        event_type="auth.mfa_enrollment_started",
        entity_table="users",
        entity_id=str(user.id),
        metadata={"factor_id": str(factor.id)},
    )
    db.session.commit()
    return factor, uri


def confirm_totp_enrollment(user: User, factor_id, code: str) -> list[str]:
    factor = db.session.get(MfaFactor, factor_id)
    if not factor or factor.user_id != user.id or factor.disabled_at is not None:
        raise ValueError("MFA setup is not available.")
    secret = decrypt_secret(factor.secret_encrypted)
    totp = pyotp.TOTP(secret)
    if not totp.verify(code, valid_window=current_app.config["MFA_VERIFY_WINDOW"]):
        raise ValueError("Invalid verification code.")
    factor.verified_at = utc_now()
    factor.last_used_at = utc_now()
    recovery_codes = regenerate_recovery_codes(factor)
    write_activity_log(
        actor_user_id=user.id,
        event_type="auth.mfa_enabled",
        entity_table="users",
        entity_id=str(user.id),
        metadata={"factor_id": str(factor.id)},
    )
    db.session.commit()
    return recovery_codes


def regenerate_recovery_codes(factor: MfaFactor) -> list[str]:
    MfaRecoveryCode.query.filter_by(mfa_factor_id=factor.id, used_at=None).delete()
    plaintext_codes: list[str] = []
    for _ in range(8):
        code = secrets.token_hex(4).upper()
        plaintext_codes.append(code)
        db.session.add(
            MfaRecoveryCode(
                mfa_factor_id=factor.id,
                code_hash=_token_hash(code),
            )
        )
    return plaintext_codes


def disable_mfa(user: User) -> None:
    factor = active_mfa_factor(user)
    if not factor:
        return
    factor.disabled_at = utc_now()
    revoke_all_user_sessions(user.id)
    write_audit_log(
        actor_user_id=user.id,
        entity_table="users",
        entity_id=str(user.id),
        action="mfa_disabled",
        before_data={"factor_id": str(factor.id), "disabled_at": None},
        after_data={"factor_id": str(factor.id), "disabled_at": factor.disabled_at.isoformat()},
    )
    write_activity_log(
        actor_user_id=user.id,
        event_type="auth.mfa_disabled",
        entity_table="users",
        entity_id=str(user.id),
        metadata={"factor_id": str(factor.id)},
    )
    db.session.commit()


def verify_mfa_for_session(auth_session: UserSession, code: str) -> tuple[UserSession, str]:
    user = db.session.get(User, auth_session.user_id)
    factor = active_mfa_factor(user)
    if not factor:
        raise ValueError("MFA is not configured for this account.")
    if mfa_is_rate_limited(user):
        record_auth_attempt(user.email, user, auth_session.ip_address, auth_session.user_agent, success=False, failure_reason="mfa_failed")
        write_activity_log(
            actor_user_id=user.id,
            event_type="auth.mfa_failure",
            entity_table="users",
            entity_id=str(user.id),
            metadata={"reason": "rate_limited"},
        )
        db.session.commit()
        raise ValueError("Too many MFA attempts. Please sign in again.")
    secret = decrypt_secret(factor.secret_encrypted)
    totp = pyotp.TOTP(secret)
    if totp.verify(code, valid_window=current_app.config["MFA_VERIFY_WINDOW"]):
        factor.last_used_at = utc_now()
        record_auth_attempt(user.email, user, auth_session.ip_address, auth_session.user_agent, success=True, failure_reason=None)
        write_activity_log(
            actor_user_id=user.id,
            event_type="auth.mfa_verified",
            entity_table="users",
            entity_id=str(user.id),
            metadata={"factor_id": str(factor.id)},
        )
        return rotate_session_after_mfa(auth_session)

    recovery_row = MfaRecoveryCode.query.filter_by(mfa_factor_id=factor.id, code_hash=_token_hash(code.strip().upper()), used_at=None).first()
    if recovery_row:
        recovery_row.used_at = utc_now()
        record_auth_attempt(user.email, user, auth_session.ip_address, auth_session.user_agent, success=True, failure_reason=None)
        write_activity_log(
            actor_user_id=user.id,
            event_type="auth.mfa_recovery_used",
            entity_table="users",
            entity_id=str(user.id),
            metadata={"factor_id": str(factor.id)},
        )
        return rotate_session_after_mfa(auth_session)
    record_auth_attempt(user.email, user, auth_session.ip_address, auth_session.user_agent, success=False, failure_reason="mfa_failed")
    write_activity_log(
        actor_user_id=user.id,
        event_type="auth.mfa_failure",
        entity_table="users",
        entity_id=str(user.id),
        metadata={"reason": "invalid_code"},
    )
    db.session.commit()
    raise ValueError("Invalid verification code.")


def create_staff_user(
    *,
    email: str,
    full_name: str,
    role_codes: list[str],
    actor_user_id,
) -> User:
    normalized_email = normalize_identifier(email)
    if not normalized_email or "@" not in normalized_email:
        raise ValueError("A valid email is required.")
    if User.query.filter(sa.func.lower(User.email) == normalized_email).first():
        raise ValueError("A user with that email already exists.")
    from ..models import Role

    selected_roles = Role.query.filter(Role.code.in_(role_codes)).all()
    if len(selected_roles) != len(role_codes):
        raise ValueError("One or more selected roles are invalid.")
    temporary_password = secrets.token_urlsafe(18)
    user = User(
        username=normalized_email.split("@", 1)[0],
        email=normalized_email,
        full_name=full_name.strip(),
        password_hash=hash_password(temporary_password),
        is_active=True,
        account_state="password_reset_required",
        force_password_reset=True,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    user.roles = selected_roles
    db.session.add(user)
    db.session.flush()
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="users",
        entity_id=str(user.id),
        action="user_created",
        after_data={"email": user.email, "roles": role_codes, "account_state": user.account_state},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="auth.user_created",
        entity_table="users",
        entity_id=str(user.id),
        metadata={"email": user.email, "roles": role_codes},
    )
    db.session.commit()
    request_password_reset(user.email, ip_address=None)
    return user


def update_staff_user(
    user_id,
    *,
    full_name: str,
    role_codes: list[str],
    is_active: bool,
    account_state: str,
    actor_user_id,
) -> User:
    from ..models import Role

    user = db.session.get(User, user_id)
    if not user or user.deleted_at is not None:
        raise ValueError("User not found.")
    selected_roles = Role.query.filter(Role.code.in_(role_codes)).all()
    if len(selected_roles) != len(role_codes):
        raise ValueError("One or more selected roles are invalid.")
    before_data = {
        "full_name": user.full_name,
        "roles": [role.code for role in user.roles],
        "is_active": user.is_active,
        "account_state": user.account_state,
    }
    user.full_name = full_name.strip()
    user.roles = selected_roles
    user.is_active = is_active
    user.account_state = account_state
    user.updated_by_user_id = actor_user_id
    if account_state == "locked":
        user.locked_until = utc_now() + timedelta(days=3650)
    elif account_state != "locked":
        user.locked_until = None
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="users",
        entity_id=str(user.id),
        action="user_updated",
        before_data=before_data,
        after_data={
            "full_name": user.full_name,
            "roles": [role.code for role in user.roles],
            "is_active": user.is_active,
            "account_state": user.account_state,
        },
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="auth.user_updated",
        entity_table="users",
        entity_id=str(user.id),
        metadata={"roles": [role.code for role in user.roles], "account_state": user.account_state},
    )
    db.session.commit()
    return user


def admin_issue_password_reset(user_id, *, actor_user_id) -> User:
    user = db.session.get(User, user_id)
    if not user or user.deleted_at is not None:
        raise ValueError("User not found.")
    user.force_password_reset = True
    user.account_state = "password_reset_required"
    user.updated_by_user_id = actor_user_id
    request_password_reset(user.email, ip_address=None)
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="users",
        entity_id=str(user.id),
        action="admin_password_reset_issued",
        after_data={"force_password_reset": True, "account_state": user.account_state},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="auth.admin_password_reset_issued",
        entity_table="users",
        entity_id=str(user.id),
        metadata={"email": user.email},
    )
    db.session.commit()
    return user


def admin_disable_mfa(user_id, *, actor_user_id) -> User:
    user = db.session.get(User, user_id)
    if not user or user.deleted_at is not None:
        raise ValueError("User not found.")
    factor = active_mfa_factor(user)
    if not factor:
        raise ValueError("User does not have active MFA.")
    factor.disabled_at = utc_now()
    revoke_all_user_sessions(user.id)
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table="users",
        entity_id=str(user.id),
        action="admin_mfa_disabled",
        before_data={"factor_id": str(factor.id), "disabled_at": None},
        after_data={"factor_id": str(factor.id), "disabled_at": factor.disabled_at.isoformat()},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="auth.admin_mfa_disabled",
        entity_table="users",
        entity_id=str(user.id),
        metadata={"factor_id": str(factor.id), "target_user_id": str(user.id)},
    )
    db.session.commit()
    return user


def enqueue_password_reset_email(user: User, token: str) -> EmailOutbox:
    reset_url = f"{current_app.config['APP_BASE_URL'].rstrip('/')}/staff/reset-password/{token}"
    entry = EmailOutbox(
        email_type="password_reset",
        reservation_id=None,
        recipient_email=user.email,
        subject="Sandbox Hotel PMS password reset",
        body_text="\n".join(
            [
                f"Hello {user.full_name},",
                "",
                "A password reset was requested for your Sandbox Hotel PMS account.",
                f"Reset link: {reset_url}",
                f"This link expires in {current_app.config['PASSWORD_RESET_TTL_MINUTES']} minutes.",
            ]
        ),
        language="en",
        dedupe_key=f"password_reset:{user.id}:{utc_now().strftime('%Y%m%d%H%M%S%f')}",
        status="pending",
    )
    db.session.add(entry)
    return entry


def enqueue_password_reset_completed_email(user: User) -> EmailOutbox:
    entry = EmailOutbox(
        email_type="password_reset_completed",
        reservation_id=None,
        recipient_email=user.email,
        subject="Sandbox Hotel PMS password changed",
        body_text="\n".join(
            [
                f"Hello {user.full_name},",
                "",
                "Your Sandbox Hotel PMS password was changed successfully.",
                "If you did not perform this change, contact an administrator immediately.",
            ]
        ),
        language="en",
        dedupe_key=f"password_reset_completed:{user.id}:{utc_now().strftime('%Y%m%d%H%M%S%f')}",
        status="pending",
    )
    db.session.add(entry)
    return entry


def encrypt_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode("utf-8")).decode("utf-8")


def decrypt_secret(encrypted: str) -> str:
    return _fernet().decrypt(encrypted.encode("utf-8")).decode("utf-8")


def _fernet() -> Fernet:
    raw = current_app.config.get("AUTH_ENCRYPTION_KEY") or ""
    if raw:
        key = raw.encode("utf-8")
    else:
        if str(current_app.config.get("APP_ENV") or "development").lower() in {"staging", "production"}:
            raise RuntimeError("AUTH_ENCRYPTION_KEY must be configured outside development and test environments.")
        digest = hashlib.sha256(current_app.config["SECRET_KEY"].encode("utf-8")).digest()
        key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def _token_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def mfa_is_rate_limited(user: User) -> bool:
    window_start = utc_now() - timedelta(minutes=current_app.config["LOGIN_LOCK_WINDOW_MINUTES"])
    failure_count = AuthAttempt.query.filter(
        AuthAttempt.user_id == user.id,
        AuthAttempt.success.is_(False),
        AuthAttempt.failure_reason == "mfa_failed",
        AuthAttempt.attempted_at >= window_start,
    ).count()
    return failure_count >= current_app.config["LOGIN_LOCK_THRESHOLD"]


def _coerce_utc(value: datetime | None) -> datetime:
    if value is None:
        return utc_now()
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
