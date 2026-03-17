# PMS Workflow Analysis

**Date:** 2026-03-17
**Scope:** Sandbox Hotel PMS — full operational workflow audit
**Primary source files:** `sandbox_pms_mvp/pms/services/`, `sandbox_pms_mvp/pms/app.py`, `sandbox_pms_mvp/pms/constants.py`

---

## Executive Summary

This document provides a structured end-to-end analysis of all major operational workflows in the Sandbox Hotel PMS. It covers the booking lifecycle, front-desk operations, housekeeping, payment processing, pre-check-in, messaging, authentication, and admin configuration. For each workflow it maps: the key steps and state transitions, the services and functions involved, inter-service dependencies, known risks, and current gaps.

The system is well-structured around a central service layer with separated concerns between public booking, staff operations, housekeeping, and payment. Core flows are transactionally safe and auditable. The most significant active risk is payment-webhook concurrency; the most operationally impactful recent repair was restoring housekeeping access to reservation detail after a RBAC rebalance.

---

## Workflow Inventory

| # | Workflow | Primary services | Risk level |
|---|---------|-----------------|-----------|
| 1 | Public booking hold / confirm | `public_booking_service`, `reservation_service` | High |
| 2 | Staff reservation management | `staff_reservations_service`, `reservation_service` | High |
| 3 | Check-in / check-out / walk-in | `front_desk_service`, `room_readiness_service`, `cashier_service` | High |
| 4 | Housekeeping status and tasks | `housekeeping_service`, `room_readiness_service` | Medium |
| 5 | Payment requests and webhooks | `payment_integration_service`, `cashier_service` | Critical |
| 6 | Pre-check-in | `pre_checkin_service`, `communication_service` | Medium |
| 7 | Messaging and notifications | `messaging_service`, `communication_service` | Medium |
| 8 | Authentication and RBAC | `auth_service`, `permissions` | High |
| 9 | Admin configuration | `admin_service` | Medium |

---

## 1. Public Booking Workflow

### Entry points
- `GET /book` or `GET /availability` — public room search
- `POST /booking/hold` — create a reservation hold
- `POST /booking/confirm` — confirm the hold into a reservation

### Flow

```
Guest searches availability
  └→ search_public_availability(payload)
       Checks: blackout periods, external calendar blocks, occupancy limits
       Returns: available room types with nightly and total rates

Guest creates a hold
  └→ create_reservation_hold(payload)
       Creates: ReservationHold (code HLD-XXXX, expiry 15–30 min)
       Enforces: rate limiting per IP, blackout enforcement
       Allocates: tentative inventory slot

Guest confirms booking
  └→ confirm_public_booking(payload)
       Validates: hold is still valid and unexpired
       Checks: duplicate booking (same guest / dates / room_type / amount within 15 min)
       Creates: Reservation (status = tentative or confirmed)
       Creates: deposit PaymentRequest if policy requires deposit
       Queues: guest_confirmation notification
       Queues: internal_new_booking_alert to staff
```

### Status transitions (public path)

```
[hold created]
    → tentative       (booking confirmed, deposit not yet received)
    → confirmed       (deposit not required or waived by staff)
```

### Key validations
- Blackout period enforcement (`assert_blackout_allows_booking`)
- External iCal calendar block check
- Occupancy limit check per room type
- Duplicate booking detection (15-minute window guard)
- IP-based rate limiting on hold and confirm endpoints

### Risk
- Hold expiry creates inventory races if a guest reconfirms a stale hold.
- Duplicate detection uses a time-window heuristic; two near-simultaneous identical bookings could still both succeed.
- Inventory allocation uses `SELECT FOR UPDATE` on `InventoryDay` rows to prevent concurrent over-allocation.

---

## 2. Staff Reservation Management Workflow

### Entry points
- `GET /staff/reservations` — reservation list with filters
- `GET /staff/reservations/<id>` — reservation detail (read-only; accessible with `reservation.view` **or** `housekeeping.view`)
- `POST /staff/reservations/<id>/update-guest` — edit guest profile
- `POST /staff/reservations/<id>/change-dates` — modify stay dates
- `POST /staff/reservations/<id>/assign-room` — assign a specific room
- `POST /staff/reservations/<id>/cancel` — cancel reservation
- `POST /staff/reservations/<id>/no-show` — mark no-show

