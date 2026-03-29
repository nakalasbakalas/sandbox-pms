# Sandbox PMS — Product Specification Audit

**Date:** 2026-03-28
**Audit Method:** Static codebase analysis — classifying actual implementation status

---

## Classification Key

| Status | Meaning |
|---|---|
| **Implemented** | Complete service + route + template + test coverage; appears operational |
| **Mostly implemented** | Core flow works but has known gaps or missing edge cases |
| **Partial** | Some functionality exists but incomplete for production use |
| **Scaffold only** | Model/file exists but no meaningful business logic |
| **Not found** | No evidence in codebase |

---

## 1. Public Booking Engine — **Implemented**

**Evidence:** `routes/public.py` (712 lines), `services/public_booking_service.py` (1,116 lines), `templates/availability.html`, `public_booking_form.html`, `public_confirmation.html`, `test_phase4_public_booking.py` (1,184 lines)

**Flow:**
1. `GET /book` → availability search by dates, adults, children
2. `POST /booking/hold` → creates `ReservationHold` with timed expiry (7 min default)
3. `POST /booking/confirm` → converts hold to `Reservation` with status `confirmed`
4. Guest receives confirmation with `public_confirmation_token`
5. `GET /booking/confirmation/<token>` → lookup-by-reference with verification

**Features:**
- Rate quoting with seasonal/holiday/weekend/long-stay rules via `pricing.py`
- Booking extras (per-stay / per-night add-ons)
- Duplicate detection (`duplicate_suspected` flag)
- Rate limiting (configurable per IP)
- i18n support (Thai, English, Chinese)
- Booking attribution tracking (UTM, referrer, entry page)
- Hold-based inventory locking to prevent double-booking
- Source channel tracking (direct_web, OTA, walk_in, etc.)

**Gaps:** Payment collection disabled by default (`PAYMENT_PROVIDER=disabled`). Booking confirmation email requires SMTP configuration.

---

## 2. Reservation Lifecycle — **Implemented**

**Evidence:** `models.py:Reservation` (92 columns/constraints), `services/reservation_service.py` (624 lines), `services/staff_reservations_service.py` (1,706 lines)

**Status machine:**
```
inquiry → tentative → confirmed → checked_in → checked_out
                    ↘ cancelled
                    ↘ no_show
         waitlist → confirmed (via promotion) or → cancelled (via expiry)
         house_use (internal)
```

**Features:**
- `ReservationStatusHistory` — append-only audit trail of every status change
- Waitlist promotion/expiry via cron
- Auto no-show cancellation via cron (hourly, after cutoff)
- Cancellation/modification request system (public-facing, staff review queue)
- Reservation code format: `SBX-NNNNNN` (sequential)

**Gaps:** No formal state transition validation in code (any service can write any status). Status machine is implicit, not enforced.

---

## 3. Inventory Management — **Implemented**

**Evidence:** `models.py:InventoryDay`, `services/availability_service.py` (496 lines), `services/admin_inventory_ops.py` (583 lines), `seeds.py:bootstrap_inventory_horizon`

**Design:** Room-date grid (`InventoryDay` = one row per room per date) with:
- `availability_status` (available, held, reserved, occupied, house_use, out_of_service, out_of_order)
- `housekeeping_status_id` → links to HK state
- `reservation_id` / `hold_id` → links to consuming entity
- `nightly_rate` — stored rate for that night
- `is_sellable`, `is_blocked`, `maintenance_flag`
- Check constraints prevent illogical states (e.g., OOS with reservation)

**Features:**
- Inventory horizon bootstrap (730 days by default)
- Blackout periods (closed_to_booking, no_arrival, no_departure, property_closed)
- Inventory overrides (close/open specific rooms or room types for date ranges)
- Availability search queries against this grid

---

## 4. Room Assignment — **Implemented**

**Evidence:** `services/staff_reservations_service.py:assign_room`, `services/room_readiness_service.py` (242 lines)

**Features:**
- Manual room assignment by staff
- Room readiness board showing assignable rooms per date
- `is_room_assignable()` checks room availability, HK status, maintenance flags
- Assignment updates `InventoryDay` records

---

## 5. Front Desk Workflows — **Implemented**

**Evidence:** `routes/front_desk.py` (2,118 lines), `services/front_desk_mutations.py` (826 lines), `services/front_desk_queries.py` (318 lines), `templates/front_desk_workspace.html`, `front_desk_detail.html`

