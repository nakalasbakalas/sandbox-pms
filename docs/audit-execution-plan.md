# PMS Repo Audit and Execution Plan


> **Audit date:** 2026-03-18  


> **Last updated:** 2026-03-22  


> **Test baseline:** 565 tests collected; targeted test sweep: all passing  


> **Scope:** Full repository scan — routes, models, services, templates, static assets, tests, migrations, config, CI, deployment

---

## Phase 0 Execution Summary


**Status: ✅ COMPLETE (2026-03-18)**


All critical and high-priority fixes from the audit implemented and tested:


| Finding | Status | Notes |
|---------|--------|-------|
| **F-01** SSE blocks workers | ✅ Fixed | SSE endpoint removed; replaced with 10s JS polling |
| **F-02** Render storage config | ✅ Fixed | `Config` now loads local/S3 storage env vars and `render.yaml` enables a persistent Render disk at `/var/data/uploads/documents` |
| **F-03** Background tasks unwired | ✅ Fixed | 9 Render cron jobs wired, including notifications, automation, iCal sync, waitlist, audit cleanup, and no-show auto-cancel |
| **F-07** Root cleanup | ✅ Fixed | 28 artifacts deleted, 4 docs moved to `docs/`, 4 root tests removed |
| **F-09** FEATURE_BOARD_V2 unclear | ✅ Fixed | Dead config and startup gate removed; board action surface stays always on via compatibility helper |
| **F-10** OCR returns None silently | ✅ Fixed | Now returns status dict: `{"status": "unavailable", ...}` |
| **QW-1 to QW-11** | ✅ Fixed | All quick wins completed (aria-labels, guards, config) |


**Results:** `app.py` reduced from 5,923 -> 1,266 lines (-4,657 lines, all 10 Blueprints extracted + service layer delegation). All blueprint route groups now extracted: auth, provider, housekeeping, messaging, cashier, reports, staff_reservations, admin, front_desk (incl. board), public. Remaining in `app.py`: `create_app()` factory wiring, shared helpers, and CLI registration. Current repo snapshot: 29 test files, 549 tests collected, 25 migrations, persistent Render disk + `/health` + 9 cron services defined in `render.yaml`.


**Branch:** `codex/review-and-continue-execution-plan`

---

## Phase 1 Execution Progress


**Status: ✅ COMPLETE (2026-03-19)**


| Phase 1 Item | Status | Notes |
|--------------|--------|-------|
| Departure turnover auto-wiring | ✅ Verified | Already wired in `complete_checkout` |
| OCR unavailability status | ✅ Fixed | Returns `{"status": "unavailable", ...}` (done in Phase 0) |
| Root cleanup | ✅ Fixed | Done in Phase 0 |
| `FEATURE_BOARD_V2` flag | ✅ Removed | Legacy env/config removed; board action surface is always on |
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


The Sandbox Hotel PMS is now best described as a **large but credible single-property PMS with most beta-critical operations implemented in-repo**. The old audit story that focused on broken SSE, missing storage durability, unwired cron, and a 5,900-line `app.py` is no longer the current reality.


**Implemented in repo**


- Blueprint extraction is complete: the web surface now lives across 10 route modules, with `pms/app.py` down to 1,266 lines.


- ORM modernization is complete: there are 0 remaining legacy `.query.` hits under `sandbox_pms_mvp/pms/`.


- Deployment wiring is materially stronger: `render.yaml` defines a persistent disk, `UPLOAD_DIR=/var/data/uploads/documents`, a DB-backed `/health` check, and 9 recurring cron services.


- Reporting is broader than the older audit implied: occupancy, year-over-year occupancy, channel performance, housekeeping performance, CSV exports, and revenue-management pacing are all present in the current repo.


- Test coverage is broad and active: 29 test files and 549 collected tests.


**Current risks**


1. Live deployment verification is still outstanding. The repo defines the Render disk, cron jobs, `/health`, and Sentry wiring, but those still need proof on the running service.


2. Architecture debt has shifted from `app.py` alone to several very large extracted route/service modules, especially `routes/front_desk.py` (1,610 lines) and multiple 1,100-1,500 line services.


3. Some launch-scope decisions remain product decisions rather than pure engineering gaps: direct vendor adapters vs webhook-backed messaging, PDF exports vs CSV-only beta, and whether first-class LINE guest identifiers are needed before launch.


**What must happen first**


- Verify the live Render project, not the repo, for disk persistence, cron success, `/health`, and board polling latency.


- Provision a real `SENTRY_DSN` and capture one verified event with request context.


- Keep beta scope focused on the current single-property operational surface before tackling post-beta scale/refactor work.

---

## 2) What the Repo Currently Contains


### Repo snapshot


| Area | Current state | Status |
|---|---|---|
| Route surface | 10 route modules; largest is `routes/front_desk.py` at 1,610 lines | Implemented |
| Core app factory | `pms/app.py` at 1,266 lines, mostly app wiring and shared setup | Implemented |
| Services | Multiple mature service modules, with several large hotspots (`reporting_service.py`, `admin_service.py`, `staff_reservations_service.py`, `front_desk_board_service.py`, `housekeeping_service.py`) | Implemented with post-beta refactor debt |
| Tests | 29 test files, 549 collected tests | Verified by `pytest --collect-only` |
| Migrations | 25 Alembic revisions under `sandbox_pms_mvp/migrations/versions` | Implemented |
| Deployment | Persistent disk, `UPLOAD_DIR`, `/health`, and 9 cron services in `render.yaml` | Implemented in repo, still needs live verification |


### Implemented and test-backed


| Module | Evidence |
|---|---|
| Staff auth, MFA, lockout, password reset, RBAC | `test_phase3_auth.py`, `test_phase10_admin_panel.py` |
| Public booking flow, attribution capture, extras, hosted payment entry | `test_phase4_public_booking.py`, `test_phase9_hosted_payments.py` |
| Staff reservations workspace, duplication, modification review, pre-check-in reflection | `test_phase5_staff_reservations_workspace.py`, `test_phase17_pre_checkin.py` |
| Front desk workspace, check-in/out, no-show, operational fees | `test_phase6_front_desk_workspace.py` |
| Front desk planning board with polling refresh, room blocks, balance badges, import/export | `test_phase15_front_desk_board.py` |
| Housekeeping board, readiness, mobile route, task lifecycle | `test_phase7_housekeeping.py`, `test_housekeeping_readiness.py` |
| Cashier, folio, documents, proforma preview, refunds | `test_phase8_cashier.py` |
| Reporting and dashboards: occupancy, YoY occupancy, channel performance, housekeeping performance, booking attribution, revenue summary, revenue management pacing, CSV exports | `test_phase12_reporting.py`, `test_phase19_dashboards.py` |
| Messaging and automation queue processing | `test_phase11_communications.py`, `test_phase18_messaging.py` |
| Deployment/config hardening, `/health`, storage envs, Render cron blueprint | `test_phase13_security_hardening.py`, `test_deployment_cli.py` |