### Flow

```
Staff views reservation detail
  └→ staff_reservations_service.get_reservation_detail(id, user)
       Returns: reservation + guest + folio summary (redacted if no folio.view)
       Access: reservation.view OR housekeeping.view

Staff modifies guest details
  └→ update_guest_details(reservation_id, payload)
       Updates: Guest record fields
       Logs: AuditLog + ActivityLog

Staff changes stay dates
  └→ change_stay_dates(reservation_id, payload)
       Re-quotes: nightly rates for new date range
       Reallocates: InventoryDay rows (releases old, allocates new)
       Updates: Reservation total and balance
       Requires: reservation.edit permission

Staff assigns a room
  └→ assign_room(reservation_id, room_id)
       Validates: room is assignable on given nights
       Locks: InventoryDay rows (SELECT FOR UPDATE)
       Requires: reservation.edit permission

Staff cancels
  └→ cancel_reservation_workspace(reservation_id, payload)
       Releases: InventoryDay allocations
       Records: cancellation fee if applicable
       Queues: cancellation_confirmation notification
       Requires: reservation.cancel permission

Staff marks no-show
  └→ mark_no_show(reservation_id)
       Posts: no-show fee (default 50% of deposit)
       Transitions: status → no_show
       Requires: reservation.check_in permission
```

### Status transitions (staff path)

```
tentative  ─────→ confirmed ──→ checked_in ──→ checked_out
    │                │
    └────────────────┴──→ cancelled
                         no_show
                         house_use
```

### Risk
- Date changes that shorten a stay must correctly release inventory for the removed nights.
- Concurrent date changes on the same reservation could corrupt inventory counts without row-level locking.

---

## 3. Check-in / Check-out Workflow

### Entry points
- `POST /staff/front-desk/check-in/<id>` — complete check-in
- `POST /staff/front-desk/check-out/<id>` — complete check-out
- `POST /staff/front-desk/walk-in` — create and immediately check in

### Check-in flow

```
complete_check_in(reservation_id, payload)
  1. Validates reservation status is tentative or confirmed
  2. Resolves room assignment
       a. Uses payload.room_id if provided, OR
       b. Auto-selects first clean/inspected/unblocked room of correct type
       → calls room_readiness_service.get_assignable_rooms()
  3. Collects guest identity
       Guest: nationality, ID document type, optional verification flag
  4. Processes optional advance payment
       → cashier_service.record_payment() if payment_amount provided
  5. Validates deposit requirement
       → payment_summary().deposit_required vs deposit_received
       → waiveable with operations.override permission
  6. Evaluates early check-in fee
       → evaluate_early_check_in(reservation, current_time)
       → Default threshold: 2 hours before standard check-in time
  7. Allocates inventory → occupied status
  8. Creates ReservationStatusHistory (checked_in)
  9. Queues check-in confirmation notification
```

### Check-out flow

```
complete_checkout(reservation_id, payload)
  1. Evaluates late check-out fee
       → evaluate_late_check_out(reservation, current_time)
  2. Ensures all room charges are posted
       → cashier_service.ensure_room_charges_posted(reservation)
  3. Collects final payment if balance remains
  4. Processes refund if overpaid
       → cashier_service.record_refund()
  5. Updates reservation status → checked_out
  6. Releases inventory → available (dirty housekeeping status)
  7. Creates checkout_clean housekeeping task
  8. Creates ReservationStatusHistory (checked_out)
```

### Walk-in flow

```
create_walk_in_and_check_in(payload)
  1. Creates a new Reservation (bypasses public booking / hold)
  2. Assigns room immediately
  3. Executes check-in steps 3–9 above
  All steps in a single database transaction
```

### Room readiness check

