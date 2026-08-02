# Implementation Spec - Sandbox PMS And Hotel Ops

This document describes the current Sandbox PMS backend and Hotel Ops implementation. Accounting V2 and direct booking are implemented as disabled-by-default engineering foundations; live-provider phases are not described as complete.

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
- `POST /api/ops/analyzers` for deterministic suggest-only analysis
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

PMS foundation API routes:

- `GET /api/openapi.json`
- `GET /api/system/capabilities`
- `GET /api/events`
- `GET/POST /api/rates/rules`
- `PATCH /api/rates/rules/:id`
- `GET/PUT /api/rates/calendar`
- `GET /api/rates/effective`
- `POST /api/rates/recommendations`
- `GET/PATCH /api/settings/property`
- `PUT /api/settings/tax`
- `GET /api/settings/status`
- `GET/POST /api/housekeeping/tasks`
- `POST /api/housekeeping/tasks/:id/assign`

Disabled-by-default foundation routes:

- `POST /api/accounting/v2/folios`, charges, payments, cash shifts, house accounts, receivables, and journals
- `GET /api/accounting/v2/folios/:id/balance` and `/api/accounting/v2/trial-balance`
- `GET /api/public/v1/availability`
- `POST /api/public/v1/quotes`
- `POST /api/public/v1/holds`
- `POST /api/public/v1/bookings`

Accounting mutations require `ACCOUNTING_V2_ENABLED=true`, authenticated property scope, role permission, a reason, and property-scoped idempotency. Direct-booking routes require `DIRECT_BOOKING_ENABLED=true`; holds/bookings additionally require a backend-only `DIRECT_BOOKING_TOKEN_SECRET` of at least 32 characters. Neither flag is authorization to enable production use without the acceptance gates.
- `POST /api/housekeeping/tasks/:id/status`
- `GET/POST /api/housekeeping/issues`
- `POST /api/housekeeping/issues/:id/status`
- `GET /api/night-audit/runs`
- `POST /api/night-audit/close`

Auth proof operator CLI:

- `npm.cmd run auth-rbac:proof -- --users-file <local-untracked-json>` performs credentialed login, `/api/auth/me`, optional owner-approved denial probes, logout, and post-logout `/api/auth/me` checks against the configured host.
- The helper masks login identifiers, prints initials instead of display names, keeps cookies in memory only, omits passwords/tokens/raw response bodies, and defaults denial probes to GET/HEAD only. Mutating denial probes require explicit `--allow-mutating-denial-probes` and an owner-approved no-op or invalid payload.
- Staff login policy is three failed attempts followed by persistent account lockout. Admin password reset through the user-management service clears `failedLoginAttempts` and `lockedAt`; normal successful login clears prior failed attempts.
- Server-mode authentication treats the HTTP-only backend session as the sole identity authority. Login and `/api/auth/me` resolve the configured property membership before signing or returning the user, and expose that effective role instead of the compatibility global role. It removes legacy `auth:current-user` / `auth:pms-token` browser values, keeps the resolved user only in React memory, and ignores superseded `/api/auth/me` responses after a newer login or logout.
- Server onboarding persists only a credential-free draft under `onboarding:server-state`. Admin password and confirmation values remain transient in memory; legacy credential-bearing onboarding keys are removed before and after setup attempts.

Booking-email operator CLI:

- `npm.cmd run booking-email:backfill -- --query "<approved Gmail query>" --limit <n> --max-pages <n>` performs a bounded Gmail historical dry-run using backend OAuth credentials and prints redacted capture/parser counts.
- Adding `--confirm` imports the scanned messages as review-only Booking Email Events in chunks controlled by `--import-batch-size`, defaulting to `50`, so large history loads do not run as one long database transaction.
- Adding `--confirm` imports the scanned messages into `BookingEmailEvent` rows for staff review in `/booking-inbox`. It does not approve events or directly create, modify, cancel, charge, or assign reservations.
- Without an explicit `--query`, the helper uses the approved provider-query default: common OTA/provider senders, spam/trash excluded, recent-only by default, and known Booking.com security, Trip.com performance, and Agoda partner-invoice noise excluded. `--all-past` removes the recency bound while keeping the same approved-provider scope. `--primary-mailbox-query` is the explicit fallback for the old `to:booking@sandboxhotel.com` troubleshooting boundary.
- `npm.cmd run booking-email:deep-scan -- --limit <n>` reports redacted aggregate parser coverage, duplicate-scope, and workflow anomalies for the current PMS booking-email queue. Adding `--strict` exits non-zero when high-severity findings remain.
- `npm.cmd run booking-email:reprocess -- --confirm` reparses only selected `NEEDS_REVIEW` / `ERROR` Booking Email Events through the current parser and keeps them in the review queue for staff approval.
- Cancellation detection requires an explicit booking/reservation cancellation phrase, notification, or status. Generic cancellation-policy, free-cancellation, cancellation-fee, and cancellation-terms boilerplate is not a cancellation event signal.
- Booking-email amount extraction discards non-finite, non-positive, and exact-money values that cannot be represented by the compatibility baht-number API; it does not truncate or coerce oversized provider identifiers into financial data.
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

## 2027 Demand Calendar Preload (Nakhon Si Thammarat)

This repo includes a deterministic 2027 demand-calendar preload pipeline for room rates.

- Script: `scripts/generate-demand-calendar-overrides.mjs`
- Canonical source: `C:/Users/nakal/Downloads/nakhon_si_thammarat_2027_hotel_demand_calendar.xlsx`
- Required source columns: `Date`, `Demand Tier`, `Rate Multiplier` plus `2027 Status` and `Review / Reprice Date` when available
- Baseline room rates are canonicalized before multiplication:
  - `TWIN = 750`
  - `DOUBLE = 850`
- Multiplier model for non-normal dates:
  - low `0.9`, normal `1.0`, high `1.15`, peak `1.35`, compression `1.6`
- The script validates source row count (`365`) and tier mix (`low 42 / normal 162 / high 106 / peak 41 / compression 14`) and fails on mismatch.
- Script output is versioned and stores metadata for rollback:
  - manifest (`.manifest.json`)
  - CSV (`.csv`) for bulk upload
  - local backup (`.rate-overrides-backup.json`)
- Supported run path:

```powershell
npm.cmd run rates:preload:nakhon-2027
```

- Expected runtime workflow:
  1. Generate manifest/CSV from the workbook.
  2. Import into `BulkRateUpload` (Excel accepted; supports metadata columns).
  3. Confirmed rows can be surfaced as active enforcement by promoting `sourceStatus` to `CONFIRMED`.
  4. Use `RatesView` for override review with explicit filter and audit-by-date visibility.
  5. Run `use-rate-push` operations in dry-run/verification path before any live channel changes.

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

The server owns the trust and action matrix. `POST /api/booking-email/sync` does not accept caller-supplied event arrays; only the bounded Gmail backfill helper can opt into imported events after those events were obtained from the configured provider. Approval rejects an action mode that is not valid for the stored event type. New bookings may apply, create, or link; payment notices, cancellations, and modifications may apply or link; guest messages and unknown messages may only link. Cancellation requires `cancel:reservation` and a non-empty operational reason. Modification apply requires `edit:reservation`, a non-empty operational reason, and calls the authoritative reservation update service. Payment apply always enforces the current folio balance and has no request-controlled overpayment exception.

- Approve uses `apply_parsed` for payment/modification/cancellation-style events and links matched new bookings to avoid duplicate reservations.
- Edit Parsed Details Then Apply submits corrected `editedDetails` through the same approval route.
- Reprocess reruns the deterministic parser against stored email text, clears stale `processedBy`/`processedAt` state, and returns the event to `NEEDS_REVIEW`; it does not auto-approve or bypass staff review.

### Controlled booking autonomy

The near-live scheduler polls enabled Gmail sources at a bounded interval (30 seconds by default). Its default Gmail query is the bounded approved-provider sender scope and deliberately does not require `to:booking@sandboxhotel.com`, because provider mail may arrive by BCC or forwarding. It sends `reviewOnly: false` only when the global autonomy policy is configured. A source must also have `autoProcessSafeEvents=true`, which only a manager or administrator may change.

