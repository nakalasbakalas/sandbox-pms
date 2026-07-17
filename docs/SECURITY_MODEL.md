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

Authenticated session identity is not property authority by itself. PMS routes resolve an active `UserPropertyMembership` for the configured `SANDBOX` property and services scope lookups to the resulting `propertyId`. A client-supplied room, reservation, rate, housekeeping, or audit identifier must never change that context.

Domain events are an internal synchronization boundary, not an audit substitute or execution command. They are written transactionally, read only within the authenticated property, and exposed over SSE without metadata or actor identity. Clients may use them to trigger an authoritative refetch; they must not apply financial or operational state directly from an event payload.

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
- Property settings must not be used as a secret store. The settings schemas reject credential-shaped keys/values, URL user information, and sensitive URL query parameters; OTA, Gmail, worker, and OpenAI secrets remain backend environment secrets.
- SSE responses must remain session-authenticated, `view:board` authorized, property-scoped, `no-store`, and free of guest, financial, credential, and audit metadata.
- iCal export tokens are bearer credentials. New and rotated tokens are stored only as SHA-256 base64url hashes; the full feed URL may be shown only in the issue/rotation response and must not be returned by later channel reads. Deploy migration `20260717141000_ical_token_hash_backfill` converts and removes legacy raw token fields atomically.

## Exact-Money And Financial Integrity

- Exact values are stored as PostgreSQL `BIGINT` satang and serialized as base-10 strings. Percentages and tax rates use integer basis points.
- Legacy Float columns remain during the compatibility window. Dual-write disagreement is rejected, and `MONEY_READ_AUTHORITY` defaults to `legacy_float` until a staged reconciliation authorizes satang reads.
- Payment and legacy charge creation re-read the folio inside serializable transactions and require property-scoped idempotency keys. Payments reject closed folios and unapproved overpayments; charges reject closed folios and remain append-only.
- A duplicate payment or charge key may return only the original same-intent result. Charge intent is fingerprinted from folio, optional explicit date, description, category, exact satang amount, quantity, and booking-email source; changed intent fails closed with `409`. Serialization and unique-key races are retried through the same validation path without duplicating audit or domain-event evidence.
- Payment and charge uniqueness is scoped by `(propertyId, idempotencyKey)`. A foreign folio or booking-email source is rejected before the financial write, audit row, or event can be created.
- Server-mode financial forms retain opaque attempt keys only in application memory. The same unchanged attempt reuses its key through uncertain retries and rerenders, and confirmed success clears it. No attempt material or key is written to browser storage; after a full reload, staff must reconcile authoritative folio state rather than assume the previous key can be recovered.
- No migration or environment flag is proof of financial correctness. Production satang authority requires restored-staging reconciliation, zero unresolved variance, recovery proof, staff workflow acceptance, and owner approval.

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
- property settings and tax changes
- rate rule and calendar changes
- payments, charges, room status, and other event-producing PMS mutations
- housekeeping task/issue creation, assignment, and status transitions
- night-audit blocked/completed attempts and override evidence

`AuditLog` has a required first-class `propertyId`, indexed for property/time queries and protected by a property foreign key. Migration backfill aborts when legacy audit ownership is ambiguous or cannot be derived. Services must still create and query audit evidence through authenticated property context; the column alone is not authorization and does not establish a general multi-tenant SaaS claim.

## Proof Handling

Worker proof artifacts are untrusted until sanitized.

The PMS normalizes proof kinds, caps persisted proof count, redacts credential-like values, blocks raw proof links when redaction is unknown or failed, and shows only safe proof references in the UI.

OTA status crosses a strict provider-adapter contract boundary. The public DTO uses allowlisted fields and never includes credential values, environment-key names, cookies, sessions, selectors, or raw provider responses. Evidence URLs have user information and fragments removed, credential-shaped query parameters redacted, and unsafe-redaction artifacts replaced by blocked mock references.

`OTA_LIVE_WRITES_ENABLED` is false by default and is not sufficient to authorize a write. A live capability also requires implemented adapter support and separate provider proof; the Hotel Ops approval, operational-reason, idempotency, audit, signed-worker, and emergency-stop checks still apply afterward.

## Rates, Settings, Housekeeping, And Night Audit

- Rate and settings input uses strict schemas that reject unknown fields. Rate recommendations are suggest-only and have no authority to mutate rates or provider inventory.
- Settings mutations require manager/admin authority and a reason. Payment-gateway configuration is explicitly constrained to false in this phase.
- Housekeeping task/issue transitions follow allowlisted state machines and require reasons. Assignees must be active members of the same property; critical issue closure requires manager/admin authority.
- Night-audit close is property/business-date unique and idempotent. Emergency stop and missing room charges cannot be overridden. Other blocker override requires admin authority and a separate override reason.
- Current night audit is verification-only and does not create missing room charges. Browser-local UI completion state is not accepted as backend close evidence.

## Accounting, Direct Booking, And Deterministic Analysis

- Accounting V2 is disabled by default. New financial records use exact satang, property-scoped idempotency, serializable transactions, actor/reason evidence, and append-only reversal/refund links.
- Direct booking is disabled by default and accepts no card fields. Quotes are database-immutable, holds store only a hash of the public token, inventory is locked and rechecked in a serializable transaction, and conversion creates its operational records atomically.
- `DIRECT_BOOKING_TOKEN_SECRET` is backend-only and must never appear in responses, logs, screenshots, audit changes, frontend bundles, or commits.
- Deterministic analyzers accept strict aggregate inputs and evidence identifiers only. They cannot receive callbacks or mutate PMS/provider state; accepted suggestions re-enter the normal Hotel Ops command boundary.

## Explicit Non-Goals Until Proven

- No CAPTCHA or 2FA bypass.
- No real OTA write execution without dry-run removal, selector verification, and account-owner approval.
- No production claim for email delivery unless a real provider is configured and tested.
- No production claim that historical bookings are loaded into operational reservations until imported Booking Email Events are reviewed and approved through the PMS.
- No launch-ready claim from local tests alone.
- No production satang-authority claim before reconciliation and rollback proof.
- No claim that legacy iCal tokens are removed in an environment until the migration is applied there and a key-only postcondition check passes.
- No completed housekeeping or night-audit staff-workflow claim until disposable-DB reload/error-path tests and staff acceptance are attached to the release candidate.
- No Accounting V2 or direct-booking production enablement from local fixture tests or an environment flag alone.
- No multi-property SaaS claim from the membership foundation alone.