```
room_readiness_service.is_room_assignable(room_id, business_date)
  Returns: RoomReadiness {
    is_ready: housekeeping_status in (clean, inspected)
              AND not blocked
              AND not maintenance_flag
    is_blocked, blocked_reason
    active_task (HousekeepingTask)
  }
```

### Risk
- Check-in that auto-selects a room must hold the selected room atomically or two concurrent check-ins could assign the same room.
- Late check-out fee evaluation depends on accurate business-date clock.
- No-show processing posts a fee charge; if the reservation later proves to be a genuine arrival this must be manually voided.

---

## 4. Housekeeping Workflow

### Entry points
- `GET /staff/housekeeping` — housekeeping board
- `POST /staff/housekeeping/rooms/<id>/status` — update room status
- `POST /staff/housekeeping/tasks` — create task
- `POST /staff/housekeeping/tasks/<id>/assign` — assign task
- `POST /staff/housekeeping/tasks/<id>/start` — start task
- `POST /staff/housekeeping/tasks/<id>/complete` — complete task
- `POST /staff/housekeeping/tasks/<id>/inspect` — inspect task

### Room status machine

```
dirty
  ↓
cleaning_in_progress  (optional intermediate)
  ↓
clean
  ↓
inspected

Occupied variants:
  occupied_dirty → occupied_clean

Closure states (require operations.override):
  out_of_service
  out_of_order

Guest interaction states (no permission required):
  do_not_disturb
  sleep
  pickup       (light service requested)
```

### Task lifecycle

```
[open]
  → assigned        (assign_housekeeping_task)
  → in_progress     (start_housekeeping_task)
  → completed       (complete_housekeeping_task)
  → inspected       (inspect_housekeeping_task)
  → cancelled       (cancel_housekeeping_task, any state)
```

### Task priority levels
`low` → `normal` → `high` → `urgent`

### Operational notes
- Room notes are typed (housekeeping, maintenance, supervisor, lost_and_found, warning) with visibility scopes (front_desk, manager, all_staff).
- Bulk status update is available for supervisor-level operations.
- After guest check-out, the system automatically creates a `checkout_clean` task.
- Room readiness feeds directly into front-desk check-in room assignment.

### RBAC note
Housekeeping users require `housekeeping.view` to access operational data.
They may open the reservation detail page (redacted view, no folio) using either `reservation.view` or `housekeeping.view`. They cannot edit reservations, view payment data, or perform cashier actions.

### Risk
- Closure codes (`out_of_service`, `out_of_order`) that restrict inventory must not be accidentally removed without manager approval — the `operations.override` permission gate enforces this.
- Task assignment does not currently prevent two tasks from being assigned to the same room/attendant simultaneously.

---

## 5. Payment Workflow

### Overview
Payments follow a two-layer model: **PaymentRequest** (the business-level link) and **FolioCharge** (the folio line item). A hosted payment uses a third-party provider for the actual transaction; manual payments are recorded directly by cashier staff.

### Payment request types

| Type | Requires provider | Typical trigger |
|------|------------------|-----------------|
| `deposit_hosted` | Yes | Auto-created at booking confirmation if deposit required |
| `stay_balance_hosted` | Yes | Staff sends balance request to guest |
| `full_payment_hosted` | Yes | Staff requests full payment upfront |
| `deposit` | No | Manual deposit posting |
| `stay_balance` | No | Manual balance posting |

### Hosted payment flow

```
create_or_reuse_payment_request(reservation_id, request_kind, send_email, language)
  1. If a pending request with unchanged amount exists → reuse it
  2. Otherwise: mark old pending request expired, create new PaymentRequest
  3. Ensures guest has public_confirmation_token
  4. Generates code: PAY-{id.hex[:10].upper()}

generate_or_refresh_hosted_checkout(payment_request_id, force_new)
  1. Calls payment provider: provider.create_checkout()
  2. Stores: payment_url, provider_reference, expires_at

Guest opens payment_url in browser
  → Completes payment on provider-hosted page
  → Provider redirects to: /payment/return/{request_code}
  → load_public_payment_return() shows success/failure page

Provider fires webhook → /payment/webhook/{provider_name}
  └→ process_payment_webhook(provider_name, payload, headers)
       1. Verifies webhook signature (provider-specific)
       2. Normalizes event to: {payment_status, amount, reference}
       3. _apply_provider_event():
            status = success  → record_payment() + queue payment_success_email
            status = failed   → update PaymentRequest.status = failed
            status = expired  → update PaymentRequest.status = expired
```