Automatic PMS writes are restricted to `NEW_BOOKING`. The server requires an owner-configured trusted sender domain, Gmail SPF/DKIM pass evidence by default, a provider reference, no parser or duplicate conflicts, confidence at or above both the hard 0.95 floor and the source threshold, one unambiguous active OTA `ChannelMapping`, and an available mapped room. The room is validated and reserved within the same serializable reservation transaction. Booking.com, Agoda, Trip.com, Expedia, and Airbnb are authoritative channel/source values; Trip.com uses `TRIP`.

The PMS persists deterministic extraction in `parsedDetails` JSON and the policy result in `automationDecision` JSON. Consistent same-reference/same-type emails are corroborating evidence; contradictory guest, stay, room-type, or amount fields block automation. Replayed messages never overwrite already processed or ignored events. A matched existing reservation is linked rather than recreated. A blocked or low-confidence event remains `NEEDS_REVIEW` (or `ERROR` after an execution failure), claims `managerReviewNotifiedAt`, and creates at most one in-app `APPROVAL_REQUEST` for `HOTEL_MANAGER` with no raw email body or guest details in notification metadata.

Production activation requires the Gmail credential path plus `BOOKING_EMAIL_NEAR_LIVE_ENABLED=true`, `BOOKING_EMAIL_AUTONOMY_ENABLED=true`, `BOOKING_EMAIL_TRUSTED_SENDER_DOMAINS=<owner-approved domains>`, and a manager-enabled source. `BOOKING_EMAIL_AUTO_ASSIGN_ROOMS`, `BOOKING_EMAIL_REQUIRE_AUTHENTICATION_RESULTS`, and `BOOKING_EMAIL_NOTIFY_MANAGER` default true. `BOOKING_EMAIL_REQUIRE_CORROBORATION` defaults false and may be enabled when two-message confirmation is an owner requirement. Historical backfill and reprocess always remain review-only.
- Link/Create requires an explicit reservation id for linking; unmatched new-booking events can create a reservation from parsed details.
- Cancellation email actions require an operational reason so the audit trail captures the staff decision.
- Mailbox sync remains separate from event review; Gmail sync requires server-side Gmail API credentials, either an OAuth access token or backend OAuth refresh-token credentials, and must not use a pasted mailbox password. `GET /api/booking-email/status` returns non-secret diagnostics for OAuth client presence, refresh token presence, target mailbox presence, missing key names, last sync state, and Gmail API profile connectivity. Render setup should use the booking-specific `BOOKING_EMAIL_GMAIL_*` env vars plus either the `gmail-oauth:render` code-exchange/apply helper or the dry-run-first `render:gmail-oauth` helper when applying credentials from a secure shell.
- `server/booking-email-workspace-json.mjs` optionally reads Google Docs or stored JSON/text from `BOOKING_EMAIL_WORKSPACE_JSON_FOLDER_ID` when `BOOKING_EMAIL_WORKSPACE_JSON_ENABLED=true` and the OAuth token carries `https://www.googleapis.com/auth/drive.readonly`. Folder listing is capped at 100 files, each sync exports at most 20 reference-matched candidates, and each document is capped at 64 KB.
- Workspace JSON accepts only the documented nested/top-level booking fields, normalizes reference/type/dates/room/amount, rejects unknown fields and invalid/no-reference records, and discards model grades and justification prose. The email remains authoritative. Only exact reference/type/date/room alignment adds 0.02 confidence; any conflicting shared field keeps the event in review. Persisted Workspace evidence contains no guest value or raw Drive content.
- LittleHotelier mail from the verified `app.littlehotelier.com` sender is included in the bounded provider query and parsed as email-source booking evidence. It is not eligible for provider-mapped automatic assignment until a supported ChannelProvider/mapping boundary is implemented.

## Notifications

Notifications are backend records:

- `IN_APP` records are available immediately.
- `EMAIL` records are provider-pending intents unless a real mail provider is configured.
- Optional Gmail API delivery is backend-only and opt-in through `HOTEL_OPS_EMAIL_DELIVERY_ENABLED=true`; it uses backend Gmail OAuth access-token or refresh-token credentials.
- Successful delivery updates the email notification to `SENT` with provider message metadata; provider failures update it to `FAILED` with redacted error metadata.
- Notification text and metadata are sanitized before persistence.
- The shared PMS header notification bell/center reads `/api/ops/notifications` in server mode for users with `view:ops`, merges those records with local housekeeping alerts, and links staff back to the relevant Ops screen.
- Read and dismiss actions call backend acknowledgment routes, persist actor/timestamp fields, and create audit records. This acknowledgment state is separate from provider delivery status.

