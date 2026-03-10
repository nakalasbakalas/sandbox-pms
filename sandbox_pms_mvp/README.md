# Sandbox Hotel PMS

Production-oriented Sandbox Hotel PMS on the existing Flask stack, designed PostgreSQL-first. The repo now includes the Phase 2 operating data layer, the Phase 3 staff authentication and authorization layer, the Phase 4 public booking flow, the Phase 5 staff reservations workspace, the Phase 6 front-desk check-in / check-out workspace, the Phase 7 housekeeping operations board, the Phase 8 cashier / folio module, the Phase 9 hosted deposit payment integration, the Phase 10 admin and hotel configuration panel, the Phase 11 notifications and communication layer, and the Phase 12 manager dashboard and reporting workspace on top of it.

## Stack

- Flask
- Flask-SQLAlchemy
- Flask-Migrate / Alembic
- PostgreSQL as source of truth
- SQLite retained only for local/demo compatibility and CI-style migration tests

## What The Repo Implements

- Deterministic Alembic baseline migration in [migrations/versions/20260307_01_phase2_baseline.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/migrations/versions/20260307_01_phase2_baseline.py)
- UUID-based business tables with audit fields on mutable records
- RBAC tables: `users`, `roles`, `permissions`, `user_roles`, `role_permissions`
- Staff auth security tables: `user_sessions`, `password_reset_tokens`, `auth_attempts`, `mfa_factors`, `mfa_recovery_codes`, `user_password_history`, `activity_log`
- Hotel operating data: `room_types`, `rooms`, `housekeeping_statuses`, `rate_rules`, `app_settings`
- Reservation core: `guests`, `guest_notes`, `reservations`, `reservation_notes`, `reservation_status_history`, `inventory_days`
- Financial and audit ledgers: `folio_charges`, `cashier_documents`, `cashier_document_sequences`, `cashier_activity_log`, `payment_requests`, `payment_events`, `audit_log`
- Public booking workflow: `reservation_holds`, `reservation_review_queue`, `staff_notifications`, `cancellation_requests`, `modification_requests`, `email_outbox`, `notification_deliveries`
- Housekeeping operations: `room_notes`, `room_status_history`, extended `inventory_days` fields for block / maintenance / cleaned / inspected state
- Admin configuration: `inventory_overrides`, `blackout_periods`, `policy_documents`, `notification_templates`
- Notification orchestration service in [communication_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/communication_service.py)
- Transaction-safe reservation create/cancel service in [reservation_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/reservation_service.py)
- Transaction-safe public availability, hold, and booking confirmation flow in [public_booking_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/public_booking_service.py)
- Staff reservations workspace query/mutation service in [staff_reservations_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/staff_reservations_service.py)
- Front-desk arrivals / in-house / departures service in [front_desk_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/front_desk_service.py)
- Housekeeping board, room detail, and status-control service in [housekeeping_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/housekeeping_service.py)
- Hosted payment orchestration service in [payment_integration_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/payment_integration_service.py)
- Admin configuration service in [admin_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/admin_service.py)
- Manager dashboard and reporting service in [reporting_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/reporting_service.py)
- Idempotent Phase 2 seed path in [seeds.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/seeds.py)
- Backup and restore scripts under [scripts](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/scripts)
- Integration tests for schema, seeds, reservation invariants, public booking reliability, staff workspace operations, audit, soft delete, and script artifacts

## Schema Summary

Core domains:

- Identity: `users`, `roles`, `permissions`, `user_roles`, `role_permissions`
- Staff authentication: `user_sessions`, `password_reset_tokens`, `auth_attempts`, `mfa_factors`, `mfa_recovery_codes`, `user_password_history`, `activity_log`
- Guest profile: `guests`, `guest_notes`
- Inventory: `room_types`, `rooms`, `housekeeping_statuses`, `inventory_days`
- Commercial rules: `rate_rules`, `app_settings`
- Reservation lifecycle: `reservations`, `reservation_notes`, `reservation_status_history`
- Public booking operations: `reservation_holds`, `reservation_review_queue`, `staff_notifications`, `cancellation_requests`, `modification_requests`, `email_outbox`, `notification_deliveries`
- Housekeeping operations: `room_notes`, `room_status_history`, `inventory_days`
- Admin and configuration: `inventory_overrides`, `blackout_periods`, `policy_documents`, `notification_templates`, `app_settings`
- Billing and payments: `folio_charges`, `cashier_documents`, `cashier_document_sequences`, `cashier_activity_log`, `payment_requests`, `payment_events`
- Audit: `audit_log`

Key integrity rules:

- `reservations.reservation_code` is immutable, unique, and sequence-backed as `SBX-00000001`, `SBX-00000002`, ...
- `inventory_days` is the nightly room allocation ledger with `unique(room_id, business_date)`
- no overbooking path exists in the reservation service
- no overbooking path exists in either the staff reservation service or the public booking service
- append-only behavior is enforced in PostgreSQL for `reservation_status_history`, `folio_charges`, `payment_events`, and `audit_log`
- mutable business tables have `created_at`, `updated_at`, `created_by_user_id`, `updated_by_user_id`

## Staff Authentication And Authorization

The staff auth layer is implemented in [app.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/app.py) and [auth_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/auth_service.py).

Authentication model:

- staff users sign in with email or username plus password
- passwords are stored with Argon2id through a centralized service
- legacy Werkzeug hashes are accepted and rehashed to Argon2id on successful sign-in
- successful sign-in creates a database-backed `user_sessions` row and an HttpOnly cookie carrying `selector.token`
- session idle timeout defaults to 15 minutes and absolute lifetime defaults to 8 hours
- session revocation happens on logout, password reset, MFA disable, and explicit session revoke actions
- HTML form POST routes are protected by synchronizer-token CSRF validation backed by the Flask session cookie

Password reset flow:

- `/staff/forgot-password` returns a generic success response whether or not an account exists
- reset tokens are random, single-use, stored as hashes, and expire by configuration
- successful reset clears lockout state, revokes prior sessions, writes activity, and queues a notification email

Throttling and lockout:

- `auth_attempts` stores login and MFA failures
- after 5 failed attempts inside 15 minutes, the account is locked for 15 minutes
- IP-based defense-in-depth rate limiting applies to repeated failed logins
- password reset requests are rate-limited per user
- MFA verification attempts are limited through the same auth-attempt stream

