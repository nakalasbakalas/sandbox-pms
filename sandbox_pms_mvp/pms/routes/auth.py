"""Auth routes blueprint — login, logout, MFA, password reset, security."""
from __future__ import annotations

from uuid import UUID

from flask import Blueprint, abort, flash, g, redirect, render_template, request, session, url_for

from ..activity import write_activity_log
from ..extensions import db
from ..helpers import (
    current_user,
    default_dashboard_url,
    require_user,
    rotate_csrf_token,
)
from ..models import UserSession
from ..security import public_error_message
from ..services.auth_service import (
    active_mfa_factor,
    confirm_totp_enrollment,
    create_totp_factor,
    disable_mfa,
    login_with_password,
    pending_mfa_factor,
    request_password_reset,
    reset_password_with_token,
    revoke_all_user_sessions,
    revoke_session,
    update_user_password,
    verify_mfa_for_session,
    verify_password_hash,
)

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/staff/login", methods=["GET", "POST"])
def staff_login():
    if request.method == "POST":
        identifier = (request.form.get("email") or request.form.get("username") or "").strip().lower()
        password = request.form.get("password", "")
        result = login_with_password(
            identifier,
            password,
            ip_address=request.remote_addr,
            user_agent=request.user_agent.string,
        )
        if result.success:
            session.clear()
            rotate_csrf_token()
            g.auth_cookie_value = result.cookie_value
            if result.requires_mfa:
                flash("Multi-factor verification is required.", "info")
                return redirect(url_for("auth.staff_mfa_verify"))
            return redirect(default_dashboard_url(result.user))
        return render_template("staff_login.html", error=result.error), 401
    return render_template("staff_login.html")


@auth_bp.route("/staff/logout", methods=["POST"])
def staff_logout():
    user = current_user()
    if user:
        write_activity_log(
            actor_user_id=user.id,
            event_type="auth.logout",
            entity_table="users",
            entity_id=str(user.id),
        )
    if getattr(g, "current_auth_session", None):
        revoke_session(g.current_auth_session)
        db.session.commit()
    session.clear()
    rotate_csrf_token()
    g.clear_auth_cookie = True
    return redirect(url_for("index"))


@auth_bp.route("/staff/forgot-password", methods=["GET", "POST"])
def staff_forgot_password():
    if request.method == "POST":
        request_password_reset(request.form.get("identifier", ""), ip_address=request.remote_addr)
        flash("If the account exists, a reset link has been sent.", "success")
        return redirect(url_for("auth.staff_login"))
    return render_template("staff_forgot_password.html")


@auth_bp.route("/staff/reset-password/<token>", methods=["GET", "POST"])
def staff_reset_password(token):
    if request.method == "POST":
        try:
            reset_password_with_token(token, request.form.get("password", ""))
            session.clear()
            rotate_csrf_token()
            g.clear_auth_cookie = True
            flash("Password updated. Please sign in.", "success")
            return redirect(url_for("auth.staff_login"))
        except Exception as exc:  # noqa: BLE001
            return render_template("staff_reset_password.html", error=public_error_message(exc), token=token), 400
    return render_template("staff_reset_password.html", token=token)


@auth_bp.route("/staff/mfa/verify", methods=["GET", "POST"])
def staff_mfa_verify():
    if not getattr(g, "current_auth_session", None) or not getattr(g, "pending_mfa_user", None):
        return redirect(url_for("auth.staff_login"))
    if request.method == "POST":
        try:
            _, cookie_value = verify_mfa_for_session(g.current_auth_session, request.form.get("code", ""))
            session.clear()
            rotate_csrf_token()
            g.auth_cookie_value = cookie_value
            flash("Multi-factor verification complete.", "success")
            return redirect(default_dashboard_url(g.pending_mfa_user))
        except Exception as exc:  # noqa: BLE001
            return render_template("staff_mfa_verify.html", error=public_error_message(exc)), 400
    return render_template("staff_mfa_verify.html", user=g.pending_mfa_user)


@auth_bp.route("/staff/security", methods=["GET", "POST"])
def staff_security():
    user = require_user()
    recovery_codes: list[str] | None = None
    provisioning_uri = None
    factor = active_mfa_factor(user)
    pending_factor = pending_mfa_factor(user)
    if request.method == "POST":
        action = request.form.get("action")
        try:
            if action == "change_password":
                current_password = request.form.get("current_password", "")
                new_password = request.form.get("new_password", "")
                ok, _ = verify_password_hash(user.password_hash, current_password)
                if not ok and not user.force_password_reset:
                    raise ValueError("Current password is incorrect.")
                update_user_password(user, new_password, actor_user_id=user.id)
                user.force_password_reset = False
                user.account_state = "active"
                revoke_all_user_sessions(user.id, except_session_id=g.current_auth_session.id if getattr(g, "current_auth_session", None) else None)
                if getattr(g, "current_auth_session", None):
                    revoke_session(g.current_auth_session)
                db.session.commit()
                result = login_with_password(user.email, new_password, ip_address=request.remote_addr, user_agent=request.user_agent.string)
                session.clear()
                rotate_csrf_token()
                g.auth_cookie_value = result.cookie_value
                if result.requires_mfa:
                    flash("Password updated. Please complete multi-factor verification.", "info")
                    return redirect(url_for("auth.staff_mfa_verify"))
                flash("Password updated.", "success")
                return redirect(url_for("auth.staff_security"))
            if action == "start_mfa":
                pending_factor, provisioning_uri = create_totp_factor(user)
            elif action == "confirm_mfa":
                recovery_codes = confirm_totp_enrollment(user, UUID(request.form["factor_id"]), request.form.get("code", ""))
                factor = active_mfa_factor(user)
            elif action == "disable_mfa":
                disable_mfa(user)
                factor = None
                pending_factor = None
                flash("MFA disabled.", "success")
            elif action == "revoke_session":
                target = db.session.get(UserSession, UUID(request.form["session_id"]))
                if target and target.user_id == user.id:
                    revoke_session(target)
                    db.session.commit()
                    flash("Session revoked.", "success")
            else:
                abort(400)
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
    sessions = (
        UserSession.query.filter_by(user_id=user.id)
        .order_by(UserSession.created_at.desc())
        .all()
    )
    return render_template(
        "staff_security.html",
        user=user,
        factor=factor,
        pending_factor=pending_factor,
        sessions=sessions,
        recovery_codes=recovery_codes,
        provisioning_uri=provisioning_uri,
    )