**Features:**
- Workspace view with filters (arrivals, departures, in-house, date, search)
- Reservation detail with comprehensive summary panel
- Pre-check-in readiness status integration

---

## 6. Check-In / Check-Out — **Implemented**

**Evidence:** `services/front_desk_mutations.py:complete_check_in` (~100 lines), `complete_checkout` (~120 lines)

**Check-in:**
- ID verification tracking (verified_at, verified_by)
- Room assignment required
- Phone and email pre-fill from pre-check-in
- Room charges auto-posted to folio
- Status → `checked_in`, timestamp recorded
- Activity log and automation event fired

**Check-out:**
- Balance check, room charges posting, folio finalization
- Status → `checked_out`, timestamp recorded
- HK status set to `dirty` on checkout room
- Automation event `checkout_completed` fired
- Digital checkout available via public route

---

## 7. Walk-In Handling — **Implemented**

**Evidence:** `services/front_desk_mutations.py:create_walk_in_and_check_in` (~80 lines)

Creates guest + reservation + check-in in a single transaction with source_channel=`walk_in`.

---

## 8. No-Show / Cancellation / Modification — **Implemented**

**Evidence:** `services/front_desk_mutations.py:process_no_show`, `staff_reservations_service.py:cancel_reservation_workspace`, `public_booking_service.py:submit_cancellation_request`, `submit_modification_request`

**Features:**
- Manual no-show processing by staff
- Auto no-show cancellation via hourly cron
- Public cancellation request form (verified by contact hash, creates `CancellationRequest`)
- Public modification request form (creates `ModificationRequest`)
- Staff review queue for requests
- Staff approve/decline modification requests with quoted impact

---

## 9. Housekeeping — **Implemented**

**Evidence:** `routes/housekeeping.py` (517 lines), `services/housekeeping_service.py` (1,667 lines), `templates/housekeeping_board.html`, `housekeeping_room_detail.html`

**Features:**
- Room status board with 11 HK status codes
- Bulk status updates (select rooms → apply status)
- 7 task types (checkout_clean, daily_service, rush_clean, deep_clean, inspection, turndown, maintenance)
- Task lifecycle: open → assigned → in_progress → completed → inspected
- 4 priority levels (low, normal, high, urgent)
- Room notes (typed: housekeeping, maintenance, supervisor, lost_and_found, warning)
- Room blocking (is_blocked + reason + date range)
- Maintenance flagging
- Room status history (append-only audit)
- Task assignment to specific staff users
- Task inspector verification

---

## 10. Cashier / Folio / Charges / Payments — **Implemented**

**Evidence:** `routes/cashier.py` (369 lines), `services/cashier_service.py` (1,312 lines), `templates/cashier_folio.html`, `cashier_print.html`

**Features:**
- Room charge posting (RM + VAT per night)
- Deposit handling (DEP received, DEP_APPL applied)
- Payment recording (cash, QR, card, bank)
- Manual adjustments (positive and negative)
- POS charges (from integration or manual)
- Void charges with reason tracking
- Refund posting
- Balance calculation (charges − payments)
- Cashier documents: folio, invoice, receipt with sequential numbering
- Print-ready folio layout
- Cashier activity log

**Charge codes:** RM, VAT, DEP, DEP_APPL, PMT-CASH, PMT-QR, PMT-CARD, PMT-BANK, EXG, EXB, ECI, LCO, LND, SNK, TEL, XTR, ADJ_POS, ADJ_NEG, CORR, REF

---

## 11. Hosted Payments — **Mostly Implemented**

**Evidence:** `services/payment_integration_service.py` (1,265 lines), `test_phase9_hosted_payments.py` (702 lines)

**Features:**
- Stripe Checkout Session creation
- Payment link generation with TTL
- Webhook processing (payment_intent.succeeded / checkout.session.completed)
- Deposit request creation and resend (with cooldown)
- Payment status sync
- Test hosted payment provider for development
- `PaymentRequest` + `PaymentEvent` models with full lifecycle

**Gap:** `PAYMENT_PROVIDER=disabled` in render.yaml. Requires Stripe keys + webhook secret to activate. No evidence of live Stripe testing.

---

## 12. Reporting — **Implemented**