MFA design:

- TOTP authenticator app support is implemented now
- recovery codes are generated during enrollment and stored only as hashes
- staff can enroll or disable their own MFA from `/staff/security`
- admin and manager users can disable MFA for another staff account from `/staff/users`
- login creates a pending session first, then rotates into a fully authenticated session after MFA verification

Protected staff routes:

- `/staff/login`
- `/staff/forgot-password`
- `/staff/reset-password/<token>`
- `/staff/mfa/verify`
- `/staff/security`
- `/staff/users`
- `/staff/settings`
- `/staff/rates`
- `/staff/reports`
- `/staff/audit`
- `/staff/front-desk`
- `/staff/front-desk/<reservation_id>`

Permission strategy:

- backend authorization is enforced through `require_permission(...)`, not only hidden UI actions
- `reservation.view` protects the daily staff workspace
- `settings.view` and `settings.edit` protect hotel settings
- `rate_rule.view` protects rate visibility
- `reports.view` protects reports
- `user.view`, `user.create`, `user.edit`, `user.disable`, `auth.reset_password_admin`, and `auth.manage_mfa` protect staff administration
- `audit.view` protects audit visibility

## Public Booking Architecture

The public flow is implemented in [public_booking_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/public_booking_service.py) and the public/staff views in [app.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/app.py).

Flow:

1. Public availability search validates `[check_in_date, check_out_date)` and occupancy, then queries live `inventory_days` rows for truly sellable rooms only.
2. When the guest proceeds, the app creates a short-lived `reservation_holds` row and atomically marks the matching `inventory_days` rows as `held`.
3. Final booking submit uses the hold code and idempotency key, re-locks the held rows, creates the guest and reservation, appends status history, creates a staff review queue item and staff notification, and converts inventory to `reserved`.
4. After commit, an `email_outbox` entry is dispatched for the guest confirmation. Booking commit does not roll back if SMTP delivery fails.
5. Public confirmation uses `reservation_code` plus a confirmation token so refreshes are safe and duplicate bookings are not created.

Key reliability rules:

- `inventory_days` remains the authoritative availability ledger
- control rooms `216` and `316` are never returned publicly
- holds expire automatically and cleanup releases inventory
- final confirm is idempotent on the hold/idempotency pair
- recent near-identical public submissions are deduplicated instead of creating a second reservation

## Public Booking Content

The public flow supports:

- Thai primary copy with English and Simplified Chinese in [i18n.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/i18n.py)
- source tracking on public reservations through `source_channel` and `source_metadata_json`
- cancellation requests and modification requests linked back to real reservations
- a staff review queue for new public reservations and follow-up visibility
- policy acceptance captured on the reservation via `terms_accepted_at` and `terms_version`

## Staff Reservations Workspace

The staff workspace is implemented in [app.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/app.py), [staff_reservations_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/staff_reservations_service.py), and the staff templates under [templates](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates).

Key capabilities:

- reservation list with search by guest name, phone, reservation code, and date
- filterable operational list by status, room type, arrival, departure, payment state, source, review state, and room assignment
- reservation detail view with guest profile, stay/pricing summary, payment/deposit status, notes, and timeline
- transaction-safe stay-date edits with repricing and inventory reallocation
- transaction-safe room reassignment without double-booking
- reservation cancellation with inventory release and status history
- internal reservation notes with author and timestamp metadata
- resend confirmation email through the existing outbox flow
- dedicated arrivals, departures, and in-house operational views

Permission model:

- `reservation.view`: dashboard, reservation list, detail, arrivals, departures, in-house, review queue
- `reservation.edit`: guest edits, stay-date changes, room assignment, internal notes, resend confirmation
- `reservation.cancel`: cancellation workflow
- `folio.view`: payment and deposit summary visibility inside the detail screen

Mutation rules:

1. Load the authoritative reservation row.
2. Acquire inventory row locks for inventory-sensitive changes.
3. Validate occupancy, dates, and eligible rooms.
4. Apply repricing and inventory updates atomically.
5. Write audit and activity records before commit.
6. Trigger non-critical email side effects only after commit.

Primary workspace routes:

- `/staff/reservations`
- `/staff/reservations/<reservation_id>`
- `/staff/reservations/arrivals`
- `/staff/reservations/departures`
- `/staff/reservations/in-house`
- `/staff/reservations/<reservation_id>/guest`
- `/staff/reservations/<reservation_id>/dates`
- `/staff/reservations/<reservation_id>/room`
- `/staff/reservations/<reservation_id>/cancel`
- `/staff/reservations/<reservation_id>/notes`
- `/staff/reservations/<reservation_id>/resend-confirmation`

## Front-Desk Workspace

The front-office workspace is implemented in [app.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/app.py), [front_desk_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/front_desk_service.py), and the dedicated templates [front_desk_workspace.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/front_desk_workspace.html) and [front_desk_detail.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/front_desk_detail.html).

Operational views:

- arrivals workspace with room readiness, assignment, deposit state, early-arrival flags, and quick open actions
- departures workspace with balance visibility, refund visibility, and housekeeping handoff expectations
- in-house workspace with room occupancy awareness and room-move access
- walk-in create-and-check-in form that uses the same reservation, pricing, and inventory path as all other reservations

Front-desk mutation rules:

1. Load the authoritative reservation state and acquire row locks before any occupancy-sensitive change.
2. Revalidate room readiness and room conflict state at check-in time.
3. Revalidate balance, fee, and refund state at checkout time.
4. Update reservation lifecycle, inventory occupancy, and housekeeping handoff in one commit.
5. Write `reservation_status_history`, `activity_log`, and `audit_log` entries for each critical action.

Supported workflows:

- check-in with identity capture, room reassignment, deposit collection, and early check-in fee apply/waive handling
- checkout with payment collection, late check-out fee apply/waive handling, refund visibility, and dirty-room turnover handoff
- checked-in room moves through the existing inventory-safe reassignment service
- no-show processing with status history, inventory release, and optional no-show charge request creation

Front-desk routes:

- `/staff/front-desk`
- `/staff/front-desk/walk-in`
- `/staff/front-desk/<reservation_id>`
- `/staff/front-desk/<reservation_id>/room`
- `/staff/front-desk/<reservation_id>/check-in`
- `/staff/front-desk/<reservation_id>/check-out`
- `/staff/front-desk/<reservation_id>/no-show`

Front-desk permission model:

- `reservation.view`: arrivals, departures, in-house, and front-desk detail visibility
- `reservation.check_in`: check-in completion
- `reservation.check_out`: checkout completion
- `reservation.edit`: room reassignment / in-house room move
- `reservation.cancel` or `reservation.check_in`: no-show processing
- `folio.view`: balance, deposit, refund, and folio visibility
- `folio.charge_add`: early / late fee posting
- `payment.create`: payment collection from the front-desk workflow
- `payment.refund`: refund visibility and checkout refund processing where allowed

Operational caveats:

- check-in uses room housekeeping status as the readiness source of truth and blocks rooms that are not `clean` or `inspected`
- checkout marks the checkout-date room row dirty and non-sellable until housekeeping turns it back over
- early and late fee amounts come from `app_settings`, not hardcoded UI values
- the current implementation records identity verification on the reservation; it does not yet store scanned document artifacts

## Cashier Module

The cashier module is implemented in [app.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/app.py), [cashier_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/cashier_service.py), and the templates [cashier_folio.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/cashier_folio.html) and [cashier_print.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/cashier_print.html).

Authoritative folio model:

- each reservation has an authoritative folio view computed from posted `folio_charges`
- `folio_charges` is the cashier ledger for room, deposit, payment, manual charge, manual discount, fee, refund, and correction lines
- `cashier_documents` stores issued folio/invoice/receipt documents with stable numbers
- `cashier_activity_log` stores append-only cashier events separate from raw ledger lines
- payment and deposit collection continue to write `payment_requests` and `payment_events` so cashier activity reconciles with the wider payment trail

Charge posting rules:

- room charges are auto-posted from authoritative reservation/rate data and are duplicate-safe via `posting_key`
- manual charge, manual discount, and correction lines require explicit description and internal note
- deposits and payments are explicit credit lines, not hidden scalar toggles
- refunds are explicit folio lines or pending payment events depending on processing state
- voiding a posted line creates a reversing correction and marks the original line voided; history is never hard-deleted

Balance and settlement logic:

- charges subtotal, discount subtotal, tax subtotal, credits, outstanding balance, unused deposit, and refund due are calculated server-side from the ledger
- settlement states are derived as `settled`, `unpaid`, `partially_paid`, or `overpaid`
- reservation detail, front-desk, checkout, and cashier screens now read the same folio summary service

Document numbering:

- invoice and receipt numbers are generated through `cashier_document_sequences`
- numbering is per document type and business date, for example `INV-20260309-0001` and `RCT-20260309-0001`
- issuance is idempotent per reservation and document type
- issuance is a POST action, not a mutating GET, so it remains CSRF-protected and auditable

Cashier routes:

- `/staff/cashier/<reservation_id>`
- `/staff/cashier/<reservation_id>/room-charges`
- `/staff/cashier/<reservation_id>/adjustments`
- `/staff/cashier/<reservation_id>/payments`
- `/staff/cashier/<reservation_id>/refunds`
- `/staff/cashier/<reservation_id>/lines/<charge_id>/void`
- `/staff/cashier/<reservation_id>/documents`
- `/staff/cashier/<reservation_id>/print`

Cashier permission model:

- `folio.view`: folio summary, line history, activity log, print preview, and document visibility
- `folio.charge_add`: room auto-posting, manual revenue charges, and operational fee posting
- `folio.adjust`: manual discounts, corrections, and line void/reversal actions
- `payment.create`: payment and deposit recording
- `payment.refund`: refund processing

Operational caveats:

- room-charge auto-posting currently runs from the cashier screen and checkout path; it is structured to fold into a later night-audit module cleanly
- printable folio output is guest-facing and omits internal adjustment notes, while the cashier screen retains the internal operational detail
- tax is stored with the same sign as the line total so discounts and reversals reduce tax correctly instead of inflating it

## Hosted Deposit Payments

The hosted payment integration is implemented in [payment_integration_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/payment_integration_service.py), the payment routes in [app.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/app.py), and the public/staff templates [public_confirmation.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/public_confirmation.html), [public_payment_return.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/public_payment_return.html), and [cashier_folio.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/cashier_folio.html).

Architecture:

- deposit collection is the only supported hosted-payment scope in this phase
- the PMS never collects raw card data; guests are redirected to a provider-hosted checkout page
- provider-specific logic is isolated behind a payment-provider adapter layer
- `payment_requests` stores the internal request lifecycle and provider references
- `payment_events` is the append-only provider/event stream
- folio application happens only from authoritative provider confirmation, not from redirect return alone

Lifecycle:

1. Create or reuse a pending deposit `payment_request`.
2. Generate or refresh a hosted checkout session server-side.
3. Email the guest a PMS payment link that safely redirects into hosted checkout.
4. Show a guest return page that may still be pending until webhook confirmation arrives.
5. Process provider webhooks idempotently and normalize them into internal statuses.
6. Apply the paid deposit into the cashier ledger exactly once using a deterministic folio `posting_key`.

Normalized statuses:

- `pending`
- `paid`
- `failed`
- `expired`
- `cancelled`

Routes:

- `/payments/request/<request_code>`
- `/payments/return/<request_code>`
- `/webhooks/payments/<provider_name>`
- `/staff/cashier/<reservation_id>/payment-requests`
- `/staff/cashier/<reservation_id>/payment-requests/<payment_request_id>/resend`
- `/staff/cashier/<reservation_id>/payment-requests/<payment_request_id>/refresh`

Permission model:

- `payment.read`: view payment request state and refresh status
- `payment_request.create`: create deposit requests and resend payment links
- `folio.view`: see folio-side deposit application results
- `settings.edit`: update operational payment settings from the admin payments panel

Operational caveats:

- Stripe is the production hosted-checkout adapter in code, but local automated tests run against the built-in `test_hosted` adapter
- redirect return is intentionally not final truth; webhook or provider sync confirms the authoritative result
- duplicate webhook delivery is safe because provider events and folio posting both use idempotent keys

## Notifications And Communications

