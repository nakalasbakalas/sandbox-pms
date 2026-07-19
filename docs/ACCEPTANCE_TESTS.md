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
- Strict parsed-task schema validation
  - Expected: complete parsed tasks pass; impossible dates, out-of-range confidence, and unexpected credential-like fields fail validation before permission decisions.
  - Evidence: `scripts/run-business-tests.mjs`.
- Optional OpenAI Responses parser path
  - Expected: backend-only parser requests use redacted command text and strict JSON schema; model output cannot downgrade backend risk/approval policy; malformed model output fails before permission decisions; provider failure falls back to deterministic parsing with a redacted reason.
  - Evidence: mocked provider coverage in `scripts/run-business-tests.mjs`. This is not live OpenAI provider proof.

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
- Agoda, Trip.com, and Expedia dry-run skeleton adapters return platform-specific proof placeholders and preserve selector-failure and human-challenge paths.
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
- Every scan persists a durable scan snapshot with occupancy/velocity/source metrics, alert mutation counts, produced alert ids, and an audit link from `OPS_SCAN_RUN`.

Evidence: `scripts/run-business-tests.mjs` and guarded DB E2E.

## UI

- `/ops/chat` displays manager command entry and parsed preview.
- `/ops/approvals` lists pending approvals and empty state.
- `/ops/tasks` shows task status, requester, risk, timestamps, logs, notifications, and proof.
- `/ops/intelligence` shows alert severity, recommendation actions, and latest PMS-derived scan evidence from `GET /api/ops/intelligence/scans`.
- `/ops/settings` shows emergency stop, OTA worker status, scan policy, scheduler state, and thresholds.
- `/ops/chat` and `/ops/settings` show parser mode so staff can distinguish deterministic parsing, optional OpenAI parsing, and deterministic fallback.

Evidence: `scripts/run-e2e-tests.mjs`.

## Security

- API keys and OTA credentials are not returned to the browser.
- Booking-email Gmail sync can use backend-only OAuth access-token or refresh-token credentials, reports non-secret OAuth client, refresh token, target mailbox, Gmail API profile-test, last-sync, and missing-key status through `/api/booking-email/status`, and refresh/provider failures redact token/client-secret values.
- Gmail OAuth Render setup generates a consent URL with offline access and readonly scope by default, can read a local Google OAuth client JSON file without printing values, keeps Gmail send scope opt-in, exchanges authorization codes through Google, and redacts authorization codes, client secrets, access tokens, and refresh tokens from surfaced errors/output.
- Render Gmail OAuth status reports current Render key presence and supported credential-path readiness without values; dry-run reports missing/present local booking-email Gmail keys without values; apply mode updates only the approved booking-email Gmail env-var keys.
- Booking-email capture proof reports aggregate current PMS email-event counts without message ids, sender/recipient, subject, raw body, guest, payment, or credential data.
- Booking-email historical backfill dry-run fetches bounded Gmail pages, reports redacted aggregate parser counts, and does not write PMS records.
- Booking-email historical backfill with `--confirm` imports Booking Email Events for `/booking-inbox` review only, chunking large confirmed imports by `--import-batch-size`; staff approval is still required before creating, modifying, cancelling, charging, or linking reservations.
- Booking-email parser fixtures cover new booking, modification, cancellation, guest message, and payment notice templates with check-in/check-out label variants, stay-date ranges, and payment extraction.
- Booking-email parser regressions also cover representative OTA security/reporting/invoice noise so non-reservation provider mail stays `UNKNOWN` instead of entering the booking workflow.
- Booking-email backfill defaults to the approved provider query and excludes known Trip.com partner-report, Agoda partner-invoice, and Booking.com security noise unless an explicit owner-approved query override is supplied.
- Booking-email duplicate review ignores different event types that share a booking reference, but still flags same-type/provider-message replays as duplicates.
- Booking-email review/error reprocess keeps output redacted, reparses only the selected queue events, and returns them to `NEEDS_REVIEW` without auto-approval.
- Credentialed auth/RBAC proof helper reads approved users from stdin or an untracked local file, logs in and out through the real backend session APIs, masks login identifiers, keeps cookies in memory only, omits response bodies except bounded role/status fields, and rejects mutating denial probes unless explicitly owner-enabled.
- Staff login locks persistently on the third failed attempt, locked users cannot authenticate, and an admin password reset clears failed attempts and lock state.
- Hotel Ops Gmail email delivery is opt-in, backend-only, updates notification status to `SENT` or `FAILED`, and redacts provider failures.
- LINE Hotel Ops command intake is disabled by default, requires a signed webhook plus configured prefix and LINE-user allowlist, maps to an active PMS user, and keeps command execution inside the shared Ops service.
- WhatsApp Hotel Ops command intake is disabled by default, requires a Meta `x-hub-signature-256` verified webhook plus configured prefix and sender allowlist, maps to an active PMS user, links source message metadata into task logs/audit, and keeps command execution inside the shared Ops service.
- Email Hotel Ops command intake is disabled by default, requires booking-email sync plus configured prefix and sender allowlist, maps to an active PMS user, links source email metadata into task logs/audit, and keeps command execution inside the shared Ops service.
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

