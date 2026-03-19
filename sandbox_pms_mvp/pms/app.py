from __future__ import annotations

import hmac
import json
import secrets
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from time import perf_counter
from urllib.parse import urlparse
from urllib.parse import urlencode
from uuid import UUID

import sqlalchemy as sa
import click
from flask import Flask, Response, abort, current_app, flash, g, jsonify, redirect, render_template, request, session, url_for
from markupsafe import Markup, escape

from .activity import write_activity_log
from .audit import write_audit_log
from .branding import (
    absolute_public_url as branding_absolute_public_url,
    branding_settings_context,
    clean_branding_form,
    email_href as branding_email_href,
    line_href as branding_line_href,
    phone_href as branding_phone_href,
    resolve_public_base_url,
    whatsapp_href as branding_whatsapp_href,
)
from .config import Config, normalize_runtime_config
from .constants import (
    BLACKOUT_TYPES,
    BOOKING_EXTRA_PRICING_MODES,
    BOOKING_SOURCE_CHANNELS,
    CONVERSATION_CHANNEL_TYPES,
    CONVERSATION_STATUSES,
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
from .front_desk_board_runtime import (
    check_board_v2_feature_gate,
    front_desk_board_v2_enabled,
    log_front_desk_board_metric,
)
from .i18n import LANGUAGE_LABELS, normalize_language, t
from .models import (
    ActivityLog,
    AppSetting,
    AuditLog,
    BlackoutPeriod,
    CalendarFeed,
    CancellationRequest,
    ConversationThread,
    EmailOutbox,
    ExternalCalendarBlock,
    ExternalCalendarSource,
    Guest,
    InventoryOverride,
    MfaFactor,
    NotificationDelivery,
    NotificationTemplate,
    PaymentRequest,
    Permission,
    PolicyDocument,
    PreCheckIn,
    Reservation,
    ReservationDocument,
    ReservationHold,
    ReservationReviewQueue,
    Role,
    RateRule,
    Room,
    RoomType,
    StaffNotification,
    User,
    UserPreference,
    UserSession,
    utc_now,
)
from .normalization import normalize_phone
from .pricing import get_setting_value, quote_reservation
from .permissions import can_manage_operational_overrides, default_dashboard_endpoint_for_user
from .security import configure_app_security, current_request_id, public_error_message, request_client_ip
from .seeds import bootstrap_inventory_horizon, seed_all, seed_reference_data, seed_roles_permissions
from .settings import NOTIFICATION_TEMPLATE_PLACEHOLDERS
from .url_topology import booking_engine_base_url, canonical_redirect_url, marketing_site_base_url, staff_app_base_url
from .helpers import (
    absolute_public_url,
    action_datetime_for_form_date,
    add_anchor_to_path,
    available_admin_sections,
    can,
    can_access_admin_workspace,
    _contact_link,
    current_app_testing,
    current_language,
    current_settings,
    current_user,
    default_dashboard_endpoint,
    default_dashboard_url,
    email_href,
    ensure_csrf_token,
    format_report_date_range,
    is_admin_user,
    is_staff_or_provider_endpoint,
    make_language_url,
    parse_booking_extra_ids,
    parse_decimal,
    parse_optional_date,
    parse_optional_datetime,
    parse_optional_decimal,
    parse_optional_int,
    parse_optional_uuid,
    parse_request_date_arg,
    parse_request_form_date,
    parse_request_int_arg,
    parse_request_uuid_arg,
    phone_href,
    public_base_url,
    report_date_presets,
    require_admin_role,
    require_admin_workspace_access,
    require_any_permission,
    require_permission,
    require_user,
    resolve_report_date_range,
    rotate_csrf_token,
    safe_back_path,
    truthy_setting,
    validate_csrf_request,
)
from .services.admin_service import (
    BlackoutPayload,
    InventoryOverridePayload,
    NotificationTemplatePayload,
    PolicyPayload,
    RateRulePayload,
    RoomPayload,
    RoomTypePayload,
    create_inventory_override,
    policy_text,
    preview_notification_template,
    query_audit_entries,
    release_inventory_override,
    summarize_audit_entry,
    update_inventory_override,
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
from .services.extras_service import (
    BookingExtraPayload,
    list_booking_extras,
    quote_booking_extras,
    reservation_extra_summary,
    resolve_booking_extras,
    upsert_booking_extra,
)
from .services.front_desk_service import (
    CheckInPayload,
    CheckoutPayload,
    FrontDeskFilters,
    NoShowPayload,
    WalkInCheckInPayload,
    auto_cancel_no_shows,
    complete_check_in,
    complete_checkout,
    create_walk_in_and_check_in,
    get_front_desk_detail,
    list_front_desk_workspace,
    prepare_checkout,
    process_no_show,
)
from .services.front_desk_board_service import (
    FrontDeskBoardFilters,
    build_front_desk_board,
    flatten_front_desk_blocks,
    list_front_desk_room_groups,
    serialize_front_desk_board,
)
from .services.ical_service import (
    calendar_timezone,
    create_calendar_feed,
    create_external_calendar_source,
    export_feed_ical,
    export_front_desk_blocks_ical,
    provider_calendar_context,
    rotate_calendar_feed,
    stage_ical_import,
    sync_all_external_calendar_sources,
    sync_external_calendar_source,
)
from .services.payment_integration_service import (
    DEPOSIT_HOSTED_REQUEST_TYPES,
    create_or_reuse_payment_request,
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
    build_room_type_content,
    confirm_public_booking,
    create_reservation_hold,
    load_public_confirmation,
    search_public_availability,
    submit_cancellation_request,
    submit_modification_request,
)
from .services.provider_portal_service import (
    ProviderBookingFilters,
    get_provider_booking_detail,
    list_provider_bookings,
    provider_cancel_booking,
    provider_create_deposit_request,
    provider_dashboard_context,
    provider_refresh_payment_status,
    provider_resend_payment_link,
)
from .services.pre_checkin_service import (
    DocumentVerifyPayload,
    PreCheckInSavePayload,
    build_pre_checkin_link,
    fire_pre_checkin_not_completed_events,
    generate_pre_checkin,
    get_document_serve_url,
    get_documents_for_reservation,
    get_pre_checkin_context,
    get_pre_checkin_for_reservation,
    list_todays_arrivals_with_readiness,
    load_pre_checkin_by_token,
    mark_opened,
    mark_rejected,
    mark_verified,
    read_document_bytes,
    save_pre_checkin,
    send_pre_checkin_link_email,
    upload_document,
    validate_token_access,
    verify_document,
)
from .services.reporting_service import build_csv_rows, build_daily_report, build_front_desk_dashboard, build_manager_dashboard
from .services.reservation_service import ReservationCreatePayload, create_reservation, expire_stale_waitlist, promote_eligible_waitlist
from .services.messaging_service import (
    ComposePayload as MessagingComposePayload,
    InboxFilters as MessagingInboxFilters,
    assign_thread,
    close_thread,
    fire_automation_event,
    get_thread_detail,
    list_inbox,
    list_message_templates as list_msg_templates,
    mark_thread_read,
    process_pending_automations,
    record_inbound_message,
    reopen_thread,
    reservation_messages,
    send_message as messaging_send_message,
    toggle_followup,
    total_unread_count,
    upsert_message_template as upsert_msg_template,
)
from .services.staff_reservations_service import (
    GuestUpdatePayload,
    ReservationNotePayload,
    ReservationWorkspaceFilters,
    StayDateChangePayload,
    add_reservation_note,
    approve_modification_request,
    assign_room,
    build_reservation_summary,
    cancel_reservation_workspace,
    change_stay_dates,
    decline_modification_request,
    get_reservation_detail,
    list_arrivals,
    list_departures,
    list_in_house,
    list_reservations,
    quote_modification_request,
    resend_confirmation,
    search_guests,
    get_guest_detail,
    update_guest_details,
)


BOOKING_ATTRIBUTION_SESSION_KEY = "_booking_attribution"
BOOKING_ATTRIBUTION_FIRST_TOUCH_KEYS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "source_label",
    "referrer_host",
    "entry_page",
    "landing_path",
    "entry_cta_source",
}
BOOKING_ATTRIBUTION_TRACKED_ENDPOINTS = {
    "index",
    "availability",
    "booking_entry",
    "booking_hold",
    "booking_confirm",
    "public.availability",
    "public.booking_entry",
    "public.booking_hold",
    "public.booking_confirm",
}
PUBLIC_BOOKING_LANDING_ENDPOINTS = {"index", "availability", "booking_entry", "public.availability", "public.booking_entry"}
PUBLIC_NON_CACHEABLE_ENDPOINTS = {
    "booking_confirmation",
    "booking_cancel_request",
    "booking_modify_request",
    "public_payment_return",
    "public_payment_start",
    "public.booking_confirmation",
    "public.booking_cancel_request",
    "public.booking_modify_request",
    "public.public_payment_return",
    "public.public_payment_start",
}
PUBLIC_WEBHOOK_ENDPOINTS = {"payment_webhook", "public.payment_webhook"}


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__, template_folder="../templates", static_folder="../static")
    app.config.from_object(Config)
    if test_config:
        app.config.update(test_config)
    normalize_runtime_config(app.config, override_keys=set((test_config or {}).keys()))
    configure_app_security(app)
    db.init_app(app)
    migrate.init_app(app, db)

    register_template_helpers(app)
    register_url_topology_hooks(app)
    register_board_v2_feature_gates(app)
    register_auth_hooks(app)
    register_cli(app)

    from .routes.auth import auth_bp
    from .routes.provider import provider_bp
    from .routes.housekeeping import housekeeping_bp
    from .routes.messaging import messaging_bp
    from .routes.reports import reports_bp
    from .routes.cashier import cashier_bp
    from .routes.staff_reservations import staff_reservations_bp
    from .routes.front_desk import front_desk_bp
    from .routes.admin import admin_bp
    from .routes.public import public_bp
    app.register_blueprint(auth_bp)
    app.register_blueprint(provider_bp)
    app.register_blueprint(housekeeping_bp)
    app.register_blueprint(messaging_bp)
    app.register_blueprint(reports_bp)
    app.register_blueprint(cashier_bp)
    app.register_blueprint(staff_reservations_bp)
    app.register_blueprint(front_desk_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(public_bp)

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
        g.booking_attribution = {}

        capture_public_booking_attribution()

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
                "auth.staff_mfa_verify",
                "auth.staff_logout",
                "static",
            }
            if request.endpoint not in allowed_endpoints:
                return redirect(url_for("auth.staff_mfa_verify"))

        if g.current_staff_user and (g.current_staff_user.force_password_reset or g.current_staff_user.account_state == "password_reset_required"):
            allowed_endpoints = {
                "auth.staff_security",
                "auth.staff_logout",
                "auth.staff_mfa_verify",
                "static",
            }
            if request.endpoint not in allowed_endpoints:
                flash("Password reset is required before continuing.", "warning")
                return redirect(url_for("auth.staff_security"))

        if g.current_staff_user and request.endpoint in {"auth.staff_login", "auth.staff_forgot_password", "auth.staff_reset_password"}:
            return redirect(default_dashboard_url(g.current_staff_user))

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
        if request.endpoint in PUBLIC_NON_CACHEABLE_ENDPOINTS:
            response.headers["Cache-Control"] = "no-store, private, max-age=0"
            response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
        return response


