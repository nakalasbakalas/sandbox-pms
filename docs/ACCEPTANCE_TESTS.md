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
- Primary-source initialization and missed-push reconciliation use the shared approved-provider query; the known incomplete direct-mailbox default is upgraded while an owner-custom query is preserved.
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

## Lite V1 Acceptance Plan

Lite V1 remains a staging candidate until every applicable item below has evidence for the exact reviewed commit. A passing unit test does not substitute for database, staging, provider, staff, recovery, or public-edge proof.

### Build And Compatibility

- `npm.cmd run typecheck:lite` passes.
- `npm.cmd run test:lite` passes.
- `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npx.cmd prisma validate`, `npm.cmd run build`, `npm.cmd run build:lite`, and `git diff --check` pass.
- Legacy UI behavior remains available during the pilot.
- `npm.cmd run build:lite` invokes `npm.cmd run check:lite-bundle` and fails when the entry plus its static JavaScript imports exceed 250 KiB gzip; secondary screens are excluded only when they remain dynamic imports.
- Pull requests run guarded `test:e2e:lite` against the workflow job's disposable PostgreSQL 17 service with `ALLOW_DB_E2E=true`; this is CI engineering proof, never production proof.

Evidence locations include `tests/booking-email-gmail-sync.test.mjs`, `scripts/tests/pms-channel-integration.mjs`, `scripts/run-business-tests.mjs`, and the server-mode E2E harness. Record actual command output separately; listing a test file here is not a pass claim.

### Lite Operational Reads And UI

- Front Desk separates arrivals, departures, and in-house stays and shows room/payment blockers.
- Check-in requires nationality plus ID/passport evidence and exact settlement unless a reasoned Manager/Admin override is authorized; a failed payment/check-in attempt leaves the reservation unchanged.
- Active/prepaid stays retain an open folio for incidentals. Normal checkout requires zero balance and closes the folio; an approved unpaid checkout leaves it open until later settlement closes it.
- No-show rejects future and terminal reservations and requires an operational reason.
- The booking editor rejects checked-in stays, public lifecycle-status injection, a child count without one age per child, and overpayment even when a caller supplies an override-shaped flag.
- Every active reservation-create form captures one age from 0 through 17 for each child. Cashier incidental entry cannot select `ROOM`.
- Bookings supports bounded pagination plus date, status, source, and text filters.
- Board returns separate `rooms`, complete `reservationSegments`, and `unassignedBookings`; two future reservations on one room are both visible.
- Board supports a 14-day default and validated ranges up to 90 days, including a configured room type that is neither Twin nor Double.
- Housekeeping supports dirty -> cleaning -> clean -> inspected according to backend transition rules; occupied cleaning preserves the active stay, while occupied inspection/maintenance and reason-less maintenance fail before mutation.
- Booking detail is property-scoped, authenticated, and loads a capped, newest-first safe `ReservationLog` timeline on demand without exposing raw changes, notes, internal account identifiers, network metadata, credentials, or payment details.
- Channel Desk exposes non-secret mailbox/watch health, review-required events, mappings, and pending/failed manual tasks.
- Pending and failed manual tasks display creation time and raw age; failed tasks show manager escalation without inventing an unapproved overdue SLA.
- Settings is permission-filtered and does not expose credentials.
- Clearing browser storage loses no booking, room, folio, payment, housekeeping, email-review, or channel-task state.
- Two browser sessions observe committed changes through SSE-triggered refetch or fallback polling.
- A failed backend mutation never displays success.
- Desktop and tablet layouts plus Thai and English core routes/actions/statuses/errors pass staff review. Thai-speaking staff acceptance is required.

### Gmail Push And Review Gate

