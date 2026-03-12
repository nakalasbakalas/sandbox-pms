from __future__ import annotations

from pms.extensions import db
from pms.models import Permission, Role, RoomType, User


def test_seed_reference_data_cli_matches_deployment_runbook(app_factory):
    app = app_factory(seed=False)
    runner = app.test_cli_runner()

    result = runner.invoke(args=["seed-reference-data"])

    assert result.exit_code == 0
    assert "Reference data seeded." in result.output

    with app.app_context():
        assert RoomType.query.count() >= 2
        assert Role.query.filter_by(code="admin").one()
        assert User.query.filter_by(email="admin@sandbox.local").one()


def test_sync_role_permissions_cli_restores_seeded_system_role_permissions(app_factory):
    app = app_factory(seed=False)
    runner = app.test_cli_runner()

    seed_result = runner.invoke(args=["seed-reference-data"])
    assert seed_result.exit_code == 0

    with app.app_context():
        front_desk_role = Role.query.filter_by(code="front_desk").one()
        assert front_desk_role.permissions
        front_desk_role.permissions = []
        db.session.commit()

    sync_result = runner.invoke(args=["sync-role-permissions"])

    assert sync_result.exit_code == 0
    assert "System role permissions synchronized." in sync_result.output

    with app.app_context():
        refreshed_role = Role.query.filter_by(code="front_desk").one()
        permission_codes = {permission.code for permission in refreshed_role.permissions}
        assert permission_codes
        assert permission_codes <= {permission.code for permission in Permission.query.all()}


def test_seed_reference_data_cli_can_be_rerun_after_admin_exists_without_bootstrap_secrets(app_factory):
    app = app_factory(seed=False)
    runner = app.test_cli_runner()

    first_result = runner.invoke(args=["seed-reference-data"])
    assert first_result.exit_code == 0

    app.config["ADMIN_EMAIL"] = ""
    app.config["ADMIN_PASSWORD"] = ""
    second_result = runner.invoke(args=["seed-reference-data"])

    assert second_result.exit_code == 0
    assert "Reference data seeded." in second_result.output