def register_url_topology_hooks(app: Flask) -> None:
    @app.before_request
    def enforce_canonical_host():
        redirect_url = canonical_redirect_url()
        if redirect_url:
            return redirect(redirect_url, code=302)
        return None


def register_board_v2_feature_gates(app: Flask) -> None:
    """Register feature gate checks for v2 board endpoints."""
    @app.before_request
    def check_v2_board_access():
        check_board_v2_feature_gate()


def register_template_helpers(app: Flask) -> None:
    @app.template_filter("money")
    def money_filter(value) -> str:
        return f"{Decimal(value or 0):,.2f}"

    @app.context_processor
    def inject_globals():
        language = current_language()
        branding = branding_settings_context()
        hotel_name = branding["hotel_name"]
        hotel_currency = branding["currency"]
        hotel_brand_mark = branding["brand_mark"]
        hotel_logo_url = absolute_public_url(branding["logo_url"]) if branding["logo_url"] else ""
        default_logo_url = url_for("static", filename="branding/sandbox-hotel-logo-safe-256.png")
        hotel_contact_phone = branding["contact_phone"]
        hotel_contact_email = branding["contact_email"]
        hotel_contact_line_url = branding["contact_line_url"]
        hotel_contact_whatsapp_url = branding["contact_whatsapp_url"]
        hotel_address = branding["address"]
        hotel_check_in_time = branding["check_in_time"]
        hotel_check_out_time = branding["check_out_time"]
        site_base_url = branding["public_base_url"] or absolute_public_url("/")
        favicon_url = absolute_public_url(url_for("static", filename="favicon.svg"))
        favicon_ico_url = absolute_public_url(url_for("static", filename="branding/sandbox-hotel-favicon.ico"))
        apple_touch_icon_url = absolute_public_url(url_for("static", filename="branding/sandbox-hotel-logo-safe-180.png"))
        default_share_image_url = absolute_public_url(url_for("static", filename="hotel-share.svg"))
        share_image_url = hotel_logo_url or default_share_image_url
        hotel_contact_phone_href = phone_href(hotel_contact_phone)
        hotel_contact_email_href = email_href(hotel_contact_email)
        hotel_contact_line_href = branding_line_href(hotel_contact_line_url)
        hotel_contact_whatsapp_href = branding_whatsapp_href(hotel_contact_whatsapp_url)
        hotel_structured_data: dict[str, object] = {
            "@context": "https://schema.org",
            "@type": "Hotel",
            "name": hotel_name,
            "url": site_base_url,
            "telephone": hotel_contact_phone,
            "email": hotel_contact_email,
            "currenciesAccepted": hotel_currency,
            "availableLanguage": list(LANGUAGE_LABELS.keys()),
            "checkinTime": hotel_check_in_time,
            "checkoutTime": hotel_check_out_time,
        }
        if share_image_url:
            hotel_structured_data["image"] = share_image_url
        if hotel_address:
            hotel_structured_data["address"] = {
                "@type": "PostalAddress",
                "streetAddress": hotel_address,
            }

        def _language_url(lang_code: str, *, preserve_query: bool) -> str:
            try:
                args = dict(request.view_args or {})
                if preserve_query:
                    for key, value in request.args.items():
                        if key == "lang":
                            continue
                        if key == "back":
                            safe_back = safe_back_path(value, "")
                            if not safe_back:
                                continue
                            args[key] = safe_back
                            continue
                        args[key] = value
                args["lang"] = lang_code
                return url_for(request.endpoint, **args)
            except Exception:  # noqa: BLE001
                return url_for("index", lang=lang_code)

        def _make_lang_url(lang_code: str) -> str:
            return _language_url(lang_code, preserve_query=True)

        def _absolute_route_url(path: str) -> str:
            candidate = str(path or "").strip()
            if not candidate:
                return ""
            if is_staff_or_provider_endpoint(request.endpoint):
                normalized_path = candidate if candidate.startswith("/") else f"/{candidate.lstrip('/')}"
                return f"{staff_app_base_url()}{normalized_path}"
            return absolute_public_url(candidate)

        canonical_url = _absolute_route_url(_language_url(language, preserve_query=False))
        language_alternate_urls = {}
        if request.endpoint and not is_staff_or_provider_endpoint(request.endpoint):
            language_alternate_urls = {
                code: _absolute_route_url(_language_url(code, preserve_query=False))
                for code in LANGUAGE_LABELS
            }
        is_public_site = bool(
            request.endpoint
            and request.endpoint != "static"
            and not is_staff_or_provider_endpoint(request.endpoint)
        )
        current_staff = current_user()
        marketing_site_url = marketing_site_base_url(required=False)
        return {
            "hotel_name": hotel_name,
            "currency": hotel_currency,
            "hotel_brand_mark": hotel_brand_mark,
            "hotel_logo_url": hotel_logo_url,
            "default_logo_url": default_logo_url,
            "hotel_support_contact_text": branding["support_contact_text"],
            "hotel_contact_phone": hotel_contact_phone,
            "hotel_contact_email": hotel_contact_email,
            "hotel_contact_line_url": hotel_contact_line_url,
            "hotel_contact_whatsapp_url": hotel_contact_whatsapp_url,
            "hotel_contact_phone_href": hotel_contact_phone_href,
            "hotel_contact_email_href": hotel_contact_email_href,
            "hotel_contact_line_href": hotel_contact_line_href,
            "hotel_contact_whatsapp_href": hotel_contact_whatsapp_href,
            "hotel_contact_phone_link": _contact_link(hotel_contact_phone_href, hotel_contact_phone),
            "hotel_contact_email_link": _contact_link(hotel_contact_email_href, hotel_contact_email),
            "hotel_contact_line_link": _contact_link(hotel_contact_line_href, "LINE"),
            "hotel_contact_whatsapp_link": _contact_link(hotel_contact_whatsapp_href, "WhatsApp"),
            "hotel_address": hotel_address,
            "hotel_check_in_time": hotel_check_in_time,
            "hotel_check_out_time": hotel_check_out_time,
            "hotel_accent_color": branding["accent_color"],
            "hotel_accent_color_soft": branding["accent_color_soft"],
            "hotel_accent_color_dark": branding["accent_color_dark"],
            "hotel_accent_rgb": branding["accent_rgb"],
            "hotel_accent_soft_rgb": branding["accent_soft_rgb"],
            "hotel_theme_color": branding["accent_color"],
            "site_base_url": site_base_url,
            "canonical_url": canonical_url,
            "favicon_url": favicon_url,
            "favicon_ico_url": favicon_ico_url,
            "apple_touch_icon_url": apple_touch_icon_url,
            "share_image_url": share_image_url,
            "hotel_structured_data": hotel_structured_data,
            "is_public_site": is_public_site,
            "marketing_site_url": marketing_site_url,
            "booking_engine_url": site_base_url,
            "staff_app_url": staff_app_base_url() if site_base_url else "",
            "staff_logged_in": current_staff is not None,
            "provider_logged_in": bool(current_staff and current_staff.has_permission("provider.dashboard.view")),
            "current_staff_user": current_staff,
            "current_language": language,
            "booking_attribution": current_booking_attribution(),
            "language_labels": LANGUAGE_LABELS,
            "language_alternate_urls": language_alternate_urls,
            "t": lambda key, **kwargs: t(language, key, **kwargs),
            "make_lang_url": _make_lang_url,
            "can": can,
            "admin_sections": available_admin_sections(),
            "default_dashboard_url": default_dashboard_url(current_staff) if current_staff else "",
            "csrf_token": ensure_csrf_token,
            "csrf_input": lambda: Markup(
                f'<input type="hidden" name="csrf_token" value="{ensure_csrf_token()}">'
            ),
            "messaging_unread_count": total_unread_count() if (
                current_staff and current_staff.has_permission("messaging.view")
                and request.endpoint and is_staff_or_provider_endpoint(request.endpoint)
            ) else 0,
            "CONVERSATION_CHANNEL_TYPES": CONVERSATION_CHANNEL_TYPES,
            "CONVERSATION_STATUSES": CONVERSATION_STATUSES,
        }


