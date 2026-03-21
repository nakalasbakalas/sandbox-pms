from __future__ import annotations

import importlib
import json
import os
import re
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

import pms.app as app_module
import pms.config as config_module
import pms.security as security_module
from pms.audit import cleanup_audit_logs, write_audit_log
from pms.extensions import db
from pms.models import AuditLog, Role, Room, User, UserSession
from pms.models import Reservation, RoomType, utc_now
from pms.services.auth_service import hash_password
from pms.services.public_booking_service import (
    HoldRequestPayload,
    PublicBookingPayload,
    confirm_public_booking,
    create_reservation_hold,
)
from pms.services.reservation_service import ReservationCreatePayload, create_reservation


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def make_staff_user(
    *,
    email: str,
    password: str,
    role_codes: tuple[str, ...],
    account_state: str = "active",
    is_active: bool = True,
) -> User:
    user = User(
        username=email.split("@", 1)[0],
        email=email,
        full_name=email.split("@", 1)[0].replace(".", " ").title(),
        password_hash=hash_password(password),
        is_active=is_active,
        account_state=account_state,
    )
    user.roles = Role.query.filter(Role.code.in_(role_codes)).all()
    db.session.add(user)
    db.session.commit()
    return user


def csrf_token_for(client) -> str:
    with client.session_transaction() as client_session:
        token = client_session.get("_csrf_token")
        if not token:
            token = "test-csrf-token"
            client_session["_csrf_token"] = token
        return token


def post_form(client, url: str, *, data: dict, follow_redirects: bool = False):
    payload = dict(data)
    payload["csrf_token"] = csrf_token_for(client)
    return client.post(url, data=payload, follow_redirects=follow_redirects)


def login(client, *, identifier: str, password: str, follow_redirects: bool = False):
    return post_form(
        client,
        "/staff/login",
        data={"username": identifier, "password": password},
        follow_redirects=follow_redirects,
    )


def test_production_config_rejects_insecure_defaults(app_factory):
    with pytest.raises(RuntimeError, match="SECRET_KEY must be set to a unique production secret."):
        app_factory(
            config={
                "APP_ENV": "production",
                "APP_BASE_URL": "https://hotel.example",
                "PAYMENT_BASE_URL": "https://payments.example.com",
                "FORCE_HTTPS": True,
                "AUTH_COOKIE_SECURE": True,
                "SESSION_COOKIE_SECURE": True,
                "AUTH_SHOW_RESET_LINKS": False,
                "SECRET_KEY": "replace-me",
                "AUTH_ENCRYPTION_KEY": Fernet.generate_key().decode("utf-8"),
            }
        )


def test_production_config_requires_admin_bootstrap_credentials(app_factory):
    with pytest.raises(RuntimeError, match="ADMIN_EMAIL is required in production."):
        app_factory(
            config={
                "APP_ENV": "production",
                "APP_BASE_URL": "https://hotel.example",
                "PAYMENT_BASE_URL": "https://payments.example.com",
                "FORCE_HTTPS": True,
                "AUTH_COOKIE_SECURE": True,
                "SESSION_COOKIE_SECURE": True,
                "AUTH_SHOW_RESET_LINKS": False,
                "SECRET_KEY": "production-secret-key-1234567890abcdef",
                "AUTH_ENCRYPTION_KEY": Fernet.generate_key().decode("utf-8"),
                "ADMIN_EMAIL": "",
                "ADMIN_PASSWORD": "password-manager-generated-secret",
            }
        )

    with pytest.raises(RuntimeError, match="ADMIN_PASSWORD is required in production."):
        app_factory(
            config={
                "APP_ENV": "production",
                "APP_BASE_URL": "https://hotel.example",
                "PAYMENT_BASE_URL": "https://payments.example.com",
                "FORCE_HTTPS": True,
                "AUTH_COOKIE_SECURE": True,
                "SESSION_COOKIE_SECURE": True,
                "AUTH_SHOW_RESET_LINKS": False,
                "SECRET_KEY": "production-secret-key-1234567890abcdef",
                "AUTH_ENCRYPTION_KEY": Fernet.generate_key().decode("utf-8"),
                "ADMIN_EMAIL": "admin@hotel.example",
                "ADMIN_PASSWORD": "",
            }
        )


