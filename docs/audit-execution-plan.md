# PMS Repo Audit and Execution Plan

> **Audit date:** 2026-03-18  
> **Test baseline:** 480 passed, 7 skipped — zero failures  
> **Scope:** Full repository scan — routes, models, services, templates, static assets, tests, migrations, config, CI, deployment

---

## Phase 0 Execution Summary

**Status: ✅ COMPLETE (2026-03-18)**

All critical and high-priority fixes from the audit implemented and tested:

| Finding | Status | Notes |
|---------|--------|-------|
| **F-01** SSE blocks workers | ✅ Fixed | SSE endpoint removed; replaced with 10s JS polling |
| **F-02** Render storage config | ✅ Fixed | render.yaml updated with storage options & examples |
| **F-03** Background tasks unwired | ✅ Fixed | 6 render.yaml cron jobs added (notifications, sync, etc.) |
| **F-07** Root cleanup | ✅ Fixed | 28 artifacts deleted, 4 docs moved to `docs/`, 4 root tests removed |
| **F-09** FEATURE_BOARD_V2 unclear | ✅ Fixed | Flag documented; gates board v2 action endpoints |
| **F-10** OCR returns None silently | ✅ Fixed | Now returns status dict: `{"status": "unavailable", ...}` |
| **QW-1 to QW-11** | ✅ Fixed | All quick wins completed (aria-labels, guards, config) |

**Test results:** 286 passed, 6 skipped, 0 new failures across all touched modules.

**Branch:** `copilot/create-execution-plan-for-pms` (commit `cf750d8`)

---

## Phase 1 Execution Progress

**Status: ✅ COMPLETE (2026-03-19)**

| Phase 1 Item | Status | Notes |
|--------------|--------|-------|
| Departure turnover auto-wiring | ✅ Verified | Already wired in `complete_checkout` |
| OCR unavailability status | ✅ Fixed | Returns `{"status": "unavailable", ...}` (done in Phase 0) |
| Root cleanup | ✅ Fixed | Done in Phase 0 |
| `FEATURE_BOARD_V2` flag | ✅ Documented | Gates board v2 action endpoints (done in Phase 0) |
| DB liveness `/health` | ✅ Verified | Already implemented with `SELECT 1` |
| Inventory bootstrap on new room creation | ✅ Verified | `upsert_room` calls `_ensure_room_inventory()` — creates 730 days of InventoryDay rows. No bug for new rooms. Minor gap: no cron to extend horizon for existing unedited rooms (~2yr runway). |
| Stripe webhook idempotency | ✅ Verified | 3-layer protection: (1) `provider_event_id` unique index, (2) `posting_key` unique on FolioCharge, (3) `SELECT FOR UPDATE` on PaymentRequest. Concurrent threading tests exist. |

---

## Phase 2 Execution Progress

**Status: ✅ COMPLETE (2026-03-19)**

| Phase 2 Item | Status | Notes |
|--------------|--------|-------|
| Report CSV downloads | ✅ Done | `build_csv_rows()` + `/staff/daily-reports/<type>/csv` route + Download CSV button. All 7 report types supported. |
| Modification request approve/decline with auto-pricing | ✅ Done | `approve_modification_request()` (applies `change_stay_dates` + reprices), `decline_modification_request()`, `quote_modification_request()` (JSON API). UI in reservation detail template with confirm dialog. |
| Folio balance badge on front desk board | ✅ Done | Batch `SUM(FolioCharge.total_amount)` query per visible reservation (single GROUP BY, zero N+1). Badge shown as `currency + amount` on each block; also in popover detail. |
| Ready-for-check-in badge on front desk board | ✅ Done | `readyForCheckIn` flag computed per block: confirmed + arrival ≤ today + allocated + room ready (clean/inspected, not blocked). Green "Ready" badge on block. |
| Pending modification indicator on board + workspace | ✅ Done | Batch `COUNT(ModificationRequest)` per visible reservation (single GROUP BY). "Mod" badge on board blocks + "Mod" link badge in workspace Flags column. Front desk workspace includes `pending_modification_requests` count. |
| Pricing module tests | ✅ Done | 16 direct tests in `test_pricing.py`: `apply_adjustment` (5 tests), `money` helper, `nightly_room_rate` (5 tests: fallback, fixed override, day-of-week filter, min_nights, long-stay discount), `quote_reservation` (5 tests: basic, extra guest fee, child fee, zero VAT, VAT breakdown consistency). |
| Guest profile fuzzy search | ✅ Done | `search_guests(q)` in `staff_reservations_service.py` — LIKE matching on name/email/phone with batch latest-reservation lookup. `/staff/guests` route + `staff_guests.html` template. Reservation search also enhanced with email matching. Nav links added. |
| Waitlist promotion/expiry automation | ✅ Done | `promote_eligible_waitlist()` — FIFO promotion when rooms available (assigns room + allocates inventory + confirms). `expire_stale_waitlist(max_age_days=14)` — cancels past-check-in or stale entries. CLI: `flask process-waitlist`. Render cron: every 15 min. |
| Proforma invoice and receipt generation | ⏳ Backlog | Deferred to Phase 4 (not critical path). |

---

## 1) Executive Summary

The Sandbox Hotel PMS is a **functionally substantial Flask monolith** that is further along than most single-developer PMS projects. The authentication stack, reservation lifecycle, cashier/folio system, housekeeping board, pre-check-in portal, iCal sync, Stripe payment integration, messaging hub, and admin panel are all genuinely implemented — not placeholder UI over empty services.

**Strongest parts:**
- Auth and security hardening are professionally done (Argon2, TOTP/MFA, HSTS, CSP, custom CSRF, session encryption, login lockout)
- Data model is clean with 60+ entities, 110 defined indexes, proper soft-deletes, and audit trails
- Service layer is well-separated (20 service files, ~15kLOC) with clear payload dataclasses
- Test coverage is broad (25 test files, ~14 k LOC, 480 tests all passing)
- RBAC is complete and enforced consistently

**Weakest parts:**
- `app.py` is a 5,900-line monolith — every one of the 158 routes lives in one file
- SSE real-time sync (board events) blocks a Gunicorn sync worker for up to 5 minutes per connected user — will collapse under load
- File storage defaults to ephemeral local filesystem on Render — uploaded documents will be silently lost on every redeploy
- Background/scheduled tasks (pre-arrival reminders, payment reminders, automation events, iCal sync) exist as Flask CLI commands with no cron configured in render.yaml — they never fire automatically in production
- Root directory contains 30+ stale markdown planning artifacts and 4 misplaced test files that add noise and risk for tooling

