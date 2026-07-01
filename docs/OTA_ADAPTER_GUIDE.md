# OTA Adapter Guide - Hotel Ops

## Adapter Boundary

The AI and manager UI never control the browser directly. They create controlled task records. The backend validates and approves those records, then calls a typed OTA worker payload.

Current dispatch:

- `server/ota-adapters/index.mjs` routes Booking.com tasks to the Booking.com adapter.
- Agoda, Trip.com, and Expedia route to explicit dry-run adapter skeletons in `server/ota-adapters/platform-skeleton.mjs`.
- Unknown or all-platform tasks use the signed mock worker fallback.
- All worker execution is dry-run unless explicitly and safely changed later.

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

Do not add credentials to payloads. Adapters must read credentials only from backend secrets or a secret manager.

## Required Adapter Behavior

- Validate all required fields before opening any browser session.
- Default to dry-run.
- Return `NEEDS_HUMAN` for CAPTCHA, 2FA, locked account, or password-expired flows.
- Do not retry a `NEEDS_HUMAN` task until an authorized PMS actor records the completed human step and the backend requeues it.
- Return structured `FAILED` results with safe error messages for selector or platform failures.
- Capture before/after or trace proof for write-like tasks.
- Redact credential-like values from summaries, metadata, and proof references.
- Never execute arbitrary browser commands from user text.

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
