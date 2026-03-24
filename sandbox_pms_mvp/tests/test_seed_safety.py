from __future__ import annotations

import pytest

from pms.extensions import db
from pms.models import Guest, InventoryDay, NotificationTemplate, Permission, Reservation, Role, Room, User
from pms.seeds import clear_operational_data, seed_reference_data, seed_roles_permissions


def test_reference_seed_requires_explicit_admin_bootstrap_credentials(app_factory):
    app = app_factory(seed=False, config={"ADMIN_EMAIL": "", "ADMIN_PASSWORD": ""})

    with app.app_context():
        with pytest.raises(
            RuntimeError,
            match="ADMIN_EMAIL and ADMIN_PASSWORD are required to bootstrap the initial admin account.",
        ):
            seed_reference_data()


def test_reference_seed_does_not_rewrite_existing_role_permissions_or_inventory(app_factory):
    app = app_factory(seed=True, config={"INVENTORY_BOOTSTRAP_DAYS": 7})

    with app.app_context():
        admin_role = Role.query.filter_by(code="admin").first()
        retained_permission = Permission.query.order_by(Permission.code.asc()).first()
        assert admin_role is not None
        assert retained_permission is not None

        admin_role.permissions = [retained_permission]
        inventory_count = InventoryDay.query.count()
        db.session.commit()

        seed_reference_data()

        db.session.expire_all()
        admin_role = Role.query.filter_by(code="admin").first()
        assert admin_role is not None
        assert {permission.code for permission in admin_role.permissions} == {retained_permission.code}
        assert InventoryDay.query.count() == inventory_count


def test_seeded_role_permissions_can_be_synchronized_explicitly(app_factory):
    app = app_factory(seed=True)

    with app.app_context():
        admin_role = Role.query.filter_by(code="admin").first()
        assert admin_role is not None

        admin_role.permissions = []
        db.session.commit()

        seed_roles_permissions(sync_existing_roles=True)
        db.session.commit()

        db.session.expire_all()
        admin_role = Role.query.filter_by(code="admin").first()
        assert admin_role is not None
        assert admin_role.permissions


def test_notification_template_channel_schema_allows_internal_channels(app_factory):
    app = app_factory(seed=False)

    with app.app_context():
        channel_column = NotificationTemplate.__table__.c.channel

        assert getattr(channel_column.type, "length", None) >= len("internal_notification")


def test_clear_operational_data_removes_guests_and_reservations(app_factory):
    """After clear_operational_data(), guests and reservations should be zero."""
    app = app_factory(seed=True, config={"INVENTORY_BOOTSTRAP_DAYS": 30})

    with app.app_context():
        assert db.session.query(Guest).count() > 0, "expected demo guests before clear"
        assert db.session.query(Reservation).count() > 0, "expected demo reservations before clear"

        clear_operational_data()

        assert db.session.query(Guest).count() == 0
        assert db.session.query(Reservation).count() == 0


def test_clear_operational_data_preserves_users_rooms_config(app_factory):
    """clear_operational_data() must not touch user accounts or room configuration."""
    app = app_factory(seed=True, config={"INVENTORY_BOOTSTRAP_DAYS": 7})

    with app.app_context():
        user_count_before = db.session.query(User).count()
        room_count_before = db.session.query(Room).count()
        role_count_before = db.session.query(Role).count()
        assert user_count_before > 0
        assert room_count_before > 0
        assert role_count_before > 0

        clear_operational_data()

        assert db.session.query(User).count() == user_count_before
        assert db.session.query(Room).count() == room_count_before
        assert db.session.query(Role).count() == role_count_before


def test_clear_operational_data_resets_inventory_days_to_available(app_factory):
    """InventoryDay rows must be reset to available/clean after clear_operational_data()."""
    app = app_factory(seed=True, config={"INVENTORY_BOOTSTRAP_DAYS": 14})

    with app.app_context():
        clear_operational_data()

        reserved_or_occupied = (
            db.session.query(InventoryDay)
            .filter(InventoryDay.availability_status.in_(["reserved", "occupied", "held"]))
            .count()
        )
        assert reserved_or_occupied == 0, "no inventory days should remain reserved/occupied/held after clear"

        reservation_linked = (
            db.session.query(InventoryDay)
            .filter(InventoryDay.reservation_id.isnot(None))
            .count()
        )
        assert reservation_linked == 0, "no inventory days should reference a reservation after clear"

        hold_linked = (
            db.session.query(InventoryDay)
            .filter(InventoryDay.hold_id.isnot(None))
            .count()
        )
        assert hold_linked == 0, "no inventory days should reference a hold after clear"

        still_blocked = (
            db.session.query(InventoryDay)
            .filter(InventoryDay.is_blocked == True)  # noqa: E712
            .count()
        )
        assert still_blocked == 0, "no inventory days should remain marked is_blocked after clear"

        with_maintenance = (
            db.session.query(InventoryDay)
            .filter(InventoryDay.maintenance_flag == True)  # noqa: E712
            .count()
        )
        assert with_maintenance == 0, "no inventory days should have maintenance_flag set after clear"
