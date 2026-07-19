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

Autonomy shadow records are evidence, not execution authority. GPT or a future agent may receive sanitized snapshots and propose a strict candidate; deterministic policy evaluation owns scope, trust, limits, quiet hours, proof, emergency-stop, and the permanent no-write decision in the shadow phase. No autonomy module may import an OTA worker, browser adapter, credential source, or authoritative reservation/payment/rate/inventory mutation service.

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
- In server mode, the HTTP-only backend session is the identity authority. Do not persist the authenticated user, role, email, session token, or legacy auth token in browser storage; stale bootstrap responses must not override a newer login or logout.
- Server onboarding may persist a credential-free draft only. Admin password and confirmation values remain memory-only, and legacy onboarding keys that may contain credentials are removed before and after setup.
- Render Gmail OAuth env-var status checks must use key-presence output only, such as `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token`, and must omit all values. Refresh-token creation should use `npm.cmd run gmail-oauth:render` with env values or a local untracked Google OAuth client JSON file and either `--exchange-code --code-stdin --apply-render` or `--listen --apply-render` so authorization codes and token values are not printed. Env-var setup must be dry-run first with `npm.cmd run render:gmail-oauth` when applying an existing local refresh-token tuple; when applied, either helper may update only the known booking-email Gmail keys and must omit all env-var values and Render auth tokens from output.
- Credentialed production auth/RBAC proof collection must keep passwords in a local untracked input or stdin only. `npm.cmd run auth-rbac:proof` may print masked login identifiers, roles, active status, timestamps, HTTP statuses, and initials, but must not print passwords, cookies, session tokens, full identifiers, or raw response bodies. Denial probes default to GET/HEAD only; mutating denial probes require explicit owner approval and the `--allow-mutating-denial-probes` flag.
- Hotel Ops Gmail email delivery is backend-only and opt-in; it must use backend Gmail OAuth credentials and must redact provider failures before persistence.
- Remote worker calls use `OTA_WORKER_BASE_URL` and `OTA_WORKER_SHARED_SECRET`.
- Scheduled scans must not log credentials on failure.
- Property settings must not be used as a secret store. The settings schemas reject credential-shaped keys/values, URL user information, and sensitive URL query parameters; OTA, Gmail, worker, and OpenAI secrets remain backend environment secrets.
- SSE responses must remain session-authenticated, `view:board` authorized, property-scoped, `no-store`, and free of guest, financial, credential, and audit metadata.
- iCal export tokens are bearer credentials. New and rotated tokens are deterministically HMAC-issued from the backend-only session secret for a property/provider-scoped `x-idempotency-key`. The ledger retains the non-secret request key, intent fingerprint, and bearer-free public result; `Channel.config` retains only token hashes. Same-intent retry reconstructs the original issue response without duplicate evidence only if current authoritative channel state still accepts that token. Disabled or expired/superseded replays and changed intent fail `409`. The full feed URL may be shown only in that issue/rotation response and must not be returned by later reads. Deploy migration `20260717141000_ical_token_hash_backfill` converts and removes legacy raw token fields atomically.
- Provider iCal import URLs may contain bearer material and are not accepted or stored. Migration `20260719100000_remove_raw_ical_import_urls` deletes legacy raw values and disables inbound iCal sync; a future importer must use an approved secret-reference service.
- Export-token rotation retains only a bounded set of prior hashes and expiry timestamps for a 15-minute recovery window. Configure and disable share one property/provider transaction lock. iCal and mapping changes reject unknown fields, require `manage:channels`, use a shared URL/credential/contact-safe JSON-body reason policy, and sanitize evidence again at persistence.
- Every visible Channels mutation requires a property-scoped idempotency key. `ChannelMutationAttempt` stores a one-way intent fingerprint and credential-free public result; unchanged retries replay without duplicate evidence, changed intent fails `409`, and no browser storage is used for retry keys.
- Server-mode Channels must fail closed when iCal, mapping, room-setup, or capability authority is unavailable. It must never substitute browser-KV reservations, rooms, mappings, logs, inventory, rate, or performance data.
- Channel secret state uses only `credentialRef` and non-secret `credentialStatus`; Channel rows are not a secret store. Migration `20260718120000_autonomy_shadow_foundation` aborts when legacy `Channel.credentials` contains non-empty JSON, requiring operator quarantine/rotation. The deprecated column remains only for old-app rollback compatibility, is ignored by the new Prisma client, defaults to `{}`, and has a database constraint rejecting every non-empty value.

## Autonomous Operations Safety

- Only `OBSERVE`, `SHADOW`, and `PROHIBITED` policies are valid in the current phase.
- `ActionExecution.mode` can only be `SHADOW_NOOP`, and the database rejects a shadow row that claims `providerRequestSent=true`.
- Provider-event identity, idempotency, cursor, policy, run, decision, action, issue, and dead-letter records are property-scoped.
- Normalized event payloads, proposed commands, explanations, audit evidence, and domain-event metadata reject credential-shaped keys/values and direct contact data.
- Email, staff commands, and AI interpretation remain below authenticated provider evidence in the source-trust hierarchy and cannot establish a booking, cancellation, or cleared-payment fact.
- A PostgreSQL advisory lock coordinates identical property/job/source shadow work across instances. Process-local scheduler booleans remain development compatibility only.
- Provider acknowledgement, read-back, compensation, autonomous external writes, and Agents SDK execution tools do not exist in this phase.

## Exact-Money And Financial Integrity

