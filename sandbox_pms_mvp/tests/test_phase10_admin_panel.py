from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
import sqlalchemy as sa
from werkzeug.security import generate_password_hash

from pms.extensions import db
from pms.models import AuditLog, BookingExtra, HousekeepingStatus, InventoryDay, NotificationTemplate, RateRule, Role, Room, RoomType, User
from pms.pricing import get_setting_value, nightly_room_rate
from pms.services.admin_service import (
    BlackoutPayload,
    InventoryOverridePayload,
    PolicyPayload,
    RateRulePayload,
    assert_blackout_allows_booking,
    create_inventory_override,
    policy_text,
    query_audit_entries,
    release_inventory_override,
    render_notification_template,
    upsert_blackout_period,
    upsert_rate_rule,
    upsert_setting,
)
from pms.services.front_desk_service import room_readiness_snapshot
from pms.services.reservation_service import ReservationCreatePayload, calculate_deposit_required, create_reservation


def make_staff_user(*, email: str, role_codes: tuple[str, ...]) -> User:
    user = User(
        username=email.split("@", 1)[0],
        email=email,
        full_name=email.split("@", 1)[0].replace(".", " ").title(),
        password_hash=generate_password_hash("password123456"),
        is_active=True,
        account_state="active",
    )
    user.roles = Role.query.filter(Role.code.in_(role_codes)).all()
    db.session.add(user)
    db.session.commit()
    return user


def login_as(client, user: User) -> None:
    with client.session_transaction() as client_session:
        client_session["staff_user_id"] = str(user.id)
        client_session["_csrf_token"] = "test-csrf-token"


def post_form(client, url: str, *, data: dict, follow_redirects: bool = False):
    payload = dict(data)
    payload["csrf_token"] = "test-csrf-token"
    return client.post(url, data=payload, follow_redirects=follow_redirects)


def create_future_reservation(*, room_type_code: str = "TWN"):
    room_type = RoomType.query.filter_by(code=room_type_code).one()
    start_date = date.today() + timedelta(days=7)
    return create_reservation(
        ReservationCreatePayload(
            first_name="Config",
            last_name="Guest",
            phone="+66810000001",
            email="config.guest@example.com",
            room_type_id=room_type.id,
            check_in_date=start_date,
            check_out_date=start_date + timedelta(days=2),
            adults=2,
            children=0,
            source_channel="admin_manual",
        )
    )


def test_admin_pages_require_backend_permissions(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))
        front_desk = make_staff_user(email="desk-admincheck@example.com", role_codes=("front_desk",))

    admin_client = app.test_client()
    login_as(admin_client, admin)
    assert admin_client.get("/staff/admin").status_code == 200
    assert admin_client.get("/staff/admin/property").status_code == 200
    assert admin_client.get("/staff/admin/operations").status_code == 200
    assert admin_client.get("/staff/admin/payments").status_code == 200
    assert admin_client.get("/staff/admin/channels").status_code == 200
    assert admin_client.get("/staff/admin/audit").status_code == 200

    desk_client = app.test_client()
    login_as(desk_client, front_desk)
    assert desk_client.get("/staff/admin").status_code == 403
    assert desk_client.get("/staff/admin/property").status_code == 403
    assert desk_client.get("/staff/admin/operations").status_code == 403
    assert desk_client.get("/staff/admin/payments").status_code == 403
    assert desk_client.get("/staff/admin/channels").status_code == 403
    assert desk_client.get("/staff/admin/audit").status_code == 403


