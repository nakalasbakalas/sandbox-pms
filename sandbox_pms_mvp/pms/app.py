from __future__ import annotations

import hmac
import json
import logging
import secrets
from datetime import date, datetime, timedelta
from decimal import Decimal
from time import perf_counter
from urllib.parse import urlparse
from urllib.parse import urlencode
from uuid import UUID

logger = logging.getLogger(__name__)

import sqlalchemy as sa
import click
from flask import Flask, Response, abort, current_app, flash, g, jsonify, redirect, render_template, request, session, url_for
from markupsafe import Markup, escape

from .activity import write_activity_log
from .audit import cleanup_audit_logs, write_audit_log
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
from .pricing import get_setting_value
from .permissions import default_dashboard_endpoint_for_user
from .security import configure_app_security, current_csp_nonce, current_request_id, public_error_message
from .seeds import bootstrap_inventory_horizon, seed_all, seed_reference_data, seed_roles_permissions
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
    permission_groups,
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
    queue_cashier_receipt_email,
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
    "public.index",
    "availability",
    "booking_entry",
    "booking_hold",
    "booking_confirm",
    "public.availability",
    "public.booking_entry",
    "public.booking_hold",
    "public.booking_confirm",
}
PUBLIC_BOOKING_LANDING_ENDPOINTS = {"index", "public.index", "availability", "booking_entry", "public.availability", "public.booking_entry"}
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
    app.config["SEND_FILE_MAX_AGE_DEFAULT"] = int(app.config.get("STATIC_ASSET_MAX_AGE_SECONDS", 3600) or 0)
    configure_app_security(app)
    db.init_app(app)
    migrate.init_app(app, db)
    configure_error_monitoring(app)

    register_template_helpers(app)
    register_url_topology_hooks(app)
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
    from .routes.coupon_studio import coupon_studio_bp
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
    app.register_blueprint(coupon_studio_bp)

    register_routes(app)

    with app.app_context():
        if app.config["AUTO_BOOTSTRAP_SCHEMA"] and app.config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite"):
            db.create_all()
            if app.config["AUTO_SEED_REFERENCE_DATA"]:
                include_demo = app.config.get("SEED_DEMO_DATA", False)
                seed_all(app.config["INVENTORY_BOOTSTRAP_DAYS"], include_demo_data=include_demo)
    return app


