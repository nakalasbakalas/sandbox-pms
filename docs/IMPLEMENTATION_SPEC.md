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
- `GET /api/ops/approvals`
- `GET /api/ops/notifications`
- `GET /api/ops/intelligence/alerts`
- `POST /api/ops/intelligence/alerts/:id/approve-recommendation`
- `POST /api/ops/intelligence/alerts/:id/acknowledge`
- `POST /api/ops/intelligence/alerts/:id/resolve`
- `GET/POST /api/ops/emergency-stop`
- `GET /api/ops/ota/status`
- `POST /api/ops/scan/run`
- `POST /api/internal/ops/worker/tasks`

## Parser Contract

The current parser is deterministic in `parseHotelOpsCommand`. It outputs the repo type `ParsedHotelOpsTask` with:

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

## Permission And Approval Rules

Rules live in `server/ops-service.mjs`.

- Read-only tasks can be queued for allowed roles.
- High-risk write tasks require approval.
- Owner approval is required for rate, availability, open/close room, listing update, and photo-class tasks.
- `UPDATE_PHOTOS` is critical and disabled in the MVP.
- Approval, denial, cancellation, alert recommendation, alert resolution, and emergency-stop changes require non-empty operational reasons.
- Emergency stop blocks write tasks during intake, approval, queueing, and worker execution.

## Queue And Worker

The task lifecycle is persisted in Prisma models:

- `HotelOpsTask`
- `HotelOpsTaskApproval`
- `HotelOpsTaskLog`
- `HotelOpsTrendAlert`
- `HotelOpsEmergencyStop`
- `HotelOpsNotification`

Queued tasks run through `runQueuedOpsTask`, which rechecks permissions and emergency-stop state before calling the signed worker boundary.

Worker requests:

- use HMAC signatures
- include timestamp and nonce
- reject replayed nonces
- reject credential-shaped fields
- reject unknown task types and platforms
- default to dry-run

## OTA Adapters

- Booking.com: dry-run adapter skeleton with typed methods and human-challenge handling.
- Agoda, Trip.com, Expedia: signed mock worker fallback.
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

Scheduled scans:

- positive `HOTEL_OPS_SCAN_INTERVAL_MINUTES` or `OPS_SCAN_INTERVAL_MINUTES` starts an in-process interval scheduler
- cron config is reported but expected to be run by external infrastructure
- overlapping scheduled runs are skipped
- scheduler status is exposed through `/api/ops/ota/status`

## Notifications

Notifications are backend records:

- `IN_APP` records are available immediately.
- `EMAIL` records are provider-pending intents unless a real mail provider is configured.
- Notification text and metadata are sanitized before persistence.
