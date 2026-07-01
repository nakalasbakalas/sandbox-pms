# Acceptance Tests - Hotel Ops AI Command Center

This file maps the package acceptance criteria to current repo evidence.

## Parser

- `Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday.`
  - Expected: `UPDATE_RATE`, platform `agoda`, risk `HIGH`, approval required.
  - Evidence: `scripts/run-business-tests.mjs`.
- `Check bookings for next weekend.`
  - Expected: `SCAN_BOOKINGS` or `READ_RESERVATIONS`, low risk, no owner approval.
  - Evidence: `scripts/run-business-tests.mjs` and DB E2E scan command.
- `Cancel all bookings and refund guests.`
  - Expected: forbidden or critical-disabled, no execution, audit/log evidence.
  - Evidence: `scripts/run-business-tests.mjs`.
- `Raise Booking price to 3000.`
  - Expected: `NO_OP_CLARIFY` with missing date or room type.
  - Evidence: `scripts/run-business-tests.mjs`.

## Permissions

- Manager read-only scan is allowed.
- Manager cannot execute high-risk write task without owner approval.
- Owner can approve high-risk task with a reason.
- Viewer and unsupported roles cannot create write tasks.
- Emergency stop blocks write tasks.
- Denied tasks cannot be queued.
- Duplicate idempotency keys return the existing task.

Evidence: `scripts/run-business-tests.mjs`, `scripts/run-e2e-tests.mjs`, and guarded DB E2E.

## Executor

- Approved mock `UPDATE_RATE` completes and stores safe proof.
- Selector failure marks task `FAILED` and stores error proof.
- 2FA/CAPTCHA marks task `NEEDS_HUMAN` and creates a human-action notification.
- Authorized human-action resolution requires a reason, rejects under-authorized actors, and requeues the task without bypassing the challenge.
- Dry-run mode returns planned actions without changing OTA state.
- Unknown task types are rejected before worker call.
- Unsigned and replayed worker requests are rejected.

Evidence: `scripts/run-business-tests.mjs`, `scripts/run-e2e-tests.mjs`, `server/ops-worker-auth.mjs`, and `server/ops-worker-client.mjs`.

## Intelligence

- High demand requires occupancy plus velocity signal.
- Low demand inside the scan horizon creates an alert.
- Cancellation acceleration creates a cancellation spike alert.
- Weekend acceleration creates a weekend spike alert.
- Room-type imbalance creates an alert without automatic mutation.
- OTA imbalance creates an alert without automatic mutation.
- Recommendations create approval-gated tasks, not direct execution.
- Repeated scans update active alerts without duplicate notifications.

Evidence: `scripts/run-business-tests.mjs` and guarded DB E2E.

## UI

- `/ops/chat` displays manager command entry and parsed preview.
- `/ops/approvals` lists pending approvals and empty state.
- `/ops/tasks` shows task status, requester, risk, timestamps, logs, notifications, and proof.
- `/ops/intelligence` shows alert severity and recommendation actions.
- `/ops/settings` shows emergency stop, OTA worker status, scan policy, scheduler state, and thresholds.

Evidence: `scripts/run-e2e-tests.mjs`.

## Security

- API keys and OTA credentials are not returned to the browser.
- Worker payloads reject credential-shaped fields.
- Notifications and metadata redact credential-like text.
- Worker proof is normalized and unsafe proof links are blocked.
- Internal worker endpoint rejects unsigned, tampered, expired, and replayed requests.

Evidence: `scripts/run-business-tests.mjs`, `scripts/run-e2e-tests.mjs`, and supplied-secret pattern scans.

## Standard Validation Commands

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npx.cmd prisma validate
git diff --check
npm.cmd run build
npm.cmd run test:e2e
```

Guarded DB E2E:

```powershell
$env:ALLOW_DB_E2E='true'
$env:E2E_DATABASE_URL='postgresql://...disposable...'
npm.cmd run test:e2e:db
```
