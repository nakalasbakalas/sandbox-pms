from __future__ import annotations

import hmac
import json
import secrets
import time
from datetime import date, datetime, timedelta
from decimal import Decimal
from time import perf_counter
from urllib.parse import urlparse
from urllib.parse import urlencode
from uuid import UUID

import sqlalchemy as sa
from flask import Flask, Response, abort, current_app, flash, g, jsonify, redirect, render_template, request, session, stream_with_context, url_for
from markupsafe import Markup, escape

from .activity import write_activity_log
from .audit import write_audit_log
from .branding import (
    absolute_public_url as branding_absolute_public_url,
    branding_settings_context,
    clean_branding_form,
    email_href as branding_email_href,
    phone_href as branding_phone_href,
    resolve_public_base_url,
)
from .config import Config, normalize_runtime_config
from .constants import (
    BLACKOUT_TYPES,
    BOOKING_EXTRA_PRICING_MODES,
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
    EmailOutbox,
    ExternalCalendarBlock,
    ExternalCalendarSource,
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
from .security import configure_app_security, public_error_message, request_client_ip
from .seeds import bootstrap_inventory_horizon, seed_all, seed_reference_data, seed_roles_permissions
from .settings import NOTIFICATION_TEMPLATE_PLACEHOLDERS
from .url_topology import booking_engine_base_url, canonical_redirect_url, marketing_site_base_url, staff_app_base_url
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
    generate_pre_checkin,
    get_documents_for_reservation,
    get_pre_checkin_context,
    get_pre_checkin_for_reservation,
    list_todays_arrivals_with_readiness,
    load_pre_checkin_by_token,
    mark_opened,
    mark_rejected,
    mark_verified,
    save_pre_checkin,
    upload_document,
    validate_token_access,
    verify_document,
)
from .services.reporting_service import build_manager_dashboard
from .services.reservation_service import ReservationCreatePayload, create_reservation
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
BOOKING_ATTRIBUTION_TRACKED_ENDPOINTS = {"index", "availability", "booking_entry", "booking_hold", "booking_confirm"}


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
        if request.endpoint in {
            "booking_confirmation",
            "booking_cancel_request",
            "booking_modify_request",
            "public_payment_return",
            "public_payment_start",
        }:
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
        hotel_contact_phone = branding["contact_phone"]
        hotel_contact_email = branding["contact_email"]
        hotel_address = branding["address"]
        hotel_check_in_time = branding["check_in_time"]
        hotel_check_out_time = branding["check_out_time"]
        site_base_url = branding["public_base_url"] or absolute_public_url("/")
        favicon_url = absolute_public_url(url_for("static", filename="favicon.svg"))
        default_share_image_url = absolute_public_url(url_for("static", filename="hotel-share.svg"))
        share_image_url = hotel_logo_url or default_share_image_url
        hotel_contact_phone_href = phone_href(hotel_contact_phone)
        hotel_contact_email_href = email_href(hotel_contact_email)
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
            if request.endpoint and (
                request.endpoint.startswith("staff_") or request.endpoint.startswith("provider_")
            ):
                normalized_path = candidate if candidate.startswith("/") else f"/{candidate.lstrip('/')}"
                return f"{staff_app_base_url()}{normalized_path}"
            return absolute_public_url(candidate)

        canonical_url = _absolute_route_url(_language_url(language, preserve_query=False))
        language_alternate_urls = {}
        if request.endpoint and not request.endpoint.startswith("staff_") and not request.endpoint.startswith("provider_"):
            language_alternate_urls = {
                code: _absolute_route_url(_language_url(code, preserve_query=False))
                for code in LANGUAGE_LABELS
            }
        is_public_site = bool(
            request.endpoint
            and request.endpoint != "static"
            and not request.endpoint.startswith("staff_")
            and not request.endpoint.startswith("provider_")
        )
        current_staff = current_user()
        marketing_site_url = marketing_site_base_url(required=False)
        return {
            "hotel_name": hotel_name,
            "currency": hotel_currency,
            "hotel_brand_mark": hotel_brand_mark,
            "hotel_logo_url": hotel_logo_url,
            "hotel_support_contact_text": branding["support_contact_text"],
            "hotel_contact_phone": hotel_contact_phone,
            "hotel_contact_email": hotel_contact_email,
            "hotel_contact_phone_href": hotel_contact_phone_href,
            "hotel_contact_email_href": hotel_contact_email_href,
            "hotel_contact_phone_link": _contact_link(hotel_contact_phone_href, hotel_contact_phone),
            "hotel_contact_email_link": _contact_link(hotel_contact_email_href, hotel_contact_email),
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

    @app.cli.command("sync-ical-sources")
    def sync_ical_sources_command() -> None:
        result = sync_all_external_calendar_sources(actor_user_id=None)
        print(f"iCal sync result: {result}")


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
        return redirect(url_for("static", filename="favicon.svg"), code=302)

    @app.route("/sitemap.xml")
    def sitemap_xml():
        public_pages = [
            ("index", {}),
            ("booking_entry", {}),
            ("booking_cancel_request", {}),
            ("booking_modify_request", {}),
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

    @app.route("/book")
    def booking_entry():
        return render_template("availability.html", **build_public_booking_entry_context())

    @app.route("/availability")
    def availability():
        return redirect(url_for("booking_entry", **request.args.to_dict(flat=True)), code=308)

    @app.route("/booking/hold", methods=["POST"])
    def booking_hold():
        language = normalize_language(request.form.get("language"))
        try:
            attribution = source_metadata_from_request(language)
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
                    source_channel=resolve_booking_source_channel(request.form.get("source_channel"), attribution),
                    source_metadata=attribution,
                    request_ip=request_client_ip(),
                    user_agent=request.user_agent.string,
                    extra_guests=int(request.form.get("extra_guests", 0)),
                )
            )
            room_type = db.session.get(RoomType, hold.room_type_id)
            return render_template(
                "public_booking_form.html",
                **public_booking_form_context(hold, room_type),
            )
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
            return redirect(
                url_for(
                    "booking_entry",
                    check_in=request.form.get("check_in_date"),
                    check_out=request.form.get("check_out_date"),
                    adults=request.form.get("adults"),
                    children=request.form.get("children", 0),
                    room_type=request.form.get("room_type"),
                    room_type_id=request.form.get("room_type_id"),
                    utm_source=request.form.get("utm_source"),
                    utm_medium=request.form.get("utm_medium"),
                    utm_campaign=request.form.get("utm_campaign"),
                    utm_content=request.form.get("utm_content"),
                    source_label=request.form.get("source_label"),
                    referrer_host=request.form.get("referrer_host"),
                    entry_page=request.form.get("entry_page"),
                    landing_path=request.form.get("landing_path"),
                    source_channel=request.form.get("source_channel"),
                    cta_source=request.form.get("cta_source"),
                    lang=language,
                )
            )

    @app.route("/booking/confirm", methods=["POST"])
    def booking_confirm():
        language = normalize_language(request.form.get("language"))
        settings = current_settings()
        published_terms_version = settings.get("booking.terms_version", {}).get("value", "2026-03")
        selected_extra_ids: tuple[UUID, ...] = ()
        hold = ReservationHold.query.filter_by(hold_code=request.form.get("hold_code")).first()
        try:
            selected_extra_ids = parse_booking_extra_ids(request.form.getlist("extra_ids"))
            attribution = source_metadata_from_request(
                language,
                fallback=hold.source_metadata_json if hold and isinstance(hold.source_metadata_json, dict) else None,
            )
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
                    source_channel=resolve_booking_source_channel(request.form.get("source_channel"), attribution),
                    source_metadata=attribution,
                    terms_accepted=request.form.get("accept_terms") == "on",
                    terms_version=published_terms_version,
                    extra_ids=selected_extra_ids,
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
            if not hold:
                return redirect(url_for("booking_entry", lang=language))
            room_type = db.session.get(RoomType, hold.room_type_id)
            return render_template(
                "public_booking_form.html",
                **public_booking_form_context(
                    hold,
                    room_type,
                    settings=settings,
                    selected_extra_ids=selected_extra_ids,
                    form_values={
                        "first_name": request.form.get("first_name", ""),
                        "last_name": request.form.get("last_name", ""),
                        "phone": request.form.get("phone", ""),
                        "email": request.form.get("email", hold.guest_email or ""),
                        "special_requests": request.form.get("special_requests", ""),
                    },
                ),
            )

    @app.route("/booking/confirmation/<reservation_code>")
    def booking_confirmation(reservation_code):
        reservation = load_public_confirmation(reservation_code, request.args.get("token", ""))
        if not reservation:
            abort(404)
        g.public_language = reservation.booking_language
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
            extras_summary=reservation_extra_summary(reservation),
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
        g.public_language = context["reservation"].booking_language
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
        form_defaults = public_request_form_defaults("booking_reference", "contact_value", "reason")
        if request.method == "POST":
            payload = VerificationRequestPayload(
                booking_reference=request.form["booking_reference"].strip(),
                contact_value=request.form["contact_value"].strip(),
                language=current_language(),
                reason=request.form.get("reason"),
                request_ip=request_client_ip(),
                user_agent=request.user_agent.string,
            )
            try:
                request_row = submit_cancellation_request(payload)
            except Exception as exc:  # noqa: BLE001
                flash(public_error_message(exc), "error")
            else:
                if request_row:
                    flash(t(current_language(), "cancellation_received"), "success")
                else:
                    flash(t(current_language(), "booking_lookup_not_found"), "error")
        return render_template("public_cancel_request.html", request_row=request_row, form_defaults=form_defaults)

    @app.route("/booking/modify", methods=["GET", "POST"])
    def booking_modify_request():
        request_row = None
        form_defaults = public_request_form_defaults(
            "booking_reference",
            "contact_value",
            "requested_check_in",
            "requested_check_out",
            "requested_adults",
            "requested_children",
            "contact_correction",
            "special_requests",
        )
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
                request_ip=request_client_ip(),
                user_agent=request.user_agent.string,
            )
            try:
                request_row = submit_modification_request(payload)
            except Exception as exc:  # noqa: BLE001
                flash(public_error_message(exc), "error")
            else:
                if request_row:
                    flash(t(current_language(), "modification_received"), "success")
                else:
                    flash(t(current_language(), "booking_lookup_not_found"), "error")
        return render_template("public_modify_request.html", request_row=request_row, form_defaults=form_defaults)

    @app.route("/calendar/feed/<token>.ics")
    def calendar_feed_export(token):
        try:
            feed, payload = export_feed_ical(token)
        except LookupError:
            abort(404)
        except Exception as exc:  # noqa: BLE001
            return public_error_message(exc), 400
        safe_name = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in feed.name.lower()).strip("-") or "availability"
        response = Response(payload, mimetype="text/calendar")
        response.headers["Content-Disposition"] = f'inline; filename="{safe_name}.ics"'
        response.headers["Cache-Control"] = "private, max-age=300"
        return response

    # ── Pre-Check-In: Guest-facing routes ───────────────────────────────

    @app.route("/pre-checkin/<token>", methods=["GET"])
    def pre_checkin_form(token):
        pc = load_pre_checkin_by_token(token)
        error = validate_token_access(pc)
        if error:
            return render_template("pre_checkin_form.html", error=error, ctx=None), 403
        mark_opened(pc)
        db.session.commit()
        ctx = get_pre_checkin_context(pc)
        return render_template("pre_checkin_form.html", error=None, ctx=ctx)

    @app.route("/pre-checkin/<token>/save", methods=["POST"])
    def pre_checkin_save(token):
        pc = load_pre_checkin_by_token(token)
        error = validate_token_access(pc)
        if error:
            return render_template("pre_checkin_form.html", error=error, ctx=None), 403
        payload = PreCheckInSavePayload(
            primary_contact_name=request.form.get("primary_contact_name"),
            primary_contact_phone=request.form.get("primary_contact_phone"),
            primary_contact_email=request.form.get("primary_contact_email"),
            nationality=request.form.get("nationality"),
            number_of_occupants=int(request.form.get("number_of_occupants") or 0) or None,
            eta=request.form.get("eta"),
            special_requests=request.form.get("special_requests"),
            notes_for_staff=request.form.get("notes_for_staff"),
            vehicle_registration=request.form.get("vehicle_registration"),
            acknowledgment_accepted=request.form.get("acknowledgment_accepted") == "on",
            acknowledgment_name=request.form.get("acknowledgment_name"),
        )
        # Parse occupant details from form
        occupants = []
        for i in range(20):
            name = request.form.get(f"occupant_name_{i}", "").strip()
            if name:
                occupants.append({"name": name})
        if occupants:
            payload.occupant_details = occupants
        is_submit = request.form.get("action") == "submit"
        try:
            save_pre_checkin(pc, payload, submit=is_submit)
            db.session.commit()
        except ValueError as exc:
            db.session.rollback()
            ctx = get_pre_checkin_context(pc)
            return render_template("pre_checkin_form.html", error=str(exc), ctx=ctx)
        if is_submit:
            return render_template("pre_checkin_confirmation.html", pc=pc, reservation=pc.reservation)
        ctx = get_pre_checkin_context(pc)
        return render_template("pre_checkin_form.html", error=None, ctx=ctx, saved=True)

    @app.route("/pre-checkin/<token>/upload", methods=["POST"])
    def pre_checkin_upload(token):
        pc = load_pre_checkin_by_token(token)
        error = validate_token_access(pc)
        if error:
            return render_template("pre_checkin_form.html", error=error, ctx=None), 403
        document_type = request.form.get("document_type", "passport")
        uploaded_file = request.files.get("document_file")
        try:
            upload_document(pc, uploaded_file, document_type)
            db.session.commit()
        except ValueError as exc:
            db.session.rollback()
            ctx = get_pre_checkin_context(pc)
            return render_template("pre_checkin_form.html", error=str(exc), ctx=ctx)
        ctx = get_pre_checkin_context(pc)
        return render_template("pre_checkin_form.html", error=None, ctx=ctx, uploaded=True)

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
                return redirect(default_dashboard_url(result.user))
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
                return redirect(default_dashboard_url(g.pending_mfa_user))
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
        return branding_settings_context()
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
                    branding = clean_branding_form(request.form)
                    upsert_settings_bundle(
                        [
                            {"key": "hotel.name", "value": branding["hotel_name"], "value_type": "string", "description": "Hotel display name", "is_public": True, "sort_order": 10},
                            {"key": "hotel.brand_mark", "value": branding["brand_mark"], "value_type": "string", "description": "Brand monogram", "is_public": True, "sort_order": 11},
                            {"key": "hotel.logo_url", "value": branding["logo_url"], "value_type": "string", "description": "Hotel logo URL", "is_public": True, "sort_order": 12},
                            {"key": "hotel.contact_phone", "value": branding["contact_phone"], "value_type": "string", "description": "Primary phone", "is_public": True, "sort_order": 13},
                            {"key": "hotel.contact_email", "value": branding["contact_email"], "value_type": "string", "description": "Primary contact email", "is_public": True, "sort_order": 14},
                            {"key": "hotel.address", "value": branding["address"], "value_type": "string", "description": "Property address", "is_public": True, "sort_order": 15},
                            {"key": "hotel.currency", "value": branding["currency"], "value_type": "string", "description": "Hotel currency", "is_public": True, "sort_order": 16},
                            {"key": "hotel.check_in_time", "value": branding["check_in_time"], "value_type": "string", "description": "Standard check-in time", "is_public": True, "sort_order": 17},
                            {"key": "hotel.check_out_time", "value": branding["check_out_time"], "value_type": "string", "description": "Standard check-out time", "is_public": True, "sort_order": 18},
                            {"key": "hotel.tax_id", "value": branding["tax_id"], "value_type": "string", "description": "Business tax identifier", "is_public": False, "sort_order": 19},
                            {"key": "hotel.support_contact_text", "value": branding["support_contact_text"], "value_type": "string", "description": "Guest support message", "is_public": True, "sort_order": 20},
                            {"key": "hotel.accent_color", "value": branding["accent_color"], "value_type": "string", "description": "Primary accent color", "is_public": True, "sort_order": 21},
                            {"key": "hotel.accent_color_soft", "value": branding["accent_color_soft"], "value_type": "string", "description": "Secondary accent color", "is_public": True, "sort_order": 22},
                            {"key": "hotel.public_base_url", "value": branding["public_base_url"], "value_type": "string", "description": "Canonical public booking base URL", "is_public": True, "sort_order": 23},
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
                            summary=request.form.get("summary"),
                            description=request.form.get("description"),
                            bed_details=request.form.get("bed_details"),
                            media_urls=request.form.get("media_urls"),
                            amenities=request.form.get("amenities"),
                            policy_callouts=request.form.get("policy_callouts"),
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
                elif action == "booking_extra":
                    actor = require_permission("settings.edit")
                    upsert_booking_extra(
                        parse_optional_uuid(request.form.get("booking_extra_id")),
                        BookingExtraPayload(
                            code=request.form.get("code", ""),
                            name=request.form.get("name", ""),
                            description=request.form.get("description"),
                            pricing_mode=request.form.get("pricing_mode", "per_stay"),
                            unit_price=parse_decimal(request.form.get("unit_price"), default="0.00"),
                            is_active=truthy_setting(request.form.get("is_active")),
                            is_public=truthy_setting(request.form.get("is_public")),
                            sort_order=int(request.form.get("sort_order", 100)),
                        ),
                        actor_user_id=actor.id,
                    )
                    flash("Booking extra saved.", "success")
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
            booking_extras=list_booking_extras(include_inactive=True),
            booking_extra_pricing_modes=BOOKING_EXTRA_PRICING_MODES,
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
        notification.read_at = utc_now()
        db.session.commit()
        return redirect(request.form.get("back_url") or url_for("staff_dashboard"))

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
        return render_template(
            "provider_calendar.html",
            calendar=provider_calendar_context(),
            rooms=Room.query.filter_by(is_active=True).order_by(Room.room_number.asc()).all(),
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
        user = require_permission("settings.edit")
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
        user = require_permission("settings.edit")
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
        user = require_permission("settings.edit")
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
        density = payload.get("density", "comfortable")

        if density not in ["comfortable", "compact", "spacious"]:
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
            from pms.services.front_desk_service import complete_check_in
            complete_check_in(reservation_id, actor_user_id=user.id)

            write_activity_log(
                actor_user_id=user.id,
                event_type="front_desk.board_check_in",
                entity_table="reservations",
                entity_id=str(reservation_id),
                metadata={"via": "board_keyboard"},
            )

            db.session.refresh(reservation)
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
        }

        return render_template("_panel_reservation_details.html", **context)

    @app.route("/staff/front-desk/board/events", methods=["GET"])
    def staff_front_desk_board_events():
        """Server-Sent Events endpoint for board changes."""
        require_permission("reservation.view")

        def event_stream():
            last_event_id = request.headers.get("Last-Event-ID", request.args.get("last_event_id", ""))
            last_timestamp = None
            if last_event_id:
                try:
                    last_timestamp = datetime.fromisoformat(last_event_id)
                except (ValueError, TypeError):
                    pass

            # Stream events for 5 minutes, then client reconnects
            start_time = time.time()
            seen_events = set()

            while (time.time() - start_time) < 300:  # 5 min timeout
                # Query for new activity log entries (board events or reservation changes)
                query = ActivityLog.query.filter(
                    sa.or_(
                        ActivityLog.event_type.ilike("front_desk.board_%"),
                        ActivityLog.event_type.ilike("reservation.%"),
                    )
                )
                if last_timestamp:
                    query = query.filter(ActivityLog.created_at > last_timestamp)

                events = query.order_by(ActivityLog.created_at).all()

                for event in events:
                    event_id = f"{event.created_at.isoformat()}:{event.id}"
                    if event_id not in seen_events:
                        seen_events.add(event_id)

                        payload = {
                            "event": "board.changed",
                            "data": {
                                "activity_id": str(event.id),
                                "event_type": event.event_type,
                                "timestamp": event.created_at.isoformat(),
                                "entity_table": event.entity_table,
                                "entity_id": event.entity_id,
                                "metadata": event.metadata_json or {},
                            },
                        }

                        yield f"event: board.changed\n"
                        yield f"id: {event_id}\n"
                        yield f"data: {json.dumps(payload['data'])}\n\n"

                        last_timestamp = event.created_at

                # Sleep briefly before next query
                time.sleep(1)

        return Response(
            stream_with_context(event_stream()),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",  # For Nginx
                "Connection": "keep-alive",
            },
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
        business_date = parse_request_date_arg("date", default=date.today())
        detail = get_front_desk_detail(reservation_id, business_date=business_date)
        checkout_prep = prepare_checkout(reservation_id) if detail["reservation"].current_status == "checked_in" else None
        return render_template(
            "front_desk_detail.html",
            detail=detail,
            checkout_prep=checkout_prep,
            back_url=safe_back_path(request.args.get("back"), url_for("staff_front_desk")),
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
        arrival_date = parse_request_date_arg("arrival_date", default=None)
        departure_date = parse_request_date_arg("departure_date", default=None)
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

    @app.route("/staff/reservations/<uuid:reservation_id>")
    def staff_reservation_detail(reservation_id):
        require_permission("reservation.view")
        detail = get_reservation_detail(reservation_id)
        return render_template(
            "reservation_detail.html",
            detail=detail,
            back_url=safe_back_path(request.args.get("back"), url_for("staff_reservations")),
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
        return redirect(url_for("staff_reservation_detail", reservation_id=reservation_id))

    @app.route("/staff/reservations/<uuid:reservation_id>/pre-checkin")
    def staff_pre_checkin_detail(reservation_id):
        user = require_permission("reservation.view")
        reservation = db.session.get(Reservation, reservation_id)
        if not reservation:
            abort(404)
        pc = get_pre_checkin_for_reservation(reservation_id)
        docs = get_documents_for_reservation(reservation_id) if pc else []
        link = build_pre_checkin_link(pc.token) if pc else None
        return render_template(
            "staff_pre_checkin_detail.html",
            reservation=reservation,
            pc=pc,
            documents=docs,
            pre_checkin_link=link,
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
        from .services.pre_checkin_service import _upload_dir
        file_path = _upload_dir() / doc.storage_key
        if not file_path.is_file():
            abort(404)
        return Response(
            open(str(file_path), "rb").read(),
            mimetype=doc.content_type,
            headers={"Content-Disposition": f'inline; filename="{doc.original_filename}"'},
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
    if request.endpoint in {None, "static", "payment_webhook", "pre_checkin_save", "pre_checkin_upload"}:
        return
    expected = session.get("_csrf_token")
    provided = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token")
    if not expected or not provided or not hmac.compare_digest(expected, provided):
        abort(400, description="CSRF validation failed.")


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
    return bool(external_referrer_host() and request.endpoint in {"index", "availability", "booking_entry"})


def default_booking_attribution() -> dict:
    if request.method != "GET" or request.endpoint not in {"index", "availability", "booking_entry"}:
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
    if request.endpoint in {None, "static", "payment_webhook"}:
        return False
    if request.endpoint.startswith("staff_") or request.endpoint.startswith("provider_"):
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


def can(permission_code: str) -> bool:
    user = current_user()
    if not user:
        return False
    return user.has_permission(permission_code)


def default_dashboard_endpoint(user: User | None) -> str:
    if user and user.primary_role == "provider" and user.has_permission("provider.dashboard.view"):
        return "provider_dashboard"
    return "staff_dashboard"


def default_dashboard_url(user: User | None) -> str:
    return url_for(default_dashboard_endpoint(user))


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
    )


def front_desk_board_context(
    filters: FrontDeskBoardFilters,
    *,
    ical_import_report: dict | None = None,
) -> dict:
    board = build_front_desk_board(filters)
    back_url = front_desk_board_url(filters)
    hydrate_front_desk_board_urls(board, back_url=back_url, board_date=filters.start_date)
    room_types = RoomType.query.order_by(RoomType.code.asc()).all()
    board_v2_enabled = front_desk_board_v2_enabled()

    # Load user density preference
    user_density = "comfortable"  # default
    user = g.current_staff_user
    if user and user.preferences:
        user_density = (user.preferences.preferences or {}).get("frontDeskBoard", {}).get("density", "comfortable")

    return {
        "board": board,
        "board_v2_enabled": board_v2_enabled,
        "filters": filters,
        "room_types": room_types,
        "user_density": user_density,
        "default_checkout_date": filters.start_date + timedelta(days=1),
        "can_create": can("reservation.create"),
        "can_edit": can("reservation.edit"),
        "can_manage_closures": can("settings.edit"),
        "board_url": url_for("staff_front_desk_board"),
        "board_fragment_url": url_for("staff_front_desk_board_fragment"),
        "board_data_url": url_for("staff_front_desk_board_data"),
        "board_rooms_url": url_for("staff_front_desk_board_rooms"),
        "board_export_url": url_for("staff_front_desk_board_export_ical"),
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
    return query


def front_desk_board_url(filters: FrontDeskBoardFilters) -> str:
    return url_for("staff_front_desk_board", **front_desk_board_filter_query(filters))


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
                        "staff_reservation_detail",
                        reservation_id=UUID(reservation_id),
                        back=back_url,
                    )
                    block["frontDeskUrl"] = url_for(
                        "staff_front_desk_detail",
                        reservation_id=UUID(reservation_id),
                        back=back_url,
                        date=board_date.isoformat(),
                    )
                    block["reassignUrl"] = url_for(
                        "staff_front_desk_board_assign_room",
                        reservation_id=UUID(reservation_id),
                    )
                    block["moveUrl"] = url_for(
                        "staff_front_desk_board_move_reservation",
                        reservation_id=UUID(reservation_id),
                    )
                    block["resizeUrl"] = url_for(
                        "staff_front_desk_board_resize_reservation",
                        reservation_id=UUID(reservation_id),
                    )
                    block["datesFormUrl"] = url_for(
                        "staff_front_desk_board_change_dates",
                        reservation_id=UUID(reservation_id),
                    )
                    block["reassignOptions"] = reassign_options
                if override_id:
                    block["releaseUrl"] = url_for(
                        "staff_front_desk_board_release_closure",
                        override_id=UUID(override_id),
                    )
                    block["editUrl"] = url_for(
                        "staff_front_desk_board_update_closure",
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