def test_room_type_and_room_manager_updates_persist_and_audit(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))
        room_216 = Room.query.filter_by(room_number="216").one()

    login_as(client, admin)
    response = post_form(
        client,
        "/staff/settings",
        data={
            "action": "room_type",
            "code": "FAM",
            "name": "Family Triple",
            "summary": "Flexible triple room with room for a small family",
            "description": "Flexible triple room",
            "bed_details": "One queen bed and one single bed",
            "media_urls": "https://cdn.example.test/family-1.jpg\nhttps://cdn.example.test/family-2.jpg",
            "amenities": "Dining nook\nBlackout curtains",
            "policy_callouts": "Accessible by lift only\nQuiet hours from 22:00",
            "standard_occupancy": "2",
            "max_occupancy": "3",
            "extra_bed_allowed": "on",
            "is_active": "on",
        },
    )
    assert response.status_code == 302

    response = post_form(
        client,
        "/staff/settings",
        data={
            "action": "room",
            "room_id": str(room_216.id),
            "room_number": "216",
            "room_type_id": str(room_216.room_type_id),
            "floor_number": "2",
            "default_operational_status": "out_of_service",
            "notes": "Swing room reserved for admin maintenance planning",
        },
    )
    assert response.status_code == 302

    with app.app_context():
        room_type = RoomType.query.filter_by(code="FAM").one()
        updated_room = db.session.get(Room, room_216.id)
        assert room_type.name == "Family Triple"
        assert room_type.summary == "Flexible triple room with room for a small family"
        assert room_type.bed_details == "One queen bed and one single bed"
        assert room_type.media_urls == [
            "https://cdn.example.test/family-1.jpg",
            "https://cdn.example.test/family-2.jpg",
        ]
        assert room_type.amenities == ["Dining nook", "Blackout curtains"]
        assert room_type.policy_callouts == ["Accessible by lift only", "Quiet hours from 22:00"]
        assert room_type.extra_bed_allowed is True
        assert updated_room.notes == "Swing room reserved for admin maintenance planning"
        assert AuditLog.query.filter_by(action="room_type_upserted", entity_table="room_types").count() >= 1
        assert AuditLog.query.filter_by(action="room_upserted", entity_table="rooms").count() >= 1


def test_booking_extra_manager_updates_persist_and_audit(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))

    login_as(client, admin)
    response = post_form(
        client,
        "/staff/settings",
        data={
            "action": "booking_extra",
            "code": "BFST",
            "name": "Daily breakfast",
            "description": "Buffet breakfast for each morning of the stay",
            "pricing_mode": "per_night",
            "unit_price": "350.00",
            "sort_order": "15",
            "is_public": "on",
            "is_active": "on",
        },
    )
    assert response.status_code == 302

    with app.app_context():
        extra = BookingExtra.query.filter_by(code="BFST").one()
        assert extra.name == "Daily breakfast"
        assert extra.pricing_mode == "per_night"
        assert extra.unit_price == Decimal("350.00")
        assert extra.is_public is True
        assert AuditLog.query.filter_by(action="booking_extra_upserted", entity_table="booking_extras").count() >= 1


def test_rate_rule_conflicts_and_blackouts_are_enforced(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))
        twin = RoomType.query.filter_by(code="TWN").one()
        start_date = date.today() + timedelta(days=10)
        end_date = start_date + timedelta(days=5)

        upsert_rate_rule(
            None,
            RateRulePayload(
                name="Peak Twin Test",
                room_type_id=twin.id,
                priority=777,
                is_active=True,
                rule_type="seasonal_override",
                adjustment_type="fixed",
                adjustment_value=Decimal("990.00"),
                start_date=start_date,
                end_date=end_date,
                days_of_week=None,
                min_nights=None,
                max_nights=None,
                extra_guest_fee_override=None,
                child_fee_override=None,
            ),
            actor_user_id=admin.id,
        )

        with pytest.raises(ValueError, match="Conflicts with active rule"):
            upsert_rate_rule(
                None,
                RateRulePayload(
                    name="Peak Twin Conflict",
                    room_type_id=twin.id,
                    priority=777,
                    is_active=True,
                    rule_type="seasonal_override",
                    adjustment_type="fixed",
                    adjustment_value=Decimal("1050.00"),
                    start_date=start_date,
                    end_date=end_date,
                    days_of_week=None,
                    min_nights=None,
                    max_nights=None,
                    extra_guest_fee_override=None,
                    child_fee_override=None,
                ),
                actor_user_id=admin.id,
            )

        upsert_blackout_period(
            None,
            BlackoutPayload(
                name="Songkran closure",
                blackout_type="closed_to_booking",
                start_date=start_date,
                end_date=start_date + timedelta(days=2),
                reason="Closed for annual maintenance window",
                is_active=True,
            ),
            actor_user_id=admin.id,
        )

        with pytest.raises(ValueError, match="Closed for annual maintenance window"):
            assert_blackout_allows_booking(start_date, start_date + timedelta(days=1))

        assert AuditLog.query.filter_by(action="rate_rule_upserted", entity_table="rate_rules").count() >= 1
        assert AuditLog.query.filter_by(action="blackout_upserted", entity_table="blackout_periods").count() >= 1


