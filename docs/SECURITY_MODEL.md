# Security Model - Hotel Ops AI Command Center

## Trust Boundaries

Manager commands are untrusted input. They must be parsed, strict-schema validated, permission-checked, persisted, and audited before any execution.

LINE-originated manager commands are also untrusted input. The webhook must verify the LINE signature first; the Hotel Ops bridge remains disabled unless explicitly configured, requires the command prefix, requires a LINE user allowlist mapped to an active PMS user, and still checks `create:ops-task` before calling the shared command service.

WhatsApp-originated manager commands are untrusted input. The webhook must verify the Meta `x-hub-signature-256` HMAC first; the Hotel Ops bridge remains disabled unless explicitly configured, requires the command prefix, requires a sender phone/id allowlist mapped to an active PMS user, and still checks `create:ops-task` before calling the shared command service. Source WhatsApp message ids, contact names, and phone metadata are audit metadata, not execution authority.

Email-originated manager commands are untrusted input. Booking mailbox sync may convert prefixed messages into Ops tasks only when email command intake is explicitly enabled, the sender email is allowlisted to an active PMS user, and that user has `create:ops-task`. Source email ids and links are audit metadata, not execution authority.

The parser is not an execution authority. The backend owns parsed-task schema validation, policy, approvals, emergency stop, queueing, worker signing, secrets, audit records, and notifications.

Booking-email deep scans, backfills, proof output, and review/error reprocess commands must keep message ids, raw bodies, guest data, payment data, and credentials redacted in CLI output. Reprocessing may only return stored events to the review queue; it must not auto-approve or bypass staff review.

OpenAI Responses parsing is optional and backend-only. Prompt input is redacted before submission, model output is strict-schema validated and backend-policy normalized, and provider failures fall back to deterministic parsing with a redacted reason.

The OTA worker accepts only signed, typed tasks. It rejects unknown task types, unknown platforms, unsigned requests, replayed nonces, and credential-shaped payload fields.

OTA websites remain external systems. The worker must not bypass CAPTCHA, 2FA, locked accounts, password-expired flows, rate limits, or platform terms.

When a task reaches `NEEDS_HUMAN`, automated execution stops. Requeueing requires an authorized actor, a non-empty operational reason, and the same run-permission and emergency-stop checks used before worker execution.

## Credential Handling

- No OTA credentials, OpenAI keys, session tokens, or mailbox passwords belong in frontend code.
- No credentials belong in model prompts, task raw messages, task logs, notifications, proof URLs, screenshots, or final summaries.
- `OPENAI_API_KEY`, when used for the optional parser, must be a backend environment secret only.
- Booking.com credentials, when used, must come from backend environment secrets.
- Booking email sync must use server-side Gmail API credentials, either an OAuth access token or backend OAuth refresh-token credentials, not a raw mailbox password.
- Booking email credential diagnostics may expose boolean readiness, missing environment key names, target mailbox, scope names, and redacted Gmail API connection status, but must not expose token, client-secret, authorization-code, password, or authorization-header values.
- Booking email historical backfill must be dry-run first or explicitly confirmed; CLI output must omit message ids, senders, recipients, subjects, raw body text, guest data, payment data, and credential values.
- Booking email parsing must not auto-route OTA account-security notices, partner reports, invoices, or other non-reservation provider mail into reservation/payment mutations; those messages stay `UNKNOWN` and require manual staff review.
- Staff accounts lock after three failed login attempts. Admin password reset is the approved unlock path and must clear failed attempts without exposing password hashes or prior passwords.
- Render Gmail OAuth env-var status checks must use key-presence output only, such as `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token`, and must omit all values. Refresh-token creation should use `npm.cmd run gmail-oauth:render` with env values or a local untracked Google OAuth client JSON file and either `--exchange-code --code-stdin --apply-render` or `--listen --apply-render` so authorization codes and token values are not printed. Env-var setup must be dry-run first with `npm.cmd run render:gmail-oauth` when applying an existing local refresh-token tuple; when applied, either helper may update only the known booking-email Gmail keys and must omit all env-var values and Render auth tokens from output.
- Credentialed production auth/RBAC proof collection must keep passwords in a local untracked input or stdin only. `npm.cmd run auth-rbac:proof` may print masked login identifiers, roles, active status, timestamps, HTTP statuses, and initials, but must not print passwords, cookies, session tokens, full identifiers, or raw response bodies. Denial probes default to GET/HEAD only; mutating denial probes require explicit owner approval and the `--allow-mutating-denial-probes` flag.
- Hotel Ops Gmail email delivery is backend-only and opt-in; it must use backend Gmail OAuth credentials and must redact provider failures before persistence.
- Remote worker calls use `OTA_WORKER_BASE_URL` and `OTA_WORKER_SHARED_SECRET`.
- Scheduled scans must not log credentials on failure.

## Approval Controls

High-risk or write-like task types require approval:

- `SEND_GUEST_REPLY`
- `UPDATE_RATE`
- `UPDATE_AVAILABILITY`
- `CLOSE_ROOM`
- `OPEN_ROOM`
- `UPDATE_DESCRIPTION`
- `UPDATE_PHOTOS`

`UPDATE_PHOTOS` is critical and disabled in the MVP.

Approvals require an operational reason. Denials, cancellations, alert recommendation approvals, alert resolution, and emergency-stop changes also require a reason.

## Emergency Stop

Emergency stop blocks write tasks at these points:

1. command intake decision
2. approval
3. queueing
4. worker execution

Read-only scan and monitoring tasks may continue so staff can still assess the situation.

## Audit Events

Hotel Ops code records audit and task-log evidence for:

- command receipt
- parser output
- validation result
- permission decision
- approval requested, granted, rejected, or denied
- task queued
- worker started
- worker success, failure, or human challenge
- human-action completion and rejected human-action resolution attempts
- alert recommendation approval
- alert acknowledgement or resolution
- scheduler scan run
- booking-intelligence scan snapshot creation, bounded read access, and alert refresh linkage
- emergency stop changes

## Proof Handling

Worker proof artifacts are untrusted until sanitized.

The PMS normalizes proof kinds, caps persisted proof count, redacts credential-like values, blocks raw proof links when redaction is unknown or failed, and shows only safe proof references in the UI.

## Explicit Non-Goals Until Proven

- No CAPTCHA or 2FA bypass.
- No real OTA write execution without dry-run removal, selector verification, and account-owner approval.
- No production claim for email delivery unless a real provider is configured and tested.
- No production claim that historical bookings are loaded into operational reservations until imported Booking Email Events are reviewed and approved through the PMS.
- No launch-ready claim from local tests alone.

## Lite V1 Trust Boundaries

### Gmail Push Is Authenticated Intake, Not Mutation Authority

`POST /api/booking-email/gmail/push` is reachable without a PMS user session so Google Pub/Sub can call it, but it must reject requests unless all of these checks pass:

- Pub/Sub support is explicitly enabled and fully configured.
- The bearer token is a valid Google-signed OIDC identity token.
- Issuer, audience, verified service-account email, subscription, and mailbox equal the configured values.
- The envelope is bounded, the Pub/Sub message id is present, and the Gmail history id is numeric.

The server persists a unique delivery before acknowledging it. A Pub/Sub message id is an idempotency key, not authority to update a booking. The Gmail API access token is resolved only on the backend. Errors are redacted before storage or output.

All Gmail push, history, reconciliation, and maintenance ingestion is forced to review-only. Booking email content and parser output are untrusted. A new/modification/cancellation/payment event cannot mutate PMS state until an authenticated, authorized staff member approves it through the existing service. Processed events cannot be reprocessed. Modification and cancellation approvals require an operational reason and audit evidence. The service also rejects a lifecycle write when an equal-time or newer processed modification/cancellation already exists for the linked reservation; review order is not permission to overwrite newer state. That denial is recorded after rollback with only opaque ids, event types, timestamps, and a reason code. If the denial audit cannot be persisted, the operation remains blocked and returns a hard audit failure.

Payment, cancellation, modification, and other non-new-booking email writes require an explicit or trusted exact-linked reservation id. Guest name and stay dates may suggest a possible duplicate but are never write authority. Link mode carries no ignored edited details. Reprocess derives provider authentication, parsed fields, and reservation matching again from immutable raw text and stored Gmail `Authentication-Results`; it cannot preserve a stale parser result or stale reservation id.

Approval mode is allowlisted and cannot retype a cancellation/modification into reservation creation. The service rechecks `create:reservation`, `edit:reservation`, `cancel:reservation`, or `process:payment` according to the actual event action; a generic review-screen permission is not mutation authority. When a new or modified booking declares children, approval requires one verified age per child before pricing or capacity changes.

Email-derived money keeps persisted parser semantics: a stay total cannot be sourced from a deposit/payment label, and a payment cannot be sourced from a stay-total label. An unmarked amount has no invented currency, and multiple distinct values carrying the same semantic label are ambiguous. Approval uses the persisted amount only; input cannot replace it or relabel its currency/kind, and the currency must match the configured property currency. Verified OTA stay totals are inclusive exact-satang values with persistent reservation provenance; public reservation inputs cannot inject or replace that provenance. Staff cannot create additional `ROOM` charges, and repricing requires exactly one active system-managed room charge.

`sourceEmailEventId` is internal evidence provenance. Public charge, payment, walk-in, check-in, and checkout payloads are rejected if they attempt to set it. Cumulative exact payments set `depositPaid` only after crossing a positive deposit threshold; provider repricing re-evaluates that threshold. Checkout releases physical room-date inventory before publishing any early-checkout availability increase.

Every booking-email row that predates the Lite review boundary is marked `legacyReadOnly`, including unresolved rows from the bounded 1,000-message historical import. These rows remain evidence but cannot be approved, rejected, reprocessed, or replayed into operational reservations. Only messages ingested after the Lite cutover enter the actionable review queue; staff must reconcile any real active stay from authoritative OTA/PMS evidence rather than applying stale imported parser output.

