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
    PosChargePayload,
    RefundPostingPayload,
    VoidChargePayload,
    cashier_print_context,
    ensure_room_charges_posted,
    get_cashier_detail,
    issue_cashier_document,
    post_manual_adjustment,
    post_pos_charge,
    record_payment,
    record_refund,
    void_folio_charge,
)
from .services.channel_service import (
    ChannelSyncService,
    build_outbound_inventory_updates,
    get_provider,
    provider_push_context,
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
from .services.housekeeping_service import (
    BlockRoomPayload,
    BulkHousekeepingPayload,
    CreateTaskPayload,
    HousekeepingBoardFilters,
    MaintenanceFlagPayload,
    RoomNotePayload as HousekeepingRoomNotePayload,
    RoomStatusUpdatePayload,
    TaskListFilters,
    add_room_note as add_housekeeping_room_note,
    assign_housekeeping_task,
    bulk_update_housekeeping,
    cancel_housekeeping_task,
    complete_housekeeping_task,
    create_housekeeping_task,
    get_housekeeping_room_detail,
    inspect_housekeeping_task,
    list_housekeeping_board,
    list_housekeeping_tasks,
    set_blocked_state,
    set_maintenance_flag,
    start_housekeeping_task,
    update_housekeeping_status,
)
from .services.group_booking_service import (
    GroupBlockCreatePayload,
    create_group_room_block,
    get_group_block_detail,
    list_group_room_blocks,
    release_group_room_block,
)
from .services.room_readiness_service import (
    is_room_assignable,
    room_readiness_board,
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
    ScannerCapturePayload,
    apply_document_ocr_to_guest,
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
    ingest_scanner_capture,
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
    "public.public_digital_checkout",
    "public.public_digital_checkout_complete",
    "public.public_digital_checkout_pay_balance",
    "public.booking_modify_request",
    "public.public_payment_return",
    "public.public_payment_start",
}
PUBLIC_WEBHOOK_ENDPOINTS = {"payment_webhook", "public.payment_webhook"}


def _load_sentry_sdk():
    try:
        import sentry_sdk
        from sentry_sdk.integrations.flask import FlaskIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
    except ImportError:
        return None, []
    return sentry_sdk, [FlaskIntegration(), SqlalchemyIntegration()]


def _sentry_before_send(event, hint):  # noqa: ARG001
    request_id = current_request_id()
    if request_id:
        event.setdefault("tags", {})["request_id"] = request_id
    return event


def configure_error_monitoring(app: Flask) -> None:
    dsn = str(app.config.get("SENTRY_DSN") or "").strip()
    if not dsn:
        return
    sentry_sdk, integrations = _load_sentry_sdk()
    if sentry_sdk is None:
        app.logger.warning("SENTRY_DSN is set but sentry-sdk is not installed; skipping Sentry initialization.")
        return
    sentry_sdk.init(
        dsn=dsn,
        environment=str(app.config.get("SENTRY_ENVIRONMENT") or app.config.get("APP_ENV") or "development"),
        release=str(app.config.get("SENTRY_RELEASE") or "") or None,
        traces_sample_rate=float(app.config.get("SENTRY_TRACES_SAMPLE_RATE") or 0.0),
        integrations=integrations,
        send_default_pii=False,
        before_send=_sentry_before_send,
    )


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__, template_folder="../templates", static_folder="../static")
    app.config.from_object(Config)
    if test_config:
        app.config.update(test_config)
    normalize_runtime_config(app.config, override_keys=set((test_config or {}).keys()))
    configure_app_security(app)
    db.init_app(app)
    migrate.init_app(app, db)
    configure_error_monitoring(app)

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
            f"{result['skipped']} skipped, {result['errors']} errors, "
            f"{result.get('cleaned_up', 0)} cleaned up."
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
        return render_template(
            "index.html",
            room_types=db.session.execute(sa.select(RoomType).order_by(RoomType.code.asc())).scalars().all(),
        )

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

    @app.route("/staff/sw.js")
    def staff_service_worker():
        script = """
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }
  const url = new URL(event.request.url);
  const cacheName = "sandbox-hk-mobile-v1";
  if (url.pathname.startsWith("/staff/housekeeping")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(cacheName).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  if (url.pathname.startsWith("/static/") || url.pathname === "/manifest.json") {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          return cached;
        }
        return fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(cacheName).then((cache) => cache.put(event.request, copy));
          return response;
        });
      })
    );
  }
});
""".strip()
        return Response(script, mimetype="application/javascript")

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
            db.session.execute(
                sa.select(ReservationReviewQueue)
                .order_by(ReservationReviewQueue.created_at.desc())
                .limit(10)
            )
            .scalars()
            .all()
        )
        notifications = (
            db.session.execute(
                sa.select(StaffNotification)
                .where(StaffNotification.status == "new")
                .order_by(StaffNotification.created_at.desc())
                .limit(10)
            )
            .scalars()
            .all()
        )
        pending_emails = db.session.execute(
            sa.select(sa.func.count())
            .select_from(EmailOutbox)
            .where(EmailOutbox.status.in_(["pending", "failed"]))
        ).scalar_one()
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






    @app.route("/staff/messaging/thread/<uuid:thread_id>/close", methods=["POST"])
    def staff_messaging_close_thread(thread_id):
        actor = require_permission("messaging.send")
        close_thread(str(thread_id), actor_user_id=str(actor.id))
        flash("Conversation closed.", "success")
        return redirect(url_for("staff_messaging_inbox"))

    @app.route("/staff/messaging/thread/<uuid:thread_id>/reopen", methods=["POST"])
    def staff_messaging_reopen_thread(thread_id):
        actor = require_permission("messaging.send")
        reopen_thread(str(thread_id), actor_user_id=str(actor.id))
        flash("Conversation reopened.", "success")
        return redirect(url_for("staff_messaging_thread", thread_id=thread_id))

    @app.route("/staff/messaging/thread/<uuid:thread_id>/followup", methods=["POST"])
    def staff_messaging_toggle_followup(thread_id):
        actor = require_permission("messaging.send")
        is_followup = toggle_followup(str(thread_id), actor_user_id=str(actor.id))
        flash("Follow-up " + ("marked" if is_followup else "cleared") + ".", "success")
        return redirect(url_for("staff_messaging_thread", thread_id=thread_id))

    @app.route("/staff/messaging/thread/<uuid:thread_id>/assign", methods=["POST"])
    def staff_messaging_assign_thread(thread_id):
        actor = require_permission("messaging.send")
        user_id = request.form.get("user_id") or None
        assign_thread(str(thread_id), user_id, actor_user_id=str(actor.id))
        flash("Thread assignment updated.", "success")
        return redirect(url_for("staff_messaging_thread", thread_id=thread_id))

    @app.route("/staff/messaging/compose")
    def staff_messaging_compose():
        require_permission("messaging.send")
        reservation_id = request.args.get("reservation_id", "")
        guest_id = request.args.get("guest_id", "")
        reservation = None
        guest = None
        if reservation_id:
            reservation = db.session.get(Reservation, UUID(reservation_id))
            if reservation and reservation.primary_guest:
                guest = reservation.primary_guest
        elif guest_id:
            guest = db.session.get(Guest, UUID(guest_id))
        templates = list_msg_templates()
        return render_template(
            "staff_messaging_compose.html",
            reservation=reservation,
            guest=guest,
            templates=templates,
        )

    @app.route("/staff/messaging/inbound", methods=["POST"])
    def staff_messaging_inbound_webhook():
        """Webhook endpoint for inbound messages from providers."""
        data = request.get_json(silent=True) or {}
        channel = data.get("channel", "email")
        sender = data.get("sender_address", "")
        body = data.get("body_text", "")
        subject = data.get("subject")
        provider_id = data.get("provider_message_id")
        if not sender or not body:
            return jsonify({"error": "sender_address and body_text required"}), 400
        try:
            msg = record_inbound_message(
                channel=channel,
                sender_address=sender,
                body_text=body,
                subject=subject,
                provider_message_id=provider_id,
            )
            return jsonify({"status": "ok", "message_id": str(msg.id)})
        except Exception as exc:
            db.session.rollback()
            return jsonify({"error": str(exc)}), 500

    @app.route("/provider")
    def provider_dashboard():
        require_permission("provider.dashboard.view")
        target_date = parse_request_date_arg("date", default=date.today())
        dashboard = provider_dashboard_context(business_date=target_date)
        return render_template(
            "provider_dashboard.html",
            dashboard=dashboard,
            target_date=target_date,
            can_manage_payments=can("provider.payment_request.create"),
            can_manage_calendar=can("provider.calendar.manage"),
        )

    @app.route("/provider/bookings")
    def provider_bookings():
        require_permission("provider.booking.view")
        filters = ProviderBookingFilters(
            search=(request.args.get("q") or "").strip(),
            status=request.args.get("status", ""),
            date_from=request.args.get("date_from", ""),
            date_to=request.args.get("date_to", ""),
            deposit_state=request.args.get("deposit_state", ""),
            page=parse_request_int_arg("page", default=1, minimum=1),
            per_page=20,
        )
        result = list_provider_bookings(filters)
        return render_template(
            "provider_bookings.html",
            result=result,
            filters=filters,
            reservation_statuses=RESERVATION_STATUSES,
        )

    @app.route("/provider/bookings/<uuid:reservation_id>")
    def provider_booking_detail(reservation_id):
        require_permission("provider.booking.view")
        detail = get_provider_booking_detail(reservation_id)
        return render_template(
            "provider_booking_detail.html",
            detail=detail,
            back_url=safe_back_path(request.args.get("back"), url_for("provider_bookings")),
            can_manage_payments=can("provider.payment_request.create"),
            can_cancel=can("provider.booking.cancel"),
        )

    @app.route("/provider/bookings/<uuid:reservation_id>/payment-requests", methods=["POST"])
    def provider_booking_payment_request(reservation_id):
        user = require_permission("provider.payment_request.create")
        try:
            provider_create_deposit_request(reservation_id, actor_user_id=user.id)
            flash("Deposit payment request sent to the guest.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("provider_booking_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/provider/payment-requests/<uuid:payment_request_id>/resend", methods=["POST"])
    def provider_payment_request_resend(payment_request_id):
        user = require_permission("provider.payment_request.create")
        reservation_id = request.form.get("reservation_id")
        try:
            provider_resend_payment_link(
                payment_request_id,
                actor_user_id=user.id,
                force_new=request.form.get("force_new_link") == "on",
            )
            flash("Payment link resent.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("provider_booking_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/provider/payment-requests/<uuid:payment_request_id>/refresh", methods=["POST"])
    def provider_payment_request_refresh(payment_request_id):
        user = require_permission("provider.payment_request.create")
        reservation_id = request.form.get("reservation_id")
        try:
            provider_refresh_payment_status(payment_request_id, actor_user_id=user.id)
            flash("Payment status refreshed.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("provider_booking_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/provider/bookings/<uuid:reservation_id>/cancel", methods=["POST"])
    def provider_booking_cancel(reservation_id):
        user = require_permission("provider.booking.cancel")
        try:
            provider_cancel_booking(
                reservation_id,
                actor_user_id=user.id,
                reason=request.form.get("reason", ""),
            )
            flash("Booking cancelled.", "success")
            return redirect(url_for("provider_bookings"))
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
            return redirect(url_for("provider_booking_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/provider/calendar")
    def provider_calendar():
        require_permission("provider.calendar.view")
        today_value = date.today()
        return render_template(
            "provider_calendar.html",
            calendar=provider_calendar_context(),
            ota_push=provider_push_context(),
            rooms=Room.query.filter_by(is_active=True).order_by(Room.room_number.asc()).all(),
            room_types=RoomType.query.filter_by(is_active=True).order_by(RoomType.code.asc()).all(),
            push_defaults={
                "date_from": today_value,
                "date_to": today_value + timedelta(days=30),
            },
            can_manage_calendar=can("provider.calendar.manage"),
        )

    @app.route("/provider/calendar/feeds", methods=["POST"])
    def provider_calendar_feed_create():
        user = require_permission("provider.calendar.manage")
        scope_type = request.form.get("scope_type", "property")
        room_id = parse_optional_uuid(request.form.get("room_id"))
        try:
            create_calendar_feed(
                scope_type=scope_type,
                room_id=room_id,
                name=request.form.get("name"),
                actor_user_id=user.id,
            )
            flash("Private calendar feed created.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("provider_calendar"))

    @app.route("/provider/calendar/feeds/<uuid:feed_id>/rotate", methods=["POST"])
    def provider_calendar_feed_rotate(feed_id):
        user = require_permission("provider.calendar.manage")
        try:
            rotate_calendar_feed(feed_id, actor_user_id=user.id)
            flash("Calendar feed rotated. Replace the old URL anywhere it was subscribed.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("provider_calendar"))

    @app.route("/provider/calendar/sources", methods=["POST"])
    def provider_calendar_source_create():
        user = require_permission("provider.calendar.manage")
        try:
            source = create_external_calendar_source(
                room_id=UUID(request.form["room_id"]),
                name=request.form.get("name", ""),
                feed_url=request.form.get("feed_url", ""),
                actor_user_id=user.id,
            )
            if request.form.get("sync_now") == "on":
                sync_external_calendar_source(source.id, actor_user_id=user.id)
            flash("External calendar source saved.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("provider_calendar"))

    @app.route("/provider/calendar/sources/<uuid:source_id>/sync", methods=["POST"])
    def provider_calendar_source_sync(source_id):
        user = require_permission("provider.calendar.manage")
        try:
            result = sync_external_calendar_source(source_id, actor_user_id=user.id)
            flash(
                f"Calendar sync completed with status {result['run'].status}.",
                "success" if result["run"].status == "success" else "warning",
            )
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("provider_calendar"))

    @app.route("/provider/calendar/push", methods=["POST"])
    def provider_calendar_push():
        user = require_permission("provider.calendar.manage")
        provider_key = (request.form.get("provider_key") or "").strip()
        room_type_id = parse_optional_uuid(request.form.get("room_type_id"))
        try:
            date_from = date.fromisoformat(request.form.get("date_from") or date.today().isoformat())
            date_to = date.fromisoformat(request.form.get("date_to") or (date_from + timedelta(days=30)).isoformat())
            if date_to < date_from:
                raise ValueError("End date must be on or after start date.")
            updates = build_outbound_inventory_updates(
                date_from=date_from,
                date_to=date_to,
                room_type_id=room_type_id,
            )
            result = ChannelSyncService(get_provider(provider_key)).push_inventory_updates(
                updates,
                actor_user_id=user.id,
            )
            if result.success:
                flash(f"Pushed {result.records_processed} inventory update(s) to {provider_key.replace('_', ' ')}.", "success")
            else:
                flash("; ".join(result.errors) or f"{provider_key.replace('_', ' ')} push failed.", "error")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("provider_calendar"))

    @app.route("/staff/housekeeping")
    def staff_housekeeping():
        user = require_permission("housekeeping.view")
        target_date = parse_request_date_arg("date", default=date.today())
        filters = HousekeepingBoardFilters(
            business_date=target_date,
            floor=request.args.get("floor", ""),
            status=request.args.get("status", ""),
            priority=request.args.get("priority", ""),
            room_type_id=parse_request_uuid_arg("room_type_id") or "",
            arrival_today=request.args.get("arrival_today", ""),
            departure_today=request.args.get("departure_today", ""),
            blocked=request.args.get("blocked", ""),
            maintenance=request.args.get("maintenance", ""),
            notes=request.args.get("notes", ""),
            mobile=request.args.get("view") == "mobile",
        )
        board = list_housekeeping_board(filters, actor_user=user)
        tomorrow_date = target_date + timedelta(days=1)
        tomorrow_filters = HousekeepingBoardFilters(
            business_date=tomorrow_date,
            floor=filters.floor,
            status=filters.status,
            priority=filters.priority,
            room_type_id=filters.room_type_id,
            arrival_today=filters.arrival_today,
            departure_today=filters.departure_today,
            blocked=filters.blocked,
            maintenance=filters.maintenance,
            notes=filters.notes,
            mobile=filters.mobile,
        )
        tomorrow_board = list_housekeeping_board(tomorrow_filters, actor_user=user)
        tasks = list_housekeeping_tasks(TaskListFilters(business_date=target_date))
        return render_template(
            "housekeeping_board.html",
            board=board,
            tomorrow_board=tomorrow_board,
            today_date=date.today(),
            tasks=tasks,
            filters=filters,
            room_types=RoomType.query.order_by(RoomType.code.asc()).all(),
            housekeeping_statuses=["dirty", "clean", "inspected", "pickup", "occupied_clean", "occupied_dirty", "do_not_disturb", "sleep", "out_of_order", "out_of_service", "cleaning_in_progress"],
            room_note_types=ROOM_NOTE_TYPES,
            can_manage_controls=can_manage_operational_overrides(user),
        )

    @app.route("/staff/housekeeping/rooms/<uuid:room_id>")
    def staff_housekeeping_room_detail(room_id):
        user = require_permission("housekeeping.view")
        business_date = parse_request_date_arg("date", default=date.today())
        detail = get_housekeeping_room_detail(room_id, business_date=business_date, actor_user=user)
        return render_template(
            "housekeeping_room_detail.html",
            detail=detail,
            business_date=business_date,
            back_url=safe_back_path(
                request.args.get("back"),
                url_for("staff_housekeeping", date=business_date.isoformat()),
            ),
            housekeeping_statuses=["dirty", "clean", "inspected", "pickup", "occupied_clean", "occupied_dirty", "do_not_disturb", "sleep", "out_of_order", "out_of_service"],
            room_note_types=ROOM_NOTE_TYPES,
            can_manage_controls=can_manage_operational_overrides(user),
            can_view_audit=user.has_permission("audit.view"),
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

    # ------------------------------------------------------------------
    # Housekeeping task management routes
    # ------------------------------------------------------------------

    @app.route("/staff/housekeeping/tasks")
    def staff_housekeeping_tasks():
        user = require_permission("housekeeping.view")
        target_date = parse_request_date_arg("date", default=date.today())
        filters = TaskListFilters(
            business_date=target_date,
            status=request.args.get("status", ""),
            room_id=request.args.get("room_id", ""),
            assigned_to_user_id=request.args.get("assigned_to_user_id", ""),
            task_type=request.args.get("task_type", ""),
            priority=request.args.get("priority", ""),
        )
        tasks = list_housekeeping_tasks(filters)
        return jsonify({"tasks": tasks, "business_date": target_date.isoformat()})

    @app.route("/staff/housekeeping/tasks", methods=["POST"])
    def staff_housekeeping_task_create():
        user = require_permission("housekeeping.task_manage")
        try:
            room_id = UUID(request.form["room_id"])
            business_date = date.fromisoformat(request.form["business_date"])
            assigned_to = request.form.get("assigned_to_user_id")
            due_at_raw = request.form.get("due_at")
            task = create_housekeeping_task(
                CreateTaskPayload(
                    room_id=room_id,
                    business_date=business_date,
                    task_type=request.form.get("task_type", "checkout_clean"),
                    priority=request.form.get("priority", "normal"),
                    notes=request.form.get("notes"),
                    assigned_to_user_id=UUID(assigned_to) if assigned_to else None,
                    reservation_id=UUID(request.form["reservation_id"]) if request.form.get("reservation_id") else None,
                    due_at=datetime.fromisoformat(due_at_raw) if due_at_raw else None,
                ),
                actor_user_id=user.id,
            )
            flash("Housekeeping task created.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(request.form.get("back_url") or url_for("staff_housekeeping", date=request.form.get("business_date", date.today().isoformat())))

    @app.route("/staff/housekeeping/tasks/<task_id>/assign", methods=["POST"])
    def staff_housekeeping_task_assign(task_id):
        user = require_permission("housekeeping.task_manage")
        try:
            assigned_to = UUID(request.form["assigned_to_user_id"])
            assign_housekeeping_task(UUID(task_id), assigned_to_user_id=assigned_to, actor_user_id=user.id)
            flash("Task assigned.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(request.form.get("back_url") or url_for("staff_housekeeping"))

    @app.route("/staff/housekeeping/tasks/<task_id>/start", methods=["POST"])
    def staff_housekeeping_task_start(task_id):
        user = require_permission("housekeeping.task_manage")
        try:
            start_housekeeping_task(UUID(task_id), actor_user_id=user.id)
            flash("Task started — room set to cleaning in progress.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(request.form.get("back_url") or url_for("staff_housekeeping"))

    @app.route("/staff/housekeeping/tasks/<task_id>/complete", methods=["POST"])
    def staff_housekeeping_task_complete(task_id):
        user = require_permission("housekeeping.task_manage")
        try:
            complete_housekeeping_task(UUID(task_id), actor_user_id=user.id, notes=request.form.get("notes"))
            flash("Task completed — room marked clean.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(request.form.get("back_url") or url_for("staff_housekeeping"))

    @app.route("/staff/housekeeping/tasks/<task_id>/inspect", methods=["POST"])
    def staff_housekeeping_task_inspect(task_id):
        user = require_permission("housekeeping.task_manage")
        try:
            inspect_housekeeping_task(UUID(task_id), actor_user_id=user.id, notes=request.form.get("notes"))
            flash("Inspection passed — room ready for assignment.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(request.form.get("back_url") or url_for("staff_housekeeping"))

    @app.route("/staff/housekeeping/tasks/<task_id>/cancel", methods=["POST"])
    def staff_housekeeping_task_cancel(task_id):
        user = require_permission("housekeeping.task_manage")
        try:
            cancel_housekeeping_task(UUID(task_id), actor_user_id=user.id, reason=request.form.get("reason"))
            flash("Task cancelled.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(request.form.get("back_url") or url_for("staff_housekeeping"))

    # ------------------------------------------------------------------
    # Room readiness API
    # ------------------------------------------------------------------

    @app.route("/staff/api/room-readiness")
    def staff_api_room_readiness():
        """JSON endpoint returning readiness state of all rooms for a given date."""
        require_any_permission("reservation.view", "housekeeping.view")
        target_date = parse_request_date_arg("date", default=date.today())
        board = room_readiness_board(target_date)
        return jsonify({
            "business_date": target_date.isoformat(),
            "rooms": [
                {
                    "room_id": str(r.room_id),
                    "room_number": r.room_number,
                    "room_type_code": r.room_type_code,
                    "floor_number": r.floor_number,
                    "is_ready": r.is_ready,
                    "label": r.label,
                    "reason": r.reason,
                    "housekeeping_status_code": r.housekeeping_status_code,
                    "availability_status": r.availability_status,
                    "is_blocked": r.is_blocked,
                    "is_maintenance": r.is_maintenance,
                    "has_active_task": r.has_active_task,
                    "active_task_status": r.active_task_status,
                    "reservation_code": r.reservation_code,
                }
                for r in board
            ],
        })

    @app.route("/staff/api/room-readiness/<room_id>")
    def staff_api_room_readiness_single(room_id):
        """JSON endpoint returning readiness state of a single room."""
        require_any_permission("reservation.view", "housekeeping.view")
        target_date = parse_request_date_arg("date", default=date.today())
        try:
            r = is_room_assignable(UUID(room_id), target_date)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 404
        return jsonify({
            "room_id": str(r.room_id),
            "room_number": r.room_number,
            "room_type_code": r.room_type_code,
            "floor_number": r.floor_number,
            "is_ready": r.is_ready,
            "label": r.label,
            "reason": r.reason,
            "housekeeping_status_code": r.housekeeping_status_code,
            "availability_status": r.availability_status,
            "is_blocked": r.is_blocked,
            "is_maintenance": r.is_maintenance,
            "has_active_task": r.has_active_task,
            "active_task_status": r.active_task_status,
            "reservation_code": r.reservation_code,
        })

    # ------------------------------------------------------------------
    # Quick actions for room status changes
    # ------------------------------------------------------------------

    @app.route("/staff/housekeeping/quick-action", methods=["POST"])
    def staff_housekeeping_quick_action():
        """Compact front-desk / supervisor quick actions for room status changes."""
        user = require_permission("housekeeping.status_change")
        action = request.form.get("action", "")
        room_id = UUID(request.form["room_id"])
        business_date = date.fromisoformat(request.form.get("business_date", date.today().isoformat()))
        try:
            if action == "mark_dirty":
                update_housekeeping_status(room_id, business_date=business_date, payload=RoomStatusUpdatePayload(status_code="dirty"), actor_user_id=user.id)
                flash("Room marked dirty.", "success")
            elif action == "mark_cleaning":
                update_housekeeping_status(room_id, business_date=business_date, payload=RoomStatusUpdatePayload(status_code="cleaning_in_progress"), actor_user_id=user.id)
                flash("Room marked cleaning in progress.", "success")
            elif action == "mark_clean":
                update_housekeeping_status(room_id, business_date=business_date, payload=RoomStatusUpdatePayload(status_code="clean"), actor_user_id=user.id)
                flash("Room marked clean.", "success")
            elif action == "mark_inspected":
                update_housekeeping_status(room_id, business_date=business_date, payload=RoomStatusUpdatePayload(status_code="inspected"), actor_user_id=user.id)
                flash("Room marked inspected / ready.", "success")
            elif action == "block_room":
                reason = request.form.get("reason", "")
                set_blocked_state(room_id, business_date=business_date, payload=BlockRoomPayload(blocked=True, reason=reason or "Blocked via quick action"), actor_user_id=user.id)
                flash("Room blocked.", "success")
            elif action == "unblock_room":
                set_blocked_state(room_id, business_date=business_date, payload=BlockRoomPayload(blocked=False), actor_user_id=user.id)
                flash("Room unblocked.", "success")
            elif action == "maintenance_on":
                note = request.form.get("note", "")
                set_maintenance_flag(room_id, business_date=business_date, payload=MaintenanceFlagPayload(enabled=True, note=note or "Maintenance issue via quick action"), actor_user_id=user.id)
                flash("Maintenance flag set.", "success")
            elif action == "maintenance_off":
                set_maintenance_flag(room_id, business_date=business_date, payload=MaintenanceFlagPayload(enabled=False), actor_user_id=user.id)
                flash("Maintenance flag cleared.", "success")
            elif action == "rush_clean":
                create_housekeeping_task(
                    CreateTaskPayload(room_id=room_id, business_date=business_date, task_type="rush_clean", priority="urgent", notes=request.form.get("notes", "Urgent clean requested")),
                    actor_user_id=user.id,
                )
                flash("Rush clean task created.", "success")
            else:
                flash("Unknown quick action.", "error")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(request.form.get("back_url") or url_for("staff_housekeeping", date=business_date.isoformat()))

    @app.route("/staff/front-desk")
    def staff_front_desk():
        require_permission("reservation.view")
        target_date = parse_request_date_arg("date", default=date.today())
        filters = FrontDeskFilters(
            business_date=target_date,
            mode=request.args.get("mode", "arrivals"),
            room_type_id=parse_request_uuid_arg("room_type_id") or "",
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

    @app.route("/staff/front-desk/board")
    def staff_front_desk_board():
        require_permission("reservation.view")
        filters = front_desk_board_filters_from_request()
        started_at = perf_counter()
        outcome = "error"
        context = None
        try:
            context = front_desk_board_context(filters)
            outcome = "success"
            return render_template("front_desk_board.html", **context)
        finally:
            log_front_desk_board_metric(
                event="front_desk.board.render",
                started_at=started_at,
                board=context["board"] if context else None,
                board_v2_enabled=context["board_v2_enabled"] if context else front_desk_board_v2_enabled(),
                outcome=outcome,
                response_format="html",
                days=filters.days,
                room_type_id=filters.room_type_id or None,
                has_search=bool(filters.q),
                show_unallocated=filters.show_unallocated,
                show_closed=filters.show_closed,
            )

    @app.route("/staff/front-desk/board/fragment")
    def staff_front_desk_board_fragment():
        require_permission("reservation.view")
        filters = front_desk_board_filters_from_request()
        started_at = perf_counter()
        outcome = "error"
        context = None
        try:
            context = front_desk_board_context(filters)
            outcome = "success"
            return render_template("_front_desk_board_surface.html", **context)
        finally:
            log_front_desk_board_metric(
                event="front_desk.board.fragment",
                started_at=started_at,
                board=context["board"] if context else None,
                board_v2_enabled=context["board_v2_enabled"] if context else front_desk_board_v2_enabled(),
                outcome=outcome,
                response_format="html_fragment",
                days=filters.days,
                room_type_id=filters.room_type_id or None,
                has_search=bool(filters.q),
                show_unallocated=filters.show_unallocated,
                show_closed=filters.show_closed,
            )

    @app.route("/staff/front-desk/board/data")
    def staff_front_desk_board_data():
        require_permission("reservation.view")
        filters = front_desk_board_filters_from_request()
        started_at = perf_counter()
        outcome = "error"
        context = None
        try:
            context = front_desk_board_context(filters)
            outcome = "success"
            return jsonify(
                {
                    "filters": serialize_front_desk_board(_front_desk_filters_payload(filters)),
                    "board": serialize_front_desk_board(context["board"]),
                    "permissions": {
                        "canCreate": context["can_create"],
                        "canEdit": context["can_edit"],
                        "canManageClosures": context["can_manage_closures"],
                    },
                }
            )
        finally:
            log_front_desk_board_metric(
                event="front_desk.board.data",
                started_at=started_at,
                board=context["board"] if context else None,
                board_v2_enabled=context["board_v2_enabled"] if context else front_desk_board_v2_enabled(),
                outcome=outcome,
                response_format="json",
                days=filters.days,
                room_type_id=filters.room_type_id or None,
                has_search=bool(filters.q),
                show_unallocated=filters.show_unallocated,
                show_closed=filters.show_closed,
            )

    @app.route("/staff/front-desk/board/rooms")
    def staff_front_desk_board_rooms():
        require_permission("reservation.view")
        room_type_id = parse_request_uuid_arg("room_type_id") or ""
        started_at = perf_counter()
        outcome = "error"
        groups = []
        try:
            groups = list_front_desk_room_groups(room_type_id=room_type_id)
            outcome = "success"
            return jsonify({"groups": groups})
        finally:
            log_front_desk_board_metric(
                event="front_desk.board.rooms",
                started_at=started_at,
                outcome=outcome,
                response_format="json",
                room_type_id=room_type_id or None,
                group_count=len(groups),
                row_count=sum(len(group.get("rooms", [])) for group in groups),
            )

    @app.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/room", methods=["POST"])
    def staff_front_desk_board_assign_room(reservation_id):
        user = require_permission("reservation.edit")
        back_url = safe_back_path(request.form.get("back_url"), url_for("staff_front_desk_board"))
        try:
            assign_room(
                reservation_id,
                UUID(request.form["room_id"]),
                actor_user_id=user.id,
                reason=request.form.get("reason") or "front_desk_board_reassign",
            )
            flash("Room assignment updated from the planning board.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(add_anchor_to_path(back_url, request.form.get("return_anchor")))

    @app.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/dates", methods=["POST"])
    def staff_front_desk_board_change_dates(reservation_id):
        user = require_permission("reservation.edit")
        back_url = safe_back_path(request.form.get("back_url"), url_for("staff_front_desk_board"))
        try:
            reservation = db.session.get(Reservation, reservation_id)
            if not reservation:
                raise ValueError("Reservation not found.")
            change_stay_dates(
                reservation_id,
                StayDateChangePayload(
                    check_in_date=date.fromisoformat(request.form["check_in_date"]),
                    check_out_date=date.fromisoformat(request.form["check_out_date"]),
                    adults=int(request.form.get("adults", reservation.adults)),
                    children=int(request.form.get("children", reservation.children)),
                    extra_guests=int(request.form.get("extra_guests", reservation.extra_guests)),
                    requested_room_id=parse_optional_uuid(request.form.get("requested_room_id")),
                ),
                actor_user_id=user.id,
            )
            flash("Stay dates updated from the planning board.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(add_anchor_to_path(back_url, request.form.get("return_anchor")))

    @app.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/move", methods=["POST"])
    def staff_front_desk_board_move_reservation(reservation_id):
        user = require_permission("reservation.edit")
        started_at = perf_counter()
        payload = board_request_payload()
        before_data = _reservation_snapshot_for_audit(reservation_id)
        requested_room_id = None
        new_check_in = None
        new_check_out = None
        room_changed = False
        date_changed = False
        outcome = "error"
        status_code = 500
        message = None
        try:
            current = db.session.get(Reservation, reservation_id)
            if not current:
                raise ValueError("Reservation not found.")
            requested_room_id = parse_board_room_id(payload, required=False)
            new_check_in = parse_board_date(payload, "check-in date", "check_in_date", "checkInDate")
            new_check_out = parse_board_date(payload, "check-out date", "check_out_date", "checkOutDate")
            room_changed = requested_room_id != current.assigned_room_id
            date_changed = new_check_in != current.check_in_date or new_check_out != current.check_out_date
            if requested_room_id is None and current.assigned_room_id is not None:
                raise ValueError("Reservations cannot be moved into the unallocated lane.")
            if current.assigned_room_id is None and requested_room_id is None:
                raise ValueError("Unallocated reservations must be assigned to a room before moving dates.")
            if not room_changed and not date_changed:
                outcome = "noop"
                status_code = 200
                message = "No board change was needed."
                return jsonify({"ok": True, "message": message})
            if date_changed:
                result = change_stay_dates(
                    reservation_id,
                    StayDateChangePayload(
                        check_in_date=new_check_in,
                        check_out_date=new_check_out,
                        adults=current.adults,
                        children=current.children,
                        extra_guests=current.extra_guests,
                        requested_room_id=requested_room_id,
                    ),
                    actor_user_id=user.id,
                )
                outcome = "success"
                status_code = 200
                message = f"Reservation moved. New total {result['new_total']:.2f} THB."
                return jsonify(
                    {
                        "ok": True,
                        "message": message,
                    }
                )
            if requested_room_id is None:
                raise ValueError("A target room is required.")
            assign_room(
                reservation_id,
                requested_room_id,
                actor_user_id=user.id,
                reason=parse_board_reason(payload) or "front_desk_board_drag_move",
            )
            outcome = "success"
            status_code = 200
            message = "Room assignment updated."
            return jsonify({"ok": True, "message": message})
        except BoardMutationRequestError as exc:
            outcome = "invalid_request"
            status_code = 400
            message = str(exc)
            record_board_mutation_rejection(
                actor_user_id=user.id,
                entity_table="reservations",
                entity_id=str(reservation_id),
                action="front_desk_board_move_invalid_request",
                before_data=before_data,
                payload=payload,
                reason=str(exc),
            )
            return jsonify({"ok": False, "error": message}), 400
        except Exception as exc:  # noqa: BLE001
            outcome = "rejected"
            status_code = 409
            message = public_error_message(exc)
            record_board_mutation_rejection(
                actor_user_id=user.id,
                entity_table="reservations",
                entity_id=str(reservation_id),
                action="front_desk_board_move_rejected",
                before_data=before_data,
                payload=payload,
                reason=str(exc),
            )
            # Reload current state so the client can show what actually changed
            try:
                current_after = db.session.get(Reservation, reservation_id)
                server_state = {
                    "currentRoomId": str(current_after.assigned_room_id) if current_after and current_after.assigned_room_id else None,
                    "currentCheckInDate": current_after.check_in_date.isoformat() if current_after else None,
                    "currentCheckOutDate": current_after.check_out_date.isoformat() if current_after else None,
                } if current_after else None
            except Exception:  # noqa: BLE001
                server_state = None
            return jsonify({"ok": False, "error": message, "code": "inventory_conflict", "serverState": server_state}), 409
        finally:
            log_front_desk_board_metric(
                event="front_desk.board.move",
                started_at=started_at,
                outcome=outcome,
                status_code=status_code,
                reservation_id=str(reservation_id),
                requested_room_id=str(requested_room_id) if requested_room_id else None,
                check_in_date=new_check_in.isoformat() if new_check_in else None,
                check_out_date=new_check_out.isoformat() if new_check_out else None,
                room_changed=room_changed,
                date_changed=date_changed,
                message=message,
            )

    @app.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/resize", methods=["POST"])
    def staff_front_desk_board_resize_reservation(reservation_id):
        user = require_permission("reservation.edit")
        started_at = perf_counter()
        payload = board_request_payload()
        before_data = _reservation_snapshot_for_audit(reservation_id)
        requested_check_in = None
        requested_check_out = None
        outcome = "error"
        status_code = 500
        message = None
        try:
            current = db.session.get(Reservation, reservation_id)
            if not current:
                raise ValueError("Reservation not found.")
            if current.assigned_room_id is None:
                raise ValueError("Assign the reservation to a room before resizing stay dates.")
            requested_check_in = parse_board_date(payload, "check-in date", "check_in_date", "checkInDate")
            requested_check_out = parse_board_date(payload, "check-out date", "check_out_date", "checkOutDate")
            result = change_stay_dates(
                reservation_id,
                StayDateChangePayload(
                    check_in_date=requested_check_in,
                    check_out_date=requested_check_out,
                    adults=current.adults,
                    children=current.children,
                    extra_guests=current.extra_guests,
                    requested_room_id=current.assigned_room_id,
                ),
                actor_user_id=user.id,
            )
            outcome = "success"
            status_code = 200
            message = f"Stay resized. New total {result['new_total']:.2f} THB."
            return jsonify(
                {
                    "ok": True,
                    "message": message,
                }
            )
        except BoardMutationRequestError as exc:
            outcome = "invalid_request"
            status_code = 400
            message = str(exc)
            record_board_mutation_rejection(
                actor_user_id=user.id,
                entity_table="reservations",
                entity_id=str(reservation_id),
                action="front_desk_board_resize_invalid_request",
                before_data=before_data,
                payload=payload,
                reason=str(exc),
            )
            return jsonify({"ok": False, "error": message}), 400
        except Exception as exc:  # noqa: BLE001
            outcome = "rejected"
            status_code = 409
            message = public_error_message(exc)
            record_board_mutation_rejection(
                actor_user_id=user.id,
                entity_table="reservations",
                entity_id=str(reservation_id),
                action="front_desk_board_resize_rejected",
                before_data=before_data,
                payload=payload,
                reason=str(exc),
            )
            # Reload current state so the client can show what actually changed
            try:
                current_after = db.session.get(Reservation, reservation_id)
                server_state = {
                    "currentRoomId": str(current_after.assigned_room_id) if current_after and current_after.assigned_room_id else None,
                    "currentCheckInDate": current_after.check_in_date.isoformat() if current_after else None,
                    "currentCheckOutDate": current_after.check_out_date.isoformat() if current_after else None,
                } if current_after else None
            except Exception:  # noqa: BLE001
                server_state = None
            return jsonify({"ok": False, "error": message, "code": "inventory_conflict", "serverState": server_state}), 409
        finally:
            log_front_desk_board_metric(
                event="front_desk.board.resize",
                started_at=started_at,
                outcome=outcome,
                status_code=status_code,
                reservation_id=str(reservation_id),
                check_in_date=requested_check_in.isoformat() if requested_check_in else None,
                check_out_date=requested_check_out.isoformat() if requested_check_out else None,
                message=message,
            )

    @app.route("/staff/front-desk/board/closures", methods=["POST"])
    def staff_front_desk_board_create_closure():
        user = require_permission("operations.override")
        back_url = safe_back_path(request.form.get("back_url"), url_for("staff_front_desk_board"))
        payload = request.form.to_dict()
        try:
            room_id = parse_board_room_id(payload, required=True)
            room = db.session.get(Room, room_id)
            if not room:
                raise ValueError("Selected room was not found.")
            closure_name = (payload.get("name") or "").strip() or f"Room {room.room_number} closure"
            create_inventory_override(
                InventoryOverridePayload(
                    name=closure_name,
                    scope_type="room",
                    override_action="close",
                    room_id=room_id,
                    room_type_id=None,
                    start_date=parse_board_date(payload, "closure start date", "start_date"),
                    end_date=parse_board_date(payload, "closure end date", "end_date"),
                    reason=payload.get("reason", ""),
                    expires_at=parse_optional_datetime(payload.get("expires_at")),
                ),
                actor_user_id=user.id,
            )
            flash("Room closure created from the planning board.", "success")
        except Exception as exc:  # noqa: BLE001
            record_board_mutation_rejection(
                actor_user_id=user.id,
                entity_table="inventory_overrides",
                entity_id=str(payload.get("room_id") or "new"),
                action="front_desk_board_closure_create_rejected",
                before_data=None,
                payload=payload,
                reason=str(exc),
            )
            flash(public_error_message(exc), "error")
        return redirect(add_anchor_to_path(back_url, request.form.get("return_anchor") or "board-top"))

    @app.route("/staff/front-desk/board/closures/<uuid:override_id>", methods=["POST"])
    def staff_front_desk_board_update_closure(override_id):
        user = require_permission("operations.override")
        back_url = safe_back_path(request.form.get("back_url"), url_for("staff_front_desk_board"))
        override = db.session.get(InventoryOverride, override_id)
        payload = request.form.to_dict()
        before_data = _inventory_override_snapshot_for_audit(override_id)
        try:
            room_id = parse_board_room_id(payload, required=False)
            if room_id is None:
                room_id = override.room_id if override else None
            if room_id is None:
                raise ValueError("Selected room was not found.")
            room = db.session.get(Room, room_id)
            if not room:
                raise ValueError("Selected room was not found.")
            closure_name = (payload.get("name") or "").strip() or f"Room {room.room_number} closure"
            update_inventory_override(
                override_id,
                InventoryOverridePayload(
                    name=closure_name,
                    scope_type="room",
                    override_action="close",
                    room_id=room_id,
                    room_type_id=None,
                    start_date=parse_board_date(payload, "closure start date", "start_date"),
                    end_date=parse_board_date(payload, "closure end date", "end_date"),
                    reason=payload.get("reason", ""),
                    expires_at=parse_optional_datetime(payload.get("expires_at")),
                ),
                actor_user_id=user.id,
            )
            flash("Room closure updated.", "success")
        except Exception as exc:  # noqa: BLE001
            record_board_mutation_rejection(
                actor_user_id=user.id,
                entity_table="inventory_overrides",
                entity_id=str(override_id),
                action="front_desk_board_closure_update_rejected",
                before_data=before_data,
                payload=payload,
                reason=str(exc),
            )
            flash(public_error_message(exc), "error")
        return redirect(add_anchor_to_path(back_url, request.form.get("return_anchor") or "board-top"))

    @app.route("/staff/front-desk/board/closures/<uuid:override_id>/release", methods=["POST"])
    def staff_front_desk_board_release_closure(override_id):
        user = require_permission("operations.override")
        back_url = safe_back_path(request.form.get("back_url"), url_for("staff_front_desk_board"))
        payload = request.form.to_dict()
        before_data = _inventory_override_snapshot_for_audit(override_id)
        try:
            release_inventory_override(override_id, actor_user_id=user.id)
            flash("Room closure released.", "success")
        except Exception as exc:  # noqa: BLE001
            record_board_mutation_rejection(
                actor_user_id=user.id,
                entity_table="inventory_overrides",
                entity_id=str(override_id),
                action="front_desk_board_closure_release_rejected",
                before_data=before_data,
                payload=payload,
                reason=str(exc),
            )
            flash(public_error_message(exc), "error")
        return redirect(add_anchor_to_path(back_url, request.form.get("return_anchor")))

    @app.route("/staff/front-desk/board/export.ics")
    def staff_front_desk_board_export_ical():
        require_permission("reservation.view")
        filters = front_desk_board_filters_from_request()
        context = front_desk_board_context(filters)
        selected_block_ids = {item for item in request.args.getlist("block_id") if item}
        blocks = flatten_front_desk_blocks(context["board"], visible_only=request.args.get("include_hidden") != "1")
        if selected_block_ids:
            blocks = [block for block in blocks if block["id"] in selected_block_ids]
        payload = export_front_desk_blocks_ical(
            blocks,
            calendar_name=f"Front Desk Board {context['board']['current_window_label']}",
        )
        response = Response(payload, mimetype="text/calendar")
        response.headers["Content-Disposition"] = 'inline; filename="front-desk-board.ics"'
        response.headers["Cache-Control"] = "private, max-age=60"
        return response

    @app.route("/staff/front-desk/board/import.ics", methods=["POST"])
    def staff_front_desk_board_import_ical():
        require_permission("reservation.edit")
        filters = front_desk_board_filters_from_request()
        try:
            payload = read_ical_upload_payload()
            report = stage_ical_import(
                payload,
                known_uids=set(db.session.execute(sa.select(ExternalCalendarBlock.external_uid)).scalars().all()),
            )
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
            report = None
        return render_template("front_desk_board.html", **front_desk_board_context(filters, ical_import_report=report))

    @app.route("/staff/front-desk/board/preferences", methods=["POST"])
    def staff_front_desk_board_preferences():
        """Save user's front desk board preferences (density, layout, etc)."""
        user = require_permission("reservation.view")
        payload = request.get_json() or {}
        density = payload.get("density", "compact")

        if density not in ["comfortable", "compact", "spacious", "ultra"]:
            abort(400, "Invalid density value")

        # Create or update user preference record
        pref = UserPreference.query.filter_by(user_id=user.id).first()
        if not pref:
            pref = UserPreference(user_id=user.id, preferences={})
            db.session.add(pref)

        # Ensure preferences dict has the frontDeskBoard key
        if "frontDeskBoard" not in pref.preferences:
            pref.preferences["frontDeskBoard"] = {}

        # Update density setting
        pref.preferences["frontDeskBoard"]["density"] = density
        db.session.commit()

        # Log the change
        write_activity_log(
            actor_user_id=user.id,
            event_type="front_desk.board_density_changed",
            metadata={"density": density},
        )

        return jsonify(ok=True, density=density)

    @app.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/check_in", methods=["POST"])
    def staff_front_desk_board_check_in(reservation_id):
        """Check in a reservation via the front desk board."""
        user = require_permission("reservation.check_in")
        reservation = Reservation.query.get_or_404(reservation_id)

        if reservation.current_status in ("checked_in", "checked_out"):
            return jsonify(ok=False, error=f"Cannot check in a {reservation.current_status} reservation.")

        try:
            complete_check_in(
                reservation_id,
                CheckInPayload(
                    room_id=reservation.assigned_room_id,
                    first_name=reservation.primary_guest.first_name or "",
                    last_name=reservation.primary_guest.last_name or "",
                    phone=reservation.primary_guest.phone or "",
                    email=reservation.primary_guest.email,
                    nationality=reservation.primary_guest.nationality,
                    id_document_type=reservation.primary_guest.id_document_type,
                    id_document_number=reservation.primary_guest.id_document_number,
                    preferred_language=reservation.primary_guest.preferred_language or reservation.booking_language,
                    notes_summary=reservation.primary_guest.notes_summary,
                    identity_verified=reservation.identity_verified_at is not None,
                ),
                actor_user_id=user.id,
            )

            write_activity_log(
                actor_user_id=user.id,
                event_type="front_desk.board_check_in",
                entity_table="reservations",
                entity_id=str(reservation_id),
                metadata={"via": "board_keyboard"},
            )

            db.session.refresh(reservation)
            try:
                fire_automation_event(
                    "arrival_today",
                    reservation_id=str(reservation_id),
                    guest_id=str(reservation.primary_guest_id) if reservation.primary_guest_id else None,
                    context={
                        "reservation_code": reservation.reservation_code,
                        "guest_name": reservation.primary_guest.full_name if reservation.primary_guest else "",
                        "check_in_date": str(reservation.check_in_date),
                        "check_out_date": str(reservation.check_out_date),
                        "hotel_name": current_app.config.get("HOTEL_NAME", ""),
                    },
                )
            except Exception:  # noqa: BLE001
                logger.exception("Automation hook failed for arrival_today (board)")
            return jsonify(ok=True, message="Checked in.", status=reservation.current_status)
        except Exception as exc:
            write_audit_log(
                actor_user_id=user.id,
                entity_table="reservations",
                entity_id=str(reservation_id),
                action="front_desk_board_check_in_failed",
                after_data={"error": str(exc)},
            )
            return jsonify(ok=False, error=str(exc)), 409

    @app.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/check_out", methods=["POST"])
    def staff_front_desk_board_check_out(reservation_id):
        """Check out a reservation via the front desk board."""
        user = require_permission("reservation.check_out")
        reservation = Reservation.query.get_or_404(reservation_id)

        if reservation.current_status in ("checked_out", "canceled"):
            return jsonify(ok=False, error=f"Cannot check out a {reservation.current_status} reservation.")

        try:
            from pms.services.front_desk_service import complete_checkout
            complete_checkout(reservation_id, actor_user_id=user.id)

            write_activity_log(
                actor_user_id=user.id,
                event_type="front_desk.board_check_out",
                entity_table="reservations",
                entity_id=str(reservation_id),
                metadata={"via": "board_keyboard"},
            )

            db.session.refresh(reservation)
            try:
                fire_automation_event(
                    "checkout_completed",
                    reservation_id=str(reservation_id),
                    guest_id=str(reservation.primary_guest_id) if reservation.primary_guest_id else None,
                    context={
                        "reservation_code": reservation.reservation_code,
                        "guest_name": reservation.primary_guest.full_name if reservation.primary_guest else "",
                        "check_in_date": str(reservation.check_in_date),
                        "check_out_date": str(reservation.check_out_date),
                        "hotel_name": current_app.config.get("HOTEL_NAME", ""),
                    },
                )
            except Exception:  # noqa: BLE001
                logger.exception("Automation hook failed for checkout_completed (board)")
            return jsonify(ok=True, message="Checked out.", status=reservation.current_status)
        except Exception as exc:
            write_audit_log(
                actor_user_id=user.id,
                entity_table="reservations",
                entity_id=str(reservation_id),
                action="front_desk_board_check_out_failed",
                after_data={"error": str(exc)},
            )
            return jsonify(ok=False, error=str(exc)), 409

    @app.route("/staff/front-desk/board/reservations/<uuid:reservation_id>/panel", methods=["GET"])
    def staff_front_desk_board_reservation_panel(reservation_id):
        """Load panel content for a reservation."""
        user = require_permission("reservation.view")
        reservation = Reservation.query.get_or_404(reservation_id)

        # Determine available actions based on permissions
        can_reassign = user.has_permission("reservation.edit")
        can_change_dates = user.has_permission("reservation.edit")
        can_check_in = user.has_permission("reservation.check_in") and reservation.current_status in ["tentative", "confirmed"]
        can_check_out = user.has_permission("reservation.check_out") and reservation.current_status == "checked_in"

        # Get available rooms for reassignment: same type, active, not conflicting
        # with existing allocated reservations during the stay window (excluding this reservation itself).
        available_rooms = []
        if can_reassign and reservation.room_type_id:
            all_rooms = Room.query.filter(
                Room.room_type_id == reservation.room_type_id,
                Room.is_active.is_(True),
            ).order_by(Room.room_number).all()
            # Find room IDs that are blocked by other active reservations in the same window
            conflict_statuses = {"tentative", "confirmed", "checked_in", "house_use"}
            conflicting_room_ids = {
                row.assigned_room_id
                for row in db.session.query(Reservation.assigned_room_id).filter(
                    Reservation.id != reservation.id,
                    Reservation.assigned_room_id.isnot(None),
                    Reservation.current_status.in_(conflict_statuses),
                    Reservation.check_in_date < reservation.check_out_date,
                    Reservation.check_out_date > reservation.check_in_date,
                ).all()
                if row.assigned_room_id is not None
            }
            for room in all_rooms:
                label = f"Room {room.room_number} — Floor {room.floor_number}"
                if room.id in conflicting_room_ids:
                    label += " (unavailable)"
                available_rooms.append({"id": str(room.id), "label": label, "available": room.id not in conflicting_room_ids})

        context = {
            "reservation": reservation,
            "can_reassign": can_reassign,
            "can_change_dates": can_change_dates,
            "can_check_in": can_check_in,
            "can_check_out": can_check_out,
            "available_rooms": available_rooms,
            "csrf_token": ensure_csrf_token(),
            "nights": (reservation.check_out_date - reservation.check_in_date).days,
            "balance": max(Decimal(0), Decimal(str(reservation.quoted_grand_total or 0)) - Decimal(str(reservation.deposit_received_amount or 0))),
            "payment_state": "paid" if Decimal(str(reservation.deposit_received_amount or 0)) >= Decimal(str(reservation.quoted_grand_total or 0)) and Decimal(str(reservation.quoted_grand_total or 0)) > 0 else ("partial" if Decimal(str(reservation.deposit_received_amount or 0)) > 0 else "unpaid"),
            "recent_notes": list(reservation.notes[:5]) if reservation.notes else [],
            "can_cancel": user.has_permission("reservation.edit") and reservation.current_status in ["tentative", "confirmed"],
            "can_no_show": user.has_permission("reservation.edit") and reservation.current_status in ["tentative", "confirmed"] and reservation.check_in_date <= date.today(),
        }

        return render_template("_panel_reservation_details.html", **context)

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
        business_date = parse_request_date_arg("date", default=date.today())
        detail = get_front_desk_detail(reservation_id, business_date=business_date)
        checkout_prep = prepare_checkout(reservation_id) if detail["reservation"].current_status == "checked_in" else None
        comm_messages = reservation_messages(str(reservation_id)) if can("messaging.view") else []
        return render_template(
            "front_desk_detail.html",
            detail=detail,
            checkout_prep=checkout_prep,
            back_url=safe_back_path(request.args.get("back"), url_for("staff_front_desk")),
            business_date=business_date,
            can_folio=can("folio.view"),
            can_charge=can("folio.charge_add"),
            can_collect_payment=can("payment.create"),
            check_in_form=_build_check_in_form_state(detail),
            checkout_form=_build_checkout_form_state(checkout_prep) if checkout_prep else None,
            comm_messages=comm_messages,
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
        business_date_raw = (request.form.get("business_date") or "").strip()
        try:
            business_date = date.fromisoformat(business_date_raw) if business_date_raw else date.today()
        except ValueError:
            business_date = date.today()
        back_url = safe_back_path(request.form.get("back_url"), url_for("staff_front_desk"))

        def render_check_in_error(
            *,
            errors: list[dict[str, str]] | None = None,
            unexpected_message: str | None = None,
            status_code: int = 400,
            values: dict[str, str] | None = None,
        ):
            detail = get_front_desk_detail(reservation_id, business_date=business_date)
            checkout_prep = prepare_checkout(reservation_id) if detail["reservation"].current_status == "checked_in" else None
            return (
                render_template(
                    "front_desk_detail.html",
                    detail=detail,
                    checkout_prep=checkout_prep,
                    back_url=back_url,
                    business_date=business_date,
                    can_folio=can("folio.view"),
                    can_charge=can("folio.charge_add"),
                    can_collect_payment=can("payment.create"),
                    check_in_form=_build_check_in_form_state(
                        detail,
                        values=values,
                        errors=errors,
                        allow_override=any(role.code in {"admin", "manager"} for role in user.roles),
                        unexpected_message=unexpected_message,
                    ),
                    checkout_form=_build_checkout_form_state(checkout_prep) if checkout_prep else None,
                ),
                status_code,
            )

        values, parsed, parse_errors = _parse_check_in_form_values(request.form)
        collect_payment_amount = parsed["collect_payment_amount"] if isinstance(parsed["collect_payment_amount"], Decimal) else Decimal("0.00")
        if parse_errors:
            return render_check_in_error(errors=parse_errors, values=values)
        if collect_payment_amount > Decimal("0.00") and not user.has_permission("payment.create"):
            abort(403)
        if request.form.get("apply_early_fee") == "on" and not user.has_permission("folio.charge_add"):
            abort(403)
        if values["room_id"]:
            reservation = db.session.get(Reservation, reservation_id)
            if reservation and str(reservation.assigned_room_id) != values["room_id"] and not user.has_permission("reservation.edit"):
                abort(403)
        detail = get_front_desk_detail(reservation_id, business_date=business_date)
        blockers = _check_in_blockers(
            detail,
            values,
            allow_override=any(role.code in {"admin", "manager"} for role in user.roles),
        )
        if blockers:
            return render_check_in_error(errors=blockers, values=values)
        try:
            complete_check_in(
                reservation_id,
                CheckInPayload(
                    room_id=parsed["room_uuid"],
                    first_name=values["first_name"],
                    last_name=values["last_name"],
                    phone=values["phone"],
                    email=values["email"],
                    nationality=values["nationality"],
                    id_document_type=values["id_document_type"],
                    id_document_number=values["id_document_number"],
                    preferred_language=values["preferred_language"],
                    notes_summary=values["notes_summary"],
                    identity_verified=bool(parsed["identity_verified"]),
                    collect_payment_amount=collect_payment_amount,
                    payment_method=values["payment_method"],
                    arrival_note=values["arrival_note"],
                    apply_early_fee=bool(parsed["apply_early_fee"]),
                    waive_early_fee=bool(parsed["waive_early_fee"]),
                    waiver_reason=values["waiver_reason"],
                    override_payment=bool(parsed["override_payment"]),
                ),
                actor_user_id=user.id,
            )
            flash("Guest checked in.", "success")
            try:
                res = db.session.get(Reservation, reservation_id)
                if res:
                    fire_automation_event(
                        "arrival_today",
                        reservation_id=str(reservation_id),
                        guest_id=str(res.primary_guest_id) if res.primary_guest_id else None,
                        context={
                            "reservation_code": res.reservation_code,
                            "guest_name": res.primary_guest.full_name if res.primary_guest else "",
                            "check_in_date": str(res.check_in_date),
                            "check_out_date": str(res.check_out_date),
                            "hotel_name": current_app.config.get("HOTEL_NAME", ""),
                        },
                    )
            except Exception:  # noqa: BLE001
                logger.exception("Automation hook failed for arrival_today")
        except ValueError as exc:
            db.session.rollback()
            return render_check_in_error(errors=[_map_check_in_error(str(exc))], values=values)
        except Exception:  # noqa: BLE001
            db.session.rollback()
            error_reference = _unexpected_check_in_reference()
            current_app.logger.exception("check-in completion failed", extra={"check_in_reference": error_reference})
            return render_check_in_error(
                unexpected_message=CHECK_IN_UNEXPECTED_FALLBACK.format(reference=error_reference),
                status_code=500,
                values=values,
            )
        return redirect(url_for("staff_front_desk_detail", reservation_id=reservation_id, back=back_url, date=business_date.isoformat()))

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
            try:
                res = db.session.get(Reservation, reservation_id)
                if res:
                    fire_automation_event(
                        "checkout_completed",
                        reservation_id=str(reservation_id),
                        guest_id=str(res.primary_guest_id) if res.primary_guest_id else None,
                        context={
                            "reservation_code": res.reservation_code,
                            "guest_name": res.primary_guest.full_name if res.primary_guest else "",
                            "check_in_date": str(res.check_in_date),
                            "check_out_date": str(res.check_out_date),
                            "hotel_name": current_app.config.get("HOTEL_NAME", ""),
                        },
                    )
            except Exception:  # noqa: BLE001
                logger.exception("Automation hook failed for checkout_completed")
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
        auto_post_until = parse_request_date_arg("auto_post_until", default=None)
        detail = get_cashier_detail(
            reservation_id,
            auto_post_room_charges=request.args.get("auto_post") == "1",
            auto_post_through=auto_post_until,
        )
        return render_template(
            "cashier_folio.html",
            detail=detail,
            back_url=safe_back_path(
                request.args.get("back"),
                url_for("staff_reservation_detail", reservation_id=reservation_id),
            ),
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
                    provider_reference=(request.form.get("transaction_reference") or "").strip() or None,
                ),
                actor_user_id=user.id,
            )
            flash("Payment recorded on folio.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/cashier/<uuid:reservation_id>/pos-charges", methods=["POST"])
    def staff_cashier_pos_charge(reservation_id):
        user = require_permission("folio.charge_add")
        try:
            post_pos_charge(
                reservation_id,
                PosChargePayload(
                    amount=Decimal(request.form.get("amount") or "0.00"),
                    outlet_name=request.form.get("outlet_name", ""),
                    outlet_type=request.form.get("outlet_type", "fnb"),
                    external_check_id=request.form.get("external_check_id", ""),
                    system_name=request.form.get("system_name", "pos"),
                    item_summary=request.form.get("item_summary"),
                    note=request.form.get("note"),
                    service_date=date.fromisoformat(request.form["service_date"]) if request.form.get("service_date") else None,
                ),
                actor_user_id=user.id,
            )
            flash("POS charge posted to folio.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_cashier_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/cashier/<uuid:reservation_id>/payment-requests", methods=["POST"])
    def staff_cashier_payment_request(reservation_id):
        user = require_permission("payment_request.create")
        try:
            create_or_reuse_payment_request(
                reservation_id,
                actor_user_id=user.id,
                request_kind=request.form.get("request_kind", "deposit"),
                send_email=request.form.get("send_email") == "on",
                language=request.form.get("language") or None,
                force_new_link=request.form.get("force_new_link") == "on",
                source="staff_cashier",
            )
            flash("Payment request is ready.", "success")
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

    @app.route("/api/integrations/pos/charges", methods=["POST"])
    def integration_pos_charge():
        require_integration_token("pos")
        payload = request.get_json(silent=True) or {}
        try:
            reservation = resolve_reservation_identifier(
                reservation_id_value=payload.get("reservation_id"),
                reservation_code_value=payload.get("reservation_code"),
            )
            line = post_pos_charge(
                reservation.id,
                PosChargePayload(
                    amount=Decimal(str(payload.get("amount") or "0.00")),
                    outlet_name=payload.get("outlet_name", ""),
                    outlet_type=payload.get("outlet_type", "fnb"),
                    external_check_id=payload.get("external_check_id", ""),
                    system_name=payload.get("system_name", "pos"),
                    item_summary=payload.get("item_summary"),
                    note=payload.get("note"),
                    service_date=date.fromisoformat(payload["service_date"]) if payload.get("service_date") else None,
                    covers=int(payload["covers"]) if payload.get("covers") is not None else None,
                    metadata=payload.get("metadata") if isinstance(payload.get("metadata"), dict) else None,
                ),
                actor_user_id=None,
            )
        except Exception as exc:  # noqa: BLE001
            return jsonify({"ok": False, "error": public_error_message(exc)}), 400
        return jsonify(
            {
                "ok": True,
                "folio_charge_id": str(line.id),
                "posting_key": line.posting_key,
                "reservation_id": str(line.reservation_id),
            }
        )

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
                    transaction_reference=(request.form.get("transaction_reference") or "").strip() or None,
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
        arrival_date = parse_request_date_arg("arrival_date", default=None)
        departure_date = parse_request_date_arg("departure_date", default=None)
        sort_val = request.args.get("sort", "")
        sort_dir = request.args.get("sort_dir", "asc")
        if sort_val not in ("arrival", "departure", "status", "reference"):
            sort_val = ""
        if sort_dir not in ("asc", "desc"):
            sort_dir = "asc"
        filters = ReservationWorkspaceFilters(
            q=(request.args.get("q") or "").strip(),
            status=request.args.get("status", ""),
            room_type_id=parse_request_uuid_arg("room_type_id") or "",
            arrival_date=arrival_date.isoformat() if arrival_date else "",
            departure_date=departure_date.isoformat() if departure_date else "",
            payment_state=request.args.get("payment_state", ""),
            booking_source=request.args.get("booking_source", ""),
            review_status=request.args.get("review_status", ""),
            assigned=request.args.get("assigned", ""),
            include_closed=request.args.get("include_closed") == "1",
            page=parse_request_int_arg("page", default=1, minimum=1),
            per_page=25,
            sort=sort_val,
            sort_dir=sort_dir,
        )
        result = list_reservations(filters)
        # Batch-load pre-check-in status for all reservation IDs on this page
        if result["items"]:
            _res_ids = [item["id"] for item in result["items"]]
            _pc_rows = db.session.query(PreCheckIn).filter(PreCheckIn.reservation_id.in_(_res_ids)).all()
            _pc_map = {str(pc.reservation_id): pc for pc in _pc_rows}
            for item in result["items"]:
                item["pre_checkin"] = _pc_map.get(str(item["id"]))
        return render_template(
            "staff_reservations.html",
            result=result,
            filters=filters,
            group_blocks=list_group_room_blocks(limit=8),
            room_types=RoomType.query.order_by(RoomType.code.asc()).all(),
            reservation_statuses=RESERVATION_STATUSES,
            booking_sources=BOOKING_SOURCE_CHANNELS,
            review_statuses=REVIEW_QUEUE_STATUSES,
            today=date.today(),
            tomorrow=date.today() + timedelta(days=1),
            can_folio=can("folio.view"),
        )

    @app.route("/staff/group-blocks", methods=["POST"])
    def staff_group_block_create():
        user = require_permission("reservation.edit")
        try:
            detail = create_group_room_block(
                GroupBlockCreatePayload(
                    group_name=request.form.get("group_name", ""),
                    check_in_date=date.fromisoformat(request.form["check_in_date"]),
                    check_out_date=date.fromisoformat(request.form["check_out_date"]),
                    room_type_id=UUID(request.form["room_type_id"]),
                    room_count=int(request.form.get("room_count") or "0"),
                    adults=int(request.form.get("adults") or "2"),
                    children=int(request.form.get("children") or "0"),
                    extra_guests=int(request.form.get("extra_guests") or "0"),
                    contact_name=request.form.get("contact_name"),
                    contact_email=request.form.get("contact_email"),
                    notes=request.form.get("notes"),
                ),
                actor_user_id=user.id,
            )
            flash(
                f"Group block {detail['group_block_code']} created with {detail['active_count']} held room(s).",
                "success",
            )
            return redirect(url_for("staff_group_block_detail", group_block_code=detail["group_block_code"]))
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_reservations"))

    @app.route("/staff/group-blocks/<group_block_code>")
    def staff_group_block_detail(group_block_code):
        require_permission("reservation.view")
        try:
            detail = get_group_block_detail(group_block_code)
        except Exception:
            abort(404)
        return render_template(
            "group_block_detail.html",
            block=detail,
            back_url=safe_back_path(request.args.get("back"), url_for("staff_reservations")),
        )

    @app.route("/staff/group-blocks/<group_block_code>/release", methods=["POST"])
    def staff_group_block_release(group_block_code):
        user = require_permission("reservation.edit")
        try:
            detail = release_group_room_block(group_block_code, actor_user_id=user.id)
            flash(
                f"Released {detail['released_count']} room block(s) from {detail['group_block_code']}.",
                "success",
            )
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_group_block_detail", group_block_code=group_block_code))

    @app.route("/staff/reservations/arrivals")
    def staff_reservation_arrivals():
        require_permission("reservation.view")
        target_date = parse_request_date_arg("date", default=date.today())
        items = list_arrivals(
            arrival_date=target_date,
            room_type_id=parse_request_uuid_arg("room_type_id") or "",
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
        target_date = parse_request_date_arg("date", default=date.today())
        items = list_departures(
            departure_date=target_date,
            room_type_id=parse_request_uuid_arg("room_type_id") or "",
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
        target_date = parse_request_date_arg("date", default=date.today())
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

    @app.route("/staff/reservations/new", methods=["GET", "POST"])
    def staff_reservation_create():
        user = require_permission("reservation.create")
        default_back = url_for("staff_reservations")
        back_url = safe_back_path(request.values.get("back"), default_back)
        initial = {
            "first_name": (request.values.get("first_name") or "").strip(),
            "last_name": (request.values.get("last_name") or "").strip(),
            "guest_phone": (request.values.get("guest_phone") or "").strip(),
            "guest_email": (request.values.get("guest_email") or "").strip(),
            "source_channel": (request.values.get("source_channel") or request.values.get("source") or "admin_manual").strip(),
            "check_in": (request.values.get("check_in") or "").strip(),
            "check_out": (request.values.get("check_out") or "").strip(),
            "adults": (request.values.get("adults") or "2").strip(),
            "children": (request.values.get("children") or "0").strip(),
            "extra_guests": (request.values.get("extra_guests") or "0").strip(),
            "room_type_id": parse_optional_uuid(request.values.get("room_type_id")),
            "status": (request.values.get("status") or "confirmed").strip(),
            "special_requests": request.values.get("special_requests") or "",
            "internal_notes": request.values.get("internal_notes") or request.values.get("notes") or "",
        }
        if initial["check_in"] and not initial["check_out"]:
            try:
                initial["check_out"] = (date.fromisoformat(initial["check_in"]) + timedelta(days=1)).isoformat()
            except ValueError:
                initial["check_out"] = ""
        if request.method == "POST":
            try:
                reservation = create_reservation(
                    ReservationCreatePayload(
                        first_name=initial["first_name"],
                        last_name=initial["last_name"],
                        phone=initial["guest_phone"],
                        email=initial["guest_email"] or None,
                        room_type_id=UUID(request.form["room_type_id"]),
                        check_in_date=date.fromisoformat(request.form["check_in"]),
                        check_out_date=date.fromisoformat(request.form["check_out"]),
                        adults=int(request.form.get("adults", 2)),
                        children=int(request.form.get("children", 0)),
                        extra_guests=int(request.form.get("extra_guests", 0)),
                        source_channel=initial["source_channel"] or "admin_manual",
                        special_requests=request.form.get("special_requests"),
                        internal_notes=request.form.get("internal_notes"),
                        initial_status=request.form.get("status") or "confirmed",
                    ),
                    actor_user_id=user.id,
                )
                flash(f"Reservation {reservation.reservation_code} created.", "success")
                try:
                    fire_automation_event(
                        "reservation_created",
                        reservation_id=str(reservation.id),
                        guest_id=str(reservation.primary_guest_id) if reservation.primary_guest_id else None,
                        context={
                            "reservation_code": reservation.reservation_code,
                            "guest_name": reservation.primary_guest.full_name if reservation.primary_guest else "",
                            "check_in_date": str(reservation.check_in_date),
                            "check_out_date": str(reservation.check_out_date),
                            "room_type": reservation.room_type.name if reservation.room_type else "",
                            "hotel_name": current_app.config.get("HOTEL_NAME", ""),
                        },
                    )
                except Exception:  # noqa: BLE001
                    logger.exception("Automation hook failed for reservation_created")
                return redirect(url_for("staff_reservation_detail", reservation_id=reservation.id, back=back_url))
            except Exception as exc:  # noqa: BLE001
                flash(public_error_message(exc), "error")
        return render_template(
            "reservation_form.html",
            is_staff=True,
            initial=initial,
            room_types=RoomType.query.filter_by(is_active=True).order_by(RoomType.code.asc()).all(),
            back_url=back_url,
            booking_sources=BOOKING_SOURCE_CHANNELS,
            staff_status_options=["confirmed", "tentative", "house_use"],
        )

    @app.route("/staff/reservations/rate-preview")
    def staff_reservation_rate_preview():
        """Lightweight JSON endpoint for inline rate preview on the reservation form."""
        require_permission("reservation.create")
        try:
            room_type_id = UUID(request.args["room_type_id"])
            check_in = date.fromisoformat(request.args["check_in"])
            check_out = date.fromisoformat(request.args["check_out"])
            adults = int(request.args.get("adults", 2))
            children = int(request.args.get("children", 0))
            extra_guests = int(request.args.get("extra_guests", 0))
        except (KeyError, ValueError) as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

        if check_out <= check_in:
            return jsonify({"ok": False, "error": "Check-out must be after check-in"}), 400

        room_type = db.session.get(RoomType, room_type_id)
        if not room_type or not room_type.is_active:
            return jsonify({"ok": False, "error": "Invalid room type"}), 400

        quote = quote_reservation(
            room_type=room_type,
            check_in_date=check_in,
            check_out_date=check_out,
            adults=adults + extra_guests,
            children=children,
        )
        nights = (check_out - check_in).days

        return jsonify({
            "ok": True,
            "nights": nights,
            "room_total": float(quote.room_total),
            "tax_total": float(quote.tax_total),
            "grand_total": float(quote.grand_total),
            "nightly_rates": [
                {"date": d.isoformat(), "rate": float(r)}
                for d, r in quote.nightly_rates
            ],
        })

    @app.route("/staff/reservations/<uuid:reservation_id>")
    def staff_reservation_detail(reservation_id):
        require_any_permission("reservation.view", "housekeeping.view")
        detail = get_reservation_detail(reservation_id, actor_user=current_user())
        comm_messages = reservation_messages(str(reservation_id)) if can("messaging.view") else []
        return render_template(
            "reservation_detail.html",
            detail=detail,
            back_url=safe_back_path(request.args.get("back"), url_for("staff_reservations")),
            today=date.today(),
            can_folio=can("folio.view"),
            comm_messages=comm_messages,
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

    @app.route("/staff/reservations/<uuid:reservation_id>/modification-requests/<uuid:mod_id>/approve", methods=["POST"])
    def staff_modification_approve(reservation_id, mod_id):
        user = require_permission("reservation.edit")
        try:
            result = approve_modification_request(
                reservation_id,
                mod_id,
                actor_user_id=user.id,
                internal_note=request.form.get("internal_note", ""),
            )
            delta = result["new_total"] - result["old_total"]
            flash(
                f"Modification approved. New total {result['new_total']:.2f} THB ({delta:+.2f} THB).",
                "success",
            )
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_reservation_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/reservations/<uuid:reservation_id>/modification-requests/<uuid:mod_id>/decline", methods=["POST"])
    def staff_modification_decline(reservation_id, mod_id):
        user = require_permission("reservation.edit")
        try:
            decline_modification_request(
                reservation_id,
                mod_id,
                actor_user_id=user.id,
                internal_note=request.form.get("internal_note", ""),
            )
            flash("Modification request declined.", "info")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_reservation_detail", reservation_id=reservation_id, back=request.form.get("back_url")))

    @app.route("/staff/reservations/<uuid:reservation_id>/modification-requests/<uuid:mod_id>/quote")
    def staff_modification_quote(reservation_id, mod_id):
        require_permission("reservation.view")
        try:
            quote = quote_modification_request(reservation_id, mod_id)
            return jsonify(quote)
        except Exception as exc:  # noqa: BLE001
            return jsonify({"error": str(exc)}), 400

    @app.route("/staff/reservations/<uuid:reservation_id>/panel")
    def staff_reservation_panel(reservation_id):
        """Mini HTML fragment for the reservations list drawer."""
        require_permission("reservation.view")
        reservation = db.session.get(Reservation, reservation_id)
        if not reservation:
            abort(404)
        summary = build_reservation_summary(reservation)
        return render_template(
            "_res_list_drawer.html",
            item=summary,
            can_cancel=can("reservation.cancel") and summary["status"] in ("tentative", "confirmed"),
            can_folio=can("folio.view"),
            back_url=request.args.get("back", url_for("staff_reservations")),
        )

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

    # ── Pre-Check-In: Staff-facing routes ───────────────────────────────

    @app.route("/staff/reservations/<uuid:reservation_id>/pre-checkin/generate", methods=["POST"])
    def staff_pre_checkin_generate(reservation_id):
        user = require_permission("reservation.edit")
        try:
            pc = generate_pre_checkin(reservation_id, actor_user_id=user.id)
            db.session.commit()
            link = build_pre_checkin_link(pc.token)
            flash(Markup(f'Pre-check-in link generated: <code class="text-xs select-all">{escape(link)}</code>'), "success")
        except Exception as exc:  # noqa: BLE001
            db.session.rollback()
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_reservation_detail", reservation_id=reservation_id))

    @app.route("/staff/reservations/<uuid:reservation_id>/pre-checkin/resend", methods=["POST"])
    def staff_pre_checkin_resend(reservation_id):
        user = require_permission("reservation.edit")
        try:
            pc = generate_pre_checkin(reservation_id, actor_user_id=user.id)
            db.session.commit()
            link = build_pre_checkin_link(pc.token)
            flash(Markup(f'Pre-check-in link resent: <code class="text-xs select-all">{escape(link)}</code>'), "success")
        except Exception as exc:  # noqa: BLE001
            db.session.rollback()
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_pre_checkin_detail", reservation_id=reservation_id))

    @app.route("/staff/reservations/<uuid:reservation_id>/pre-checkin/send-email", methods=["POST"])
    def staff_pre_checkin_send_email(reservation_id):
        user = require_permission("reservation.edit")
        try:
            pc = generate_pre_checkin(reservation_id, actor_user_id=user.id)
            send_pre_checkin_link_email(pc, actor_user_id=user.id)
            db.session.commit()
            reservation = db.session.get(Reservation, reservation_id)
            guest_email = (
                pc.primary_contact_email
                or (reservation.primary_guest.email if reservation and reservation.primary_guest else None)
            )
            if guest_email:
                flash(f"Pre-check-in link sent to {guest_email}.", "success")
            else:
                link = build_pre_checkin_link(pc.token)
                flash(Markup(f'No guest email on file — link generated: <code class="text-xs select-all">{escape(link)}</code>'), "warning")
        except Exception as exc:  # noqa: BLE001
            db.session.rollback()
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_pre_checkin_detail", reservation_id=reservation_id))

    @app.route("/staff/reservations/<uuid:reservation_id>/pre-checkin")
    def staff_pre_checkin_detail(reservation_id):
        user = require_permission("reservation.view")
        reservation = db.session.get(Reservation, reservation_id)
        if not reservation:
            abort(404)
        pc = get_pre_checkin_for_reservation(reservation_id)
        docs = get_documents_for_reservation(reservation_id)
        link = build_pre_checkin_link(pc.token) if pc else None
        return render_template(
            "staff_pre_checkin_detail.html",
            reservation=reservation,
            pc=pc,
            documents=docs,
            pre_checkin_link=link,
            scanner_integration_enabled=bool(integration_shared_token("scanner")),
        )

    @app.route("/staff/reservations/<uuid:reservation_id>/pre-checkin/verify", methods=["POST"])
    def staff_pre_checkin_verify(reservation_id):
        user = require_permission("reservation.check_in")
        pc = get_pre_checkin_for_reservation(reservation_id)
        if not pc:
            flash("No pre-check-in record found.", "error")
            return redirect(url_for("staff_reservation_detail", reservation_id=reservation_id))
        try:
            mark_verified(pc, actor_user_id=user.id)
            db.session.commit()
            flash("Pre-check-in verified successfully.", "success")
        except Exception as exc:  # noqa: BLE001
            db.session.rollback()
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_pre_checkin_detail", reservation_id=reservation_id))

    @app.route("/staff/reservations/<uuid:reservation_id>/pre-checkin/reject", methods=["POST"])
    def staff_pre_checkin_reject(reservation_id):
        user = require_permission("reservation.check_in")
        pc = get_pre_checkin_for_reservation(reservation_id)
        if not pc:
            flash("No pre-check-in record found.", "error")
            return redirect(url_for("staff_reservation_detail", reservation_id=reservation_id))
        reason = request.form.get("reason", "")
        try:
            mark_rejected(pc, actor_user_id=user.id, reason=reason)
            db.session.commit()
            flash("Pre-check-in rejected.", "warning")
        except Exception as exc:  # noqa: BLE001
            db.session.rollback()
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_pre_checkin_detail", reservation_id=reservation_id))

    @app.route("/staff/reservations/<uuid:reservation_id>/pre-checkin/update-guest-email", methods=["POST"])
    def staff_pre_checkin_update_guest_email(reservation_id):
        """Update the primary guest's email with the address submitted via pre-check-in."""
        user = require_permission("reservation.edit")
        reservation = db.session.get(Reservation, reservation_id)
        if not reservation:
            abort(404)
        pc = get_pre_checkin_for_reservation(reservation_id)
        if not pc or not pc.primary_contact_email:
            flash("No pre-check-in email to apply.", "error")
            return redirect(url_for("staff_pre_checkin_detail", reservation_id=reservation_id))
        guest = reservation.primary_guest
        if not guest:
            flash("No primary guest on this reservation.", "error")
            return redirect(url_for("staff_pre_checkin_detail", reservation_id=reservation_id))
        new_email = pc.primary_contact_email.strip()
        old_email = guest.email
        if old_email == new_email:
            flash("Guest email is already up to date.", "info")
            return redirect(url_for("staff_pre_checkin_detail", reservation_id=reservation_id))
        try:
            guest.email = new_email
            guest.updated_by_user_id = user.id
            db.session.flush()
            write_audit_log(
                actor_user_id=user.id,
                entity_table="guests",
                entity_id=str(guest.id),
                action="update",
                before_data={"email": old_email},
                after_data={"email": new_email, "source": "pre_checkin_write_back"},
            )
            write_activity_log(
                actor_user_id=user.id,
                event_type="guest.email_updated_from_pre_checkin",
                entity_table="guests",
                entity_id=str(guest.id),
                metadata={"reservation_id": str(reservation_id), "old_email": old_email or "", "new_email": new_email},
            )
            db.session.commit()
            flash(f"Guest email updated to {new_email}.", "success")
        except Exception as exc:  # noqa: BLE001
            db.session.rollback()
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_pre_checkin_detail", reservation_id=reservation_id))

    @app.route("/staff/reservations/<uuid:reservation_id>/pre-checkin/scanner-capture", methods=["POST"])
    def staff_pre_checkin_scanner_capture(reservation_id):
        user = require_permission("reservation.edit")
        try:
            document = ingest_scanner_capture(
                reservation_id,
                ScannerCapturePayload(
                    document_type=request.form.get("document_type", "passport"),
                    raw_text=request.form.get("raw_text"),
                    raw_payload=None,
                    filename=request.form.get("filename"),
                    content_type=request.form.get("content_type") or None,
                    scanner_name=request.form.get("scanner_name"),
                    source="staff_scanner_capture",
                ),
                actor_user_id=user.id,
            )
            extracted = document.ocr_extracted_data or {}
            if extracted.get("status") == "parsed":
                flash("Scanner payload saved and parsed for staff review.", "success")
            else:
                flash("Scanner payload saved, but no structured fields were parsed.", "warning")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("staff_pre_checkin_detail", reservation_id=reservation_id))

    @app.route("/staff/documents/<uuid:doc_id>/apply-ocr", methods=["POST"])
    def staff_document_apply_ocr(doc_id):
        user = require_permission("reservation.edit")
        try:
            document = apply_document_ocr_to_guest(doc_id, actor_user_id=user.id)
            flash("Parsed document details applied to the guest profile.", "success")
            return redirect(url_for("staff_pre_checkin_detail", reservation_id=document.reservation_id))
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
            return redirect(request.referrer or url_for("staff_reservations"))

    @app.route("/staff/documents/<uuid:doc_id>/verify", methods=["POST"])
    def staff_document_verify(doc_id):
        user = require_permission("reservation.check_in")
        status = request.form.get("verification_status", "verified")
        reason = request.form.get("rejection_reason")
        try:
            doc = verify_document(
                doc_id,
                DocumentVerifyPayload(verification_status=status, rejection_reason=reason),
                actor_user_id=user.id,
            )
            db.session.commit()
            flash(f"Document {status}.", "success" if status == "verified" else "warning")
        except Exception as exc:  # noqa: BLE001
            db.session.rollback()
            flash(public_error_message(exc), "error")
            return redirect(request.referrer or url_for("staff_front_desk"))
        return redirect(url_for("staff_pre_checkin_detail", reservation_id=doc.reservation_id))

    @app.route("/staff/documents/<uuid:doc_id>/view")
    def staff_document_view(doc_id):
        require_permission("reservation.view")
        doc = db.session.get(ReservationDocument, doc_id)
        if not doc:
            abort(404)
        # For S3 (or other remote backends) generate_url returns a presigned URL;
        # redirect the browser there so the app server is not in the data path.
        url = get_document_serve_url(doc)
        if url is not None:
            return redirect(url)
        # Local backend: stream bytes directly.
        try:
            data = read_document_bytes(doc)
        except FileNotFoundError:
            abort(404)
        return Response(
            data,
            mimetype=doc.content_type,
            headers={"Content-Disposition": f'inline; filename="{doc.original_filename}"'},
        )

    @app.route("/api/integrations/scanner/capture", methods=["POST"])
    def integration_scanner_capture():
        require_integration_token("scanner")
        payload = request.get_json(silent=True) or {}
        try:
            reservation = resolve_reservation_identifier(
                reservation_id_value=payload.get("reservation_id"),
                reservation_code_value=payload.get("reservation_code"),
            )
            document = ingest_scanner_capture(
                reservation.id,
                ScannerCapturePayload(
                    document_type=payload.get("document_type", "passport"),
                    raw_text=payload.get("raw_text"),
                    raw_payload=payload.get("raw_payload") if isinstance(payload.get("raw_payload"), dict) else None,
                    filename=payload.get("filename"),
                    content_type=payload.get("content_type"),
                    scanner_name=payload.get("scanner_name"),
                    source=payload.get("source") or "scanner_api",
                ),
                actor_user_id=None,
            )
        except Exception as exc:  # noqa: BLE001
            return jsonify({"ok": False, "error": public_error_message(exc)}), 400
        return jsonify(
            {
                "ok": True,
                "document_id": str(document.id),
                "reservation_id": str(document.reservation_id),
                "ocr_extracted_data": document.ocr_extracted_data,
            }
        )

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
                entry.reviewed_at = utc_now()
                entry.reviewed_by_user_id = user.id
            elif action == "needs_follow_up":
                entry.review_status = "needs_follow_up"
            elif action == "issue_flagged":
                entry.review_status = "issue_flagged"
            elif action == "resolved":
                entry.review_status = "resolved"
            elif action == "contacted":
                entry.contacted_at = utc_now()
            entry.internal_note = request.form.get("internal_note") or entry.internal_note
            db.session.commit()
            return redirect(url_for("staff_review_queue"))

        query = ReservationReviewQueue.query.join(Reservation, Reservation.id == ReservationReviewQueue.reservation_id)
        arrival_date = parse_request_date_arg("arrival_date", default=None)
        if request.args.get("status"):
            query = query.filter(ReservationReviewQueue.review_status == request.args["status"])
        if arrival_date:
            query = query.filter(Reservation.check_in_date == arrival_date)
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
    return normalize_language(getattr(g, "public_language", None) or request.args.get("lang") or request.form.get("language") or "th")


def make_language_url(language_code: str) -> str:
    args = request.args.to_dict(flat=False)
    args["lang"] = [normalize_language(language_code)]
    query_string = urlencode(args, doseq=True)
    if query_string:
        return f"{request.path}?{query_string}"
    return request.path


def _public_asset_url(value: str | None) -> str:
    candidate = str(value or "").strip()
    if not candidate:
        return ""
    if candidate.startswith(("http://", "https://", "data:")):
        return candidate
    if candidate.startswith("/"):
        return f"{request.url_root.rstrip('/')}{candidate}"
    return f"{request.url_root.rstrip('/')}/{candidate.lstrip('/')}"


def _phone_href(phone_number: str) -> str:
    normalized = "".join(character for character in str(phone_number or "") if character.isdigit() or character == "+")
    if not normalized:
        return ""
    return f"tel:{normalized}"


def _email_href(email_address: str) -> str:
    normalized = str(email_address or "").strip()
    if not normalized:
        return ""
    return f"mailto:{normalized}"


def _contact_link(href: str, label: str) -> Markup | str:
    safe_label = escape(label or "")
    if not href:
        return safe_label
    return Markup('<a class="contact-link subtle" href="{0}">{1}</a>').format(escape(href), safe_label)


def _hotel_structured_data(
    *,
    hotel_name: str,
    hotel_address: str,
    hotel_contact_phone: str,
    hotel_contact_email: str,
    hotel_check_in_time: str,
    hotel_check_out_time: str,
    share_image_url: str,
) -> dict[str, object]:
    structured_data: dict[str, object] = {
        "@context": "https://schema.org",
        "@type": "Hotel",
        "name": hotel_name,
        "url": booking_engine_base_url(),
    }
    if hotel_address:
        structured_data["address"] = {
            "@type": "PostalAddress",
            "streetAddress": hotel_address,
        }
    if hotel_contact_phone:
        structured_data["telephone"] = hotel_contact_phone
    if hotel_contact_email:
        structured_data["email"] = hotel_contact_email
    if hotel_check_in_time:
        structured_data["checkinTime"] = hotel_check_in_time
    if hotel_check_out_time:
        structured_data["checkoutTime"] = hotel_check_out_time
    if share_image_url:
        structured_data["image"] = share_image_url
    return structured_data


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
    if request.endpoint in {
        None,
        "static",
        "payment_webhook",
        "pre_checkin_save",
        "pre_checkin_upload",
        "staff_messaging_inbound_webhook",
        "integration_scanner_capture",
        "integration_pos_charge",
    }:
        return
    expected = session.get("_csrf_token")
    provided = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token")
    if not expected or not provided or not hmac.compare_digest(expected, provided):
        abort(400, description="CSRF validation failed.")


def integration_shared_token(name: str) -> str:
    config_key = f"{name.upper()}_SHARED_TOKEN"
    default = current_app.config.get(config_key, "")
    return str(get_setting_value(f"integrations.{name}.shared_token", default) or "").strip()


def require_integration_token(name: str) -> None:
    expected = integration_shared_token(name)
    if not expected:
        abort(503, description=f"{name} integration token is not configured.")
    provided = (
        request.headers.get("X-Integration-Token")
        or request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    )
    if not provided or not hmac.compare_digest(expected, provided):
        abort(403)


def resolve_reservation_identifier(
    *,
    reservation_id_value: str | None = None,
    reservation_code_value: str | None = None,
) -> Reservation:
    if reservation_id_value:
        try:
            reservation = db.session.get(Reservation, UUID(reservation_id_value))
        except ValueError as exc:
            raise ValueError("Invalid reservation ID.") from exc
        if reservation:
            return reservation
    if reservation_code_value:
        reservation = Reservation.query.filter_by(reservation_code=reservation_code_value.strip()).first()
        if reservation:
            return reservation
    raise ValueError("Reservation not found.")


def resolve_public_room_type_query() -> RoomType | None:
    room_type_code = (request.args.get("room_type") or "").strip()
    if room_type_code:
        room_type = db.session.execute(
            sa.select(RoomType)
            .where(
                sa.func.lower(RoomType.code) == room_type_code.lower(),
                RoomType.is_active.is_(True),
            )
            .order_by(RoomType.code.asc())
        ).scalars().first()
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
        "room_types": db.session.execute(sa.select(RoomType).order_by(RoomType.code.asc())).scalars().all(),
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