The communication layer is implemented in [communication_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/communication_service.py), the notification-aware admin routes in [app.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/app.py), and the admin/templates integration in [admin_communications.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/admin_communications.html), [admin_operations.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/admin_operations.html), [reservation_detail.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/reservation_detail.html), [front_desk_detail.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/front_desk_detail.html), [cashier_folio.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/cashier_folio.html), and [staff_dashboard.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/staff_dashboard.html).

Architecture:

- business services queue communication records after authoritative reservation, payment, and cashier writes succeed
- `notification_deliveries` is the normalized delivery/outbox model for guest and staff communication state
- `notification_templates` remains the managed source of truth for subjects, bodies, language variants, and channel variants
- `email_outbox` continues to back the actual SMTP queue, while internal and optional external staff channels write through the same delivery model
- brand/footer values are rendered from admin-managed hotel settings instead of duplicated literals

Supported triggers:

- reservation confirmation after booking commit
- staff new-booking alert after booking commit
- deposit request email when a hosted deposit request is created or resent
- payment success email only after authoritative payment confirmation
- pre-arrival reminder based on configurable lead time
- cancellation confirmation after actual cancellation completion
- modification confirmation after actual reservation mutation
- failed payment reminder after configured delay on unresolved failed or expired requests
- internal activity alerts for booking, cancellation, modification, and payment operations

Delivery model:

- each delivery stores `event_type`, `reservation_id`, `payment_request_id`, `audience_type`, `channel`, `template_id`, rendered subject/body snapshot, recipient, status, attempts, timestamps, and failure metadata
- statuses are normalized as `pending`, `queued`, `sent`, `delivered`, `failed`, `skipped`, and `cancelled`
- render snapshots are stored at send time so later template edits affect only future sends
- delivery failures never roll back the already-committed reservation, payment, or cashier transaction

Channels:

- `email` for guest-facing communication
- `internal_notification` for PMS-visible staff alerts
- optional `line_staff_alert` and `whatsapp_staff_alert` supplemental channels for staff operations
- optional external staff channels are config-driven and failure-safe; they do not replace the internal PMS notification path

Reminder and dispatch operations:

- `/staff/admin/communications` exposes communication settings, delivery history, and manual reminder/dispatcher runs
- `flask --app app process-notifications` dispatches queued deliveries
- `flask --app app send-pre-arrival-reminders` queues and dispatches due pre-arrival reminders
- `flask --app app send-failed-payment-reminders` refreshes eligible failed or expired hosted-payment links and sends follow-up communication

Permissions:

- `settings.view` gates communication visibility in the admin panel
- `settings.edit` gates communication settings, queue runs, and reminder runs
- `reservation.edit` gates reservation confirmation resend actions
- `payment_request.create` gates deposit-link send and resend actions
- `audit.view` continues to gate deeper audit visibility outside the operational history surfaces

Operational caveats:

- SMTP transport failure is tracked on both `email_outbox` and `notification_deliveries`, but it does not invalidate the business transaction that queued the message
- guest-facing and staff-facing communication stay separate in template keys, delivery audience, and channel handling
- fallback language resolution prefers the requested language, then English, and channel fallback prefers the requested channel before email where that is operationally sensible
- optional LINE / WhatsApp webhooks are intentionally supplemental and should not be treated as the only alert path

## Admin And Hotel Configuration Panel

The admin control surface is implemented in [app.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/app.py), [admin_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/admin_service.py), and the templates [admin.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/admin.html), [admin_property.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/admin_property.html), [admin_rates_inventory.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/admin_rates_inventory.html), [admin_staff_access.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/admin_staff_access.html), [admin_operations.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/admin_operations.html), [admin_payments.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/admin_payments.html), and [admin_audit.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/admin_audit.html).

Configuration data model strategy:

- structured tables are used where shape and history matter: `room_types`, `rooms`, `rate_rules`, `inventory_overrides`, `blackout_periods`, `policy_documents`, `notification_templates`, `roles`, `permissions`
- `app_settings` remains for operational scalar settings such as deposit percentage, branding fields, housekeeping readiness defaults, and payment runtime controls
- hotel logic that varies by property no longer has to live in scattered template or controller constants
- every admin write goes through server-side validation plus `audit_log` and `activity_log`

Admin sections and routes:

- Property setup: `/staff/admin`, `/staff/admin/property`
- Rates and inventory: `/staff/admin/rates-inventory`
- Staff and access: `/staff/admin/staff-access`
- Operations settings: `/staff/admin/operations`
- Payments: `/staff/admin/payments`
- Audit viewer: `/staff/admin/audit`

What the admin panel manages:

- room type create/update/activate flows with occupancy validation and dependency-safe deactivation rules
- room master data, sellability defaults, and protected edits for rooms already tied to reservation history
- rate rule creation and update with conflict detection by rule type, priority, scope, and effective window
- inventory overrides that atomically close or reopen future inventory rows without bypassing the authoritative `inventory_days` ledger
- blackout and closed-date controls that feed both the staff and public booking paths through `assert_blackout_allows_booking(...)`
- deposit percentage and hosted-deposit enablement used by reservation deposit calculation and payment-request creation
- staff account management, password-reset issuing, MFA disable, and role-permission updates
- multilingual policy documents used by booking, payment, and confirmation flows
- multilingual notification templates with placeholder validation and preview support
- payment operational settings such as active provider selector, link expiry, and resend cooldown, while secrets stay environment-managed and masked in the UI
- housekeeping defaults such as `housekeeping.require_inspected_for_ready` and `housekeeping.checkout_dirty_status`, both of which feed live front-desk and turnover behavior
- branding and hotel identity fields that drive public screens, staff screens, and printable outputs
- filtered audit-log review by actor, entity, action, and date

Permission boundaries:

- `settings.view` gates access to configuration pages
- `settings.edit` gates property, rates/inventory, operations, and most payment-setting mutations
- `rate_rule.view` and `rate_rule.edit` gate pricing rule visibility and edits
- `user.view`, `user.create`, `user.edit`, `user.disable`, `auth.reset_password_admin`, and `auth.manage_mfa` gate staff administration
- admin-only role/permission mutation and payment-provider switching are enforced on the backend, not just hidden in the UI
- `audit.view` gates audit viewer access

