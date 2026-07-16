# Implementation Spec - Hotel Ops AI Command Center

This document describes the current Sandbox PMS implementation of the Hotel Ops package. It is intentionally scoped to what the repository actually runs today.

## Product Shape

Hotel Ops gives managers one controlled interface for OTA and booking-intelligence work:

1. Submit a manager command.
2. Parse it into a controlled task.
3. Apply role, risk, approval, emergency-stop, and validation rules.
4. Queue safe or approved tasks.
5. Execute through a signed dry-run OTA worker boundary.
6. Persist task lifecycle, proof artifacts, notifications, and audit events.
7. Scan bookings for operational trend alerts and approval-gated recommendations.

## Routes

UI routes:

- `/ops/chat`
- `/ops/approvals`
- `/ops/tasks`
- `/ops/intelligence`
- `/ops/settings`

API routes:

- `POST /api/ops/commands`
- `GET /api/ops/tasks`
- `GET /api/ops/tasks/:id`
- `POST /api/ops/tasks/:id/approve`
- `POST /api/ops/tasks/:id/deny`
- `POST /api/ops/tasks/:id/cancel`
- `POST /api/ops/tasks/:id/run`
- `POST /api/ops/tasks/:id/resolve-human`
- `GET /api/ops/approvals`
- `GET /api/ops/notifications`
- `POST /api/ops/notifications/:id/read`
- `POST /api/ops/notifications/:id/dismiss`
- `GET /api/ops/intelligence/alerts`
- `GET /api/ops/intelligence/scans`
- `POST /api/ops/intelligence/alerts/:id/approve-recommendation`
- `POST /api/ops/intelligence/alerts/:id/acknowledge`
- `POST /api/ops/intelligence/alerts/:id/resolve`
- `GET/POST /api/ops/emergency-stop`
- `GET /api/ops/ota/status`
- `GET /api/ops/policy`
- `POST /api/ops/scan/run`
- `POST /api/internal/ops/worker/tasks`
- `GET/POST /api/line/webhook` for signed LINE messaging and optional Hotel Ops command intake
- `GET/POST /api/whatsapp/webhook` for Meta WhatsApp webhook verification, signed inbound messages, and optional Hotel Ops command intake

Booking-email API routes:

- `GET /api/booking-email/status`
- `POST /api/booking-email/sync`
- `GET /api/booking-email/events`
- `GET /api/booking-email/events/:id`
- `POST /api/booking-email/events/:id/approve`
- `POST /api/booking-email/events/:id/reject`
- `POST /api/booking-email/events/:id/reprocess`
- `GET/POST /api/booking-email/sources`
- `PATCH /api/booking-email/sources/:id`

Auth proof operator CLI:

- `npm.cmd run auth-rbac:proof -- --users-file <local-untracked-json>` performs credentialed login, `/api/auth/me`, optional owner-approved denial probes, logout, and post-logout `/api/auth/me` checks against the configured host.
- The helper masks login identifiers, prints initials instead of display names, keeps cookies in memory only, omits passwords/tokens/raw response bodies, and defaults denial probes to GET/HEAD only. Mutating denial probes require explicit `--allow-mutating-denial-probes` and an owner-approved no-op or invalid payload.
- Staff login policy is three failed attempts followed by persistent account lockout. Admin password reset through the user-management service clears `failedLoginAttempts` and `lockedAt`; normal successful login clears prior failed attempts.

Booking-email operator CLI:

- `npm.cmd run booking-email:backfill -- --query "<approved Gmail query>" --limit <n> --max-pages <n>` performs a bounded Gmail historical dry-run using backend OAuth credentials and prints redacted capture/parser counts.
- Adding `--confirm` imports the scanned messages as review-only Booking Email Events in chunks controlled by `--import-batch-size`, defaulting to `50`, so large history loads do not run as one long database transaction.
- Adding `--confirm` imports the scanned messages into `BookingEmailEvent` rows for staff review in `/booking-inbox`. It does not approve events or directly create, modify, cancel, charge, or assign reservations.
- Without an explicit `--query`, the helper uses the approved provider-query default: common OTA/provider senders, spam/trash excluded, recent-only by default, and known Booking.com security, Trip.com performance, and Agoda partner-invoice noise excluded. `--all-past` removes the recency bound while keeping the same approved-provider scope. `--primary-mailbox-query` is the explicit fallback for the old `to:booking@sandboxhotel.com` troubleshooting boundary.
- The primary Gmail source and missed-push reconciliation use that same shared approved-provider query. On source ensure, an empty query or the known legacy direct-mailbox query is upgraded while an owner-customized query is preserved, preventing the fallback path from silently narrowing to direct-recipient mail only.
- `npm.cmd run booking-email:deep-scan -- --limit <n>` reports redacted aggregate parser coverage, duplicate-scope, and workflow anomalies for the current PMS booking-email queue. Adding `--strict` exits non-zero when high-severity findings remain.
- `npm.cmd run booking-email:reprocess -- --confirm` reparses only selected `NEEDS_REVIEW` / `ERROR` Booking Email Events through the current parser and keeps them in the review queue for staff approval.
- Parser fallback must not promote OTA account-security, partner-reporting, or partner-invoice emails into `NEW_BOOKING`; those messages should remain `UNKNOWN` for manual triage unless staff explicitly reclassify them.
- `npm.cmd run gmail-oauth:render` generates a Google consent URL for the booking mailbox using a configured OAuth client id or a local Google OAuth client JSON file passed with `-- --credentials-file <local-untracked-json>`. Adding `-- --exchange-code --code-stdin --apply-render --use-render-cli-token` exchanges a locally pasted authorization code for a refresh token and writes the booking-specific Gmail OAuth tuple directly to Render without printing the authorization code, client secret, access token, refresh token, or Render auth token. Adding `-- --listen --apply-render --use-render-cli-token` starts a local callback listener, prints the consent URL, captures the returned code locally, exchanges it, and applies the tuple without printing token values.
- `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` checks the current Render service for supported backend Gmail credential key paths without printing values. `ready=true` requires a booking-specific refresh-token tuple, booking-specific access token, fallback refresh-token tuple, or fallback access token.
- `npm.cmd run render:gmail-oauth` checks whether the local process environment has the durable Gmail OAuth refresh-token tuple needed for Render. It prints only key names and presence/action status. Adding `-- --apply` updates only the known Render env-var keys after Render API auth is available.

## Parser Contract

The default parser is deterministic in `parseHotelOpsCommand`. When `HOTEL_OPS_AI_PARSER_ENABLED` or `HOTEL_OPS_AI_PARSER` is enabled and a backend `OPENAI_API_KEY` exists, `submitOpsCommand` can use the backend-only OpenAI Responses parser before falling back to deterministic parsing if the provider call or model output fails. Frontend code never receives the API key.

Both parser paths output the repo type `ParsedHotelOpsTask` with:

- whitelisted task type
- platform from `booking`, `agoda`, `trip`, `expedia`, `all`, or `unknown`
- hotel id
- room type
- date range
- optional rate, availability, or message
- risk level
- approval requirement
- confidence
- missing fields
- rationale

Forbidden requests, credential requests, 2FA/CAPTCHA bypass attempts, audit-hiding requests, refunds, bulk cancellation, and policy changes are rejected as `FORBIDDEN` or blocked by MVP policy.

OpenAI parser requests send redacted command text, request the strict Hotel Ops task JSON schema, validate the model output with the same backend schema, and then normalize risk, approval requirement, and hotel id against backend policy. Parser mode and fallback reason are included in task logs/audit metadata and surfaced in the `/ops/chat` parsed preview.

## LINE Command Intake

Signed LINE webhook traffic can optionally feed manager commands into the same `submitOpsCommand` backend service used by `/api/ops/commands`.

- The bridge is disabled by default.
- It only processes text messages that start with `HOTEL_OPS_LINE_COMMAND_PREFIX`, defaulting to `/ops`.
- `HOTEL_OPS_LINE_COMMAND_USER_MAP` must map LINE source user ids to existing active PMS user ids, usernames, or emails.
- The mapped PMS user must have `create:ops-task`; unmapped or under-permissioned LINE messages stay as normal LINE message records and are skipped for Ops intake.
- Accepted LINE commands use the LINE message id as the idempotency key and are tagged with source channel `line`.
- Parser validation, permission checks, approvals, queueing, notifications, emergency stop, and audit records remain owned by `server/ops-service.mjs`.

## WhatsApp Command Intake