### Manual cashier flow

```
Staff records a payment
  └→ cashier_service.record_payment(reservation_id, payload, actor_user_id)
       Creates: FolioCharge (type=payment, signed negative amount)
       Updates: deposit_received_amount
       Syncs: ReservationReviewQueue

Staff records a refund
  └→ cashier_service.record_refund(reservation_id, payload, actor_user_id)

Staff voids a charge
  └→ cashier_service.void_folio_charge(folio_charge_id, reason, actor_user_id)
       Creates: reverse FolioCharge (does not delete original)
       Requires: folio.adjust permission
```

### Folio document flow

```
cashier_service.issue_cashier_document(reservation_id, document_type)
  Types: folio, invoice, receipt
  Status: issued → voided
```

### Payment status machine

```
[pending]
  → paid       (webhook: payment_success)
  → failed     (webhook: payment_failed)
  → expired    (link expires or staff expires manually)
  → cancelled  (staff cancels)
```

### Risk
- **Webhook idempotency:** `_apply_provider_event` performs an application-level duplicate check (`PaymentEvent.query.filter_by(provider, provider_event_id)`) and the `PaymentEvent` table enforces a unique index on `(provider, provider_event_id)` (`ix_payment_events_provider_event`). However, two simultaneous webhook deliveries can both pass the application-level check before either inserts the row; the database unique index will raise an `IntegrityError` on the second insert. This error must be caught and treated as a "duplicate" rather than a 500 response.
- **Race condition on concurrent delivery:** the window between the application-level duplicate query and the `db.session.add(event)` call is a TOCTOU gap. Wrapping the insert in a `try/except IntegrityError` that returns `"duplicate"` is the correct guard.
- **Provider signature validation** must not be skipped — a missing or incorrect check allows forged payment confirmations.
- **Stale payment_url links:** once `payment_url` expires the guest cannot pay; `generate_or_refresh_hosted_checkout` with `force_new=True` is the recovery path.

---

## 6. Pre-Check-in Workflow

### Entry points
- `POST /staff/reservations/<id>/pre-checkin/send` — generate and send link
- `GET /pre-checkin/{token}` — guest-facing pre-check-in form
- `POST /pre-checkin/{token}/save` — save progress
- `POST /pre-checkin/{token}/submit` — submit pre-check-in
- `POST /pre-checkin/{token}/document` — upload ID document
- `POST /staff/pre-checkin/<id>/verify-document` — staff verifies document

### Flow

```
Staff sends pre-check-in link
  └→ pre_checkin_service.generate_pre_checkin(reservation_id, expiry_days=14)
       Creates: PreCheckIn record with secure token
       Sends: pre_checkin_link_email to guest

Guest opens link
  └→ load_pre_checkin_by_token(token)
       Validates: token not expired, reservation still active
       Marks: status = opened

Guest fills form
  └→ save_pre_checkin(pc, payload, submit=False)
       Status: in_progress (partial save)
       
Guest submits
  └→ save_pre_checkin(pc, payload, submit=True)
       Validates: required fields present
       Status: submitted
       Appends: special_requests to reservation

Guest uploads identity document
  └→ upload_document(pc, file, document_type)
       Validates: PDF/PNG/JPG only, max 10 MB
       Creates: ReservationDocument (status=pending)

Staff reviews document
  └→ verify_document(document_id)   → PreCheckIn.readiness = id_uploaded
  └→ reject_document(document_id, reason) → status = incomplete
```

### Pre-check-in status machine

```
not_sent
  → sent
      → opened
           → in_progress
                → submitted
                     → verified
                     → incomplete  (doc rejected, needs resubmit)
  → expired       (token past expiry date)
  → rejected      (manual staff rejection)
```

### Arrival readiness states