Authenticated server-mode browser proof, after a server-mode build:

```powershell
$env:ALLOW_DB_E2E='true'
$env:E2E_DATABASE_URL='postgresql://...disposable...'
$env:VITE_PMS_API_MODE='server'
$env:VITE_DATA_MODE='server'
npm.cmd run build
npm.cmd run test:e2e:server
```

These commands are engineering checks. Their existence or a local pass does not supply restored-staging, recovery, staff, provider, WAF, or owner proof.

## OTA Provider Contract

- `node scripts/run-provider-adapter-tests.mjs` passes for Booking.com, Agoda, Trip.com, and Expedia.
- Every contract validates strictly and declares its supported reads and dry-run writes.
- `OTA_LIVE_WRITES_ENABLED` absent or false yields no live-write capabilities.
- Requesting the flag alone still yields no live-write capability for current unimplemented and unproven adapters.
- A non-dry-run mutation fails closed.
- Contract JSON contains no credential values or credential environment-key names.
- Evidence sanitization bounds artifacts, normalizes kinds, removes URL user information/fragments, redacts sensitive query parameters, drops unknown fields, and blocks artifacts with unsafe redaction status.

## Exact Money And Payment Safety

Run:

```powershell
node scripts/run-money-tests.mjs
```

Acceptance requires:

- decimal baht conversion uses deterministic half-up rounding, including negative half values;
- satang values serialize as base-10 strings and never fail JSON serialization as `BigInt`;
- requests that supply both baht and satang reject mismatched values;
- missing or invalid `MONEY_READ_AUTHORITY` selects `legacy_float`, while `satang` selects a populated exact shadow value;
- a payment dual-writes legacy baht and exact satang inside a serializable transaction;
- payment and charge rows require first-class property ownership and database uniqueness on `(propertyId, idempotencyKey)`;
- a same-content idempotent replay returns the existing payment without duplicate payment, audit, or domain-event rows;
- reuse of an idempotency key with different content returns `409`;
- closed-folio and unapproved-overpayment attempts fail without a write; and
- every legacy charge write rejects a missing idempotency key;
- same-intent and simultaneous charge retries return one append-only charge with one audit row;
- reuse of a charge key with a different normalized intent returns `409`; and
- the same charge idempotency key can be used independently by two properties without cross-property replay;
- one serialization conflict is retried without double-posting.
- server-mode financial surfaces reuse one opaque in-memory attempt key for unchanged uncertain retries, rotate it when material input changes, clear it after confirmed success, and never write the attempt/key to `localStorage` or `sessionStorage`;
- a full page reload is not asserted to recover an uncertain financial attempt key, so reload recovery must reconcile the authoritative folio before another write.
- server mode never writes authenticated user identity or legacy auth tokens to browser storage;
- a delayed failed `/api/auth/me` response cannot clear a newer successful interactive login or override logout;
- server onboarding persists no password or confirmation value and removes legacy credential-bearing draft keys; and
- enabling Accounting V2 on the backend does not expose the legacy browser-KV Accounting Dashboard or Cash Reconciliation workflow in server mode.

Migration acceptance additionally requires an empty-database migration and a restored sanitized staging-copy migration, zero unresolved null/variance rows, exact aggregate reconciliation, rollback proof using `MONEY_READ_AUTHORITY=legacy_float`, and one full operating cycle on satang reads. Fixture tests alone do not satisfy migration acceptance.

## Property Context, OpenAPI, And Events

Acceptance requires:

- an authenticated user without an active `UserPropertyMembership` for `SANDBOX` receives `403`;
- membership role is the effective property role without changing username/email login compatibility;
- login and `/api/auth/me` expose the effective membership role, and deactivating that membership denies the next request from an already-authenticated session;
- forged room, reservation, rate, settings, housekeeping, and night-audit identifiers from a second property return no data and cause no mutation;
- `Guest`, `Payment`, `Charge`, and `AuditLog` have required property ownership after migration, and ambiguous/ownerless legacy backfills fail the migration rather than assigning guessed ownership;
- `/api/openapi.json` reports OpenAPI 3.1 and matches the registered HTTP methods;
- `/api/system/capabilities` reports `sourceOfTruth: server` without claiming provider proof;
- `/api/events` requires session authentication, active membership, and `view:board`;
- invalid or negative `Last-Event-ID`/`after` values return `400`;
- catch-up is ordered, property-scoped, bounded, and uses string sequence ids; and
- the public event payload omits metadata, actor identity, guest data, money details, and credentials.

The SSE reconnect test must prove an authoritative refetch after disconnection. Receiving an event is not sufficient evidence that a UI view persisted or refreshed correctly.

## Autonomous Operations Shadow Foundation

Run:

```powershell
npm.cmd run test:autonomy
$env:ALLOW_DB_E2E='true'
$env:E2E_DATABASE_URL='<disposable PostgreSQL URL>'
npm.cmd run test:e2e:autonomy
```

Acceptance requires:

- only `OBSERVE`, `SHADOW`, and `PROHIBITED` policies are accepted;
- room, date-range, rate percentage/absolute/floor/ceiling, hourly/daily volume, quiet-hours, confidence, source-trust, proof, and emergency-stop rules are deterministic;
- the same provider event/version/content returns the original canonical event, while changed content under the same identity fails closed;
- concurrent evaluation of one property/event/policy/version creates one run, one decision, and one `SHADOW_NOOP` action;
- every shadow action records `providerRequestSent=false`, and the database constraint rejects the opposite;
- two-property event, cursor, policy, run, decision, and action isolation is enforced; snapshot, issue, and dead-letter services remain deferred;
- only a SYSTEM backend context may ingest trusted provider evidence or invoke shadow evaluation; staff roles cannot assert source trust;
- disabled policies fail closed with `POLICY_DISABLED`;
- normalized payloads, proposed commands, explanations, audit evidence, and events reject credential-shaped or direct-contact content;
- no autonomy source imports OTA workers, browser adapters, provider credentials, or authoritative booking/finance/rate/inventory mutation services;
- shadow evaluation creates no reservation, payment, charge, rate, availability, or provider request;
- cursor updates are atomic with canonical event persistence, reject credential-shaped/direct-contact values, and are never exposed in public results;
- legacy non-empty `Channel.credentials` blocks migration instead of being copied or silently deleted;
- the deprecated `Channel.credentials` column remains readable as `{}` by an old application build, defaults to `{}`, is ignored by the new Prisma client, and rejects every non-empty insert or update through a PostgreSQL check constraint;
- `Channel.propertyId` has an enforced property foreign key; and
- audit plus property-filtered DomainEvent evidence is recorded for ingestion, replay, policy, and decision activity.

Empty-database migration success, a sanitized restored-staging-copy migration, app rollback/PITR proof, external scheduler locking, shadow accuracy comparison, staff workflow acceptance, credentialed provider certification, canary observation, and owner approval remain separate gates. This foundation is not autonomous provider-write readiness.

## iCal Token Storage And Disclosure

