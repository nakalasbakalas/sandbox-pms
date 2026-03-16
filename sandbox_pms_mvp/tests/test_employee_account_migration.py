from __future__ import annotations

from pathlib import Path

from flask_migrate import upgrade

from pms.app import create_app
from pms.extensions import db
from pms.models import Role, User
from pms.seeds import seed_roles_permissions
from pms.services.auth_service import hash_password, verify_password_hash

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = PROJECT_ROOT / "migrations"
PREVIOUS_REVISION = "20260314_03"

EXPECTED_EMPLOYEE_ACCOUNTS = (
    ("hui.admin", "6astxSjtq9RF", "Hui", "admin"),
    ("manager", "jyVCLAzMXL6U", "Manager", "manager"),
    ("housekeeping", "X3Hp9bnTdKTn", "Housekeeping", "housekeeping"),
    ("frontdesk", "3Y5vyMujqXwU", "Front Desk", "front_desk"),
)


def test_migration_seeds_employee_accounts_without_touching_existing_admin(tmp_path):
    db_path = tmp_path / "employee-account-migration.db"
    app = create_app(
        {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_path.as_posix()}",
            "AUTO_BOOTSTRAP_SCHEMA": False,
            "AUTO_SEED_REFERENCE_DATA": False,
            "ADMIN_EMAIL": "admin@sandbox.local",
            "ADMIN_PASSWORD": "sandbox-admin-123",
        }
    )

    with app.app_context():
        upgrade(directory=str(MIGRATIONS_DIR), revision=PREVIOUS_REVISION)
        seed_roles_permissions(sync_existing_roles=True)
        admin_role = Role.query.filter_by(code="admin").one()
        existing_admin = User(
            username="existing.admin",
            email="existing.admin@example.com",
            full_name="Existing Admin",
            password_hash=hash_password("ExistingAdminPass123"),
            is_active=True,
            account_state="active",
        )
        existing_admin.roles = [admin_role]
        db.session.add(existing_admin)
        db.session.commit()
        admin_snapshot = (
            existing_admin.username,
            existing_admin.email,
            existing_admin.full_name,
            existing_admin.password_hash,
        )

        upgrade(directory=str(MIGRATIONS_DIR))
        db.session.expire_all()

        refreshed_admin = db.session.get(User, existing_admin.id)
        assert refreshed_admin is not None
        assert (
            refreshed_admin.username,
            refreshed_admin.email,
            refreshed_admin.full_name,
            refreshed_admin.password_hash,
        ) == admin_snapshot

        for username, password, full_name, role_code in EXPECTED_EMPLOYEE_ACCOUNTS:
            user = User.query.filter_by(username=username).one()
            assert user.full_name == full_name
            assert user.is_active is True
            assert user.account_state == "active"
            assert user.email.endswith("@internal.sandbox.local")
            assert {role.code for role in user.roles} >= {role_code}
            ok, _ = verify_password_hash(user.password_hash, password)
            assert ok is True