```
awaiting_guest     (pre-checkin not started)
docs_missing       (submitted but no document)
id_uploaded        (document uploaded, awaiting verification)
signature_missing  (needs e-signature step)
payment_pending    (deposit not yet received)
ready_for_arrival  (all checks passed)
```

### Automation
- `fire_pre_checkin_not_completed_events(hours_before=48)` sends a reminder 48 hours before arrival if submission not complete.
- OCR extraction can auto-populate guest fields if `suggest_ocr_extraction` is configured.

### Risk
- Token security relies on single-use token uniqueness and expiry enforcement. Token rotation on status change is recommended.
- File upload validation must occur server-side; client-side validation alone is insufficient.

---

## 7. Messaging and Communication Workflow

### Two-layer design

| Layer | Service | Purpose |
|-------|---------|---------|
| Transactional notifications | `communication_service` | System-triggered one-way emails/alerts |
| Guest messaging hub | `messaging_service` | Two-way threaded conversations per channel |

### Notification types (communication_service)

| Type | Trigger |
|------|---------|
| `guest_confirmation` | Booking confirmed |
| `deposit_payment_request` | Deposit link created |
| `payment_success` | Payment webhook success |
| `payment_failed` | Payment webhook failed |
| `pre_arrival_reminder` | Scheduled 24/48h before arrival |
| `cancellation_confirmation` | Reservation cancelled |
| `modification_confirmation` | Stay dates changed |
| `internal_new_booking_alert` | New booking received |
| `internal_activity_alert` | Staff action summary |

### Notification delivery flow

```
queue_*(reservation/payment_request)
  └→ Creates: NotificationDelivery (status=queued, dedupe_key)

dispatch_notification_deliveries(batch_size=50)
  └→ Selects: up to 50 queued deliveries
  └→ For each: renders template, sends via channel adapter
       Channels: email, internal_notification, line_staff_alert, whatsapp_staff_alert
  └→ Creates: DeliveryAttempt (success/failure/retry_later)
```

### Deduplication
Each delivery has a `dedupe_key`. If the same key is already queued or sent, a new delivery is not created.

### Messaging hub (messaging_service)

```
Inbox management
  └→ list_inbox(filters)   → InboxEntry[] (unread count, last message, guest)
  └→ get_thread_detail(id) → ThreadDetail {thread, messages, guest, reservation}

Staff composes a message
  └→ get_or_create_thread(guest_id, reservation_id, channel)
  └→ send_message(ComposePayload, actor_user_id)
       Creates: Message (outbound)
       Optionally: renders MessageTemplate with context tokens

Inbound webhook (guest replies)
  └→ record_inbound_message(message_data, channel)
       Creates: Message (inbound)
       Marks: thread as unread

Thread workflow
  └→ assign_thread(thread_id, user_id)
  └→ close_thread(thread_id)
  └→ reopen_thread(thread_id)
  └→ toggle_followup(thread_id)
```

### Thread status machine

```
open → waiting (awaiting guest response)
     → closed
     → archived
```

### Automation events (messaging_service)

| Event | Default trigger |
|-------|----------------|
| `reservation_created` | At booking confirmation |
| `pre_checkin_not_completed` | 48 hours before arrival |
| `arrival_today` | Day of arrival |
| `room_ready` | After room marked inspected |
| `payment_due` | When balance payment link sent |
| `checkout_completed` | After check-out |

Delayed automations use `PendingAutomationEvent` and are processed by `process_pending_automations()`.

### Risk
- Sequential notification dispatch (batch_size=50) may not scale for large busy periods; consider async or background worker.
- Template token errors only surface at render time; invalid template configurations should be validated at save time.
- Two separate notification systems (communication_service and messaging_service) create routing ambiguity for some event types.

---

## 8. Authentication and RBAC Workflow

### Auth flow