Operational caveats:

- inventory overrides and blackout periods are independent controls: overrides change specific future room inventory rows, while blackout periods change booking eligibility rules
- blocked or out-of-service operational room state remains in the live operations model; the admin panel controls defaults and planned overrides, not ad-hoc housekeeping execution
- payment provider secrets remain environment-level configuration and are intentionally not editable from the database-backed admin UI
- policy and notification changes are live immediately after save and are tracked in audit history

## Manager Dashboard And Reporting

The manager reporting workspace is implemented in [app.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/app.py), [reporting_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/reporting_service.py), and [staff_reports.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/staff_reports.html).

Architecture:

- reporting stays query-driven against the authoritative reservation, `inventory_days`, housekeeping, folio, payment, and audit tables
- shared report service functions define the metric logic once so dashboard cards and drill-down lists use the same underlying filters
- the dashboard is intentionally simple first: KPI cards, compact operational tables, date presets, and direct links back into front-desk, reservations, housekeeping, cashier, payments, and audit views
- no shadow summary tables were added in Phase 12; the current hotel size does not require rollups yet

Primary route:

- `/staff/reports`

Date filter semantics:

- `today`: current business date only
- `tomorrow`: next business date only
- `next_7_days`: today through today + 6 days
- `next_30_days`: today through today + 29 days
- `current_month`: first through last calendar day of the current month
- `custom`: explicit inclusive `[date_from, date_to]`

Report definitions:

- arrivals today: reservations with `check_in_date = business_date`, using the same arrival readiness, assignment, and payment summary data as the front-desk arrivals workspace
- departures today: reservations with `check_out_date = business_date`, using the same departure and folio-balance logic as the front-desk departures workspace
- occupancy today: confirmed or in-house occupied room-nights for the business date divided by current saleable room inventory for that date
- occupancy by date range: daily repetition of the same occupancy definition across the selected range
- pending reservations: reservations currently in `tentative` status with arrival dates inside the selected range
- confirmed reservations: reservations currently in `confirmed` status with arrival dates inside the selected range
- checked-in guests: reservations currently in `checked_in` status whose stay is active on the business date
- housekeeping summary: authoritative housekeeping counts and arrival-priority rooms from the live housekeeping board data
- folio balances outstanding: reservations overlapping the selected range whose authoritative folio balance due is greater than zero
- deposit requested vs paid: reservations in range with a deposit requirement and either a deposit request or an applied deposit, using the latest hosted-payment request state plus authoritative deposit-received totals
- revenue summary: posted folio activity by service date in the selected range; this is posted operational revenue, not booked revenue or cash collected
- room type performance: confirmed or stayed reservation counts by room type, sold nights from consuming `inventory_days` rows, and room revenue from posted room charges
- cancellation summary: reservation status-history transitions into `cancelled` inside the selected range
- no-show summary: reservation status-history transitions into `no_show` inside the selected range
- audit activity summary: recent audit rows plus grouped action counts, with admin/config, reservation, and cashier/payment-sensitive activity highlighted separately

Occupancy denominator notes:

- the denominator is the count of saleable inventory rows for the date, not the fixed physical room count
- default non-sellable rooms `216` and `316` are excluded
- blocked, out_of_order, and out_of_service inventory rows are excluded because they are not available supply for that business date
- tentative reservations do not count as sold occupancy; confirmed, checked-in, checked-out stay rows, and house-use rows do

Permissions:

- `reports.view` gates the dashboard and report queries
- `reservation.view` gates reservation-linked drill-down links
- `folio.view` gates outstanding-balance and revenue visibility
- `payment.read` gates deposit pipeline visibility
- `housekeeping.view` gates the housekeeping readiness section
- `audit.view` gates audit activity summary visibility

Performance notes:

- summary sections use narrow aggregate queries and lightweight DTO-style dicts rather than loading full ORM graphs for every card
- drill-down tables are intentionally capped to operationally useful lengths for the dashboard surface
- the current implementation relies on indexed date, status, foreign-key, and room-type filters already present in the Phase 2-11 schema

Operational caveats:

- the dashboard is designed for operational visibility, not full accounting or BI analysis
- revenue summary should not be compared directly to payment collection totals without understanding the difference between posted folio revenue and cash/deposit movement
- occupancy and room-type sold-night metrics reflect live inventory truth, so same-day room closures immediately change the denominator
- date filters are inclusive on both ends for manager reporting, while reservation stay allocation still uses `[check_in_date, check_out_date)` semantics

## Housekeeping Operations

The housekeeping module is implemented in [app.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/app.py), [housekeeping_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/housekeeping_service.py), and the templates [housekeeping_board.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/housekeeping_board.html) and [housekeeping_room_detail.html](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/templates/housekeeping_room_detail.html).

Operational model:

- housekeeping board defaults to the current business day and shows all rooms with floor, room type, housekeeping state, arrival/departure/in-house context, maintenance, blocked state, and note count
- room readiness comes from the authoritative `inventory_days` row plus `housekeeping_statuses`, not UI-only flags
- `dirty` and `pickup` indicate work remaining, `clean` means cleaned, and `inspected` means ready for arrival release where supervisor approval matters
- blocked rooms are distinct from `out_of_order` and `out_of_service`
- maintenance flag is distinct from closures and keeps the later maintenance module extension clean

Housekeeping workflows:

- per-room status changes: dirty, clean, inspected, occupied states, and manager/admin-only closure states
- room notes with note type, importance flag, visibility scope, author, and timestamp
- maintenance flag set / clear with operational note trail
- blocked room set / clear with reason and optional end time
- bulk updates for status, notes, maintenance, and blocked-room actions with per-room validation and partial-failure reporting
- room status history with previous/new state, actor, timestamp, and note

Front-desk integration:

- checkout sends the room into dirty turnover state instead of making it instantly sellable
- clean / inspected updates immediately affect front-desk arrival readiness
- blocked / out_of_order rooms are excluded from normal assignment and readiness logic
- arrival priority on the housekeeping board is driven by live reservations and same-day arrival pressure

Routes:

- `/staff/housekeeping`
- `/staff/housekeeping/rooms/<room_id>`
- `/staff/housekeeping/rooms/<room_id>/status`
- `/staff/housekeeping/rooms/<room_id>/notes`
- `/staff/housekeeping/rooms/<room_id>/maintenance`
- `/staff/housekeeping/rooms/<room_id>/block`
- `/staff/housekeeping/bulk`

Permission model:

- `housekeeping.view`: board, room detail, notes, history, and readiness visibility
- `housekeeping.status_change`: normal housekeeping status changes, notes, and maintenance updates
- manager/admin role override: blocked-room and closure-state actions

Future extension points already structured in the data layer:

- `inventory_days.cleaned_at`
- `inventory_days.inspected_at`
- `room_status_history` for later task assignment, supervisor review, and productivity reporting

## Locked Sandbox Hotel Seeds

Inventory:

- 32 physical room numbers: `201-216`, `301-316`
- 30 saleable rooms
- twins: `201-215`
- doubles: `301-315`
- `216` out of service by default
- `316` out of service by default

Rates:

- Twin weekday `720`
- Twin weekend `790`
- Twin holiday `850`
- Twin peak holiday/weekend `890`
- Double weekday `750`
- Double weekend `820`
- Double holiday `880`
- Double peak holiday/weekend `920`

Settings:

- hotel name `Sandbox Hotel`
- currency `THB`
- check-in `14:00`
- check-out `11:00`
- VAT `0.07`
- service charge `0.00`
- extra guest fee `200.00`
- child fee `100.00` for ages 6-11
- overbooking disabled
- standard cancellation window `24` hours

Seeded roles:

- `admin`
- `manager`
- `front_desk`
- `housekeeping`

## Reservation Transaction Flow

The create path is implemented in [reservation_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/reservation_service.py).

Flow:

1. Validate `[check_in_date, check_out_date)` boundaries.
2. Validate occupancy against `room_types.max_occupancy`.
3. Quote nightly rates from `rate_rules` and `app_settings`.
4. Lock candidate `inventory_days` rows.
5. Select a room that is sellable and fully available for the stay.
6. Generate the next reservation code.
7. Insert guest updates, reservation, status history, and inventory allocations in one transaction.
8. Optionally create a `payment_requests` row and matching `payment_events` row in the same unit of work.
9. Commit or roll back the full operation.

Cancellation releases reserved inventory, appends to status history, and writes an audit record.

## Soft Delete Policy

Soft delete is used only where operational archive behavior is appropriate:

- `users`
- `guests`
- `guest_notes`
- `rate_rules`
- `app_settings`

No soft delete on lifecycle or ledger tables:

- `reservations`
- `reservation_status_history`
- `folio_charges`
- `payment_requests`
- `payment_events`
- `audit_log`

Those tables use status transitions or append-only reversal patterns instead.

## Environment

Example environment values are in [.env.example](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/.env.example).

Important variables:

- `DATABASE_URL`
- `TEST_DATABASE_URL` for the real Postgres concurrency integration test
- `APP_ENV`
- `SECRET_KEY`
- `AUTH_ENCRYPTION_KEY`
- `FORCE_HTTPS`
- `TRUST_PROXY_COUNT`
- `TRUSTED_HOSTS`
- `LOG_LEVEL`
- `ENABLE_ACCESS_LOGGING`
- `ENABLE_SECURITY_HEADERS`
- `HSTS_MAX_AGE_SECONDS`
- `MAX_CONTENT_LENGTH`
- `MAX_FORM_MEMORY_SIZE`
- `MAX_FORM_PARTS`
- `AUTO_BOOTSTRAP_SCHEMA`
- `AUTO_SEED_REFERENCE_DATA`
- `INVENTORY_BOOTSTRAP_DAYS`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `AUTH_COOKIE_NAME`
- `AUTH_COOKIE_SECURE`
- `AUTH_COOKIE_SAMESITE`
- `SESSION_COOKIE_NAME`
- `SESSION_COOKIE_SECURE`
- `SESSION_COOKIE_SAMESITE`
- `SESSION_IDLE_MINUTES`
- `SESSION_ABSOLUTE_HOURS`
- `PASSWORD_RESET_TTL_MINUTES`
- `PASSWORD_RESET_REQUEST_LIMIT`
- `PASSWORD_RESET_REQUEST_WINDOW_MINUTES`
- `LOGIN_LOCK_THRESHOLD`
- `LOGIN_LOCK_WINDOW_MINUTES`
- `LOGIN_LOCK_DURATION_MINUTES`
- `MFA_VERIFY_WINDOW`
- `MFA_ISSUER`
- `APP_BASE_URL`
- `PUBLIC_BOOKING_HOLD_MINUTES`
- `PUBLIC_BOOKING_RATE_LIMIT_WINDOW_MINUTES`
- `PUBLIC_BOOKING_RATE_LIMIT_COUNT`
- `PUBLIC_LOOKUP_RATE_LIMIT_COUNT`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `SMTP_USE_TLS`
- `MAIL_FROM`
- `PAYMENT_PROVIDER`
- `PAYMENT_LINK_TTL_MINUTES`
- `PAYMENT_LINK_RESEND_COOLDOWN_SECONDS`
- `PAYMENT_WEBHOOK_TOLERANCE_SECONDS`
- `PG_DUMP_BIN`
- `PG_RESTORE_BIN`
- `BACKUP_RETENTION_DAYS`
- `BACKUP_ENCRYPTION_REQUIRED`
- `RESTORE_VERIFY_COMMAND`
- `STRIPE_API_BASE`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `TEST_HOSTED_PAYMENT_SECRET`
- `STAFF_ALERT_EMAILS`

PostgreSQL example:

```powershell
$env:DATABASE_URL = "postgresql+psycopg://sandbox:sandbox@localhost/sandbox_hotel_pms"
$env:AUTO_BOOTSTRAP_SCHEMA = "0"
$env:AUTO_SEED_REFERENCE_DATA = "0"
```

SQLite fallback example:

```powershell
$env:DATABASE_URL = "sqlite:///sandbox_pms.db"
```

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Seeded admin defaults:

- email: `admin@sandbox.local`
- password: `sandbox-admin-123`

Override these with `ADMIN_EMAIL` and `ADMIN_PASSWORD` in real environments.

## Migrations

Upgrade:

```powershell
.\.venv\Scripts\flask.exe --app app db upgrade
```