Meta WhatsApp Cloud API webhook traffic can optionally feed manager commands into the same `submitOpsCommand` backend service used by `/api/ops/commands`.

- The bridge is disabled by default.
- `GET /api/whatsapp/webhook` supports Meta webhook verification with `WHATSAPP_WEBHOOK_VERIFY_TOKEN` and reports safe configuration status when called without a verification challenge.
- `POST /api/whatsapp/webhook` requires a valid `x-hub-signature-256` HMAC using `WHATSAPP_WEBHOOK_APP_SECRET`.
- It only processes extracted text messages that start with `HOTEL_OPS_WHATSAPP_COMMAND_PREFIX`, defaulting to `/ops`.
- `HOTEL_OPS_WHATSAPP_COMMAND_USER_MAP` must map sender phone/id values to existing active PMS user ids, usernames, or emails.
- The mapped PMS user must have `create:ops-task`; unmapped or under-permissioned WhatsApp messages remain normal message records and are skipped for Ops intake.
- Accepted WhatsApp commands use the WhatsApp message id as the idempotency key, are tagged with source channel `whatsapp`, and persist source message metadata in task logs and audit records.
- Outbound WhatsApp delivery is not implemented by this bridge; live provider setup remains a separate integration.

## Email Command Intake

Booking mailbox sync can optionally feed allowlisted manager email commands into the same `submitOpsCommand` service.

- The bridge is disabled by default.
- It only processes synced booking-email events whose subject or body starts with `HOTEL_OPS_EMAIL_COMMAND_PREFIX`, defaulting to `/ops`.
- `HOTEL_OPS_EMAIL_COMMAND_USER_MAP` must map sender email addresses to existing active PMS user ids, usernames, or emails.
- The mapped PMS user must have `create:ops-task`; unmapped or under-permissioned email messages remain booking-email records and are skipped for Ops intake.
- Accepted email commands use the source Gmail/message id as the idempotency key and are tagged with source channel `email`.
- Task logs and `OPS_COMMAND_RECEIVED` audit records persist source email metadata, including the booking-email event id, source message id, raw email link, and sender when available.

Historical backfill uses the same booking-email event parser and duplicate keys as mailbox sync. Duplicate review only flags same-type events when the provider message identity or message-content fingerprint matches; sharing the same booking reference alone is not treated as a duplicate for payment, cancellation, modification, or guest-message traffic. CLI proof output is aggregate-only; detailed email content is stored only in the PMS database when an operator explicitly confirms the import for review.
- This bridge reuses booking-email Gmail OAuth sync and does not introduce a raw mailbox-password path.

## Permission And Approval Rules

Rules live in `server/ops-service.mjs`.

- Read-only tasks can be queued for allowed roles.
- High-risk write tasks require approval.
- Owner approval is required for rate, availability, open/close room, listing update, and photo-class tasks.
- `UPDATE_PHOTOS` is critical and disabled in the MVP.
- Approval, denial, cancellation, alert recommendation, alert resolution, and emergency-stop changes require non-empty operational reasons.
- `NEEDS_HUMAN` task resolution requires a non-empty reason and reuses backend run-permission and emergency-stop checks before requeueing.
- Emergency stop blocks write tasks during intake, approval, queueing, and worker execution.
- The read-only `/api/ops/policy` endpoint serializes the enforced task rules, approval roles, limits, disabled MVP tasks, and emergency-stop coverage for the Settings policy matrix.

## Queue And Worker

The task lifecycle is persisted in Prisma models:

- `HotelOpsTask`
- `HotelOpsTaskApproval`
- `HotelOpsTaskLog`
- `HotelOpsTrendAlert`
- `HotelOpsScanSnapshot`
- `HotelOpsEmergencyStop`
- `HotelOpsNotification`

Queued tasks run through `runQueuedOpsTask`, which rechecks permissions and emergency-stop state before calling the signed worker boundary.

Tasks that return `NEEDS_HUMAN` stay stopped until an authorized actor records that the required human OTA challenge or account step was completed. The backend then clears stale worker error fields, writes audit/log evidence, and requeues the task for an explicit later run.

Worker requests:

- use HMAC signatures
- include timestamp and nonce
- reject replayed nonces
- reject credential-shaped fields
- reject unknown task types and platforms
- default to dry-run

## OTA Adapters