def register_cli(app: Flask) -> None:
    @app.cli.command("seed-reference-data")
    def seed_reference_data_command() -> None:
        seed_reference_data(sync_existing_roles=False)
        print("Reference data seeded.")

    @app.cli.command("sync-role-permissions")
    def sync_role_permissions_command() -> None:
        seed_roles_permissions(sync_existing_roles=True)
        db.session.commit()
        print("System role permissions synchronized.")

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

    @app.cli.command("fire-pre-checkin-reminders")
    @click.option(
        "--hours-before",
        default=48,
        type=int,
        help="Hours before check-in to target (default: 48).",
    )
    def fire_pre_checkin_reminders_command(hours_before: int) -> None:
        """Fire pre_checkin_not_completed automation events for upcoming arrivals.

        Run daily via cron ~48 hours before check-in day to nudge guests who
        have not submitted (or not started) their digital pre-check-in.
        """
        result = fire_pre_checkin_not_completed_events(hours_before=hours_before)
        print(f"Pre-check-in reminder events: fired={result['fired']}, skipped={result['skipped']}")

    @app.cli.command("sync-ical-sources")
    def sync_ical_sources_command() -> None:
        result = sync_all_external_calendar_sources(actor_user_id=None)
        print(f"iCal sync result: {result}")

    @app.cli.command("process-automation-events")
    def process_automation_events_command() -> None:
        result = process_pending_automations()
        print(
            f"Automation events processed: {result['processed']} sent, "
            f"{result['skipped']} skipped, {result['errors']} errors."
        )

    @app.cli.command("process-waitlist")
    @click.option("--max-age-days", default=14, type=int, help="Expire waitlist entries older than N days (default: 14).")
    def process_waitlist_command(max_age_days: int) -> None:
        """Promote eligible waitlisted reservations and expire stale ones."""
        promo = promote_eligible_waitlist()
        expiry = expire_stale_waitlist(max_age_days=max_age_days)
        print(
            f"Waitlist: {promo['promoted']} promoted, {promo['skipped']} skipped, "
            f"{expiry['expired']} expired."
        )

    @app.cli.command("auto-cancel-no-shows")
    @click.option("--date", "target_date", default=None, type=click.DateTime(formats=["%Y-%m-%d"]), help="Business date (default: today).")
    def auto_cancel_no_shows_command(target_date: datetime | None) -> None:
        """Auto-cancel same-day no-shows after cutoff hour."""
        biz_date = target_date.date() if target_date else None
        result = auto_cancel_no_shows(business_date=biz_date)
        print(
            f"No-show auto-cancel: {result['processed']} processed, "
            f"{result['skipped']} skipped, {result['errors']} errors."
            + (f" ({result.get('reason', '')})" if result.get("reason") else "")
        )


    # Check-in form helpers moved to front_desk_bp