### Implemented in repo but still awaiting live verification


| Area | Repo state | External follow-through |
|---|---|---|
| Persistent uploads | Render disk and `UPLOAD_DIR=/var/data/uploads/documents` are configured | Confirm mount, writability, and restart persistence on the live service |
| Scheduled background tasks | 9 Render cron services are defined | Confirm each job is enabled and succeeding in Render |
| DB health endpoint | `/health` performs DB liveness check and returns SLA metadata | Confirm deployed endpoint returns `db: "ok"` and `within_sla: true` |
| Board concurrency path | SSE removed; board uses polling-heavy fetch refresh | Measure live `refreshSurface()` latency under concurrent staff sessions |
| Sentry | Config and app wiring are present | Provision `SENTRY_DSN` and verify one real captured event |


### Beta defaults and remaining product choices


| Area | Current beta default | Not a blocker unless business scope changes |
|---|---|---|
| Report exports | HTML + CSV | PDF / print-ready exports |
| Messaging adapters | Webhook-backed SMS / WhatsApp / LINE plus current adapter registry | Direct Twilio/SNS/vendor-specific adapters |
| LINE guest messaging | Explicit recipient entry with adapter support | Dedicated LINE user ID field on guest records |
| OTA connectivity | Current webhook/adapter abstractions plus iCal | Direct OTA rate/inventory push to Booking.com / Expedia |


### Still missing or clearly post-beta


- Multi-property / multi-tenant support


- Loyalty / membership tiers


- POS integration


- ID scanner hardware integration


- Survey / post-stay feedback automation


- Full group-booking workflow beyond operational room-block actions


- Forecasting engine and automated yield/rate optimization beyond the current revenue pacing dashboard

---

## 3) Key Findings


The original audit findings below are retained for traceability, but they are no longer the authoritative current-state summary. The critical-path repo defects around SSE, persistent storage wiring, cron wiring, blueprint extraction, and ORM modernization have been resolved in code. Treat Sections 1, 2, 8, and 10 as the current source of truth for what remains.


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

### F-09 — `FEATURE_BOARD_V2` flag: stale rollout artifact


**Severity: Low**  


**Evidence:** The planning board no longer has a separate v2 rollout path. The old env/config flag and startup gate were removed on 2026-03-20; `front_desk_board_v2_enabled()` remains only as a compatibility helper for templates and metrics and always returns `True`.  


**Why it matters:** Feature flags that are never enabled and gate no meaningful difference are dead code. They add conditional branches to test and maintain.  


**Fix:** Keep the board action surface always on, remove dead config/wiring, and retain only the minimal compatibility helper until downstream template/log references no longer need it.

---

### F-10 — OCR stub will silently do nothing in production


**Severity: Low**  


**Evidence:** `pre_checkin_service.py:768–794` — `suggest_ocr_extraction()` contains `# TODO: integrate OCR provider here` and always returns `None` without error.  


**Why it matters:** Any UX that promises OCR-assisted ID pre-fill will fail silently. Staff who are trained to expect auto-fill will be confused.  


**Fix:** Either remove the OCR UX (if not promised to users) or add a clear status response that tells the UI "OCR not available" so UX can display this honestly.

---

## 4) Comprehensive To-Do Backlog


### Architecture


- [x] Extract remaining Flask Blueprints from `app.py` — all 10 blueprint route files now extracted: `admin_bp`, `front_desk_bp` (incl. board routes), `public_bp` alongside the earlier auth, provider, housekeeping, messaging, cashier, reports, staff_reservations extractions *(app.py reduced to 1,354 lines; `create_app()` wiring + CLI registration remain)*


- [x] Move shared route helpers (CSRF, URL builders, form parsers, date parsers) out of `app.py` into dedicated `helpers/` or `utils/` module *(~60 functions extracted to `helpers.py`)*


- [x] Remove or fully enable `FEATURE_BOARD_V2` flag — confirm what it gates or delete it *(completed on 2026-03-20: dead env/config flag and startup gate removed; compatibility helper remains always-on for template/log continuity)*


- [x] Standardise ORM query style - migrated all 278 legacy `.query.` usages to `db.session.execute(sa.select(...))` / `db.session.get()` across services, routes, helpers, `app.py`, and `seeds.py` *(0 remaining in `pms/`; full suite green on 2026-03-20: 511 passed, 7 skipped)*


- [x] Introduce a proper background task infrastructure (Render Cron Job or APScheduler/RQ) for all CLI automation tasks *(9 Render cron jobs added)*


- [x] Add `boto3` to `requirements.txt` (or document S3 as an optional extra clearly) *(verified present)*


- [x] Consolidate the 4 root-level test files into `sandbox_pms_mvp/tests/` or delete them *(deleted with root cleanup)*


### Frontend


- [x] Replace SSE polling-in-sync-worker pattern with either: (a) async worker class (`gevent`), (b) simple JS polling via `setInterval` + `/board/data` endpoint, or (c) HTMX polling with `hx-trigger="every 10s"` *(replaced with 10s JS polling)*


- [x] Add CSV download to all report pages (occupancy, revenue, booking attribution, cancellations) *(7 report types with `build_csv_rows()` + route + template button)*


- [x] Add a mobile-friendly housekeeping attendant view (current board is desktop-heavy) *(added dedicated `?view=mobile` housekeeping cards, preserved date/filter/view toggles, and touch-friendly room-status quick actions; verified in `test_phase7_housekeeping.py` on 2026-03-19)*


- [x] Add keyboard shortcuts for the most frequent front-desk actions (check-in, room assignment) *(verified in test_phase15_front_desk_board.py, 63 passed)*


- [x] Add debounce to board search input to reduce unnecessary re-renders *(completed on 2026-03-20: the front-desk board search now auto-submits only after a 250ms pause, reuses stable search form/input hooks for the `/` shortcut, and is covered in `test_phase15_front_desk_board.py` with the board suite green from the repo root: 67 passed.)*


- [x] Make the density preference persist across sessions *(verified: `UserPreference` persistence confirmed by test_phase15_front_desk_board.py, 63 passed)*