## Provider Adapter Contract

- Each OTA adapter is registered through `defineProviderAdapter()` with declared read and write operations. Contract construction fails when a declared operation lacks its backend method.
- `getOtaProviderContracts()` returns strict, credential-free contract DTOs containing normalized health, dry-run capabilities, retry policy, rate-limit source, and evidence policy.
- Live writes require all three conditions: `OTA_LIVE_WRITES_ENABLED=true`, an implemented live-write path, and verified provider proof. Current adapters intentionally declare the latter two as false.
- Worker proof remains untrusted; provider evidence is bounded, kind-normalized, URL-sanitized, and blocked when redaction status is not safe.

## Autonomous Operations Shadow Foundation

- `ExternalProviderEvent` is an immutable, property-scoped normalized envelope keyed by provider event identity/version and a property-scoped idempotency key. It stores sanitized normalized payloads and hashes; it is not the SSE `DomainEvent` outbox.
- `ProviderSyncCursor` preserves restart-safe opaque cursor state without becoming execution authority. `ProviderSnapshot` is an additive schema reservation only; snapshot capture and read services are not implemented in this phase.
- `AutonomyPolicy` is scoped by property/provider/task/version. The current schema permits only `OBSERVE`, `SHADOW`, and `PROHIBITED`; policy validation enforces source trust, confidence basis points, room/date/rate/volume limits, quiet hours, proof requirements, and emergency-stop coverage.
- `AutonomyRun`, `AgentDecision`, and `ActionExecution` preserve the event-to-decision evidence chain. `SHADOW_NOOP` is the only execution mode, and a database constraint requires `providerRequestSent=false`.
- `ReconciliationIssue` and `DeadLetterEvent` are additive schema reservations for later drift and terminal-failure services. No current service creates, retries, or presents those records.
- The shadow service writes canonical events, policies, cursor state, audit rows, domain events, decisions, and `SHADOW_NOOP` evidence only. Source guards prohibit OTA worker/browser imports and authoritative reservation, payment, charge, rate, or inventory writes.
- PostgreSQL transaction-scoped advisory locks serialize the same property/job/source occurrence across instances. The retry module only classifies bounded shadow-ingestion retries; it contains no timer or provider execution loop.
- `Channel.credentials` remains temporarily as an `@ignore`d rollback-compatibility column so the previous application build can still select Channel rows after the additive migration. Its database default is `{}` and `Channel_credentials_must_be_empty` rejects every non-empty value. New services do not read or write it. `credentialRef` may point to a backend secret manager/environment contract while `credentialStatus` contains non-secret readiness metadata only.
- Provider acknowledgements and compensation actions are intentionally deferred until a real provider write/read-back lifecycle exists. The OpenAI Agents SDK is also deferred; any future agent tool may read sanitized snapshots or submit typed candidates, never execute or mutate policy.

## Exact-Money Compatibility Contract

