# Sandbox PMS — Launch Readiness & Action Plan

**Date:** 2026-03-28
**Audit Method:** Static codebase analysis (READ-ONLY, no runtime verification)
**Companion Reports:** Executive Project Report, System Architecture Audit, Product Specification Audit

---

## 1. Launch Readiness Classification

### Verdict: **Near-Launch with Caution — Internal Pilot Ready**

The system has genuine production-grade architecture, deep operational workflows, and strong security posture. It is not a prototype or scaffold — it is a real, full-featured hotel PMS. However, it has **never been deployed to production**, and several operationally critical subsystems remain unverified at runtime.

**What this means:** Sandbox PMS can be deployed to a staging or internal pilot environment today. A controlled soft-launch with limited real guests is achievable within 1-2 weeks of focused operational verification. A full public launch requires payment activation and confirmed email delivery.

---

## 2. Launch Blockers (Must Fix Before Any Guest Traffic)

These items prevent safe operation with real guests and real money.

### B1. No Verified Production Deployment
- **What:** The `render.yaml` Blueprint is well-specified but has never been confirmed running. No evidence of a successful deploy exists.
- **Why it matters:** Unknown failures in migrations, env var binding, persistent disk, or worker startup would cause immediate downtime.
- **Affected files:** `render.yaml`, `sandbox_pms_mvp/pms/config.py`, `sandbox_pms_mvp/pms/security.py`
- **Resolution:** Deploy to Render. Confirm health check passes, Alembic migrations complete, seed data loads, and all 9 cron services start. The README lists 5 specific verification items.
- **Effort:** 2-4 hours of manual verification
- **Launch impact:** Total blocker — no deploy, no system

### B2. Payment Provider is Disabled
- **What:** `PAYMENT_PROVIDER=disabled` in `render.yaml`. Stripe integration code exists and is tested, but no real Stripe keys are configured.
- **Why it matters:** The hotel cannot collect deposits, process online payments, or reconcile hosted payment requests. The full cashier and booking confirmation flow is degraded.
- **Affected files:** `render.yaml` (env var), `services/payment_integration_service.py` (1,265 lines), `test_phase9_hosted_payments.py`
- **Resolution:** Obtain Stripe API keys (publishable + secret) and webhook secret. Set `PAYMENT_PROVIDER=stripe`. Configure Stripe webhook endpoint pointing to `/payment/webhook`. Verify with a test payment.
- **Effort:** 2-4 hours (Stripe account setup + configuration + live test)
- **Launch impact:** Total blocker for revenue collection