- [x] Add loading state / skeleton screen to front desk board initial paint *(completed on 2026-03-20: the board surface now preserves a dedicated content wrapper plus skeleton overlay, shows a reusable loading state during initial hydration and AJAX refreshes, and is covered in `test_phase15_front_desk_board.py`; verified green from the repo root with 69 passed.)*


- [x] Add explicit "no results" state to all list/search pages when filters return nothing *(reconciled on 2026-03-20: the current operational/search surfaces already render explicit empty states, including reservations, guest search, messaging inbox, provider bookings, front-desk workspace, operational lists, housekeeping board, and front-desk planning board; verified by template audit across `staff_reservations.html`, `staff_guests.html`, `staff_messaging_inbox.html`, `provider_bookings.html`, `front_desk_workspace.html`, `staff_operational_list.html`, `housekeeping_board.html`, and `_front_desk_board_surface.html`.)*


### Backend


- [x] Wire all CLI automation tasks to Render Cron Jobs in `render.yaml` *(9 cron jobs added, including waitlist, audit cleanup, and no-show auto-cancel)*


- [x] Fix ephemeral storage: configure `UPLOAD_DIR` (Render disk) or `STORAGE_BACKEND=s3` with proper credentials *(render.yaml + .env.production.example updated)*


- [x] Move `send_due_pre_arrival_reminders` and `send_due_failed_payment_reminders` out of the admin-triggered path and ensure they run on schedule *(Render cron jobs added)*


- [x] Add `try/except` guard around each `dispatch_notification_deliveries()` call to ensure one failed delivery does not abort the batch *(10 call sites wrapped)*


- [x] Implement actual `PendingAutomationEvent` processing (ensure `process-automation-events` CLI command reliably consumes and fires all pending events) *(service-level queueing + `process_pending_automations()` + `process-automation-events` CLI verified in `test_phase18_messaging.py` on 2026-03-19; retention cleanup now prunes processed rows older than `PENDING_AUTOMATION_RETENTION_DAYS`)*


- [x] Add proper waitlist management: auto-promote waitlisted reservations when rooms become available, or expire them after N days *(promote_eligible_waitlist + expire_stale_waitlist + CLI + Render cron)*


- [x] Implement modification request auto-pricing: when staff accept a modification request, re-quote the reservation and present the delta before saving *(approve calls `change_stay_dates`, shows delta in flash)*


- [x] Add guest-facing check-out flow: folio summary + balance payment link before key drop *(public digital checkout now exposes token-gated folio review, hosted balance payment handoff, and self-service completion for fully settled stays; verified in `test_phase4_public_booking.py`, `test_phase6_front_desk_workspace.py`, and `test_phase9_hosted_payments.py` on 2026-03-19)*


### Database


- [x] Add composite index on `InventoryDay(room_id, business_date)` (verify it exists; availability queries use both columns together constantly) *(verified on 2026-03-20: migrated schema already enforces `uq_inventory_days_room_date`, which yields composite `(room_id, business_date)` coverage via the DB-level unique index; board/date lookups continue to use `ix_inventory_days_business_date`. Covered in `test_phase2_data_layer.py`.)*


- [x] Add composite index on `FolioCharge(reservation_id, voided_at)` for cashier folio summary queries *(added `ix_folio_charges_reservation_voided` on 2026-03-20 so front-desk board balance aggregation and public/reporting folio queries no longer rely on the single-column reservation index alone; covered in `test_phase2_data_layer.py`.)*


- [x] Add migration downgrade paths to all migration files that currently only have `upgrade()` *(completed on 2026-03-20: the remaining no-op downgrade in `20260316_01_seed_employee_accounts.py` now removes placeholder internal seed users plus their `user_roles` links, and `test_phase2_data_layer.py` guards against any `def downgrade(): pass` regressions across migration files.)*


- [x] Validate that the SQLite partial indexes (`sqlite_where`) have equivalent PostgreSQL indexes for production *(validated on 2026-03-20 by reconciling model/index declarations with migrations: the only `sqlite_where` indexes in `models.py` are the active-user email/username lookups, and PostgreSQL partial-index coverage now exists via `ix_users_active_email_live` plus `ix_users_active_username_live`; guarded by `test_phase2_data_layer.py` source-level migration parity coverage.)*


- [x] Confirm `PendingAutomationEvent` has a proper expiry/cleanup mechanism to prevent unbounded growth *(processed automation events older than `PENDING_AUTOMATION_RETENTION_DAYS` are now deleted during `process_pending_automations()`; verified in `test_phase18_messaging.py` on 2026-03-19)*


### Reservations


- [x] Add group booking / room block feature (block multiple rooms under one group code) *(front-desk board can now create and release shared-code multi-room blocks using inventory overrides; verified in `test_phase15_front_desk_board.py` on 2026-03-19)*


- [x] Add reservation duplication (clone an existing reservation to a new date range) *(completed on 2026-03-20: reservation detail now exposes a `Duplicate reservation` action that redirects into the existing staff create-reservation form with guest/stay fields prefilled from the source booking, advances the default stay window to the next future slot with the same night count, and annotates the new booking notes with the source reservation code; verified in `test_phase5_staff_reservations_workspace.py` (18 passed, 1 skipped) plus a focused duplicate-flow route test.)*


- [x] Implement auto-cancel for `no_show` reservations not manually processed by end of business day *(`auto_cancel_no_shows()` + CLI + Render cron at 21:00 UTC — done in Phase 3)*


- [x] Add a "pending modifications" indicator on the front desk workspace when an open modification request exists *(batch query + "Mod" badge on board blocks + workspace flags)*


- [x] Show `tentative` reservations on the front desk board so staff can track unconverted inquiries *(verified on 2026-03-20: `front_desk_board_service.py` already includes `tentative` in active board statuses, renders it with the pending visual variant, and `test_phase15_front_desk_board.py` now explicitly covers a tentative reservation appearing on the board; board suite green from the repo root with 70 passed.)*


### Room Inventory


- [x] Validate inventory bootstrap on new room creation — ✅ Verified: `upsert_room` calls `_ensure_room_inventory()` creating 730 days of InventoryDay rows. No rolling cron yet (minor: ~2yr runway).


- [x] Add bulk inventory correction tool for admin (close/open date ranges with reason) *(reconciled on 2026-03-20: the admin rates/inventory surface already exposes inventory override creation with action, room/room-type scope, date range, and reason plus release controls in `admin_rates_inventory.html`; the service flow is backed by `create_inventory_override()` / `release_inventory_override()` and remains verified by `test_phase10_admin_panel.py` (`-k inventory_override`: 1 passed).)*


- [ ] Add room floor plan / photo management to the admin room editor


