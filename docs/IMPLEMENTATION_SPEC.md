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

Every scan persists a `HotelOpsScanSnapshot` before alert upserts. The snapshot records the scan window, actor/source channel, active reservations, sellable rooms, cancellation-log count, occupancy, velocity, cancellation, room-type occupancy, OTA distribution, generated insights, and final created/updated alert counts. Created or refreshed trend alerts link back to the snapshot that produced the current alert metrics.

Scheduled scans:

- positive `HOTEL_OPS_SCAN_INTERVAL_MINUTES` or `OPS_SCAN_INTERVAL_MINUTES` starts an in-process interval scheduler
- cron config is reported but expected to be run by external infrastructure
- overlapping scheduled runs are skipped
- scheduler status is exposed through `/api/ops/ota/status`

## Parser Validation

Hotel Ops commands use `server/ops-service.mjs`. Parsed task output is strict-schema validated before permission decisions, task persistence, approval routing, or worker queueing. Schema failures are recorded as validation failures and audited through the existing Hotel Ops task log/audit path. OpenAI parsing is optional, backend-only, redacted, and never an execution authority.

## Booking Email Inbox

The Booking Inbox is a staff-facing exception queue for email-derived booking events. Existing imported events can be approved, edited and applied, linked to an existing reservation, used to create a reservation, rejected, or reprocessed through `server/pms-service.mjs`.

- Approve uses `apply_parsed` for payment/modification/cancellation-style events and links matched new bookings to avoid duplicate reservations.
- Edit Parsed Details Then Apply submits corrected `editedDetails` through the same approval route.
- Link/Create requires an explicit reservation id for linking; unmatched new-booking events can create a reservation from parsed details.
- Cancellation email actions require an operational reason so the audit trail captures the staff decision.
- Mailbox sync remains separate from event review; Gmail sync requires server-side Gmail API credentials, either an OAuth access token or backend OAuth refresh-token credentials, and must not use a pasted mailbox password.

## Notifications

Notifications are backend records:

- `IN_APP` records are available immediately.
- `EMAIL` records are provider-pending intents unless a real mail provider is configured.
- Optional Gmail API delivery is backend-only and opt-in through `HOTEL_OPS_EMAIL_DELIVERY_ENABLED=true`; it uses backend Gmail OAuth access-token or refresh-token credentials.
- Successful delivery updates the email notification to `SENT` with provider message metadata; provider failures update it to `FAILED` with redacted error metadata.
- Notification text and metadata are sanitized before persistence.
- The shared PMS header notification bell/center reads `/api/ops/notifications` in server mode for users with `view:ops`, merges those records with local housekeeping alerts, and links staff back to the relevant Ops screen.
- Read and dismiss actions call backend acknowledgment routes, persist actor/timestamp fields, and create audit records. This acknowledgment state is separate from provider delivery status.