def test_rate_rules_use_configured_base_rate_and_apply_long_stay_after_fixed_override(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))
        twin = RoomType(
            code="ZZT",
            name="Isolated Rate Test",
            standard_occupancy=2,
            max_occupancy=2,
            extra_bed_allowed=False,
            is_active=True,
            created_by_user_id=admin.id,
        )
        db.session.add(twin)
        db.session.commit()
        business_date = date.today() + timedelta(days=12)

        for rule in RateRule.query.filter(
            RateRule.deleted_at.is_(None),
            RateRule.is_active.is_(True),
            sa.or_(RateRule.start_date.is_(None), RateRule.start_date <= business_date),
            sa.or_(RateRule.end_date.is_(None), RateRule.end_date >= business_date),
        ).all():
            rule.is_active = False
        db.session.commit()

        upsert_setting("hotel.base_rate", value="920.00", value_type="money", actor_user_id=admin.id)
        assert nightly_room_rate(twin, business_date, 2) == Decimal("920.00")

        upsert_rate_rule(
            None,
            RateRulePayload(
                name="Fixed Twin Test",
                room_type_id=twin.id,
                priority=810,
                is_active=True,
                rule_type="seasonal_override",
                adjustment_type="fixed",
                adjustment_value=Decimal("1000.00"),
                start_date=business_date,
                end_date=business_date,
                days_of_week=None,
                min_nights=None,
                max_nights=None,
                extra_guest_fee_override=None,
                child_fee_override=None,
            ),
            actor_user_id=admin.id,
        )
        upsert_rate_rule(
            None,
            RateRulePayload(
                name="Long Stay Discount Test",
                room_type_id=twin.id,
                priority=811,
                is_active=True,
                rule_type="long_stay_discount",
                adjustment_type="percent_delta",
                adjustment_value=Decimal("-10.00"),
                start_date=business_date,
                end_date=business_date,
                days_of_week=None,
                min_nights=3,
                max_nights=None,
                extra_guest_fee_override=None,
                child_fee_override=None,
            ),
            actor_user_id=admin.id,
        )

        assert nightly_room_rate(twin, business_date, 4) == Decimal("900.00")


def test_upsert_setting_centralizes_validation_for_typed_property_fields(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))

        with pytest.raises(ValueError, match="HH:MM"):
            upsert_setting("hotel.check_in_time", value="25:61", value_type="time", actor_user_id=admin.id)
        with pytest.raises(ValueError, match="valid address"):
            upsert_setting("hotel.contact_email", value="invalid-email", value_type="string", actor_user_id=admin.id)
        with pytest.raises(ValueError, match="Currency"):
            upsert_setting("hotel.currency", value="THB1", value_type="string", actor_user_id=admin.id)