### Pricing / Rates


- [ ] Add occupancy-based dynamic rate adjustment (if occupancy > 85%, apply +10% override)


- [ ] Add a rate preview / "what would this guest pay" calculator accessible from the front desk


- [x] Add a min-rate floor guard so discounts can never push the rate below cost *(2026-03-22: `hotel.min_nightly_rate` AppSetting + nightly_room_rate clamp)*


- [ ] Add rate cloning/copy tool to the admin rate rules editor


### Guest Records


- [x] Add guest search with fuzzy matching by phone / name *(search_guests() + /staff/guests route)*


- [ ] Add guest profile merge (deduplicate guests who booked under different contact details)


- [x] Add guest visit history view: all reservations linked to this guest profile *(`GET /staff/guests/<id>` + `staff_guest_detail.html` — done in Phase 3)*


- [x] Add guest blacklist / block flag (with reason, for repeated no-shows or property damage) *(2026-03-22: migration, route, UI toggle, check-in guard, front desk warning)*


### Billing / Payments


- [x] Fix potential Stripe webhook idempotency — ✅ Verified: 3-layer protection (provider_event_id unique index + posting_key unique on FolioCharge + SELECT FOR UPDATE). Concurrent threading tests exist.


- [x] Add proforma invoice generation (pre-stay billing preview) *(completed on 2026-03-20: the cashier invoice flow now treats future stays without posted folio charges as a proforma preview, using quoted reservation totals for issued invoice amounts and printable output while preserving the existing invoice document path; verified in `test_phase8_cashier.py` with explicit future-stay proforma coverage and the cashier suite green at 13 passed, 1 skipped.)*


- [ ] Add receipt print/email after manual payment posting


- [x] Add partial refund support (currently refunds are against specific folio lines, but partial amounts on a single charge need validation) *(completed on 2026-03-20: `record_refund()` now validates referenced refund amounts against the remaining refundable amount on that specific folio line, rejects over-refunds on partially refunded charges, and is covered in `test_phase8_cashier.py`; cashier suite green at 13 passed, 1 skipped.)*


- [x] Link folio balance warnings to the front desk board (show overdue balance badge on reservation card) *(verified on 2026-03-20: board blocks already receive aggregated `balanceDue` from `front_desk_board_service.py`, `_front_desk_board_surface.html` renders the `badge-balance` warning on reservation cards when amounts are outstanding, and `test_phase15_front_desk_board.py` now explicitly covers a reservation surfacing a positive balance on the board; board suite green from the repo root with 71 passed.)*


### Check-in / Check-out


- [x] Add explicit "ready for check-in" status flag visible to front desk without navigating into the reservation *(readyForCheckIn flag on board blocks + "Ready" badge)*


- [x] Add early check-in / late check-out fee automation *(implemented in front-desk check-in/out flows; test_phase6_front_desk_workspace.py green — 27 passed, 1 skipped on 2026-03-20)*


| Front-desk / public route contract reconciliation | ✅ Done | Fixed board filter drift, check-in form contract drift, public endpoint-name drift, pre-check-in CSRF exemptions, and sitemap/cache-control endpoint aliases. Full suite green on 2026-03-19. |
| ORM migration completion | Done | `front_desk_board_service.py`, `front_desk_service.py`, `housekeeping_service.py`, `cashier_service.py`, `admin_service.py`, `staff_reservations_service.py`, `public_booking_service.py`, `availability_service.py`, `ical_service.py`, `auth_service.py`, `reporting_service.py`, `messaging_service.py`, `room_readiness_service.py`, `communication_service.py`, `payment_integration_service.py`, `provider_portal_service.py`, `reservation_service.py`, `extras_service.py`, `channel_service.py`, `routes/auth.py`, `routes/provider.py`, `routes/housekeeping.py`, `routes/public.py`, `routes/messaging.py`, `routes/reports.py`, `helpers.py`, `pricing.py`, `routes/staff_reservations.py`, `routes/front_desk.py`, `app.py`, `routes/admin.py`, and `seeds.py` migrated from legacy `.query.` patterns. Remaining `.query.` count in `pms/`: 0. Full suite green on 2026-03-19 (492 passed, 7 skipped). |


- [x] Add guest self-service digital check-out (folio review + balance payment via hosted payment link) *(implemented via `/booking/checkout/<reservation_code>` with token-gated folio review, hosted balance payment handoff, and guarded self-checkout completion; verified in `test_phase4_public_booking.py` (48 passed, 1 skipped), `test_phase6_front_desk_workspace.py` (27 passed, 1 skipped), and `test_phase9_hosted_payments.py` (16 passed, 2 skipped) on 2026-03-20)*


- [x] Validate the `identity_verified` flag is required for check-in completion in production mode *(service-level enforcement now blocks unverified detail, board, and walk-in check-in paths outside testing; verified by test_phase6_front_desk_workspace.py, test_phase13_security_hardening.py, and test_phase15_front_desk_board.py on 2026-03-19)*


### Housekeeping


- [x] Add departure turnover task auto-creation on check-out *(verified wired to `complete_checkout` in Phase 1; test_phase7_housekeeping.py green)*


- [ ] Add housekeeping supervisor inspection workflow (inspect task → pass/fail → re-queue if failed)


- [ ] Add room maintenance request from guest-facing channel (guest reports issue → auto-creates maintenance task)


- [ ] Add shift-based task assignment view for housekeeping supervisor


### Messaging


- [x] Add operator-facing automation rule management *(the admin communications workspace now lists, edits, and creates `AutomationRule` records against existing message templates; verified in `test_phase11_communications.py` on 2026-03-20)*


- [ ] Integrate a direct SMS vendor (Twilio, AWS SNS, or similar) — repo now supports a real outbound webhook adapter via `SMS_OUTBOUND_WEBHOOK_URL`, but a bundled vendor-specific connector is still optional


- [ ] Add inbound email parsing (reply-to-thread feature for email channel)


- [x] Add Line Business API integration for guest-facing messaging *(guest messaging now supports LINE push delivery via `LINE_CHANNEL_ACCESS_TOKEN` with a webhook fallback; verified by targeted adapter coverage in `test_phase18_messaging.py` on 2026-03-20)*


- [x] Add message delivery retry with exponential back-off (currently delivery attempt is single-shot) *(2026-03-22: `retry` status, `next_retry_at` col, 5 max attempts, 2^n backoff)*


- [ ] Add auto-response templates for common guest questions


### Reporting


- [x] Add CSV download to all report pages (occupancy, revenue, booking attribution, cancellations) *(7 types done in Phase 2)*


