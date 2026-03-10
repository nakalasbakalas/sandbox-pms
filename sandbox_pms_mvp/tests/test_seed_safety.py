from __future__ import annotations

import pytest

from pms.extensions import db
from pms.models import InventoryDay, Permission, Role
from pms.seeds import seed_reference_data, seed_roles_permissions


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
