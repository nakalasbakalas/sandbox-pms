# OTA Adapter Guide - Hotel Ops

## Adapter Boundary

All OTA adapters expose the validated public contract in `server/ota-adapters/contract.mjs`. The contract reports health, declared read and dry-run-write capabilities, retry and rate-limit metadata, and the proof-artifact policy without returning selectors, environment-key names, or credential values. `getOtaProviderContracts()` returns this normalized status for Booking.com, Agoda, Trip.com, and Expedia.

`OTA_LIVE_WRITES_ENABLED` defaults to `false`. Setting it to `true` only records that live writes were requested; a provider also needs an implemented live-write path and separately verified provider proof before the contract can expose a live-write capability. None of the current adapters meet those conditions, so all live-write capability lists remain empty and non-dry-run operations continue to fail closed.

Proof artifacts must pass `sanitizeProviderEvidence()` before they cross a provider boundary. Unknown proof kinds are normalized, artifact counts are bounded, credential-like URL parameters are redacted, fragments and URL user information are removed, and artifacts without safe redaction status receive only a blocked mock reference.

The PMS property context, rate service, and domain-event stream do not expand adapter authority. An adapter receives an already authorized typed task through the Hotel Ops worker boundary. It must not select a property from client input, read property settings as a secret store, or treat a rate recommendation/domain event as permission to write provider inventory.

Frontend auth identity, onboarding drafts, browser-KV accounting entries, and cash counts are never adapter input or evidence. In server mode, identity comes from the authenticated backend request context and legacy browser-backed accounting surfaces remain capability-gated.

The autonomy shadow layer does not expand adapter capability. It may normalize sanitized provider evidence, persist a cursor, evaluate a property/provider/task policy, and record a `SHADOW_NOOP` candidate. Provider snapshots are schema-reserved and have no capture service in this phase. The shadow layer must not import or invoke this adapter layer. `ProviderAcknowledgement` and compensation records are deferred until a real credentialed provider write supports acknowledgement and read-back; schema presence must never be used as provider proof.

`Channel.credentialRef` is the only channel-level secret locator. `Channel.credentialStatus` may contain non-secret readiness metadata; raw provider credentials must not be persisted in channel rows, normalized events, snapshots, policies, agent input, decisions, evidence, logs, or dead letters. The physical `Channel.credentials` column is retained temporarily for old-app rollback compatibility only: the new Prisma client ignores it and PostgreSQL requires its value to remain exactly `{}`.

Exact monetary fields use base-10 satang strings at JSON boundaries. Adapters must not convert a satang string through floating-point arithmetic. During the compatibility window, any legacy baht field is informational compatibility data; the validated typed task remains authoritative for the specific dry-run request.

The AI and manager UI never control the browser directly. They create controlled task records. The backend validates and approves those records, then calls a typed OTA worker payload.

Current dispatch:

- `server/ota-adapters/index.mjs` routes Booking.com tasks to the Booking.com adapter.
- Agoda, Trip.com, and Expedia route to explicit dry-run adapter skeletons in `server/ota-adapters/platform-skeleton.mjs`.
- Unknown or all-platform tasks use the signed mock worker fallback.
- All worker execution is dry-run unless explicitly and safely changed later.
- Signed remote worker calls allow up to 60 seconds so a sleeping non-production Render worker can cold-start; timeout still fails closed without retrying or converting the request into a live write.

Booking-email historical backfill is not an OTA adapter and is not live OTA scrape proof. It remains review-only. Live Gmail polling may autonomously create and assign only tightly gated new bookings when the global policy and source opt-in are enabled. That path proves a mailbox-derived PMS mutation, not an OTA API read, provider acknowledgement, or live OTA write. It requires authenticated trusted sender evidence and an active `ChannelMapping`; Booking.com, Agoda, Trip.com (`TRIP`), Expedia, and Airbnb room labels must map to authoritative PMS room types and explicit room ids. Payment, cancellation, modification, guest-message, and unknown events remain review-gated. `booking-email:deep-scan` and `booking-email:reprocess` never apply operational changes.