def test_inventory_override_changes_live_inventory_and_release_restores_it(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))
        room = Room.query.filter_by(room_number="201").one()
        start_date = date.today() + timedelta(days=4)
        end_date = start_date + timedelta(days=1)

        override = create_inventory_override(
            InventoryOverridePayload(
                name="Temporary repair",
                scope_type="room",
                override_action="close",
                room_id=room.id,
                room_type_id=None,
                start_date=start_date,
                end_date=end_date,
                reason="Air conditioning maintenance",
            ),
            actor_user_id=admin.id,
        )

        rows = InventoryDay.query.filter(
            InventoryDay.room_id == room.id,
            InventoryDay.business_date >= start_date,
            InventoryDay.business_date <= end_date,
        ).all()
        assert rows
        assert all(row.is_sellable is False for row in rows)
        assert all(row.availability_status == "out_of_service" for row in rows)

        release_inventory_override(override.id, actor_user_id=admin.id)

        restored_rows = InventoryDay.query.filter(
            InventoryDay.room_id == room.id,
            InventoryDay.business_date >= start_date,
            InventoryDay.business_date <= end_date,
        ).all()
        assert all(row.is_sellable is True for row in restored_rows)
        assert all(row.availability_status == "available" for row in restored_rows)
        assert AuditLog.query.filter_by(action="inventory_override_created", entity_table="inventory_overrides").count() == 1
        assert AuditLog.query.filter_by(action="inventory_override_released", entity_table="inventory_overrides").count() == 1


def test_deposit_settings_and_branding_flow_into_live_behavior(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))

    login_as(client, admin)
    response = post_form(
        client,
        "/staff/rates",
        data={
            "action": "deposit_settings",
            "deposit_percentage": "35.00",
            "deposit_enabled": "on",
        },
    )
    assert response.status_code == 302

    response = post_form(
        client,
        "/staff/settings",
        data={
            "action": "save_branding",
            "hotel_name": "Sandbox Hotel HQ",
            "brand_mark": "SBX",
            "logo_url": "https://example.com/logo.png",
            "currency": "THB",
            "contact_phone": "+66 12 345 6789",
            "contact_email": "frontdesk@sandbox-hotel.example",
            "support_contact_text": "Questions before you book? Our Sandbox team is here to help.",
            "accent_color": "#B86E2E",
            "accent_color_soft": "#E9C29F",
            "check_in_time": "14:00",
            "check_out_time": "11:00",
            "address": "123 Beach Road, Bangkok",
            "public_base_url": "https://book.sandboxhotel.example",
            "tax_id": "TAX-0001",
        },
    )
    assert response.status_code == 302

    with app.app_context():
        deposit_required = calculate_deposit_required(
            date.today() + timedelta(days=12),
            date.today() + timedelta(days=14),
            Decimal("1000.00"),
        )
        assert deposit_required == Decimal("350.00")
        assert str(get_setting_value("hotel.name", "")) == "Sandbox Hotel HQ"
        assert str(get_setting_value("hotel.support_contact_text", "")) == "Questions before you book? Our Sandbox team is here to help."
        assert str(get_setting_value("hotel.accent_color", "")) == "#B86E2E"
        assert str(get_setting_value("hotel.public_base_url", "")) == "https://book.sandboxhotel.example"

    home = client.get("/")
    assert home.status_code == 200
    assert b"Sandbox Hotel HQ" in home.data
    assert b"Our Sandbox team is here to help" in home.data
    assert b'meta name="theme-color" content="#B86E2E"' in home.data
    assert b"https://book.sandboxhotel.example" in home.data