- [x] Add PDF/print-ready folio export *(print-ready invoice, receipt, folio statement, and proforma invoice templates with hotel branding, tax ID, toolbar, and document-type-specific totals; verified 2026-03-22)*


- [x] Add channel performance report (ADR, reservations, cancellation rate by source channel) *(manager dashboard, daily report, and CSV export now share `channel_performance_report()`; verified in `test_phase12_reporting.py` and `test_phase19_dashboards.py` on 2026-03-19)*


- [x] Add year-over-year comparison view to the occupancy dashboard *(manager dashboard and daily occupancy report now expose prior-year same-window comparison via `occupancy_year_over_year_report()`; verified in `test_phase12_reporting.py` and `test_phase19_dashboards.py` on 2026-03-19)*


- [x] Add a "debtors list" report (all reservations with outstanding balance > 0) *(already satisfied by `folio_balances_outstanding_report()` and the `payment_due` daily report / staff dashboard surfaces; verified in `test_phase12_reporting.py` and `test_phase19_dashboards.py` on 2026-03-19)*


- [x] Add payroll-ready housekeeping performance report (tasks completed per attendant per shift) *(implemented as `housekeeping_performance_report()` with manager dashboard, daily report, and CSV export coverage; rows group task output by business date and assigned attendant while preserving raw timestamps because explicit roster shift codes are not stored yet; verified in `test_phase12_reporting.py`, `test_phase19_dashboards.py`, and `test_phase7_housekeeping.py` on 2026-03-19)*


### Security


- [x] Confirm `AUTH_ENCRYPTION_KEY` setup is documented in the Render deployment runbook *(documented in `docs/DEPLOYMENT-RUNBOOK.md`, `docs/RENDER_DEPLOY_CHECKLIST.md`, and `.env.production.example`; includes Fernet generation guidance and rotation risk note as of 2026-03-20)*


- [x] Add `Content-Security-Policy` nonce for inline scripts where `unsafe-inline` is currently allowed *(per-request CSP nonce added in `pms/security.py`, nonce exposed via template context, inline script surfaces updated, inline DOM handlers removed from audited staff templates, and verified in `test_phase13_security_hardening.py`, `test_phase5_staff_reservations_workspace.py`, `test_phase6_front_desk_workspace.py`, `test_phase7_housekeeping.py`, and `test_phase18_messaging.py` on 2026-03-20)*


- [x] Add audit log retention/archiving policy and database-level partition or cleanup job to prevent unbounded growth *(added `cleanup_audit_logs()` plus `flask --app app cleanup-audit-logs`, Render cron wiring, deploy/env documentation, and an opt-in `AUDIT_LOG_RETENTION_DAYS` control that stays disabled at `0` until a property-approved retention window exists; verified in `test_phase13_security_hardening.py` (31 passed) and `test_deployment_cli.py` (4 passed) on 2026-03-20)*


- [x] Add IP-based rate limit for the SSE endpoint to prevent a single IP from holding multiple workers *(SSE endpoint removed; no longer applicable)*


- [x] Review the `allow_override` permission path on check-in *(route-side checkbox exposure is limited to `admin`/`manager`, service-side `_can_override()` only permits `admin`/`manager`, and coverage now includes non-manager denial plus manager-allowed override in `test_phase6_front_desk_workspace.py` on 2026-03-20)*


### Performance


- [x] Fix the SSE sync-worker blocking issue (highest priority performance concern) *(replaced with JS polling)*


- [x] Add HTTP response caching headers to static assets *(Flask static responses now use `SEND_FILE_MAX_AGE_DEFAULT` from `STATIC_ASSET_MAX_AGE_SECONDS` with a 3600-second default, so `/static/*.css` and `/static/*.js` return `Cache-Control: public, max-age=3600`; verified in `test_phase15_front_desk_board.py` (64 passed) on 2026-03-20)*


- [x] Add query `EXPLAIN` review for the housekeeping board query (loads all rooms with inventory + status + tasks in one pass) *(reviewed against the live 2026-03-20 service path: `list_housekeeping_board()` now issues several focused queries rather than one giant task join. SQLite `EXPLAIN QUERY PLAN` shows indexed lookups for `InventoryDay.business_date` and reservation status/date lookups via `ix_inventory_days_business_date` and `ix_reservations_status_dates`; `room_notes` uses `ix_room_notes_room_business_date`; only the small `rooms` ordering query remains a table scan with temp sort, which is acceptable at the current 32-room seed size.)*


- [x] Consider caching the `current_settings()` result in `g` per-request to avoid repeated `AppSetting.query` hits on every templated page *(helper now memoizes settings on `g._current_settings_cache` for the life of the request/app context, preserving behavior while avoiding duplicate `AppSetting` queries from repeated template/context access; verified in `test_base_header_nav.py` (3 passed) on 2026-03-20)*


### Accessibility


- [x] Add `aria-label` to icon-only buttons throughout the front desk and housekeeping boards *(density toggle buttons labeled)*


- [x] Ensure all status badges have text equivalents (not colour-only) *(audited on 2026-03-20 across the current badge-bearing templates: front-desk board/status badges, messaging channel/status/follow-up badges, reservation/front-desk message badges, and housekeeping/operational pills all render visible text labels such as `Ready`, `Mod`, channel names, spelled-out statuses, and balance amounts instead of relying on colour alone.)*


- [x] Add skip-navigation link to staff pages *(confirmed in `templates/base.html`; guardrail tests pass)*


- [x] Audit form error states for screen reader compatibility (`aria-describedby` on error messages) *(audited and tightened on 2026-03-20: the active inline field-error surface is the front-desk check-in form, which now links `aria-invalid` fields to their inline error/hint copy via `aria-describedby` for first name, last name, phone, room assignment, payment amount, and override-payment validation. Verified in `test_phase6_front_desk_workspace.py` (27 passed, 1 skipped).)*


### QA / Testing


- [x] Investigate and migrate/delete 4 root-level test files (`debug_test.py`, `test_demo_seeding.py`, `test_init_and_seed.py`, `test_template_compile.py`) *(deleted in root cleanup)*


- [x] Add tests covering the pricing module (`pricing.py`) — `quote_reservation` and `nightly_room_rate` have zero direct test coverage *(16 tests in test_pricing.py)*


- [x] Add tests for `channel_service.py` mock provider operations *(already covered in `test_availability_and_channel.py`; verified green on 2026-03-20 with 21 passed.)*


- [x] Add a test for the `PendingAutomationEvent` processing flow *(delayed-event queue, due-event dispatch, inactive-rule skip, idempotency, retention cleanup, and CLI processing covered in `test_phase18_messaging.py` on 2026-03-19)*


