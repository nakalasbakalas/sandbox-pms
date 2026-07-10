# Channel synchronization v2

Status: **implemented on `feat/channel-sync-v2`; external provider access remains pending owner submission and provider approval**.

## Decision

The current operating mode is:

- inbound reservations and changes: near-live Gmail polling into the existing review inbox;
- outbound availability: explicit manual queue with owner/manager approval and provider confirmation;
- direct API access: Agoda and Trip.com application tracks run in parallel;
- future true two-way distribution: prefer Channex as a channel-only layer rather than buying or operating a second PMS.

The SANDBOX HOTEL PMS remains the sole system of record for reservations, inventory, guests, folios, payments, housekeeping, and staff workflows.

## What “near-live” means

The scheduler polls every 120 seconds by default. It is not a webhook and it is not guaranteed zero-lag delivery.

A scheduled pass:

1. loads every enabled booking-email source;
2. fetches a bounded set of recent Gmail messages through OAuth;
3. uses existing source-message and booking-reference de-duplication;
4. parses and stores review events;
5. optionally recognizes allowlisted `/ops` commands through the existing guarded intake;
6. records source sync timestamps/errors;
7. leaves booking, cancellation, modification, and payment application to the review workflow.

The scheduler always calls `syncBookingEmail` with `reviewOnly: true`. Its policy also reports `operationalMutationsEnabled: false`.

### Configuration

```dotenv
BOOKING_EMAIL_NEAR_LIVE_ENABLED=true
BOOKING_EMAIL_SYNC_INTERVAL_SECONDS=120
BOOKING_EMAIL_SYNC_BATCH_LIMIT=25
BOOKING_EMAIL_PRIMARY_MAILBOX=booking@sandboxhotel.com
BOOKING_EMAIL_GMAIL_USER_ID=me
BOOKING_EMAIL_GMAIL_CLIENT_ID=...
BOOKING_EMAIL_GMAIL_CLIENT_SECRET=...
BOOKING_EMAIL_GMAIL_REFRESH_TOKEN=...
```

Polling is enabled only when the explicit flag is true **and** Gmail OAuth is complete. The interval is bounded to 30–3,600 seconds; the batch is bounded to 1–250 messages. Secret values belong in the deployment secret store.

### Failure behavior

- A second run is skipped while the previous run is active.
- One source failure does not stop the remaining sources.
- Errors are redacted before logging.
- Repeated polling is safe because existing messages are upserted by source/message identity and duplicate booking fingerprints.
- A Gmail failure is stored on the affected source and retried on the next interval.

## Manual outbound availability queue

`server/availability-queue.mjs` is a constrained service over the existing `HotelOpsTask`, `HotelOpsTaskApproval`, `HotelOpsTaskLog`, and `AuditLog` models. No schema migration or second queue store is required.

### State flow

```text
create -> PENDING_APPROVAL -> APPROVED -> SUCCEEDED
                  |                |          ^
                  +-> CANCELLED    +-> FAILED |
                                             |
                     human enters provider confirmation/reference
```

There is no automatic dispatch transition.

### Safety invariants

- `taskType` is always `UPDATE_AVAILABILITY`.
- Risk is `HIGH` and owner approval is created with the task.
- `permissionDecision.queueSource` identifies v2 queue records.
- `permissionDecision.autoDispatch` is always `false`.
- Queue creation and approval do not call an OTA worker, browser adapter, or API.
- `mark-sent` requires a provider confirmation/reference.
- Every transition writes a task log and an audit log.
- Deterministic idempotency prevents duplicate queue records.
- Channex is represented as the channel-manager delivery target and maps to the existing `all` task platform until a certified adapter exists.

### Supported provider names

- `booking`
- `agoda`
- `trip`
- `expedia`
- `channex`

### CLI

Display policy:

```bash
npm run channel-sync:policy
```

Create an Agoda availability change:

```bash
npm run availability:queue -- create \
  --provider agoda \
  --hotel-id AGODA_PROPERTY_ID \
  --room-type DOUBLE \
  --from 2026-07-11 \
  --to 2026-07-15 \
  --rooms 2 \
  --reason "New reservation reduces shared sellable inventory" \
  --actor-id PMS_USER_ID \
  --actor-label "Hotel manager" \
  --actor-role MANAGER
```

Close Trip.com inventory:

```bash
npm run availability:queue -- create \
  --provider trip \
  --hotel-id TRIP_PROPERTY_ID \
  --room-type TWIN \
  --from 2026-07-11 \
  --to 2026-07-12 \
  --status closed \
  --reason "Temporary stop-sell during reconciliation" \
  --actor-id PMS_USER_ID \
  --actor-label "Hotel manager" \
  --actor-role MANAGER
```

Review and approve:

```bash
npm run availability:queue -- list --status PENDING_APPROVAL
npm run availability:queue -- approve \
  --id TASK_ID \
  --notes "Compared with PMS room-type inventory" \
  --actor-id PMS_USER_ID \
  --actor-label "Hotel manager" \
  --actor-role MANAGER
```

After updating the provider portal manually, record evidence:

```bash
npm run availability:queue -- mark-sent \
  --id TASK_ID \
  --reference PROVIDER_CONFIRMATION \
  --notes "Availability updated in provider extranet" \
  --actor-id PMS_USER_ID \
  --actor-label "Hotel manager" \
  --actor-role MANAGER
```

Record failure or cancellation:

```bash
npm run availability:queue -- mark-failed \
  --id TASK_ID \
  --reason "Provider portal unavailable" \
  --actor-id PMS_USER_ID \
  --actor-label "Hotel manager" \
  --actor-role MANAGER

npm run availability:queue -- cancel \
  --id TASK_ID \
  --reason "Superseded by a newer inventory calculation" \
  --actor-id PMS_USER_ID \
  --actor-label "Hotel manager" \
  --actor-role MANAGER
```

Queue records also remain visible through the existing Hotel Ops task/approval interfaces because they use the same database models.

## Direct API access tracks

### Agoda

Tracking issue: [#168](https://github.com/nakalasbakalas/sandbox-pms/issues/168)

Status: **PREPARING**. Agoda’s official Direct Supply developer hub directs new technology partners to a new-partner questionnaire and notes that onboarding follows review. The issue contains the owner/business fields, requested API functions, secret-handling rules, certification plan, and definition of done.

Official references:

- https://developer.agoda.com/supply
- https://developer.agoda.com/supply/docs/how-to-become-a-partner

### Trip.com

Tracking issue: [#169](https://github.com/nakalasbakalas/sandbox-pms/issues/169)

Status: **PREPARING**. Submission requires an authenticated partner context plus owner, contracting, property, volume, and technical-contact information. The issue records those prerequisites and the sandbox/certification gate.

Official entry point:

- https://connect.trip.com/

No repository document should describe either direct API application as submitted or approved until the issue contains an external reference from the provider.

## Channex contingency

Tracking issue: [#170](https://github.com/nakalasbakalas/sandbox-pms/issues/170)

Channex is the preferred evaluation path if direct APIs cannot meet the required channel coverage, maintenance cost, or synchronization latency. Its public documentation includes a PMS API, availability/rates endpoints, booking interfaces/webhooks, a staging server, API-key setup, certification tests, and mapping guides for Agoda and Ctrip/Trip.com.

Official references:

- https://docs.channex.io/
- https://docs.channex.io/api-v.1-documentation/ari
- https://docs.channex.io/channel-mapping-guides/agoda
- https://docs.channex.io/channel-mapping-guides/ctrip-trip.com

### Adoption trigger

Move from email/manual operation to a certified channel layer only when all are true:

1. live reservation creation, modification, and cancellation must arrive without polling delay;
2. ARI changes must be acknowledged with operationally zero lag;
3. at least two OTAs require the same live two-way behavior;
4. direct API certification/maintenance is slower or costlier than the channel-only option;
5. webhook replay, idempotency, reconciliation, dead-letter handling, and rollback have passed staging tests.

### Boundary

Channex may transport bookings, ARI, rates, restrictions, and acknowledgements. It must not become the owner of front-desk state, folios, payments, housekeeping, users, or accounting.

## Deployment sequence

1. Merge only after tests and build pass.
2. Confirm Gmail OAuth secrets exist in Render.
3. Deploy with the Render blueprint values.
4. Confirm booking-email source `lastSyncAt` advances approximately every two minutes.
5. Verify new messages appear once in the review inbox.
6. Create a non-production availability queue item and verify task, approval, log, and audit records.
7. Approve it and confirm no OTA call occurs.
8. Perform a safe manual provider update and record the confirmation reference.
9. Complete Agoda/Trip.com owner fields in issues #168 and #169, then submit through authorized provider accounts.
10. Begin Channex staging only if the adoption trigger is met.

## Test coverage

`npm test` now runs the existing business suite followed by `scripts/run-channel-sync-tests.mjs`. The added tests cover policy gating, bounds, review-only scheduling, multi-source scheduler behavior, queue validation, idempotency, audit artifacts, and the Channex decision policy.

## Known limitations

- Gmail polling is not zero-lag and currently re-queries a bounded recent set rather than using Gmail push notifications/history cursors.
- The queue is operator-driven; it intentionally does not dispatch.
- Provider forms cannot be submitted without owner-authorized business data and authenticated provider accounts.
- Direct Agoda/Trip.com adapters and Channex webhooks/ARI clients are not enabled in this version.
- Existing OTA browser skeletons remain dry-run only.