def test_branding_validation_rejects_missing_guest_contact_methods(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))
        original_name = str(get_setting_value("hotel.name", ""))

    login_as(client, admin)
    response = post_form(
        client,
        "/staff/settings",
        data={
            "action": "save_branding",
            "hotel_name": "Broken Branding",
            "brand_mark": "SBX",
            "logo_url": "https://example.com/logo.png",
            "currency": "THB",
            "contact_phone": "",
            "contact_email": "",
            "support_contact_text": "Call us anytime.",
            "accent_color": "#C57C35",
            "accent_color_soft": "#F0C89A",
            "check_in_time": "14:00",
            "check_out_time": "11:00",
            "address": "Bangkok",
            "public_base_url": "https://book.sandboxhotel.example",
            "tax_id": "TAX-0001",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert b"Provide at least one guest-facing contact method" in response.data

    with app.app_context():
        assert str(get_setting_value("hotel.name", "")) == original_name


def test_staff_user_manager_and_role_permissions_change_backend_authorization(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))
        manager = make_staff_user(email="manager.adminpanel@example.com", role_codes=("manager",))
        manager_role = Role.query.filter_by(code="manager").one()
        retained_permissions = sorted(permission.code for permission in manager_role.permissions if permission.code != "reservation.view")

    login_as(client, admin)
    response = post_form(
        client,
        "/staff/users",
        data={
            "action": "create",
            "full_name": "Night Auditor",
            "email": "night.auditor@example.com",
            "role_codes": ["front_desk"],
        },
    )
    assert response.status_code == 302

    response = post_form(
        client,
        "/staff/users",
        data={
            "action": "role_permissions",
            "role_id": str(manager_role.id),
            "permission_codes": retained_permissions,
        },
    )
    assert response.status_code == 302

    with app.app_context():
        created_user = User.query.filter_by(email="night.auditor@example.com").one()
        assert {role.code for role in created_user.roles} == {"front_desk"}
        assert AuditLog.query.filter_by(action="role_permissions_updated", entity_table="roles").count() == 1

    manager_client = app.test_client()
    login_as(manager_client, manager)
    assert manager_client.get("/staff/reservations").status_code == 403
    assert manager_client.get("/staff/reports").status_code == 200
    assert manager_client.get("/staff/settings").status_code == 403


def test_policy_templates_and_preview_drive_multilingual_content(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))
        template = NotificationTemplate.query.filter_by(template_key="guest_confirmation", language_code="en").one()

    login_as(client, admin)
    response = post_form(
        client,
        "/staff/admin/operations",
        data={
            "action": "policy",
            "code": "cancellation_policy",
            "name": "Cancellation policy",
            "version": "2026-04",
            "content_th": "ยกเลิกฟรีก่อนวันเข้าพัก 24 ชั่วโมง",
            "content_en": "Free cancellation up to 24 hours before arrival.",
            "content_zh_hans": "入住前24小时可免费取消。",
            "is_active": "on",
        },
    )
    assert response.status_code == 302

    response = post_form(
        client,
        "/staff/admin/operations",
        data={
            "action": "notification_template",
            "template_id": str(template.id),
            "template_key": "guest_confirmation",
            "language_code": "en",
            "description": "Updated guest confirmation",
            "subject_template": "Booking {reservation_code}",
            "body_template": "Hello {guest_name}, welcome to {hotel_name}.",
            "is_active": "on",
        },
    )
    assert response.status_code == 302

    preview = post_form(
        client,
        "/staff/admin/operations",
        data={
            "action": "preview_template",
            "template_key": "guest_confirmation",
            "language_code": "en",
        },
    )
    assert preview.status_code == 200
    assert b"Booking SBX-00009999" in preview.data

    with app.app_context():
        assert policy_text("cancellation_policy", "zh-Hans", "") == "入住前24小时可免费取消。"
        subject, body = render_notification_template(
            "guest_confirmation",
            "en",
            {"reservation_code": "SBX-00001234", "guest_name": "Ada", "hotel_name": "Sandbox Hotel"},
            fallback_subject="",
            fallback_body="",
        )
        assert subject == "Booking SBX-00001234"
        assert body == "Hello Ada, welcome to Sandbox Hotel."
        assert AuditLog.query.filter_by(action="policy_upserted", entity_table="policy_documents").count() >= 1
        assert AuditLog.query.filter_by(action="notification_template_upserted", entity_table="notification_templates").count() >= 1


def test_payment_configuration_masks_secrets_and_writes_audit_entries(app_factory):
    app = app_factory(
        seed=True,
        config={
            "STRIPE_SECRET_KEY": "sk_test_phase10_secret",
            "STRIPE_WEBHOOK_SECRET": "whsec_phase10_secret",
        },
    )
    client = app.test_client()
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))

    login_as(client, admin)
    page = client.get("/staff/admin/payments")
    assert page.status_code == 200
    assert b"Configured" in page.data
    assert b"sk_test_phase10_secret" not in page.data
    assert b"whsec_phase10_secret" not in page.data

    response = post_form(
        client,
        "/staff/admin/payments",
        data={
            "active_provider": "test_hosted",
            "deposit_enabled": "on",
            "link_expiry_minutes": "75",
            "link_resend_cooldown_seconds": "180",
        },
    )
    assert response.status_code == 302

    with app.app_context():
        assert str(get_setting_value("payment.active_provider", "")) == "test_hosted"
        assert int(get_setting_value("payment.link_expiry_minutes", 0)) == 75
        app_setting_entries = query_audit_entries(entity_table="app_settings")
        assert any(entry.action == "setting_upserted" for entry in app_setting_entries)