- [x] Add integration test for `LocalStorageBackend` round-trip (save → read → serve) *(covered on 2026-03-20 in `test_phase17_pre_checkin.py`: local backend upload writes to configured `UPLOAD_DIR`, `read_document_bytes()` returns the original bytes, and `get_document_serve_url()` returns `None` for direct app serving.)*


- [x] Add load/regression tests for availability queries with 200+ inventory days *(added a 210-night seeded availability regression in `test_availability_and_channel.py` using `INVENTORY_BOOTSTRAP_DAYS=240`, asserting long-horizon `query_room_type_availability()` and `count_available_rooms()` stay consistent; verified green on 2026-03-20 with 21 passed.)*


- [x] Add test that verifies SSE endpoint returns correct Content-Type (already skipped — un-skip after SSE fix) *(SSE removed; test updated to assert endpoint gone)*


### Deployment / DevOps


- [x] Add Render Cron Job entries for: `process-notifications` (every 5 min), `send-pre-arrival-reminders` (daily 09:00), `send-failed-payment-reminders` (daily 10:00), `sync-ical-sources` (every 15 min), `process-automation-events` (every 5 min), `fire-pre-checkin-reminders` (daily ~48h before target check-in) *(all 6 added)*


- [x] Fix ephemeral storage: add Render Disk or configure S3 env vars in `render.yaml` *(documented with commented-out config)*


- [x] Set `MAX_CONTENT_LENGTH` correctly in `.env.production.example` (currently `1048576` = 1 MB, but `pre_checkin_service` allows 10 MB uploads — this mismatch would silently reject document uploads in production) *(set to 12582912)*


- [x] Add a health check endpoint response time SLA (current `/health` returns 200 but has no DB liveness check) *(reconciled and completed on 2026-03-20: `/health` already had DB liveness via `SELECT 1`; the remaining gap was explicit response-budget reporting. The endpoint now returns `db`, `response_ms`, `sla_ms`, and `within_sla`, with `HEALTHCHECK_SLA_MS` defaulting to 1000, and coverage added in `test_deployment_cli.py`.)*


- [x] Add a `python -m flask db current` step to the deploy runbook to verify migration state before go-live *(added explicit `flask --app app db current` verification guidance to `docs/DEPLOYMENT-RUNBOOK.md` and `docs/RENDER_DEPLOY_CHECKLIST.md` on 2026-03-20)*


- [x] Add Sentry (or equivalent) error tracking via environment variable *(SENTRY_DSN, SENTRY_ENVIRONMENT=production, SENTRY_RELEASE set on Render 2026-03-22; deploy dep-d6vn7jp4tr6s73dnlhdg went live; end-to-end verified via POST /staff/admin/test-error raising RuntimeError("Sentry verification test") — event confirmed in Sentry with request_id tag; "Trigger Sentry test error" button added to admin_operations page for repeatability)*


- [x] Clean up 30+ stale root-level markdown files — move permanent docs to `docs/`, delete session artifacts *(28 files deleted, 4 moved)*


### Admin / Settings


- [x] Add bulk notification template reset-to-defaults action *(2026-03-22: `reset_notification_templates_to_defaults()` service function + `reset_templates_to_defaults` admin route action + button on operations page with confirmation dialog; verified in `test_phase10_admin_panel.py`)*


- [x] Add admin UI for managing `PendingAutomationEvent` queue (view queued events, manually trigger, clear stuck events) *(2026-03-22: `list_pending_automation_events()` + `cancel_pending_automation_event()` service functions, `process_automation_queue` and `cancel_automation_event` admin actions, queue table with cancel buttons on communications page; verified in `test_phase11_communications.py`)*


- [x] Add admin UI for `BookingExtra` configuration (add-ons like breakfast, airport transfer) *(already implemented on `/staff/admin/property` page with full CRUD via `extras_service.py`; verified in `test_phase10_admin_panel.py` on 2026-03-22)*


- [x] Add calendar blackout period conflict checker (warn if blackout overlaps confirmed reservations) *(2026-03-22: upsert_blackout_period returns conflict count, admin route flashes warning)*

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


- [x] Investigate and resolve `FEATURE_BOARD_V2` flag — document or remove *(completed on 2026-03-20: dead env/config flag and startup gate removed; board action surface remains always on)*


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


- [x] Add proforma invoice and receipt generation *(2026-03-22: enhanced `cashier_print.html` with hotel letterhead, address, phone, email, tax ID; type-specific layout for proforma invoice (disclaimer, estimated totals), invoice, receipt, and folio statement; print toolbar with Print/Save PDF + Close buttons; `hotel_tax_id` added to `inject_globals`; Print invoice and Print receipt quick-access buttons added to cashier folio header; all 15 cashier tests pass)*


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