**Evidence:** `routes/reports.py` (195 lines), `services/reporting_service.py` (1,727 lines), `services/reporting_reports.py` (1,296 lines), `templates/staff_reports.html`, `staff_daily_report.html`

**Features:**
- Manager dashboard (occupancy, revenue, bookings, source channel breakdown)
- Front desk dashboard (arrivals, departures, in-house, HK summary)
- Daily operational report
- CSV export (reservations, charges, payments)
- Rate calculator tool
- Operational lists (arrivals, departures, in-house)
- Date range presets ​(today, week, month, custom)

---

## 13. Messaging — **Implemented**

**Evidence:** `routes/messaging.py` (360 lines), `services/messaging_service.py` (1,532 lines), `templates/staff_messaging_inbox.html`, `staff_messaging_thread.html`, `staff_messaging_compose.html`

**Features:**
- Unified inbox across channels (email, SMS, LINE, WhatsApp, internal_note, manual_call_log, ota_message)
- Thread management (open, waiting, closed, archived)
- Staff assignment and follow-up flagging
- Message templates with variable substitution
- Automation rules (event → template → channel with optional delay)
- Pending automation event queue (processed by cron)
- Unread count tracked and shown in staff nav
- Compose form with template selection

**Gap:** LINE and WhatsApp delivery requires webhook configuration. No inbound message webhook receivers implemented.

---

## 14. Digital Pre-Check-In — **Implemented**

**Evidence:** `routes/public.py` (pre-check-in routes), `services/pre_checkin_service.py` (1,232 lines), `templates/pre_checkin_form.html`, `pre_checkin_confirmation.html`, `staff_pre_checkin_detail.html`, `test_phase17_pre_checkin.py` (967 lines)

**Features:**
- Token-based guest access (32-byte URL-safe, 7-day expiry)
- Multi-section form: contact info, ID documents, vehicle, occupants, special requests, acknowledgment
- Document upload (passport, national_id, driving_license) ​with 10 MB limit
- Staff document verification (verify/reject with reason)
- Readiness tracking (7-state machine: awaiting_guest → ready_for_arrival)
- Email delivery of pre-check-in links
- Pre-fill check-in form from submitted pre-check-in data
- Batch pre-check-in status display in reservation list
- OCR extraction stub (returns None — future enhancement)

---

## 15. Guest Document Handling — **Implemented**

**Evidence:** `models.py:ReservationDocument`, `services/pre_checkin_service.py:upload_document`, `services/storage.py`

**Features:**
- Local or S3 storage backends
- File path uses `{reservation_id}/{uuid}{ext}` — no user-controlled components
- Staff-only document viewing (presigned URL for S3, byte stream for local)
- Document verification workflow (pending → verified/rejected)
- OCR data column exists but not populated

---

## 16. Guest Surveys — **Implemented**

**Evidence:** `models.py:GuestSurvey`, `services/survey_service.py` (293 lines), `templates/guest_survey_form.html`, `guest_survey_thanks.html`

**Features:**
- Token-based guest access with expiry
- 1-5 star rating + free-text feedback
- Category ratings (JSON)
- Submitted timestamp tracking

---

## 17. OTA / iCal / Provider Integration — **Partial**

**Evidence:** `services/channel_service.py` (710 lines), `services/ical_service.py` (1,244 lines), `models.py:OtaChannel`, `routes/provider.py`, `routes/admin.py` (channel management)

**iCal integration — Implemented:**
- Outbound iCal feed export (property-level and per-room)
- Inbound iCal source sync with conflict detection
- Sync history tracking
- Token-based feed security with rotation

**Channel manager — Scaffold:**
- `ChannelProvider` abstract base class with `push_inventory`, `fetch_reservations`, `push_reservation`
- `MockChannelProvider` for testing
- `ICalChannelProvider` delegating to ical_service
- `OtaChannel` model with encrypted API keys
- Admin UI for channel configuration

**What's missing:**
- No real Booking.com / Expedia / Agoda API adapters
- No inbound reservation import from OTAs (except via iCal blocks)
- No rate push to external channels
- No real-time availability sync

---

## 18. Admin Settings — **Implemented**

**Evidence:** `routes/admin.py` (987 lines), `services/admin_service.py` (1,671 lines), templates `admin_*.html`

