from __future__ import annotations

import hmac
import secrets
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import sqlalchemy as sa
from flask import Flask, abort, flash, g, jsonify, redirect, render_template, request, session, url_for
from markupsafe import Markup

from .activity import write_activity_log
from .config import Config
from .constants import (
    BLACKOUT_TYPES,
    BOOKING_SOURCE_CHANNELS,
    INVENTORY_OVERRIDE_ACTIONS,
    INVENTORY_OVERRIDE_SCOPE_TYPES,
    NOTIFICATION_TEMPLATE_KEYS,
    POLICY_DOCUMENT_CODES,
    RATE_ADJUSTMENT_TYPES,
    RATE_RULE_TYPES,
    RESERVATION_STATUSES,
    REVIEW_QUEUE_STATUSES,
    ROLE_SEEDS,
    ROOM_NOTE_TYPES,
    ROOM_OPERATIONAL_STATUSES,
    USER_ACCOUNT_STATES,
)
from .extensions import db, migrate
from .i18n import LANGUAGE_LABELS, normalize_language, t
from .models import (
    ActivityLog,
    AppSetting,
    AuditLog,
    BlackoutPeriod,
    CancellationRequest,
    EmailOutbox,
    InventoryOverride,
    MfaFactor,
    NotificationDelivery,
    NotificationTemplate,
    PaymentRequest,
    Permission,
    PolicyDocument,
    Reservation,
    ReservationHold,
    ReservationReviewQueue,
    Role,
    RateRule,
    Room,
    RoomType,
    StaffNotification,
    User,
    UserSession,
)
from .pricing import get_setting_value
from .security import configure_app_security, public_error_message
from .seeds import bootstrap_inventory_horizon, seed_all
from .settings import NOTIFICATION_TEMPLATE_PLACEHOLDERS
from .services.admin_service import (
    BlackoutPayload,
    InventoryOverridePayload,
    NotificationTemplatePayload,
    PolicyPayload,
    RateRulePayload,
    RoomPayload,
    RoomTypePayload,
    create_inventory_override,
    preview_notification_template,
    query_audit_entries,
    release_inventory_override,
    summarize_audit_entry,
    update_role_permissions,
    upsert_blackout_period,
    upsert_notification_template,
    upsert_policy_document,
    upsert_rate_rule,
    upsert_room,
    upsert_room_type,
    upsert_setting,
    upsert_settings_bundle,
)
from .services.auth_service import (
    active_mfa_factor,
    admin_disable_mfa,
    admin_issue_password_reset,
    confirm_totp_enrollment,
    create_staff_user,
    create_totp_factor,
    disable_mfa,
    load_session_from_cookie,
    login_with_password,
    pending_mfa_factor,
    request_password_reset,
    reset_password_with_token,
    revoke_all_user_sessions,
    revoke_session,
    update_staff_user,
    update_user_password,
    verify_mfa_for_session,
    verify_password_hash,
)
from .services.cashier_service import (
    DocumentIssuePayload,
    ManualAdjustmentPayload,
    PaymentPostingPayload,
    RefundPostingPayload,
    VoidChargePayload,
    cashier_print_context,
    ensure_room_charges_posted,
    get_cashier_detail,
    issue_cashier_document,
    post_manual_adjustment,
    record_payment,
    record_refund,
    void_folio_charge,
)
from .services.communication_service import (
    communication_settings_context,
    dispatch_notification_deliveries,
    query_notification_history,
    send_due_failed_payment_reminders,
    send_due_pre_arrival_reminders,
)
from .services.front_desk_service import (
    CheckInPayload,
    CheckoutPayload,
    FrontDeskFilters,
    NoShowPayload,
    WalkInCheckInPayload,
    complete_check_in,
    complete_checkout,
    create_walk_in_and_check_in,
    get_front_desk_detail,
    list_front_desk_workspace,
    prepare_checkout,
    process_no_show,
)
from .services.housekeeping_service import (
    BlockRoomPayload,
    BulkHousekeepingPayload,
    HousekeepingBoardFilters,
    MaintenanceFlagPayload,
    RoomNotePayload as HousekeepingRoomNotePayload,
    RoomStatusUpdatePayload,
    add_room_note as add_housekeeping_room_note,
    bulk_update_housekeeping,
    get_housekeeping_room_detail,
    list_housekeeping_board,
    set_blocked_state,
    set_maintenance_flag,
    update_housekeeping_status,
)
from .services.payment_integration_service import (
    create_or_reuse_deposit_request,
    handle_public_payment_start,
    load_public_payment_return,
    payments_enabled,
    process_payment_webhook,
    resend_payment_link,
    sync_payment_request_status,
)
from .services.public_booking_service import (
    HoldRequestPayload,
    PublicBookingPayload,
    PublicSearchPayload,
    VerificationRequestPayload,
    confirm_public_booking,
    create_reservation_hold,
    load_public_confirmation,
    search_public_availability,
    submit_cancellation_request,
    submit_modification_request,
)
from .services.reporting_service import build_manager_dashboard
from .services.staff_reservations_service import (
    GuestUpdatePayload,
    ReservationNotePayload,
    ReservationWorkspaceFilters,
    StayDateChangePayload,
    add_reservation_note,
    assign_room,
    cancel_reservation_workspace,
    change_stay_dates,
    get_reservation_detail,
    list_arrivals,
    list_departures,
    list_in_house,
    list_reservations,
    resend_confirmation,
    update_guest_details,
)


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__, template_folder="../templates", static_folder="../static")
    app.config.from_object(Config)
    if test_config:
        app.config.update(test_config)
    configure_app_security(app)
    db.init_app(app)
    migrate.init_app(app, db)

    register_template_helpers(app)
    register_auth_hooks(app)
    register_cli(app)
    register_routes(app)

    with app.app_context():
        if app.config["AUTO_BOOTSTRAP_SCHEMA"] and app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite"):
            db.create_all()
            if app.config["AUTO_SEED_REFERENCE_DATA"]:
                seed_all(app.config["INVENTORY_BOOTSTRAP_DAYS"])
    return app


def register_auth_hooks(app: Flask) -> None:
    @app.before_request
    def load_authenticated_staff_session() -> None:
        validate_csrf_request()
        g.current_staff_user = None
        g.pending_mfa_user = None
        g.current_auth_session = None
        g.auth_cookie_value = None
        g.clear_auth_cookie = False

        cookie_value = request.cookies.get(app.config["AUTH_COOKIE_NAME"])
        auth_session, user = load_session_from_cookie(cookie_value)
        if auth_session:
            g.current_auth_session = auth_session
            if auth_session.mfa_completed_at is not None:
                g.current_staff_user = user
            else:
                g.pending_mfa_user = user
        elif cookie_value:
            g.clear_auth_cookie = True

        if g.pending_mfa_user:
            allowed_endpoints = {
                "staff_mfa_verify",
                "staff_logout",
                "static",
            }
            if request.endpoint not in allowed_endpoints:
                return redirect(url_for("staff_mfa_verify"))

        if g.current_staff_user and (g.current_staff_user.force_password_reset or g.current_staff_user.account_state == "password_reset_required"):
            allowed_endpoints = {
                "staff_security",
                "staff_logout",
                "staff_mfa_verify",
                "static",
            }
            if request.endpoint not in allowed_endpoints:
                flash("Password reset is required before continuing.", "warning")
                return redirect(url_for("staff_security"))

        if g.current_staff_user and request.endpoint in {"staff_login", "staff_forgot_password", "staff_reset_password"}:
            return redirect(url_for("staff_dashboard"))

    @app.after_request
    def persist_auth_cookie(response):
        if getattr(g, "auth_cookie_value", None):
            response.set_cookie(
                app.config["AUTH_COOKIE_NAME"],
                g.auth_cookie_value,
                httponly=app.config["AUTH_COOKIE_HTTPONLY"],
                secure=app.config["AUTH_COOKIE_SECURE"],
                samesite=app.config["AUTH_COOKIE_SAMESITE"],
                path="/",
            )
        elif getattr(g, "clear_auth_cookie", False):
            response.delete_cookie(app.config["AUTH_COOKIE_NAME"], path="/")

        if getattr(g, "current_auth_session", None):
            db.session.commit()
        return response


def register_template_helpers(app: Flask) -> None:
    @app.template_filter("money")
    def money_filter(value) -> str:
        return f"{Decimal(value or 0):,.2f}"

    @app.context_processor
    def inject_globals():
        language = current_language()
        hotel_name = str(get_setting_value("hotel.name", "Sandbox Hotel"))
        hotel_currency = str(get_setting_value("hotel.currency", "THB"))
        hotel_brand_mark = str(get_setting_value("hotel.brand_mark", "SBX"))
        hotel_logo_url = str(get_setting_value("hotel.logo_url", "") or "")
        hotel_contact_phone = str(get_setting_value("hotel.contact_phone", "+66 000 000 000"))
        hotel_contact_email = str(get_setting_value("hotel.contact_email", "reservations@sandbox-hotel.local"))
        hotel_address = str(get_setting_value("hotel.address", "Sandbox Hotel"))
        hotel_check_in_time = str(get_setting_value("hotel.check_in_time", "14:00"))
        hotel_check_out_time = str(get_setting_value("hotel.check_out_time", "11:00"))
        return {
            "hotel_name": hotel_name,
            "currency": hotel_currency,
            "hotel_brand_mark": hotel_brand_mark,
            "hotel_logo_url": hotel_logo_url,
            "hotel_contact_phone": hotel_contact_phone,
            "hotel_contact_email": hotel_contact_email,
            "hotel_address": hotel_address,
            "hotel_check_in_time": hotel_check_in_time,
            "hotel_check_out_time": hotel_check_out_time,
            "staff_logged_in": current_user() is not None,
            "current_staff_user": current_user(),
            "current_language": language,
            "language_labels": LANGUAGE_LABELS,
            "t": lambda key, **kwargs: t(language, key, **kwargs),
            "can": can,
            "admin_sections": available_admin_sections(),
            "csrf_token": ensure_csrf_token,
            "csrf_input": lambda: Markup(
                f'<input type="hidden" name="csrf_token" value="{ensure_csrf_token()}">'
            ),
        }


def register_cli(app: Flask) -> None:
    @app.cli.command("seed-phase2")
    def seed_phase2_command() -> None:
        seed_all(app.config["INVENTORY_BOOTSTRAP_DAYS"])
        print("Phase 2 seed completed.")

    @app.cli.command("bootstrap-inventory")
    def bootstrap_inventory_command() -> None:
        bootstrap_inventory_horizon(date.today(), app.config["INVENTORY_BOOTSTRAP_DAYS"])
        db.session.commit()
        print("Inventory horizon bootstrapped.")

    @app.cli.command("process-notifications")
    def process_notifications_command() -> None:
        result = dispatch_notification_deliveries()
        print(f"Notifications processed: {result}")

    @app.cli.command("send-pre-arrival-reminders")
    def send_pre_arrival_reminders_command() -> None:
        result = send_due_pre_arrival_reminders(actor_user_id=None)
        print(f"Pre-arrival reminders: {result}")

    @app.cli.command("send-failed-payment-reminders")
    def send_failed_payment_reminders_command() -> None:
        result = send_due_failed_payment_reminders(actor_user_id=None)
        print(f"Failed payment reminders: {result}")


