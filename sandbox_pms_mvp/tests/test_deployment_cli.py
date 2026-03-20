from __future__ import annotations

import importlib
from datetime import timedelta
from pathlib import Path

from pms.extensions import db
from pms.models import AuditLog, Permission, Role, RoomType, User, utc_now


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


def test_cleanup_audit_logs_cli_deletes_rows_older_than_retention_window(app_factory):
    app = app_factory(seed=False, config={"AUDIT_LOG_RETENTION_DAYS": 30})
    runner = app.test_cli_runner()

    with app.app_context():
        db.session.add(
            AuditLog(
                actor_user_id=None,
                entity_table="users",
                entity_id="cli-old",
                action="cli_audit_old",
                before_data=None,
                after_data={"status": "old"},
                created_at=utc_now() - timedelta(days=45),
            )
        )
        db.session.add(
            AuditLog(
                actor_user_id=None,
                entity_table="users",
                entity_id="cli-fresh",
                action="cli_audit_fresh",
                before_data=None,
                after_data={"status": "fresh"},
                created_at=utc_now() - timedelta(days=5),
            )
        )
        db.session.commit()

    result = runner.invoke(args=["cleanup-audit-logs"])

    assert result.exit_code == 0
    assert "Audit log cleanup:" in result.output
    assert "1 rows deleted" in result.output

    with app.app_context():
        remaining_ids = [row.entity_id for row in AuditLog.query.order_by(AuditLog.entity_id.asc()).all()]
        assert remaining_ids == ["cli-fresh"]


def test_health_endpoint_reports_db_liveness_and_sla_metadata(app_factory):
    app = app_factory(seed=False, config={"HEALTHCHECK_SLA_MS": 5000})
    client = app.test_client()

    response = client.get("/health")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["status"] == "ok"
    assert payload["db"] == "ok"
    assert payload["within_sla"] is True
    assert payload["sla_ms"] == 5000
    assert isinstance(payload["response_ms"], float)
    assert payload["response_ms"] >= 0


def test_config_reads_storage_backend_environment(monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    monkeypatch.setenv("S3_BUCKET", "sandbox-docs")
    monkeypatch.setenv("S3_REGION", "ap-southeast-1")
    monkeypatch.setenv("S3_ENDPOINT_URL", "https://r2.example.invalid")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test-access-key")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test-secret-key")

    import pms.config as config_module

    reloaded = importlib.reload(config_module)
    try:
        assert reloaded.Config.STORAGE_BACKEND == "s3"
        assert reloaded.Config.S3_BUCKET == "sandbox-docs"
        assert reloaded.Config.S3_REGION == "ap-southeast-1"
        assert reloaded.Config.S3_ENDPOINT_URL == "https://r2.example.invalid"
        assert reloaded.Config.AWS_ACCESS_KEY_ID == "test-access-key"
        assert reloaded.Config.AWS_SECRET_ACCESS_KEY == "test-secret-key"
    finally:
        importlib.reload(config_module)


def test_render_blueprint_enables_persistent_uploads_and_background_crons():
    render_blueprint = Path(__file__).resolve().parents[2] / "render.yaml"
    text = render_blueprint.read_text(encoding="utf-8")
    expected_crons = [
        "pms-process-notifications",
        "pms-process-automation-events",
        "pms-sync-ical-sources",
        "pms-send-pre-arrival-reminders",
        "pms-send-failed-payment-reminders",
        "pms-fire-pre-checkin-reminders",
        "pms-process-waitlist",
        "pms-cleanup-audit-logs",
        "pms-auto-cancel-no-shows",
    ]

    assert "key: STORAGE_BACKEND" in text
    assert "value: local" in text
    assert "key: UPLOAD_DIR" in text
    assert "value: /var/data/uploads/documents" in text
    assert "disk:" in text
    assert "name: pms-document-storage" in text
    assert text.count("- type: cron") == len(expected_crons)
    for cron_name in expected_crons:
        assert text.count(f"name: {cron_name}") == 1
    assert "startCommand: flask --app app cleanup-audit-logs" in text
    assert "startCommand: flask --app app auto-cancel-no-shows" in text
