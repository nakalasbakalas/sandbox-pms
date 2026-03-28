from __future__ import annotations

import logging
from datetime import date
from uuid import UUID

import sqlalchemy as sa
from flask import Blueprint, abort, flash, redirect, render_template, request, url_for

from ..models import (
    ActivityLog,
    AppSetting,
    BlackoutPeriod,
    BookingExtra,
    InventoryOverride,
    NotificationTemplate,
    PaymentRequest,
    PolicyDocument,
    RateRule,
    Role,
    Room,
    RoomType,
    User,
)
from ..extensions import db
from ..constants import (
    BLACKOUT_TYPES,
    BOOKING_EXTRA_PRICING_MODES,
    INVENTORY_OVERRIDE_ACTIONS,
    INVENTORY_OVERRIDE_SCOPE_TYPES,
    NOTIFICATION_TEMPLATE_KEYS,
    OTA_PROVIDER_KEYS,
    OTA_PROVIDER_LABELS,
    POLICY_DOCUMENT_CODES,
    RATE_ADJUSTMENT_TYPES,
    RATE_RULE_TYPES,
    ROOM_OPERATIONAL_STATUSES,
    USER_ACCOUNT_STATES,
)
from ..i18n import normalize_language
from ..security import public_error_message
from ..pricing import get_setting_value, quote_reservation
from ..settings import NOTIFICATION_TEMPLATE_PLACEHOLDERS
from ..services.admin_service import (
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
    reset_notification_templates_to_defaults,
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
from ..services.admin_content_ops import policy_documents_context
from ..services.auth_service import (
    admin_disable_mfa,
    admin_issue_password_reset,
    create_staff_user,
    update_staff_user,
)
from ..services.communication_dispatch import (
    communication_settings_context,
    dispatch_notification_deliveries,
    query_notification_history,
    send_due_failed_payment_reminders,
    send_due_pre_arrival_reminders,
)
from ..services.messaging_service import (
    cancel_pending_automation_event,
    list_auto_response_rules,
    list_automation_rules,
    list_message_templates,
    list_pending_automation_events,
    process_pending_automations,
    upsert_auto_response_rule,
    upsert_automation_rule,
)
from ..services.admin_settings_ops import (
    housekeeping_defaults_context,
    payment_settings_context,
    property_settings_context,
)
from ..services.setup_service import (
    setup_completeness,
    setup_context,
)
from ..services.extras_service import (
    BookingExtraPayload,
    list_booking_extras,
    upsert_booking_extra,
)
from ..services.pre_checkin_service import (
    fire_pre_checkin_not_completed_events,
)
from ..services.storage import get_storage_backend
from ..seeds import clear_operational_data

logger = logging.getLogger(__name__)

admin_bp = Blueprint("admin", __name__)


def _get_app_helpers():
    """Lazy import of helpers from app.py to avoid circular dependencies."""
    from .. import app as app_module
    return {
        "require_admin_workspace_access": app_module.require_admin_workspace_access,
        "require_permission": app_module.require_permission,
        "require_any_permission": app_module.require_any_permission,
        "require_admin_role": app_module.require_admin_role,
        "require_user": app_module.require_user,
        "permission_groups": app_module.permission_groups,
        "is_admin_user": app_module.is_admin_user,
        "parse_optional_uuid": app_module.parse_optional_uuid,
        "parse_optional_date": app_module.parse_optional_date,
        "parse_optional_datetime": app_module.parse_optional_datetime,
        "parse_optional_int": app_module.parse_optional_int,
        "parse_optional_decimal": app_module.parse_optional_decimal,
        "parse_decimal": app_module.parse_decimal,
        "truthy_setting": app_module.truthy_setting,
    }


@admin_bp.route("/staff/admin")
def staff_admin_dashboard():
    helpers = _get_app_helpers()
    helpers["require_admin_workspace_access"]()
    return render_template(
        "admin.html",
        active_section="dashboard",
        room_type_count=db.session.execute(sa.select(sa.func.count()).select_from(RoomType)).scalar(),
        room_count=db.session.execute(sa.select(sa.func.count()).select_from(Room)).scalar(),
        active_override_count=db.session.execute(sa.select(sa.func.count()).select_from(InventoryOverride).filter_by(is_active=True)).scalar(),
        active_blackout_count=db.session.execute(sa.select(sa.func.count()).select_from(BlackoutPeriod).filter_by(is_active=True)).scalar(),
        policy_count=db.session.execute(sa.select(sa.func.count()).select_from(PolicyDocument).filter(PolicyDocument.deleted_at.is_(None))).scalar(),
        template_count=db.session.execute(sa.select(sa.func.count()).select_from(NotificationTemplate).filter(NotificationTemplate.deleted_at.is_(None))).scalar(),
        user_count=db.session.execute(sa.select(sa.func.count()).select_from(User).filter(User.deleted_at.is_(None))).scalar(),
        recent_audit=query_audit_entries(limit=12),
    )


@admin_bp.route("/staff/admin/test-error", methods=["POST"], endpoint="staff_admin_test_error")
def staff_admin_test_error():
    helpers = _get_app_helpers()
    actor = helpers["require_permission"]("audit.view")
    helpers["require_admin_role"](actor)
    raise RuntimeError("Sentry verification test")


@admin_bp.route("/staff/admin/setup", methods=["GET", "POST"], endpoint="staff_admin_setup")
def staff_admin_setup():
    """Consolidated first-time setup page for property configuration."""
    helpers = _get_app_helpers()
    actor = helpers["require_permission"]("settings.edit")
    helpers["require_admin_role"](actor)

    if request.method == "POST":
        section = request.form.get("section", "")
        try:
            if section == "property":
                _save_setup_property(actor, helpers)
                flash("Property information saved.", "success")
            elif section == "financial":
                _save_setup_financial(actor, helpers)
                flash("Financial defaults saved.", "success")
            elif section == "operational":
                _save_setup_operational(actor, helpers)
                flash("Operational defaults saved.", "success")
            elif section == "branding":
                _save_setup_branding(actor, helpers)
                flash("Branding settings saved.", "success")
            else:
                flash("Unknown section.", "warning")
        except (ValueError, KeyError) as exc:
            flash(f"Error: {exc}", "error")
        return redirect(url_for("admin.staff_admin_setup"))

    completeness = setup_completeness()
    ctx = setup_context()
    room_types = db.session.execute(
        sa.select(RoomType).order_by(RoomType.code)
    ).scalars().all()
    rooms = db.session.execute(
        sa.select(Room).order_by(Room.room_number)
    ).scalars().all()
    users = db.session.execute(
        sa.select(User).where(User.deleted_at.is_(None)).order_by(User.full_name)
    ).unique().scalars().all()
    return render_template(
        "admin_setup.html",
        active_section="setup",
        setup=ctx,
        completeness=completeness,
        room_types=room_types,
        rooms=rooms,
        users=users,
    )


def _save_setup_property(actor, helpers):
    """Save property information settings from setup form."""
    items = []
    field_map = {
        "hotel.name": ("hotel_name", "string"),
        "hotel.brand_mark": ("brand_mark", "string"),
        "hotel.contact_phone": ("contact_phone", "string"),
        "hotel.contact_email": ("contact_email", "string"),
        "hotel.address": ("address", "string"),
        "hotel.check_in_time": ("check_in_time", "time"),
        "hotel.check_out_time": ("check_out_time", "time"),
        "hotel.timezone": ("timezone", "string"),
        "hotel.currency": ("currency", "string"),
        "hotel.tax_id": ("tax_id", "string"),
        "hotel.public_base_url": ("public_base_url", "string"),
    }
    for key, (field, vtype) in field_map.items():
        val = request.form.get(field, "").strip()
        items.append({"key": key, "value": val, "value_type": vtype})
    hotel_name = request.form.get("hotel_name", "").strip()
    if not hotel_name:
        raise ValueError("Hotel name is required.")
    upsert_settings_bundle(items, actor_user_id=actor.id)


def _save_setup_financial(actor, helpers):
    """Save financial/booking default settings from setup form."""
    items = [
        {"key": "hotel.vat_rate", "value": request.form.get("vat_rate", "0.07").strip(), "value_type": "decimal"},
        {"key": "hotel.service_charge_rate", "value": request.form.get("service_charge_rate", "0.00").strip(), "value_type": "decimal"},
        {"key": "reservation.deposit_percentage", "value": request.form.get("deposit_percentage", "50.00").strip(), "value_type": "decimal"},
        {"key": "reservation.code_prefix", "value": request.form.get("code_prefix", "RES").strip().upper(), "value_type": "string"},
        {"key": "reservation.standard_cancellation_hours", "value": request.form.get("cancellation_hours", "24").strip(), "value_type": "integer"},
    ]
    upsert_settings_bundle(items, actor_user_id=actor.id)


def _save_setup_operational(actor, helpers):
    """Save operational default settings from setup form."""
    items = [
        {"key": "notifications.sender_name", "value": request.form.get("notifications_sender_name", "").strip(), "value_type": "string"},
        {"key": "hotel.support_contact_text", "value": request.form.get("support_contact_text", "").strip(), "value_type": "string"},
    ]
    upsert_settings_bundle(items, actor_user_id=actor.id)


def _save_setup_branding(actor, helpers):
    """Save branding settings from setup form."""
    items = [
        {"key": "hotel.logo_url", "value": request.form.get("logo_url", "").strip(), "value_type": "string"},
        {"key": "hotel.accent_color", "value": request.form.get("accent_color", "#C57C35").strip(), "value_type": "string"},
    ]
    upsert_settings_bundle(items, actor_user_id=actor.id)


@admin_bp.route("/staff/admin/staff-access", methods=["GET", "POST"], endpoint="staff_admin_staff_access")
@admin_bp.route("/staff/users", methods=["GET", "POST"])
def staff_users():
    helpers = _get_app_helpers()
    actor = helpers["require_permission"]("user.view")
    if request.method == "POST":
        action = request.form.get("action")
        try:
            if action == "create":
                helpers["require_permission"]("user.create")
                create_staff_user(
                    email=request.form.get("email", ""),
                    full_name=request.form.get("full_name", ""),
                    role_codes=request.form.getlist("role_codes"),
                    actor_user_id=actor.id,
                )
                flash("Staff account created. Password setup email queued.", "success")
            elif action == "update":
                helpers["require_permission"]("user.edit")
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
                helpers["require_permission"]("auth.reset_password_admin")
                admin_issue_password_reset(UUID(request.form["user_id"]), actor_user_id=actor.id)
                flash("Password reset issued.", "success")
            elif action == "disable_mfa":
                helpers["require_permission"]("auth.manage_mfa")
                admin_disable_mfa(UUID(request.form["user_id"]), actor_user_id=actor.id)
                flash("User MFA disabled and active sessions revoked.", "success")
            elif action == "role_permissions":
                helpers["require_permission"]("user.edit")
                helpers["require_admin_role"](actor)
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
        return redirect(url_for("admin.staff_users"))

    users = db.session.execute(sa.select(User).filter(User.deleted_at.is_(None)).order_by(User.full_name.asc())).unique().scalars().all()
    roles = db.session.execute(sa.select(Role).order_by(Role.sort_order.asc())).unique().scalars().all()
    recent_activity = db.session.execute(sa.select(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(20)).scalars().all()
    return render_template(
        "admin_staff_access.html",
        active_section="staff_access",
        users=users,
        roles=roles,
        recent_activity=recent_activity,
        account_states=USER_ACCOUNT_STATES,
        permission_groups=helpers["permission_groups"](),
        is_super_admin=helpers["is_admin_user"](actor),
    )


@admin_bp.route("/staff/admin/property", methods=["GET", "POST"], endpoint="staff_admin_property")
@admin_bp.route("/staff/settings", methods=["GET", "POST"])
def staff_settings():
    helpers = _get_app_helpers()
    helpers["require_permission"]("settings.view")
    if request.method == "POST":
        try:
            action = request.form.get("action") or "legacy_setting"
            if action == "legacy_setting":
                actor = helpers["require_permission"]("settings.edit")
                key = request.form.get("key", "")
                setting = db.session.execute(sa.select(AppSetting).filter_by(key=key, deleted_at=None)).scalar_one_or_none()
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
                from ..branding import clean_branding_form
                actor = helpers["require_permission"]("settings.edit")
                branding = clean_branding_form(request.form)
                upsert_settings_bundle(
                    [
                        {"key": "hotel.name", "value": branding["hotel_name"], "value_type": "string", "description": "Hotel display name", "is_public": True, "sort_order": 10},
                        {"key": "hotel.brand_mark", "value": branding["brand_mark"], "value_type": "string", "description": "Brand monogram", "is_public": True, "sort_order": 11},
                        {"key": "hotel.logo_url", "value": branding["logo_url"], "value_type": "string", "description": "Hotel logo URL", "is_public": True, "sort_order": 12},
                        {"key": "hotel.contact_phone", "value": branding["contact_phone"], "value_type": "string", "description": "Primary phone", "is_public": True, "sort_order": 13},
                        {"key": "hotel.contact_email", "value": branding["contact_email"], "value_type": "string", "description": "Primary contact email", "is_public": True, "sort_order": 14},
                        {"key": "hotel.contact_line_url", "value": branding["contact_line_url"], "value_type": "string", "description": "Guest LINE contact URL", "is_public": True, "sort_order": 15},
                        {"key": "hotel.contact_whatsapp_url", "value": branding["contact_whatsapp_url"], "value_type": "string", "description": "Guest WhatsApp contact URL", "is_public": True, "sort_order": 16},
                        {"key": "hotel.address", "value": branding["address"], "value_type": "string", "description": "Property address", "is_public": True, "sort_order": 17},
                        {"key": "hotel.currency", "value": branding["currency"], "value_type": "string", "description": "Hotel currency", "is_public": True, "sort_order": 18},
                        {"key": "hotel.check_in_time", "value": branding["check_in_time"], "value_type": "time", "description": "Standard check-in time", "is_public": True, "sort_order": 19},
                        {"key": "hotel.check_out_time", "value": branding["check_out_time"], "value_type": "time", "description": "Standard check-out time", "is_public": True, "sort_order": 20},
                        {"key": "hotel.tax_id", "value": branding["tax_id"], "value_type": "string", "description": "Business tax identifier", "is_public": False, "sort_order": 21},
                        {"key": "hotel.support_contact_text", "value": branding["support_contact_text"], "value_type": "string", "description": "Guest support message", "is_public": True, "sort_order": 22},
                        {"key": "hotel.accent_color", "value": branding["accent_color"], "value_type": "string", "description": "Primary accent color", "is_public": True, "sort_order": 23},
                        {"key": "hotel.accent_color_soft", "value": branding["accent_color_soft"], "value_type": "string", "description": "Secondary accent color", "is_public": True, "sort_order": 24},
                        {"key": "hotel.public_base_url", "value": branding["public_base_url"], "value_type": "string", "description": "Canonical public booking base URL", "is_public": True, "sort_order": 25},
                    ],
                    actor_user_id=actor.id,
                )
                flash("Property identity updated.", "success")
            elif action == "room_type":
                actor = helpers["require_permission"]("settings.edit")
                upsert_room_type(
                    helpers["parse_optional_uuid"](request.form.get("room_type_id")),
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
                        extra_bed_allowed=helpers["truthy_setting"](request.form.get("extra_bed_allowed")),
                        is_active=helpers["truthy_setting"](request.form.get("is_active")),
                    ),
                    actor_user_id=actor.id,
                )
                flash("Room type saved.", "success")
            elif action == "room":
                actor = helpers["require_permission"]("settings.edit")
                upsert_room(
                    helpers["parse_optional_uuid"](request.form.get("room_id")),
                    RoomPayload(
                        room_number=request.form.get("room_number", ""),
                        room_type_id=UUID(request.form["room_type_id"]),
                        floor_number=int(request.form.get("floor_number", 0)),
                        is_active=helpers["truthy_setting"](request.form.get("is_active")),
                        is_sellable=helpers["truthy_setting"](request.form.get("is_sellable")),
                        default_operational_status=request.form.get("default_operational_status", "available"),
                        notes=request.form.get("notes"),
                    ),
                    actor_user_id=actor.id,
                )
                flash("Room saved.", "success")
            elif action == "booking_extra":
                actor = helpers["require_permission"]("settings.edit")
                upsert_booking_extra(
                    helpers["parse_optional_uuid"](request.form.get("booking_extra_id")),
                    BookingExtraPayload(
                        code=request.form.get("code", ""),
                        name=request.form.get("name", ""),
                        description=request.form.get("description"),
                        pricing_mode=request.form.get("pricing_mode", "per_stay"),
                        unit_price=helpers["parse_decimal"](request.form.get("unit_price"), default="0.00"),
                        is_active=helpers["truthy_setting"](request.form.get("is_active")),
                        is_public=helpers["truthy_setting"](request.form.get("is_public")),
                        sort_order=int(request.form.get("sort_order", 100)),
                    ),
                    actor_user_id=actor.id,
                )
                flash("Booking extra saved.", "success")
            else:
                abort(400)
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("admin.staff_settings"))

    room_types = db.session.execute(sa.select(RoomType).order_by(RoomType.code.asc())).scalars().all()
    rooms = db.session.execute(sa.select(Room).join(RoomType).order_by(Room.floor_number.asc(), Room.room_number.asc())).scalars().all()
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