def register_routes(app: Flask) -> None:
    @app.route("/")
    def index():
        return render_template("index.html", room_types=RoomType.query.order_by(RoomType.code.asc()).all())

    @app.route("/health")
    def health():
        try:
            db.session.execute(sa.text("SELECT 1"))
        except Exception:  # noqa: BLE001
            return jsonify({"status": "db_error"}), 503
        return jsonify({"status": "ok"})

    @app.route("/robots.txt")
    def robots_txt():
        body = "\n".join(
            [
                "User-agent: *",
                "Disallow: /staff/",
                "Disallow: /booking/hold",
                f"Sitemap: {absolute_public_url(url_for('sitemap_xml'))}",
            ]
        )
        return Response(f"{body}\n", mimetype="text/plain")

    @app.route("/favicon.ico")
    def favicon_ico():
        return redirect(url_for("static", filename="branding/sandbox-hotel-favicon.ico"), code=302)

    @app.route("/manifest.json")
    def web_manifest():
        branding = branding_settings_context()
        hotel_name = branding["hotel_name"]
        manifest = {
            "name": hotel_name,
            "short_name": branding["brand_mark"] or hotel_name[:12],
            "icons": [
                {
                    "src": url_for("static", filename="branding/sandbox-hotel-logo-safe-192.png"),
                    "sizes": "192x192",
                    "type": "image/png",
                },
                {
                    "src": url_for("static", filename="branding/sandbox-hotel-logo-safe-512.png"),
                    "sizes": "512x512",
                    "type": "image/png",
                },
            ],
            "theme_color": branding["accent_color"],
            "background_color": "#0b0d11",
            "display": "standalone",
            "start_url": "/",
        }
        return Response(json.dumps(manifest), mimetype="application/manifest+json")

    @app.route("/sitemap.xml")
    def sitemap_xml():
        public_pages = [
            ("index", {}),
            ("public.booking_entry", {}),
            ("public.booking_cancel_request", {}),
            ("public.booking_modify_request", {}),
        ]
        urls: list[str] = []
        for endpoint, values in public_pages:
            urls.append(absolute_public_url(url_for(endpoint, **values)))
            for language_code in LANGUAGE_LABELS:
                urls.append(absolute_public_url(url_for(endpoint, lang=language_code, **values)))
        unique_urls = list(dict.fromkeys(url for url in urls if url))
        body = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ]
        body.extend(f"<url><loc>{escape(url)}</loc></url>" for url in unique_urls)
        body.append("</urlset>")
        return Response("\n".join(body), mimetype="application/xml")

    # Public booking, payment, calendar, and pre-check-in routes moved to public_bp

    # Admin routes moved to admin_bp

    @app.route("/staff")
    def staff_dashboard():
        user = require_permission("reservation.view")
        today = date.today()
        queue_entries = (
            ReservationReviewQueue.query.order_by(ReservationReviewQueue.created_at.desc()).limit(10).all()
        )
        notifications = StaffNotification.query.filter_by(status="new").order_by(StaffNotification.created_at.desc()).limit(10).all()
        pending_emails = EmailOutbox.query.filter(EmailOutbox.status.in_(["pending", "failed"])).count()
        dashboard = build_front_desk_dashboard(
            business_date=today,
            include_housekeeping=user.has_permission("housekeeping.view"),
            include_financials=user.has_permission("folio.view"),
        )
        return render_template(
            "staff_dashboard.html",
            dashboard=dashboard,
            queue_entries=queue_entries,
            notifications=notifications,
            pending_emails=pending_emails,
            arrivals_count=dashboard["arrivals"]["count"],
            departures_count=dashboard["departures"]["count"],
            in_house_count=dashboard["in_house"]["count"],
            can_housekeeping=user.has_permission("housekeeping.view"),
            can_folio=user.has_permission("folio.view"),
            can_reports=user.has_permission("reports.view"),
        )

    @app.route("/staff/notifications/<uuid:notification_id>/read", methods=["POST"])
    def staff_notification_read(notification_id):
        require_permission("reservation.view")
        notification = db.session.get(StaffNotification, notification_id)
        if not notification:
            abort(404)
        notification.status = "read"
        notification.read_at = utc_now()
        db.session.commit()
        return redirect(request.form.get("back_url") or url_for("staff_dashboard"))

    # Front desk routes moved to front_desk_bp