Downgrade one revision:

```powershell
.\.venv\Scripts\flask.exe --app app db downgrade -1
```

Fresh local reset for SQLite-only testing:

```powershell
Remove-Item .\sandbox_pms.db -ErrorAction SilentlyContinue
.\.venv\Scripts\flask.exe --app app db upgrade
```

## Seed Commands

Load Phase 2 reference data and bootstrap the inventory horizon:

```powershell
.\.venv\Scripts\flask.exe --app app seed-phase2
```

Extend nightly inventory rows only:

```powershell
.\.venv\Scripts\flask.exe --app app bootstrap-inventory
```

The seed path is safe to rerun for reference data in non-production environments.

## Backup and Restore

PowerShell backup:

```powershell
$env:DATABASE_URL = "postgresql+psycopg://sandbox:sandbox@localhost/sandbox_hotel_pms"
.\scripts\backup_db.ps1
```

PowerShell restore:

```powershell
$env:DATABASE_URL = "postgresql+psycopg://sandbox:sandbox@localhost/sandbox_hotel_pms_restore"
.\scripts\restore_db.ps1 -BackupFile .\backups\sandbox_hotel_20260307_120000.dump
```

Destructive restore:

```powershell
.\scripts\restore_db.ps1 -BackupFile .\backups\sandbox_hotel_20260307_120000.dump -DropExisting
```

Bash backup:

```bash
export DATABASE_URL="postgresql+psycopg://sandbox:sandbox@localhost/sandbox_hotel_pms"
./scripts/backup_db.sh ./backups
```

Bash restore:

```bash
export DATABASE_URL="postgresql+psycopg://sandbox:sandbox@localhost/sandbox_hotel_pms_restore"
./scripts/restore_db.sh ./backups/sandbox_hotel_20260307_120000.dump --drop-existing
```

The restore scripts never drop existing objects unless the destructive flag is passed explicitly.

Phase 13 hardening changed the backup behavior:

- every backup now writes three artifacts: `.dump`, `.sha256`, and `.json`
- the manifest includes a redacted database target, retention period, encryption-at-rest expectation, and optional restore verification command
- restore verifies the checksum before loading when the sidecar exists
- old backups are pruned according to `BACKUP_RETENTION_DAYS`
- post-restore validation can be automated through `RESTORE_VERIFY_COMMAND`

Recommended production policy:

- run encrypted PostgreSQL backups at least daily
- store backups on encrypted storage managed outside the app host
- restrict backup/restore access to admin or platform operators only
- test restore into a non-production database on a fixed schedule before relying on backup retention

## Security And Compliance Hardening

Phase 13 hardening is implemented in [security.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/security.py), [config.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/config.py), [auth_service.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/services/auth_service.py), [audit.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/audit.py), [activity.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/pms/activity.py), and the hardened backup scripts under [scripts](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/scripts).

Security architecture:

- staff passwords remain Argon2-hashed only; no plaintext or reversible password storage exists
- Flask session state is hardened with secure cookie flags, idle timeout, absolute lifetime, and CSRF protection on authenticated mutation routes
- browser session state now rotates CSRF state on login, logout, password reset completion, MFA completion, and password-change reauthentication
- production startup fails fast on unsafe runtime config such as default `SECRET_KEY`, missing `AUTH_ENCRYPTION_KEY`, disabled HTTPS cookie flags, enabled bootstrap/seeding, or `test_hosted` payments in production
- response hardening adds CSP, frame, referrer, permissions, HSTS, and no-store controls for authenticated staff pages
- `TRUSTED_HOSTS` and `FORCE_HTTPS` enforce host and transport expectations without depending on UI behavior

Validation and output safety:

- key business services validate server-side input for auth, reservations, admin changes, payments, housekeeping, cashier, and reporting paths
- request size limits are configurable through `MAX_CONTENT_LENGTH`, `MAX_FORM_MEMORY_SIZE`, and `MAX_FORM_PARTS`
- Jinja autoescaping remains the default rendering boundary, and untrusted note/request text is rendered escaped rather than injected into HTML
- public error responses are generic in production-style failure paths; internal exception text is logged, not shown to end users

Authorization and audit:

- backend permission checks remain authoritative for admin, payments, cashier, reporting, reservations, housekeeping, and audit surfaces
- `audit_log`, `activity_log`, `payment_events`, `reservation_status_history`, and `room_status_history` are treated as append-only in the ORM layer as well as the operational workflow
- audit/activity payloads now redact secrets, tokens, passwords, session identifiers, webhook signatures, and similar sensitive fields before persistence
- security-sensitive auth, cashier, payment, admin, and operational actions remain queryable through the audit viewer while keeping sensitive values minimized

Secrets and environment separation:

- provider, SMTP, database, session, and webhook secrets stay environment-managed and are not editable from normal admin UI paths
- `AUTH_ENCRYPTION_KEY` is required outside development/test for encrypted auth secrets such as reset tokens and MFA secrets
- `APP_ENV` cleanly separates development, test, staging, and production behavior
- development/test may use controlled fallbacks for convenience, but production is expected to run with explicit secrets, HTTPS, and seeded staff accounts only

Logging strategy:

- access logs emit structured request context through the `sandbox_pms.access` logger with request id, method, path, status, duration, audience, actor, IP, and user agent
- application exceptions emit through `sandbox_pms.error` with request correlation but without dumping secrets into user-facing responses
- request ids are accepted from `X-Request-Id` when supplied or generated per request otherwise, then echoed back in the response
- access logging intentionally records the route path rather than raw query strings so tokens and lookup secrets are not leaked into logs

Privacy and data-handling alignment:

- guest data stored by the PMS includes reservation identity/contact details, stay data, operational notes, payment-request metadata, notification history, and audit/activity metadata
- staff data includes login identifiers, password hashes, MFA state, session records, and admin activity
- the seeded `privacy_notice` policy document should stay aligned with actual guest communication, hosted-payment, audit, and notification flows
- this phase does not add destructive retention tooling; it prepares the system for later retention work by keeping sensitive domains identifiable and documented

Hosted payment boundary:

- the PMS remains hosted-checkout only for card handling
- no PMS template or route collects raw PAN, CVV, or custom card-form input
- the PMS only creates deposit payment requests, sends guests to hosted checkout, processes signed webhooks, and updates internal payment/folio state
- provider secrets stay server-side only, and webhook authenticity is verified before payment status changes or folio deposit application