**Admin sections:**
- Property settings (name, address, timezone, currency)
- Rooms and room types (CRUD with photos, amenities, pricing)
- Rate rules (base, seasonal, holiday, weekday, weekend, long-stay)
- Booking extras (add-ons with pricing modes)
- Inventory overrides (close/open rooms for date ranges)
- Blackout periods
- Policy documents (versioned, multilingual)
- Notification templates (per event/channel/language)
- OTA channels (config with encrypted keys)
- Staff users (create, edit, password reset, MFA management, enable/disable)
- Role permission editing
- Audit log viewer
- Communication settings and dispatch queue

---

## 19. Role-Based Access — **Implemented**

**Evidence:** `models.py:User/Role/Permission` + junction tables, `constants.py:PERMISSION_SEEDS` (39 codes), `helpers.py:require_permission`, `pms/permissions.py`

**Enforcement points:**
- Route decorators: `@require_permission("reservation.view")`, `@require_user()`, `@require_admin_workspace_access()`
- Template globals: `can("permission.code")` available in all templates
- Dashboard routing: `default_dashboard_endpoint_for_user()` routes users to appropriate landing page
- Admin workspace gating: only admin role can access `/staff/admin/*`

---

## 20. Cafe POS — **Scaffold Only**

**Evidence:** `services/pos_adapter.py` (175 lines)

Contains `NullPosAdapter` (no-op) and `WebhookPosAdapter` (HTTP POST to webhook URL). The cashier service can post POS charges to folios, but there's no actual POS system integration.

---

## 21. Route and Feature Map

### Public Routes
| Route | Method | Feature |
|---|---|---|
| `/` | GET | Landing page / index |
| `/book` | GET | Availability search |
| `/availability` | GET | Redirect to /book |
| `/booking/hold` | POST | Create reservation hold |
| `/booking/confirm` | POST | Confirm booking |
| `/booking/confirmation/<token>` | GET/POST | Confirmation lookup |
| `/booking/cancel` | GET/POST | Public cancellation request |
| `/booking/modify` | GET/POST | Public modification request |
| `/pre-checkin/<token>` | GET | Pre-check-in form |
| `/pre-checkin/<token>/save` | POST | Save pre-check-in data |
| `/pre-checkin/<token>/upload` | POST | Upload document |
| `/survey/<token>` | GET/POST | Guest survey |
| `/payment/start/<code>` | GET | Start hosted payment |
| `/payment/return/<code>` | GET | Payment return |
| `/payment/webhook` | POST | Stripe webhook |
| `/checkout/<token>` | GET/POST | Digital checkout |
| `/ical/<token>.ics` | GET | Calendar feed |
| `/maintenance-request/<token>` | GET/POST | Maintenance request |
| `/health` | GET | Health check |

### Staff Routes (selection of key endpoints)
| Route | Feature |
|---|---|
| `/staff/login`, `/staff/logout` | Auth |
| `/staff/mfa/verify` | MFA verification |
| `/staff/dashboard` | Staff landing |
| `/staff/reservations` | Reservation workspace |
| `/staff/reservations/<id>` | Reservation detail |
| `/staff/reservations/<id>/panel` | Drawer panel (AJAX) |
| `/staff/front-desk` | Front desk workspace |
| `/staff/front-desk/board` | Planning board |
| `/staff/front-desk/board/surface` | Board surface (AJAX refresh) |
| `/staff/front-desk/<id>` | Front desk detail + check-in |
| `/staff/front-desk/<id>/check-out` | Checkout flow |
| `/staff/front-desk/walk-in` | Walk-in registration |
| `/staff/housekeeping` | HK board |
| `/staff/housekeeping/room/<id>` | Room detail |
| `/staff/cashier/reservation/<id>` | Folio management |
| `/staff/messaging` | Inbox |
| `/staff/messaging/thread/<id>` | Thread detail |
| `/staff/reports` | Manager dashboard |
| `/staff/daily-report` | Daily report |
| `/staff/guests` | Guest search |
| `/staff/guests/<id>` | Guest detail |
| `/staff/admin/*` | Admin panel (multiple sub-routes) |

### Key JS Modules
| File | Powers |
|---|---|
| `front-desk-board.js` (2,391 lines) | Board rendering, polling, filters, HK overlay, role presets, command strip |
| `public-site.js` (399 lines) | Booking form, date picker, extras selection, GA4 events |
| `header-nav.js` (80 lines) | Responsive navigation toggle |
| `app-actions.js` (58 lines) | Staff-side quick actions |

---

## 22. Database and Domain Model Assessment