**Status: COMPLETE (2026-03-19)**


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
| Flask Blueprint extraction — `admin_bp` | ✅ Done | 10 routes extracted (`/staff/admin/*`) |
| Flask Blueprint extraction — `front_desk_bp` (incl. board routes) | ✅ Done | 24 routes extracted (`/staff/front-desk/*`, board events, walk-in) |
| Flask Blueprint extraction — `public_bp` | ✅ Done | 14 routes extracted (`/`, `/book/*`, `/checkin/*`, `/contact`) |
| Front desk board density persistence | ✅ Done | `UserPreference` persistence confirmed; test_phase15_front_desk_board.py (63 passed, 2026-03-19) |
| Keyboard shortcuts — check-in / room assignment | ✅ Done | Verified passing in test_phase15_front_desk_board.py (63 passed, 2026-03-19) |
| Early check-in / late check-out fee automation | ✅ Done | Implemented in front-desk check-in/out flows; test_phase6_front_desk_workspace.py green (27 passed, 1 skipped, 2026-03-20) |
| Identity verification required for production check-in | Done | Service-level enforcement now blocks unverified detail, board, and walk-in check-in paths outside testing; verified by `test_phase6_front_desk_workspace.py` (27 passed, 1 skipped), `test_phase13_security_hardening.py` (30 passed), and `test_phase15_front_desk_board.py` (63 passed) on 2026-03-20. |
| Mobile-optimised housekeeping attendant view | Done | Added dedicated `?view=mobile` housekeeping cards, preserved date/filter/view toggles, and touch-friendly room-status quick actions; verified in `test_phase7_housekeeping.py` (13 passed, 1 skipped) on 2026-03-19. |
| Group booking / room block feature | Done | Shared-code multi-room block creation and release now runs from the front-desk board using inventory overrides; verified in `test_phase15_front_desk_board.py` (63 passed) on 2026-03-19. |
| Guest self-service digital check-out | Done | Added token-gated public folio review, hosted balance-payment handoff, and self-service checkout completion for fully settled stays; verified in `test_phase4_public_booking.py` (48 passed, 1 skipped), `test_phase6_front_desk_workspace.py` (27 passed, 1 skipped), and `test_phase9_hosted_payments.py` (16 passed, 2 skipped) on 2026-03-20. |
| Front-desk / public route contract reconciliation | ✅ Done | Fixed board filter drift, check-in form contract drift, public endpoint-name drift, pre-check-in CSRF exemptions, and sitemap/cache-control endpoint aliases. Full suite green on 2026-03-20 (511 passed, 7 skipped). |
| ORM migration completion | Done | `front_desk_board_service.py`, `front_desk_service.py`, `housekeeping_service.py`, `cashier_service.py`, `admin_service.py`, `staff_reservations_service.py`, `public_booking_service.py`, `availability_service.py`, `ical_service.py`, `auth_service.py`, `reporting_service.py`, `messaging_service.py`, `room_readiness_service.py`, `communication_service.py`, `payment_integration_service.py`, `provider_portal_service.py`, `reservation_service.py`, `extras_service.py`, `channel_service.py`, `routes/auth.py`, `routes/provider.py`, `routes/housekeeping.py`, `routes/public.py`, `routes/messaging.py`, `routes/reports.py`, `helpers.py`, `pricing.py`, `routes/staff_reservations.py`, `routes/front_desk.py`, `app.py`, `routes/admin.py`, and `seeds.py` migrated from legacy `.query.` patterns. Remaining `.query.` count in `pms/`: 0. Full suite green on 2026-03-20 (511 passed, 7 skipped). |
| Messaging automation queue processing | Done | `process_pending_automations()` and the `process-automation-events` CLI now have direct delayed-event coverage plus processed-row retention cleanup in `test_phase18_messaging.py` (60 passed on 2026-03-19). |
| Departure turnover task auto-wiring | ✅ Done | Verified wired to `complete_checkout`; confirmed in Phase 1 review |
| Staff skip-navigation link | ✅ Done | Confirmed in `templates/base.html`; guardrail tests pass |


**Results:** `app.py` reduced from 5,923 -> 1,356 lines (-4,567 lines, all 10 Blueprints extracted + service layer delegation). All blueprint route groups now extracted: auth, provider, housekeeping, messaging, cashier, reports, staff_reservations, admin, front_desk (incl. board), public. Remaining in `app.py`: `create_app()` factory wiring, shared helpers, CLI registration. Current full-suite baseline: 511 passed, 7 skipped (2026-03-20).


**Reconciled update (2026-03-19):**


- `front_desk_bp`, `admin_bp`, and `public_bp` are already extracted and registered in `create_app()`; the earlier blueprint-extraction backlog entry is stale.


- Front-desk board density persistence and keyboard shortcuts are verified by `test_phase15_front_desk_board.py` (`63 passed` on 2026-03-19).


- Staff skip-link / accessibility baseline remains in place via `templates/base.html`, and the existing guardrail coverage still passes.


- Early / late fee handling is implemented in front-desk check-in/out flows; `test_phase6_front_desk_workspace.py` is green (`27 passed, 1 skipped` on 2026-03-20).


- Production check-in identity verification now requires either an existing verified identity record or a fresh verification flag at the service layer; targeted front-desk and security validation is green (`test_phase6_front_desk_workspace.py`, `test_phase13_security_hardening.py`, `test_phase15_front_desk_board.py` on 2026-03-19).


- Housekeeping now has a dedicated `?view=mobile` attendant surface with card-based room summaries, touch-sized status actions, and view-preserving navigation; `test_phase7_housekeeping.py` is green (`13 passed, 1 skipped` on 2026-03-19).


- Group room blocks can now be created and released from the front-desk board under a shared code, using inventory overrides instead of fake reservations; `test_phase15_front_desk_board.py` is green (`63 passed` on 2026-03-19).


- Public digital checkout now supports token-gated folio review, hosted balance-payment handoff, and guarded self-checkout completion when no balance, refund, or late-fee decision remains; `test_phase4_public_booking.py`, `test_phase6_front_desk_workspace.py`, and `test_phase9_hosted_payments.py` are green on 2026-03-19.


- Messaging automation queue processing is verified end-to-end in `test_phase18_messaging.py`; `process_pending_automations()` now also prunes processed rows older than `PENDING_AUTOMATION_RETENTION_DAYS` to prevent unbounded queue growth.


**Remaining to-dos:**


- None - Phase 3 exit criteria are met and the next active backlog shifts to Phase 4 reporting/integration work.


**Dependencies:** Phase 2 stable.


**Success criteria:**


- `pms/app.py` stays below 2,000 lines while the remaining operational backlog lands


- Front desk operations measurably faster (fewer page loads for common actions)


- Housekeeping attendant can use the app on a tablet without layout issues

---

### Phase 4 — Admin / Reporting / Integrations (Sprint 11–15)


**Status: ✅ COMPLETE (2026-03-22)**


**Objective:** Give management the data they need and open external connectivity.


**Why this phase:** Management decisions and OTA channel growth depend on this layer.


**To-dos:**


- Channel performance report and year-over-year comparison complete *(manager dashboard, daily report view, and CSV export verified in `test_phase12_reporting.py` and `test_phase19_dashboards.py` on 2026-03-19)*


- Debtors/outstanding-balance report complete *(covered by `folio_balances_outstanding_report()` and the `payment_due` daily report / staff dashboard surfaces; verified in `test_phase12_reporting.py` and `test_phase19_dashboards.py` on 2026-03-19)*


- SMS outbound adapter depth improved *(repo now supports `SMS_OUTBOUND_WEBHOOK_URL`; direct vendor-specific Twilio/SNS connector still optional)*


- Line Business API integration for guest messaging complete *(via `LINE_CHANNEL_ACCESS_TOKEN` with webhook fallback; targeted adapter coverage added in `test_phase18_messaging.py` on 2026-03-20)*


- OTA channel push adapter complete *(generic `WebhookChannelProvider` added for inventory/rate pushes through an external channel bridge; verified in `test_availability_and_channel.py` on 2026-03-20)*


- Automation rule editor complete *(admin communications now manages seeded and custom `AutomationRule` records; verified in `test_phase11_communications.py` on 2026-03-20)*