def resolve_public_room_type_query() -> RoomType | None:
    room_type_code = (request.args.get("room_type") or "").strip()
    if room_type_code:
        room_type = (
            RoomType.query.filter(
                sa.func.lower(RoomType.code) == room_type_code.lower(),
                RoomType.is_active.is_(True),
            )
            .order_by(RoomType.code.asc())
            .first()
        )
        if not room_type:
            abort(400, description="Invalid room_type query parameter.")
        return room_type

    room_type_id = parse_request_uuid_arg("room_type_id")
    if not room_type_id:
        return None

    room_type = db.session.get(RoomType, UUID(room_type_id))
    if not room_type or not room_type.is_active:
        abort(400, description="Invalid room_type_id query parameter.")
    return room_type


def public_guest_counts_from_request() -> tuple[int, int]:
    if request.args.get("adults") or request.args.get("children"):
        return (
            parse_request_int_arg("adults", default=2, minimum=1),
            parse_request_int_arg("children", default=0, minimum=0),
        )
    if request.args.get("guests"):
        return parse_request_int_arg("guests", default=2, minimum=1), 0
    return 2, 0


def ensure_booking_nonce() -> str:
    if not session.get("_booking_nonce"):
        session["_booking_nonce"] = secrets.token_hex(8)
    return session["_booking_nonce"]


