from __future__ import annotations

import json
import os
import subprocess
from datetime import date, timedelta
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

import pms.security as security_module
from pms.audit import write_audit_log
from pms.extensions import db
from pms.models import AuditLog, Role, Room, User, UserSession
from pms.services.auth_service import hash_password
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


def test_backup_and_restore_scripts_create_manifest_checksum_and_verify(tmp_path):
    backup_dir = tmp_path / "backups"
    restore_log = tmp_path / "restore.log"
    verify_file = tmp_path / "verified.txt"
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

    env = {
        **os.environ,
        "DATABASE_URL": "postgresql+psycopg://sandbox:secret@localhost/sandbox_hotel_pms",
        "PG_DUMP_BIN": str(fake_pg_dump),
        "PG_RESTORE_BIN": str(fake_pg_restore),
        "BACKUP_RETENTION_DAYS": "14",
        "BACKUP_ENCRYPTION_REQUIRED": "1",
        "RESTORE_VERIFY_COMMAND": f"Set-Content -Path '{verify_file}' -Value 'verified'",
        "FAKE_RESTORE_LOG": str(restore_log),
    }

    backup_script = PROJECT_ROOT / "scripts" / "backup_db.ps1"
    restore_script = PROJECT_ROOT / "scripts" / "restore_db.ps1"

    subprocess.run(
        ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(backup_script), "-BackupDir", str(backup_dir)],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )

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

    subprocess.run(
        [
            "powershell",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(restore_script),
            "-BackupFile",
            str(dump_file),
            "-DropExisting",
        ],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )

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