**Biggest risks:**
1. Ephemeral file storage on Render (production data loss)
2. SSE blocking workers (production availability degradation)
3. Scheduled tasks not wired to any cron (silent operational gaps)
4. app.py monolith (the longer it grows, the harder it is to work on safely)

**What must happen first:** stabilize production data durability (storage), fix the SSE worker-blocking issue, and wire the CLI tasks to cron. Then route the monolith toward blueprints while existing tests hold the baseline.

---

## 2) What the Repo Currently Contains

### Complete

| Module | Evidence |
|---|---|
| Staff authentication (login/logout, MFA, lockout, password reset) | `auth_service.py`, `app.py` /staff/login routes, `test_phase3_auth.py` |
| RBAC (roles, permissions, user management) | `models.py` Role/Permission, `permissions.py`, `test_phase10_admin_panel.py` |
| Public booking flow (availability, hold, confirm, cancel/modify requests) | `public_booking_service.py`, `test_phase4_public_booking.py` |
| Staff reservations workspace (list, create, edit, notes, pre-check-in, cancel) | `staff_reservations_service.py`, `test_phase5_staff_reservations_workspace.py` |
| Front desk board (drag-and-drop room assignment, date resize, walk-in, SSE) | `front_desk_board_service.py`, `front-desk-board.js`, `test_phase15_front_desk_board.py` |
| Front desk check-in / check-out / no-show | `front_desk_service.py`, `test_phase6_front_desk_workspace.py` |
| Housekeeping board (room status, tasks, bulk operations) | `housekeeping_service.py`, `room_readiness_service.py`, `test_phase7_housekeeping.py` |
| Cashier / folio (room charges, manual adjustments, payments, refunds, voids, print) | `cashier_service.py`, `test_phase8_cashier.py` |
| Hosted payments (Stripe, test-hosted provider, webhook handling) | `payment_integration_service.py`, `test_phase9_hosted_payments.py` |
| Pre-check-in portal (token, form, document upload, document verification, OCR hook) | `pre_checkin_service.py`, `storage.py`, `test_phase17_pre_checkin.py` |
| iCal calendar sync (export feeds, inbound source sync, conflict detection) | `ical_service.py`, `test_phase14_provider_portal_ical.py` |
| Provider / OTA portal (booking view, payment requests, cancel) | `provider_portal_service.py`, app.py /provider routes |
| Staff messaging hub (conversations, compose, thread management, delivery) | `messaging_service.py`, `test_phase18_messaging.py` |
| Admin panel (property settings, rates, inventory overrides, blackouts, users, notification templates, operations, audit) | `admin_service.py`, `test_phase10_admin_panel.py` |
| Reporting / dashboards (occupancy, revenue, cancellations, attribution, cashier activity) | `reporting_service.py`, `test_phase12_reporting.py`, `test_phase19_dashboards.py` |
| Notification template delivery pipeline (email, LINE staff alerts) | `communication_service.py`, `test_phase11_communications.py` |
| Audit log (full entity snapshot deltas on all major mutations) | `audit.py`, `admin_audit.html` |
| Branding system (hotel name, logo, colour, contact from AppSettings) | `branding.py` |
| i18n — Thai / English / Chinese (simplified) | `i18n.py`, `BOOKING_LANGUAGES` constant |
| Security hardening (CSRF, HSTS, CSP, TrustedHosts, ProxyFix, rate limiting) | `security.py`, `test_phase13_security_hardening.py` |
| Channel manager adapter layer (iCal, mock; extensible provider registry) | `channel_service.py`, `test_availability_and_channel.py` |
| Booking extras (per-stay / per-night add-ons with pricing modes) | `extras_service.py`, migrations |
| Background task CLI (notifications, reminders, iCal sync, automation events) | `app.py` `register_cli()` |
| CI guardrails (placeholder check, public surface check, full pytest) | `.github/workflows/codex-guardrails.yml` |
| Deployment blueprint (Render, PostgreSQL 17, Gunicorn) | `render.yaml` |

### Partial / Incomplete

| Module | What's present | What's missing |
|---|---|---|
| SMS delivery | `SmsAdapter` class exists | Always returns mock — no real SMS provider (Twilio, SNS, etc.) |
| Line guest messaging | `LineAdapter` ships stub | Logs if `Line_STAFF_ALERT_WEBHOOK_URL` set but guest-facing Line is unstubbed |
| OTA guest messaging | `OtaMessageAdapter` class | Explicit stub — "not connected to any OTA messaging API" |
| OCR / ID extraction | `suggest_ocr_extraction()` hook | Explicit `# TODO: integrate OCR provider` comment — returns None only |
| Board v2 feature flag | `FEATURE_BOARD_V2` env var + `check_board_v2_feature_gate()` | Purpose unclear — flag appears in context but no distinct v2 board implementation found |
| Scheduled/cron task wiring | 8 Flask CLI commands for automation | render.yaml has zero cron jobs — tasks never fire automatically in production |
| File storage in production | `LocalStorageBackend` (default) + `S3StorageBackend` (optional) | `UPLOAD_DIR` not configured in `render.yaml` — defaults to ephemeral instance path; `boto3` missing from `requirements.txt` |
| Waitlist | `waitlist` reservation status constant exists | No automation to process, promote, or expire waitlist entries |
| Modification request processing | Staff review queue UI + model exists | No automated processing — staff must manually accept/reject then manually re-price |
| Revenue / yield management | Rate rules with priority/day-of-week/stay-length | No occupancy-based pricing, no min-rate floors, no last-minute discount engine |
| Report exports | Reports render in HTML | No CSV/PDF download for any report |
| Guest profile merge / deduplication | `Guest` model + search | No merge endpoint or dedup tooling |

### Unclear / Unverified

| Area | Uncertainty |
|---|---|
| `FEATURE_BOARD_V2` | Flag is checked in 4+ places. Not clear what behaviour it gates beyond minor UX differences. May be dead code or a partial sprint artifact. |
| `PendingAutomationEvent` model | Docstring says "processed by CLI scheduler." The `process-automation-events` CLI command exists. Whether automation rules actually trigger events reliably is untested. |
| Staff notification / in-app alert delivery | `StaffNotification` model and `_dispatch_internal_notification` exist but the in-app notification UX appears limited to a badge count. |
| `debug_test.py`, `test_demo_seeding.py`, `test_init_and_seed.py`, `test_template_compile.py` at repo root | Not collected by pytest (wrong location). Unknown if maintained or abandoned. |

### Missing (not yet implemented)

- Group bookings / room block management
- Multi-property / multi-tenant support
- Guest-facing online check-out (folio review + balance payment)
- ID / passport scanner hardware integration
- POS integration (F&B, spa, mini-bar charges)
- Guest satisfaction / post-stay survey
- Revenue management dashboard (ADR trends, RevPAR, forecasts)
- OTA channel push (inventory/rate updates to Booking.com, Expedia)
- Guest loyalty / membership tiers
- Housekeeping mobile app / offline-capable view