- Money is represented internally as integer satang. JSON-facing exact fields such as `amountSatang`, `rateSatang`, and `totalSatang` are base-10 integer strings so JavaScript JSON never serializes a `BigInt` directly.
- The additive migration keeps existing Float baht columns and adds nullable PostgreSQL `BIGINT` shadow columns plus integer basis-point fields. It backfills representable legacy values using PostgreSQL `ROUND(value * 100)` and leaves unsafe out-of-range values null for reconciliation.
- Supported new writes call the shared money helpers to dual-write legacy baht and exact satang. If a request supplies both forms, they must represent the same rounded value or validation fails.
- `MONEY_READ_AUTHORITY=legacy_float|satang` selects preferred reads. Missing or invalid configuration defaults to `legacy_float`; either path can fall back to the populated representation during the compatibility window.
- Payments and legacy folio charges run in serializable transactions, re-read property-scoped folio ownership, require property-scoped idempotency keys, and retry serialization or unique-key races. A same-intent retry returns the original financial row without duplicating audit/domain evidence; reuse with a different payment or charge fingerprint returns `409`. Posted charges remain append-only.
- The database uniqueness contract is `(propertyId, idempotencyKey)` for both `Payment` and `Charge`; a key used by one property cannot replay or block a different property's write. Charge intent fingerprints include folio, optional explicit date, description, category, exact amount, quantity, and optional booking-email source.
- Staff reservation and guest creation requires `x-idempotency-key`. `PmsCreateAttempt` is unique on `(propertyId, idempotencyKey)` and stores operation, one-way intent/result fingerprints, and the resulting entity identifier only. Same-intent replay returns the original entity with `idempotentReplay: true` and no duplicate guest/reservation/folio/charge/audit/history/event effects; changed intent or operation, or a changed/deleted original result, returns `409`. The same key remains independently usable by another property.
- Server-mode cashier, front-desk, reservation, booking-board, guest-create, and message-draft submissions use `DurableAttemptKeyManager`. It stores only a hashed operation/entity slot, intent fingerprint, and opaque key in same-tab `sessionStorage`, reuses the key for an unchanged uncertain attempt across a full reload, rotates when material input changes, and removes it only after confirmed authoritative read-back. It never stores the request material or raw entity identifier and never uses `localStorage`; the backend remains authoritative for replay validation.
- Check-in and check-out require a top-level property-scoped lifecycle idempotency key even when no payment is posted. They execute in a serializable transaction under reservation, room-date, and idempotency advisory locks, optionally reject a stale `expectedUpdatedAt`, and persist one completed `ReservationMutationAttempt`. An unchanged retry may return the same authoritative result without duplicate audit/history/event evidence; changed intent, missing key, stale state, or a superseded result fails closed.
- The legacy Accounting Dashboard and Cash Reconciliation components use browser KV only in explicit demo mode. Server mode displays a non-operational capability boundary until the Accounting V2 read/write UI is wired and proven.
- Satang authority must not be enabled in production until row-level null and variance checks plus aggregate reconciliation pass on a restored staging copy. This branch does not remove legacy columns.

## Property Request Context

- After session authentication, `resolveRequestContext()` resolves the configured `SANDBOX` property and requires an active `(userId, propertyId)` `UserPropertyMembership`.
- The request context contains request id, actor, property id/code, membership id, effective role, and optional `X-Idempotency-Key`. Membership role takes precedence over the compatibility global user role.
- Authentication responses use the same membership resolution as protected PMS requests. A user with a broad global role and a narrower active-property membership receives the narrower role in the HTTP-only session payload and frontend identity.
- The additive migration backfills existing active and inactive users into the existing `SANDBOX` property using their current role and active state. Setup and user-management services create or update the membership with the compatibility user record.
- Property-aware services must scope every lookup and mutation by `context.propertyId`; resource identifiers from the client are never property authority.
- `Guest`, `Payment`, `Charge`, and `AuditLog` have first-class property ownership. Backfills derive ownership from reservation/folio relationships or the single `SANDBOX` compatibility boundary and abort when ambiguous or ownerless data cannot be reconciled safely.
- The application remains a single-property product in this phase. Membership scaffolding is an isolation control, not a claim that multi-property administration or SaaS tenancy is complete.

## iCal Export Token Contract