- Booking.com: dry-run adapter skeleton with typed methods and human-challenge handling.
- Agoda, Trip.com, Expedia: explicit dry-run adapter skeletons with typed read/write placeholders, proof placeholders, selector-failure paths, and human-challenge handling.
- Unknown or all-platform tasks: signed mock worker fallback.
- Real browser writes are not enabled until selectors, proof capture, account-owner consent, and safe test dates are verified.

## Booking Intelligence

`runOpsScan` uses PMS reservations, rooms, cancellation logs, source channels, and source email events to produce alerts:

- high demand
- low demand
- cancellation spike
- weekend spike
- room-type imbalance
- OTA/platform imbalance

Recommendations create approval-gated tasks and never execute directly.

Every scan persists a `HotelOpsScanSnapshot` before alert upserts. The snapshot records the scan window, actor/source channel, active reservations, sellable rooms, cancellation-log count, occupancy, velocity, cancellation, room-type occupancy, OTA distribution, generated insights, and final created/updated alert counts. Created or refreshed trend alerts link back to the snapshot that produced the current alert metrics. Staff can inspect the latest bounded scan evidence through `GET /api/ops/intelligence/scans` and the `/ops/intelligence` evidence panel; this is PMS-derived evidence, not live OTA scrape proof unless live adapters are separately configured and verified.

Scheduled scans:

- positive `HOTEL_OPS_SCAN_INTERVAL_MINUTES` or `OPS_SCAN_INTERVAL_MINUTES` starts an in-process interval scheduler
- cron config is reported but expected to be run by external infrastructure
- overlapping scheduled runs are skipped
- scheduler status is exposed through `/api/ops/ota/status`

## Parser Validation

Hotel Ops commands use `server/ops-service.mjs`. Parsed task output is strict-schema validated before permission decisions, task persistence, approval routing, or worker queueing. Schema failures are recorded as validation failures and audited through the existing Hotel Ops task log/audit path. OpenAI parsing is optional, backend-only, redacted, and never an execution authority.

## Booking Email Inbox

The Booking Inbox is a staff-facing exception queue for email-derived booking events. Existing imported events can be approved, edited and applied, linked to an existing reservation, used to create a reservation, rejected, or reprocessed through `server/pms-service.mjs`.

- Approve uses `apply_parsed` for payment/modification/cancellation-style events and links matched new bookings to avoid duplicate reservations. A payment, cancellation, modification, or other non-new-booking write requires an explicit reservation id or an exact reservation id persisted during trusted ingestion; guest/date similarity is suggestion-only and never write authority.
- Edit Parsed Details Then Apply submits corrected `editedDetails` through the same approval route.
- Reprocess is limited to eligible `NEEDS_REVIEW` / `ERROR` events, reruns the deterministic parser from immutable raw email text plus stored Gmail `Authentication-Results`, replaces stale parsed money/reference/match fields, and returns the event to `NEEDS_REVIEW`; it does not auto-approve or bypass staff review. A processed event is rejected with conflict instead of being reopened.
- Link/Create requires an explicit reservation id for linking; link mode does not submit or validate edited occupancy fields that the server ignores. Unmatched new-booking events can create a reservation only after one age is supplied for every declared child.
- Modification and cancellation email actions require an operational reason so the audit trail captures the staff decision.
- Email money retains parser semantics (`STAY_TOTAL`, `PAYMENT`, or `DEPOSIT`). Distinct values with the same semantic label are ambiguous and cannot be applied. Approval cannot replace the persisted amount or relabel its currency/semantics; currency must be explicit and equal the property currency. A verified new/modification stay total is inclusive exact satang with persisted reservation provenance, so PMS occupancy fees are not charged again. Provider-linked pricing changes require a new verified stay total, while non-pricing edits preserve stored money, integration identity, and room inventory.
- Mailbox sync remains separate from event review; Gmail sync requires server-side Gmail API credentials, either an OAuth access token or backend OAuth refresh-token credentials, and must not use a pasted mailbox password. `GET /api/booking-email/status` returns non-secret diagnostics for OAuth client presence, refresh token presence, target mailbox presence, missing key names, last sync state, and Gmail API profile connectivity. Render setup should use the booking-specific `BOOKING_EMAIL_GMAIL_*` env vars plus either the `gmail-oauth:render` code-exchange/apply helper or the dry-run-first `render:gmail-oauth` helper when applying credentials from a secure shell.

