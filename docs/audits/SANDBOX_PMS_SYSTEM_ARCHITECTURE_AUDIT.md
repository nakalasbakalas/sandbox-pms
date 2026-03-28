# Sandbox PMS — System Architecture Audit

**Date:** 2026-03-28
**Audit Method:** Static codebase analysis

---

## 1. Entrypoints

| File | Purpose |
|---|---|
| `sandbox_pms_mvp/app.py` | WSGI entrypoint (`from pms import create_app; app = create_app()`) — 7 lines |
| `sandbox_pms_mvp/pms/__init__.py` | Re-exports `create_app` from `pms.app` |
| `sandbox_pms_mvp/pms/app.py` | App factory, template helpers, CLI commands, auth hooks — **1,683 lines** |
| `render.yaml` | Gunicorn start: `gunicorn ... app:app` |

The Gunicorn command starts 2 sync workers (configurable via `WEB_CONCURRENCY`) binding to `0.0.0.0:PORT`.

---

## 2. App Factory (`create_app`)

Location: `pms/app.py:474-521`

**Initialization sequence:**
1. Create Flask instance with `template_folder="../templates"`, `static_folder="../static"`
2. Load `Config` class from `pms/config.py`
3. Apply test overrides if provided
4. Normalize runtime config (URL consistency, trusted hosts)
5. Configure security (`pms/security.py` — proxy fix, logging, validation, hooks, error handlers)
6. Init SQLAlchemy and Flask-Migrate
7. Configure Sentry error monitoring
8. Register template helpers, URL topology hooks, auth hooks, CLI commands
9. Register 11 Flask Blueprints
10. Call `register_routes()` (now a no-op — all routes in blueprints)
11. If SQLite + auto-bootstrap: create tables and seed data

**Production fail-fast checks** (in `security.py:136-206`):
- SECRET_KEY must be ≥32 chars, not a default value
- AUTH_ENCRYPTION_KEY must be valid Fernet key
- ADMIN_EMAIL and ADMIN_PASSWORD required
- HTTPS, secure cookies, and other safety flags enforced
- test_hosted payment provider blocked in production

---

## 3. Blueprint / Module Map

| Blueprint | URL prefix | File | Lines | Key routes |
|---|---|---|---|---|
| `auth_bp` | `/staff` | `routes/auth.py` | 190 | Login, logout, MFA verify, forgot/reset password, security settings |
| `public_bp` | `/` | `routes/public.py` | 712 | Booking entry, hold, confirm, payment, pre-check-in, digital checkout, survey, iCal feed, maintenance request |
| `front_desk_bp` | `/staff` | `routes/front_desk.py` | 2,118 | Dashboard, front desk workspace, check-in/out, walk-in, reservation detail, board surface, handover panel, group blocks |
| `staff_reservations_bp` | `/staff` | `routes/staff_reservations.py` | 1,025 | Reservation list, detail, panel, notes, assignment, date change, cancel, guest search/detail/merge |
| `admin_bp` | `/staff/admin` | `routes/admin.py` | 987 | Property, rooms, rates, extras, overrides, blackouts, policies, templates, channels, staff/users, audit log, communications |
| `cashier_bp` | `/staff/cashier` | `routes/cashier.py` | 369 | Folio detail, charges, payments, adjustments, voids, refunds, receipts, print |
| `housekeeping_bp` | `/staff` | `routes/housekeeping.py` | 517 | Board, room detail, status changes, tasks, notes, maintenance |
| `messaging_bp` | `/staff/messaging` | `routes/messaging.py` | 360 | Inbox, thread detail, compose, reply, assign, close, reopen, follow-up, templates |
| `reports_bp` | `/staff` | `routes/reports.py` | 195 | Manager dashboard, front desk dashboard, daily report, CSV export, rate calculator, operational list |
| `provider_bp` | `/provider` | `routes/provider.py` | 272 | Dashboard, bookings list/detail, cancel, payment requests, calendar sync |
| `coupon_studio_bp` | `/staff/coupon-studio` | `routes/coupon_studio.py` | 14 | Stub only |

**Total route handler code: ~6,759 lines across 11 active blueprints**

---

## 4. Service Layer Map