- Revenue management dashboard complete for beta pacing needs *(ADR, RevPAR, room-type mix, and channel pacing now surface in the manager dashboard and `revenue_management` daily report; verified in `test_phase12_reporting.py` and `test_phase19_dashboards.py` on 2026-03-20. Forecast automation remains backlog.)*


- Add Sentry error tracking *(initial DSN/config wiring, request-id tagging, and local tests are in place; live DSN provisioning and runtime capture verification still pending)*


- CSP nonce hardening complete *(per-request nonce in `pms/security.py`, inline script nonce coverage across staff/public templates, shared `app-actions.js` replacing audited inline handlers, and targeted verification green on 2026-03-20: `test_phase13_security_hardening.py` 30 passed, `test_phase5_staff_reservations_workspace.py` 17 passed/1 skipped, `test_phase6_front_desk_workspace.py` 27 passed/1 skipped, `test_phase7_housekeeping.py` 13 passed/1 skipped, `test_phase18_messaging.py` 60 passed)*


- Audit log archival/cleanup job complete *(added `cleanup_audit_logs()` plus `flask --app app cleanup-audit-logs`, Render cron wiring, deploy/env documentation, and an opt-in `AUDIT_LOG_RETENTION_DAYS` guard so cleanup remains disabled until the property chooses a retention window; verified in `test_phase13_security_hardening.py` (31 passed) and `test_deployment_cli.py` (4 passed) on 2026-03-20)*


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


- HTTP caching headers for static assets complete *(Flask static responses now use `SEND_FILE_MAX_AGE_DEFAULT` from `STATIC_ASSET_MAX_AGE_SECONDS` with a 3600-second default; verified in `test_phase15_front_desk_board.py` (64 passed) on 2026-03-20)*


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


**Current state (2026-03-20):** All eight critical-path code items above are implemented in-repo. The remaining production follow-through is live Render verification: confirm the cron services are enabled and succeeding, confirm `/health` is green against the deployed DB, confirm the disk is mounted/writable and uploaded documents survive restart, and spot-check board polling latency under concurrent staff use.

---

## 7) Quick Wins


Historical quick wins from the first audit pass. These are no longer the active work queue.


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


**Current state (2026-03-20):** QW-1 through QW-11 are complete in the repository. The only remaining follow-through in this area is live-environment verification of the Render cron jobs, persistent disk, deployed `/health` response, and board polling latency.

---

## 8) Hidden Risks and Technical Debt


**R-01 - Live Render verification remains the top operational risk**  


The repo defines the persistent disk, cron jobs, `/health`, and polling board transport, but the deployment still needs live confirmation. This is the most important blocker before a beta-ready claim.


**R-02 - Sentry wiring exists but observability is not signed off yet**  


`SENTRY_DSN` support is in the codebase, but until a live DSN is provisioned and one real event is observed with request context, runtime monitoring remains incomplete.


**R-03 - Large extracted route/service modules are now the main maintainability debt**  


`app.py` is no longer the dominant hotspot. The next refactor targets should be `routes/front_desk.py`, `reporting_service.py`, `admin_service.py`, `staff_reservations_service.py`, `front_desk_board_service.py`, and `housekeeping_service.py`, all with behavior-preserving, test-led splits.


**R-04 - DB-backed rate limiting is acceptable for beta but not ideal for scale**  


The current indexed DB-count approach is workable for a low-volume beta, but if public booking traffic or board polling grows materially, Redis-backed counters should move up the queue.


**R-05 - Export and adapter scope still needs a product decision**  


CSV exports and webhook-backed outbound adapters are sufficient for beta by default. PDF exports, direct vendor adapters, and first-class LINE guest identifiers should only be promoted if the business requires them before launch.

---

## 9) Open Questions / Assumptions


| # | Question / Assumption |
|---|---|
| Q-01 | **FEATURE_BOARD_V2**: Resolved on 2026-03-20. The dead env/config flag and startup gate were removed; only a compatibility helper remains, always returning `True` for existing template/log consumers. |
| Q-02 | **Single-tenant assumption**: The data model has no `property_id` or tenant discriminator on any operational entity. The entire schema is single-property. Is multi-property support in scope? If so, this requires an architectural change before the data model grows further. |
| Q-03 | **Render disk vs. S3**: The deployment blueprint now includes a persistent disk and defaults to `STORAGE_BACKEND=local`. Remaining question is live provisioning: confirm the chosen Render plan has the disk attached and writable, or switch to S3/R2 before launch. |
| Q-04 | **Stripe live credentials**: The `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are `sync: false` in `render.yaml`. Has a live Stripe account been connected, or is the property still using `PAYMENT_PROVIDER=disabled`? This determines urgency of the Stripe idempotency fix (F-04). |
| Q-05 | **OCR provider intent**: Is OCR ID extraction a committed product feature or a speculative placeholder? If committed, what provider (AWS Textract, Google Vision, Mindee) is preferred? |
| Q-06 | **Automation rules**: Seed data is present and the admin communications workspace now exposes an automation-rules editor. Remaining gap is higher-order queue management UX and retry policy, not rule creation/editing. |

---

## 10) Final Recommended Build Order


The following is the revised ordered sequence from the current codebase state to beta-ready deployment confidence:


1. Verify the live Render web service disk is mounted at `/var/data/uploads/documents`, writable, and retains uploaded documents across restart.


2. Verify `/health` on the deployed service returns `db: "ok"` with `within_sla: true`.


3. Verify every live Render cron service is enabled and succeeding (`pms-process-notifications`, automation, iCal sync, reminder jobs, waitlist, audit cleanup, no-show handling).


4. Measure front-desk board `refreshSurface()` latency under concurrent staff use and tune the 10-second poll interval if live traffic shows overlap or sluggishness.


5. Provision a real `SENTRY_DSN` and verify end-to-end runtime capture on the deployed service.


6. Keep revenue management, CSV exports, and webhook-backed outbound adapters as the beta baseline unless a named stakeholder requires more before launch.


7. Decide whether beta readiness requires PDF / print-ready report exports beyond the now-complete CSV exports.


8. Decide whether the generic webhook-backed SMS / WhatsApp / LINE / OTA adapters are sufficient for beta, or replace them with direct vendor-specific adapters before launch.


9. Add Redis-backed rate limiting if public booking traffic or board polling volume outgrows the current DB-backed approach.


10. Split the remaining large route/service hotspots after beta blockers are closed, starting with `routes/front_desk.py`.


11. Treat multi-property scaffolding, loyalty, POS, ID scanner hardware, and guest-survey automation as post-beta expansion unless a launch stakeholder elevates them sooner.


