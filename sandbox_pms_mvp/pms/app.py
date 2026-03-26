from __future__ import annotations

import logging
import secrets
from decimal import Decimal
from uuid import UUID

logger = logging.getLogger(__name__)

import sqlalchemy as sa
from flask import Flask, Response, abort, g, redirect, request, session, url_for
from markupsafe import Markup

from .audit import cleanup_audit_logs
from .booking_attribution import (
    BOOKING_ATTRIBUTION_SESSION_KEY,
    BOOKING_ATTRIBUTION_TRACKED_ENDPOINTS,
    PUBLIC_BOOKING_LANDING_ENDPOINTS,
    PUBLIC_NON_CACHEABLE_ENDPOINTS,
    PUBLIC_WEBHOOK_ENDPOINTS,
    booking_attribution_from_request,
    booking_request_starts_new_attribution,
    capture_public_booking_attribution,
    clean_public_path,
    clean_tracking_value,
    current_booking_attribution,
    default_booking_attribution,
    derive_source_label,
    external_referrer_host,
    merge_booking_attribution,
    normalize_tracking_slug,
    referrer_source_label,
    resolve_booking_source_channel,
    source_metadata_from_request,
)
from .branding import (
    branding_settings_context,
    line_href as branding_line_href,
    whatsapp_href as branding_whatsapp_href,
)
from .cli_commands import register_cli
from .config import Config, normalize_runtime_config
from .constants import (
    BOOKING_SOURCE_CHANNELS,
    CONVERSATION_CHANNEL_TYPES,
    CONVERSATION_STATUSES,
)
from .extensions import db, migrate
from .i18n import LANGUAGE_LABELS, normalize_language, t
from .models import (
    ReservationHold,
    RoomType,
)
from .security import configure_app_security, current_csp_nonce, current_request_id, public_error_message
from .seeds import bootstrap_inventory_horizon, seed_all, seed_reference_data
from .url_topology import canonical_redirect_url, marketing_site_base_url, staff_app_base_url
from .helpers import (
    absolute_public_url,
    available_admin_sections,
    can,
    _contact_link,
    current_language,
    current_settings,
    current_user,
    default_dashboard_url,
    email_href,
    ensure_csrf_token,
    is_admin_user,
    is_staff_or_provider_endpoint,
    parse_booking_extra_ids,
    parse_decimal,
    parse_optional_date,
    parse_optional_datetime,
    parse_optional_decimal,
    parse_optional_int,
    parse_optional_uuid,
    parse_request_date_arg,
    parse_request_int_arg,
    parse_request_uuid_arg,
    permission_groups,
    phone_href,
    require_admin_role,
    require_admin_workspace_access,
    require_any_permission,
    require_permission,
    require_user,
    safe_back_path,
    truthy_setting,
    validate_csrf_request,
)
from .services.admin_service import (
    policy_text,
)
from .services.auth_service import (
    load_session_from_cookie,
)
from .services.communication_service import (
    send_due_pre_arrival_reminders,
)
from .services.extras_service import (
    list_booking_extras,
    quote_booking_extras,
    reservation_extra_summary,
    resolve_booking_extras,
)
from .services.front_desk_service import (
    auto_cancel_no_shows,
)
from .services.ical_service import (
    sync_all_external_calendar_sources,
)
from .services.public_booking_service import (
    PublicSearchPayload,
    build_room_type_content,
    search_public_availability,
)
from .services.messaging_service import (
    total_unread_count,
)



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
    from .routes.cafe import cafe_bp
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
    app.register_blueprint(cafe_bp)

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
    def load_authenticated_staff_session() -> Response | None:
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
                return redirect(url_for("auth.staff_mfa_verify"))  # type: ignore[return-value]

        if g.current_staff_user and (g.current_staff_user.force_password_reset or g.current_staff_user.account_state == "password_reset_required"):
            allowed_endpoints = {
                "auth.staff_security",
                "auth.staff_logout",
                "auth.staff_mfa_verify",
                "static",
            }
            if request.endpoint not in allowed_endpoints:
                flash("Password reset is required before continuing.", "warning")
                return redirect(url_for("auth.staff_security"))  # type: ignore[return-value]

        if g.current_staff_user and request.endpoint in {"auth.staff_login", "auth.staff_forgot_password", "auth.staff_reset_password"}:
            return redirect(default_dashboard_url(g.current_staff_user))  # type: ignore[return-value]

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


def _admin_setup_incomplete(staff_user) -> bool:
    """Return True if admin setup is not yet complete (for admin-only banner)."""
    if not staff_user:
        return False
    if not is_admin_user(staff_user):
        return False
    endpoint = request.endpoint or ""
    if not endpoint.startswith("admin."):
        return False
    try:
        from .services.setup_service import setup_completeness
        return not setup_completeness()["complete"]
    except Exception:  # noqa: BLE001
        return False


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
                return url_for(request.endpoint or "", **args)
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
            "setup_incomplete": _admin_setup_incomplete(current_staff),
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