- Push rejects missing/invalid OIDC, issuer, audience, service account, subscription, mailbox, message id, oversized/invalid data, and invalid history id.
- A valid push is durably stored before HTTP `202`.
- Replaying the same Pub/Sub message id is idempotent and does not reset attempts or completion state.
- A stale `PROCESSING` claim is reclaimed after its timeout; retries remain visible and errors are redacted.
- Gmail watch renewal records a future expiry; an invalid/expired history cursor uses bounded reconciliation without silently advancing past an incomplete scan.
- Push, history, reconciliation, explicit Gmail sync, and five-minute maintenance all call the PMS ingester with `reviewOnly: true`.
- Every booking-email row present at the Lite migration boundary is immutable `legacyReadOnly` evidence; only post-cutover ingestion can enter the actionable review queue.
- Booking.com, Agoda, and Trip.com fixtures cover new booking, modification, cancellation, duplicates, out-of-order notification/history delivery, parser errors, and failed review actions. Service-level lifecycle tests also prove that a stale modification or cancellation cannot mutate a reservation when an equal-time/newer processed lifecycle event exists and that the rejected attempt persists exactly one sanitized denial audit after rollback.
- Parser-error rows and true aggregate totals remain visible in Channel Desk; authorized staff can retry parsing or reject with a reason.
- Approval mode cannot retype an event, cancellation requires `cancel:reservation`, payment requires `process:payment`, and a declared child count cannot be applied without one verified age per child.
- Payment, cancellation, modification, and other non-new-booking email writes with no explicit or persisted exact reservation id fail without mutation; a guest-name/date heuristic is never write authority. Cross-property, cancelled, and no-show links also fail without mutation.
- Parser tests distinguish `STAY_TOTAL`, `PAYMENT`, and `DEPOSIT`, prefer the event-appropriate semantic class, never invent currency for an unmarked number, and mark distinct same-kind values ambiguous. Approval input cannot replace the persisted amount or relabel its currency/semantics.
- Parser tests reject impossible calendar dates, retain valid leap days and hyphenated provider references, and do not treat lowercase prose such as `all`, `try`, or `mad` as ISO currency. Reprocess replaces stale amount/currency/reference/match fields from immutable raw text, retains provider identity only with stored Google-authenticated evidence, and clears an unverifiable stale match.
- New/modification totals remain the provider's exact inclusive satang total even with extra-adult/child occupancy. Persistent provider-total provenance survives non-pricing edits without rewriting room inventory; provider-linked pricing changes without a new verified stay total or with zero/multiple active room charges fail without mutation. Public incidental-charge entry rejects `ROOM`.
- Public charge, payment, walk-in, check-in, and checkout payloads cannot forge `sourceEmailEventId`. Partial payments change `depositPaid` only at a positive cumulative threshold, and repricing can move that state in either direction.
- Receipt of any fixture creates/updates `NEEDS_REVIEW` evidence and makes no reservation, inventory, payment, or room mutation.
- An authorized approval uses the existing PMS transaction, reason/audit rules, and exact provider-scoped reference. Modification and cancellation approvals require a reason.
- A processed event cannot be reprocessed.
- A missed/failed push is recovered by a later maintenance run without duplicate event/reservation creation.
- SSE emitted for email changes contains no guest, sender, recipient, subject, room, payment, body, or credential data.

Automated tests target negative OIDC and Pub/Sub envelope handling, durable idempotency, review-only history ingestion, watch renewal and invalid-response handling, stale history fallback, abandoned-claim recovery, out-of-order cursor coalescing, all nine Booking.com/Agoda/Trip.com create-modify-cancel attribution combinations, exact-reference handling, modification/cancellation reasons, absolute source-provider reconciliation, and processed-event reprocess denial. Staging watch/push/cron evidence remains separately required.

### Manual Channel Queue

- Only `booking_com`, `agoda`, and `trip_com` provider codes are accepted.
- Credential-shaped fields and non-official/non-HTTPS Extranet URLs are rejected.
- Enabling a connection fails until every room type with at least one physical room has an active mapping, including room types whose rooms are temporarily out of service.
- Two PMS room types cannot share the same active external room-type/rate-plan target on one connection; both service preflight and the database concurrency constraint reject the conflict.
- Reconciliation creates no task for an unmapped provider/room cell, returns the gap, and persists an aggregated `MANUAL_CHANNEL_TASKS_SKIPPED_UNMAPPED` audit record.
- Enabling a previously disabled connection requires a 1–90-day initial horizon, stages absolute-availability tasks for only that connection in the activation transaction, records `MANUAL_CHANNEL_INITIAL_BASELINE_STAGED`, and rolls back activation if task staging fails.
- Each Channel Desk task displays its external room type id/name and rate-plan id; a legacy task with no current mapping cannot be completed.
- Direct housekeeping API calls cannot skip or reverse `DIRTY -> CLEANING -> CLEAN -> INSPECTED`; explicit dirty-cycle restart and idempotent repeats remain allowed, while maintenance requires a reason and is blocked for occupied rooms.
- Direct and walk-in inventory changes create cells for all enabled manual connections.
- An approved OTA email reconciles every enabled connection, including the originating provider, with current absolute PMS availability and supersedes stale source-provider work.
- Creation, inventory-changing edit, cancellation/no-show, and reviewed modification/cancellation recalculate every affected stay date inside the PMS transaction.
- Early checkout deletes the reservation's physical room-date inventory before reconciling the released stay dates to Channel Desk.
- Identical desired values coalesce; changed values supersede the active task and increment revision.
- A stale revision, wrong availability, disabled connection, missing mapping, or non-manual mode cannot be completed.
- Front Desk/Manager/Admin may complete a current task; only Manager/Admin may configure, reconcile, or reopen.
- Completion persists exact availability, operator, timestamp, notes, and audit evidence.
- Retry/reopen requires a reason, recalculates current absolute availability, snapshots the current mapping, and cannot conflict with an already-current task.
- A service-level lifecycle test proves identical-task coalescing, completed operator evidence, unchanged confirmed inventory, and reasoned audited reopen into the next revision.
- Pending/failed task age and retry/error visibility are usable by staff.
- The disabled Channex boundary reports `CHANNEX_NOT_CONFIGURED` and cannot perform a push.