| Service | Lines | Responsibility |
|---|---|---|
| `staff_reservations_service.py` | 1,706 | Reservation list/filter/sort, detail, notes, room assignment, date change, guest search |
| `front_desk_board_service.py` | 1,749 | Board data grid, serialization, room groups, block flattening |
| `front_desk_mutations.py` | 826 | Check-in, check-out, walk-in, no-show processing |
| `front_desk_queries.py` | 318 | Front desk workspace queries and filters |
| `front_desk_base.py` | 225 | Shared dataclasses for front desk |
| `housekeeping_service.py` | 1,667 | Board, room detail, status changes, tasks, bulk operations, notes |
| `cashier_service.py` | 1,312 | Folio detail, charges, payments, adjustments, voids, refunds, documents, print |
| `admin_service.py` | 1,671 | Room/rate/extra/override/blackout/template/policy CRUD, audit, role permissions |
| `admin_inventory_ops.py` | 583 | Room type and room inventory operations |
| `admin_settings_ops.py` | 565 | App settings and configuration operations |
| `admin_content_ops.py` | 394 | Policy/template content management |
| `admin_base.py` | 151 | Shared admin dataclasses |
| `auth_service.py` | 943 | Login, sessions, MFA, password reset, user CRUD |
| `public_booking_service.py` | 1,116 | Availability search, hold, confirm, cancel/modify requests, digital checkout |
| `payment_integration_service.py` | 1,265 | Hosted payment integration (Stripe + test provider), webhooks, deposit requests |
| `messaging_service.py` | 1,532 | Messaging hub, threads, templates, automation rules, delivery |
| `communication_queue.py` | 711 | Notification delivery queue processing |
| `communication_dispatch.py` | 421 | Email/SMS/webhook dispatch |
| `communication_base.py` | 273 | Shared communication dataclasses |
| `communication_service.py` | 5 | Re-export facade |
| `reporting_service.py` | 1,727 | Manager dashboard, front desk dashboard, report data aggregation |
| `reporting_reports.py` | 1,296 | Daily report, CSV export, operational lists |
| `reporting_base.py` | 299 | Report dataclasses and helpers |
| `pre_checkin_service.py` | 1,232 | Token generation, form save/submit, document upload/verify, readiness |
| `ical_service.py` | 1,244 | iCal feed export, external source sync, conflict detection |
| `channel_service.py` | 710 | Channel manager abstraction layer, mock + iCal providers |
| `availability_service.py` | 496 | Inventory availability queries |
| `reservation_service.py` | 624 | Reservation create, waitlist promote/expire |
| `provider_portal_service.py` | 400 | Provider dashboard, booking list, cancel, payment requests |
| `extras_service.py` | 396 | Booking extras CRUD and pricing |
| `group_booking_service.py` | 335 | Group room blocks |
| `survey_service.py` | 293 | Post-stay surveys |
| `room_readiness_service.py` | 242 | Room readiness board for assignments |
| `storage.py` | 200 | Storage backend protocol (local + S3) |
| `loyalty_service.py` | 192 | Guest loyalty tiers and points |
| `property_service.py` | 181 | Multi-property resolution |
| `pos_adapter.py` | 175 | POS integration scaffold |
| `rate_limiter.py` | 158 | Request rate limiting |
| `id_scanner_adapter.py` | 145 | ID scanner scaffold |
| `sms_provider.py` | 91 | SMS provider abstraction |
| `sms_twilio_adapter.py` | 79 | Twilio SMS adapter |
| `front_desk_service.py` | 5 | Re-export facade |

**Total service layer: ~27,953 lines across 42 files**

---

## 5. Domain / Model Map

### Core Domain Models (50+ models across 2,208 lines in `models.py`)

**Identity & Auth:**
- `User` — staff accounts with Argon2 passwords, account states, MFA flag
- `Role` — system roles (admin, manager, front_desk, housekeeping, provider)
- `Permission` — granular permission codes (39 seeded)
- `UserRole`, `RolePermission` — many-to-many junction tables
- `UserSession` — cookie-based session management with selector+token pattern
- `UserPreference` — JSON preferences per user
- `UserPasswordHistory` — password reuse prevention
- `PasswordResetToken` — time-limited reset tokens
- `AuthAttempt` — login audit trail
- `MfaFactor`, `MfaRecoveryCode` — TOTP MFA with encrypted secrets