```
Staff submits login form
  └→ auth_service.login_with_password(identifier, password, ip, user_agent)
       1. Rate-checks IP (max attempts per window)
       2. Validates: account state in (active, password_reset_required)
       3. Verifies: bcrypt password hash
       4. If MFA enabled: returns {requires_mfa: True, session.mfa_pending=True}
       5. Otherwise: returns {success: True, session, cookie_value}

Staff completes MFA (if required)
  └→ auth_service.verify_mfa_for_session(session, totp_code)
       1. Validates TOTP code (or recovery code)
       2. Rotates session: revokes pending session, creates new verified session
       3. Returns: {new_session, cookie_value}

Staff is authenticated
  └→ auth_service.load_session_from_cookie(cookie_value)
       Returns: (UserSession, User) on every request
```

### Account state machine

```
invited
  → active          (first password set)
  → password_reset_required  (admin forced reset)
  → locked          (too many failed attempts)
  → disabled        (admin action)
```

### Roles and permissions

| Role | Key permissions |
|------|----------------|
| `admin` | All permissions |
| `manager` | reservation.*, folio.*, payment.*, housekeeping.*, operations.override, messaging.*, settings.view, user.view/create |
| `front_desk` | reservation.view/create/edit/check_in/check_out, folio.view/charge_add, payment.read/create, housekeeping.view |
| `housekeeping` | housekeeping.view/status_change/task_manage, reservation.view (read-only, folio hidden) |
| `provider` | Limited channel-partner read access |

### Permission check pattern
```python
# Route handler level
@require_permission("reservation.view")   # 403 if missing

# OR multi-permission check (any of)
if not (user.has_permission("reservation.view") or
        user.has_permission("housekeeping.view")):
    abort(403)

# Template level
{% if can("folio.view") %}...{% endif %}
```

### MFA enrollment flow

```
create_totp_factor(user)
  → Returns: (MfaFactor, qr_code_url)

Staff scans QR, enters code
  → confirm_totp_enrollment(user, factor_id, code)
  → Returns: [recovery_codes]

MFA active on next login
```

### Session management
- Sessions are stored in the database (`UserSession`).
- A session rotates on MFA completion to prevent session fixation.
- `revoke_all_user_sessions(user_id)` is used on password reset and account lock.

### Risk
- Rate limiting on the login route must be persistent across restarts (database-backed, not in-memory).
- Session cookie should be `HttpOnly`, `Secure`, and `SameSite=Strict` in production.
- TOTP recovery codes are single-use and must be invalidated after use.

---

## 9. Admin Configuration Workflow

### Settings and rates

```
upsert_setting(key, value, value_type)
  → Stores key-value pairs in AppSetting table
  → Used by all services for runtime configuration

upsert_rate_rule(RateRulePayload)
  Types: base_rate, seasonal_override, holiday_override,
         weekday_override, weekend_override, long_stay_discount
  → Applied at booking time via rate calculation service

create_inventory_override(InventoryOverridePayload)
  Actions: open (re-opens closed inventory), close (blocks availability)
  Scope: single room OR full room_type
```

### Blackout management

```
upsert_blackout_period(BlackoutPayload)
  Types:
    closed_to_booking    → no new bookings accepted
    no_arrival           → check-ins blocked
    no_departure         → check-outs blocked
    property_closed      → all activity blocked

assert_blackout_allows_booking(check_in_date, check_out_date)
  → Called at every booking attempt; raises ValidationError if blocked
```

### Policy documents

| Code | Purpose |
|------|---------|
| `cancellation_policy` | Guest cancellation terms |
| `no_show_policy` | No-show fee terms |
| `check_in_policy` | Check-in time and requirements |
| `check_out_policy` | Check-out time and requirements |
| `child_extra_guest_policy` | Child/extra guest rules |
| `privacy_notice` | Data privacy disclosure |

All policies are multilingual (Thai/English/Chinese).

### Audit logging
Every admin action that mutates configuration creates:
- `AuditLog` (structured before/after JSON)
- `ActivityLog` (event stream with actor/timestamp)

```
query_audit_entries(filters) → [AuditLog]
summarize_audit_entry(entry) → str (human-readable summary)
```

### Risk
- Rate rule application order must be deterministic; overlapping seasonal + weekday overrides could produce unexpected prices if priority is not well-defined.
- Setting keys are currently scattered across service calls with no central registry; a typo in a key silently falls back to a default.

