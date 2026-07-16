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

## Lite V1 Manual Channel Path

The Lite Channel Desk does not use the experimental OTA browser adapters above. It uses `server/manual-channel-service.mjs`, which is a durable manual work queue for Booking.com, Agoda, and Trip.com. This distinction must remain visible in UI, operations, tests, and launch evidence:

| Path | Reads OTA state | Writes OTA state | Current role |
| --- | --- | --- | --- |
| Gmail booking intake | Reads provider emails through Gmail API | No | Near-live/reconciled inbound signal; always review-required |
| Manual channel queue | Calculates desired inventory from PMS | No | Tells staff exactly what to enter in each Extranet |
| Existing OTA adapter skeletons | Dry-run placeholders only | No production writes | Hotel Ops experimentation; not Lite synchronization |
| Channex boundary | No | No | Disabled future certified channel rail |

For Lite deployments, set `CHANNEL_SYNC_QUEUE_BACKEND=lite_manual`. The older `HotelOpsTask` availability CLI is a legacy compatibility path only and must not operate beside Channel Desk. Keep the legacy in-process email poller disabled (`BOOKING_EMAIL_NEAR_LIVE_ENABLED=false`) because Gmail Pub/Sub plus history reconciliation is the canonical Lite intake path. Lite scheduler startup fails closed when the legacy 120-second poller is enabled or a non-`lite_manual` backend is selected; do not weaken that guard or run both intake paths in parallel.

Manual channel records may store only non-secret provider/property/room/rate mapping metadata and an official HTTPS Extranet link. They must never store OTA usernames, passwords, cookies, session state, API tokens, 2FA material, or CAPTCHA answers.

Provider codes use extensible text columns so future certified adapters do not require a destructive database enum change. That storage choice does not enable a provider: current Lite connection/task mutations still allowlist only Booking.com, Agoda, and Trip.com, and every new adapter must pass the full provider gate below.

Keep a connection disabled until every PMS room type with one or more physical rooms has an active provider mapping. This scope includes temporarily out-of-service rooms because they can return to sale. Per connection, an active external room-type/rate-plan target may belong to only one PMS room type; a database partial unique index is the concurrency backstop. If mapping coverage is later lost, reconciliation skips the affected provider/room cells, records `MANUAL_CHANNEL_TASKS_SKIPPED_UNMAPPED`, and creates no task with an unknown external target. Channel Desk displays the external room type id/name and rate-plan id on executable tasks.

An enabled manual connection participates in inventory reconciliation. Booking creation, inventory-changing edits, cancellation/no-show, and walk-in changes calculate affected room-type/date cells inside the PMS transaction. Every change reconciles all enabled providers. After staff approve an OTA-originated email, the originating provider is reconciled too using current absolute PMS availability, which coalesces or supersedes stale pending source-provider work instead of leaving it actionable.

OTA email money remains review evidence, not a currency-conversion feed. The parser distinguishes stay totals from payments and deposits, marks conflicting same-kind values ambiguous, and only a persisted `STAY_TOTAL` with an explicit property-matching currency may set new/modification pricing. Approval cannot replace that persisted amount. The inclusive exact-satang total and currency are persisted on the reservation; local occupancy supplements are not added again, and later provider-linked pricing changes require a new verified total plus exactly one active system-managed room charge.

Choosing Booking.com, Agoda, or Trip.com in a manual reservation form is attribution only. A source label or bare provider code without an external reservation reference/provider-total/email-evidence pair is not trusted provider-pricing provenance and must not make normal manual booking edits impossible.

Tasks coalesce when the desired availability has not changed. When it changes, the active task is superseded and a higher revision becomes current. Staff must enter the value in the official Extranet, then confirm the exact value and revision in Lite. A completion record is an operator attestation and audit event; it is not a provider API read-back.

Manual task completion and reopen/retry resolve the task through its configured `SANDBOX` property relation. A task id from another property is not authority and returns not found before any task or availability mutation.

Manual work cannot guarantee zero-lag synchronization or prevent overbooking during the interval before every affected Extranet is updated. The Channel Desk exposes each pending/failed task's creation time and raw age, prompts staff to complete open work, and escalates failed work to a manager. No overdue SLA flag is invented because no owner-approved task-age threshold exists. The UI must never label this workflow `live sync`, `automatic sync`, or `two-way sync`.

## Direct Connectivity Decision

### Booking.com

An ordinary individual-property Extranet account is not a direct Connectivity API route. Booking.com's official connectivity onboarding is for connectivity providers: [Booking.com Connectivity](https://connect.booking.com/?lang=en). Lite V1 therefore keeps Booking.com on the manual queue unless a certified connectivity route is later contracted and verified.

Do not substitute browser automation for missing API access. The no-CAPTCHA/2FA-bypass rule and account terms remain controlling.

### Agoda