The schema supports a real boutique hotel PMS safely and coherently:

**Strengths:**
- UUID primary keys throughout (safe for distributed systems)
- `AuditMixin` provides created_at/updated_at/created_by/updated_by on all major entities
- `SoftDeleteMixin` for reversible deletions on appropriate entities
- Append-only protection on audit tables (`ActivityLog`, `AuditLog`, `PaymentEvent`, `ReservationStatusHistory`, `RoomStatusHistory`) via SQLAlchemy event listeners
- Check constraints enforce valid status values at the DB level
- Comprehensive indexing for common query patterns
- `InventoryDay` grid model properly prevents double-booking with unique constraints and status rules
- Financial columns use `Numeric(10,2)` for decimal precision

**Considerations:**
- Single-property design (Property model exists but system assumes one active property)
- No guest auth system (guests are records, not users) — appropriate for this hotel's model
- Room type photos stored as JSON array of URLs in the model, not as a separate entity
- No reservation versioning (status history exists, but not full field-level change tracking)

---

## 23. Security and Production Readiness Audit

### Auth Flow — **Strong**
- Argon2 password hashing with configurable time/memory/parallelism cost
- Werkzeug fallback for legacy hashes with auto-rehash
- 12-character minimum password with letter + digit requirement
- Password history tracking (`UserPasswordHistory`)
- Account locking after configurable failed attempts (5 default, 15 min lockout)
- Session management: selector + token pattern, idle timeout (15 min), absolute timeout (8 hrs)
- Session cookie: HTTPOnly, Secure, SameSite=Lax
- MFA: TOTP with encrypted secret storage (Fernet), recovery codes
- Force password reset flag

### CSRF — **Implemented**
- Global `validate_csrf_request()` in before_request hook
- Token generated via `ensure_csrf_token()` and provided in templates via `csrf_input()` helper
- Pre-check-in and webhook endpoints excluded (stateless token auth / HMAC verification)

### Security Headers — **Implemented**
- CSP with per-request nonce: `default-src 'self'; script-src 'self' 'nonce-...'`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
- `Cross-Origin-Opener-Policy: same-origin`
- HSTS with `includeSubDomains` (max-age 1 year)

### Host Validation — **Implemented**
- `TRUSTED_HOSTS` auto-populated from URL configs
- Unknown host headers receive 400

### Secret Management — **Adequate**
- Production fail-fast rejects default/insecure secret values
- `AUTH_ENCRYPTION_KEY` validated as proper Fernet key
- OTA API keys and calendar feed tokens encrypted at rest
- Sensitive field redaction in structured logs

### File Upload — **Mostly Secure**
- 10 MB file size limit enforced in `pre_checkin_service.py`
- Allowed extensions: `.jpg`, `.jpeg`, `.png`, `.pdf`
- Content-type validation
- Storage path uses UUID-based keys — no user-controlled path components
- Files served only through authenticated staff routes

**Potential concern:** File upload content validation checks extension and content-type but does not verify file magic bytes. A malicious file with a `.jpg` extension and `image/jpeg` content-type but actually containing executable content would pass validation. Risk: Low (files are only served to authenticated staff).

### Rate Limiting — **Basic**
- `rate_limiter.py` (158 lines) provides in-process rate limiting
- Applied to booking form submissions and public lookup
- **No distributed rate limiting** (no Redis/shared state between workers)

### What Needs Immediate Remediation Before Production
1. **Verify email delivery works** — SMTP config exists but no evidence of live testing
2. **Verify persistent disk survives deploy** — README notes this as unverified
3. **Activate payment provider** — Set `PAYMENT_PROVIDER=stripe` with real keys
4. **Verify cron jobs succeed** — All 9 cron services have never run in production
5. **Set SENTRY_DSN** — Error monitoring is configured but needs a real DSN
6. **Confirm CSRF token rotation** — The `rotate_csrf_token()` helper exists but should be verified post-login

### What Appears Secure
- Auth flow with Argon2, MFA, session management, account locking
- Production config validation (fail-fast on insecure defaults)
- CSP with nonces, HSTS, host validation, HTTPS redirect
- Encrypted secrets at rest (Fernet for API keys, MFA secrets, calendar tokens)
- Append-only audit tables with mutation protection
- No SQL injection risk (SQLAlchemy parameterized queries throughout)
- No XSS risk (Jinja2 auto-escaping + Markup-safe patterns)