---

## 10. State Machine Reference

### Reservation status

```
inquiry ──────────────────────────────────────────────────┐
                                                           │
tentative ──→ confirmed ──→ checked_in ──→ checked_out    │
    │              │                                       │
    └──────────────┴──→ cancelled                         │
                    └──→ no_show                           │
                    └──→ house_use                         │
                                                           │
waitlist ─────────────────────────────────────────────────┘
```

### PaymentRequest status

```
pending ──→ paid
        └─→ failed
        └─→ expired
        └─→ cancelled
```

### HousekeepingTask status

```
open ──→ assigned ──→ in_progress ──→ completed ──→ inspected
  │          │              │
  └──────────┴──────────────┴──→ cancelled
```

### Room housekeeping status

```
dirty ──→ cleaning_in_progress ──→ clean ──→ inspected
                 │                   │
                 └───────────────────┘  (can cycle)

Occupied: occupied_dirty ──→ occupied_clean

Closures (require override):
  out_of_service
  out_of_order

Guest-set (no permission required):
  do_not_disturb
  sleep
  pickup
```

### PreCheckIn status

```
not_sent ──→ sent ──→ opened ──→ in_progress ──→ submitted ──→ verified
                                                     │
                                                     └──→ incomplete (re-open)
         └──→ expired
         └──→ rejected
```

### Staff account status

```
invited ──→ active ──→ password_reset_required ──→ active
                   └──→ locked
                   └──→ disabled
```

---

## 11. Service Dependency Graph

```
public_booking_service
    ├→ reservation_service
    ├→ availability_service
    ├→ admin_service          (blackout checks, rate rules)
    ├→ communication_service  (confirmation, staff alert queuing)
    ├→ ical_service           (external calendar block checks)
    ├→ extras_service         (room type extras pricing)
    └→ payment_integration_service  (deposit request creation)

front_desk_service
    ├→ staff_reservations_service
    ├→ cashier_service
    ├→ housekeeping_service   (task creation on checkout)
    ├→ room_readiness_service (assignability checks)
    └→ communication_service

staff_reservations_service
    ├→ reservation_service
    ├→ extras_service
    ├→ communication_service
    └→ ical_service

payment_integration_service
    ├→ cashier_service        (applies payment to folio)
    ├→ communication_service  (payment_success/failed emails)
    └→ admin_service          (provider config settings)

messaging_service
    ├→ admin_service          (message templates, settings)
    └→ communication_service  (shared delivery adapters)

pre_checkin_service
    ├→ communication_service
    └→ storage_service        (document file storage)

housekeeping_service
    └→ admin_service          (settings, override permissions)

auth_service
    └→ communication_service  (password reset emails)

reporting_service
    ├→ reservation_service    (source data)
    └→ cashier_service        (folio data)
```

---

## 12. Risk and Gap Register

### Critical risks

| # | Area | Risk | Mitigation status |
|---|------|------|-------------------|
| C1 | Payment webhook | Concurrent webhook delivery could cause a TOCTOU gap between the app-level duplicate check and the DB insert; an `IntegrityError` from the unique index on `PaymentEvent(provider, provider_event_id)` must be caught and returned as "duplicate" rather than a 500 | Application-level check exists; DB unique index exists; `IntegrityError` catch needs verification |
| C2 | Payment webhook | Missing or incorrect signature validation allows forged events | Signature verification exists; must not be bypassable by configuration |

### High risks

| # | Area | Risk | Mitigation status |
|---|------|------|-------------------|
| H1 | Check-in room assignment | Concurrent check-ins could assign the same room | `SELECT FOR UPDATE` on InventoryDay reduces (but may not eliminate) the race |
| H2 | Public booking hold | Stale hold reconfirmation creates inventory over-allocation | Hold expiry check at confirm time is in place |
| H3 | RBAC | Over-restrictive permission changes silently block operational workflows | Reservation detail access for housekeeping was repaired (see `system_process_audit.md`) |
| H4 | Session security | Session cookies without `Secure` / `SameSite` expose session hijacking risk | Must be verified in deployment configuration |