def test_housekeeping_defaults_feed_live_readiness_logic(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))
        reservation = create_future_reservation(room_type_code="TWN")
        clean_status = HousekeepingStatus.query.filter_by(code="clean").one()
        arrival_row = InventoryDay.query.filter_by(
            room_id=reservation.assigned_room_id,
            business_date=reservation.check_in_date,
        ).one()
        arrival_row.housekeeping_status_id = clean_status.id
        db.session.commit()
        readiness_before = room_readiness_snapshot(reservation, reservation.check_in_date)
        assert readiness_before["is_ready"] is True

    login_as(client, admin)
    response = post_form(
        client,
        "/staff/admin/operations",
        data={
            "action": "housekeeping_defaults",
            "require_inspected_for_ready": "on",
            "checkout_dirty_status": "dirty",
        },
    )
    assert response.status_code == 302

    with app.app_context():
        refreshed = db.session.get(type(reservation), reservation.id)
        readiness_after = room_readiness_snapshot(refreshed, refreshed.check_in_date)
        assert readiness_after["is_ready"] is False
        assert readiness_after["label"] == "not_ready"


def test_audit_viewer_filters_admin_changes(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))

    login_as(client, admin)
    post_form(
        client,
        "/staff/settings",
        data={
            "action": "save_branding",
            "hotel_name": "Audit Sandbox Hotel",
            "brand_mark": "SBX",
            "logo_url": "",
            "currency": "THB",
            "contact_phone": "+66 10 000 0000",
            "contact_email": "audit@sandbox.example",
            "check_in_time": "14:00",
            "check_out_time": "11:00",
            "address": "Bangkok",
            "tax_id": "AUD-1",
        },
    )

    response = client.get("/staff/audit?entity_table=app_settings&action=setting_upserted")
    assert response.status_code == 200
    assert b"setting_upserted" in response.data
    assert b"app_settings" in response.data


def test_admin_channels_page_accessible_to_admin(app_factory):
    """Admin can access the OTA channels configuration page."""
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))

    login_as(client, admin)
    response = client.get("/staff/admin/channels")
    assert response.status_code == 200
    assert b"booking_com" in response.data or b"Booking.com" in response.data


def test_admin_channels_page_blocked_for_front_desk(app_factory):
    """Front desk staff cannot access the OTA channels configuration page."""
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        desk = make_staff_user(email="desk-channels@example.com", role_codes=("front_desk",))

    login_as(client, desk)
    assert client.get("/staff/admin/channels").status_code == 403


def test_admin_channels_save_and_retrieve(app_factory):
    """Saving OTA channel credentials persists the hint and encrypts the key."""
    from pms.services.channel_service import get_ota_channel

    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))

    login_as(client, admin)
    response = post_form(
        client,
        "/staff/admin/channels",
        data={
            "action": "save_channel",
            "provider_key": "expedia",
            "is_active": "on",
            "hotel_id": "EXP-HOTEL-001",
            "api_key": "test-expedia-key-1234",
            "api_secret": "",
            "endpoint_url": "",
        },
        follow_redirects=False,
    )
    assert response.status_code == 302

    with app.app_context():
        record = get_ota_channel("expedia")
        assert record is not None
        assert record.is_active is True
        assert record.hotel_id == "EXP-HOTEL-001"
        assert record.api_key_hint == "1234"
        assert record.api_key_encrypted is not None
        assert "test-expedia-key-1234" not in record.api_key_encrypted