Agoda direct connectivity requires formal partner onboarding and testing: [Become an Agoda Connectivity Partner](https://www.agodaconnectivity.com/become-a-partner). The application requires owner-controlled legal, business, contact, property, and technical details. A drafted application packet or code support does not prove submission, acceptance, credentials, certification, or live access.

Until the provider approves and tests the integration, Agoda remains manual.

### Trip.com

Trip.com direct connectivity requires formal partner onboarding against the [Trip.com Open Platform](https://connect.trip.com/opendoc/3024822.html). The application requires owner-controlled legal, business, contact, property, and technical details. A drafted application packet or code support does not prove submission, acceptance, credentials, certification, or live access.

Until the provider approves and tests the integration, Trip.com remains manual. Trip.com is now a first-class booking source/provider code in Lite; that attribution is not API connectivity.

### Channex

`DISABLED_CHANNEX_ADAPTER` is the provider-neutral seam for a future channel-only rail. It reports `CHANNEX_NOT_CONFIGURED` and rejects availability pushes. No account, contract, certification, mapping, secret, sandbox result, production write, or health is implied.

If automatic, near-zero-lag distribution becomes a business requirement, evaluate a channel-only certified rail such as [Channex](https://docs.channex.io/about-channex-and-faq) instead of buying a second complete PMS. Enabling it requires:

1. owner-approved contract and provider account;
2. backend-only credential storage and rotation;
3. property, room, rate-plan, and restriction mappings;
4. idempotent outbound batches, retries, dead-letter visibility, and reconciliation reads;
5. emergency stop, approval/risk policy, audit output, and source-provider loop prevention;
6. sandbox certification and owner-approved live test dates; and
7. staged cutover/rollback evidence.

The manual queue remains authoritative until every applicable item is complete and live behavior is proven.

## Gmail Is Inbound Evidence, Not An OTA API

Gmail Pub/Sub can signal new provider email near-live, and the five-minute maintenance command renews watches, retries deliveries, and reconciles history. All resulting events remain review-only. Email delivery can be delayed, duplicated, reordered, incomplete, or differently formatted; Gmail cannot supply authoritative live room inventory and cannot push inventory back to an OTA.

Push delivery claiming stops after a non-retryable error or the default eight-attempt ceiling. The redacted row remains visible as `FAILED` but is no longer claimable; retryable failures below the ceiling retain bounded backoff. This prevents an invalid provider/configuration state from looping forever and does not turn the failed row into OTA proof.

Normal booking-email list/detail DTOs are operational review projections and omit the raw Gmail URL, source message id, headers, and body. Front Desk, Manager, and Admin may use that safe review projection. Raw evidence is a separate Manager/Admin-only, property-scoped endpoint that requires an operational reason and creates audit evidence; it returns only an allowlisted Gmail locator/source id and never a raw body. Cashier has neither booking-email review nor raw-evidence permission.

Provider-scoped external references reduce duplicate/mismatched booking risk, but staff review remains mandatory. A successful local test, Gmail watch, push, or reconciliation is mailbox/repository evidence only, not Booking.com, Agoda, or Trip.com API proof. It also does not establish Cloudflare routing/WAF enforcement, account-owner sign-off, or provider approval.

Lifecycle ordering is property- and provider/reservation-scoped: an older modification/cancellation cannot overtake a same-time or newer non-legacy event still in `NEEDS_REVIEW`, `ERROR`, or `PROCESSED`. Common child-age labels are parsed, but every declared child still needs exactly one valid age from 0 through 17; incomplete, invalid, or mismatched lists remain review work. Gmail source maintenance and booking-event mutations also resolve through the configured `SANDBOX` property, so a cross-property id cannot become write authority.

iCal is recovery-only delayed date-block compatibility. It is unsuitable as the primary multi-room booking/cancellation/inventory/rate path and cannot close a Gmail, direct API, channel rail, or cutover gate. Follow `docs/ical-ota-setup-guide.md` only during an owner-approved incident.

Only a Gmail-retained `Authentication-Results` header whose authentication service id is `mx.google.com` can establish provider sender alignment. Reprocess uses that immutable header and raw content, discards stale parsed fields, and recomputes the reservation match. Payment, cancellation, and modification writes require the resulting exact persisted match or an explicit staff-selected reservation id; guest/date similarity is review guidance only.

See `docs/LITE_ARCHITECTURE.md` for the complete workflow and staging proof boundary.

### Lite 30-room availability boundary

The Lite staging baseline contains exactly 15 Superior Double and 15 Standard Twin physical rooms. This changes the PMS capacity cells used to generate manual availability work; it does not prove or enable a live OTA write connection. After applying the baseline, regenerate/reconcile manual channel tasks for the exact provider mappings and date window, review absolute counts, and complete each Extranet update with evidence. Do not reuse historical 33-room totals, infer provider room/rate-plan mappings, or claim automatic distribution.