@admin_bp.route("/staff/admin/rates-inventory", methods=["GET", "POST"], endpoint="staff_admin_rates_inventory")
@admin_bp.route("/staff/rates", methods=["GET", "POST"])
def staff_rates():
    helpers = _get_app_helpers()
    helpers["require_any_permission"]("rate_rule.view", "settings.view")
    if request.method == "POST":
        try:
            action = request.form.get("action")
            if action == "rate_rule":
                actor = helpers["require_permission"]("rate_rule.edit")
                upsert_rate_rule(
                    helpers["parse_optional_uuid"](request.form.get("rate_rule_id")),
                    RateRulePayload(
                        name=request.form.get("name", ""),
                        room_type_id=helpers["parse_optional_uuid"](request.form.get("room_type_id")),
                        priority=int(request.form.get("priority", 100)),
                        is_active=helpers["truthy_setting"](request.form.get("is_active")),
                        rule_type=request.form.get("rule_type", ""),
                        adjustment_type=request.form.get("adjustment_type", ""),
                        adjustment_value=helpers["parse_decimal"](request.form.get("adjustment_value"), default="0.00"),
                        start_date=helpers["parse_optional_date"](request.form.get("start_date")),
                        end_date=helpers["parse_optional_date"](request.form.get("end_date")),
                        days_of_week=request.form.get("days_of_week"),
                        min_nights=helpers["parse_optional_int"](request.form.get("min_nights")),
                        max_nights=helpers["parse_optional_int"](request.form.get("max_nights")),
                        extra_guest_fee_override=helpers["parse_optional_decimal"](request.form.get("extra_guest_fee_override")),
                        child_fee_override=helpers["parse_optional_decimal"](request.form.get("child_fee_override")),
                    ),
                    actor_user_id=actor.id,
                )
                flash("Rate rule saved.", "success")
            elif action == "inventory_override":
                actor = helpers["require_permission"]("settings.edit")
                create_inventory_override(
                    InventoryOverridePayload(
                        name=request.form.get("name", ""),
                        scope_type=request.form.get("scope_type", ""),
                        override_action=request.form.get("override_action", ""),
                        room_id=helpers["parse_optional_uuid"](request.form.get("room_id")),
                        room_type_id=helpers["parse_optional_uuid"](request.form.get("override_room_type_id")),
                        start_date=date.fromisoformat(request.form["start_date"]),
                        end_date=date.fromisoformat(request.form["end_date"]),
                        reason=request.form.get("reason", ""),
                        expires_at=helpers["parse_optional_datetime"](request.form.get("expires_at")),
                    ),
                    actor_user_id=actor.id,
                )
                flash("Inventory override created.", "success")
            elif action == "release_override":
                actor = helpers["require_permission"]("settings.edit")
                release_inventory_override(UUID(request.form["override_id"]), actor_user_id=actor.id)
                flash("Inventory override released.", "success")
            elif action == "blackout":
                actor = helpers["require_permission"]("settings.edit")
                _, conflict_count = upsert_blackout_period(
                    helpers["parse_optional_uuid"](request.form.get("blackout_id")),
                    BlackoutPayload(
                        name=request.form.get("name", ""),
                        blackout_type=request.form.get("blackout_type", ""),
                        start_date=date.fromisoformat(request.form["start_date"]),
                        end_date=date.fromisoformat(request.form["end_date"]),
                        reason=request.form.get("reason", ""),
                        is_active=helpers["truthy_setting"](request.form.get("is_active")),
                    ),
                    actor_user_id=actor.id,
                )
                flash("Blackout period saved.", "success")
                if conflict_count:
                    flash(f"Warning: {conflict_count} active reservation(s) overlap this blackout period.", "warning")
            elif action == "deposit_settings":
                actor = helpers["require_permission"]("settings.edit")
                upsert_settings_bundle(
                    [
                        {"key": "reservation.deposit_percentage", "value": request.form.get("deposit_percentage"), "value_type": "decimal", "description": "Default reservation deposit percentage", "is_public": False, "sort_order": 40},
                        {"key": "payment.deposit_enabled", "value": helpers["truthy_setting"](request.form.get("deposit_enabled")), "value_type": "boolean", "description": "Enable hosted reservation payment requests", "is_public": False, "sort_order": 41},
                    ],
                    actor_user_id=actor.id,
                )
                flash("Deposit settings updated.", "success")
            else:
                abort(400)
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("admin.staff_rates"))

    room_types = db.session.execute(sa.select(RoomType).order_by(RoomType.code.asc())).scalars().all()
    rooms = db.session.execute(sa.select(Room).order_by(Room.floor_number.asc(), Room.room_number.asc())).scalars().all()
    rate_rules = db.session.execute(
        sa.select(RateRule).filter(RateRule.deleted_at.is_(None))
        .order_by(RateRule.priority.asc(), RateRule.name.asc())
    ).scalars().all()
    overrides = db.session.execute(
        sa.select(InventoryOverride).order_by(
            InventoryOverride.is_active.desc(),
            InventoryOverride.start_date.asc(),
            InventoryOverride.created_at.desc(),
        )
    ).scalars().all()
    blackouts = db.session.execute(sa.select(BlackoutPeriod).order_by(BlackoutPeriod.start_date.asc(), BlackoutPeriod.name.asc())).scalars().all()
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
        deposit_enabled=helpers["truthy_setting"](get_setting_value("payment.deposit_enabled", True)),
    )