## Notifications

Notifications are backend records:

- `IN_APP` records are available immediately.
- `EMAIL` records are provider-pending intents unless a real mail provider is configured.
- Optional Gmail API delivery is backend-only and opt-in through `HOTEL_OPS_EMAIL_DELIVERY_ENABLED=true`; it uses backend Gmail OAuth access-token or refresh-token credentials.
- Successful delivery updates the email notification to `SENT` with provider message metadata; provider failures update it to `FAILED` with redacted error metadata.
- Notification text and metadata are sanitized before persistence.
- The shared PMS header notification bell/center reads `/api/ops/notifications` in server mode for users with `view:ops`, merges those records with local housekeeping alerts, and links staff back to the relevant Ops screen.
- Read and dismiss actions call backend acknowledgment routes, persist actor/timestamp fields, and create audit records. This acknowledgment state is separate from provider delivery status.

## Lite V1 Core Operations

Lite V1 is built in parallel under `src-lite/` and selected at build/runtime with the Lite Vite configuration and `PMS_UI_VARIANT=lite`. It must continue to use the existing `server/pms-service.mjs` transaction and policy functions for every operational mutation. It must not fork reservation, folio, payment, check-in/out, housekeeping, authentication, or RBAC authority into the browser.

Lite read routes:

- `GET /api/lite/v1/front-desk?date=YYYY-MM-DD`
- `GET /api/lite/v1/bookings?from=&to=&status=&source=&query=&cursor=&limit=`
- `GET /api/lite/v1/bookings/:id` (property-scoped detail plus at most 100 newest `ReservationLog` lifecycle events; exposes safe action, timestamp, and staff display label only, with truncation metadata and no raw changes, notes, account identifiers, IP/user-agent data, credentials, or payment details)
- `GET /api/lite/v1/board?from=&to=`
- `GET /api/lite/v1/housekeeping?date=YYYY-MM-DD`
- `GET /api/lite/v1/channel-desk`
- `GET /api/lite/v1/settings` (bounded configuration projection only; no reservations, booking-review rows, reservation logs, or manual task worklists)
- `GET /api/version`
- `GET /api/realtime/events`

Manual channel routes:

- `PUT /api/lite/v1/channels/connections/:provider`
- `POST /api/lite/v1/channels/mappings`
- `POST /api/lite/v1/channel-tasks/reconcile`
- `POST /api/lite/v1/channel-tasks/:id/complete`
- `POST /api/lite/v1/channel-tasks/:id/reopen`

Wave 1 money/evidence routes:

- `POST /api/payments/:id/reversals` creates an immutable full or partial reversal against the original payment.
- `POST /api/charges/:id/void` preserves and marks a non-room charge void; only Manager/Admin may call it.
- `POST /api/booking-email/events/:id/evidence` returns only approved raw-evidence locators after property, permission, and reason checks and records an audit event.

The existing audited reservation, assignment, check-in/out, cancellation/no-show, housekeeping, charge, and payment routes remain the write contract. Public payment, charge, walk-in, check-in, and checkout inputs cannot set booking-email provenance; only the internal reviewed-email path can link that evidence. Room assignment and stay-date edits accept `expectedUpdatedAt`; stale versions return `409`, and serializable transactions plus inventory constraints arbitrate concurrent room claims. Check-in requires nationality and ID/passport evidence plus a settled balance, unless a Manager/Admin records a reasoned identity or pay-later override. No-show requires an operational reason, an active reservation, and an arrival date that is not in the future. Checkout deletes the reservation's room-date inventory in the transaction before early-checkout channel availability is reconciled. A folio remains open while the stay is active even when prepaid, closes on settled checkout, and remains open after an approved unpaid checkout until later settlement closes it. Configuration and reconciliation require `manage:channels`; current task completion is limited by the service to Front Desk, Manager, or Admin and requires the exact current revision and desired availability.

Cashier no longer inherits legacy booking-board, reservation, guest, or booking-email access. Its Lite access is the narrow `view:lite-payment-reconciliation` projection: safe folio/payment reconciliation fields only, with no guest identity suffix, payment notes, raw payment reference, or reservation timeline. Front Desk/Manager/Admin retain safe booking-email review permission; raw Gmail evidence is a separate Manager/Admin permission.