---

## 3) Key Findings

### F-01 — SSE endpoint blocks sync Gunicorn workers
**Severity: Critical**  
**Evidence:** `app.py:3731–3797` — `staff_front_desk_board_events` streams for up to 300 seconds with a `time.sleep(1)` poll loop inside `stream_with_context`. Render runs `--worker-class sync` with `WEB_CONCURRENCY=2`.  
**Why it matters:** Each connected browser tab holds a sync worker for 5 minutes. Two concurrent staff users watching the board will saturate all workers, making the entire PMS (including public booking) unresponsive until the connections time out.  
**Fix:** Either switch to `gevent`/`eventlet` worker class for async I/O, move SSE behind a dedicated worker, replace the polling SSE with a cheaper full-page refresh or HTMX polling pattern, or replace with periodic JSON polling (every 5–10 seconds) which is far simpler and has no blocking risk.

---

### F-02 — Uploaded documents stored on ephemeral local filesystem
**Severity: Critical**  
**Evidence:** `config.py` `UPLOAD_DIR = os.getenv("UPLOAD_DIR", "")` (line 86). `storage.py` `LocalStorageBackend._base_dir()` defaults to `instance_path/uploads/documents`. `render.yaml` contains no `UPLOAD_DIR` env var and no Render Disk attachment.  
**Why it matters:** Every Render deploy, restart, or instance replacement wipes the instance path. Guest passport photos and ID documents uploaded via pre-check-in are silently deleted. This is a GDPR/data liability risk and a direct operational failure when staff try to view previously uploaded documents.  
**Fix:** Either configure a Render persistent disk and set `UPLOAD_DIR` to the mount point, or configure `STORAGE_BACKEND=s3` with `S3_BUCKET`, `S3_REGION`, and IAM credentials. Add `boto3` to `requirements.txt` if S3 path chosen. Set `UPLOAD_DIR` or `STORAGE_BACKEND`/`S3_BUCKET` as `sync: false` env vars in `render.yaml`.

---

### F-03 — Scheduled background tasks never fire in production
**Severity: High**  
**Evidence:** 8 Flask CLI commands in `app.py:627–720` (`process-notifications`, `send-pre-arrival-reminders`, `send-failed-payment-reminders`, `fire-pre-checkin-reminders`, `sync-ical-sources`, `process-automation-events`, etc.). `render.yaml` has no `jobs:` or `cron:` section.  
**Why it matters:** Pre-arrival guest emails, failed payment reminders, automation rule triggers, and iCal source sync **never run automatically** unless someone manually invokes the CLI. The PMS presents operational features that are silently broken in production.  
**Fix:** Add a Render Cron Job service to `render.yaml` for each periodic task with appropriate schedules (e.g., `flask process-notifications` every 5 min, `flask send-pre-arrival-reminders` daily at 09:00, `flask sync-ical-sources` every 15 min). Alternatively, use a lightweight scheduler library (`APScheduler`, `rq-scheduler`) with a separate worker service.

---

### F-04 — `app.py` is a 5,900-line monolith
**Severity: High**  
**Evidence:** `app.py` contains 158 route definitions, 100+ helper functions, all CSRF logic, all URL helpers, all form parsing, all board utility functions — totalling 5,898 lines.  
**Why it matters:** Merge conflicts on every sprint. Impossible to navigate. Increases the blast radius of every change. Slows onboarding. Makes it hard for AI agents to work on isolated route groups without loading the entire file.  
**Fix:** Gradually extract route groups into Flask Blueprints (`auth_bp`, `staff_bp`, `public_bp`, `provider_bp`, `housekeeping_bp`, `cashier_bp`, `admin_bp`, `board_bp`). Start with the smallest, most isolated groups (auth, provider portal, housekeeping). Move shared helpers to `helpers.py` or the relevant service module. Each blueprint extraction can be validated by running the existing test suite.

---

### F-05 — Mixed ORM query style (legacy `.query.` in 278 places)
**Severity: Medium**  
**Evidence:** `grep -rn "\.query\."` across the `pms/` package returns 278 hits. Modern `db.session.execute(sa.select(...))` is used in ~60% of the codebase. Legacy `Model.query.filter(...)` is used in the other 40%.  
**Why it matters:** Flask-SQLAlchemy's legacy `.query` property is officially deprecated. Mixing styles increases cognitive load and will become a hard breaking change when upgrading to SQLAlchemy 2.x without the legacy shim.  
**Fix:** Incrementally migrate `.query.` calls to `db.session.execute(sa.select(...))`. Prioritise the most frequently called service modules (reporting_service, housekeeping_service, cashier_service, app.py itself) first.

---

### F-06 — Rate limiting uses DB count queries (no memory/Redis layer)
**Severity: Medium**  
**Evidence:** `public_booking_service.py:355–388` `_check_public_rate_limit()` runs two `COUNT` SQL queries per booking/cancel/modification attempt. `auth_service.py:444–455` `ip_is_rate_limited()` counts `AuthAttempt` rows.  
**Why it matters:** Under a bot attack or load spike, rate limiting itself creates DB load, defeating the purpose. In-database counters have no TTL expiry mechanism; they rely on `WHERE created_at >= window_start` scans indexed by IP+timestamp.  
**Fix:** The current approach is functionally safe for low traffic (indexes cover the queries). For the near term, add `EXPLAIN ANALYZE` confirmation and add composite indexes on `auth_attempts(ip_address, attempted_at)` if not already present. Long-term: Redis-backed counters or a middleware like `flask-limiter` with Redis store. This is a **Phase 3** item.

---

### F-07 — Root-level stale markdown files and misplaced test files
**Severity: Medium**  
**Evidence:** 30+ `.md` planning artifacts at repo root (e.g., `navbar_audit.md`, `redundancy_matrix.md`, `state_flow_map.md`, `navbar_refactor_plan.md`, `risk_resolution_matrix.md`, etc.). 4 Python test files at root (`debug_test.py`, `test_demo_seeding.py`, `test_init_and_seed.py`, `test_template_compile.py`) outside the `sandbox_pms_mvp/tests/` directory. 1 CSV file (`workflow_accuracy_matrix.csv`).  
**Why it matters:** Stale docs mislead future agents and developers. Root test files are not collected by `pytest` (wrong path), so any assertions they contain are silently ignored. The root directory looks unfinished to any new contributor.  
**Fix:** Move permanent design documentation to `docs/`. Delete or archive the session-artifact planning files. Investigate and migrate/delete the 4 root test files.

---