def register_routes(app: Flask) -> None:
    @app.route("/")
    def index():
        upcoming = (
            Reservation.query.filter(Reservation.created_from_public_booking_flow.is_(True))
            .order_by(Reservation.booked_at.desc())
            .limit(5)
            .all()
        )
        return render_template("index.html", upcoming=upcoming, room_types=RoomType.query.order_by(RoomType.code.asc()).all())

    @app.route("/health")
    def health():
        return jsonify({"status": "ok"})

    @app.route("/availability")
    def availability():
        language = current_language()
        form_data = {
            "check_in": request.args.get("check_in", ""),
            "check_out": request.args.get("check_out", ""),
            "adults": request.args.get("adults", "2"),
            "children": request.args.get("children", "0"),
            "room_type_id": request.args.get("room_type_id", ""),
            "language": language,
        }
        results: list[dict] = []
        error = None
        if form_data["check_in"] and form_data["check_out"]:
            try:
                payload = PublicSearchPayload(
                    check_in_date=date.fromisoformat(form_data["check_in"]),
                    check_out_date=date.fromisoformat(form_data["check_out"]),
                    adults=int(form_data["adults"]),
                    children=int(form_data["children"]),
                    room_type_id=UUID(form_data["room_type_id"]) if form_data["room_type_id"] else None,
                    language=language,
                )
                results = search_public_availability(payload)
            except Exception as exc:  # noqa: BLE001
                error = public_error_message(exc)
        return render_template("availability.html", results=results, form_data=form_data, error=error, room_types=RoomType.query.order_by(RoomType.code.asc()).all())

    @app.route("/booking/hold", methods=["POST"])
    def booking_hold():
        language = normalize_language(request.form.get("language"))
        try:
            hold = create_reservation_hold(
                HoldRequestPayload(
                    check_in_date=date.fromisoformat(request.form["check_in_date"]),
                    check_out_date=date.fromisoformat(request.form["check_out_date"]),
                    adults=int(request.form["adults"]),
                    children=int(request.form.get("children", 0)),
                    room_type_id=UUID(request.form["room_type_id"]),
                    guest_email=request.form.get("email"),
                    idempotency_key=request.form["idempotency_key"],
                    language=language,
                    source_channel=request.form.get("source_channel", "direct_web"),
                    source_metadata=source_metadata_from_request(language),
                    request_ip=request.remote_addr,
                    user_agent=request.user_agent.string,
                    extra_guests=int(request.form.get("extra_guests", 0)),
                )
            )
            room_type = db.session.get(RoomType, hold.room_type_id)
            return render_template("public_booking_form.html", hold=hold, room_type=room_type, settings=current_settings())
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
            return redirect(
                url_for(
                    "availability",
                    check_in=request.form.get("check_in_date"),
                    check_out=request.form.get("check_out_date"),
                    adults=request.form.get("adults"),
                    children=request.form.get("children", 0),
                    room_type_id=request.form.get("room_type_id"),
                    lang=language,
                )
            )

    @app.route("/booking/confirm", methods=["POST"])
    def booking_confirm():
        language = normalize_language(request.form.get("language"))
        try:
            reservation = confirm_public_booking(
                PublicBookingPayload(
                    hold_code=request.form["hold_code"],
                    idempotency_key=request.form["idempotency_key"],
                    first_name=request.form["first_name"].strip(),
                    last_name=request.form["last_name"].strip(),
                    phone=request.form["phone"].strip(),
                    email=request.form["email"].strip(),
                    special_requests=request.form.get("special_requests"),
                    language=language,
                    source_channel=request.form.get("source_channel", "direct_web"),
                    source_metadata=source_metadata_from_request(language),
                    terms_accepted=request.form.get("accept_terms") == "on",
                    terms_version=(
                        request.form.get("terms_version")
                        or current_settings().get("booking.terms_version", {}).get("value", "2026-03")
                    ),
                )
            )
            if payments_enabled() and Decimal(str(reservation.deposit_required_amount or "0.00")) > Decimal("0.00"):
                try:
                    create_or_reuse_deposit_request(
                        reservation.id,
                        actor_user_id=None,
                        send_email=True,
                        language=language,
                        source="public_confirmation",
                    )
                except Exception:  # noqa: BLE001
                    pass
            return redirect(
                url_for(
                    "booking_confirmation",
                    reservation_code=reservation.reservation_code,
                    token=reservation.public_confirmation_token,
                )
            )
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
            hold = ReservationHold.query.filter_by(hold_code=request.form.get("hold_code")).first()
            if not hold:
                return redirect(url_for("availability", lang=language))
            room_type = db.session.get(RoomType, hold.room_type_id)
            return render_template("public_booking_form.html", hold=hold, room_type=room_type, settings=current_settings())

    @app.route("/booking/confirmation/<reservation_code>")
    def booking_confirmation(reservation_code):
        reservation = load_public_confirmation(reservation_code, request.args.get("token", ""))
        if not reservation:
            abort(404)
        payment_request = (
            PaymentRequest.query.filter_by(reservation_id=reservation.id)
            .order_by(PaymentRequest.created_at.desc())
            .first()
        )
        return render_template(
            "public_confirmation.html",
            reservation=reservation,
            guest=reservation.primary_guest,
            payment_request=payment_request,
        )

    @app.route("/payments/request/<request_code>")
    def public_payment_start(request_code):
        try:
            payment_request = handle_public_payment_start(
                request_code,
                request.args.get("reservation_code", ""),
                request.args.get("token", ""),
            )
        except LookupError:
            abort(404)
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
            return redirect(url_for("index", lang=current_language()))
        return redirect(payment_request.payment_url)

    @app.route("/payments/return/<request_code>")
    def public_payment_return(request_code):
        try:
            context = load_public_payment_return(
                request_code,
                request.args.get("reservation_code", ""),
                request.args.get("token", ""),
            )
        except LookupError:
            abort(404)
        return render_template("public_payment_return.html", **context)

    @app.route("/webhooks/payments/<provider_name>", methods=["POST"])
    def payment_webhook(provider_name):
        try:
            result = process_payment_webhook(provider_name, request.get_data(), dict(request.headers))
        except Exception as exc:  # noqa: BLE001
            write_activity_log(
                actor_user_id=None,
                event_type="payment.webhook_failed",
                entity_table="payment_events",
                entity_id=provider_name,
                metadata={"provider": provider_name, "error": str(exc)[:255]},
            )
            return jsonify({"status": "error"}), 400
        return jsonify({"status": "ok", **result})

    @app.route("/booking/cancel", methods=["GET", "POST"])
    def booking_cancel_request():
        request_row = None
        if request.method == "POST":
            payload = VerificationRequestPayload(
                booking_reference=request.form["booking_reference"].strip(),
                contact_value=request.form["contact_value"].strip(),
                language=current_language(),
                reason=request.form.get("reason"),
                request_ip=request.remote_addr,
                user_agent=request.user_agent.string,
            )
            request_row = submit_cancellation_request(payload)
            flash(t(current_language(), "cancellation_received"), "success")
        return render_template("public_cancel_request.html", request_row=request_row)

    @app.route("/booking/modify", methods=["GET", "POST"])
    def booking_modify_request():
        request_row = None
        if request.method == "POST":
            payload = VerificationRequestPayload(
                booking_reference=request.form["booking_reference"].strip(),
                contact_value=request.form["contact_value"].strip(),
                language=current_language(),
                requested_changes={
                    "requested_check_in": request.form.get("requested_check_in"),
                    "requested_check_out": request.form.get("requested_check_out"),
                    "requested_adults": request.form.get("requested_adults"),
                    "requested_children": request.form.get("requested_children"),
                    "contact_correction": request.form.get("contact_correction"),
                    "special_requests": request.form.get("special_requests"),
                },
                request_ip=request.remote_addr,
                user_agent=request.user_agent.string,
            )
            request_row = submit_modification_request(payload)
            flash(t(current_language(), "modification_received"), "success")
        return render_template("public_modify_request.html", request_row=request_row)

    @app.route("/staff/login", methods=["GET", "POST"])
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
                    return redirect(url_for("staff_mfa_verify"))
                return redirect(url_for("staff_dashboard"))
            return render_template("staff_login.html", error=result.error), 401
        return render_template("staff_login.html")

    @app.route("/staff/logout", methods=["POST"])
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

    @app.route("/staff/forgot-password", methods=["GET", "POST"])
    def staff_forgot_password():
        if request.method == "POST":
            request_password_reset(request.form.get("identifier", ""), ip_address=request.remote_addr)
            flash("If the account exists, a reset link has been sent.", "success")
            return redirect(url_for("staff_login"))
        return render_template("staff_forgot_password.html")

    @app.route("/staff/reset-password/<token>", methods=["GET", "POST"])
    def staff_reset_password(token):
        if request.method == "POST":
            try:
                reset_password_with_token(token, request.form.get("password", ""))
                session.clear()
                rotate_csrf_token()
                g.clear_auth_cookie = True
                flash("Password updated. Please sign in.", "success")
                return redirect(url_for("staff_login"))
            except Exception as exc:  # noqa: BLE001
                return render_template("staff_reset_password.html", error=public_error_message(exc), token=token), 400
        return render_template("staff_reset_password.html", token=token)

    @app.route("/staff/mfa/verify", methods=["GET", "POST"])
    def staff_mfa_verify():
        if not getattr(g, "current_auth_session", None) or not getattr(g, "pending_mfa_user", None):
            return redirect(url_for("staff_login"))
        if request.method == "POST":
            try:
                _, cookie_value = verify_mfa_for_session(g.current_auth_session, request.form.get("code", ""))
                session.clear()
                rotate_csrf_token()
                g.auth_cookie_value = cookie_value
                flash("Multi-factor verification complete.", "success")
                return redirect(url_for("staff_dashboard"))
            except Exception as exc:  # noqa: BLE001
                return render_template("staff_mfa_verify.html", error=public_error_message(exc)), 400
        return render_template("staff_mfa_verify.html", user=g.pending_mfa_user)

    @app.route("/staff/security", methods=["GET", "POST"])
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
                        return redirect(url_for("staff_mfa_verify"))
                    flash("Password updated.", "success")
                    return redirect(url_for("staff_security"))
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

    def permission_groups() -> dict[str, list[Permission]]:
        grouped: dict[str, list[Permission]] = {}
        permissions = Permission.query.order_by(Permission.module.asc(), Permission.code.asc()).all()
        for permission in permissions:
            grouped.setdefault(permission.module, []).append(permission)
        return grouped

    def property_settings_context() -> dict[str, str]:
        return {
            "hotel_name": str(get_setting_value("hotel.name", "Sandbox Hotel")),
            "brand_mark": str(get_setting_value("hotel.brand_mark", "SBX")),
            "logo_url": str(get_setting_value("hotel.logo_url", "") or ""),
            "contact_phone": str(get_setting_value("hotel.contact_phone", "+66 000 000 000")),
            "contact_email": str(get_setting_value("hotel.contact_email", "reservations@sandbox-hotel.local")),
            "address": str(get_setting_value("hotel.address", "")),
            "currency": str(get_setting_value("hotel.currency", "THB")),
            "check_in_time": str(get_setting_value("hotel.check_in_time", "14:00")),
            "check_out_time": str(get_setting_value("hotel.check_out_time", "11:00")),
            "tax_id": str(get_setting_value("hotel.tax_id", "") or ""),
        }

    def payment_settings_context() -> dict[str, object]:
        return {
            "active_provider": str(get_setting_value("payment.active_provider", "env") or "env"),
            "deposit_enabled": truthy_setting(get_setting_value("payment.deposit_enabled", True)),
            "link_expiry_minutes": str(
                get_setting_value("payment.link_expiry_minutes", app.config["PAYMENT_LINK_TTL_MINUTES"])
            ),
            "link_resend_cooldown_seconds": str(
                get_setting_value(
                    "payment.link_resend_cooldown_seconds",
                    app.config["PAYMENT_LINK_RESEND_COOLDOWN_SECONDS"],
                )
            ),
            "provider_runtime": app.config.get("PAYMENT_PROVIDER", "disabled"),
            "stripe_secret_configured": bool(app.config.get("STRIPE_SECRET_KEY")),
            "stripe_webhook_configured": bool(app.config.get("STRIPE_WEBHOOK_SECRET")),
        }

    def housekeeping_defaults_context() -> dict[str, object]:
        return {
            "require_inspected_for_ready": truthy_setting(
                get_setting_value("housekeeping.require_inspected_for_ready", False)
            ),
            "checkout_dirty_status": str(get_setting_value("housekeeping.checkout_dirty_status", "dirty")),
        }

    def policy_documents_context() -> dict[str, PolicyDocument | None]:
        documents = PolicyDocument.query.filter(PolicyDocument.deleted_at.is_(None)).all()
        return {item.code: item for item in documents}

    @app.route("/staff/admin")
    def staff_admin_dashboard():
        require_admin_workspace_access()
        return render_template(
            "admin.html",
            active_section="dashboard",
            room_type_count=RoomType.query.count(),
            room_count=Room.query.count(),
            active_override_count=InventoryOverride.query.filter_by(is_active=True).count(),
            active_blackout_count=BlackoutPeriod.query.filter_by(is_active=True).count(),
            policy_count=PolicyDocument.query.filter(PolicyDocument.deleted_at.is_(None)).count(),
            template_count=NotificationTemplate.query.filter(NotificationTemplate.deleted_at.is_(None)).count(),
            user_count=User.query.filter(User.deleted_at.is_(None)).count(),
            recent_audit=query_audit_entries(limit=12),
        )

    @app.route("/staff/admin/staff-access", methods=["GET", "POST"], endpoint="staff_admin_staff_access")
    @app.route("/staff/users", methods=["GET", "POST"])
    def staff_users():
        actor = require_permission("user.view")
        if request.method == "POST":
            action = request.form.get("action")
            try:
                if action == "create":
                    require_permission("user.create")
                    create_staff_user(
                        email=request.form.get("email", ""),
                        full_name=request.form.get("full_name", ""),
                        role_codes=request.form.getlist("role_codes"),
                        actor_user_id=actor.id,
                    )
                    flash("Staff account created. Password setup email queued.", "success")
                elif action == "update":
                    require_permission("user.edit")
                    update_staff_user(
                        UUID(request.form["user_id"]),
                        full_name=request.form.get("full_name", ""),
                        role_codes=request.form.getlist("role_codes"),
                        is_active=request.form.get("is_active") == "on",
                        account_state=request.form.get("account_state", "active"),
                        actor_user_id=actor.id,
                    )
                    flash("Staff account updated.", "success")
                elif action == "reset_password":
                    require_permission("auth.reset_password_admin")
                    admin_issue_password_reset(UUID(request.form["user_id"]), actor_user_id=actor.id)
                    flash("Password reset issued.", "success")
                elif action == "disable_mfa":
                    require_permission("auth.manage_mfa")
                    admin_disable_mfa(UUID(request.form["user_id"]), actor_user_id=actor.id)
                    flash("User MFA disabled and active sessions revoked.", "success")
                elif action == "role_permissions":
                    require_permission("user.edit")
                    require_admin_role(actor)
                    update_role_permissions(
                        UUID(request.form["role_id"]),
                        request.form.getlist("permission_codes"),
                        actor_user_id=actor.id,
                    )
                    flash("Role permissions updated.", "success")
                else:
                    abort(400)
            except Exception as exc:  # noqa: BLE001
                flash(public_error_message(exc), "error")
            return redirect(url_for("staff_users"))

        users = User.query.filter(User.deleted_at.is_(None)).order_by(User.full_name.asc()).all()
        roles = Role.query.order_by(Role.sort_order.asc()).all()
        recent_activity = ActivityLog.query.order_by(ActivityLog.created_at.desc()).limit(20).all()
        return render_template(
            "admin_staff_access.html",
            active_section="staff_access",
            users=users,
            roles=roles,
            recent_activity=recent_activity,
            account_states=USER_ACCOUNT_STATES,
            permission_groups=permission_groups(),
            is_super_admin=is_admin_user(actor),
        )

    @app.route("/staff/admin/property", methods=["GET", "POST"], endpoint="staff_admin_property")
    @app.route("/staff/settings", methods=["GET", "POST"])
    def staff_settings():
        require_permission("settings.view")
        if request.method == "POST":
            try:
                action = request.form.get("action") or "legacy_setting"
                if action == "legacy_setting":
                    actor = require_permission("settings.edit")
                    key = request.form.get("key", "")
                    setting = AppSetting.query.filter_by(key=key, deleted_at=None).first()
                    if not setting:
                        abort(404)
                    upsert_setting(
                        key,
                        value=request.form.get("value"),
                        value_type=setting.value_type,
                        description=setting.description,
                        is_public=setting.is_public,
                        sort_order=setting.sort_order,
                        actor_user_id=actor.id,
                    )
                    flash("Setting updated.", "success")
                elif action == "save_branding":
                    actor = require_permission("settings.edit")
                    upsert_settings_bundle(
                        [
                            {"key": "hotel.name", "value": request.form.get("hotel_name"), "value_type": "string", "description": "Hotel display name", "is_public": True, "sort_order": 10},
                            {"key": "hotel.brand_mark", "value": request.form.get("brand_mark"), "value_type": "string", "description": "Brand monogram", "is_public": True, "sort_order": 11},
                            {"key": "hotel.logo_url", "value": request.form.get("logo_url"), "value_type": "string", "description": "Hotel logo URL", "is_public": True, "sort_order": 12},
                            {"key": "hotel.contact_phone", "value": request.form.get("contact_phone"), "value_type": "string", "description": "Primary phone", "is_public": True, "sort_order": 13},
                            {"key": "hotel.contact_email", "value": request.form.get("contact_email"), "value_type": "string", "description": "Primary contact email", "is_public": True, "sort_order": 14},
                            {"key": "hotel.address", "value": request.form.get("address"), "value_type": "string", "description": "Property address", "is_public": True, "sort_order": 15},
                            {"key": "hotel.currency", "value": request.form.get("currency"), "value_type": "string", "description": "Hotel currency", "is_public": True, "sort_order": 16},
                            {"key": "hotel.check_in_time", "value": request.form.get("check_in_time"), "value_type": "string", "description": "Standard check-in time", "is_public": True, "sort_order": 17},
                            {"key": "hotel.check_out_time", "value": request.form.get("check_out_time"), "value_type": "string", "description": "Standard check-out time", "is_public": True, "sort_order": 18},
                            {"key": "hotel.tax_id", "value": request.form.get("tax_id"), "value_type": "string", "description": "Business tax identifier", "is_public": False, "sort_order": 19},
                        ],
                        actor_user_id=actor.id,
                    )
                    flash("Property identity updated.", "success")
                elif action == "room_type":
                    actor = require_permission("settings.edit")
                    upsert_room_type(
                        parse_optional_uuid(request.form.get("room_type_id")),
                        RoomTypePayload(
                            code=request.form.get("code", ""),
                            name=request.form.get("name", ""),
                            description=request.form.get("description"),
                            standard_occupancy=int(request.form.get("standard_occupancy", 1)),
                            max_occupancy=int(request.form.get("max_occupancy", 1)),
                            extra_bed_allowed=truthy_setting(request.form.get("extra_bed_allowed")),
                            is_active=truthy_setting(request.form.get("is_active")),
                        ),
                        actor_user_id=actor.id,
                    )
                    flash("Room type saved.", "success")
                elif action == "room":
                    actor = require_permission("settings.edit")
                    upsert_room(
                        parse_optional_uuid(request.form.get("room_id")),
                        RoomPayload(
                            room_number=request.form.get("room_number", ""),
                            room_type_id=UUID(request.form["room_type_id"]),
                            floor_number=int(request.form.get("floor_number", 0)),
                            is_active=truthy_setting(request.form.get("is_active")),
                            is_sellable=truthy_setting(request.form.get("is_sellable")),
                            default_operational_status=request.form.get("default_operational_status", "available"),
                            notes=request.form.get("notes"),
                        ),
                        actor_user_id=actor.id,
                    )
                    flash("Room saved.", "success")
                else:
                    abort(400)
            except Exception as exc:  # noqa: BLE001
                flash(public_error_message(exc), "error")
            return redirect(url_for("staff_settings"))

        room_types = RoomType.query.order_by(RoomType.code.asc()).all()
        rooms = Room.query.join(RoomType).order_by(Room.floor_number.asc(), Room.room_number.asc()).all()
        return render_template(
            "admin_property.html",
            active_section="property",
            property_settings=property_settings_context(),
            room_types=room_types,
            rooms=rooms,
            room_statuses=ROOM_OPERATIONAL_STATUSES,
        )

    @app.route("/staff/admin/rates-inventory", methods=["GET", "POST"], endpoint="staff_admin_rates_inventory")
    @app.route("/staff/rates", methods=["GET", "POST"])
    def staff_rates():
        user = require_user()
        if not (user.has_permission("rate_rule.view") or user.has_permission("settings.view")):
            abort(403)
        if request.method == "POST":
            try:
                action = request.form.get("action")
                if action == "rate_rule":
                    actor = require_permission("rate_rule.edit")
                    upsert_rate_rule(
                        parse_optional_uuid(request.form.get("rate_rule_id")),
                        RateRulePayload(
                            name=request.form.get("name", ""),
                            room_type_id=parse_optional_uuid(request.form.get("room_type_id")),
                            priority=int(request.form.get("priority", 100)),
                            is_active=truthy_setting(request.form.get("is_active")),
                            rule_type=request.form.get("rule_type", ""),
                            adjustment_type=request.form.get("adjustment_type", ""),
                            adjustment_value=parse_decimal(request.form.get("adjustment_value"), default="0.00"),
                            start_date=parse_optional_date(request.form.get("start_date")),
                            end_date=parse_optional_date(request.form.get("end_date")),
                            days_of_week=request.form.get("days_of_week"),
                            min_nights=parse_optional_int(request.form.get("min_nights")),
                            max_nights=parse_optional_int(request.form.get("max_nights")),
                            extra_guest_fee_override=parse_optional_decimal(request.form.get("extra_guest_fee_override")),
                            child_fee_override=parse_optional_decimal(request.form.get("child_fee_override")),
                        ),
                        actor_user_id=actor.id,
                    )
                    flash("Rate rule saved.", "success")
                elif action == "inventory_override":
                    actor = require_permission("settings.edit")
                    create_inventory_override(
                        InventoryOverridePayload(
                            name=request.form.get("name", ""),
                            scope_type=request.form.get("scope_type", ""),
                            override_action=request.form.get("override_action", ""),
                            room_id=parse_optional_uuid(request.form.get("room_id")),
                            room_type_id=parse_optional_uuid(request.form.get("override_room_type_id")),
                            start_date=date.fromisoformat(request.form["start_date"]),
                            end_date=date.fromisoformat(request.form["end_date"]),
                            reason=request.form.get("reason", ""),
                            expires_at=parse_optional_datetime(request.form.get("expires_at")),
                        ),
                        actor_user_id=actor.id,
                    )
                    flash("Inventory override created.", "success")
                elif action == "release_override":
                    actor = require_permission("settings.edit")
                    release_inventory_override(UUID(request.form["override_id"]), actor_user_id=actor.id)
                    flash("Inventory override released.", "success")
                elif action == "blackout":
                    actor = require_permission("settings.edit")
                    upsert_blackout_period(
                        parse_optional_uuid(request.form.get("blackout_id")),
                        BlackoutPayload(
                            name=request.form.get("name", ""),
                            blackout_type=request.form.get("blackout_type", ""),
                            start_date=date.fromisoformat(request.form["start_date"]),
                            end_date=date.fromisoformat(request.form["end_date"]),
                            reason=request.form.get("reason", ""),
                            is_active=truthy_setting(request.form.get("is_active")),
                        ),
                        actor_user_id=actor.id,
                    )
                    flash("Blackout period saved.", "success")
                elif action == "deposit_settings":
                    actor = require_permission("settings.edit")
                    upsert_settings_bundle(
                        [
                            {"key": "reservation.deposit_percentage", "value": request.form.get("deposit_percentage"), "value_type": "decimal", "description": "Default reservation deposit percentage", "is_public": False, "sort_order": 40},
                            {"key": "payment.deposit_enabled", "value": truthy_setting(request.form.get("deposit_enabled")), "value_type": "boolean", "description": "Enable hosted deposit payment requests", "is_public": False, "sort_order": 41},
                        ],
                        actor_user_id=actor.id,
                    )
                    flash("Deposit settings updated.", "success")
                else:
                    abort(400)
            except Exception as exc:  # noqa: BLE001
                flash(public_error_message(exc), "error")
            return redirect(url_for("staff_rates"))

        room_types = RoomType.query.order_by(RoomType.code.asc()).all()
        rooms = Room.query.order_by(Room.floor_number.asc(), Room.room_number.asc()).all()
        rate_rules = (
            RateRule.query.filter(RateRule.deleted_at.is_(None))
            .order_by(RateRule.priority.asc(), RateRule.name.asc())
            .all()
        )
        overrides = (
            InventoryOverride.query.order_by(
                InventoryOverride.is_active.desc(),
                InventoryOverride.start_date.asc(),
                InventoryOverride.created_at.desc(),
            ).all()
        )
        blackouts = BlackoutPeriod.query.order_by(BlackoutPeriod.start_date.asc(), BlackoutPeriod.name.asc()).all()
        return render_template(
            "admin_rates_inventory.html",
            active_section="rates_inventory",
            room_types=room_types,
            rooms=rooms,
            rate_rules=rate_rules,
            overrides=overrides,
            blackouts=blackouts,
            blackout_types=BLACKOUT_TYPES,
            override_scope_types=INVENTORY_OVERRIDE_SCOPE_TYPES,
            override_actions=INVENTORY_OVERRIDE_ACTIONS,
            rule_types=RATE_RULE_TYPES,
            adjustment_types=RATE_ADJUSTMENT_TYPES,
            deposit_percentage=str(get_setting_value("reservation.deposit_percentage", "50.00")),
            deposit_enabled=truthy_setting(get_setting_value("payment.deposit_enabled", True)),
        )

    @app.route("/staff/admin/operations", methods=["GET", "POST"])
    def staff_admin_operations():
        require_permission("settings.view")
        template_preview = None
        preview_key = request.args.get("template_key", "guest_confirmation")
        preview_channel = request.args.get("channel", "email")
        preview_language = normalize_language(request.args.get("language_code") or "th")
        if request.method == "POST":
            action = request.form.get("action")
            try:
                if action == "policy":
                    actor = require_permission("settings.edit")
                    upsert_policy_document(
                        PolicyPayload(
                                code=request.form.get("code", ""),
                                name=request.form.get("name", ""),
                                version=request.form.get("version", ""),
                                content={
                                    "th": request.form.get("content_th", ""),
                                    "en": request.form.get("content_en", ""),
                                    "zh-Hans": request.form.get("content_zh_hans", ""),
                                },
                                is_active=truthy_setting(request.form.get("is_active")),
                            ),
                            actor_user_id=actor.id,
                        )
                    flash("Policy updated.", "success")
                    return redirect(url_for("staff_admin_operations"))
                if action == "notification_template":
                    actor = require_permission("settings.edit")
                    upsert_notification_template(
                        parse_optional_uuid(request.form.get("template_id")),
                        NotificationTemplatePayload(
                            template_key=request.form.get("template_key", ""),
                            channel=request.form.get("channel", "email"),
                            language_code=normalize_language(request.form.get("language_code")),
                            description=request.form.get("description"),
                            subject_template=request.form.get("subject_template", ""),
                            body_template=request.form.get("body_template", ""),
                            is_active=truthy_setting(request.form.get("is_active")),
                        ),
                        actor_user_id=actor.id,
                    )
                    flash("Notification template saved.", "success")
                    return redirect(
                        url_for(
                            "staff_admin_operations",
                            template_key=request.form.get("template_key"),
                            channel=request.form.get("channel", "email"),
                            language_code=normalize_language(request.form.get("language_code")),
                        )
                    )
                if action == "preview_template":
                    preview_key = request.form.get("template_key", preview_key)
                    preview_channel = request.form.get("channel", preview_channel)
                    preview_language = normalize_language(request.form.get("language_code", preview_language))
                    template_preview = preview_notification_template(preview_key, preview_language, channel=preview_channel)
                    flash("Template preview refreshed.", "info")
                elif action == "housekeeping_defaults":
                    actor = require_permission("settings.edit")
                    upsert_settings_bundle(
                        [
                            {"key": "housekeeping.require_inspected_for_ready", "value": truthy_setting(request.form.get("require_inspected_for_ready")), "value_type": "boolean", "description": "Require inspected status before room readiness", "is_public": False, "sort_order": 80},
                            {"key": "housekeeping.checkout_dirty_status", "value": request.form.get("checkout_dirty_status"), "value_type": "string", "description": "Default housekeeping status applied after checkout", "is_public": False, "sort_order": 81},
                        ],
                        actor_user_id=actor.id,
                    )
                    flash("Housekeeping defaults updated.", "success")
                    return redirect(url_for("staff_admin_operations"))
                else:
                    abort(400)
            except Exception as exc:  # noqa: BLE001
                flash(public_error_message(exc), "error")

        documents_by_code = policy_documents_context()
        templates = (
            NotificationTemplate.query.filter(NotificationTemplate.deleted_at.is_(None))
            .order_by(NotificationTemplate.template_key.asc(), NotificationTemplate.channel.asc(), NotificationTemplate.language_code.asc())
            .all()
        )
        if template_preview is None:
            template_preview = preview_notification_template(preview_key, preview_language, channel=preview_channel)
        return render_template(
            "admin_operations.html",
            active_section="operations",
            policy_codes=POLICY_DOCUMENT_CODES,
            policy_documents=documents_by_code,
            templates=templates,
            template_keys=NOTIFICATION_TEMPLATE_KEYS,
            template_placeholders=NOTIFICATION_TEMPLATE_PLACEHOLDERS,
            template_preview=template_preview,
            preview_key=preview_key,
            preview_channel=preview_channel,
            preview_language=preview_language,
            housekeeping_defaults=housekeeping_defaults_context(),
        )

    @app.route("/staff/admin/communications", methods=["GET", "POST"], endpoint="staff_admin_communications")
    def staff_admin_communications():
        require_permission("settings.view")
        if request.method == "POST":
            action = request.form.get("action")
            try:
                actor = require_permission("settings.edit")
                if action == "save_settings":
                    upsert_settings_bundle(
                        [
                            {"key": "notifications.sender_name", "value": request.form.get("sender_name"), "value_type": "string", "description": "Friendly sender name for hotel communications", "is_public": False, "sort_order": 120},
                            {"key": "notifications.pre_arrival_enabled", "value": truthy_setting(request.form.get("pre_arrival_enabled")), "value_type": "boolean", "description": "Enable automatic pre-arrival reminders", "is_public": False, "sort_order": 121},
                            {"key": "notifications.pre_arrival_days_before", "value": request.form.get("pre_arrival_days_before"), "value_type": "integer", "description": "Days before arrival to send reminder", "is_public": False, "sort_order": 122},
                            {"key": "notifications.failed_payment_reminder_enabled", "value": truthy_setting(request.form.get("failed_payment_reminder_enabled")), "value_type": "boolean", "description": "Enable failed payment reminders", "is_public": False, "sort_order": 123},
                            {"key": "notifications.failed_payment_reminder_delay_hours", "value": request.form.get("failed_payment_reminder_delay_hours"), "value_type": "integer", "description": "Delay before failed payment reminders", "is_public": False, "sort_order": 124},
                            {"key": "notifications.staff_email_alerts_enabled", "value": truthy_setting(request.form.get("staff_email_alerts_enabled")), "value_type": "boolean", "description": "Enable staff alert emails", "is_public": False, "sort_order": 125},
                            {"key": "notifications.staff_alert_recipients", "value": request.form.get("staff_alert_recipients"), "value_type": "string", "description": "Staff alert recipient emails", "is_public": False, "sort_order": 126},
                            {"key": "notifications.line_staff_alert_enabled", "value": truthy_setting(request.form.get("line_staff_alert_enabled")), "value_type": "boolean", "description": "Enable LINE staff alerts", "is_public": False, "sort_order": 127},
                            {"key": "notifications.whatsapp_staff_alert_enabled", "value": truthy_setting(request.form.get("whatsapp_staff_alert_enabled")), "value_type": "boolean", "description": "Enable WhatsApp staff alerts", "is_public": False, "sort_order": 128},
                        ],
                        actor_user_id=actor.id,
                    )
                    flash("Communication settings updated.", "success")
                elif action == "dispatch_queue":
                    result = dispatch_notification_deliveries()
                    flash(f"Notification queue processed: {result['sent']} sent, {result['failed']} failed.", "success")
                elif action == "run_pre_arrival":
                    result = send_due_pre_arrival_reminders(actor_user_id=actor.id)
                    flash(f"Pre-arrival reminders queued: {result['queued']}, sent: {result['sent']}.", "success")
                elif action == "run_failed_payment":
                    result = send_due_failed_payment_reminders(actor_user_id=actor.id)
                    flash(f"Failed payment reminders queued: {result['queued']}, sent: {result['sent']}.", "success")
                else:
                    abort(400)
            except Exception as exc:  # noqa: BLE001
                flash(public_error_message(exc), "error")
            return redirect(url_for("staff_admin_communications"))

        filters = {
            "status": (request.args.get("status") or "").strip(),
            "channel": (request.args.get("channel") or "").strip(),
            "audience_type": (request.args.get("audience_type") or "").strip(),
        }
        deliveries = query_notification_history(
            audience_type=filters["audience_type"] or None,
            channel=filters["channel"] or None,
            status=filters["status"] or None,
            limit=200,
        )
        return render_template(
            "admin_communications.html",
            active_section="communications",
            communication_settings=communication_settings_context(),
            deliveries=deliveries,
            filters=filters,
            delivery_statuses=["pending", "queued", "delivered", "failed", "skipped", "cancelled"],
            delivery_channels=["email", "internal_notification", "line_staff_alert", "whatsapp_staff_alert"],
            audience_types=["guest", "staff"],
        )

    @app.route("/staff/admin/payments", methods=["GET", "POST"])
    def staff_admin_payments():
        viewer = require_permission("settings.view")
        if request.method == "POST":
            try:
                actor = require_permission("settings.edit")
                selected_provider = (request.form.get("active_provider") or "env").strip().lower()
                if selected_provider != str(get_setting_value("payment.active_provider", "env")).strip().lower():
                    require_admin_role(actor)
                upsert_settings_bundle(
                    [
                        {"key": "payment.active_provider", "value": selected_provider, "value_type": "string", "description": "Active hosted payment provider selector", "is_public": False, "sort_order": 90},
                        {"key": "payment.deposit_enabled", "value": truthy_setting(request.form.get("deposit_enabled")), "value_type": "boolean", "description": "Enable deposit collection via hosted payments", "is_public": False, "sort_order": 91},
                        {"key": "payment.link_expiry_minutes", "value": request.form.get("link_expiry_minutes"), "value_type": "integer", "description": "Hosted payment link expiry in minutes", "is_public": False, "sort_order": 92},
                        {"key": "payment.link_resend_cooldown_seconds", "value": request.form.get("link_resend_cooldown_seconds"), "value_type": "integer", "description": "Minimum cooldown between payment link resends", "is_public": False, "sort_order": 93},
                    ],
                    actor_user_id=actor.id,
                )
                flash("Payment configuration updated.", "success")
            except Exception as exc:  # noqa: BLE001
                flash(public_error_message(exc), "error")
            return redirect(url_for("staff_admin_payments"))

        recent_requests = PaymentRequest.query.order_by(PaymentRequest.created_at.desc()).limit(20).all()
        return render_template(
            "admin_payments.html",
            active_section="payments",
            payment_settings=payment_settings_context(),
            recent_requests=recent_requests,
            is_super_admin=is_admin_user(viewer),
        )

    @app.route("/staff/reports")
    def staff_reports():
        user = require_permission("reports.view")
        preset, date_from, date_to = resolve_report_date_range(
            preset=(request.args.get("preset") or "next_7_days").strip(),
            requested_start=parse_optional_date(request.args.get("date_from")),
            requested_end=parse_optional_date(request.args.get("date_to")),
        )
        dashboard = build_manager_dashboard(
            business_date=date.today(),
            date_from=date_from,
            date_to=date_to,
            include_housekeeping=user.has_permission("housekeeping.view"),
            include_financials=user.has_permission("folio.view"),
            include_payments=user.has_permission("payment.read"),
            include_audit=user.has_permission("audit.view"),
        )
        return render_template(
            "staff_reports.html",
            dashboard=dashboard,
            filters={
                "preset": preset,
                "date_from": date_from.isoformat(),
                "date_to": date_to.isoformat(),
            },
            report_presets=report_date_presets(),
            report_range_label=format_report_date_range(date_from, date_to),
            can_reservation=user.has_permission("reservation.view"),
            can_folio=user.has_permission("folio.view"),
            can_payments=user.has_permission("payment.read"),
            can_housekeeping=user.has_permission("housekeeping.view"),
            can_audit=user.has_permission("audit.view"),
        )

    @app.route("/staff/admin/audit", endpoint="staff_admin_audit")
    @app.route("/staff/audit")
    def staff_audit():
        require_permission("audit.view")
        actor_user_id = parse_optional_uuid(request.args.get("actor_user_id"))
        date_from = parse_optional_date(request.args.get("date_from"))
        date_to = parse_optional_date(request.args.get("date_to"))
        entity_table = (request.args.get("entity_table") or "").strip() or None
        action = (request.args.get("action") or "").strip() or None
        entries = query_audit_entries(
            actor_user_id=actor_user_id,
            entity_table=entity_table,
            action=action,
            date_from=date_from,
            date_to=date_to,
            limit=200,
        )
        users = User.query.filter(User.deleted_at.is_(None)).order_by(User.full_name.asc()).all()
        entity_tables = sorted(
            item[0]
            for item in AuditLog.query.with_entities(AuditLog.entity_table).distinct().all()
            if item[0]
        )
        action_codes = sorted(
            item[0]
            for item in AuditLog.query.with_entities(AuditLog.action).distinct().all()
            if item[0]
        )
        return render_template(
            "admin_audit.html",
            active_section="audit",
            entries=entries,
            users=users,
            entity_tables=entity_tables,
            action_codes=action_codes,
            summarize_audit_entry=summarize_audit_entry,
            filters={
                "actor_user_id": str(actor_user_id) if actor_user_id else "",
                "entity_table": entity_table or "",
                "action": action or "",
                "date_from": date_from.isoformat() if date_from else "",
                "date_to": date_to.isoformat() if date_to else "",
            },
        )

    @app.route("/staff")
    def staff_dashboard():
        require_permission("reservation.view")
        today = date.today()
        queue_entries = (
            ReservationReviewQueue.query.order_by(ReservationReviewQueue.created_at.desc()).limit(10).all()
        )
        notifications = StaffNotification.query.filter_by(status="new").order_by(StaffNotification.created_at.desc()).limit(10).all()
        pending_emails = EmailOutbox.query.filter(EmailOutbox.status.in_(["pending", "failed"])).count()
        return render_template(
            "staff_dashboard.html",
            queue_entries=queue_entries,
            notifications=notifications,
            pending_emails=pending_emails,
            arrivals_count=len(list_arrivals(arrival_date=today)),
            departures_count=len(list_departures(departure_date=today)),
            in_house_count=len(list_in_house(business_date=today)),
        )

    @app.route("/staff/notifications/<uuid:notification_id>/read", methods=["POST"])
    def staff_notification_read(notification_id):
        require_permission("reservation.view")
        notification = db.session.get(StaffNotification, notification_id)
        if not notification:
            abort(404)
        notification.status = "read"
        notification.read_at = datetime.utcnow()
        db.session.commit()
        return redirect(request.form.get("back_url") or url_for("staff_dashboard"))

    @app.route("/staff/housekeeping")
    def staff_housekeeping():
        user = require_permission("housekeeping.view")
        target_date = date.fromisoformat(request.args.get("date", date.today().isoformat()))
        filters = HousekeepingBoardFilters(
            business_date=target_date,
            floor=request.args.get("floor", ""),
            status=request.args.get("status", ""),
            priority=request.args.get("priority", ""),
            room_type_id=request.args.get("room_type_id", ""),
            arrival_today=request.args.get("arrival_today", ""),
            departure_today=request.args.get("departure_today", ""),
            blocked=request.args.get("blocked", ""),
            maintenance=request.args.get("maintenance", ""),
            notes=request.args.get("notes", ""),
            mobile=request.args.get("view") == "mobile",
        )
        board = list_housekeeping_board(filters, actor_user=user)
        return render_template(
            "housekeeping_board.html",
            board=board,
            filters=filters,
            room_types=RoomType.query.order_by(RoomType.code.asc()).all(),
            housekeeping_statuses=["dirty", "clean", "inspected", "pickup", "occupied_clean", "occupied_dirty", "do_not_disturb", "sleep", "out_of_order", "out_of_service"],
            room_note_types=ROOM_NOTE_TYPES,
            can_manage_controls=user.primary_role in {"admin", "manager"},
        )

    @app.route("/staff/housekeeping/rooms/<uuid:room_id>")
    def staff_housekeeping_room_detail(room_id):
        user = require_permission("housekeeping.view")
        business_date = date.fromisoformat(request.args.get("date", date.today().isoformat()))
        detail = get_housekeeping_room_detail(room_id, business_date=business_date, actor_user=user)
        return render_template(
            "housekeeping_room_detail.html",
            detail=detail,
            business_date=business_date,
            back_url=request.args.get("back") or url_for("staff_housekeeping", date=business_date.isoformat()),
            housekeeping_statuses=["dirty", "clean", "inspected", "pickup", "occupied_clean", "occupied_dirty", "do_not_disturb", "sleep", "out_of_order", "out_of_service"],
            room_note_types=ROOM_NOTE_TYPES,
            can_manage_controls=user.primary_role in {"admin", "manager"},
        )

    @app.route("/staff/housekeeping/rooms/<uuid:room_id>/status", methods=["POST"])
    def staff_housekeeping_room_status(room_id):
        user = require_permission("housekeeping.status_change")
        business_date = date.fromisoformat(request.form["business_date"])
        try:
            update_housekeeping_status(
                room_id,
                business_date=business_date,
                payload=RoomStatusUpdatePayload(
                    status_code=request.form.get("status_code", ""),
                    note=request.form.get("note"),
                ),
                actor_user_id=user.id,
            )
            flash("Room status updated.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_housekeeping_room_detail", room_id=room_id, date=business_date.isoformat(), back=request.form.get("back_url")))

    @app.route("/staff/housekeeping/rooms/<uuid:room_id>/notes", methods=["POST"])
    def staff_housekeeping_room_note(room_id):
        user = require_permission("housekeeping.status_change")
        business_date = date.fromisoformat(request.form["business_date"])
        try:
            add_housekeeping_room_note(
                room_id,
                business_date=business_date,
                payload=HousekeepingRoomNotePayload(
                    note_text=request.form.get("note_text", ""),
                    note_type=request.form.get("note_type", "housekeeping"),
                    is_important=request.form.get("is_important") == "on",
                    visibility_scope=request.form.get("visibility_scope", "all_staff"),
                ),
                actor_user_id=user.id,
            )
            flash("Room note added.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_housekeeping_room_detail", room_id=room_id, date=business_date.isoformat(), back=request.form.get("back_url")))

    @app.route("/staff/housekeeping/rooms/<uuid:room_id>/maintenance", methods=["POST"])
    def staff_housekeeping_room_maintenance(room_id):
        user = require_permission("housekeeping.status_change")
        business_date = date.fromisoformat(request.form["business_date"])
        try:
            set_maintenance_flag(
                room_id,
                business_date=business_date,
                payload=MaintenanceFlagPayload(
                    enabled=request.form.get("enabled") == "1",
                    note=request.form.get("note"),
                ),
                actor_user_id=user.id,
            )
            flash("Maintenance flag updated.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_housekeeping_room_detail", room_id=room_id, date=business_date.isoformat(), back=request.form.get("back_url")))

    @app.route("/staff/housekeeping/rooms/<uuid:room_id>/block", methods=["POST"])
    def staff_housekeeping_room_block(room_id):
        user = require_permission("housekeeping.status_change")
        business_date = date.fromisoformat(request.form["business_date"])
        blocked_until_raw = request.form.get("blocked_until")
        blocked_until = datetime.fromisoformat(blocked_until_raw) if blocked_until_raw else None
        try:
            set_blocked_state(
                room_id,
                business_date=business_date,
                payload=BlockRoomPayload(
                    blocked=request.form.get("blocked") == "1",
                    reason=request.form.get("reason"),
                    blocked_until=blocked_until,
                ),
                actor_user_id=user.id,
            )
            flash("Blocked-room state updated.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_housekeeping_room_detail", room_id=room_id, date=business_date.isoformat(), back=request.form.get("back_url")))

    @app.route("/staff/housekeeping/bulk", methods=["POST"])
    def staff_housekeeping_bulk():
        user = require_permission("housekeeping.status_change")
        business_date = date.fromisoformat(request.form["business_date"])
        room_ids = [UUID(item) for item in request.form.getlist("room_ids") if item]
        blocked_until_raw = request.form.get("blocked_until")
        blocked_until = datetime.fromisoformat(blocked_until_raw) if blocked_until_raw else None
        try:
            result = bulk_update_housekeeping(
                BulkHousekeepingPayload(
                    room_ids=room_ids,
                    business_date=business_date,
                    action=request.form.get("action", ""),
                    status_code=request.form.get("status_code") or None,
                    note=request.form.get("note") or None,
                    room_note_type=request.form.get("room_note_type", "housekeeping"),
                    is_important=request.form.get("is_important") == "on",
                    blocked_until=blocked_until,
                ),
                actor_user_id=user.id,
            )
            flash(
                f"Bulk update completed: {result['success_count']} success, {result['failure_count']} failed.",
                "success" if result["failure_count"] == 0 else "warning",
            )
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_housekeeping", date=business_date.isoformat(), view=request.form.get("view")))

    @app.route("/staff/front-desk")
    def staff_front_desk():
        require_permission("reservation.view")
        target_date = date.fromisoformat(request.args.get("date", date.today().isoformat()))
        filters = FrontDeskFilters(
            business_date=target_date,
            mode=request.args.get("mode", "arrivals"),
            room_type_id=request.args.get("room_type_id", ""),
            assigned=request.args.get("assigned", ""),
            ready=request.args.get("ready", ""),
            payment_state=request.args.get("payment_state", ""),
            booking_source=request.args.get("booking_source", ""),
            flagged=request.args.get("flagged", ""),
        )
        workspace = list_front_desk_workspace(filters)
        return render_template(
            "front_desk_workspace.html",
            workspace=workspace,
            filters=filters,
            room_types=RoomType.query.order_by(RoomType.code.asc()).all(),
            booking_sources=BOOKING_SOURCE_CHANNELS,
            walk_in_checkout_default=target_date + timedelta(days=1),
            can_folio=can("folio.view"),
            can_check_in=can("reservation.check_in"),
            can_check_out=can("reservation.check_out"),
            can_edit=can("reservation.edit"),
            can_create=can("reservation.create"),
            can_collect_payment=can("payment.create"),
            can_charge=can("folio.charge_add"),
        )

    @app.route("/staff/front-desk/walk-in", methods=["POST"])
    def staff_front_desk_walk_in():
        user = require_permission("reservation.create")
        if not user.has_permission("reservation.check_in"):
            abort(403)
        collect_payment_amount = Decimal(request.form.get("collect_payment_amount") or "0.00")
        if collect_payment_amount > Decimal("0.00") and not user.has_permission("payment.create"):
            abort(403)
        if request.form.get("apply_early_fee") == "on" and not user.has_permission("folio.charge_add"):
            abort(403)
        try:
            reservation = create_walk_in_and_check_in(
                WalkInCheckInPayload(
                    first_name=request.form.get("first_name", ""),
                    last_name=request.form.get("last_name", ""),
                    phone=request.form.get("phone", ""),
                    email=request.form.get("email"),
                    room_type_id=UUID(request.form["room_type_id"]),
                    check_in_date=date.fromisoformat(request.form["check_in_date"]),
                    check_out_date=date.fromisoformat(request.form["check_out_date"]),
                    adults=int(request.form.get("adults", 1)),
                    children=int(request.form.get("children", 0)),
                    extra_guests=int(request.form.get("extra_guests", 0)),
                    room_id=UUID(request.form["room_id"]) if request.form.get("room_id") else None,
                    special_requests=request.form.get("special_requests"),
                    internal_notes=request.form.get("internal_notes"),
                    nationality=request.form.get("nationality"),
                    id_document_type=request.form.get("id_document_type"),
                    id_document_number=request.form.get("id_document_number"),
                    preferred_language=request.form.get("preferred_language"),
                    notes_summary=request.form.get("notes_summary"),
                    identity_verified=request.form.get("identity_verified") == "on",
                    collect_payment_amount=collect_payment_amount,
                    payment_method=request.form.get("payment_method", "front_desk"),
                    apply_early_fee=request.form.get("apply_early_fee") == "on",
                    waive_early_fee=request.form.get("waive_early_fee") == "on",
                    waiver_reason=request.form.get("waiver_reason"),
                ),
                actor_user_id=user.id,
            )
            flash(f"Walk-in checked in under {reservation.reservation_code}.", "success")
            return redirect(url_for("staff_front_desk_detail", reservation_id=reservation.id, back=url_for("staff_front_desk", mode="in_house")))
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
            return redirect(url_for("staff_front_desk", mode=request.form.get("back_mode", "arrivals"), date=request.form.get("back_date")))

    @app.route("/staff/front-desk/<uuid:reservation_id>")
    def staff_front_desk_detail(reservation_id):
        require_permission("reservation.view")
        business_date = date.fromisoformat(request.args.get("date", date.today().isoformat()))
        detail = get_front_desk_detail(reservation_id, business_date=business_date)
        checkout_prep = prepare_checkout(reservation_id) if detail["reservation"].current_status == "checked_in" else None
        return render_template(
            "front_desk_detail.html",
            detail=detail,
            checkout_prep=checkout_prep,
            back_url=request.args.get("back") or url_for("staff_front_desk"),
            business_date=business_date,
            can_folio=can("folio.view"),
            can_charge=can("folio.charge_add"),
            can_collect_payment=can("payment.create"),
        )

    @app.route("/staff/front-desk/<uuid:reservation_id>/room", methods=["POST"])
    def staff_front_desk_assign_room(reservation_id):
        user = require_permission("reservation.edit")
        try:
            assign_room(
                reservation_id,
                UUID(request.form["room_id"]),
                actor_user_id=user.id,
                reason=request.form.get("reason") or "front_desk_move",
            )
            flash("Room assignment updated.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_front_desk_detail", reservation_id=reservation_id, back=request.form.get("back_url"), date=request.form.get("business_date")))

    @app.route("/staff/front-desk/<uuid:reservation_id>/check-in", methods=["POST"])
    def staff_front_desk_check_in(reservation_id):
        user = require_permission("reservation.check_in")
        collect_payment_amount = Decimal(request.form.get("collect_payment_amount") or "0.00")
        if collect_payment_amount > Decimal("0.00") and not user.has_permission("payment.create"):
            abort(403)
        if request.form.get("apply_early_fee") == "on" and not user.has_permission("folio.charge_add"):
            abort(403)
        room_id = request.form.get("room_id")
        if room_id:
            reservation = db.session.get(Reservation, reservation_id)
            if reservation and str(reservation.assigned_room_id) != room_id and not user.has_permission("reservation.edit"):
                abort(403)
        try:
            complete_check_in(
                reservation_id,
                CheckInPayload(
                    room_id=UUID(room_id) if room_id else None,
                    first_name=request.form.get("first_name", ""),
                    last_name=request.form.get("last_name", ""),
                    phone=request.form.get("phone", ""),
                    email=request.form.get("email"),
                    nationality=request.form.get("nationality"),
                    id_document_type=request.form.get("id_document_type"),
                    id_document_number=request.form.get("id_document_number"),
                    preferred_language=request.form.get("preferred_language"),
                    notes_summary=request.form.get("notes_summary"),
                    identity_verified=request.form.get("identity_verified") == "on",
                    collect_payment_amount=collect_payment_amount,
                    payment_method=request.form.get("payment_method", "front_desk"),
                    arrival_note=request.form.get("arrival_note"),
                    apply_early_fee=request.form.get("apply_early_fee") == "on",
                    waive_early_fee=request.form.get("waive_early_fee") == "on",
                    waiver_reason=request.form.get("waiver_reason"),
                    override_payment=request.form.get("override_payment") == "on",
                ),
                actor_user_id=user.id,
            )
            flash("Guest checked in.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_front_desk_detail", reservation_id=reservation_id, back=request.form.get("back_url"), date=request.form.get("business_date")))

    @app.route("/staff/front-desk/<uuid:reservation_id>/check-out", methods=["POST"])
    def staff_front_desk_check_out(reservation_id):
        user = require_permission("reservation.check_out")
        collect_payment_amount = Decimal(request.form.get("collect_payment_amount") or "0.00")
        if collect_payment_amount > Decimal("0.00") and not user.has_permission("payment.create"):
            abort(403)
        if request.form.get("apply_late_fee") == "on" and not user.has_permission("folio.charge_add"):
            abort(403)
        try:
            complete_checkout(
                reservation_id,
                CheckoutPayload(
                    collect_payment_amount=collect_payment_amount,
                    payment_method=request.form.get("payment_method", "front_desk"),
                    departure_note=request.form.get("departure_note"),
                    apply_late_fee=request.form.get("apply_late_fee") == "on",
                    waive_late_fee=request.form.get("waive_late_fee") == "on",
                    waiver_reason=request.form.get("waiver_reason"),
                    override_balance=request.form.get("override_balance") == "on",
                    process_refund=request.form.get("process_refund") == "on",
                    refund_note=request.form.get("refund_note"),
                ),
                actor_user_id=user.id,
            )
            flash("Guest checked out and room handed to housekeeping.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_front_desk_detail", reservation_id=reservation_id, back=request.form.get("back_url"), date=request.form.get("business_date")))

    @app.route("/staff/front-desk/<uuid:reservation_id>/no-show", methods=["POST"])
    def staff_front_desk_no_show(reservation_id):
        user = require_user()
        if not (user.has_permission("reservation.cancel") or user.has_permission("reservation.check_in")):
            abort(403)
        try:
            process_no_show(
                reservation_id,
                NoShowPayload(reason=request.form.get("reason")),
                actor_user_id=user.id,
            )
            flash("Reservation marked as no-show.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_front_desk", mode="arrivals", date=request.form.get("business_date")))

    @app.route("/staff/cashier/<uuid:reservation_id>")
    def staff_cashier_detail(reservation_id):
        require_permission("folio.view")
        auto_post_until = request.args.get("auto_post_until")
        detail = get_cashier_detail(
            reservation_id,
            auto_post_room_charges=request.args.get("auto_post") == "1",
            auto_post_through=date.fromisoformat(auto_post_until) if auto_post_until else None,
        )
        return render_template(
            "cashier_folio.html",
            detail=detail,
            back_url=request.args.get("back") or url_for("staff_reservation_detail", reservation_id=reservation_id),
            can_adjust=can("folio.adjust"),
            can_charge=can("folio.charge_add"),
            can_payment=can("payment.create"),
            can_refund=can("payment.refund"),
            can_payment_request=can("payment_request.create"),
            payments_enabled=payments_enabled(),
        )

    @app.route("/staff/cashier/<uuid:reservation_id>/room-charges", methods=["POST"])
    def staff_cashier_post_room_charges(reservation_id):
        user = require_permission("folio.charge_add")
        through_date = date.fromisoformat(request.form["through_date"])
        try:
            created = ensure_room_charges_posted(
                reservation_id,
                through_date=through_date,
                actor_user_id=user.id,
                commit=True,
            )
            flash(f"Posted {len(created)} room charge line(s).", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/cashier/<uuid:reservation_id>/adjustments", methods=["POST"])
    def staff_cashier_adjustment(reservation_id):
        user = require_user()
        charge_type = request.form.get("charge_type", "")
        required_permission = "folio.charge_add" if charge_type == "manual_charge" else "folio.adjust"
        if not user.has_permission(required_permission):
            abort(403)
        try:
            post_manual_adjustment(
                reservation_id,
                ManualAdjustmentPayload(
                    charge_type=charge_type,
                    amount=Decimal(request.form.get("amount") or "0.00"),
                    description=request.form.get("description", ""),
                    note=request.form.get("note", ""),
                    service_date=date.fromisoformat(request.form["service_date"]) if request.form.get("service_date") else None,
                    reference_charge_id=UUID(request.form["reference_charge_id"]) if request.form.get("reference_charge_id") else None,
                ),
                actor_user_id=user.id,
            )
            flash("Folio adjustment posted.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/cashier/<uuid:reservation_id>/payments", methods=["POST"])
    def staff_cashier_payment(reservation_id):
        user = require_permission("payment.create")
        try:
            record_payment(
                reservation_id,
                PaymentPostingPayload(
                    amount=Decimal(request.form.get("amount") or "0.00"),
                    payment_method=request.form.get("payment_method", "cash"),
                    note=request.form.get("note"),
                    service_date=date.fromisoformat(request.form["service_date"]) if request.form.get("service_date") else None,
                    request_type="cashier_payment",
                    is_deposit=request.form.get("is_deposit") == "on",
                ),
                actor_user_id=user.id,
            )
            flash("Payment recorded on folio.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/cashier/<uuid:reservation_id>/payment-requests", methods=["POST"])
    def staff_cashier_payment_request(reservation_id):
        user = require_permission("payment_request.create")
        try:
            create_or_reuse_deposit_request(
                reservation_id,
                actor_user_id=user.id,
                send_email=request.form.get("send_email") == "on",
                language=request.form.get("language") or None,
                force_new_link=request.form.get("force_new_link") == "on",
                source="staff_cashier",
            )
            flash("Deposit payment request is ready.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/cashier/<uuid:reservation_id>/payment-requests/<uuid:payment_request_id>/resend", methods=["POST"])
    def staff_cashier_resend_payment_request(reservation_id, payment_request_id):
        user = require_permission("payment_request.create")
        try:
            resend_payment_link(
                payment_request_id,
                actor_user_id=user.id,
                force_new=request.form.get("force_new_link") == "on",
            )
            flash("Payment link resent.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/cashier/<uuid:reservation_id>/payment-requests/<uuid:payment_request_id>/refresh", methods=["POST"])
    def staff_cashier_refresh_payment_request(reservation_id, payment_request_id):
        user = require_permission("payment.read")
        try:
            sync_payment_request_status(payment_request_id, actor_user_id=user.id)
            flash("Payment status refreshed.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/cashier/<uuid:reservation_id>/refunds", methods=["POST"])
    def staff_cashier_refund(reservation_id):
        user = require_permission("payment.refund")
        try:
            record_refund(
                reservation_id,
                RefundPostingPayload(
                    amount=Decimal(request.form.get("amount") or "0.00"),
                    reason=request.form.get("reason", ""),
                    payment_method=request.form.get("payment_method", "cash"),
                    service_date=date.fromisoformat(request.form["service_date"]) if request.form.get("service_date") else None,
                    reference_charge_id=UUID(request.form["reference_charge_id"]) if request.form.get("reference_charge_id") else None,
                    processed=request.form.get("processed", "1") == "1",
                ),
                actor_user_id=user.id,
            )
            flash("Refund workflow recorded.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/cashier/<uuid:reservation_id>/lines/<uuid:charge_id>/void", methods=["POST"])
    def staff_cashier_void_charge(reservation_id, charge_id):
        user = require_permission("folio.adjust")
        try:
            void_folio_charge(
                reservation_id,
                charge_id,
                VoidChargePayload(reason=request.form.get("reason", "")),
                actor_user_id=user.id,
            )
            flash("Folio line voided with reversal.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/cashier/<uuid:reservation_id>/print")
    def staff_cashier_print(reservation_id):
        require_permission("folio.view")
        document_type = request.args.get("document_type", "folio")
        context = cashier_print_context(
            reservation_id,
            document_type=document_type,
            actor_user_id=None,
            issue_document=False,
        )
        return render_template("cashier_print.html", **context)

    @app.route("/staff/cashier/<uuid:reservation_id>/documents", methods=["POST"])
    def staff_cashier_issue_document(reservation_id):
        user = require_permission("folio.view")
        document_type = request.form.get("document_type", "folio")
        try:
            issue_cashier_document(
                reservation_id,
                DocumentIssuePayload(
                    document_type=document_type,
                    note=request.form.get("note"),
                ),
                actor_user_id=user.id,
            )
            flash(f"{document_type.replace('_', ' ').title()} issued.", "success")
            return redirect(url_for("staff_cashier_print", reservation_id=reservation_id, document_type=document_type))
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
            return redirect(url_for("staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/reservations")
    def staff_reservations():
        require_permission("reservation.view")
        filters = ReservationWorkspaceFilters(
            q=(request.args.get("q") or "").strip(),
            status=request.args.get("status", ""),
            room_type_id=request.args.get("room_type_id", ""),
            arrival_date=request.args.get("arrival_date", ""),
            departure_date=request.args.get("departure_date", ""),
            payment_state=request.args.get("payment_state", ""),
            booking_source=request.args.get("booking_source", ""),
            review_status=request.args.get("review_status", ""),
            assigned=request.args.get("assigned", ""),
            include_closed=request.args.get("include_closed") == "1",
            page=int(request.args.get("page", 1)),
            per_page=25,
        )
        result = list_reservations(filters)
        return render_template(
            "staff_reservations.html",
            result=result,
            filters=filters,
            room_types=RoomType.query.order_by(RoomType.code.asc()).all(),
            reservation_statuses=RESERVATION_STATUSES,
            booking_sources=BOOKING_SOURCE_CHANNELS,
            review_statuses=REVIEW_QUEUE_STATUSES,
            today=date.today(),
            can_folio=can("folio.view"),
        )

    @app.route("/staff/reservations/arrivals")
    def staff_reservation_arrivals():
        require_permission("reservation.view")
        target_date = date.fromisoformat(request.args.get("date", date.today().isoformat()))
        items = list_arrivals(
            arrival_date=target_date,
            room_type_id=request.args.get("room_type_id", ""),
            payment_state=request.args.get("payment_state", ""),
            assigned=request.args.get("assigned", ""),
        )
        return render_template(
            "staff_operational_list.html",
            title="Arrivals",
            subtitle="Reservations arriving today",
            items=items,
            target_date=target_date,
            mode="arrivals",
            room_types=RoomType.query.order_by(RoomType.code.asc()).all(),
            can_folio=can("folio.view"),
        )

    @app.route("/staff/reservations/departures")
    def staff_reservation_departures():
        require_permission("reservation.view")
        target_date = date.fromisoformat(request.args.get("date", date.today().isoformat()))
        items = list_departures(
            departure_date=target_date,
            room_type_id=request.args.get("room_type_id", ""),
            payment_state=request.args.get("payment_state", ""),
        )
        return render_template(
            "staff_operational_list.html",
            title="Departures",
            subtitle="Reservations departing today",
            items=items,
            target_date=target_date,
            mode="departures",
            room_types=RoomType.query.order_by(RoomType.code.asc()).all(),
            can_folio=can("folio.view"),
        )

    @app.route("/staff/reservations/in-house")
    def staff_reservation_in_house():
        require_permission("reservation.view")
        target_date = date.fromisoformat(request.args.get("date", date.today().isoformat()))
        items = list_in_house(business_date=target_date)
        return render_template(
            "staff_operational_list.html",
            title="In-House Guests",
            subtitle="Guests currently checked in",
            items=items,
            target_date=target_date,
            mode="in_house",
            room_types=RoomType.query.order_by(RoomType.code.asc()).all(),
            can_folio=can("folio.view"),
        )

    @app.route("/staff/reservations/<uuid:reservation_id>")
    def staff_reservation_detail(reservation_id):
        require_permission("reservation.view")
        detail = get_reservation_detail(reservation_id)
        return render_template(
            "reservation_detail.html",
            detail=detail,
            back_url=request.args.get("back") or url_for("staff_reservations"),
            today=date.today(),
            can_folio=can("folio.view"),
        )

    @app.route("/staff/reservations/<uuid:reservation_id>/guest", methods=["POST"])
    def staff_reservation_update_guest(reservation_id):
        user = require_permission("reservation.edit")
        try:
            update_guest_details(
                reservation_id,
                GuestUpdatePayload(
                    first_name=request.form.get("first_name", ""),
                    last_name=request.form.get("last_name", ""),
                    phone=request.form.get("phone", ""),
                    email=request.form.get("email"),
                    nationality=request.form.get("nationality"),
                    id_document_type=request.form.get("id_document_type"),
                    id_document_number=request.form.get("id_document_number"),
                    preferred_language=request.form.get("preferred_language"),
                    notes_summary=request.form.get("notes_summary"),
                ),
                actor_user_id=user.id,
            )
            flash("Guest details updated.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_reservation_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/reservations/<uuid:reservation_id>/dates", methods=["POST"])
    def staff_reservation_change_dates(reservation_id):
        user = require_permission("reservation.edit")
        try:
            result = change_stay_dates(
                reservation_id,
                StayDateChangePayload(
                    check_in_date=date.fromisoformat(request.form["check_in_date"]),
                    check_out_date=date.fromisoformat(request.form["check_out_date"]),
                    adults=int(request.form.get("adults", 1)),
                    children=int(request.form.get("children", 0)),
                    extra_guests=int(request.form.get("extra_guests", 0)),
                ),
                actor_user_id=user.id,
            )
            delta = result["new_total"] - result["old_total"]
            flash(
                f"Stay updated. New total {result['new_total']:.2f} THB ({delta:+.2f} THB).",
                "success",
            )
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_reservation_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/reservations/<uuid:reservation_id>/room", methods=["POST"])
    def staff_reservation_assign_room(reservation_id):
        user = require_permission("reservation.edit")
        try:
            assign_room(
                reservation_id,
                UUID(request.form["room_id"]),
                actor_user_id=user.id,
            )
            flash("Room assignment updated.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_reservation_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/reservations/<uuid:reservation_id>/cancel", methods=["POST"])
    def staff_reservation_cancel(reservation_id):
        user = require_permission("reservation.cancel")
        try:
            cancel_reservation_workspace(
                reservation_id,
                actor_user_id=user.id,
                reason=request.form.get("reason", ""),
            )
            flash("Reservation cancelled.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_reservations"))

    @app.route("/staff/reservations/<uuid:reservation_id>/notes", methods=["POST"])
    def staff_reservation_add_note(reservation_id):
        user = require_permission("reservation.edit")
        try:
            add_reservation_note(
                reservation_id,
                ReservationNotePayload(
                    note_text=request.form.get("note_text", ""),
                    note_type=request.form.get("note_type", "general"),
                    is_important=request.form.get("is_important") == "on",
                    visibility_scope=request.form.get("visibility_scope", "all_staff"),
                ),
                actor_user_id=user.id,
            )
            flash("Note added.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_reservation_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/reservations/<uuid:reservation_id>/resend-confirmation", methods=["POST"])
    def staff_reservation_resend_confirmation(reservation_id):
        user = require_permission("reservation.edit")
        try:
            resend_confirmation(
                reservation_id,
                actor_user_id=user.id,
                language=request.form.get("language") or None,
            )
            flash("Confirmation email resent.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_reservation_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/review-queue", methods=["GET", "POST"])
    def staff_review_queue():
        user = require_permission("reservation.view")
        if request.method == "POST":
            entry = db.session.get(ReservationReviewQueue, UUID(request.form["entry_id"]))
            if not entry:
                abort(404)
            action = request.form["action"]
            if action == "reviewed":
                entry.review_status = "reviewed"
                entry.reviewed_at = datetime.now()
                entry.reviewed_by_user_id = user.id
            elif action == "needs_follow_up":
                entry.review_status = "needs_follow_up"
            elif action == "issue_flagged":
                entry.review_status = "issue_flagged"
            elif action == "resolved":
                entry.review_status = "resolved"
            elif action == "contacted":
                entry.contacted_at = datetime.now()
            entry.internal_note = request.form.get("internal_note") or entry.internal_note
            db.session.commit()
            return redirect(url_for("staff_review_queue"))

        query = ReservationReviewQueue.query.join(Reservation, Reservation.id == ReservationReviewQueue.reservation_id)
        if request.args.get("status"):
            query = query.filter(ReservationReviewQueue.review_status == request.args["status"])
        if request.args.get("arrival_date"):
            query = query.filter(Reservation.check_in_date == date.fromisoformat(request.args["arrival_date"]))
        if request.args.get("booking_source"):
            query = query.filter(Reservation.source_channel == request.args["booking_source"])
        if request.args.get("deposit_state"):
            query = query.filter(ReservationReviewQueue.deposit_state == request.args["deposit_state"])
        if request.args.get("flagged_duplicate") == "1":
            query = query.filter(ReservationReviewQueue.flagged_duplicate_suspected.is_(True))
        if request.args.get("special_requests") == "1":
            query = query.filter(ReservationReviewQueue.special_requests_present.is_(True))
        entries = query.order_by(ReservationReviewQueue.created_at.desc()).all()
        return render_template("staff_review_queue.html", entries=entries)


def current_language() -> str:
    return normalize_language(request.args.get("lang") or request.form.get("language") or "th")


def ensure_csrf_token() -> str:
    token = session.get("_csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["_csrf_token"] = token
    return token


def rotate_csrf_token() -> str:
    token = secrets.token_urlsafe(32)
    session["_csrf_token"] = token
    return token


def validate_csrf_request() -> None:
    if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return
    if request.endpoint in {None, "static", "payment_webhook"}:
        return
    expected = session.get("_csrf_token")
    provided = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token")
    if not expected or not provided or not hmac.compare_digest(expected, provided):
        abort(400, description="CSRF validation failed.")


def source_metadata_from_request(language: str) -> dict:
    return {
        "utm_source": request.values.get("utm_source"),
        "utm_campaign": request.values.get("utm_campaign"),
        "landing_path": request.path,
        "referrer": request.referrer,
        "device_class": "mobile" if "Mobile" in request.user_agent.string else "desktop",
        "language": language,
        "created_from_public_booking_flow": True,
    }


def current_user() -> User | None:
    if getattr(g, "current_staff_user", None) is not None:
        return g.current_staff_user
    if current_app_testing() and session.get("staff_user_id"):
        return db.session.get(User, UUID(session["staff_user_id"]))
    return None


def require_user() -> User:
    user = current_user()
    if not user:
        abort(401)
    return user


def require_permission(permission_code: str) -> User:
    user = require_user()
    if not user.has_permission(permission_code):
        abort(403)
    return user


def can(permission_code: str) -> bool:
    user = current_user()
    if not user:
        return False
    return user.has_permission(permission_code)


def current_settings() -> dict[str, dict]:
    return {setting.key: setting.value_json for setting in AppSetting.query.filter_by(deleted_at=None).all()}


def current_app_testing() -> bool:
    try:
        from flask import current_app

        return bool(current_app.config.get("TESTING"))
    except RuntimeError:
        return False


def truthy_setting(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "on", "yes"}


def parse_optional_uuid(value: str | None) -> UUID | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    return UUID(candidate)


def parse_optional_date(value: str | None) -> date | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    return date.fromisoformat(candidate)


def parse_optional_datetime(value: str | None) -> datetime | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    parsed = datetime.fromisoformat(candidate)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=datetime.now().astimezone().tzinfo)
    return parsed


def resolve_report_date_range(*, preset: str, requested_start: date | None, requested_end: date | None) -> tuple[str, date, date]:
    today = date.today()
    normalized = preset or "next_7_days"
    if normalized == "today":
        return normalized, today, today
    if normalized == "tomorrow":
        tomorrow = today + timedelta(days=1)
        return normalized, tomorrow, tomorrow
    if normalized == "next_30_days":
        return normalized, today, today + timedelta(days=29)
    if normalized == "current_month":
        month_start = today.replace(day=1)
        if today.month == 12:
            month_end = today.replace(year=today.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            month_end = today.replace(month=today.month + 1, day=1) - timedelta(days=1)
        return normalized, month_start, month_end
    if normalized == "custom" and requested_start and requested_end and requested_start <= requested_end:
        return normalized, requested_start, requested_end
    return "next_7_days", today, today + timedelta(days=6)


def report_date_presets() -> list[dict[str, str]]:
    return [
        {"value": "today", "label": "Today"},
        {"value": "tomorrow", "label": "Tomorrow"},
        {"value": "next_7_days", "label": "Next 7 days"},
        {"value": "next_30_days", "label": "Next 30 days"},
        {"value": "current_month", "label": "Current month"},
        {"value": "custom", "label": "Custom"},
    ]


def format_report_date_range(start_date: date, end_date: date) -> str:
    if start_date == end_date:
        return start_date.strftime("%d %b %Y")
    return f"{start_date.strftime('%d %b %Y')} - {end_date.strftime('%d %b %Y')}"


def parse_optional_int(value: str | None) -> int | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    return int(candidate)


def parse_decimal(value: str | None, *, default: str | None = None) -> Decimal:
    candidate = default if (value is None or str(value).strip() == "") and default is not None else value
    if candidate is None:
        raise ValueError("A decimal value is required.")
    return Decimal(str(candidate))


def parse_optional_decimal(value: str | None) -> Decimal | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    return Decimal(candidate)


def is_admin_user(user: User | None = None) -> bool:
    subject = user or current_user()
    if not subject:
        return False
    return any(role.code == "admin" for role in subject.roles)


def require_admin_role(user: User | None = None) -> User:
    subject = user or require_user()
    if not is_admin_user(subject):
        abort(403)
    return subject


def can_access_admin_workspace(user: User | None = None) -> bool:
    subject = user or current_user()
    if not subject:
        return False
    required = {"settings.view", "user.view", "rate_rule.view", "audit.view"}
    return bool(subject.permission_codes.intersection(required))


def require_admin_workspace_access() -> User:
    user = require_user()
    if not can_access_admin_workspace(user):
        abort(403)
    return user


def available_admin_sections() -> list[dict[str, str]]:
    user = current_user()
    if not user:
        return []
    sections: list[dict[str, str]] = []
    if can("settings.view"):
        sections.append(
            {"key": "property", "label": "Property Setup", "endpoint": "staff_admin_property", "description": "Rooms, room types, branding"}
        )
        sections.append(
            {"key": "operations", "label": "Operations Settings", "endpoint": "staff_admin_operations", "description": "Policies, templates, housekeeping defaults"}
        )
        sections.append(
            {"key": "communications", "label": "Communications", "endpoint": "staff_admin_communications", "description": "Notification settings, delivery history, reminder runs"}
        )
        sections.append(
            {"key": "payments", "label": "Payments", "endpoint": "staff_admin_payments", "description": "Hosted payment behavior"}
        )
    if can("rate_rule.view") or can("settings.view"):
        sections.append(
            {"key": "rates_inventory", "label": "Rates & Inventory", "endpoint": "staff_admin_rates_inventory", "description": "Rate rules, overrides, blackout dates"}
        )
    if can("user.view"):
        sections.append(
            {"key": "staff_access", "label": "Staff & Access", "endpoint": "staff_admin_staff_access", "description": "Users, roles, permissions"}
        )
    if can("audit.view"):
        sections.append(
            {"key": "audit", "label": "Audit", "endpoint": "staff_admin_audit", "description": "Configuration and system history"}
        )
    return sections