- `/channels` in server mode reads configured feeds, mappings, room types/rooms, and capability evidence only from authenticated APIs; seeded browser fixtures never appear.
- Failure of any required Channels API produces an explicit unavailable state, blocks writes, and offers an authoritative retry without local fallback.
- `/rooms` in server mode reads property display, room types, and rooms only from authenticated `/api/front-desk/board`; injected browser room/property/type fixtures never render on a failed load, and retry plus reload show the persisted server snapshot.
- a housekeeping membership with `view:board` can open the read-only `/rooms` operational projection, but it sees no guest contact/profile data, folio identifiers, or financial values.
- `view:channels` can inspect server state but cannot use configuration, rotation, removal, or mapping mutation controls; `manage:channels` remains enforced by the backend.
- Private provider import URLs are rejected and never persist in `Channel.config`; the deploy migration removes legacy values and disables inbound iCal sync.
- Normal iCal list/configuration responses never include a previously issued export bearer URL; only initial issue or explicit rotation may return a URL. Issue/rotation requires a property/provider-scoped idempotency key: same intent returns the exact original URL without duplicate evidence only while the token is current or in grace. Changed intent, retry after disable, and retry after a superseding rotation's grace expiry return `409`.
- iCal and mapping inputs reject unknown fields. Configure, rotate, mapping, and disable actions reject URL/credential/contact-shaped JSON-body reasons, sanitize the reason again at persistence, and create property-scoped audit/domain-event evidence with `providerWrite: false`.
- Concurrent first-time setup serializes to one channel. Configure/rotate and disable share the same property/provider lock so a later disable remains authoritative.
- Configuration, disable, mapping create/update/pause/activate/delete, and token issue/rotation all require property-scoped idempotency. An unchanged retry returns the original public result with no new audit/domain event; reuse for changed intent returns `409`.
- Rate push, rate parity, real-time inventory, provider logs/performance, and browser reservation imports are absent from the operational server-mode Channels workspace.
- `npm.cmd run test:channels-server-authority` covers property isolation, forged mapping IDs, secret non-disclosure, reason/audit evidence, capability wording, and demo/server separation.

Acceptance requires:

- a fixed token vector produces the same SHA-256 unpadded base64url digest in the Node service and PostgreSQL migration expression;
- migration `20260717141000_ical_token_hash_backfill` removes `config.exportToken` and writes `config.exportTokenHash` in one row update;
- the migration aborts if an object channel config still contains a raw token;
- normal channel lists and ordinary configuration updates never return `exportFeedUrl`;
- initial issue and explicit rotation may return one full URL, while a later list cannot recover it;
- the previous token authorizes only during the bounded rotation recovery window; and
- no migration query, log, audit row, status DTO, screenshot, or test output exposes a raw token.

Focused migration/service regression evidence comes from `scripts/run-ical-property-scope-tests.mjs`. Applying the migration to an empty database is CI engineering evidence; a restored staging-copy migration and postcondition proof remain separate staging evidence.

## Rates And Settings

Run:

```powershell
node scripts/run-rate-service-tests.mjs
node scripts/run-settings-service-tests.mjs
```

Acceptance requires:

- rate rule/calendar reads and writes are property/room-type scoped and reject unknown fields;
- percentage adjustments use basis points and fixed/override adjustments use satang strings;
- effective-rate precedence and date boundaries are deterministic;
- rate recommendations are suggest-only and create no rate or OTA mutation;
- server mode renders the backend Rates view and a reload preserves the saved rule/calendar value;
- settings writes require manager/admin authority and a non-empty reason;
- credential-shaped values, URL credentials, sensitive query keys, invalid time zones, unsupported gateway enablement, and excessive tax totals fail closed;
- property fee/tax writes dual-write exact and compatibility values, create audit evidence, and emit property-scoped events; and
- settings/status output is sanitized and distinguishes internal configuration from provider proof.

## Persistent Housekeeping And Night Audit

Run:

```powershell
node scripts/run-operations-foundation-tests.mjs
```

Housekeeping acceptance requires:

- tasks and issues cannot reference a room or assignee from another property;
- create, assign, transition, block, complete, resolve, and cancel follow the allowlisted state machines;
- every mutation requires an operational reason and persists status-history, audit, and domain-event evidence;
- critical issue resolution by a housekeeper fails, while manager/admin resolution succeeds; and
- error paths leave the authoritative record unchanged.

Night-audit acceptance requires:

- one run exists per property/business date and one attempt per property/idempotency key;
- same-key retry returns the recorded outcome without duplicate audit/event evidence;
- exact-satang charge, payment, and balance snapshots do not use Float summation;
- unresolved arrivals/departures and housekeeping blockers block close unless an admin supplies an approved override reason;
- emergency stop and unposted room charges remain non-overridable; and
- `postingMode` remains `VERIFY_EXISTING_CHARGES_ONLY` until room-charge posting is implemented and separately tested.

Backend fixture acceptance is not staff workflow acceptance. The server-mode housekeeping and Night Audit screens are cut over to these APIs, but must still pass disposable-DB reload, error rollback, RBAC, and staff workflow checks before operational sign-off.

## Server Booking Board Operations

Acceptance requires:

- unassigned and assigned stays are selectable without reading browser-KV data;
- `POST /api/reservations` and `POST /api/guests` require `x-idempotency-key`; concurrent and later same-intent retries create one property-scoped result and return it with `idempotentReplay: true`, while changed intent/operation and superseded/deleted results return `409` without duplicate evidence;
- room assignment and room moves call the authenticated server command with a per-attempt idempotency header;
- room assignment sends a matching reservation update token in body and header; a stale assignment changes no reservation, inventory, attempt, audit, history, or event state;
- the server persists one property-scoped `ReservationMutationAttempt` per idempotency key; a same-intent replay returns the authoritative reservation without duplicate audit, history, or domain-event evidence, while a changed intent returns `409`;
- stay-date resizing sends both calendar dates to the authenticated PATCH route;
- cancel and no-show require `cancel:reservation`, an operational reason, an idempotency key, and a matching reservation update token; future no-show and checked-in/terminal lifecycle changes are rejected;
- same-intent lifecycle replay creates no duplicate history, audit, or domain event, while changed intent, stale state, forged property identifiers, and superseded outcomes return a truthful error;
- check-in/check-out require a lifecycle idempotency key; the same key is isolated per property, cannot authorize another reservation or intent within one property, and a replay after a later lifecycle mutation returns `409` without new evidence;
- ambiguous network and `5xx` outcomes retain the exact in-memory idempotency key, request body, and stale token; retrying the unchanged assignment produces one audit, history, and domain event;
- reservation-scoped guest/VIP editing requires both `edit:reservation` and `view:guests`, supports explicit contact-field clearing, rejects stale guest state, and stores only changed field names in evidence;
- folio extras require `post:charges`, an open folio, the `legacyFolioCharges` capability, and exact base-10 satang input; an unchanged ambiguous retry reuses the original charge key;
- a housekeeping Board response omits contact/profile PII, channel references, reservation notes, folio identifiers, and financial values while retaining the minimum guest identity/VIP state required for operations;
- incompatible room types and non-operational rooms are disabled in the UI and rejected definitively by the backend;
- successful assignment, move, and resize operations survive a full browser reload and rewrite authoritative `RoomDateInventory`;
- Board handoffs open guided Front Desk and Cashier workspaces without mutation, including when the target workspace is already mounted; consumed query parameters are cleared;
- a membership-limited browser does not render unauthorized Board commands, and Front Desk AI has no direct mutation path or browser-storage handoff;
- two simultaneous attempts to assign the final compatible room result in exactly one success and one `409`, with inventory owned only by the successful reservation;
- an injected mutation conflict displays the backend failure, refetches, and preserves the prior room/dates;
- controls are disabled while a command is pending and no optimistic timeline success state is shown; and
- reservations have no destructive Board delete action and posted financial corrections remain append-only; and
- dynamic room types, property scope, permission denial, inventory blocks, and overlap rules remain backend-enforced.

Run `npm.cmd run test:booking-board-operations`, `npm.cmd run test:reservation-commands`, guarded `npm.cmd run test:e2e:db`, and `npm.cmd run test:e2e:server`. These are engineering evidence, not credentialed front-desk staff acceptance.

## Accounting V2, Direct Booking, And Analyzers

Run:

```powershell
node scripts/run-accounting-v2-tests.mjs
node scripts/run-direct-booking-tests.mjs
node scripts/run-ops-analyzer-tests.mjs
```

Acceptance requires append-only exact-satang corrections, balanced journals/trial balance, property-scoped idempotency, and one primary accounting folio per reservation. Direct booking must prove immutable quote snapshots, hashed-token-only persistence, 15-minute expiry, atomic conversion, idempotent replay, and exactly one winner for simultaneous last-room holds; it must reject unknown/card fields. Analyzer results must be deterministic, explainable, identifier-only, use the supported Hotel Ops taxonomy, and perform no mutation. Production enablement additionally requires restored-staging migration/recovery, WAF/rate limiting, credential handling, staff workflow, and owner proof.

## Evidence Levels

- **Engineering:** focused fixtures plus the standard local validation ladder pass.
- **Staging:** migrations, restored-data reconciliation, disposable/staging DB E2E, recovery, and staff workflow evidence pass against the exact release candidate.
- **Provider:** Gmail/OTA/edge services have credentialed, owner-approved proof for their specific capability.
- **Production sign-off:** the owner accepts the exact release after engineering, staging, security, recovery, operational, and applicable provider evidence is attached.

No lower evidence level implies a higher one, and no local result alone supports a launch-ready claim.