- An iCal export token is a bearer credential. `Channel.config` stores `exportTokenHash`, calculated as SHA-256 over the exact UTF-8 token bytes and encoded as unpadded base64url; it does not store a newly issued raw token.
- Private provider import URLs are not accepted or stored. Migration `20260719100000_remove_raw_ical_import_urls` removes legacy `Channel.config.importUrl` values and disables inbound iCal sync; future inbound iCal requires an approved secret-reference service.
- Initial issue and explicit rotation require a valid `x-idempotency-key`. The token is deterministically HMAC-derived from the backend-only session secret and that property/provider/key. `ChannelMutationAttempt` retains the non-secret request key, intent fingerprint, and a bearer-free public result; `Channel.config` retains only token hashes. Same-intent retry reconstructs the original URL without duplicate evidence only while that token remains current or inside its grace window on an active channel. Disabled or expired/superseded retries return `409`; changed intent also returns `409`. Rotation retains up to four previous token hashes for a 15-minute recovery window.
- Property/provider configure and disable operations share a PostgreSQL transaction advisory lock, preventing duplicate setup and lost-disable races.
- Every iCal configuration/disable and channel-mapping create/update/delete requires a valid `x-idempotency-key`. Migration `20260719103000_channel_mutation_idempotency` adds property-scoped intent/result records; unchanged retries return the original public result without duplicate audit/domain evidence and changed intent returns `409`.
- iCal and channel-mapping inputs reject unknown fields and require a URL/credential/contact-free reason in the JSON body. The reason is sanitized again before property-scoped audit persistence; domain evidence omits it. All evidence states `providerWrite: false`.
- Server-mode `/channels` loads iCal configuration, mappings, room setup, and capability evidence as one authoritative snapshot. A failed dependency clears the snapshot and blocks all writes; there is no browser-state fallback.
- A failed iCal configuration request must keep the dialog open and render the sanitized server error inline. The same in-memory idempotency key remains attached to an unchanged retry.
- Only iCal configuration and room mapping are operational in server mode. Provider rate push, parity, inventory synchronization, provider logs/performance, and browser reservation import stay unavailable until dedicated authenticated services and provider proof exist.
- Migration `20260717141000_ical_token_hash_backfill` uses PostgreSQL `pgcrypto` to convert legacy `config.exportToken` values to the same digest and remove the raw field in one row update. The migration aborts if an object config still contains a raw token afterward.
- The raw feed URL is returned only when a token is first issued or explicitly rotated. List responses, later reads, and configuration updates do not reconstruct or re-disclose it.
- The service can opportunistically sanitize a legacy row encountered before migration completion, but that compatibility behavior does not replace running and proving the deploy migration.

## Domain Events And SSE

- Mutating services call `recordDomainEvent()` inside the same Prisma transaction as the operational change and audit record.
- `DomainEvent.id` is a monotonic PostgreSQL `BIGSERIAL`. Catch-up reads are restricted to the authenticated request property, ordered by id, and bounded to 250 rows per query.
- `GET /api/events` requires session authentication, active property membership, and `view:board`, `view:cashier`, or `view:guests`. Every event is filtered through aggregate-to-permission allowlists; `view:board` is not a superuser stream. Cashier access contributes charge, folio, payment, and reservation aggregates; guest-directory access contributes guest and reservation aggregates; other domains require their own view permission. Each poll revalidates the user and effective membership, and closes the stream with a reconnect signal after revocation or role loss. The endpoint accepts `Last-Event-ID` or `?after=`, polls PostgreSQL in bounded batches, emits two-second updates and heartbeats, and can be disabled with `SSE_ENABLED=false`.
- The public event payload intentionally omits actor id and metadata. It contains only string id, event type, aggregate type/id, and occurrence time.
- The React bridge maps the existing reservation, room, payment, and charge event types to client refresh signals. Rates, settings, housekeeping, and night-audit views still need explicit event/refetch handling where their UI requires immediate refresh.
- In server mode, `/rooms` consumes the authenticated `/api/front-desk/board` snapshot for property display, room types, and rooms. It fails closed with an unavailable/retry state when that API fails; Spark/browser-KV room, property, and room-type data remains demo-only.
- In server mode, `/reservations` consumes authenticated reservation-list data and the Board room/readiness snapshot only. It fails closed with an unavailable/retry state when either API authority fails; Spark/browser-KV reservation, guest, room, and unassigned-stay data remains demo-only, and no create affordance is rendered until both server snapshots are ready.
- In server mode, `/cashier` consumes its folio projection from the authenticated `GET /api/cashier/folios` API only. It fails closed with a Cashier unavailable/retry state when that snapshot fails; browser-KV folios, cashier folios, and accounting entries remain demo-only, and no folio rows, zero-value operational statistics, payment controls, or charge controls render before authoritative data is available.
- A `CAFE_STAFF` membership may view and refetch the authenticated Cashier folio projection and use its separately permissioned charge flow, but it cannot render or invoke payment collection/recording controls. Permission changes do not substitute browser state for the server snapshot.
- In server mode, Front Desk, `/guests`, and `/messaging` select server-only data providers and never mount their demo `useKV` or KV-backed room-sync hooks. All three workspaces fail closed with Retry and no operational metrics, rows, assistant context, or mutation affordance when an authoritative read fails; `New Guest` additionally requires `edit:reservation`. Successful guest creation and message drafts refetch or update server state and survive reload. Message drafts require one valid idempotency key in the request header, reject a conflicting body key, compare the complete replay intent, and serialize same-key PostgreSQL writes so concurrent retries return one persisted draft.
- The client event bridge subscribes to the real emitted `RESERVATION_ROOM_ASSIGNED` and `RESERVATION_GUEST_UPDATED` names as reservation invalidations. Views use those events only to refetch authoritative APIs; event payloads never become operational state.