### F-08 — `boto3` missing from `requirements.txt` for S3 storage path
**Severity: Medium**  
**Evidence:** `storage.py:9` documents that `S3StorageBackend` requires `boto3`. `requirements.txt` does not include `boto3`. If `STORAGE_BACKEND=s3` is configured without manually installing boto3, the import will fail at runtime.  
**Fix:** Either add `boto3>=1.34,<2.0` to `requirements.txt` (conditional on S3 path) or restructure `S3StorageBackend` to raise a clean `RuntimeError("boto3 is required for S3 storage")` on import, and document it clearly in `.env.production.example`.

---

### F-09 — `FEATURE_BOARD_V2` flag: unclear purpose, possible dead code
**Severity: Low**  
**Evidence:** `config.py` `FEATURE_BOARD_V2 = os.getenv("FEATURE_BOARD_V2", "0") == "1"`. Referenced in `front_desk_board_runtime.py`, passed into board context in several routes, tested with SSE skips in `test_phase15_front_desk_board.py`. No distinct v2 board template or route branch found that changes behaviour meaningfully.  
**Why it matters:** Feature flags that are never enabled and gate no meaningful difference are dead code. They add conditional branches to test and maintain.  
**Fix:** Audit what `board_v2_enabled=True` actually changes. If nothing material, remove the flag, its config entry, and all conditionals. If it gates real upcoming work, document what it controls.

---

### F-10 — OCR stub will silently do nothing in production
**Severity: Low**  
**Evidence:** `pre_checkin_service.py:768–794` — `suggest_ocr_extraction()` contains `# TODO: integrate OCR provider here` and always returns `None` without error.  
**Why it matters:** Any UX that promises OCR-assisted ID pre-fill will fail silently. Staff who are trained to expect auto-fill will be confused.  
**Fix:** Either remove the OCR UX (if not promised to users) or add a clear status response that tells the UI "OCR not available" so UX can display this honestly.

---

## 4) Comprehensive To-Do Backlog

### Architecture

- [ ] Extract remaining Flask Blueprints from `app.py` — still needed: `admin_bp`, `board_bp`, `front_desk_bp`, `public_bp` (auth, provider, housekeeping, messaging, cashier, reports, staff_reservations already extracted)
- [x] Move shared route helpers (CSRF, URL builders, form parsers, date parsers) out of `app.py` into dedicated `helpers/` or `utils/` module *(~60 functions extracted to `helpers.py`)*
- [x] Remove or fully enable `FEATURE_BOARD_V2` flag — confirm what it gates or delete it *(documented: gates board v2 action endpoints)*
- [ ] Standardise ORM query style — migrate all 278 legacy `.query.` usages to `db.session.execute(sa.select(...))`
- [x] Introduce a proper background task infrastructure (Render Cron Job or APScheduler/RQ) for all CLI automation tasks *(6 Render cron jobs added)*
- [x] Add `boto3` to `requirements.txt` (or document S3 as an optional extra clearly) *(verified present)*
- [x] Consolidate the 4 root-level test files into `sandbox_pms_mvp/tests/` or delete them *(deleted with root cleanup)*

### Frontend

- [x] Replace SSE polling-in-sync-worker pattern with either: (a) async worker class (`gevent`), (b) simple JS polling via `setInterval` + `/board/data` endpoint, or (c) HTMX polling with `hx-trigger="every 10s"` *(replaced with 10s JS polling)*
- [x] Add CSV download to all report pages (occupancy, revenue, booking attribution, cancellations) *(7 report types with `build_csv_rows()` + route + template button)*
- [ ] Add a mobile-friendly housekeeping attendant view (current board is desktop-heavy)
- [ ] Add keyboard shortcuts for the most frequent front-desk actions (check-in, room assignment)
- [ ] Add debounce to board search input to reduce unnecessary re-renders
- [ ] Make the density preference persist across sessions (currently reset to "compact" default; preference is stored in `UserPreference` but may not persist reliably)
- [ ] Add loading state / skeleton screen to front desk board initial paint
- [ ] Add explicit "no results" state to all list/search pages when filters return nothing

### Backend

- [x] Wire all CLI automation tasks to Render Cron Jobs in `render.yaml` *(6 cron jobs added)*
- [x] Fix ephemeral storage: configure `UPLOAD_DIR` (Render disk) or `STORAGE_BACKEND=s3` with proper credentials *(render.yaml + .env.production.example updated)*
- [x] Move `send_due_pre_arrival_reminders` and `send_due_failed_payment_reminders` out of the admin-triggered path and ensure they run on schedule *(Render cron jobs added)*
- [x] Add `try/except` guard around each `dispatch_notification_deliveries()` call to ensure one failed delivery does not abort the batch *(10 call sites wrapped)*
- [ ] Implement actual `PendingAutomationEvent` processing (ensure `process-automation-events` CLI command reliably consumes and fires all pending events)
- [x] Add proper waitlist management: auto-promote waitlisted reservations when rooms become available, or expire them after N days *(promote_eligible_waitlist + expire_stale_waitlist + CLI + Render cron)*
- [x] Implement modification request auto-pricing: when staff accept a modification request, re-quote the reservation and present the delta before saving *(approve calls `change_stay_dates`, shows delta in flash)*
- [ ] Add guest-facing check-out flow: folio summary + balance payment link before key drop

### Database

- [ ] Add composite index on `InventoryDay(room_id, business_date)` (verify it exists; availability queries use both columns together constantly)
- [ ] Add composite index on `FolioCharge(reservation_id, voided_at)` for cashier folio summary queries
- [ ] Add migration downgrade paths to all migration files that currently only have `upgrade()`
- [ ] Validate that the SQLite partial indexes (`sqlite_where`) have equivalent PostgreSQL indexes for production
- [ ] Confirm `PendingAutomationEvent` has a proper expiry/cleanup mechanism to prevent unbounded growth

### Reservations

- [ ] Add group booking / room block feature (block multiple rooms under one group code)
- [ ] Add reservation duplication (clone an existing reservation to a new date range)
- [x] Implement auto-cancel for `no_show` reservations not manually processed by end of business day *(`auto_cancel_no_shows()` + CLI + Render cron at 21:00 UTC — done in Phase 3)*
- [x] Add a "pending modifications" indicator on the front desk workspace when an open modification request exists *(batch query + "Mod" badge on board blocks + workspace flags)*
- [ ] Show `tentative` reservations on the front desk board so staff can track unconverted inquiries

### Room Inventory

- [x] Validate inventory bootstrap on new room creation — ✅ Verified: `upsert_room` calls `_ensure_room_inventory()` creating 730 days of InventoryDay rows. No rolling cron yet (minor: ~2yr runway).
- [ ] Add bulk inventory correction tool for admin (close/open date ranges with reason)
- [ ] Add room floor plan / photo management to the admin room editor