Launch-readiness checklist:

- set strong unique values for `SECRET_KEY` and `AUTH_ENCRYPTION_KEY`
- run with `APP_ENV=production`, `FORCE_HTTPS=1`, `AUTH_COOKIE_SECURE=1`, and `SESSION_COOKIE_SECURE=1`
- disable `AUTO_BOOTSTRAP_SCHEMA`, `AUTO_SEED_REFERENCE_DATA`, and `AUTH_SHOW_RESET_LINKS`
- configure `TRUST_PROXY_COUNT` and `TRUSTED_HOSTS` for the actual deployment edge
- point `APP_BASE_URL` and `PAYMENT_BASE_URL` at HTTPS origins
- keep `PAYMENT_PROVIDER=disabled` or `stripe`; never deploy `test_hosted` in production
- verify backup output, checksum, manifest, and restore workflow before go-live
- require MFA for admin and manager users
- review `privacy_notice`, guest-facing policies, and notification templates for production content
- review security, error, access, and audit logs as part of launch validation
- run the full test suite plus the PostgreSQL-only integrations behind `TEST_DATABASE_URL`

## Testing

```powershell
$env:PYTHONPATH = (Get-Location).Path
.\.venv\Scripts\python.exe -m pytest .\tests -q
```

To run the real PostgreSQL concurrency test, point `TEST_DATABASE_URL` at a disposable Postgres database the test can reset:

```powershell
$env:TEST_DATABASE_URL = "postgresql+psycopg://sandbox:sandbox@localhost/sandbox_hotel_pms_test"
.\.venv\Scripts\python.exe -m pytest .\tests\test_phase4_public_booking.py -k postgres -q
.\.venv\Scripts\python.exe -m pytest .\tests\test_phase5_staff_reservations_workspace.py -k postgres -q
.\.venv\Scripts\python.exe -m pytest .\tests\test_phase6_front_desk_workspace.py -k postgres -q
```

Current automated coverage validates:

- staff login success and failure paths
- Argon2 password storage
- session cookie creation, logout revocation, idle timeout, and absolute timeout
- CSRF rejection on missing form token
- password reset issue, expiry, and single-use behavior
- login throttling and temporary lockout
- MFA enrollment, verification, and one-time recovery code behavior
- protected route permissions for admin, manager, front desk, and housekeeping
- front-desk arrivals, departures, and in-house operational lists
- room-readiness gating on check-in
- transactional check-in, checkout, walk-in, room-move, and no-show flows
- checkout housekeeping handoff state
- admin dashboard and section access control
- room type and room manager updates with audit logging
- rate-rule conflict validation
- inventory override close/release behavior against live `inventory_days`
- blackout enforcement in booking validation
- deposit percentage settings flowing into deposit calculation
- admin staff-user creation and role-permission changes affecting backend authorization
- multilingual policy editing and notification-template rendering/preview
- masked payment configuration status and audit logging
- housekeeping default settings affecting front-desk readiness
- audit viewer filtering for configuration changes
- room-charge auto-posting and duplicate-safe posting keys
- manual charge, discount, correction, refund, and void-with-reversal flows
- document issuance and stable invoice / receipt numbering
- cashier route rendering, printable folio output, and cashier activity history
- settlement-state derivation from authoritative folio lines
- hosted deposit request creation and hosted link generation
- safe public payment return handling without trusting redirect alone
- webhook-driven payment status sync and duplicate-safe folio deposit application
- payment link resend flow and provider-reference reconciliation
- notification delivery tracking, guest/staff template rendering, and communication-history surfaces
- pre-arrival reminder dispatch and failed-payment reminder follow-up
- optional staff alert channel isolation when LINE / WhatsApp webhooks fail
- empty-database migration
- seed load
- exact 30 saleable rooms and control room flags
- sequential reservation codes
- invalid date rejection
- occupancy rule rejection
- double-book prevention
- cancellation history and inventory release
- payment request / event linkage
- backup / restore script presence
- audit logging
- soft delete filtering
- public availability against live inventory
- reservation hold creation and expiry release
- public booking confirmation idempotency
- staff review queue and guest email outbox creation
- cancellation and modification request submission
- multilingual public booking screens
- secure confirmation-token lookup
- staff reservation list, search, and filter behavior
- staff route rendering for operational views
- role-based restriction of folio/payment detail in the workspace
- reservation detail data and backend permission enforcement
- guest edits, stay-date repricing, room assignment, and cancellation safety
- reservation notes, payment/deposit summary, and resend confirmation flow
- arrivals, departures, and in-house operational views
- workspace audit logging
- PostgreSQL-only concurrent room-change protection when `TEST_DATABASE_URL` is configured
- PostgreSQL-only concurrent cashier document numbering when `TEST_DATABASE_URL` is configured
- PostgreSQL-only repeated hosted-payment webhook idempotency when `TEST_DATABASE_URL` is configured
- production config rejection for unsafe secrets and missing security settings
- response hardening headers and secure browser session cookie flags
- request-id propagation and access-log payload scrubbing of sensitive query data
- generic 500 handling without leaking internal exception text
- append-only enforcement for audit-history tables
- audit payload redaction of passwords, tokens, and similar secrets
- server-side validation of malformed reservation input
- POST-only CSRF-protected logout
- escaped rendering of untrusted housekeeping notes
- admin payment settings pages not exposing provider secret values
- backup / restore checksum, manifest, and restore-verification script behavior
- hosted-checkout-only card boundary with no raw card-input fields in templates

## Staff Admin Workflow

Recommended production setup:

1. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SECRET_KEY`, and `AUTH_ENCRYPTION_KEY`.
2. Run migrations against PostgreSQL.
3. Run `flask --app app seed-phase2`.
4. Sign in as the seeded admin.
5. Create real staff accounts from `/staff/users`.
6. Require new staff to complete the password reset flow before daily use.
7. Encourage or require MFA for admin and manager accounts from `/staff/security`.

## Runnable App

The Flask entrypoint remains [app.py](/C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp/app.py).

```powershell
.\.venv\Scripts\flask.exe --app app run --debug
```