def build_public_booking_entry_context() -> dict[str, object]:
    language = current_language()
    check_in_date = parse_request_date_arg("check_in", default=None)
    check_out_date = parse_request_date_arg("check_out", default=None)
    adults, children = public_guest_counts_from_request()
    room_type = resolve_public_room_type_query()
    results: list[dict] = []
    error = None

    if check_in_date and check_out_date:
        try:
            results = search_public_availability(
                PublicSearchPayload(
                    check_in_date=check_in_date,
                    check_out_date=check_out_date,
                    adults=adults,
                    children=children,
                    room_type_id=room_type.id if room_type else None,
                    language=language,
                )
            )
        except Exception as exc:  # noqa: BLE001
            error = public_error_message(exc)

    return {
        "results": results,
        "form_data": {
            "check_in": check_in_date.isoformat() if check_in_date else "",
            "check_out": check_out_date.isoformat() if check_out_date else "",
            "adults": str(adults),
            "children": str(children),
            "room_type": room_type.code if room_type else "",
            "room_type_id": str(room_type.id) if room_type else parse_request_uuid_arg("room_type_id") or "",
            "language": language,
        },
        "error": error,
        "room_types": RoomType.query.order_by(RoomType.code.asc()).all(),
        "booking_nonce": ensure_booking_nonce(),
    }


def public_request_form_defaults(*field_names: str) -> dict[str, str]:
    return {field_name: str(request.values.get(field_name) or "").strip() for field_name in field_names}


def capture_public_booking_attribution() -> None:
    existing = dict(session.get(BOOKING_ATTRIBUTION_SESSION_KEY) or {})
    if not _should_track_booking_attribution():
        g.booking_attribution = existing
        return

    incoming = booking_attribution_from_request()
    if incoming:
        base = {} if booking_request_starts_new_attribution() else existing
        merged = merge_booking_attribution(base, incoming)
    elif existing:
        merged = existing
    else:
        merged = default_booking_attribution()

    if merged:
        merged["source_channel"] = resolve_booking_source_channel(merged.get("source_channel"), merged)
        if merged != existing:
            session[BOOKING_ATTRIBUTION_SESSION_KEY] = merged
            session.modified = True
        g.booking_attribution = merged
        return

    g.booking_attribution = {}