Front Desk and Housekeeping validate hotel-date input before enabling their queries, including the derived board range. The responsive shell exposes logout in the mobile top bar. Modal dialogs use labelled dialog semantics, initial focus, Tab/Shift+Tab containment, Escape close, and focus restoration. Housekeeping renders both arrival and departure notices for same-day turnover context; a dirty departing room retains `TURNOVER` priority. Operational timestamps and added error/status copy are localized for English/Thai and invalid timestamps render a bounded fallback rather than leaking raw values.

Session tokens contain a bounded non-negative `sessionVersion`. Authentication requires the token version to equal the active, unlocked database user. Versionless or stale tokens fail closed. Account lockout, password change, role change, active-state change, explicit deactivation, and logout increment the stored version, invalidating all previously issued tokens for that user.

### Gmail Push And Reconciliation

`POST /api/booking-email/gmail/push` is intentionally outside PMS session authentication because Google Pub/Sub calls it. It is not anonymous: the handler requires a Google-signed OIDC bearer token and verifies issuer, audience, verified service-account email, configured subscription, mailbox identity, bounded envelope size, message id, and numeric Gmail history id.

The handler persists a unique `BookingEmailPushDelivery` before acknowledging with `202`, then schedules bounded processing. Delivery states are `PENDING`, `PROCESSING`, `SUCCEEDED`, `COALESCED`, and `FAILED`. Source leases and retry availability prevent concurrent history work from being treated as success. A stale processing claim can be reclaimed.

The default delivery ceiling is eight claimed attempts. A non-retryable error or the eighth failed attempt persists a redacted terminal marker on a visible `FAILED` row and consumes the attempt budget, so the row no longer satisfies the claim predicate. Retryable failures below the ceiling receive bounded backoff. A source-lease collision restores the prior attempt count because no provider attempt ran.

`npm.cmd run booking-email:maintenance` is the Render cron contract. Each run:

1. renews Gmail watches that are missing or nearing expiry;
2. drains/retries durable push deliveries;
3. performs bounded Gmail history reconciliation for each enabled Gmail source; and
4. emits only redacted aggregate output.

Every Gmail ingestion call is forced to `reviewOnly: true`, including the push, history, reconciliation, and explicit Gmail sync paths. New, modified, and cancelled bookings must remain `NEEDS_REVIEW` until authorized staff approve them. A processed event cannot be reprocessed. Modification and cancellation approvals require an operational reason and use the existing PMS transaction functions. Before either lifecycle mutation, the service rejects the event if an equal-time or newer non-legacy modification/cancellation for the same property and linked reservation or provider reference exists in `NEEDS_REVIEW`, `ERROR`, or `PROCESSED`. The denied write transaction rolls back, then the service persists one sanitized `BOOKING_EMAIL_LIFECYCLE_DENIED` audit outside that transaction before returning the conflict.

The parser captures structured child ages plus common labels such as `Child age`, `Children ages`, `Ages of children`, and parenthesized age lists. Ages must be integers from 0 through 17 and the list length must equal the declared child count. Missing, invalid, or mismatched ages lower confidence and add `one valid age for every child` to the review reason; the approval service revalidates the same complete list before any booking/pricing mutation.

Normal booking-email list/detail responses contain review fields only; they omit `rawEmailUrl`, source message id, raw headers, and raw body. Raw evidence lookup uses the separate Manager/Admin-only endpoint, scopes the event to the configured property, requires a bounded operational reason, allows only an HTTPS `mail.google.com` link plus its source id, and creates `BOOKING_EMAIL_EVIDENCE_VIEWED`. The raw body is never returned. Cashier has no booking-email review or evidence permission.

At the Lite migration boundary, every pre-existing `BookingEmailEvent` is marked
`legacyReadOnly`, including unresolved rows from the bounded 1,000-message
historical import. New post-cutover rows retain the actionable default. Legacy
rows can be inspected but cannot be approved, rejected, reprocessed, or replayed.

Lite startup requires `CHANNEL_SYNC_QUEUE_BACKEND=lite_manual` and forbids the legacy in-process booking-email poller. Gmail Pub/Sub plus the separately scheduled `booking-email:maintenance` reconciliation command are the only Lite intake/recovery path; the retained legacy poller must not run in parallel.