## Booking Email Provider Extraction And Mapping Suggestions

- `parseBookingEmailDetails()` applies provider-specific deterministic extraction before the existing generic fallback. Provider selection comes only from normalized sender/source identity; it does not grant trust or write authority.
- Agoda parsing supports bilingual multiline and whitespace-collapsed `Booking ID`, customer first/last name, check-in/out, and room-table fields. Booking-id cancellation subjects override booking-confirmation boilerplate; generic cancellation/modification policy text cannot classify a confirmation as a modification. Trip.com parsing supports `Booking no. #...# accepted`, multiline slash-form guest names, `Staying period` text-month ranges, and room labels with rate-plan suffixes. Booking.com parsing supports multiline reservation number, guest, arrival/departure, and room-category values.
- Reprocessing excludes the event's old `parsedDetails` input and derives fresh JSON from stored sender, subject, and canonical raw text. Initial ingestion may consume trusted Workspace-extracted JSON, but maintenance reparse cannot preserve stale derived fields ahead of a newer deterministic parser.
- Collapsed Agoda dates are extracted as exact calendar tokens within a bounded distance of the provider label; collapsed Trip.com guest names are bounded by the next `Room Type` label before slash-name normalization. Neither parser uses an unbounded body capture.
- Textual and numeric provider dates are calendar-validated before becoming Bangkok date keys. Invalid dates remain missing and therefore review-gated.
- `listChannelMappingSuggestions()` is property-scoped and read-only. It scans at most 1,000 recent new-booking/modification events, groups at most 100 unique provider/label pairs, and emits only PII-free aggregate fields. A PMS room type is suggested only when every observation in that group has one consistent parsed room code and that code exists in the active property.
- `GET /api/channels/mapping-suggestions` requires `view:channels`. It is not a mutation endpoint. Channel creation and mapping persistence continue through the existing `manage:channels`, reason-gated, idempotent service functions.

## Rate And Settings Services

- Rate rules support percentage adjustments in integer basis points and fixed/override amounts in satang. Date-specific calendar rates and computed effective rates are property/room-type scoped.
- `POST /api/rates/recommendations` is deterministic and suggest-only. Applying a recommendation requires a separate authorized rate mutation; it cannot update an OTA or bypass Hotel Ops approval policy.
- In server API mode, the primary Rates view uses the backend service. The older Spark `useKV` rate experience remains only on the explicit demo path.
- Property settings accept allowlisted profile, fee, policy, operations, accounting-export, and recorded-payment-method fields. Every write requires manager/admin authority and an operational reason.
- Tax settings use basis points and structured tax items. Credential-shaped values, URL credentials, sensitive query parameters, unknown fields, invalid time zones, and unsupported payment-gateway enablement fail validation.
- `/api/settings/status` is sanitized and server-derived. It reports configuration and capability state, not staging, provider, recovery, or owner proof.

## Persistent Operations Foundation

- Housekeeping tasks persist property, room, type, priority, schedule, assignee, status, creator, completion time, reasoned status history, audit records, and domain events. Assignees must be active members of the same property.
- Housekeeping issues persist category, severity, linked task/room, assignee, reasoned status history, and resolution evidence. Critical issue resolution or closure requires manager/admin authority.
- Night audit stores one run per `(propertyId, businessDate)` and one attempt per `(propertyId, idempotencyKey)`. Close requires manager, admin, or system authority plus an operational reason.
- Night audit snapshots unresolved arrivals/departures, in-house stays, open folios, housekeeping blockers, unposted room charges, and exact-satang financial totals.
- Emergency stop and unposted room charges are non-overridable blockers. Only an admin may override other blockers and must supply an override reason.
- Current posting mode is `VERIFY_EXISTING_CHARGES_ONLY`; the service does not create missing nightly room charges. A run cannot be marked complete when a non-overridable blocker remains.
- In server mode, the housekeeping and Night Audit React screens use these persistent APIs and refetch authoritative state after writes; browser-local workflow state is restricted to explicit demo mode. This implementation status is not staff workflow acceptance.