### Medium risks

| # | Area | Risk | Mitigation status |
|---|------|------|-------------------|
| M1 | Notification dispatch | Sequential batch dispatch does not scale under load | Acceptable for current volume; refactor before scaling |
| M2 | Rate calculation | Overlapping rate rules may produce unpredictable prices | Rule priority ordering should be documented and tested |
| M3 | Setting keys | No central registry; typos silently fall back to defaults | Accepted for now; a settings enum would improve safety |
| M4 | Duplicate notification systems | communication_service and messaging_service have overlapping responsibilities | Routing documented; consolidation is a future candidate |
| M5 | Pre-check-in token | Token not rotated on status change | Low exploitability; improvement documented for future sprint |

### Known feature gaps

| # | Gap | Impact |
|---|-----|--------|
| G1 | Partial stay cancellation | Full stay cancel only; partial requires rebooking |
| G2 | Stay extension | Not supported; requires cancel + rebook |
| G3 | Room swap during stay | Not supported natively |
| G4 | Multi-payment installments | Only deposit + balance (two-step); no installment schedules |
| G5 | Hard overbooking prevention | Inventory locking reduces but does not provide strict guarantee under very high concurrency |
| G6 | Promotional codes / coupons | Not implemented |
| G7 | Multi-property support | Single-property only |
| G8 | Setting key registry | No compiled list of all valid setting keys and their defaults |
| G9 | Notification template token reference | Token names per template not centrally documented |

---

## 13. Recommendations

### Immediate (before next payment-provider cutover)

1. **Verify webhook IntegrityError handling** (`C1`): Confirm that `_apply_provider_event` catches `sqlalchemy.exc.IntegrityError` on the `PaymentEvent` insert and returns `"duplicate"` rather than propagating a 500. The `PaymentEvent` table already has a unique index on `(provider, provider_event_id)`; the gap to close is the error handler around the insert. Add a concurrent-delivery test (two simultaneous POST events with the same `provider_event_id`) to confirm exactly one FolioCharge is created.
2. **Review session cookie flags** (`H4`): Confirm `SESSION_COOKIE_SECURE=True`, `SESSION_COOKIE_HTTPONLY=True`, `SESSION_COOKIE_SAMESITE='Strict'` in production Flask config.

### Short-term (next sprint)

3. **Add concurrent-delivery test coverage** for payment webhook (two simultaneous identical POST events must result in exactly one FolioCharge).
4. **Document rate rule priority** in admin panel help text and in `admin_service.py` docstrings.
5. **Create a setting key registry** (a constants file or admin validation list) so typos fail loudly at startup rather than silently at runtime.

### Medium-term

6. **Consolidate notification routing**: Define which event types go through `communication_service` versus `messaging_service` automation and document the boundary explicitly.
7. **Async notification dispatch**: Move `dispatch_notification_deliveries` to a background worker (Celery, RQ, or Render cron job) to prevent blocking the request cycle during busy periods.
8. **Room swap during stay**: Add a `transfer_room_assignment` service function that moves an active reservation to a new room, updates inventory, and creates an audit entry.

### Later

9. **Partial stay cancellation**: Add support for shortening a confirmed reservation from the check-out end while keeping the reservation active.
10. **Promotional codes**: Add a `DiscountCode` model and validation step in `public_booking_service.confirm_public_booking`.

---

## Related documents

| Document | Content |
|----------|---------|
| `state_flow_map.md` | High-level state flow diagrams (booking, payment, room, housekeeping, auth) |
| `system_process_audit.md` | Process inventory with per-process issue tracking and fix status |
| `system_risk_register.md` | Full operational risk register |
| `HOUSEKEEPING_AUDIT.md` | Focused housekeeping module audit |
| `docs/reservation-control-layer.md` | Reservation permission and control layer reference |
| `docs/housekeeping-readiness-sync.md` | Housekeeping-to-front-desk readiness sync specification |
| `docs/dashboards-and-reports.md` | Reporting and KPI definitions |