All Gmail source selection/maintenance uses the configured property-code relation, defaulting to `SANDBOX`. Source list/create/update/sync and booking-email list/detail/evidence/approve/reject/reprocess resolve the configured property and reject cross-property ids. This scope is mutation authority; a matching opaque id alone is insufficient.

### Provider Attribution And Manual Availability

Provider codes are stored as extensible text so a future adapter does not require a destructive enum migration. Current connection/task write paths still allowlist only `booking_com`, `agoda`, and `trip_com`; unknown or disabled adapters fail closed at the service boundary. Reservations and booking-email events carry `providerCode` and `externalReservationId`; a property/provider/reference key supports idempotent exact matching before legacy or fuzzy suggestions.

An inventory-changing create, edit, cancellation/no-show, walk-in, or reviewed OTA action reconciles manual channel cells within the PMS transaction. Every change targets all enabled manual channels. An approved OTA email also reconciles its source provider with current absolute PMS availability so stale source-provider tasks are coalesced, superseded, or replaced instead of remaining actionable. The queue stores one active logical cell per provider/room type/date, coalesces an identical desired value, and supersedes an older active revision when availability changes. Each revision stores the exact external room id/name and rate-plan id shown to the operator. Mapping changes therefore create a retargeted revision rather than mutating existing work. A reasoned retry/reopen recalculates current absolute PMS availability and snapshots the current mapping before creating the next revision.

The queue is outbound work coordination only. It does not log in to or mutate any OTA. Staff open an official-domain Extranet URL, enter the exact desired availability, and complete the matching revision. There is no zero-lag or overbooking guarantee.

Manual task completion and reopen/retry resolve the task through its property relation and require property code `SANDBOX`; a task id from another property returns not found before status, revision, mapping, or availability mutation.

Manual connection activation requires active mapping coverage for every `RoomType` that owns at least one physical `Room`. This includes room types whose rooms are temporarily out of service because those rooms can become sellable again. One active external room-type/rate-plan target may map to only one PMS room type per connection; a partial database unique index is the concurrency guard. On a disabled-to-enabled transition, the same serializable transaction stages an initial absolute-availability baseline for only that connection across a validated 1–90-day horizon (default 90). Activation rolls back if any baseline task cannot be staged; an aggregate `MANUAL_CHANNEL_INITIAL_BASELINE_STAGED` audit record captures the bounded range and result counts. If a later room-type change leaves an enabled connection without a mapping, reconciliation creates no unusable task for those cells and records an aggregated `MANUAL_CHANNEL_TASKS_SKIPPED_UNMAPPED` audit event. Channel Desk task DTOs show the current external room type id/name and rate-plan id.

Booking.com remains manual because an ordinary individual-property Extranet account is not direct Connectivity API access. Agoda and Trip.com direct API routes require provider partner onboarding and testing; application submission and approval remain owner-gated. Channex delivery is represented by a disabled boundary that returns `CHANNEX_NOT_CONFIGURED` and refuses automatic pushes.

### Realtime Invalidation

The authenticated SSE endpoint accepts only users with the narrow `view:realtime` permission. It publishes allowlisted invalidation signals, never booking payloads. Permitted fields are event type, occurrence time, optional opaque entity id, and optional reason code. The client refetches authorized API data and retains a polling fallback. The current in-process hub is suitable only for a single server instance; it has no replay and is not a durable cross-instance event bus.

### Money Contract

`server/lite-service.mjs` reads nullable integer-satang fields as the authoritative Lite monetary contract and rejects required rows whose satang value is missing. `server/pms-service.mjs` derives satang plus legacy Float rollback parity from the same validated integer for property fees/tax, room-type rates, booking-email amounts, reservation pricing/deposits, folios, payments, and charges. Provider-reported totals remain exact even when nightly division does not divide evenly; `providerTotalSatang` plus `providerTotalCurrency` preserve their provenance and prevent silent recomputation. A pricing mutation requires exactly one active, system-managed `ROOM` charge; staff charge entry is incidental-only. Folio totals and balances are recomputed in satang. `prisma/migrations/20260713100000_money_satang_expand/` adds and backfills the original integer fields and basis-point tax field; `20260713130000_provider_total_provenance/` adds the provider-total guard; `20260714110000_rate_calendar_satang_and_provider_text/` adds/backfills the currently dormant rate-calendar shadow and removes rigid manual-provider database checks while service validation remains controlling. Any future RateCalendar writer must dual-write its satang/Float pair before that pricing surface is enabled. `npm.cmd run test:money-backfill:db` proves populated legacy backfill in an isolated guarded database, and `npm.cmd run money:reconcile` performs the read-only parity check.

