# Copilot Instructions – Sandbox Hotel PMS

## Project Summary

Sandbox Hotel PMS is a production-oriented Property Management System built on Flask with a PostgreSQL-first schema. It covers the full hotel operating lifecycle: staff authentication (Phase 3), public booking (Phase 4), staff reservations workspace (Phase 5), front-desk check-in/out (Phase 6), housekeeping (Phase 7), cashier/folio (Phase 8), hosted payment integration (Phase 9), admin & configuration (Phase 10), notifications (Phase 11), manager reporting (Phase 12), and security hardening (Phase 13).

## Tech Stack

- **Language / Runtime**: Python 3.11
- **Framework**: Flask ≥ 3.0 (app factory pattern in `pms/app.py`)
- **ORM / Migrations**: Flask-SQLAlchemy ≥ 3.1, Flask-Migrate ≥ 4.0 (Alembic)
- **Primary DB**: PostgreSQL via `psycopg[binary]` ≥ 3.2
- **CI / local DB**: SQLite (used only in tests and local demo)
- **Security**: Argon2-cffi (password hashing), cryptography, pyotp (TOTP MFA)
- **Tests**: pytest ≥ 8.3
- **Server**: Gunicorn ≥ 22.0 (production)
- **No linter / formatter** is configured in this repository

## Environment Setup

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env               # then fill in required secrets
```

Key environment variables (see `.env.example` for the full list):
- `APP_ENV` – `development` | `test` | `staging` | `production`
- `SECRET_KEY` – must be overridden in production
- `AUTH_ENCRYPTION_KEY` – required outside dev/test
- `DATABASE_URL` – PostgreSQL DSN (or omit for SQLite fallback)
- `TEST_DATABASE_URL` – optional PostgreSQL DSN for concurrency tests

## Running the Application

```bash
# Development server
python app.py

# Production (Render / Gunicorn)
gunicorn -w 4 -b 0.0.0.0:10000 -t 120 -k sync --access-logfile - --error-logfile - app:app
```

## Database Bootstrap & Seed

```bash
flask --app app db upgrade          # apply all Alembic migrations
flask --app app seed-phase2         # load reference data + bootstrap inventory
flask --app app bootstrap-inventory # extend inventory rows only
```

## Running Tests

Always set `PYTHONPATH` to the repository root before running pytest.

```bash
# All tests (SQLite in-memory, no external DB needed)
PYTHONPATH=. pytest tests -q

# PostgreSQL concurrency tests (requires a live PG instance)
TEST_DATABASE_URL="postgresql+psycopg://sandbox:sandbox@localhost/sandbox_hotel_pms_test" \
  pytest tests/test_phase4_public_booking.py -k postgres -q
TEST_DATABASE_URL="..." pytest tests/test_phase5_staff_reservations_workspace.py -k postgres -q
TEST_DATABASE_URL="..." pytest tests/test_phase6_front_desk_workspace.py -k postgres -q
```

The test fixture in `tests/conftest.py` creates a temporary SQLite database for each test, runs `flask db upgrade`, and optionally seeds data. No external services are required for the default test run.

## Project Layout

```
app.py                     Entry point (imports pms.app.create_app)
requirements.txt           All runtime + test dependencies
render.yaml                Render.com deployment config
.env.example               Full list of supported environment variables
pms/
  app.py                   Flask app factory, all route registrations (~2 400 lines)
  models.py                All SQLAlchemy models
  config.py                Config object (reads environment variables)
  constants.py             Enum-like constants used throughout
  extensions.py            Shared Flask extensions (db, migrate)
  security.py              CSRF, rate-limiting, session helpers
  auth_service.py          Top-level auth helpers
  activity.py              Activity logging helpers
  audit.py                 Audit-trail helpers
  pricing.py               Rate / pricing calculations
  i18n.py                  Internationalisation helpers
  seeds.py                 Idempotent seed commands
  settings.py              Runtime app-settings management
  services/
    admin_service.py
    auth_service.py
    cashier_service.py
    communication_service.py
    front_desk_service.py
    housekeeping_service.py
    notification_service.py
    payment_integration_service.py
    public_booking_service.py
    reporting_service.py
    reservation_service.py
    staff_reservations_service.py
migrations/
  versions/
    20260307_01_phase2_baseline.py   Deterministic Alembic baseline
tests/
  conftest.py              Shared pytest fixtures (app_factory, SQLite per-test DB)
  test_phase2_data_layer.py
  test_phase3_auth.py
  test_phase4_public_booking.py
  test_phase5_staff_reservations_workspace.py
  test_phase6_front_desk_workspace.py
  test_phase7_housekeeping.py
  test_phase8_cashier.py
  test_phase9_hosted_payments.py
  test_phase10_admin_panel.py
  test_phase11_communications.py
  test_phase12_reporting.py
  test_phase13_security_hardening.py
scripts/
  backup_db.sh / backup_db.ps1      PostgreSQL pg_dump wrappers
  restore_db.sh / restore_db.ps1    PostgreSQL pg_restore wrappers
templates/                 Jinja2 HTML templates
static/                    CSS, JS, images
```

## Architecture Notes

- **App factory**: `pms.app.create_app(config: dict | None)` returns a configured Flask app. `app.py` at the root simply calls it.
- **All routes** live in `pms/app.py`; blueprint registration is not yet used.
- **CSRF**: synchronizer-token pattern, validated on every state-changing POST; helpers in `pms/security.py`.
- **Auth cookie**: `selector.token` HttpOnly cookie backed by `user_sessions` table.
- **RBAC**: `users` → `user_roles` → `roles` → `role_permissions` → `permissions`.
- **Reservation integrity**: `inventory_days` has `unique(room_id, business_date)`; reservation creation never double-books.
- **Append-only tables**: `reservation_status_history`, `folio_charges`, `payment_events`, `audit_log`.
- **Mutable tables** carry `created_at`, `updated_at`, `created_by_user_id`, `updated_by_user_id`.
- **Config hierarchy**: environment variables → `pms/config.py` → `create_app()` override dict (tests use this).
- **No linter is configured**; match the existing code style (4-space indent, double-quotes for strings in HTML templates, no trailing commas in function signatures).