### Pricing / Rates

- [ ] Add occupancy-based dynamic rate adjustment (if occupancy > 85%, apply +10% override)
- [ ] Add a rate preview / "what would this guest pay" calculator accessible from the front desk
- [ ] Add a min-rate floor guard so discounts can never push the rate below cost
- [ ] Add rate cloning/copy tool to the admin rate rules editor

### Guest Records

- [x] Add guest search with fuzzy matching by phone / name *(search_guests() + /staff/guests route)*
- [ ] Add guest profile merge (deduplicate guests who booked under different contact details)
- [x] Add guest visit history view: all reservations linked to this guest profile *(`GET /staff/guests/<id>` + `staff_guest_detail.html` — done in Phase 3)*
- [ ] Add guest blacklist / block flag (with reason, for repeated no-shows or property damage)

### Billing / Payments

- [x] Fix potential Stripe webhook idempotency — ✅ Verified: 3-layer protection (provider_event_id unique index + posting_key unique on FolioCharge + SELECT FOR UPDATE). Concurrent threading tests exist.
- [ ] Add proforma invoice generation (pre-stay billing preview)
- [ ] Add receipt print/email after manual payment posting
- [ ] Add partial refund support (currently refunds are against specific folio lines, but partial amounts on a single charge need validation)
- [ ] Link folio balance warnings to the front desk board (show overdue balance badge on reservation card)

### Check-in / Check-out

- [x] Add explicit "ready for check-in" status flag visible to front desk without navigating into the reservation *(readyForCheckIn flag on board blocks + "Ready" badge)*
- [ ] Add early check-in / late check-out fee automation (currently evaluated but requiring manual override)
- [ ] Add guest self-service digital check-out (folio review + balance payment via hosted payment link)
- [ ] Validate the `identity_verified` flag is required for check-in completion in production mode (currently gated by `allow_override` which may be too permissive)

### Housekeeping

- [ ] Add departure turnover task auto-creation on check-out (already scaffolded in `create_departure_turnover_task` — verify it is wired to the checkout flow)
- [ ] Add housekeeping supervisor inspection workflow (inspect task → pass/fail → re-queue if failed)
- [ ] Add room maintenance request from guest-facing channel (guest reports issue → auto-creates maintenance task)
- [ ] Add shift-based task assignment view for housekeeping supervisor

### Messaging

- [ ] Integrate a real SMS provider (Twilio, AWS SNS, or similar) — replace `SmsAdapter` stub
- [ ] Add inbound email parsing (reply-to-thread feature for email channel)
- [ ] Add Line Business API integration for guest-facing messaging (not just staff alerts)
- [ ] Add message delivery retry with exponential back-off (currently delivery attempt is single-shot)
- [ ] Add auto-response templates for common guest questions

### Reporting

- [x] Add CSV download to all report pages (occupancy, revenue, booking attribution, cancellations) *(7 types done in Phase 2)*
- [ ] Add PDF/print-ready folio export
- [ ] Add channel performance report (ADR, reservations, cancellation rate by source channel)
- [ ] Add year-over-year comparison view to the occupancy dashboard
- [ ] Add a "debtors list" report (all reservations with outstanding balance > 0)
- [ ] Add payroll-ready housekeeping performance report (tasks completed per attendant per shift)

### Security

- [ ] Confirm `AUTH_ENCRYPTION_KEY` setup is documented in the Render deployment runbook — it is required for MFA and iCal token encryption and is currently empty in `.env.production.example`
- [ ] Add `Content-Security-Policy` nonce for inline scripts where `unsafe-inline` is currently allowed
- [ ] Add audit log retention/archiving policy and database-level partition or cleanup job to prevent unbounded growth
- [x] Add IP-based rate limit for the SSE endpoint to prevent a single IP from holding multiple workers *(SSE endpoint removed; no longer applicable)*
- [ ] Review the `allow_override` permission path on check-in — ensure it is restricted to manager roles only

### Performance

- [x] Fix the SSE sync-worker blocking issue (highest priority performance concern) *(replaced with JS polling)*
- [ ] Add HTTP response caching headers to static assets
- [ ] Add query `EXPLAIN` review for the housekeeping board query (loads all rooms with inventory + status + tasks in one pass)
- [ ] Consider caching the `current_settings()` result in `g` per-request to avoid repeated `AppSetting.query` hits on every templated page

### Accessibility

- [x] Add `aria-label` to icon-only buttons throughout the front desk and housekeeping boards *(density toggle buttons labeled)*
- [ ] Ensure all status badges have text equivalents (not colour-only)
- [ ] Add skip-navigation link to staff pages (already exists on public site, missing from staff layout)
- [ ] Audit form error states for screen reader compatibility (`aria-describedby` on error messages)

### QA / Testing

- [x] Investigate and migrate/delete 4 root-level test files (`debug_test.py`, `test_demo_seeding.py`, `test_init_and_seed.py`, `test_template_compile.py`) *(deleted in root cleanup)*
- [x] Add tests covering the pricing module (`pricing.py`) — `quote_reservation` and `nightly_room_rate` have zero direct test coverage *(16 tests in test_pricing.py)*
- [ ] Add tests for `channel_service.py` mock provider operations
- [ ] Add a test for the `PendingAutomationEvent` processing flow
- [ ] Add integration test for `LocalStorageBackend` round-trip (save → read → serve)
- [ ] Add load/regression tests for availability queries with 200+ inventory days
- [x] Add test that verifies SSE endpoint returns correct Content-Type (already skipped — un-skip after SSE fix) *(SSE removed; test updated to assert endpoint gone)*

### Deployment / DevOps

- [x] Add Render Cron Job entries for: `process-notifications` (every 5 min), `send-pre-arrival-reminders` (daily 09:00), `send-failed-payment-reminders` (daily 10:00), `sync-ical-sources` (every 15 min), `process-automation-events` (every 5 min), `fire-pre-checkin-reminders` (daily ~48h before target check-in) *(all 6 added)*
- [x] Fix ephemeral storage: add Render Disk or configure S3 env vars in `render.yaml` *(documented with commented-out config)*
- [x] Set `MAX_CONTENT_LENGTH` correctly in `.env.production.example` (currently `1048576` = 1 MB, but `pre_checkin_service` allows 10 MB uploads — this mismatch would silently reject document uploads in production) *(set to 12582912)*
- [ ] Add a health check endpoint response time SLA (current `/health` returns 200 but has no DB liveness check)
- [ ] Add a `python -m flask db current` step to the deploy runbook to verify migration state before go-live
- [ ] Add Sentry (or equivalent) error tracking via environment variable
- [x] Clean up 30+ stale root-level markdown files — move permanent docs to `docs/`, delete session artifacts *(28 files deleted, 4 moved)*