def test_render_database_url_is_normalized_for_psycopg(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db.example.com:5432/hotel")
    reloaded = importlib.reload(config_module)

    assert reloaded.Config.SQLALCHEMY_DATABASE_URI == "postgresql+psycopg://user:pass@db.example.com:5432/hotel"

    monkeypatch.delenv("DATABASE_URL", raising=False)
    importlib.reload(config_module)


def test_admin_bootstrap_credentials_are_loaded_from_environment(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "admin@hotel.example")
    monkeypatch.setenv("ADMIN_PASSWORD", "production-password-from-env")

    reloaded = importlib.reload(config_module)

    assert reloaded.Config.ADMIN_EMAIL == "admin@hotel.example"
    assert reloaded.Config.ADMIN_PASSWORD == "production-password-from-env"

    monkeypatch.delenv("ADMIN_EMAIL", raising=False)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    importlib.reload(config_module)


def test_sentry_config_is_loaded_from_environment(monkeypatch):
    monkeypatch.setenv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1")
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "staging")
    monkeypatch.setenv("SENTRY_RELEASE", "release-2026-03-19")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "0.25")

    reloaded = importlib.reload(config_module)

    assert reloaded.Config.SENTRY_DSN == "https://public@example.ingest.sentry.io/1"
    assert reloaded.Config.SENTRY_ENVIRONMENT == "staging"
    assert reloaded.Config.SENTRY_RELEASE == "release-2026-03-19"
    assert reloaded.Config.SENTRY_TRACES_SAMPLE_RATE == 0.25

    monkeypatch.delenv("SENTRY_DSN", raising=False)
    monkeypatch.delenv("SENTRY_ENVIRONMENT", raising=False)
    monkeypatch.delenv("SENTRY_RELEASE", raising=False)
    monkeypatch.delenv("SENTRY_TRACES_SAMPLE_RATE", raising=False)
    importlib.reload(config_module)


def test_render_external_hostname_is_added_to_trusted_hosts(monkeypatch):
    monkeypatch.setenv("TRUSTED_HOSTS", "book.example.com,staff.example.com")
    monkeypatch.setenv("APP_BASE_URL", "https://book.example.com")
    monkeypatch.setenv("BOOKING_ENGINE_URL", "https://book.example.com")
    monkeypatch.setenv("STAFF_APP_URL", "https://staff.example.com")
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://sandbox-pms-v43m.onrender.com")

    reloaded = importlib.reload(config_module)

    assert reloaded.Config.TRUSTED_HOSTS == [
        "book.example.com",
        "staff.example.com",
        "sandbox-pms-v43m.onrender.com",
    ]

    monkeypatch.delenv("TRUSTED_HOSTS", raising=False)
    monkeypatch.delenv("APP_BASE_URL", raising=False)
    monkeypatch.delenv("BOOKING_ENGINE_URL", raising=False)
    monkeypatch.delenv("STAFF_APP_URL", raising=False)
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    importlib.reload(config_module)