- Exact values are stored as PostgreSQL `BIGINT` satang and serialized as base-10 strings. Percentages and tax rates use integer basis points.
- Legacy Float columns remain during the compatibility window. Dual-write disagreement is rejected, and `MONEY_READ_AUTHORITY` defaults to `legacy_float` until a staged reconciliation authorizes satang reads.
- Payment and legacy charge creation re-read the folio inside serializable transactions and require property-scoped idempotency keys. Payments reject closed folios and unapproved overpayments; charges reject closed folios and remain append-only.
- A duplicate payment or charge key may return only the original same-intent result. Charge intent is fingerprinted from folio, optional explicit date, description, category, exact satang amount, quantity, and booking-email source; changed intent fails closed with `409`. Serialization and unique-key races are retried through the same validation path without duplicating audit or domain-event evidence. Unit amount, quantity, and calculated total are bounded before persistence so oversized input cannot degrade into PostgreSQL integer overflow or a generic database error.
- Payment and charge uniqueness is scoped by `(propertyId, idempotencyKey)`. A foreign folio or booking-email source is rejected before the financial write, audit row, or event can be created.
- Server-mode financial forms retain an opaque attempt record in same-tab `sessionStorage` so an unchanged uncertain write can reuse its key after a full reload. The record contains only a hashed operation/entity slot, one-way intent fingerprint, and opaque idempotency key; it contains no request material, raw entity identifier, guest data, amount, reference, or credential, never uses `localStorage`, and is cleared after confirmed success. The backend remains the operation authority and validates the key plus financial intent.
- The Booking Board gates legacy folio extras on the dedicated `legacyFolioCharges` server capability, not the disabled Accounting V2 flag. It sends exact `amountSatang` strings to the same serializable, property-scoped charge service; this does not enable Accounting V2 or online payments.
- Browser-KV accounting entries and cash counts are demo data only. Server mode must capability-gate those legacy screens until server-backed Accounting V2 reads and writes have passed reconciliation and staff acceptance.
- No migration or environment flag is proof of financial correctness. Production satang authority requires restored-staging reconciliation, zero unresolved variance, recovery proof, staff workflow acceptance, and owner approval.

## Booking Board Command And PII Boundary

- Login and `/api/auth/me` resolve and return the active property-membership role. The legacy global user role is compatibility data only and cannot widen the signed session or request actor. Every authenticated request resolves membership again, so deactivation or role reduction applies to an existing session without requiring a new login.
- Room assignment, check-in, and check-out execute inside serializable transactions with property-scoped reservation, room/date-inventory, and idempotency locks. Visible server clients send the selected reservation update token in both the request header and body; conflicting tokens, stale state, changed intent, and superseded replay fail with `409`.
- Staff `POST /api/reservations` and `POST /api/guests` require a property-scoped `x-idempotency-key`. `PmsCreateAttempt` stores only the operation, opaque key, one-way intent/result fingerprints, and created entity identifier. An unchanged retry returns the original entity without duplicate guest, reservation, folio, charge, audit, history, or event evidence; changed intent, a different create operation, missing/deleted entity, or a later entity change fails with `409`.
- An ambiguous network or `5xx` outcome retains the exact command snapshot in component memory and the opaque attempt record in same-tab `sessionStorage`. Only a definitive non-retryable client rejection or confirmed success retires the attempt. Request bodies, stale-write tokens, raw entity identifiers, PII, amounts, references, and credentials are never placed in the attempt store.
- Cancel/no-show and reservation-scoped guest updates execute only through typed PMS services with property scope, permission checks, serializable reservation locks, stale-write tokens, idempotent intent fingerprints, audit/history/domain evidence, and truthful `409` conflicts. Cancellation/no-show always requires a reason.
- `GET /api/front-desk/board` is an allowlisted operational DTO, not a raw Prisma relation graph. Guest contact/profile fields require `view:guests`; channel references and reservation notes require `view:reservations`; folio and exact-money fields require a cashier/charge/payment permission. `view:board` alone does not grant those fields.
- The server-mode Rooms workspace reads its property display, room types, and rooms from that authenticated Board DTO only. If the snapshot cannot be retrieved it shows an unavailable state and retry control without rendering browser-KV room/property/type data. `view:board` remains required to enter `/rooms`.
- The server-mode Reservations workspace reads its list and room/readiness projection only from authenticated reservation and Board snapshots. If either authority is unavailable it must show a persistent unavailable/retry state with no reservation rows, no browser-KV guest/room/reservation fallback, and no create affordance. `view:reservations` remains required to enter `/reservations`; restored snapshots do not expand the separate create, edit, lifecycle, finance, or guest permissions.
- The server-mode Cashier workspace reads folios only from authenticated `GET /api/cashier/folios`. If that authority is unavailable it must show a persistent Cashier unavailable/retry state with no server or browser folios, no zero-value operational dashboard, and no payment or charge affordance. Browser-KV folio and accounting values remain demo-only; restored authority does not expand the separate cashier, payment, or charge permissions.
- `CAFE_STAFF` has `view:cashier` and `post:charges` only. It may receive permitted property-scoped folio refresh events, but it must never render a payment collection/recording affordance or invoke `process:payment`.
- Guest-change audit and domain evidence records only the guest identifier and changed field names, never the submitted email, phone, identity number, notes, or other profile values.
- Board-to-Front-Desk/Cashier handoffs use allowlisted workflow names and sanitized reservation/folio identifiers in the URL, clear the query after consumption, and never carry guest data, money, credentials, or mutation payloads. Front Desk AI may read, suggest, and navigate only; it cannot call a mutating route or claim that navigation itself changed PMS state.
- Operational reservations are never deleted from the Board. Posted financial corrections remain append-only reversals/refunds with original-transaction linkage.

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