@admin_bp.route("/staff/admin/operations", methods=["GET", "POST"])
def staff_admin_operations():
    helpers = _get_app_helpers()
    helpers["require_permission"]("settings.view")
    template_preview = None
    preview_key = request.args.get("template_key", "guest_confirmation")
    preview_channel = request.args.get("channel", "email")
    preview_language = normalize_language(request.args.get("language_code") or "th")
    if request.method == "POST":
        action = request.form.get("action")
        try:
            if action == "policy":
                actor = helpers["require_permission"]("settings.edit")
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
                        is_active=helpers["truthy_setting"](request.form.get("is_active")),
                    ),
                    actor_user_id=actor.id,
                )
                flash("Policy updated.", "success")
                return redirect(url_for("admin.staff_admin_operations"))
            if action == "notification_template":
                actor = helpers["require_permission"]("settings.edit")
                upsert_notification_template(
                    helpers["parse_optional_uuid"](request.form.get("template_id")),
                    NotificationTemplatePayload(
                        template_key=request.form.get("template_key", ""),
                        channel=request.form.get("channel", "email"),
                        language_code=normalize_language(request.form.get("language_code")),
                        description=request.form.get("description"),
                        subject_template=request.form.get("subject_template", ""),
                        body_template=request.form.get("body_template", ""),
                        is_active=helpers["truthy_setting"](request.form.get("is_active")),
                    ),
                    actor_user_id=actor.id,
                )
                flash("Notification template saved.", "success")
                return redirect(
                    url_for(
                        "admin.staff_admin_operations",
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
            elif action == "reset_templates_to_defaults":
                actor = helpers["require_permission"]("settings.edit")
                result = reset_notification_templates_to_defaults(actor_user_id=actor.id)
                flash(f"Templates reset to defaults: {result['updated']} updated, {result['created']} created.", "success")
                return redirect(url_for("admin.staff_admin_operations"))
            elif action == "clear_operational_data":
                actor = helpers["require_permission"]("settings.edit")
                helpers["require_admin_role"](actor)
                counts = clear_operational_data()
                removed = sum(v for k, v in counts.items() if not k.endswith("_reset"))
                flash(f"All reservations and guest data cleared. {removed} rows removed.", "success")
                return redirect(url_for("admin.staff_admin_operations"))
            elif action == "housekeeping_defaults":
                actor = helpers["require_permission"]("settings.edit")
                upsert_settings_bundle(
                    [
                        {"key": "housekeeping.require_inspected_for_ready", "value": helpers["truthy_setting"](request.form.get("require_inspected_for_ready")), "value_type": "boolean", "description": "Require inspected status before room readiness", "is_public": False, "sort_order": 80},
                        {"key": "housekeeping.checkout_dirty_status", "value": request.form.get("checkout_dirty_status"), "value_type": "string", "description": "Default housekeeping status applied after checkout", "is_public": False, "sort_order": 81},
                    ],
                    actor_user_id=actor.id,
                )
                flash("Housekeeping defaults updated.", "success")
                return redirect(url_for("admin.staff_admin_operations"))
            else:
                abort(400)
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")

    documents_by_code = policy_documents_context()
    templates = list(
        db.session.execute(
            sa.select(NotificationTemplate)
            .where(NotificationTemplate.deleted_at.is_(None))
            .order_by(NotificationTemplate.template_key.asc(), NotificationTemplate.channel.asc(), NotificationTemplate.language_code.asc())
        ).scalars()
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


@admin_bp.route("/staff/admin/communications", methods=["GET", "POST"], endpoint="staff_admin_communications")
def staff_admin_communications():
    helpers = _get_app_helpers()
    helpers["require_permission"]("settings.view")
    if request.method == "POST":
        action = request.form.get("action")
        try:
            actor = helpers["require_permission"]("settings.edit")
            if action == "save_settings":
                upsert_settings_bundle(
                    [
                        {"key": "notifications.sender_name", "value": request.form.get("sender_name"), "value_type": "string", "description": "Friendly sender name for hotel communications", "is_public": False, "sort_order": 120},
                        {"key": "notifications.pre_arrival_enabled", "value": helpers["truthy_setting"](request.form.get("pre_arrival_enabled")), "value_type": "boolean", "description": "Enable automatic pre-arrival reminders", "is_public": False, "sort_order": 121},
                        {"key": "notifications.pre_arrival_days_before", "value": request.form.get("pre_arrival_days_before"), "value_type": "integer", "description": "Days before arrival to send reminder", "is_public": False, "sort_order": 122},
                        {"key": "notifications.failed_payment_reminder_enabled", "value": helpers["truthy_setting"](request.form.get("failed_payment_reminder_enabled")), "value_type": "boolean", "description": "Enable failed payment reminders", "is_public": False, "sort_order": 123},
                        {"key": "notifications.failed_payment_reminder_delay_hours", "value": request.form.get("failed_payment_reminder_delay_hours"), "value_type": "integer", "description": "Delay before failed payment reminders", "is_public": False, "sort_order": 124},
                        {"key": "notifications.staff_email_alerts_enabled", "value": helpers["truthy_setting"](request.form.get("staff_email_alerts_enabled")), "value_type": "boolean", "description": "Enable staff alert emails", "is_public": False, "sort_order": 125},
                        {"key": "notifications.staff_alert_recipients", "value": request.form.get("staff_alert_recipients"), "value_type": "string", "description": "Staff alert recipient emails", "is_public": False, "sort_order": 126},
                        {"key": "notifications.line_staff_alert_enabled", "value": helpers["truthy_setting"](request.form.get("line_staff_alert_enabled")), "value_type": "boolean", "description": "Enable LINE staff alerts", "is_public": False, "sort_order": 127},
                        {"key": "notifications.whatsapp_staff_alert_enabled", "value": helpers["truthy_setting"](request.form.get("whatsapp_staff_alert_enabled")), "value_type": "boolean", "description": "Enable WhatsApp staff alerts", "is_public": False, "sort_order": 128},
                    ],
                    actor_user_id=actor.id,
                )
                flash("Communication settings updated.", "success")
            elif action == "dispatch_queue":
                try:
                    result = dispatch_notification_deliveries()
                    flash(f"Notification queue processed: {result['sent']} sent, {result['failed']} failed.", "success")
                except Exception as exc:
                    flash(f"Notification dispatch failed: {exc}", "error")
            elif action == "run_pre_arrival":
                result = send_due_pre_arrival_reminders(actor_user_id=actor.id)
                flash(f"Pre-arrival reminders queued: {result['queued']}, sent: {result['sent']}.", "success")
            elif action == "run_failed_payment":
                result = send_due_failed_payment_reminders(actor_user_id=actor.id)
                flash(f"Failed payment reminders queued: {result['queued']}, sent: {result['sent']}.", "success")
            elif action == "run_pre_checkin_reminders":
                result = fire_pre_checkin_not_completed_events(hours_before=48)
                flash(f"Pre-check-in reminder events: fired={result['fired']}, skipped={result['skipped']}.", "success")
            elif action == "save_automation_rule":
                delay_minutes = helpers["parse_optional_int"](request.form.get("delay_minutes")) or 0
                upsert_automation_rule(
                    rule_id=request.form.get("rule_id") or None,
                    event_type=request.form.get("event_type") or "",
                    channel=request.form.get("channel") or "email",
                    template_id=request.form.get("template_id") or None,
                    is_active=helpers["truthy_setting"](request.form.get("is_active")),
                    delay_minutes=delay_minutes,
                    actor_user_id=str(actor.id),
                )
                flash("Automation rule saved.", "success")
            elif action == "process_automation_queue":
                result = process_pending_automations()
                flash(f"Automation queue processed: {result['processed']} processed, {result['skipped']} skipped, {result['errors']} errors.", "success")
            elif action == "cancel_automation_event":
                event_id = request.form.get("event_id")
                cancel_pending_automation_event(event_id, actor_user_id=actor.id)
                flash("Automation event cancelled.", "success")
            elif action == "save_auto_response_rule":
                keywords_raw = (request.form.get("trigger_keywords") or "").strip()
                keywords = [kw.strip() for kw in keywords_raw.split(",") if kw.strip()]
                upsert_auto_response_rule(
                    rule_id=request.form.get("rule_id") or None,
                    name=request.form.get("name") or "",
                    trigger_keywords=keywords,
                    template_id=request.form.get("template_id") or "",
                    channel=request.form.get("channel") or "email",
                    is_active=helpers["truthy_setting"](request.form.get("is_active")),
                    actor_user_id=str(actor.id),
                )
                flash("Auto-response rule saved.", "success")
            else:
                abort(400)
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("admin.staff_admin_communications"))

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
        automation_rules=list_automation_rules(),
        auto_response_rules=list_auto_response_rules(),
        message_templates=list_message_templates(),
        pending_events=list_pending_automation_events(include_processed=False, limit=50),
        deliveries=deliveries,
        filters=filters,
        delivery_statuses=["pending", "queued", "delivered", "failed", "retry", "skipped", "cancelled"],
        delivery_channels=["email", "internal_notification", "line_staff_alert", "whatsapp_staff_alert"],
        audience_types=["guest", "staff"],
    )


@admin_bp.route("/staff/admin/payments", methods=["GET", "POST"])
def staff_admin_payments():
    helpers = _get_app_helpers()
    viewer = helpers["require_permission"]("settings.view")
    if request.method == "POST":
        try:
            actor = helpers["require_permission"]("settings.edit")
            selected_provider = (request.form.get("active_provider") or "env").strip().lower()
            if selected_provider != str(get_setting_value("payment.active_provider", "env")).strip().lower():
                helpers["require_admin_role"](actor)
            upsert_settings_bundle(
                [
                    {"key": "payment.active_provider", "value": selected_provider, "value_type": "string", "description": "Active hosted payment provider selector", "is_public": False, "sort_order": 90},
                    {"key": "payment.deposit_enabled", "value": helpers["truthy_setting"](request.form.get("deposit_enabled")), "value_type": "boolean", "description": "Enable reservation payment collection via hosted payments", "is_public": False, "sort_order": 91},
                    {"key": "payment.link_expiry_minutes", "value": request.form.get("link_expiry_minutes"), "value_type": "integer", "description": "Hosted payment link expiry in minutes", "is_public": False, "sort_order": 92},
                    {"key": "payment.link_resend_cooldown_seconds", "value": request.form.get("link_resend_cooldown_seconds"), "value_type": "integer", "description": "Minimum cooldown between payment link resends", "is_public": False, "sort_order": 93},
                ],
                actor_user_id=actor.id,
            )
            flash("Payment configuration updated.", "success")
        except Exception as exc:  # noqa: BLE001
            flash(public_error_message(exc), "error")
        return redirect(url_for("admin.staff_admin_payments"))

    recent_requests = db.session.execute(sa.select(PaymentRequest).order_by(PaymentRequest.created_at.desc()).limit(20)).scalars().all()
    return render_template(
        "admin_payments.html",
        active_section="payments",
        payment_settings=payment_settings_context(),
        recent_requests=recent_requests,
        is_super_admin=helpers["is_admin_user"](viewer),
    )


@admin_bp.route("/staff/admin/channels", methods=["GET", "POST"], endpoint="staff_admin_channels")
def staff_admin_channels():
    """OTA channel manager — operational dashboard with status, mappings, sync logs, and config.

    Serves as the main OTA control centre for staff/admin users. Supports
    channel configuration, connection testing, room type mapping management,
    and provides operational visibility into sync status and recent activity.
    """
    from ..services.channel_service import (
        delete_ota_mapping,
        list_sync_logs,
        ota_dashboard_context,
        test_ota_channel_connection,
        upsert_ota_channel,
        upsert_ota_mapping,
    )

    helpers = _get_app_helpers()
    require_permission = helpers["require_permission"]
    truthy_setting = helpers["truthy_setting"]

    require_permission("settings.view")

    if request.method == "POST":
        action = request.form.get("action")
        provider_key = (request.form.get("provider_key") or "").strip()

        try:
            if action == "save_channel":
                if provider_key not in OTA_PROVIDER_KEYS:
                    flash("Unknown OTA provider.", "error")
                    return redirect(url_for("admin.staff_admin_channels"))
                actor = require_permission("settings.edit")
                api_key = (request.form.get("api_key") or "").strip() or None
                api_secret = (request.form.get("api_secret") or "").strip() or None
                upsert_ota_channel(
                    provider_key=provider_key,
                    display_name=OTA_PROVIDER_LABELS.get(provider_key, provider_key),
                    is_active=truthy_setting(request.form.get("is_active")),
                    hotel_id=(request.form.get("hotel_id") or "").strip() or None,
                    endpoint_url=(request.form.get("endpoint_url") or "").strip() or None,
                    api_key=api_key,
                    api_secret=api_secret,
                    actor_user_id=actor.id,
                    sync_inventory_push=truthy_setting(request.form.get("sync_inventory_push")),
                    sync_rate_push=truthy_setting(request.form.get("sync_rate_push")),
                    sync_restriction_push=truthy_setting(request.form.get("sync_restriction_push")),
                    sync_reservation_pull=truthy_setting(request.form.get("sync_reservation_pull")),
                    environment_mode=(request.form.get("environment_mode") or "").strip() or None,
                )
                db.session.commit()
                flash(f"{OTA_PROVIDER_LABELS.get(provider_key, provider_key)} configuration saved.", "success")

            elif action == "test_connection":
                if provider_key not in OTA_PROVIDER_KEYS:
                    flash("Unknown OTA provider.", "error")
                    return redirect(url_for("admin.staff_admin_channels"))
                actor = require_permission("settings.view")
                result = test_ota_channel_connection(provider_key, actor_user_id=actor.id)
                if result["success"]:
                    flash(f"{OTA_PROVIDER_LABELS.get(provider_key, provider_key)}: connection test passed.", "success")
                else:
                    flash(
                        f"{OTA_PROVIDER_LABELS.get(provider_key, provider_key)}: connection test failed — "
                        f"{result.get('error') or 'no credentials configured'}.",
                        "error",
                    )

            elif action == "save_mapping":
                actor = require_permission("settings.edit")
                if provider_key not in OTA_PROVIDER_KEYS:
                    flash("Unknown OTA provider.", "error")
                    return redirect(url_for("admin.staff_admin_channels"))
                from ..helpers import parse_optional_uuid
                room_type_id = parse_optional_uuid(request.form.get("room_type_id"))
                ext_code = (request.form.get("external_room_type_code") or "").strip()
                if not room_type_id or not ext_code:
                    flash("Room type and external code are required.", "error")
                    return redirect(url_for("admin.staff_admin_channels"))
                if len(ext_code) > 120:
                    flash("External room type code is too long (max 120 characters).", "error")
                    return redirect(url_for("admin.staff_admin_channels"))
                upsert_ota_mapping(
                    provider_key=provider_key,
                    room_type_id=room_type_id,
                    external_room_type_code=ext_code,
                    external_room_type_name=(request.form.get("external_room_type_name") or "").strip() or None,
                    external_rate_plan_code=(request.form.get("external_rate_plan_code") or "").strip() or None,
                    external_rate_plan_name=(request.form.get("external_rate_plan_name") or "").strip() or None,
                    is_active=truthy_setting(request.form.get("mapping_active")),
                    notes=(request.form.get("mapping_notes") or "").strip() or None,
                    actor_user_id=actor.id,
                )
                db.session.commit()
                flash("Room type mapping saved.", "success")

            elif action == "delete_mapping":
                actor = require_permission("settings.edit")
                from ..helpers import parse_optional_uuid
                mapping_id = parse_optional_uuid(request.form.get("mapping_id"))
                if mapping_id and delete_ota_mapping(mapping_id, actor_user_id=actor.id):
                    db.session.commit()
                    flash("Mapping removed.", "success")
                else:
                    flash("Mapping not found.", "error")

        except Exception as exc:  # noqa: BLE001
            db.session.rollback()
            flash(public_error_message(exc), "error")

        return redirect(url_for("admin.staff_admin_channels"))

    dashboard = ota_dashboard_context()

    return render_template(
        "admin_channels.html",
        active_section="channels",
        dashboard=dashboard,
        channels=dashboard["channels"],
        room_types=dashboard["room_types"],
        recent_logs=dashboard["recent_logs"],
        summary=dashboard["summary"],
    )


@admin_bp.route("/staff/rate-calculator", methods=["GET"])
def staff_rate_calculator():
    """Rate preview calculator for staff."""
    helpers = _get_app_helpers()
    helpers["require_permission"]("reservation.view")
    room_types = db.session.execute(
        sa.select(RoomType).where(RoomType.is_active.is_(True)).order_by(RoomType.code.asc())
    ).scalars().all()
    return render_template("staff_rate_calculator.html", room_types=room_types, active_section="rates")


@admin_bp.route("/staff/rate-calculator/quote", methods=["POST"])
def staff_rate_calculator_quote():
    """Calculate and return a rate quote."""
    helpers = _get_app_helpers()
    helpers["require_permission"]("reservation.view")

    room_type_id = helpers["parse_optional_uuid"](request.form.get("room_type_id"))
    check_in_str = (request.form.get("check_in_date") or "").strip()
    check_out_str = (request.form.get("check_out_date") or "").strip()
    adults = int(request.form.get("adults") or 1)
    children = int(request.form.get("children") or 0)

    errors: list[str] = []
    if not room_type_id:
        errors.append("Room type is required.")
    if not check_in_str:
        errors.append("Check-in date is required.")
    if not check_out_str:
        errors.append("Check-out date is required.")

    room_type = None
    check_in_date = None
    check_out_date = None

    if room_type_id:
        room_type = db.session.get(RoomType, room_type_id)
        if not room_type:
            errors.append("Room type not found.")

    try:
        if check_in_str:
            check_in_date = date.fromisoformat(check_in_str)
        if check_out_str:
            check_out_date = date.fromisoformat(check_out_str)
    except ValueError:
        errors.append("Invalid date format.")

    if check_in_date and check_out_date and check_out_date <= check_in_date:
        errors.append("Check-out date must be after check-in date.")

    room_types = db.session.execute(
        sa.select(RoomType).where(RoomType.is_active.is_(True)).order_by(RoomType.code.asc())
    ).scalars().all()

    if errors:
        for msg in errors:
            flash(msg, "error")
        return render_template(
            "staff_rate_calculator.html",
            room_types=room_types,
            active_section="rates",
            form_room_type_id=str(room_type_id) if room_type_id else "",
            form_check_in=check_in_str,
            form_check_out=check_out_str,
            form_adults=adults,
            form_children=children,
        )

    quote = quote_reservation(
        room_type=room_type,
        check_in_date=check_in_date,
        check_out_date=check_out_date,
        adults=adults,
        children=children,
    )

    return render_template(
        "staff_rate_calculator.html",
        room_types=room_types,
        active_section="rates",
        quote=quote,
        form_room_type_id=str(room_type_id),
        form_check_in=check_in_str,
        form_check_out=check_out_str,
        form_adults=adults,
        form_children=children,
        selected_room_type=room_type,
    )


@admin_bp.route("/staff/admin/rates/<uuid:rule_id>/clone", methods=["POST"])
def staff_admin_rate_clone(rule_id):
    """Clone a rate rule."""
    helpers = _get_app_helpers()
    actor = helpers["require_permission"]("rate_rule.edit")

    original = db.session.get(RateRule, rule_id)
    if not original or original.deleted_at is not None:
        abort(404)

    clone = RateRule(
        name=f"{original.name} (Copy)",
        room_type_id=original.room_type_id,
        priority=original.priority,
        is_active=False,
        rule_type=original.rule_type,
        adjustment_type=original.adjustment_type,
        adjustment_value=original.adjustment_value,
        start_date=original.start_date,
        end_date=original.end_date,
        days_of_week=original.days_of_week,
        min_nights=original.min_nights,
        max_nights=original.max_nights,
        extra_guest_fee_override=original.extra_guest_fee_override,
        child_fee_override=original.child_fee_override,
        metadata_json=original.metadata_json,
        created_by_user_id=actor.id,
    )
    db.session.add(clone)
    db.session.commit()

    flash(f'Rate rule "{original.name}" cloned. The copy is inactive by default.', "success")
    return redirect(url_for("admin.staff_rates"))


# ------------------------------------------------------------------
# Room photo management
# ------------------------------------------------------------------

ALLOWED_PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


@admin_bp.route("/staff/admin/rooms/<uuid:room_id>/photos", methods=["POST"])
def staff_admin_room_photos(room_id):
    """Upload a photo for a room and store the path in the photos JSON array."""
    helpers = _get_app_helpers()
    actor = helpers["require_permission"]("settings.edit")
    room = db.session.get(Room, room_id)
    if not room:
        abort(404)

    action = request.form.get("action", "upload")

    if action == "set_floor_plan_url":
        floor_plan_url = request.form.get("floor_plan_url", "").strip() or None
        room.floor_plan_url = floor_plan_url
        room.updated_by_user_id = actor.id
        db.session.commit()
        flash("Floor plan URL updated.", "success")
        return redirect(url_for("admin.staff_settings"))

    if action == "remove_photo":
        index = int(request.form.get("photo_index", -1))
        photos = list(room.photos or [])
        if 0 <= index < len(photos):
            photos.pop(index)
            room.photos = photos or None
            room.updated_by_user_id = actor.id
            db.session.commit()
            flash("Photo removed.", "success")
        else:
            flash("Photo not found.", "error")
        return redirect(url_for("admin.staff_settings"))

    # Default: upload
    uploaded_file = request.files.get("photo")
    if not uploaded_file or not uploaded_file.filename:
        flash("No file selected.", "error")
        return redirect(url_for("admin.staff_settings"))

    import os
    ext = os.path.splitext(uploaded_file.filename)[1].lower()
    if ext not in ALLOWED_PHOTO_EXTENSIONS:
        flash(f"File type not allowed. Use: {', '.join(sorted(ALLOWED_PHOTO_EXTENSIONS))}", "error")
        return redirect(url_for("admin.staff_settings"))

    try:
        backend = get_storage_backend()
        storage_key = backend.save(uploaded_file, room.id, ext)
    except Exception as exc:  # noqa: BLE001
        flash(public_error_message(exc), "error")
        return redirect(url_for("admin.staff_settings"))

    photos = list(room.photos or [])
    photos.append(storage_key)
    room.photos = photos
    room.updated_by_user_id = actor.id
    db.session.commit()

    flash("Room photo uploaded.", "success")
    return redirect(url_for("admin.staff_settings"))


@admin_bp.route("/staff/admin/services", methods=["GET", "POST"])
def staff_admin_services():
    """Manage additional services / extras catalog."""
    helpers = _get_app_helpers()
    actor = helpers["require_permission"]("settings.view")
    if request.method == "POST":
        helpers["require_permission"]("settings.edit")
        action = request.form.get("action", "upsert")
        if action == "upsert":
            extra_id = request.form.get("extra_id", "").strip()
            code = (request.form.get("code") or "").strip()
            name = (request.form.get("name") or "").strip()
            if not code or not name:
                flash("Code and name are required.", "error")
                return redirect(url_for("admin.staff_admin_services"))
            description = (request.form.get("description") or "").strip() or None
            pricing_mode = request.form.get("pricing_mode", "per_stay")
            try:
                unit_price = float(request.form.get("unit_price") or 0)
            except (ValueError, TypeError):
                unit_price = 0.0
            is_active = request.form.get("is_active") == "1"
            is_public = request.form.get("is_public") == "1"
            try:
                sort_order = int(request.form.get("sort_order") or 100)
            except (ValueError, TypeError):
                sort_order = 100
            if extra_id:
                extra = db.session.get(BookingExtra, extra_id)
                if extra:
                    extra.code = code
                    extra.name = name
                    extra.description = description
                    extra.pricing_mode = pricing_mode
                    extra.unit_price = unit_price
                    extra.is_active = is_active
                    extra.is_public = is_public
                    extra.sort_order = sort_order
                    extra.updated_by_user_id = actor.id
                    db.session.commit()
                    flash(f"Service '{name}' updated.", "success")
            else:
                extra = BookingExtra(
                    code=code,
                    name=name,
                    description=description,
                    pricing_mode=pricing_mode,
                    unit_price=unit_price,
                    is_active=is_active,
                    is_public=is_public,
                    sort_order=sort_order,
                    created_by_user_id=actor.id,
                    updated_by_user_id=actor.id,
                )
                db.session.add(extra)
                db.session.commit()
                flash(f"Service '{name}' created.", "success")
        elif action == "toggle":
            extra_id = request.form.get("extra_id", "").strip()
            if extra_id:
                extra = db.session.get(BookingExtra, extra_id)
                if extra:
                    extra.is_active = not extra.is_active
                    extra.updated_by_user_id = actor.id
                    db.session.commit()
                    flash(f"Service '{extra.name}' {'activated' if extra.is_active else 'deactivated'}.", "success")
        return redirect(url_for("admin.staff_admin_services"))

    extras = db.session.execute(
        sa.select(BookingExtra).order_by(BookingExtra.sort_order.asc(), BookingExtra.name.asc())
    ).scalars().all()
    return render_template(
        "admin_services.html",
        is_staff=True,
        extras=extras,
        pricing_modes=BOOKING_EXTRA_PRICING_MODES,
        active_section="services",
    )