def _resolve_current_property() -> None:
    """Set ``g.current_property`` from request header, session, or default.

    Resolution order:
    1. ``X-Property-Code`` request header (API / multi-property clients)
    2. ``property_code`` query parameter (convenience for dev/testing)
    3. First active property in the database (single-property fallback)
    """
    try:
        from .services.property_service import get_current_property, get_property_by_code

        code = request.headers.get("X-Property-Code") or request.args.get("property_code")
        if code:
            prop = get_property_by_code(code.strip().upper())
            if prop and prop.is_active:
                g.current_property = prop
                return
        # Fallback: let property_service pick the default lazily
        g.current_property = get_current_property()
    except Exception:
        # Table may not exist yet (pre-migration) — silently fall back
        g.current_property = None


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
        g.current_property = None

        # Resolve current property from header, query param, or default.
        _resolve_current_property()

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
                return url_for("public.index", lang=lang_code)

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
            "hotel_tax_id": branding["tax_id"],
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
            "csp_nonce": current_csp_nonce(),
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
    @click.option("--demo-data", is_flag=True, default=False, help="Include demo guests and reservations")
    def seed_phase2_command(demo_data: bool) -> None:
        seed_all(app.config["INVENTORY_BOOTSTRAP_DAYS"], include_demo_data=demo_data)
        print("Phase 2 seed completed." + (" (with demo data)" if demo_data else ""))

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

    @app.cli.command("cleanup-audit-logs")
    @click.option(
        "--retention-days",
        default=None,
        type=int,
        help="Delete audit logs older than N days. Defaults to AUDIT_LOG_RETENTION_DAYS.",
    )
    @click.option("--dry-run", is_flag=True, help="Report matching audit-log rows without deleting them.")
    def cleanup_audit_logs_command(retention_days: int | None, dry_run: bool) -> None:
        result = cleanup_audit_logs(retention_days=retention_days, dry_run=dry_run)
        if not result["enabled"]:
            print("Audit log cleanup skipped: AUDIT_LOG_RETENTION_DAYS is not set to a positive value.")
            return
        mode = "would delete" if dry_run else "deleted"
        cutoff = result["cutoff"].isoformat() if result["cutoff"] else "n/a"
        print(
            f"Audit log cleanup: {result['deleted']} rows {mode}, "
            f"retention_days={result['retention_days']}, cutoff={cutoff}"
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
    """All routes have been extracted to blueprints. This function is kept
    as a no-op for backward compatibility with create_app()."""
    pass



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
        reservation = db.session.execute(sa.select(Reservation).filter_by(reservation_code=reservation_code_value.strip())).scalar_one_or_none()
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


def require_any_permission(*permission_codes: str) -> User:
    user = require_user()
    if not any(user.has_permission(permission_code) for permission_code in permission_codes):
        abort(403)
    return user


def can(permission_code: str) -> bool:
    user = current_user()
    if not user:
        return False
    return user.has_permission(permission_code)

def default_dashboard_endpoint(user: User | None) -> str:
    return default_dashboard_endpoint_for_user(user)


def default_dashboard_url(user: User | None) -> str:
    return url_for(default_dashboard_endpoint(user))


def current_settings() -> dict[str, dict]:
    return {setting.key: setting.value_json for setting in db.session.execute(sa.select(AppSetting).filter_by(deleted_at=None)).scalars().all()}


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


def parse_booking_extra_ids(values: list[str] | tuple[str, ...] | None) -> tuple[UUID, ...]:
    parsed: list[UUID] = []
    for raw_value in values or []:
        candidate = (raw_value or "").strip()
        if not candidate:
            continue
        try:
            parsed.append(UUID(candidate))
        except ValueError as exc:
            raise ValueError("One or more selected extras are invalid.") from exc
    return tuple(parsed)


def safe_back_path(value: str | None, fallback: str) -> str:
    candidate = (value or "").strip()
    if candidate.startswith("/") and not candidate.startswith("//"):
        return candidate
    return fallback


def add_anchor_to_path(path: str, anchor: str | None) -> str:
    candidate = (path or "").strip()
    fragment = (anchor or "").strip().lstrip("#")
    if not fragment:
        return candidate
    base = candidate.split("#", 1)[0]
    return f"{base}#{fragment}"


def front_desk_board_filters_from_request() -> FrontDeskBoardFilters:
    start_date = parse_request_date_arg("start_date", default=date.today())
    days = parse_request_int_arg("days", default=14, minimum=7, maximum=30)
    if days not in {7, 14, 30}:
        abort(400, description="Invalid days query parameter.")
    return FrontDeskBoardFilters(
        start_date=start_date,
        days=days,
        q=(request.args.get("q") or "").strip(),
        room_type_id=parse_request_uuid_arg("room_type_id") or "",
        show_unallocated=request.args.get("show_unallocated", "1") != "0",
        show_closed=request.args.get("show_closed") == "1",
        group_by=request.args.get("group_by", "type") if request.args.get("group_by") in {"type", "floor"} else "type",
    )


def front_desk_board_context(
    filters: FrontDeskBoardFilters,
    *,
    ical_import_report: dict | None = None,
) -> dict:
    board = build_front_desk_board(filters)
    back_url = front_desk_board_url(filters)
    hydrate_front_desk_board_urls(board, back_url=back_url, board_date=filters.start_date)
    room_types = db.session.execute(sa.select(RoomType).order_by(RoomType.code.asc())).scalars().all()
    board_v2_enabled = front_desk_board_v2_enabled()

    # Load user density preference
    user_density = "compact"  # default
    user = g.current_staff_user
    if user and user.preferences:
        user_density = (user.preferences.preferences or {}).get("frontDeskBoard", {}).get("density", "compact")

    return {
        "board": board,
        "board_v2_enabled": board_v2_enabled,
        "filters": filters,
        "room_types": room_types,
        "user_density": user_density,
        "default_checkout_date": filters.start_date + timedelta(days=1),
        "can_create": can("reservation.create"),
        "can_edit": can("reservation.edit"),
        "can_manage_closures": can("operations.override"),
        "board_url": url_for("front_desk.staff_front_desk_board"),
        "board_fragment_url": url_for("front_desk.staff_front_desk_board_fragment"),
        "board_data_url": url_for("front_desk.staff_front_desk_board_data"),
        "board_rooms_url": url_for("front_desk.staff_front_desk_board_rooms"),
        "board_export_url": url_for("front_desk.staff_front_desk_board_export_ical"),
        "board_filter_query": front_desk_board_filter_query(filters),
        "board_current_url": back_url,
        "ical_import_report": ical_import_report,
    }


def front_desk_board_filter_query(filters: FrontDeskBoardFilters) -> dict[str, str]:
    query = {
        "start_date": filters.start_date.isoformat(),
        "days": str(filters.days),
        "show_unallocated": "1" if filters.show_unallocated else "0",
    }
    if filters.q:
        query["q"] = filters.q
    if filters.room_type_id:
        query["room_type_id"] = filters.room_type_id
    if filters.show_closed:
        query["show_closed"] = "1"
    if filters.group_by == "floor":
        query["group_by"] = "floor"
    return query


def front_desk_board_url(filters: FrontDeskBoardFilters) -> str:
    return url_for("front_desk.staff_front_desk_board", **front_desk_board_filter_query(filters))


def hydrate_front_desk_board_urls(board: dict, *, back_url: str, board_date: date) -> None:
    for group in board.get("groups", []):
        reassign_options = group.get("room_options", [])
        for row in group.get("rows", []):
            for block in row.get("blocks", []):
                block["backUrl"] = back_url
                block["returnAnchor"] = row.get("anchor_id")
                reservation_id = block.get("reservationId")
                override_id = block.get("overrideId")
                if reservation_id:
                    block["detailUrl"] = url_for(
                        "staff_reservations.staff_reservation_detail",
                        reservation_id=UUID(reservation_id),
                        back=back_url,
                    )
                    block["frontDeskUrl"] = url_for(
                        "front_desk.staff_front_desk_detail",
                        reservation_id=UUID(reservation_id),
                        back=back_url,
                        date=board_date.isoformat(),
                    )
                    block["reassignUrl"] = url_for(
                        "front_desk.staff_front_desk_board_assign_room",
                        reservation_id=UUID(reservation_id),
                    )
                    block["moveUrl"] = url_for(
                        "front_desk.staff_front_desk_board_move_reservation",
                        reservation_id=UUID(reservation_id),
                    )
                    block["resizeUrl"] = url_for(
                        "front_desk.staff_front_desk_board_resize_reservation",
                        reservation_id=UUID(reservation_id),
                    )
                    block["datesFormUrl"] = url_for(
                        "front_desk.staff_front_desk_board_change_dates",
                        reservation_id=UUID(reservation_id),
                    )
                    block["reassignOptions"] = reassign_options
                if override_id:
                    block["releaseUrl"] = url_for(
                        "front_desk.staff_front_desk_board_release_closure",
                        override_id=UUID(override_id),
                    )
                    block["editUrl"] = url_for(
                        "front_desk.staff_front_desk_board_update_closure",
                        override_id=UUID(override_id),
                    )
                    block["canRelease"] = True
                    block["canEdit"] = True


def _front_desk_filters_payload(filters: FrontDeskBoardFilters) -> dict[str, str | bool]:
    return {
        "startDate": filters.start_date.isoformat(),
        "days": filters.days,
        "q": filters.q,
        "roomTypeId": filters.room_type_id,
        "showUnallocated": filters.show_unallocated,
        "showClosed": filters.show_closed,
        "groupBy": filters.group_by,
    }


class BoardMutationRequestError(ValueError):
    """Raised when a planning-board request payload is malformed."""


def board_request_payload() -> dict:
    if request.is_json:
        payload = request.get_json(silent=True) or {}
        if isinstance(payload, dict):
            return payload
        abort(400, description="Invalid JSON payload.")
    return request.form.to_dict()


def parse_board_date(payload: dict, label: str, *field_names: str) -> date:
    candidate = _first_board_payload_value(payload, *field_names)
    if not candidate:
        raise BoardMutationRequestError(f"{label.capitalize()} is required.")
    try:
        return date.fromisoformat(str(candidate))
    except ValueError as exc:
        raise BoardMutationRequestError(f"{label.capitalize()} must be a valid ISO date.") from exc


def parse_board_room_id(payload: dict, *, required: bool) -> UUID | None:
    candidate = _first_board_payload_value(payload, "room_id", "roomId")
    if candidate is None:
        if required:
            raise BoardMutationRequestError("Room is required.")
        return None
    candidate_text = str(candidate).strip()
    if not candidate_text or candidate_text.lower() == "null":
        if required:
            raise BoardMutationRequestError("Room is required.")
        return None
    try:
        return UUID(candidate_text)
    except ValueError as exc:
        raise BoardMutationRequestError("Room identifier is invalid.") from exc


def parse_board_reason(payload: dict) -> str | None:
    candidate = _first_board_payload_value(payload, "reason", "moveReason")
    if candidate is None:
        return None
    return str(candidate).strip() or None


def _first_board_payload_value(payload: dict, *field_names: str):
    for field_name in field_names:
        if field_name in payload:
            return payload.get(field_name)
    return None


def read_ical_upload_payload() -> bytes:
    upload = request.files.get("ical_file")
    if upload and upload.filename:
        payload = upload.read()
        if payload:
            return payload
    text_payload = (request.form.get("ical_text") or "").strip()
    if text_payload:
        return text_payload.encode("utf-8")
    raise ValueError("Provide an .ics file or paste iCalendar content.")


def record_board_mutation_rejection(
    *,
    actor_user_id: UUID,
    entity_table: str,
    entity_id: str,
    action: str,
    before_data: dict | None,
    payload: dict,
    reason: str,
) -> None:
    db.session.rollback()
    write_audit_log(
        actor_user_id=actor_user_id,
        entity_table=entity_table,
        entity_id=entity_id,
        action=action,
        before_data=before_data,
        after_data={"request": payload, "failure_reason": reason},
    )
    write_activity_log(
        actor_user_id=actor_user_id,
        event_type="front_desk.board_mutation_rejected",
        entity_table=entity_table,
        entity_id=entity_id,
        metadata={"action": action, "failure_reason": reason},
    )
    db.session.commit()


def _reservation_snapshot_for_audit(reservation_id: UUID) -> dict | None:
    reservation = db.session.get(Reservation, reservation_id)
    if not reservation:
        return None
    return {
        "reservation_code": reservation.reservation_code,
        "status": reservation.current_status,
        "assigned_room_id": str(reservation.assigned_room_id) if reservation.assigned_room_id else None,
        "check_in_date": reservation.check_in_date.isoformat(),
        "check_out_date": reservation.check_out_date.isoformat(),
    }


def _inventory_override_snapshot_for_audit(override_id: UUID) -> dict | None:
    override = db.session.get(InventoryOverride, override_id)
    if not override:
        return None
    return {
        "name": override.name,
        "scope_type": override.scope_type,
        "override_action": override.override_action,
        "room_id": str(override.room_id) if override.room_id else None,
        "room_type_id": str(override.room_type_id) if override.room_type_id else None,
        "start_date": override.start_date.isoformat(),
        "end_date": override.end_date.isoformat(),
        "is_active": override.is_active,
    }


def public_base_url() -> str:
    return resolve_public_base_url()


def absolute_public_url(value: str | None) -> str:
    return branding_absolute_public_url(value)


def email_href(value: str | None) -> str:
    return branding_email_href(value)


def phone_href(value: str | None) -> str:
    return branding_phone_href(value)


def parse_optional_date(value: str | None) -> date | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    return date.fromisoformat(candidate)


def parse_request_form_date(name: str, *, default: date | None) -> date | None:
    candidate = (request.form.get(name) or "").strip()
    if not candidate:
        return default
    try:
        return date.fromisoformat(candidate)
    except ValueError:
        abort(400, description=f"Invalid {name} form value.")


def action_datetime_for_form_date(name: str, *, default: date | None = None) -> datetime:
    business_date = parse_request_form_date(name, default=default or date.today())
    hotel_tz = calendar_timezone()
    now = datetime.now(hotel_tz)
    return datetime.combine(
        business_date,
        now.time().replace(tzinfo=None),
        tzinfo=hotel_tz,
    )


def parse_request_date_arg(name: str, *, default: date | None) -> date | None:
    candidate = (request.args.get(name) or "").strip()
    if not candidate:
        return default
    try:
        return date.fromisoformat(candidate)
    except ValueError:
        abort(400, description=f"Invalid {name} query parameter.")


def parse_request_int_arg(name: str, *, default: int, minimum: int = 1, maximum: int | None = None) -> int:
    candidate = (request.args.get(name) or "").strip()
    if not candidate:
        return default
    try:
        value = int(candidate)
    except ValueError:
        abort(400, description=f"Invalid {name} query parameter.")
    if value < minimum or (maximum is not None and value > maximum):
        abort(400, description=f"Invalid {name} query parameter.")
    return value


def parse_request_uuid_arg(name: str) -> str | None:
    candidate = (request.args.get(name) or "").strip()
    if not candidate:
        return None
    try:
        return str(UUID(candidate))
    except ValueError:
        abort(400, description=f"Invalid {name} query parameter.")


def parse_optional_datetime(value: str | None) -> datetime | None:
    candidate = (value or "").strip()
    if not candidate:
        return None
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=calendar_timezone())
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