**Guest & Reservation:**
- `Guest` — first/last/full name, phone, email, nationality, ID document, blacklist flag
- `GuestNote` — typed notes with visibility scopes
- `GuestLoyalty` — tier/points linked to guest
- `Reservation` — the core entity: dates, status, guest, room type, assigned room, quoted totals, source channel, booking language
- `ReservationStatusHistory` — append-only status transitions
- `ReservationNote` — staff notes on reservations
- `ReservationExtra` — upsells/add-ons linked to booking
- `ReservationHold` — temporary availability lock for booking flow
- `ReservationReviewQueue` — review inbox for new bookings

**Inventory & Rooms:**
- `Property` — multi-property support (single property in practice)
- `RoomType` — code, occupancy, amenities, media URLs, policy callouts
- `Room` — room number, floor, sellable flag, photos
- `InventoryDay` — per-room-per-date availability state (the core inventory grid)
- `InventoryOverride` — manual close/open for rooms or room types
- `BlackoutPeriod` — date ranges closed to booking
- `RateRule` — rate calculation rules (base/seasonal/holiday/weekday/long-stay)
- `BookingExtra` — add-on products (per-stay or per-night pricing)

**Housekeeping:**
- `HousekeepingStatus` — reference codes (clean, dirty, inspected, etc.)
- `RoomNote` — typed notes attached to rooms
- `RoomStatusHistory` — append-only status changes
- `HousekeepingTask` — typed tasks (checkout_clean, daily_service, etc.) with assignment, priority, lifecycle

**Finance:**
- `FolioCharge` — line items on the folio (room, tax, deposit, payment, refund, correction)
- `CashierDocument` — issued folios/invoices/receipts with document numbers
- `CashierDocumentSequence` — sequential document numbering
- `CashierActivityLog` — financial activity audit trail
- `PaymentRequest` — hosted payment requests (Stripe sessions/links)
- `PaymentEvent` — payment webhook events

**Communications:**
- `NotificationTemplate` — email/push templates per event/channel/language
- `NotificationDelivery` — delivery tracking with status, retry, failure categories
- `EmailOutbox` — queued emails with deduplication
- `StaffNotification` — in-app staff notifications
- `ConversationThread` — messaging threads (email/SMS/LINE/WhatsApp/internal)
- `Message` — individual messages with direction, delivery status
- `MessageTemplate` — reusable message templates
- `AutomationRule` — event-triggered automation rules with delay
- `PendingAutomationEvent` — deferred automation queue
- `AutoResponseRule` — keyword-triggered auto-replies
- `DeliveryAttempt` — message delivery audit

**Pre-Check-In & Documents:**
- `PreCheckIn` — digital pre-check-in form per reservation (token, status, readiness, occupant details)
- `ReservationDocument` — uploaded ID documents with verification status and optional OCR data

**Calendar & OTA:**
- `CalendarFeed` — outbound iCal feeds (property or per-room scope)
- `ExternalCalendarSource` — inbound iCal sources for sync
- `ExternalCalendarBlock` — parsed calendar blocks with conflict detection
- `ExternalCalendarSyncRun` — sync history and statistics
- `OtaChannel` — OTA integration config with encrypted API keys

**Other:**
- `AppSetting` — key-value application settings
- `PolicyDocument` — versioned policy documents (cancellation, privacy, etc.)
- `ActivityLog` — general activity audit trail
- `AuditLog` — before/after data change audit trail
- `ReservationCodeSequence` — reservation code generator
- `GuestSurvey` — post-stay guest satisfaction surveys

---

## 6. Template / Static / Frontend Map

### Templates (68 files in `sandbox_pms_mvp/templates/`)

**Layout:** `base.html` — master layout with branding, nav, meta, structured data

**Public:**
- `index.html` — landing redirect / entry point
- `availability.html` — room type search results
- `public_booking_form.html` — booking form
- `public_confirmation.html` — booking confirmation
- `public_payment_return.html` — payment return page
- `public_cancel_request.html`, `public_modify_request.html` — self-service
- `public_digital_checkout.html` — digital checkout flow
- `pre_checkin_form.html`, `pre_checkin_confirmation.html` — guest pre-check-in
- `guest_survey_form.html`, `guest_survey_thanks.html` — post-stay survey
- `guest_maintenance_request.html` — in-stay maintenance request