def current_booking_attribution() -> dict:
    return dict(getattr(g, "booking_attribution", None) or session.get(BOOKING_ATTRIBUTION_SESSION_KEY) or {})


def booking_attribution_from_request() -> dict:
    if not _should_track_booking_attribution():
        return {}

    referrer_host = external_referrer_host()
    entry_page = clean_public_path(request.values.get("entry_page")) or clean_public_path(request.path)
    source_label = derive_source_label(
        request.values.get("source_label"),
        request.values.get("utm_source"),
        referrer_host,
        request.values.get("source_channel"),
    )
    entry_cta_source = clean_tracking_value(request.values.get("cta_source") or request.values.get("entry_cta_source"))
    incoming = {
        "utm_source": clean_tracking_value(request.values.get("utm_source")),
        "utm_medium": clean_tracking_value(request.values.get("utm_medium")),
        "utm_campaign": clean_tracking_value(request.values.get("utm_campaign")),
        "utm_content": clean_tracking_value(request.values.get("utm_content")),
        "source_label": source_label,
        "referrer_host": referrer_host or clean_tracking_value(request.values.get("referrer_host")),
        "entry_page": entry_page,
        "landing_path": clean_public_path(request.values.get("landing_path")) or entry_page,
        "entry_cta_source": entry_cta_source,
        "source_channel": clean_tracking_value(request.values.get("source_channel"), limit=40),
    }
    return {key: value for key, value in incoming.items() if value not in {None, ""}}


def booking_request_starts_new_attribution() -> bool:
    if request.method != "GET":
        return False
    if clean_public_path(request.args.get("entry_page")):
        return False
    if any(
        clean_tracking_value(request.args.get(key))
        for key in ("utm_source", "utm_medium", "utm_campaign", "utm_content", "source_label")
    ):
        return True
    return bool(external_referrer_host() and request.endpoint in PUBLIC_BOOKING_LANDING_ENDPOINTS)


def default_booking_attribution() -> dict:
    if request.method != "GET" or request.endpoint not in PUBLIC_BOOKING_LANDING_ENDPOINTS:
        return {}
    entry_page = clean_public_path(request.path)
    referrer_host = external_referrer_host()
    default = {
        "source_label": derive_source_label(None, None, referrer_host, "direct_web"),
        "referrer_host": referrer_host,
        "entry_page": entry_page,
        "landing_path": entry_page,
        "entry_cta_source": clean_tracking_value(request.args.get("cta_source") or request.args.get("entry_cta_source")),
        "source_channel": "direct_web",
    }
    return {key: value for key, value in default.items() if value not in {None, ""}}


def merge_booking_attribution(base: dict | None, incoming: dict | None) -> dict:
    merged = dict(base or {})
    for key, value in (incoming or {}).items():
        if value in {None, ""}:
            continue
        if key in BOOKING_ATTRIBUTION_FIRST_TOUCH_KEYS and merged.get(key):
            continue
        merged[key] = value
    return merged


def clean_tracking_value(value: str | None, *, limit: int = 120) -> str | None:
    cleaned = " ".join((value or "").strip().split())
    if not cleaned:
        return None
    return cleaned[:limit]


def clean_public_path(value: str | None) -> str | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    parsed = urlparse(candidate)
    path = parsed.path or "/"
    if not path.startswith("/"):
        path = f"/{path.lstrip('/')}"
    return path[:200]


def normalize_tracking_slug(value: str | None) -> str | None:
    cleaned = clean_tracking_value(value)
    if not cleaned:
        return None
    return cleaned.lower().replace(" ", "_").replace("-", "_")


def external_referrer_host() -> str | None:
    referrer = (request.referrer or "").strip()
    if not referrer:
        return None
    try:
        host = (urlparse(referrer).hostname or "").lower()
    except ValueError:
        return None
    if not host:
        return None
    request_host = (request.host.split(":", 1)[0] or "").lower()
    app_base_url = str(current_app.config.get("APP_BASE_URL") or "").strip()
    app_base_host = (urlparse(app_base_url).hostname or "").lower() if app_base_url else ""
    if host in {request_host, app_base_host}:
        return None
    return host[:120]


def derive_source_label(
    explicit_source_label: str | None,
    utm_source: str | None,
    referrer_host: str | None,
    source_channel: str | None,
) -> str:
    explicit = clean_tracking_value(explicit_source_label)
    if explicit:
        return explicit
    utm = clean_tracking_value(utm_source)
    if utm:
        return utm
    host = clean_tracking_value(referrer_host)
    if host:
        return referrer_source_label(host)
    channel = normalize_tracking_slug(source_channel)
    if channel in BOOKING_SOURCE_CHANNELS:
        return "direct" if channel == "direct_web" else channel
    return "direct"