Provider templates often embed cancellation-policy, free-cancellation, and fee terms in booking confirmations. Those terms are not cancellation evidence; the parser requires an explicit booking/reservation cancellation phrase, notification, or status.

Provider account and reference numbers can appear beside currency labels. Values outside the PMS exact-money compatibility range are not amounts and are omitted rather than coerced; the event remains review-gated.

The HTTP sync endpoint must not be used as an alternate OTA adapter. It rejects caller-supplied email events. Only the bounded backfill helper may opt into imported events, and only provider-verified imports can be evaluated by the prefix-gated Hotel Ops email-command bridge.

Legacy PMS charge idempotency, including exact-satang extras posted from the authoritative Booking Board, is an internal financial-safety boundary, not evidence of an OTA payment or charge integration. Board cancellation/no-show and guest edits are PMS commands only; they do not acknowledge or mutate a provider. OTA-derived booking-email sources must still pass property ownership and staff review before a charge link or reservation change can be recorded.

## Channel Synchronization V2 Boundary

Channel-sync v2 adds two operational mechanisms without changing the adapter proof standard:

1. **Near-live inbound email polling.** The scheduler polls enabled booking-email sources when `BOOKING_EMAIL_NEAR_LIVE_ENABLED=true` and Gmail OAuth is complete. The default query is bounded to approved OTA senders without requiring a visible `To` header, covering direct, BCC, and forwarded reservation mail. It is review-only by default. With the separately configured autonomy policy and a manager-enabled source, it may create a high-confidence new reservation and assign one mapped available room. It never automatically applies cancellation, modification, payment, rate, or outbound inventory mutations.
   Gmail quota responses suspend further scheduled calls until the provider retry time, with a 15-minute fallback when no timestamp is returned. Operators should not issue repeated manual sync attempts during backoff.
   Booking Inbox status refreshes are passive and do not call Gmail; use mailbox sync or the explicit OAuth diagnostic for live connectivity proof.
   Optional Workspace JSON from the configured Drive folder can corroborate the same message only after exact reference/type/date/room alignment. It is not independent OTA acknowledgement and does not satisfy the separate duplicate-provider-email gate. LittleHotelier messages are now captured and parsed, but remain review-only because no authoritative LittleHotelier ChannelProvider mapping contract exists.
2. **Manual outbound availability queue.** `server/availability-queue.mjs` creates high-risk `UPDATE_AVAILABILITY` tasks with owner approval, deterministic idempotency, task logs, and audit logs. Queue creation and approval do not call this adapter layer. A human must update the provider and record its confirmation/reference before the item is marked complete.

The queue supports Booking.com, Agoda, Trip.com, Expedia, and a Channex delivery target. Channex maps to the existing `all` platform only as metadata until a certified API adapter exists. It must not be routed to the mock worker as evidence of a real Channex update.

iCal feeds are also outside the live-write adapter contract. Export URL tokens are bearer credentials: the PMS stores only SHA-256 base64url hashes, migration `20260717141000_ical_token_hash_backfill` removes legacy raw export tokens, and property/provider-scoped idempotency makes issue/rotation retries deterministic. Migration `20260719103000_channel_mutation_idempotency` extends unchanged-intent replay to configuration, disable, and mapping mutations without duplicate evidence. A bounded 15-minute hash-only grace set supports recovery. Private inbound provider URLs are not accepted or stored; migration `20260719100000_remove_raw_ical_import_urls` removes legacy values until an approved secret-reference service exists. Configuration, rotation, mapping, and disablement share URL/credential/contact-safe JSON-body reasons and record `providerWrite: false`; configure and disable serialize under one provider lock. A working iCal feed proves only that outbound feed path, not an OTA API read/write, inventory acknowledgement, or provider certification. In server mode, the Channels screen exposes only this manual hosted feed path and property-scoped mappings; simulated rate, inventory, log, performance, and browser-import surfaces are demo-only.

See [CHANNEL_SYNC_V2.md](CHANNEL_SYNC_V2.md) for commands, application status, activation, and the channel-only provider decision gate.

## Direct API And Channel-Only Tracks