The five-minute maintenance cron renews watches, retries durable deliveries, and reconciles Gmail history. It improves recovery but is neither a security bypass nor a delivery guarantee. If the watch or push identity is misconfigured, the correct response is to repair configuration or rely on reviewed manual intake—not to disable OIDC or review controls.

### Manual Channel Queue Is Non-Credential Coordination

Manual channel configuration may contain provider codes, verified property/room/rate identifiers, and official HTTPS Extranet links. Provider columns use extensible text storage, but current write paths still allowlist only supported adapters; extensible storage does not authorize an unknown provider. Configuration must reject password-, token-, cookie-, session-, secret-, API-key-, 2FA-, or credential-shaped fields. Extranet URLs may not contain embedded credentials, query strings, fragments, or non-standard ports and must resolve under the configured provider's official domain.

Manual availability tasks do not authorize browser automation or OTA writes. Completion records an operator attestation, timestamp, exact availability, revision, and optional notes; it is not independent OTA state proof. Stale revisions and mismatched values are rejected. Configuration/reconciliation/reopen is Manager/Admin-only; completion is limited to Front Desk, Manager, or Admin.

An enabled manual connection must have an active mapping for every room type that owns a physical room, including temporarily non-sellable rooms. Active external room-type/rate-plan targets are unique per connection at the database boundary. A disabled-to-enabled transition cannot commit until it stages a bounded 1–90-day absolute-availability baseline for that connection, with aggregate audit evidence. Reconciliation never guesses an external target: missing mappings skip task creation and produce an aggregated audit record for the provider, PMS room type, and affected date range.

The source OTA for an approved email is also reconciled with current absolute PMS availability. This prevents stale source-provider tasks from remaining actionable; it is still manual coordination and is not evidence that the provider's broader inventory is synchronized. Every enabled provider remains exposed to staff delay.

Every task revision stores an immutable external room/rate-plan target. Completion rejects a task when the active mapping has changed, and retry/reopen recalculates current absolute availability before creating an audited revision against the current mapping. Channel Desk returns true aggregate counts even when its PII-safe work lists are bounded.

`DISABLED_CHANNEX_ADAPTER` must remain disabled until a certified channel account, backend-only secrets, provider/property/room mappings, sandbox test evidence, error/retry policy, audit output, emergency stop, and owner approval exist. No Channex credential belongs in the client or manual mapping records.

### PII-Safe Realtime Invalidation

`GET /api/realtime/events` requires an authenticated session and the narrow `view:realtime` operational permission. This lets Housekeeping receive room-state invalidations without granting access to the guest booking board. The server allows only named invalidation event types and emits only occurrence time, optional opaque entity id, and optional reason code. Guest names, email data, room data, payment data, message content, credentials, and arbitrary caller payloads are excluded. The client must refetch authorized endpoints after a signal.

SSE is in-process and non-replaying. It is an availability optimization, not a source of truth or authorization decision. Reconnect emits `sync-required`; polling remains the fallback. A multi-instance deployment requires a shared invalidation bus to avoid instance-local blind spots.

### Provider And Production Authority

An ordinary Booking.com individual-property Extranet account is not direct Connectivity API authorization. Agoda and Trip.com application material requires owner-controlled legal/business information and provider testing. Repository code, a drafted packet, or an opened form is not application submission or approval.

Lite remains staging-only until owner/live proof exists for Render configuration, database recovery, Gmail OAuth/watch/Pub/Sub, cron operation, provider decisions, Cloudflare proxy/WAF traffic path, staff roles, Thai/English acceptance, exact money, and rollback. Do not place credentials or production guest data in test fixtures or evidence.

### Money Integrity

Lite read DTOs require the integer-satang fields, and active PMS writers calculate in satang before deriving legacy Float rollback parity. Missing required satang values fail closed instead of silently converting Float at the boundary. The dormant `RateCalendar` table is backfilled/reconciled but must not become an active pricing writer until it dual-writes the pair. The guarded populated-legacy migration test may run only with `ALLOW_DB_E2E=true` and an unmistakably disposable `E2E_DATABASE_URL`; it creates and removes its own schema and must never target production-like data. This repository contract is not production proof: production money cutover remains blocked until the nullable expansion/backfill migration, zero-difference reconciliation, fresh restore proof, representative staging workflows, and rollback-period requirements are evidenced. No migration should be applied to production without a fresh recovery point and successful disposable restore test.

The full guest ID/passport value remains in the protected backend guest record. Lite operational reads expose only identity-complete state and the last four characters to authorized front-desk/booking roles; the Housekeeping DTO contains no guest name, email metadata, document identifier, rate, folio, or payment data. Active stays keep an open folio for incidentals. A settled checkout closes it; a reasoned unpaid-checkout override leaves it open so a later payment can settle and close the folio.

See `docs/LITE_ARCHITECTURE.md` for the complete Lite data flow and rollout boundaries.