**Staff:**
- `staff_login.html`, `staff_mfa_verify.html`, `staff_forgot_password.html`, `staff_reset_password.html` — auth
- `staff_security.html` — password change + MFA management
- `staff_dashboard.html` — staff landing
- `staff_reservations.html`, `_res_list_drawer.html` — reservation workspace
- `reservation_detail.html`, `reservation_form.html` — reservation detail/edit
- `front_desk_workspace.html`, `front_desk_detail.html` — front desk operations
- `front_desk_board.html`, `_front_desk_board_surface.html`, `_front_desk_board_stats_panel.html`, `_front_desk_board_handover_panel.html` — planning board
- `_panel_reservation_details.html` — board inline reservation panel
- `housekeeping_board.html`, `housekeeping_room_detail.html` — housekeeping
- `cashier_folio.html`, `cashier_print.html` — cashier
- `staff_messaging_inbox.html`, `staff_messaging_thread.html`, `staff_messaging_compose.html` — messaging
- `staff_reports.html`, `staff_daily_report.html`, `staff_rate_calculator.html`, `staff_operational_list.html` — reports
- `staff_guests.html`, `staff_guest_detail.html`, `staff_guest_merge.html` — guest management
- `staff_pre_checkin_detail.html` — pre-check-in staff review
- `staff_review_queue.html` — booking review queue
- `staff_coupon_studio.html` — coupon management (scaffold)
- `group_block_detail.html` — group booking detail

**Admin:**
- `admin.html`, `admin_nav.html` — admin layout
- `admin_property.html`, `admin_rates_inventory.html`, `admin_operations.html` — property/rates config
- `admin_payments.html` — payment configuration
- `admin_channels.html` — OTA channel management
- `admin_communications.html` — notification templates and automation
- `admin_staff_access.html` — user/role management
- `admin_audit.html` — audit log viewer

**Provider:**
- `provider_dashboard.html`, `provider_bookings.html`, `provider_booking_detail.html`, `provider_calendar.html`

### Static Assets
- `styles.css` — **6,139 lines** — comprehensive CSS with PMS-specific design system (`--pms-*` tokens, `.res-*`, `.hk-*`, `.fd-*` class namespaces)
- `front-desk-board.js` — **2,391 lines** — board rendering, polling, state management, filtering, drag interactions
- `public-site.js` — **399 lines** — booking form interactions, date picker, GA4 events
- `header-nav.js` — **80 lines** — responsive navigation
- `app-actions.js` — **58 lines** — staff-side action helpers
- Branding assets in `static/branding/` — logos, favicons, icons

---

## 7. Background Jobs / Scheduled Processes

| Cron Job | Schedule | CLI Command | Function |
|---|---|---|---|
| Process notifications | Every 5 min | `flask process-notifications` | Dispatch pending email/notification deliveries |
| Process automation events | Every 5 min | `flask process-automation-events` | Fire deferred automation rules |
| Sync iCal sources | Every 15 min | `flask sync-ical-sources` | Fetch and parse external iCal feeds |
| Send pre-arrival reminders | Daily 9 AM | `flask send-pre-arrival-reminders` | Remind guests about upcoming arrivals |
| Send failed payment reminders | Daily 10 AM | `flask send-failed-payment-reminders` | Nudge guests about failed payments |
| Fire pre-check-in reminders | Daily 8 AM | `flask fire-pre-checkin-reminders` | Trigger automation for incomplete pre-check-ins |
| Process waitlist | Every 15 min | `flask process-waitlist` | Promote eligible waitlisted reservations, expire stale ones |
| Cleanup audit logs | Daily 3:30 AM | `flask cleanup-audit-logs` | Remove old audit entries per retention policy |
| Auto-cancel no-shows | Hourly | `flask auto-cancel-no-shows` | Cancel confirmed reservations past cutoff |

---

## 8. Environment and Deployment Topology

**Config source:** `pms/config.py` — 179 lines, all from environment variables with sensible defaults.