- Agoda Direct Supply / YCS API access is tracked in [issue #168](https://github.com/nakalasbakalas/sandbox-pms/issues/168).
- Trip.com Open Platform access is tracked in [issue #169](https://github.com/nakalasbakalas/sandbox-pms/issues/169).
- Channex staging/certification evaluation is tracked in [issue #170](https://github.com/nakalasbakalas/sandbox-pms/issues/170).

These are preparation/evaluation tracks. Do not mark a direct API as submitted, approved, certified, or live without an external provider reference and non-production evidence. If true two-way, operationally zero-lag synchronization becomes essential, prefer a channel-only layer such as Channex rather than purchasing or operating a second full PMS. The local PMS remains the source of truth.

The server-backed PMS rate endpoints persist internal rate rules and calendars only. They do not publish to Booking.com, Agoda, Trip.com, Expedia, Channex, or another channel. Likewise, a `RATE_*` domain event proves an internal PMS transaction occurred; it is not provider acknowledgement or live-write proof.

Property profile/settings endpoints intentionally reject credential-shaped values and URLs. Provider credentials must remain in backend environment or secret storage and must never be copied into `Property.operationalSettings`, adapter health DTOs, audit changes, events, screenshots, or proof URLs.
## Demand Calendar Rate Push Contract

The demand-calendar preload path uses this repo's OTA-safe payload contract before channel publication:

- `roomTypeId` must be a known room type identifier from active room settings.
- `rate` must be an integer THB value (non-zero and within safe bounds).
- `sourceStatus=CONFIRMED` is treated as enforceable control; `sourceStatus=PROJECTED` remains planning/review only.
- If rate payload validation fails (bad room id or non-integer rate), the push attempt must be rejected before connector execution.
- Current runtime remains dry-run for `use-rate-push`; treat all channel publication attempts as verification-first until a real channel writer is explicitly wired and tested.

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
- Preserve the authenticated PMS property/hotel scope supplied by the backend; never accept a client-selected property override.
- Treat satang JSON fields as base-10 integers and avoid floating-point conversion.
- Never interpret a domain event, capability flag, rate recommendation, or internal rate change as provider write authorization.

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

## Provider Proof Versus PMS Engineering Proof

The following are PMS engineering evidence only:

- rate or settings service tests
- a persisted rate rule/calendar row
- an internal domain event or SSE notification
- a provider contract reporting configured credentials
- a dry-run proof placeholder
- a successful local or CI adapter test

Provider proof requires a separately approved account, safe test dates/inventory, verified read/write result, sanitized before/after evidence, rollback/recovery evidence, and account-owner sign-off. Until that proof exists, keep `OTA_LIVE_WRITES_ENABLED=false`, retain review-gated manual availability tasks, and describe provider state as dry-run, provider-pending, or unproven.

## Booking Email Room Labels

Booking.com, Agoda, and Trip.com reservation emails may be used as inbound PMS evidence for reservation extraction and for proposing an external room-category label. This is not an OTA API read, provider inventory acknowledgement, rate sync, or proof that the provider currently sells the mapped inventory.

Agoda's Gmail text representation may collapse the visual bilingual table to one line. The deterministic parser bounds values between known adjacent provider labels, treats `Booking ID ... - CANCELLED` as cancellation evidence, and does not treat policy boilerplate as modification intent. Reprocess regenerates rather than inherits external room labels before they enter mapping suggestions.

Trip.com may likewise collapse `Guest Name` directly before `Room Type`; the guest capture terminates at that provider label and then normalizes the provider's family/given slash form. This remains email extraction evidence, not OTA API identity proof.

Channel Manager may prefill an audited room-mapping draft from PII-free observed-label aggregates. An authorized manager must still verify the exact provider label and choose the property-owned PMS room type/room ids. The suggestion endpoint never creates or activates a mapping and never performs a provider write. Real OTA inventory/rate synchronization remains separately disabled and provider-unproven.

When a manual iCal channel shell cannot be persisted, the manager UI keeps the sanitized server failure visible and retains the unchanged request's idempotency key. Operators must remedy the reported prerequisite through the authenticated service boundary and must not insert channel or mapping rows directly.
