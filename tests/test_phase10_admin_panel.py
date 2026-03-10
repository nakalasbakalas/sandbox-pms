from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from werkzeug.security import generate_password_hash

from pms.extensions import db
from pms.models import AuditLog, HousekeepingStatus, InventoryDay, NotificationTemplate, Role, Room, RoomType, User
from pms.pricing import get_setting_value
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
    assert admin_client.get("/staff/admin/audit").status_code == 200

    desk_client = app.test_client()
    login_as(desk_client, front_desk)
    assert desk_client.get("/staff/admin").status_code == 403
    assert desk_client.get("/staff/admin/property").status_code == 403
    assert desk_client.get("/staff/admin/operations").status_code == 403
    assert desk_client.get("/staff/admin/payments").status_code == 403
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
            "description": "Flexible triple room",
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
        assert room_type.extra_bed_allowed is True
        assert updated_room.notes == "Swing room reserved for admin maintenance planning"
        assert AuditLog.query.filter_by(action="room_type_upserted", entity_table="room_types").count() >= 1
        assert AuditLog.query.filter_by(action="room_upserted", entity_table="rooms").count() >= 1


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
            "check_in_time": "14:00",
            "check_out_time": "11:00",
            "address": "123 Beach Road, Bangkok",
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

    home = client.get("/")
    assert home.status_code == 200
    assert b"Sandbox Hotel HQ" in home.data


def test_staff_user_manager_and_role_permissions_change_backend_authorization(app_factory):
    app = app_factory(seed=True)
    client = app.test_client()
    with app.app_context():
        admin = db.session.scalar(db.select(User).where(User.email == "admin@sandbox.local"))
        manager = make_staff_user(email="manager.adminpanel@example.com", role_codes=("manager",))
        manager_role = Role.query.filter_by(code="manager").one()
        retained_permissions = sorted(permission.code for permission in manager_role.permissions if permission.code != "settings.view")

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
    assert manager_client.get("/staff/reservations").status_code == 200
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