`20260715150000_payment_reversal_idempotency` adds payment entry kind, reversal linkage/reason, payment/charge request ids, and charge-void metadata plus database shape/parity constraints. New payment and charge writes use serializable transactions. Reusing a request id returns the original result only when the immutable intent matches; a conflicting reuse fails. A reversal is a signed negative exact-satang row linked to an original positive payment, requires `refund:payment`, and cannot exceed its unreversed amount. Manager/Admin incidental-charge voids preserve the original charge and record reason, actor, time, request id, and audit evidence; room charges remain owned by the reservation-pricing flow. Reversal/void recomputation can reopen a checked-out folio when the adjustment creates a balance and reconciles deposit state.

`20260715160000_user_session_revocation` adds `User.sessionVersion`. Both new migrations are explicit transactions, but their application is still an operational boundary: stop after a failed apply, preserve the database, record `prisma migrate status`, inspect partial state, and rehearse recovery on a disposable restore before using `prisma migrate resolve --rolled-back`. Do not treat a schema-only or local migration check as applied staging/production proof.

Do not represent the production exact-money cutover as complete until a fresh recovery point, disposable restore, applied migration, reconciliation report, zero unexplained folio/payment discrepancies, and the rollback/contract phases are proven. Satang is the implemented Lite/runtime authority; existing Float fields remain required rollback parity during the pilot, and production Lite folio/payment sign-off stays open until the environment evidence exists.

### Release Contract

Lite must be deployed first as a separate staging service with a sanitized disposable/staging database. Public `/healthz` and `/healthz?deep=1` output is deliberately bounded to availability-safe service/UI/database state and is not a configuration inventory. A five-minute Gmail maintenance cron, Pub/Sub watch/push, migrations, review-only events, manual queue, roles, Thai/English flows, exact release metadata, and recovery must be proven there. Repository/local validation does not establish Gmail provider operation, Render migration/recovery success, Cloudflare routing/WAF enforcement, OTA provider approval, production data safety, owner sign-off, or staff acceptance. Use `docs/LITE_PILOT_ACCEPTANCE.md` for the seven-day shadow, 14-day pilot, sequential 48-hour OTA observation, and 30-day rollback record. See `docs/LITE_ARCHITECTURE.md` for the complete boundary.

### Lite hotel-essential contract

1. Property bootstrap applies exactly 30 physical rooms: 15 Superior Double and 15 Standard Twin. The staging bootstrap must stop on an unexpected room, a drifted floor/type assignment, or any database/tier/variant mismatch.
2. A standard booking persists dates, room type, occupancy/child ages, exact nightly rate, source, optional guest contact, special requests, and internal notes. Availability and optimistic-version checks remain server-owned.
3. Atomic walk-in requires today in the hotel timezone, a server-derived quote, an explicitly ready room, identity evidence, and either exact full payment or a reasoned Manager/Admin pay-later decision.
4. Check-in revalidates current room vacancy/readiness, identity, and settlement. A future reservation may be assigned to a currently occupied room only when its dates do not overlap; actual check-in may not.
5. Folios keep room and incidental charges, payment/reversal/void evidence, subtotal/tax/total/paid/balance, and open/closed state in PostgreSQL. Checkout begins with ledger review, permits authorized extras, and then requires exact settlement or a reasoned Manager/Admin unpaid override.
6. The printable guest document is a non-fiscal Guest Folio / Statement from persisted ledger data. A legal tax invoice requires a future backend document-number sequence plus verified tax identity/configuration.
7. Checkout marks the room dirty. Housekeeping follows dirty -> cleaning -> clean -> inspected, can record dirty correction, can take a vacant room out of service with reason, and can return it to service without falsely marking it inspected.
8. Cancellation/no-show frees inventory and records reason/audit evidence. Financial disposition is not inferred; owner policy must define refunds, retained payments, and cancellation/no-show charges.