def referrer_source_label(referrer_host: str) -> str:
    normalized = normalize_tracking_slug(referrer_host) or "referral"
    if "google" in normalized:
        return "google"
    if "facebook" in normalized or normalized.startswith("fb"):
        return "facebook"
    if "instagram" in normalized:
        return "instagram"
    if "line" in normalized:
        return "line"
    if "whatsapp" in normalized:
        return "whatsapp"
    if "tiktok" in normalized:
        return "tiktok"
    labels = [part for part in referrer_host.split(".") if part and part not in {"www", "m", "l"}]
    return labels[0][:80] if labels else referrer_host[:80]


def resolve_booking_source_channel(explicit_source_channel: str | None, attribution: dict | None = None) -> str:
    explicit = normalize_tracking_slug(explicit_source_channel)
    if explicit in BOOKING_SOURCE_CHANNELS:
        return explicit

    attribution = attribution or {}
    candidates = [
        normalize_tracking_slug(attribution.get("source_label")),
        normalize_tracking_slug(attribution.get("utm_source")),
        normalize_tracking_slug(attribution.get("referrer_host")),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        if candidate in {"direct", "direct_web"}:
            return "direct_web"
        if candidate in {"google_business", "gmb"}:
            return "google_business"
        if candidate in {"facebook", "fb"}:
            return "facebook"
        if "line" == candidate:
            return "line"
        if "whatsapp" == candidate:
            return "whatsapp"
        if candidate in {"qr", "qr_code"}:
            return "qr"
        if candidate in {"referral", "partner", "affiliate"}:
            return "referral"
        return "referral"
    return "direct_web"


def _should_track_booking_attribution() -> bool:
    if request.endpoint in {None, "static", *PUBLIC_WEBHOOK_ENDPOINTS}:
        return False
    if is_staff_or_provider_endpoint(request.endpoint):
        return False
    return request.endpoint in BOOKING_ATTRIBUTION_TRACKED_ENDPOINTS


def source_metadata_from_request(language: str, fallback: dict | None = None) -> dict:
    metadata = merge_booking_attribution(fallback, current_booking_attribution())
    metadata = merge_booking_attribution(metadata, booking_attribution_from_request())
    if not metadata:
        metadata = dict(fallback or {}) or default_booking_attribution()
    if not metadata.get("entry_page"):
        metadata["entry_page"] = clean_public_path(request.path) or "/"
    if not metadata.get("landing_path"):
        metadata["landing_path"] = metadata["entry_page"]
    if not metadata.get("source_label"):
        metadata["source_label"] = derive_source_label(
            None,
            metadata.get("utm_source"),
            metadata.get("referrer_host"),
            metadata.get("source_channel"),
        )
    metadata["device_class"] = "mobile" if "Mobile" in request.user_agent.string else "desktop"
    metadata["language"] = language
    metadata["created_from_public_booking_flow"] = True
    return {key: value for key, value in metadata.items() if value not in {None, ""}}


def public_booking_form_context(
    hold: ReservationHold,
    room_type: RoomType,
    *,
    settings: dict[str, dict] | None = None,
    selected_extra_ids: list[UUID] | tuple[UUID, ...] | None = None,
    form_values: dict[str, str] | None = None,
) -> dict:
    resolved_settings = settings or current_settings()
    language = normalize_language(getattr(hold, "booking_language", None) or current_language())
    source_metadata = hold.source_metadata_json if isinstance(hold.source_metadata_json, dict) else {}
    try:
        selected_extras = resolve_booking_extras(selected_extra_ids or [], public_only=True)
    except ValueError:
        selected_extras = []
    extras_quote = quote_booking_extras(
        selected_extras,
        check_in_date=hold.check_in_date,
        check_out_date=hold.check_out_date,
    )
    return {
        "hold": hold,
        "room_type": room_type,
        "room_content": build_room_type_content(room_type),
        "settings": resolved_settings,
        "booking_extras": list_booking_extras(public_only=True),
        "selected_extra_ids": {str(item.id) for item in selected_extras},
        "selected_extras_quote": [
            {
                "id": str(line.booking_extra_id),
                "name": line.name,
                "description": line.description,
                "pricing_mode": line.pricing_mode,
                "pricing_label": "Per night" if line.pricing_mode == "per_night" else "Per stay",
                "quantity": line.quantity,
                "unit_price": line.unit_price,
                "total_amount": line.total_amount,
            }
            for line in extras_quote.lines
        ],
        "extras_total": extras_quote.total_amount,
        "grand_total_with_extras": Decimal(str(hold.quoted_grand_total)) + extras_quote.total_amount,
        "form_values": form_values or {},
        "published_terms_version": resolved_settings.get("booking.terms_version", {}).get("value", "2026-03"),
        "booking_attribution": merge_booking_attribution(source_metadata, current_booking_attribution()),
        "policy_documents": {
            "cancellation": policy_text("cancellation_policy", language, t(language, "policy_summary")),
            "extra_guest": policy_text("child_extra_guest_policy", language, t(language, "extra_guest_summary")),
            "check_in": policy_text("check_in_policy", language, t(language, "checkin_summary")),
            "privacy": policy_text("privacy_notice", language, ""),
        },
    }

# Compatibility export for tests and transitional imports.
# Front desk board helpers moved to front_desk_bp
from .routes.front_desk import front_desk_board_context