**Key env categories:**
- Database: `DATABASE_URL` (PostgreSQL)
- URLs: `APP_BASE_URL`, `BOOKING_ENGINE_URL`, `STAFF_APP_URL`, `MARKETING_SITE_URL`
- Auth: `SECRET_KEY`, `AUTH_ENCRYPTION_KEY`, `AUTH_COOKIE_*`, `SESSION_*`, `MFA_*`, `LOGIN_LOCK_*`
- Payment: `PAYMENT_PROVIDER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Email: `SMTP_HOST/PORT/USERNAME/PASSWORD`, `MAIL_FROM`
- SMS: `SMS_PROVIDER`, `TWILIO_*`
- Messaging: `LINE_*`, `WHATSAPP_*`, `CHANNEL_PUSH_WEBHOOK_URL`
- Storage: `STORAGE_BACKEND`, `UPLOAD_DIR`, `S3_*`
- Monitoring: `SENTRY_DSN`, `SENTRY_*`
- Misc: `POS_ADAPTER`, `ID_SCANNER_PROVIDER`, `REDIS_URL`

---

## 9. External Dependencies and Integrations

| Dependency | Status | Evidence |
|---|---|---|
| PostgreSQL | Required | `SQLALCHEMY_DATABASE_URI`, migrations, all SQL queries |
| Stripe | Optional | `payment_integration_service.py` — full checkout session + webhook logic |
| SMTP (email) | Optional | `communication_dispatch.py` — smtplib integration |
| Twilio (SMS) | Optional | `sms_twilio_adapter.py` — basic adapter |
| LINE Messaging API | Optional | Webhook-based; config keys present; no full adapter |
| WhatsApp Business API | Optional | Webhook-based; config keys present; no full adapter |
| Sentry | Optional | SDK initialization in `app.py:455-471` |
| S3-compatible storage | Optional | `storage.py` — boto3-based S3StorageBackend |
| iCal sources | Optional | `ical_service.py` — HTTP fetch + icalendar parsing |

---

## 10. Trust Boundaries / Public vs Staff Separation

**Public surface** (no auth required):
- `/` — landing / booking entry
- `/book`, `/availability` — search
- `/booking/hold`, `/booking/confirm` — booking flow (CSRF-protected via session token)
- `/booking/confirmation/<token>` — token-gated confirmation lookup
- `/booking/cancel`, `/booking/modify` — self-service requests
- `/pre-checkin/<token>` — token-gated pre-check-in form
- `/survey/<token>` — token-gated survey
- `/payment/start/<request_code>`, `/payment/return/<request_code>` — hosted payment
- `/payment/webhook` — Stripe webhook (HMAC-verified, CSRF-exempt)
- `/ical/<token>.ics` — calendar feed (token-based)
- `/maintenance-request/<token>` — maintenance request
- `/health` — health check

**Staff surface** (auth cookie + RBAC required):
- `/staff/*` — all staff routes require `g.current_staff_user` from cookie session
- Each route further checks `require_permission()` or `require_user()` decorators
- Admin routes additionally check `require_admin_workspace_access()`
- MFA enforcement: pending MFA users are redirected to verify page
- Force password reset: users with `force_password_reset` flag are redirected to security page

**Provider surface** (auth cookie + provider role):
- `/provider/*` — requires provider role + `provider.*` permissions

**Canonical host enforcement:**
- `ENFORCE_CANONICAL_HOSTS` redirects requests to the correct domain based on audience
- Public routes → `book.sandboxhotel.com`
- Staff routes → `staff.sandboxhotel.com`
- `TRUSTED_HOSTS` validation rejects unknown host headers

---

## 11. File-Level Evidence Appendix

### Architecture & Config
| File | Why it matters |
|---|---|
| `pms/app.py` (1,683 lines) | App factory, auth hooks, template helpers, CLI commands — the central orchestrator |
| `pms/config.py` (179 lines) | All 70+ configuration keys with defaults |
| `pms/security.py` (394 lines) | Production validation, CSP, HSTS, host validation, HTTPS redirect, error handlers |
| `pms/extensions.py` (6 lines) | SQLAlchemy + Flask-Migrate setup |
| `render.yaml` (337 lines) | Full Render Blueprint with web service, 9 crons, database, disk |

### Models & Domain
| File | Why it matters |
|---|---|
| `pms/models.py` (2,208 lines) | 50+ model classes with full constraint system |
| `pms/constants.py` (440 lines) | All status enums, permission seeds, role seeds |
| `pms/pricing.py` (178 lines) | Rate calculation engine |
| `pms/seeds.py` (983 lines) | Reference data seeding for rooms, rates, templates, policies |

### Key Services
| File | Why it matters |
|---|---|
| `services/public_booking_service.py` (1,116 lines) | Entire public booking pipeline |
| `services/front_desk_board_service.py` (1,749 lines) | Planning board data layer |
| `services/cashier_service.py` (1,312 lines) | Financial folio management |
| `services/auth_service.py` (943 lines) | Authentication, sessions, MFA |
| `services/messaging_service.py` (1,532 lines) | Guest communications hub |
| `services/channel_service.py` (710 lines) | OTA channel abstraction |
| `services/ical_service.py` (1,244 lines) | Calendar sync engine |
