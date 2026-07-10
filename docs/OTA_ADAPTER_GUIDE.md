# OTA Adapter Guide - Hotel Ops

## Adapter Boundary

The AI and manager UI never control the browser directly. They create controlled task records. The backend validates and approves those records, then calls a typed OTA worker payload.

Current dispatch:

- `server/ota-adapters/index.mjs` routes Booking.com tasks to the Booking.com adapter.
- Agoda, Trip.com, and Expedia route to explicit dry-run adapter skeletons in `server/ota-adapters/platform-skeleton.mjs`.
- Unknown or all-platform tasks use the signed mock worker fallback.
- All worker execution is dry-run unless explicitly and safely changed later.

Booking-email historical backfill is not an OTA adapter and is not live OTA scrape proof. It imports Gmail-derived Booking Email Events for PMS review through `npm.cmd run booking-email:backfill`; staff approval is still required before any reservation, payment, cancellation, or room mutation. `npm.cmd run booking-email:deep-scan` and `npm.cmd run booking-email:reprocess -- --confirm` are review-queue maintenance tools only: they report redacted parser/duplicate posture and rerun the parser for existing review/error events, but they do not prove OTA reads or apply operational changes. OTA partner-admin, invoice, security, and performance-report emails must remain `UNKNOWN` unless staff explicitly reclassify them. Render Gmail OAuth setup uses `npm.cmd run gmail-oauth:render` or `npm.cmd run render:gmail-oauth` and remains a mailbox-provider setup step, not OTA proof. `/api/booking-email/status` can validate Gmail API reachability for the booking mailbox path, but that is mailbox-provider proof only. Hotel Ops scan snapshots exposed through `/ops/intelligence` are PMS-derived evidence and also do not prove live OTA scraping unless a live adapter read is separately configured and verified.

## Channel Synchronization V2 Boundary

Channel-sync v2 adds two operational mechanisms without changing the adapter proof standard:

1. **Near-live inbound email polling.** The existing scheduler polls enabled booking-email sources when `BOOKING_EMAIL_NEAR_LIVE_ENABLED=true` and Gmail OAuth is complete. Every scheduled call uses `reviewOnly: true`; it does not make reservation, cancellation, payment, rate, or inventory mutations.
2. **Manual outbound availability queue.** `server/availability-queue.mjs` creates high-risk `UPDATE_AVAILABILITY` tasks with owner approval, deterministic idempotency, task logs, and audit logs. Queue creation and approval do not call this adapter layer. A human must update the provider and record its confirmation/reference before the item is marked complete.

The queue supports Booking.com, Agoda, Trip.com, Expedia, and a Channex delivery target. Channex maps to the existing `all` platform only as metadata until a certified API adapter exists. It must not be routed to the mock worker as evidence of a real Channex update.

See [CHANNEL_SYNC_V2.md](CHANNEL_SYNC_V2.md) for commands, application status, activation, and the channel-only provider decision gate.

## Direct API And Channel-Only Tracks

- Agoda Direct Supply / YCS API access is tracked in [issue #168](https://github.com/nakalasbakalas/sandbox-pms/issues/168).
- Trip.com Open Platform access is tracked in [issue #169](https://github.com/nakalasbakalas/sandbox-pms/issues/169).
- Channex staging/certification evaluation is tracked in [issue #170](https://github.com/nakalasbakalas/sandbox-pms/issues/170).

These are preparation/evaluation tracks. Do not mark a direct API as submitted, approved, certified, or live without an external provider reference and non-production evidence. If true two-way, operationally zero-lag synchronization becomes essential, prefer a channel-only layer such as Channex rather than purchasing or operating a second full PMS. The local PMS remains the source of truth.

## Booking.com Adapter

File: `server/ota-adapters/booking-com.mjs`

Implemented:

- credential presence health check
- forced human challenge handling
- read reservation/rate/availability dry-run methods
- dry-run guest reply, rate, availability, open/close room, and description methods
- safe proof placeholders
- date, room type, task id, amount, and message validation
- real browser write gate through `OTA_ENABLE_REAL_BROWSER_WRITES`

Not complete:

- stable live selectors
- persistent browser session management
- real write execution
- external screenshot storage
- production account-owner verification

## Agoda, Trip.com, And Expedia Skeletons

File: `server/ota-adapters/platform-skeleton.mjs`

Implemented:

- platform-specific health and credential status
- read reservations, guest messages, rates, and availability dry-run methods
- dry-run rate, availability, open/close room, description, draft reply, and send reply methods
- safe proof placeholders
- selector-failure and human-challenge test paths
- non-dry-run write rejection with platform-specific staff messages

Not complete:

- verified live selectors
- persistent browser sessions
- provider-specific 2FA/CAPTCHA handling
- real browser reads or writes
- external proof storage
- production account-owner verification
- direct API credentials, certification, request signing, acknowledgement handling, or webhook reconciliation

## Adding A Platform

Add platforms incrementally in this order:

1. health check
2. human-challenge detection
3. read-only reservation scan
4. read rates and availability
5. dry-run write operation
6. proof capture
7. selector failure tests
8. safe test-date real write only after owner approval

For a direct API or channel-only integration, also require:

1. authenticated staging access;
2. property/room/rate mapping proofs;
3. idempotent inbound event handling;
4. ARI acknowledgement and retry/dead-letter behavior;
5. reconciliation against PMS inventory;
6. latency measurement;
7. provider certification;
8. production rollback and emergency-stop proof.

Do not add credentials to payloads. Adapters must read credentials only from backend secrets or a secret manager.

## Required Adapter Behavior

- Validate all required fields before opening any browser session or making an API request.
- Default to dry-run.
- Return `NEEDS_HUMAN` for CAPTCHA, 2FA, locked account, or password-expired flows.
- PMS staff account lockout is separate from OTA account challenges. OTA adapters must never bypass a locked OTA account, and PMS account reset must not be treated as OTA authorization.
- Do not retry a `NEEDS_HUMAN` task until an authorized PMS actor records the completed human step and the backend requeues it.
- Return structured `FAILED` results with safe error messages for selector or platform failures.
- Capture before/after or trace proof for write-like tasks.
- Redact credential-like values from summaries, metadata, and proof references.
- Never execute arbitrary browser commands from user text.
- Treat duplicate provider events and repeated outbound acknowledgements idempotently.
- Do not let a channel manager become the owner of front-desk, folio, housekeeping, guest, or accounting state.

## Dry-Run Worker Contract

A successful dry-run update should return:

```json
{
  "taskId": "task-id",
  "status": "SUCCEEDED",
  "summary": "Dry run: would update Booking.com Deluxe Room to 2200 THB.",
  "proofScreenshots": [
    {
      "kind": "before",
      "storageUrl": "mock://...",
      "capturedAt": "2026-07-01T00:00:00.000Z",
      "redactionStatus": "SAFE"
    }
  ],
  "data": {
    "dryRun": true
  }
}
```

A dry-run response is not acceptable proof for `availability:queue mark-sent`; the queue requires a real provider confirmation/reference entered by an authorized operator.

## Human Challenge Contract

When security challenge handling is required, return:

```json
{
  "taskId": "task-id",
  "status": "NEEDS_HUMAN",
  "summary": "Booking.com requires human CAPTCHA handling. No bypass attempted.",
  "errorCode": "NEEDS_HUMAN_CAPTCHA",
  "proofScreenshots": []
}
```

After the authorized person completes the challenge, staff should use the PMS `Human done` action with an operational reason. That records audit evidence and requeues the task; it does not bypass the challenge or run the worker automatically.