No acceptance result may describe the manual queue as automatic, two-way, live, zero-lag, or overbooking-proof.

### Money Precision Blocker

Repository tests for exact satang reads, dual writes, pricing, deposits, tax/void arithmetic, partial payments, and exact zero balance are necessary but insufficient. Production Lite folio/payment acceptance additionally requires:

- nullable integer-satang columns for every scoped money field and integer basis points for tax configuration;
- exact `RateCalendar.rateSatang` backfill and reconciliation alongside room-type rates;
- audited Float-to-satang backfill and reconciliation report;
- dual-write parity tests for creates/edits, partial and multiple payments, taxes, voids, deposits, and zero-balance checkout;
- applied migration and runtime proof for the provider-total satang/currency provenance pair;
- zero unexplained folio/payment discrepancies;
- fresh Render recovery point and successful disposable restore;
- Lite authoritative satang reads/writes; and
- a 30-day rollback period before Float authority is removed.

The schema now contains nullable integer-satang authority fields while retaining Float rollback-parity columns. `npm.cmd run test:money-backfill:db` is the guarded populated-legacy proof: it requires `ALLOW_DB_E2E=true` plus a disposable `E2E_DATABASE_URL`, creates an isolated schema, seeds Float-only/invalid legacy rows, applies the money migrations, asserts exact backfill/quarantine, runs read-only reconciliation, and removes the schema. This acceptance section remains open until that command and the broader Lite E2E pass for the exact commit, followed by a fresh Render recovery point, disposable restore or isolated staging database, live migration/reconciliation evidence, and the rollback period. Do not infer production completion from local or CI E2E alone.

### Provider And Staging Proof

- Booking.com is documented and operated as manual; no ordinary individual-property direct Connectivity API access is claimed.
- Agoda and Trip.com application packets contain only owner-verified facts. Submission, provider response, sandbox credentials, certification, and production approval each require separate owner/provider evidence.
- Channex remains disabled unless the complete certified integration gate in `docs/OTA_ADAPTER_GUIDE.md` passes.
- A separate Render Lite staging service uses a sanitized disposable/staging database and the exact reviewed commit.
- Staging proves migrations, `/healthz?deep=1`, `/api/version`, asset identity, auth/RBAC, review-only Gmail watch/push, five-minute cron, manual queue, logs, and rollback.
- Cloudflare DNS/proxy/WAF traffic-path evidence is recorded before any Lite public hostname is treated as protected.
- Cloudflare rule-configuration proof and traffic-enforcement proof remain separate: hostname-covered metadata alone does not pass the public-edge gate while DNS is absent or DNS-only.
- Seven consecutive days of Gmail/parser shadow comparison and a 14-day staff pilot pass before domain cutover.
- Every active/future booking, mapping, opening inventory/rate plan, duplicate risk, inventory drift, and unresolved task is reconciled.
- OTA disconnect happens one provider at a time in an owner-controlled maintenance window, with an approved booking/modification/cancellation test and 48-hour observation before the next provider.
- Legacy access/exports remain available through the 30-day rollback period.

Repository/local checks cannot close these live/provider/owner items. See `docs/LITE_ARCHITECTURE.md` for the release boundary.