---

## 24. Testing and Quality Audit

### Test Structure
| File | Lines | Tests | Coverage Area |
|---|---|---|---|
| `test_phase2_data_layer.py` | 250 | Model creation, constraints | Data layer |
| `test_phase3_auth.py` | 461 | Login, session, password, lockout | Auth |
| `test_phase4_public_booking.py` | 1,184 | Full booking flow, holds, confirms | Public booking |
| `test_phase5_staff_reservations_workspace.py` | 875 | List, filter, sort, detail, notes | Reservations |
| `test_phase6_front_desk_workspace.py` | 1,215 | Check-in, check-out, walk-in, no-show | Front desk |
| `test_phase7_housekeeping.py` | 680 | Board, status, tasks, notes | Housekeeping |
| `test_phase8_cashier.py` | 845 | Charges, payments, voids, documents | Cashier |
| `test_phase9_hosted_payments.py` | 702 | Payment requests, webhooks, sync | Payments |
| `test_phase10_admin_panel.py` | 841 | Admin CRUD, settings, audit | Admin |
| `test_phase11_communications.py` | 695 | Notifications, email dispatch, templates | Communications |
| `test_phase12_reporting.py` | 643 | Reports, dashboards, CSV export | Reporting |
| `test_phase13_security_hardening.py` | 729 | CSP, CSRF, host validation, HTTPS, headers | Security |
| `test_phase14_provider_portal_ical.py` | 347 | Provider portal, iCal sync | Provider |
| `test_phase15_front_desk_board.py` | 2,158 | Board rendering, polling, filters, panels | Planning board |
| `test_phase17_pre_checkin.py` | 967 | Pre-check-in flow, documents, readiness | Pre-check-in |
| `test_phase18_messaging.py` | 1,087 | Messaging hub, threads, automation | Messaging |
| `test_phase19_dashboards.py` | 632 | Dashboard queries, KPIs | Dashboards |
| `test_pricing.py` | 326 | Rate calculation, seasonal, long-stay | Pricing |
| `test_availability_and_channel.py` | 443 | Availability queries, channel service | Availability |
| `test_housekeeping_readiness.py` | 876 | Readiness sync, task workflow | HK readiness |
| `test_domain_topology.py` | 197 | URL routing, canonical redirect | Topology |
| `test_deployment_cli.py` | 272 | CLI commands, seed, bootstrap | CLI |
| `test_employee_account_migration.py` | 122 | Account seeding | Users |
| `test_seed_safety.py` | 68 | Seed idempotency | Seeding |
| `test_normalization_helpers.py` | 22 | Phone normalization | Helpers |
| Others | ~400 | Various utility tests | Misc |

**Total: ~16,979 lines across 30 test files**

### What Tests Actually Validate
- Full booking pipeline from search to confirmation (with hold expiry, rate quoting, deduplication)
- Check-in with ID verification and room charge posting
- Check-out with balance verification and HK status change
- Walk-in creation with same-day check-in
- Cashier folio operations (charges, payments, voids, refunds, balance)
- Auth flow (login, lockout, session expiry, MFA enrollment + verify, password reset)
- Security headers presence and correctness
- CSRF enforcement on state-changing endpoints
- Admin CRUD operations on all configuration entities
- Pre-check-in token lifecycle, document upload, verification state machine
- Messaging thread CRUD, template rendering, automation rule firing

### What Remains Unproven Without Runtime
- Email delivery (SMTP network calls)
- Stripe payment webhook processing with real events
- iCal sync with real external feeds
- Persistent disk write/read across deploys
- Cron job execution and scheduling
- Concurrent access race conditions (inventory double-booking under load)
- Performance under real traffic

### Code Quality Observations
- **Large files:** `app.py` (1,683 lines), `front_desk_board_service.py` (1,749 lines), `reporting_service.py` (1,727 lines) are borderline monolithic
- **Duplicate helpers:** Prior audit noted some duplicate functions between `app.py` and `helpers.py` — partially resolved
- **Re-export facades:** `front_desk_service.py` (5 lines) and `communication_service.py` (5 lines) are just re-export files
- **Strong patterns:** Dataclass payloads, consistent error handling, service layer separation
- **23 stale debug .db files** across repo root and `sandbox_pms_mvp/` — should be cleaned up and `*.db` added to `.gitignore`