## Release Verification Contract

- Fast CI validates schemas, focused fixtures, typecheck, lint, build, and launch configuration.
- Integration CI migrates an empty PostgreSQL database, migrates and seeds a separate disposable PostgreSQL database, runs guarded database workflow tests, and runs authenticated server-mode browser reload/error tests against the exact checked-out commit.
- The PostgreSQL suite must prove two-property isolation, membership-role enforcement, first-class audit ownership, property-scoped payment/charge/lifecycle idempotency, unchanged replay without duplicate evidence, stale lifecycle rollback, concurrent lifecycle and payment/charge behavior, exact reconciliation, and simultaneous last-room hold serialization.
- The browser suite must prove the effective membership role governs visible actions, Board guided handoffs do not mutate, persisted state survives reload, injected failures remain truthful, recovery refetches authoritative state, and SSE catch-up filters foreign-property events.
- CI success is engineering evidence only. Restored-staging migrations, rollback/recovery, staff workflows, provider credentials/results, WAF, and owner approval require separate evidence.

## Server Booking Board Command Contract

- The server-mode Booking Board reads one property-scoped range from `GET /api/front-desk/board`; the legacy browser-KV Board remains demo-only.
- The Board opens guided check-in/check-out and Cashier folio details through the allowlisted `reservationId`, `folioId`, and `workflow` URL contract. Identifiers are sanitized, route/intent combinations are allowlisted, consumed parameters are cleared, and no handoff uses `localStorage` or `sessionStorage`. Handoffs do not mutate hotel state.
- Front Desk AI may read, explain, suggest, and navigate to those staff workflows. It may not POST a reservation, room, housekeeping, or finance mutation.
- Staff may select an unassigned stay or an assigned timeline segment when they hold at least one relevant command permission. `edit:reservation` enables compatible-room assignment/move through `POST /api/reservations/{id}/assign-room`, stay-date resize through `PATCH /api/reservations/{id}`, and reservation-scoped guest updates through `PATCH /api/reservations/{id}/guest`; guest editing additionally requires `view:guests`. `cancel:reservation` enables reason-required cancel/no-show commands. `post:charges` enables exact-satang extras only when the backend reports the legacy-folio charge capability and the reservation has an open folio.
- The UI uses server-provided room-type identity to disable incompatible targets, while backend room type, overlap, room-status, block, capacity, and property validation remains authoritative.
- Mutation attempts carry `x-idempotency-key`, disable repeat interaction while pending, and never move, resize, close, edit, or charge a stay optimistically. Known accepted and rejected responses trigger an authoritative Board refetch; an ambiguous network outcome retains the same in-memory key for an unchanged retry.
- Assignment, resize, cancel, no-show, and reservation-scoped guest commands fingerprint the operation and intent in a property-scoped `ReservationMutationAttempt`; matching replays return the original still-current outcome without duplicate history/audit/domain evidence, while changed intent or a superseded outcome returns `409`. Lifecycle and guest edits also carry authoritative update timestamps and reject stale writes.
- Assignment and resize use serializable transactions, transaction-scoped PostgreSQL advisory locks for the reservation and affected room dates, bounded serialization retry, and create-only inventory claims. A conflict can never update another reservation's inventory row.
- Cancel/no-show uses the same serializable reservation lock, requires an operational reason, rejects checked-in/terminal reservations, and prevents a future arrival from being marked no-show. Guest audit evidence stores changed field names, not contact values. Folio extras use the existing serializable, property-scoped `Charge` idempotency contract and accept base-10 `amountSatang`.
- `GET /api/front-desk/board` returns an allowlisted reservation DTO rather than the raw Prisma include. Contact/profile fields require `view:guests`; financial/folio fields require cashier, charge, or payment authority; general reservation notes and channel references require `view:reservations`.
- The Board does not silently convert a failed command into success. The previous persisted state remains visible after rejection and full reload. Room-block authoring/clearing and destructive deletion policy remain separately permissioned operational work.