def test_create_app_initializes_sentry_when_dsn_configured(app_factory, monkeypatch):
    captured: dict = {}

    class FakeSentrySdk:
        def init(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(
        app_module,
        "_load_sentry_sdk",
        lambda: (FakeSentrySdk(), ["flask-integration", "sqlalchemy-integration"]),
    )

    app_factory(
        config={
            "SENTRY_DSN": "https://public@example.ingest.sentry.io/1",
            "SENTRY_ENVIRONMENT": "staging",
            "SENTRY_RELEASE": "release-2026-03-19",
            "SENTRY_TRACES_SAMPLE_RATE": 0.25,
        }
    )

    assert captured["dsn"] == "https://public@example.ingest.sentry.io/1"
    assert captured["environment"] == "staging"
    assert captured["release"] == "release-2026-03-19"
    assert captured["traces_sample_rate"] == 0.25
    assert captured["send_default_pii"] is False
    assert captured["integrations"] == ["flask-integration", "sqlalchemy-integration"]
    assert captured["before_send"] is app_module._sentry_before_send


def test_create_app_skips_sentry_loader_when_dsn_is_missing(app_factory, monkeypatch):
    def fail_loader():
        raise AssertionError("Sentry loader should not run without a DSN.")

    monkeypatch.setattr(app_module, "_load_sentry_sdk", fail_loader)

    app_factory(config={"AUTH_COOKIE_SECURE": False})


def test_security_headers_and_session_cookie_flags_are_present(app_factory):
    app = app_factory(
        config={
            "AUTH_COOKIE_SECURE": False,
            "SESSION_COOKIE_SECURE": True,
        }
    )
    client = app.test_client()

    response = client.get("/staff/login")

    assert response.status_code == 200
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert "Content-Security-Policy" in response.headers
    session_cookie = response.headers["Set-Cookie"]
    assert "sbx_browser_state=" in session_cookie
    assert "Secure" in session_cookie
    assert "HttpOnly" in session_cookie
    assert "SameSite=Lax" in session_cookie

    csp_header = response.headers["Content-Security-Policy"]
    nonce_match = re.search(r"'nonce-([^']+)'", csp_header)
    assert nonce_match is not None
    nonce = nonce_match.group(1)
    assert f'nonce="{nonce}"'.encode() in response.data
    assert "script-src 'self'" in csp_header


def test_csp_hardened_templates_avoid_inline_dom_handlers():
    template_dir = PROJECT_ROOT / "templates"
    audited_templates = [
        "housekeeping_board.html",
        "reservation_detail.html",
        "staff_messaging_thread.html",
        "staff_reservations.html",
        "_res_list_drawer.html",
    ]

    for template_name in audited_templates:
        body = (template_dir / template_name).read_text(encoding="utf-8", errors="ignore")
        assert "onclick=" not in body, template_name
        assert "onchange=" not in body, template_name
        assert "onsubmit=" not in body, template_name


def test_csp_hardened_templates_nonce_inline_scripts():
    template_dir = PROJECT_ROOT / "templates"
    inline_script_templates = [
        "base.html",
        "front_desk_detail.html",
        "reservation_detail.html",
        "reservation_form.html",
        "staff_messaging_compose.html",
        "staff_messaging_thread.html",
        "staff_reservations.html",
    ]

    for template_name in inline_script_templates:
        body = (template_dir / template_name).read_text(encoding="utf-8", errors="ignore")
        assert "<script" in body, template_name
        assert 'nonce="{{ csp_nonce }}"' in body, template_name


def test_access_logging_uses_request_id_and_omits_query_string(app_factory, monkeypatch):
    app = app_factory(config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    captured: list[tuple[tuple, dict]] = []

    def fake_log_security_event(*args, **kwargs):
        captured.append((args, kwargs))

    monkeypatch.setattr(security_module, "log_security_event", fake_log_security_event)

    response = client.get("/staff/login?token=secret-value&reservation_code=SBX-123", headers={"X-Request-Id": "req-123"})

    assert response.status_code == 200
    assert response.headers["X-Request-Id"] == "req-123"
    assert captured
    _, payload = captured[-1]
    assert payload["request_id"] == "req-123"
    assert payload["path"] == "/staff/login"
    assert "token=secret-value" not in json.dumps(payload)
    assert "reservation_code=SBX-123" not in json.dumps(payload)


def test_error_handler_hides_internal_exception_details(app_factory):
    app = app_factory(config={"AUTH_COOKIE_SECURE": False, "PROPAGATE_EXCEPTIONS": False})

    @app.route("/boom-security")
    def boom_security():
        raise RuntimeError("secret token should never leak")

    client = app.test_client()
    response = client.get("/boom-security")

    assert response.status_code == 500
    assert b"Something went wrong. Please try again or contact the hotel." in response.data
    assert b"secret token should never leak" not in response.data


def test_audit_log_redacts_sensitive_fields(app_factory):
    app = app_factory()
    with app.app_context():
        write_audit_log(
            actor_user_id=None,
            entity_table="users",
            entity_id="staff-1",
            action="security_test",
            before_data={"password": "plain", "nested": {"api_token": "abc123"}},
            after_data={"smtp_password": "super-secret", "notes": "kept"},
        )
        db.session.commit()
        row = AuditLog.query.one()
        assert row.before_data["password"] == "[redacted]"
        assert row.before_data["nested"]["api_token"] == "[redacted]"
        assert row.after_data["smtp_password"] == "[redacted]"
        assert row.after_data["notes"] == "kept"


def test_cleanup_audit_logs_respects_configured_retention_window(app_factory):
    app = app_factory(config={"AUDIT_LOG_RETENTION_DAYS": 30})
    with app.app_context():
        db.session.add(
            AuditLog(
                actor_user_id=None,
                entity_table="users",
                entity_id="old-row",
                action="audit_old",
                before_data=None,
                after_data={"status": "old"},
                created_at=utc_now() - timedelta(days=45),
            )
        )
        db.session.add(
            AuditLog(
                actor_user_id=None,
                entity_table="users",
                entity_id="fresh-row",
                action="audit_fresh",
                before_data=None,
                after_data={"status": "fresh"},
                created_at=utc_now() - timedelta(days=5),
            )
        )
        db.session.commit()

        result = cleanup_audit_logs()

        assert result["enabled"] is True
        assert result["deleted"] == 1
        remaining_ids = AuditLog.query.with_entities(AuditLog.entity_id).all()
        remaining_ids = [entity_id for (entity_id,) in remaining_ids]
        assert remaining_ids == ["fresh-row"]


def test_append_only_audit_log_blocks_update_and_delete(app_factory):
    app = app_factory()
    with app.app_context():
        write_audit_log(
            actor_user_id=None,
            entity_table="reservations",
            entity_id="res-1",
            action="created",
            after_data={"status": "confirmed"},
        )
        db.session.commit()
        row = AuditLog.query.one()

        row.action = "tampered"
        with pytest.raises(ValueError, match="append-only"):
            db.session.commit()
        db.session.rollback()

        row = AuditLog.query.one()
        db.session.delete(row)
        with pytest.raises(ValueError, match="append-only"):
            db.session.commit()
        db.session.rollback()


def test_server_side_validation_rejects_malformed_reservation_input(app_factory):
    app = app_factory(seed=True)
    with app.app_context():
        room = Room.query.filter_by(room_number="201").one()
        payload = ReservationCreatePayload(
            first_name="A",
            last_name="Guest",
            phone="invalid phone",
            email="broken email",
            room_type_id=room.room_type_id,
            check_in_date=date.today() + timedelta(days=5),
            check_out_date=date.today() + timedelta(days=7),
            adults=2,
            children=0,
            special_requests="x" * 501,
        )
        with pytest.raises(ValueError):
            create_reservation(payload)


def test_logout_requires_post_and_csrf(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="logout-sec@example.com", password="correct horse 123", role_codes=("front_desk",))

    assert login(client, identifier=user.email, password="correct horse 123").status_code == 302
    assert client.get("/staff/logout").status_code == 405
    assert client.post("/staff/logout").status_code == 400
    response = post_form(client, "/staff/logout", data={})
    assert response.status_code == 302
    with app.app_context():
        session_row = UserSession.query.filter_by(user_id=user.id).one()
        assert session_row.revoked_at is not None


def test_untrusted_room_notes_are_html_escaped_in_housekeeping_detail(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        user = make_staff_user(email="hk-sec@example.com", password="correct horse 123", role_codes=("housekeeping",))
        room = Room.query.filter_by(room_number="201").one()

    assert login(client, identifier=user.email, password="correct horse 123").status_code == 302
    response = post_form(
        client,
        f"/staff/housekeeping/rooms/{room.id}/notes",
        data={
            "business_date": date.today().isoformat(),
            "note_text": "<script>alert(1)</script>",
            "note_type": "housekeeping",
            "visibility_scope": "all_staff",
        },
    )
    assert response.status_code == 302

    detail = client.get(f"/staff/housekeeping/rooms/{room.id}?date={date.today().isoformat()}")
    assert detail.status_code == 200
    assert b"&lt;script&gt;alert(1)&lt;/script&gt;" in detail.data
    assert b"<script>alert(1)</script>" not in detail.data


def test_payment_admin_page_does_not_expose_secret_values(app_factory):
    app = app_factory(
        seed=True,
        config={
            "AUTH_COOKIE_SECURE": False,
            "APP_BASE_URL": "https://hotel.example",
            "PAYMENT_BASE_URL": "https://payments.example.com",
            "PAYMENT_PROVIDER": "stripe",
            "STRIPE_SECRET_KEY": "sk_test_super_secret_value",
            "STRIPE_WEBHOOK_SECRET": "whsec_super_secret_value",
            "AUTH_ENCRYPTION_KEY": Fernet.generate_key().decode("utf-8"),
        },
    )
    client = app.test_client()
    assert login(client, identifier="admin@sandbox.local", password="sandbox-admin-123").status_code == 302

    response = client.get("/staff/admin/payments")

    assert response.status_code == 200
    assert b"sk_test_super_secret_value" not in response.data
    assert b"whsec_super_secret_value" not in response.data


def test_staff_detail_pages_sanitize_back_links(app_factory):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()
    with app.app_context():
        twin = RoomType.query.filter_by(code="TWN").first()
        hold = create_reservation_hold(
            HoldRequestPayload(
                check_in_date=date.today() + timedelta(days=7),
                check_out_date=date.today() + timedelta(days=9),
                adults=2,
                children=0,
                room_type_id=twin.id,
                guest_email="back-link@example.com",
                idempotency_key="back-link-hold",
                language="en",
                source_channel="direct_web",
                source_metadata={"utm_source": "direct_web"},
                request_ip="127.0.0.1",
                user_agent="pytest",
            )
        )
        reservation = confirm_public_booking(
            PublicBookingPayload(
                hold_code=hold.hold_code,
                idempotency_key="back-link-hold",
                first_name="Back",
                last_name="Link",
                phone="+66800000011",
                email="back-link@example.com",
                special_requests=None,
                language="en",
                source_channel="direct_web",
                source_metadata={"utm_source": "direct_web"},
                terms_accepted=True,
                terms_version="2026-03",
            )
        )

    assert login(client, identifier="admin@sandbox.local", password="sandbox-admin-123").status_code == 302

    response = client.get(f"/staff/reservations/{reservation.id}?back=//evil.example")

    assert response.status_code == 200
    assert b'//evil.example' not in response.data
    assert b'/staff/reservations' in response.data


@pytest.mark.parametrize(
    "path",
    [
        "/staff/reservations?page=abc",
        "/staff/reservations?arrival_date=not-a-date",
        "/staff/reservations?room_type_id=not-a-uuid",
        "/staff/front-desk?date=not-a-date",
        "/staff/front-desk?room_type_id=not-a-uuid",
        "/staff/housekeeping?date=not-a-date",
        "/staff/reservations/arrivals?date=not-a-date",
        "/staff/review-queue?arrival_date=not-a-date",
    ],
)
def test_staff_views_reject_invalid_query_params(app_factory, path):
    app = app_factory(seed=True, config={"AUTH_COOKIE_SECURE": False})
    client = app.test_client()

    assert login(client, identifier="admin@sandbox.local", password="sandbox-admin-123").status_code == 302

    response = client.get(path)

    assert response.status_code == 400


def test_backup_and_restore_scripts_create_manifest_checksum_and_verify(tmp_path):
    backup_dir = tmp_path / "backups"
    restore_log = tmp_path / "restore.log"
    verify_file = tmp_path / "verified.txt"

    on_windows = sys.platform == "win32"

    if on_windows:
        fake_pg_dump = tmp_path / "fake_pg_dump.ps1"
        fake_pg_restore = tmp_path / "fake_pg_restore.ps1"
        fake_pg_dump.write_text(
            "param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)\n"
            "$output = $Arguments | Where-Object { $_ -like '--file=*' } | Select-Object -First 1\n"
            "if (-not $output) { exit 1 }\n"
            "$target = $output.Substring(7)\n"
            "Set-Content -Path $target -Value 'fake backup'\n",
            encoding="utf-8",
        )
        fake_pg_restore.write_text(
            "param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)\n"
            "if ($env:FAKE_RESTORE_LOG) { Set-Content -Path $env:FAKE_RESTORE_LOG -Value ($Arguments -join ' ') }\n",
            encoding="utf-8",
        )
        verify_cmd = f"Set-Content -Path '{verify_file}' -Value 'verified'"
        backup_script = PROJECT_ROOT / "scripts" / "backup_db.ps1"
        restore_script = PROJECT_ROOT / "scripts" / "restore_db.ps1"
        backup_cmd = ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(backup_script), "-BackupDir", str(backup_dir)]
        restore_cmd = ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(restore_script), "-BackupFile", "{dump_file}", "-DropExisting"]
    else:
        fake_pg_dump = tmp_path / "fake_pg_dump.sh"
        fake_pg_restore = tmp_path / "fake_pg_restore.sh"
        fake_pg_dump.write_text(
            "#!/usr/bin/env bash\n"
            "for arg in \"$@\"; do\n"
            "  if [[ \"$arg\" == --file=* ]]; then\n"
            "    target=\"${arg#--file=}\"\n"
            "    printf 'fake backup' > \"$target\"\n"
            "    exit 0\n"
            "  fi\n"
            "done\n"
            "exit 1\n",
        )
        fake_pg_restore.write_text(
            "#!/usr/bin/env bash\n"
            "if [[ -n \"${FAKE_RESTORE_LOG:-}\" ]]; then\n"
            "  printf '%s' \"$*\" > \"${FAKE_RESTORE_LOG}\"\n"
            "fi\n",
        )
        fake_pg_dump.chmod(0o755)
        fake_pg_restore.chmod(0o755)
        verify_cmd = f"printf 'verified' > '{verify_file}'"
        backup_script = PROJECT_ROOT / "scripts" / "backup_db.sh"
        restore_script = PROJECT_ROOT / "scripts" / "restore_db.sh"
        backup_cmd = ["bash", str(backup_script), str(backup_dir)]
        restore_cmd = ["bash", str(restore_script), "{dump_file}", "--drop-existing"]

    env = {
        **os.environ,
        "DATABASE_URL": "postgresql+psycopg://sandbox:secret@localhost/sandbox_hotel_pms",
        "PG_DUMP_BIN": str(fake_pg_dump),
        "PG_RESTORE_BIN": str(fake_pg_restore),
        "BACKUP_RETENTION_DAYS": "14",
        "BACKUP_ENCRYPTION_REQUIRED": "1",
        "RESTORE_VERIFY_COMMAND": verify_cmd,
        "FAKE_RESTORE_LOG": str(restore_log),
    }

    subprocess.run(backup_cmd, check=True, capture_output=True, text=True, env=env)

    dump_files = list(backup_dir.glob("*.dump"))
    assert len(dump_files) == 1
    dump_file = dump_files[0]
    checksum_file = Path(f"{dump_file}.sha256")
    manifest_file = Path(f"{dump_file}.json")
    assert checksum_file.exists()
    assert manifest_file.exists()

    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    assert manifest["storage_encryption_required"] is True
    assert manifest["database_target"] == "postgresql+psycopg://***@localhost/sandbox_hotel_pms"

    final_restore_cmd = [arg.replace("{dump_file}", str(dump_file)) for arg in restore_cmd]
    subprocess.run(final_restore_cmd, check=True, capture_output=True, text=True, env=env)

    assert restore_log.exists()
    assert "--clean --if-exists" in restore_log.read_text(encoding="utf-8")
    assert verify_file.exists()
    assert verify_file.read_text(encoding="utf-8").strip() == "verified"


def test_hosted_payment_boundary_has_no_card_capture_fields():
    template_dir = PROJECT_ROOT / "templates"
    forbidden_markers = (
        'name="card_number"',
        "name='card_number'",
        'name="cvv"',
        "name='cvv'",
        'autocomplete="cc-number"',
        'autocomplete="cc-csc"',
    )
    for template_file in template_dir.glob("*.html"):
        content = template_file.read_text(encoding="utf-8").lower()
        assert all(marker not in content for marker in forbidden_markers)