### B3. Email Delivery Unverified
- **What:** SMTP configuration exists (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`) but no evidence of live email delivery.
- **Why it matters:** Booking confirmations, pre-check-in links, password resets, and guest communications all depend on email. Silent failures here mean guests never receive critical information.
- **Affected files:** `services/communication_dispatch.py`, `services/communication_queue.py`, `render.yaml`
- **Resolution:** Configure SMTP credentials. Send test emails to verify delivery, subject rendering, and template formatting. Confirm the `process-notifications` cron dispatches queued emails.
- **Effort:** 1-2 hours
- **Launch impact:** Blocker for guest communications

### B4. Persistent Disk Write/Read Unverified
- **What:** `render.yaml` declares a 1 GB persistent disk at `/var/data/uploads/documents`. No evidence it survives deployments.
- **Why it matters:** Guest document uploads (passport, ID) from pre-check-in are stored on this disk. If the disk doesn't persist across deploys, uploaded documents are lost.
- **Affected files:** `render.yaml`, `services/storage.py`, `services/pre_checkin_service.py`
- **Resolution:** Deploy, upload a file, redeploy, confirm file persists. If disk persistence is unreliable, activate S3 storage backend (already implemented: `S3StorageBackend` in `storage.py`).
- **Effort:** 1 hour
- **Launch impact:** Blocker for pre-check-in document workflow

### B5. Cron Job Execution Unverified
- **What:** 9 Render cron services declared but never confirmed running. These handle: notification dispatch, automation events, iCal sync, pre-arrival reminders, payment reminders, pre-check-in reminders, no-show processing, waitlist processing, hold expiry.
- **Why it matters:** Without cron jobs, time-delayed automations, expired holds, and notification dispatch silently fail.
- **Affected files:** `render.yaml`, `sandbox_pms_mvp/pms/app.py` (CLI commands)
- **Resolution:** Deploy all cron services. Trigger each CLI command manually (`flask process-notifications`, `flask process-automation-events`, etc.) and confirm output. Then verify scheduled execution via Render logs.
- **Effort:** 2-3 hours
- **Launch impact:** Blocker for all background automation

---

## 3. High-Priority Non-Blockers (Fix Before Soft-Launch)

These don't prevent deployment but significantly affect operational quality.

### H1. Sentry Error Monitoring Not Configured
- **What:** `SENTRY_DSN` env var is referenced in `app.py` but no DSN is set.
- **Why it matters:** Without error monitoring, production exceptions are invisible, and debugging relies on Render log tailing.
- **Affected files:** `pms/app.py` (Sentry init), `render.yaml`
- **Resolution:** Create Sentry project, set `SENTRY_DSN` env var.
- **Effort:** 30 minutes

### H2. Rate Limiting is In-Process Only
- **What:** `rate_limiter.py` (158 lines) uses in-memory state. With 2 Gunicorn workers, rate limits are per-worker, not global.
- **Why it matters:** Attackers can bypass rate limiting by hitting different workers. Under load, duplicate booking attempts may slip through.
- **Affected files:** `services/rate_limiter.py`
- **Resolution:** Accept as a known limitation for initial launch (low-traffic boutique hotel). Plan Redis-backed rate limiting for post-launch.
- **Effort:** N/A for now (accept risk)

### H3. Admin Default Password Must Be Changed
- **What:** `ADMIN_PASSWORD` is set via env var. If production uses a weak or reused value, the admin account is vulnerable.
- **Why it matters:** The admin account has all 39 permission codes.
- **Resolution:** Set a strong, unique password and change it on first login. Consider enabling MFA for all admin accounts.
- **Effort:** 15 minutes

### H4. Gunicorn Worker Configuration
- **What:** 2 sync workers. Long-running requests (iCal imports from slow external servers, Stripe webhook retries) block worker threads.
- **Why it matters:** A slow external iCal source can exhaust both workers, making the PMS unresponsive.
- **Affected files:** `render.yaml` (start command)
- **Resolution:** Increase `WEB_CONCURRENCY` to 4 (if plan allows). Consider `--timeout 60` to kill hung workers. Long-term: evaluate gevent or async workers.
- **Effort:** 15 minutes to adjust, monitor for impact

### H5. File Magic Byte Validation
- **What:** Document upload validates extension and MIME type but not file magic bytes.
- **Why it matters:** A file with `.jpg` extension and `image/jpeg` MIME type containing executable content would pass. Risk is low since only authenticated staff view files.
- **Affected files:** `services/pre_checkin_service.py`
- **Resolution:** Add `python-magic` or PIL header validation for uploaded images. Low priority given the restricted audience.
- **Effort:** 1-2 hours

---

## 4. Medium-Priority Cleanup (Post-Launch Hardening)

### M1. Decompose `app.py` (1,683 lines)
- **What:** Still contains template helpers (~200 lines), context processors, CLI commands (~300 lines), auth hooks, and legacy route helpers alongside the factory.
- **Why it matters:** Difficult to maintain and test in isolation. Changes risk unintended side effects.
- **Affected files:** `pms/app.py`, `pms/helpers.py`
- **Resolution:** Extract CLI commands to `pms/cli.py`, template helpers to `pms/template_helpers.py`, auth hooks to `pms/auth_hooks.py`.
- **Effort:** 4-6 hours

### M2. Decompose Large Service Files
- **What:** `front_desk_board_service.py` (1,749), `reporting_service.py` (1,727), `staff_reservations_service.py` (1,706), `housekeeping_service.py` (1,667), `admin_service.py` (1,671) are all >1,600 lines.
- **Why it matters:** Cognitive load when modifying any single service; risk of merge conflicts.
- **Resolution:** The codebase already uses a partial decomposition pattern (e.g., `admin_service.py` + `admin_inventory_ops.py` + `admin_settings_ops.py` + `admin_content_ops.py`). Apply the same pattern to other large services.
- **Effort:** 8-12 hours total

### M3. Add Integration Test for Full Deploy Lifecycle
- **What:** Tests run against SQLite in-memory DB. No test verifies the full Alembic migration chain against PostgreSQL.
- **Why it matters:** Migration ordering issues, PostgreSQL-specific syntax, or constraint differences hit only in production.
- **Resolution:** Add a CI job that runs `flask db upgrade` against a PostgreSQL container, followed by seed data loading and a health check.
- **Effort:** 4-6 hours

### M4. Reservation State Machine Enforcement
- **What:** The status progression (inquiry → confirmed → checked_in → checked_out) is implicit. Any service can write any status.
- **Why it matters:** A bug in one service could transition a reservation to an invalid state.
- **Affected files:** `models.py:Reservation`, `services/reservation_service.py`
- **Resolution:** Add a `validate_status_transition(current, new)` method to the Reservation model or service layer. Enforce allowed transitions.
- **Effort:** 2-3 hours

### M5. Remove Stale `.db` Files from Repo
- **What:** 23 stale SQLite `.db` files exist across the repo root and `sandbox_pms_mvp/`.
- **Why it matters:** Bloats clone size, confuses new developers.
- **Resolution:** Delete `.db` files, add `*.db` to `.gitignore`.
- **Effort:** 15 minutes

### M6. Background Task Queue
- **What:** No Celery/RQ/ARQ. All async work runs via Render cron at 5-15 min intervals.
- **Why it matters:** Pre-check-in email delivery, payment confirmation, and iCal sync have up to 15-minute latency. For a boutique hotel this is acceptable initially, but not ideal.
- **Resolution:** Evaluate adding a lightweight task queue (e.g., `rq` with Redis) for real-time operations. Cron can continue for scheduled batch work.
- **Effort:** 16-24 hours (significant architectural addition)

---

## 5. Future Enhancements (Strategic, Post-Stabilization)

### F1. Real OTA Channel Adapters
- **What:** Only `MockChannelProvider` and `ICalChannelProvider` exist. No Booking.com, Expedia, or Agoda API integration.
- **Why it matters:** The hotel cannot receive bookings from major distribution channels without manual re-entry.
- **Affected files:** `services/channel_service.py`
- **Effort:** 40-80 hours per channel (API integration, rate push, reservation import, error handling)

### F2. SMS/LINE/WhatsApp Delivery
- **What:** SMS/LINE/WhatsApp channels defined in constants and message model, but delivery adapters are stubs.
- **Why it matters:** Thai hospitality commonly uses LINE for guest communication.
- **Affected files:** `services/sms_provider.py`, `services/sms_twilio_adapter.py`
- **Effort:** 8-16 hours per channel

### F3. POS System Integration
- **What:** `pos_adapter.py` is a scaffold with `NullPosAdapter`.
- **Why it matters:** Cafe and restaurant charges must be posted to room folios manually.
- **Effort:** 16-24 hours (depends on POS system API)

### F4. OCR Document Processing
- **What:** `suggest_ocr_extraction()` returns `None`. Column exists in DB.
- **Why it matters:** Staff must manually verify passport/ID data; OCR would speed pre-check-in processing.
- **Effort:** 8-16 hours (cloud OCR API integration + staff review workflow)

### F5. Loyalty Program Integration
- **What:** `loyalty_service.py` (192 lines) has tier/points logic, `GuestLoyalty` model exists, but no integration into booking flow.
- **Why it matters:** Loyalty incentives increase direct bookings, which have lower commission costs than OTA bookings.
- **Effort:** 8-12 hours

### F6. CDN for Static Assets
- **What:** Static files served directly by Gunicorn.
- **Why it matters:** Adds latency, consumes worker time. CDN would improve page load speed.
- **Resolution:** Configure Render CDN or Cloudflare in front of static assets.
- **Effort:** 2-4 hours

### F7. Multi-Property Support
- **What:** `Property` model exists but system assumes single property throughout.
- **Why it matters:** Only relevant if the hotel group expands.
- **Effort:** 40-80 hours (pervasive query filtering changes)

---

## 6. Prioritized Action Plan

### Phase 1: Launch Verification (Week 1) — Critical Blockers

| # | Action | Effort | Items Resolved |
|---|--------|--------|----------------|
| 1.1 | Deploy to Render, verify health check + migrations | 2-4h | B1 |
| 1.2 | Configure SMTP, send test emails, verify cron dispatch | 1-2h | B3 |
| 1.3 | Upload file, redeploy, confirm persistence (or activate S3) | 1h | B4 |
| 1.4 | Trigger all 9 cron CLI commands, confirm execution | 2-3h | B5 |
| 1.5 | Set up Sentry project, configure DSN | 30m | H1 |
| 1.6 | Set strong admin password, enable MFA | 15m | H3 |
| 1.7 | Increase Gunicorn workers to 4, add timeout | 15m | H4 |

**Estimated total: 1-2 days**

### Phase 2: Payment Activation & Soft-Launch (Week 2)

| # | Action | Effort | Items Resolved |
|---|--------|--------|----------------|
| 2.1 | Set up Stripe account, configure keys + webhook | 2-4h | B2 |
| 2.2 | Process end-to-end test booking with real payment | 1-2h | B2 validation |
| 2.3 | Create staff training walkthrough for core workflows | 4-6h | Operational readiness |
| 2.4 | Run soft-launch with a small number of test bookings | Ongoing | All blockers |

**Estimated total: 2-3 days**

### Phase 3: Post-Launch Hardening (Weeks 3-4)

| # | Action | Effort | Items Resolved |
|---|--------|--------|----------------|
| 3.1 | Decompose `app.py` into focused modules | 4-6h | M1 |
| 3.2 | Add PostgreSQL integration test in CI | 4-6h | M3 |
| 3.3 | Add reservation state transition validation | 2-3h | M4 |
| 3.4 | Clean `.db` files, update `.gitignore` | 15m | M5 |
| 3.5 | Add file magic byte validation for uploads | 1-2h | H5 |
| 3.6 | Decompose largest service files | 8-12h | M2 |

**Estimated total: 1-2 weeks part-time**

### Phase 4: Strategic Feature Expansion (Month 2+)

| # | Action | Effort | Items Resolved |
|---|--------|--------|----------------|
| 4.1 | Add background task queue (rq + Redis) | 16-24h | M6 |
| 4.2 | LINE messaging adapter | 8-16h | F2 |
| 4.3 | Static asset CDN | 2-4h | F6 |
| 4.4 | First OTA channel adapter (Booking.com or Agoda) | 40-80h | F1 |
| 4.5 | POS integration | 16-24h | F3 |
| 4.6 | OCR document processing | 8-16h | F4 |
| 4.7 | Loyalty program integration | 8-12h | F5 |

---

## 7. File-Level Evidence Appendix

### Architecture Core
| File | Lines | Why It Matters |
|---|---|---|
| `sandbox_pms_mvp/pms/app.py` | 1,683 | App factory, auth hooks, template helpers, CLI commands. Central nervous system of the application. |
| `sandbox_pms_mvp/pms/config.py` | 179 | All 70+ config keys with env var binding and defaults. Controls every runtime behavior. |
| `sandbox_pms_mvp/pms/security.py` | 394 | Production fail-fast checks, CSP, HSTS, host validation, error handlers. Security gate. |
| `sandbox_pms_mvp/pms/extensions.py` | 6 | `db` and `migrate` singletons shared across all modules. |
| `sandbox_pms_mvp/pms/constants.py` | 440 | All status enums, permission seeds, role seeds. Single source of truth for domain constants. |
| `sandbox_pms_mvp/pms/permissions.py` | 36 | Permission check logic and default dashboard routing. |
| `sandbox_pms_mvp/pms/models.py` | 2,208 | 50+ SQLAlchemy models. The complete domain schema including constraints and event listeners. |

### Deployment
| File | Lines | Why It Matters |
|---|---|---|
| `render.yaml` | 337 | Complete Render Blueprint: web service, 9 crons, PostgreSQL, persistent disk, custom domains, all env vars. |
| `requirements.txt` | ~50 | All Python dependencies with pinned versions. |
| `migrations/versions/` | 29 files | Alembic migration chain from initial schema to current. |
| `scripts/launch_gate.py` | 51 | Codex launch gate runner. Validates deployment readiness. |

### Route Handlers
| File | Lines | Why It Matters |
|---|---|---|
| `routes/public.py` | 712 | Entire public-facing surface: booking, payment, pre-check-in, checkout, survey, health. |
| `routes/front_desk.py` | 2,118 | Largest route file. Front desk workspace, check-in/out, board surface, walk-in, groups. |
| `routes/staff_reservations.py` | 1,025 | Reservation CRUD, drawer panel, guest search, assignment, date changes. |
| `routes/admin.py` | 987 | Full admin console: property, rooms, rates, users, audit, channels, templates. |
| `routes/housekeeping.py` | 517 | HK board, room detail, status changes, tasks, notes. |
| `routes/cashier.py` | 369 | Folio management, charges, payments, voids, documents. |
| `routes/messaging.py` | 360 | Messaging inbox, threads, compose, automation. |
| `routes/provider.py` | 272 | Provider portal: bookings, calendar sync, payment requests. |
| `routes/reports.py` | 195 | Manager/front desk dashboards, daily report, CSV export. |
| `routes/auth.py` | 190 | Login, logout, MFA, password reset. |
| `routes/coupon_studio.py` | 14 | Scaffold only — not functional. |

### Service Layer (Top 15 by Size)
| File | Lines | Why It Matters |
|---|---|---|
| `services/front_desk_board_service.py` | 1,749 | Planning board data: grid construction, room grouping, block flattening. |
| `services/reporting_service.py` | 1,727 | Manager dashboard KPIs, occupancy/revenue calculations. |
| `services/staff_reservations_service.py` | 1,706 | Reservation workspace: list, filter, sort, detail, notes, assignment. |
| `services/admin_service.py` | 1,671 | All admin CRUD operations for rooms, rates, extras, overrides. |
| `services/housekeeping_service.py` | 1,667 | HK board, bulk operations, tasks, room detail summaries. |
| `services/messaging_service.py` | 1,532 | Messaging hub: threads, templates, automation rules, delivery. |
| `services/cashier_service.py` | 1,312 | Folio operations, balance calculation, document generation. |
| `services/reporting_reports.py` | 1,296 | Daily report builder, CSV export, operational lists. |
| `services/payment_integration_service.py` | 1,265 | Stripe integration, webhook processing, deposit requests. |
| `services/ical_service.py` | 1,244 | iCal feed export, external source sync, conflict detection. |
| `services/pre_checkin_service.py` | 1,232 | Pre-check-in lifecycle: token, form, documents, readiness. |
| `services/public_booking_service.py` | 1,116 | Public booking flow: availability, hold, confirm, cancel/modify. |
| `services/auth_service.py` | 943 | Auth: Argon2, MFA/TOTP, sessions, password reset, lockout. |
| `services/front_desk_mutations.py` | 826 | Check-in, check-out, walk-in, no-show processing. |
| `services/channel_service.py` | 710 | Channel manager abstraction (mock + iCal providers only). |

### Security-Critical
| File | Lines | Why It Matters |
|---|---|---|
| `services/auth_service.py` | 943 | Password hashing, session management, MFA. Security-critical code. |
| `pms/security.py` | 394 | CSP, HSTS, host validation, production config validation. |
| `services/rate_limiter.py` | 158 | In-process rate limiting. Known limitation: not distributed. |
| `services/storage.py` | ~180 | File storage backends (local + S3). Handles guest documents. |

### Client-Side
| File | Lines | Why It Matters |
|---|---|---|
| `static/styles.css` | 6,139 | Complete UI design system: public + staff + HK + board styles. |
| `static/front-desk-board.js` | 2,391 | Planning board: rendering, polling, HK overlay, role presets, filters. |
| `static/public-site.js` | 399 | Booking form, date picker, extras, GA4 events. |

### Templates (68 files)
| Category | Key Templates | Purpose |
|---|---|---|
| Public | `availability.html`, `public_booking_form.html`, `public_confirmation.html` | Guest-facing booking flow |
| Pre-check-in | `pre_checkin_form.html`, `pre_checkin_confirmation.html`, `staff_pre_checkin_detail.html` | Digital pre-check-in |
| Front desk | `front_desk_workspace.html`, `front_desk_detail.html`, `front_desk_board.html` | Front desk operations + planning board |
| Reservations | `staff_reservations.html`, `staff_reservation_detail.html`, `_res_list_drawer.html` | Reservation workspace |
| Housekeeping | `housekeeping_board.html`, `housekeeping_room_detail.html` | HK operations |
| Cashier | `cashier_folio.html`, `cashier_print.html` | Folio management |
| Messaging | `staff_messaging_inbox.html`, `staff_messaging_thread.html` | Communication hub |
| Admin | `admin_*.html` (14+ files) | All admin console sections |
| Provider | `provider_*.html` | Provider portal |
| Reports | `staff_reports.html`, `staff_daily_report.html` | Operational reporting |

### Tests (30 files, ~16,979 lines)
| File | Lines | Coverage Area |
|---|---|---|
| `test_phase15_front_desk_board.py` | 2,158 | Planning board (largest test file) |
| `test_phase6_front_desk_workspace.py` | 1,215 | Check-in, check-out, walk-in |
| `test_phase4_public_booking.py` | 1,184 | Full booking pipeline |
| `test_phase18_messaging.py` | 1,087 | Messaging hub, automation |
| `test_phase17_pre_checkin.py` | 967 | Pre-check-in flow |
| `test_housekeeping_readiness.py` | 876 | HK readiness, tasks |
| `test_phase5_staff_reservations_workspace.py` | 875 | Reservation workspace |
| `test_phase8_cashier.py` | 845 | Cashier folio operations |
| `test_phase10_admin_panel.py` | 841 | Admin CRUD |
| `test_phase13_security_hardening.py` | 729 | Security headers, CSRF, auth |
| Other 20 files | ~4,202 | Auth, payments, comms, reporting, pricing, topology, CLI, seeds |

### Documentation
| File | Purpose |
|---|---|
| `README.md` | Project overview, deployment topology, bootstrap commands, env vars |
| `AGENTS.md` | Agent skills, validation protocol, high-risk areas |
| `docs/DEPLOYMENT-RUNBOOK.md` | Step-by-step deployment guide |
| `docs/PAYMENT-CUTOVER-RUNBOOK.md` | Payment provider activation checklist |
| `docs/RENDER_DEPLOY_CHECKLIST.md` | Render-specific deploy verification |
| `docs/PMS-AUDIT.md` | Prior internal audit (2026-03-22) |

---

## 8. Summary Scorecard

| Dimension | Score | Launch Gate |
|---|---|---|
| Domain model completeness | 9/10 | Pass |
| Core operational workflows | 8/10 | Pass |
| Security posture | 8.5/10 | Pass |
| Test coverage breadth | 7.5/10 | Pass |
| Deployment config quality | 8/10 | Pass (config is thorough) |
| Deployment verification | 0/10 | **FAIL** (never deployed) |
| Payment integration | 7/10 code, 0/10 live | **FAIL** (disabled) |
| Email delivery | 7/10 code, 0/10 live | **FAIL** (unverified) |
| Background job execution | 7/10 code, 0/10 live | **FAIL** (unverified) |
| OTA channel integration | 3/10 | Acceptable (not needed for launch) |
| Production monitoring | 2/10 | Warning (Sentry configured but no DSN) |

**Overall: 7.46/10 on code quality — but 0/10 on production verification.**

The code is launch-quality. The ops story is not. Every blocker above is an **operational verification task**, not a coding task. The system needs to be deployed, tested live, and confirmed working — which is entirely achievable within 1-2 focused weeks.

---

*Report generated via static codebase analysis on 2026-03-28. All findings are based on source code review and have not been verified at runtime.*