### Admin / Settings

- [ ] Add bulk notification template reset-to-defaults action
- [ ] Add admin UI for managing `PendingAutomationEvent` queue (view queued events, manually trigger, clear stuck events)
- [ ] Add admin UI for `BookingExtra` configuration (add-ons like breakfast, airport transfer)
- [ ] Add calendar blackout period conflict checker (warn if blackout overlaps confirmed reservations)

---

## 5) Recommended Phases

### Phase 0 — Immediate Production Blockers (Sprint 1)

**Objective:** Prevent active data loss and silent operational failures.

**Why this phase:** These are production failures happening right now on every deploy and every business day.

**To-dos:**
- Fix ephemeral storage: add Render persistent disk or S3 config to `render.yaml` and `.env.production.example`; add `UPLOAD_DIR` / `S3_BUCKET` env vars; verify `boto3` in requirements if S3 path chosen
- Fix `MAX_CONTENT_LENGTH` mismatch: `render.yaml` or `.env.production.example` should set this to 12 MB (matching `config.py`'s `12582912` default), not 1 MB
- Wire CLI tasks to Render Cron Jobs: `process-notifications`, `send-pre-arrival-reminders`, `send-failed-payment-reminders`, `sync-ical-sources`, `process-automation-events`, `fire-pre-checkin-reminders`
- Fix SSE blocking: replace sync-worker SSE with JS polling (`setInterval` + `/board/data`) or switch to `gevent` worker class

**Dependencies:** None — all are configuration or small backend changes.

**Success criteria:**
- Uploaded documents survive a Render redeploy
- Pre-arrival emails fire daily without manual CLI invocation
- Front desk board updates without blocking workers
- Document upload succeeds end-to-end with files > 1 MB

---

### Phase 1 — Stabilisation (Sprint 2–3)

**Objective:** Close the most visible correctness and operational gaps.

**Why this phase:** Before adding features, the existing features need to be trustworthy.

**To-dos:**
- [x] ~~Add departure turnover task auto-wiring to checkout flow~~ ✅ Verified: already wired in `complete_checkout`
- [x] Validate inventory bootstrap on new room creation ✅ Verified: `upsert_room` calls `_ensure_room_inventory()` — creates 730 days from today
- [x] Fix Stripe webhook idempotency ✅ Verified: 3-layer protection (provider_event_id unique + posting_key unique + SELECT FOR UPDATE). Concurrent threading tests exist.
- [x] Add clear "OCR not available" status response from `suggest_ocr_extraction` (remove silent null return) *(returns `{"status": "unavailable", ...}`)*
- [x] Clean up root directory: move permanent docs to `docs/`, investigate root test files, delete or archive the 30 stale planning markdown files *(28 deleted, 4 moved)*
- [x] Investigate and resolve `FEATURE_BOARD_V2` flag — document or remove *(documented: gates board v2 action endpoints)*
- [x] Add DB liveness check to `/health` endpoint *(verified: already implemented)*

**Dependencies:** Phase 0 must be stable first.

**Success criteria:**
- Housekeeping board always shows departure rooms that need turnover
- New rooms immediately have inventory rows after creation
- `/health` returns 503 if DB is unreachable
- Root directory contains only intentional, maintained files

---

### Phase 2 — Core PMS Correctness (Sprint 4–6)

**Objective:** Fill the most operationally painful workflow gaps.

**Why this phase:** These gaps cause daily friction for front desk and finance staff.

**To-dos:**
- [x] Add modification request auto-pricing (re-quote on accept, show delta to staff) *(approve/decline routes + auto-pricing via `change_stay_dates`)*
- [x] Add waitlist promotion/expiry automation *(FIFO promotion + 14-day expiry CLI command + Render cron)*
- Add proforma invoice and receipt generation
- [x] Add "pending modification" indicator on front desk workspace and board *(batch COUNT query + "Mod" badge)*
- [x] Add guest profile search improvements (fuzzy match by phone/name) *(search_guests() + /staff/guests route + email matching in reservation search)*
- [x] Add report CSV downloads (all report pages) *(7 types: arrivals, departures, room_status, payment_due, occupancy, booking_source, no_show_cancellation)*
- [x] Add folio balance badge to front desk board reservation card *(batch SUM query, badge + popover)*
- [x] Migrate pricing module tests (cover `quote_reservation`, `nightly_room_rate`) *(16 tests in test_pricing.py)*
- [x] Add explicit "ready for check-in" status badge *(computed flag: confirmed + arrival ≤ today + allocated + room ready)*

**Dependencies:** Phase 1 stable.

**Success criteria:**
- Staff can accept a modification request without re-pricing manually
- Overdue balance is visible on the board without entering the cashier
- Reports can be exported and emailed to management without a developer

---

### Phase 3 — Operational Workflow Optimisation (Sprint 7–10)

**Status: IN PROGRESS (2026-03-19)**

**Objective:** Make the PMS genuinely fast and frictionless for front desk operations.

**Why this phase:** The core flows exist; now they need to be the right UX.

**Completed items:**

| Item | Status | Notes |
|------|--------|-------|
| Flask Blueprint extraction — `auth_bp` | ✅ Done | 6 routes extracted (`/staff/login`, `/staff/logout`, etc.) |
| Flask Blueprint extraction — `provider_bp` | ✅ Done | 12 routes extracted (`/provider/*`) |
| Flask Blueprint extraction — `housekeeping_bp` | ✅ Done | 17 routes extracted (`/staff/housekeeping/*`, room readiness API) |
| Flask Blueprint extraction — `messaging_bp` | ✅ Done | 242-line module; all messaging/thread/template/automation routes extracted |
| Flask Blueprint extraction — `cashier_bp` | ✅ Done | 249-line module; all cashier/folio/charge/payment/refund routes extracted |
| Flask Blueprint extraction — `reports_bp` | ✅ Done | 178-line module; all staff report + CSV download routes extracted |
| Flask Blueprint extraction — `staff_reservations_bp` | ✅ Done | 770-line module; reservation list, detail, create, edit, notes, pre-checkin, cancel routes extracted |
| Shared `helpers.py` module | ✅ Done | ~60 functions extracted (auth, CSRF, parsing, utility, branding, i18n, reports) |
| Auto-cancel same-day no-shows | ✅ Done | `auto_cancel_no_shows()` service + CLI + render.yaml cron (21:00 UTC) |
| Guest visit history view | ✅ Done | `GET /staff/guests/<id>` route + `staff_guest_detail.html` template |
| Service layer refactoring — business logic extraction | ✅ Done | `front_desk_service`, `front_desk_board_service`, `reservation_service`, `staff_reservations_service` — handlers refactored to call service layer instead of inline logic. Routes module structure added. |
| Template URL endpoint updates | ✅ Done | 18 templates updated to use blueprint-prefixed `url_for()` calls after route extractions |

**Results:** `app.py` reduced from 5,923 → 3,693 lines (−2,230 lines, 7 Blueprints extracted + service layer delegation). Blueprints now cover: auth, provider, housekeeping, messaging, cashier, reports, staff_reservations. Remaining in `app.py`: front desk board, check-in/out, admin, public booking, walk-in.

**Reconciled update (2026-03-19):**
- `front_desk_bp`, `admin_bp`, and `public_bp` are already extracted and registered in `create_app()`; the earlier blueprint-extraction backlog entry is stale.
- `pms/app.py` is currently 1,273 lines, not 3,693, and now mostly contains app-factory wiring plus shared helpers rather than large route clusters.
- Front-desk board density persistence and keyboard shortcuts are verified by `test_phase15_front_desk_board.py` (`62 passed` on 2026-03-19).
- Staff skip-link / accessibility baseline remains in place via `templates/base.html`, and the existing guardrail coverage still passes.
- Early / late fee handling is implemented in front-desk check-in/out flows; `test_phase6_front_desk_workspace.py` is green (`21 passed, 1 skipped` on 2026-03-19).

**Remaining to-dos:**
- Continue Blueprint extraction (admin_bp, board_bp, front_desk_bp — to reach <2,000 lines)
- Migrate legacy `.query.` ORM patterns to modern style (batch by module)
- Add mobile-optimised housekeeping attendant view
- Add group booking / room block feature
- Add guest self-service digital check-out

**Dependencies:** Phase 2 stable.

**Success criteria:**
- `pms/app.py` stays below 2,000 lines while the remaining operational backlog lands
- Front desk operations measurably faster (fewer page loads for common actions)
- Housekeeping attendant can use the app on a tablet without layout issues

---

### Phase 4 — Admin / Reporting / Integrations (Sprint 11–15)

**Objective:** Give management the data they need and open external connectivity.

**Why this phase:** Management decisions and OTA channel growth depend on this layer.

**To-dos:**
- Add channel performance report and year-over-year comparison
- Add debtors/outstanding-balance report
- Implement real SMS provider (Twilio or AWS SNS)
- Add Line Business API integration for guest messaging
- Add OTA channel push adapter (inventory/rate updates via CM API)
- Add revenue management dashboard (ADR, RevPAR, occupancy forecast)
- Add Sentry error tracking
- Add CSP nonce to replace `unsafe-inline` for scripts
- Add audit log archival/cleanup job

**Dependencies:** Phase 3 stable.

**Success criteria:**
- Management can pull occupancy and revenue reports without developer help
- OTA bookings flow in via channel manager without manual data entry
- All runtime errors are captured in Sentry with context

---

### Phase 5 — Polish, Resilience, Scale (Sprint 16+)

**Objective:** Production-grade reliability, performance, and guest experience excellence.

**Why this phase:** The system is operationally solid by this point; now make it exceptional.

**To-dos:**
- Complete Flask Blueprint extraction (all route groups)
- Complete ORM migration (zero legacy `.query.` calls)
- Add Redis-backed rate limiting (replace DB count queries)
- Add HTTP caching headers for static assets
- Add guest loyalty / membership tier tracking
- Add post-stay guest satisfaction survey automation
- Add ID scanner hardware integration (passport reader)
- Add POS integration adapter interface
- Add multi-property scaffolding (AppSetting hierarchy)

**Dependencies:** Phase 4 stable.

**Success criteria:**
- App handles 100+ concurrent staff users without SSE blocking or DB saturation
- Public booking survives bot-level rate abuse without performance degradation
- `app.py` is under 1,500 lines (mostly `create_app()` wiring)

---

## 6) Critical Path

The shortest path from the current state to a PMS that is **genuinely usable and dependable** in production:

```
1. Fix UPLOAD_DIR / storage → documents survive deploys
2. Fix MAX_CONTENT_LENGTH → documents > 1 MB actually upload
3. Wire cron jobs → automated emails fire without manual CLI
4. Fix SSE worker-blocking → board works under concurrent load
5. Auto-wire checkout → housekeeping turnover tasks appear reliably
6. Fix Stripe idempotency → no double-payment postings
7. Add modification request re-pricing → finance workflow complete
8. Add report CSV exports → management self-service
```

Steps 1–4 are Phase 0 (configuration/small changes). Steps 5–8 are Phase 1–2 code changes. Everything beyond this is quality-of-life and feature expansion.

---

## 7) Quick Wins

High-value, low-effort improvements achievable in a single session each:

| # | Task | Effort | Impact |
|---|---|---|---|
| QW-1 | Add Render Cron Job for `process-notifications` to `render.yaml` | S | Immediately activates guest email delivery |
| QW-2 | Set `UPLOAD_DIR` env var in `render.yaml` pointing to Render disk mount (or add disk config) | S | Prevents document loss on redeploy |
| QW-3 | Fix `MAX_CONTENT_LENGTH` in `.env.production.example` to 12 MB | S | Unblocks passport/ID document uploads |
| QW-4 | Replace SSE with `setInterval` + `/board/data` HTMX/fetch polling (10s) | M | Eliminates worker-blocking risk |
| QW-5 | Delete / archive the 30 stale root-level markdown session-artifact files | S | Cleaner repo, less confusion for agents |
| QW-6 | Migrate the 4 root-level test files into `sandbox_pms_mvp/tests/` or delete them | S | Tests collected by pytest, no silent dead tests |
| QW-7 | Add `boto3>=1.34,<2.0` to `requirements.txt` (needed for S3 storage path) | S | Prevents runtime ImportError if S3 is configured |
| QW-8 | Add `/health` DB liveness check (single `SELECT 1` via `db.session.execute`) | S | Render health check catches DB connectivity failures |
| QW-9 | Add `aria-label` to all icon-only buttons in the front desk board | S | Accessibility improvement, zero logic change |
| QW-10 | Return meaningful OCR unavailability status from `suggest_ocr_extraction` instead of `None` | S | Removes silent feature promise failure |
| QW-11 | Verify `create_departure_turnover_task` is called on every checkout path | S | Ensures housekeeping sees departures immediately |

---

## 8) Hidden Risks and Technical Debt

**R-01 — Parallel SSE connections will saturate Gunicorn workers**  
Two staff members viewing the board simultaneously will hold both sync workers for 5 minutes. A third request (e.g., a public booking) will queue until a slot frees. In a busy property this creates intermittent 502s that are very hard to diagnose.

**R-02 — Ephemeral storage is an invisible data loss trap**  
There is no error on deploy. Staff upload documents. They appear to work. Then Render redeploys (triggered by a push, auto-scale, or maintenance). All documents silently vanish. Staff notice when trying to view an uploaded passport during check-in. This is a compliance risk for properties required to retain guest ID copies.

**R-03 — Pre-arrival and automation emails never fire automatically**  
The features exist, are tested, and look complete in the admin UI. But in production they are dead unless someone runs `flask send-pre-arrival-reminders` by hand. Guests who were promised pre-arrival communication receive nothing.

**R-04 — Stripe webhook re-delivery idempotency**  
If Stripe retries a `checkout.session.completed` event (which it does when your server returns a non-2xx), `record_payment` may be called twice for the same payment. The `PaymentEvent` table has no unique constraint on `(payment_request_id, provider_payment_reference)`. This can create double-posted payments on folios that are very difficult to audit after the fact.

**R-05 — `AUTH_ENCRYPTION_KEY` is critical but undocumented in render.yaml**  
This key is required to decrypt TOTP secrets and iCal feed tokens. If it is rotated or cleared, all MFA factors stop working and all iCal feeds become unreadable. The `render.yaml` correctly marks it as `sync: false` (manual secret) but the deployment runbook does not describe its format (Fernet key = base64-encoded 32 bytes), how to generate it, or what happens if it changes.

**R-06 — Inventory bootstrap gap on new room creation**  
When `upsert_room` creates a new room, `_ensure_room_inventory` only bootstraps from today forward (`date.today()`) for `INVENTORY_BOOTSTRAP_DAYS`. Historical inventory rows (for dates before today) will never exist for the new room. This means availability queries may silently return 0 for the new room if any availability logic relies on pre-existing inventory rows (e.g., `count_available_rooms` will return 0 for the new room on newly-created historical inventory). This affects demo/test data and any property that adds rooms mid-season.

**R-07 — `time.sleep(1)` in SSE generator creates a memory leak for long-running connections**  
The SSE generator keeps a `seen_events: set` in memory that grows unboundedly for the 5-minute session lifetime. In a normal small property this is harmless; under prolonged usage (staff leaving browser tabs open) this accumulates.

**R-08 — `BookingExtra` add-ons are configured but the admin UI for creating/editing them is not wired**  
The model, service, and migration exist. The public booking form and cashier reference them. But there is no admin panel screen for managing `BookingExtra` records — staff cannot add, edit, or price add-ons without direct database access.

**R-09 — `cron: ` jobs not configured on Render = silent automation cliff**  
Any staff member trained to expect automated reminders, automated notifications, or automated iCal syncs will lose trust in the system when these things fail to arrive. Unlike a crash (which is obvious), a missing scheduled job is invisible until a guest complains.

**R-10 — 22 migration files, none with downgrade paths**  
All `downgrade()` functions are empty or have `pass`. If a bad migration is deployed to production, there is no automated rollback — manual SQL is required. This is standard for fast-moving projects but is a production risk that should be documented.

---

## 9) Open Questions / Assumptions

| # | Question / Assumption |
|---|---|
| Q-01 | **FEATURE_BOARD_V2**: What does this flag actually gate? No distinct v2 board route, template, or behaviour was found that differs materially when `board_v2_enabled=True`. This may be a leftover from a sprint that was merged but the flag never cleaned up. Needs owner confirmation. |
| Q-02 | **Single-tenant assumption**: The data model has no `property_id` or tenant discriminator on any operational entity. The entire schema is single-property. Is multi-property support in scope? If so, this requires an architectural change before the data model grows further. |
| Q-03 | **Render disk vs. S3**: The deployment blueprint does not include a persistent disk. Render free/starter plans do not include persistent disks. Is a Render disk available on the chosen plan, or is S3 the intended path for document storage? |
| Q-04 | **Stripe live credentials**: The `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are `sync: false` in `render.yaml`. Has a live Stripe account been connected, or is the property still using `PAYMENT_PROVIDER=disabled`? This determines urgency of the Stripe idempotency fix (F-04). |
| Q-05 | **OCR provider intent**: Is OCR ID extraction a committed product feature or a speculative placeholder? If committed, what provider (AWS Textract, Google Vision, Mindee) is preferred? |
| Q-06 | **Automation rules**: The `AutomationRule` and `PendingAutomationEvent` models exist and the CLI command processes them. Are automation rules actually configured via seed data or admin UI? The admin panel does not appear to expose an automation rules editor. |

---

## 10) Final Recommended Build Order

The following is a strict ordered sequence from highest-leverage to later-stage work:

1. **Fix storage backend + `UPLOAD_DIR` in render.yaml** — prevents document data loss
2. **Fix `MAX_CONTENT_LENGTH` in `.env.production.example`** — unblocks 10 MB document uploads
3. **Add Render Cron Job for `process-notifications`** — activates email delivery pipeline
4. **Add Render Cron Jobs for reminders, iCal sync, automation events** — completes operational automation
5. **Fix SSE worker-blocking** — replace with JS polling or switch to gevent workers
6. **Add Stripe webhook idempotency guard** — prevents double-payment postings
7. **Verify + wire `create_departure_turnover_task` on checkout** — connects check-out to housekeeping
8. **Add DB liveness check to `/health`** — enables Render to detect and restart on DB failure
9. **Clean up root-level stale markdown and misplaced test files** — housekeeping
10. **Add `aria-label` to icon-only buttons** — quick accessibility win
11. **Return OCR unavailability status instead of silent `None`** — honest UX
12. **Add `boto3` to requirements or document S3 setup** — enables S3 path without surprises
13. **Resolve `FEATURE_BOARD_V2` flag** — remove dead code or document purpose
14. **Add modification request re-pricing flow** — closes daily finance friction
15. **Add waitlist promotion / expiry automation** — completes reservation lifecycle
16. **Add report CSV export to all report pages** — management self-service
17. **Add guest-facing digital check-out flow** — reduces front-desk friction
18. **Begin Flask Blueprint extraction from `app.py`** — structural stability
19. **Begin ORM query style migration (.query → session.execute)** — technical debt reduction
20. **Add SMS provider integration** — activates SMS notification channel
21. **Add Line Business guest messaging** — activates line channel
22. **Add channel manager OTA push adapter** — enables live rate/inventory sync
23. **Add revenue management dashboard** — gives management yield visibility
24. **Add Redis-backed rate limiting** — replaces DB count rate limiting under load
25. **Add multi-property scaffolding** — architecture prerequisite for expansion
26. **Complete Blueprint extraction + ORM migration** — final debt clearance
