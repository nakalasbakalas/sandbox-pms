# Current System Audit - Sandbox PMS And Hotel Ops

Last reviewed: 2026-07-18

## Repository Overview

- Framework: Vite, React, TypeScript.
- Backend/runtime: Node HTTP server in `server/index.mjs`.
- Package manager: npm, use `npm.cmd` and `npx.cmd` on Windows.
- Database: Prisma with Postgres-compatible schema.
- Auth: backend session auth in server mode, role permissions in `server/rbac.mjs`, persistent three-failure account lockout cleared by admin password reset, and redacted owner-run production proof collection through `npm.cmd run auth-rbac:proof`. Server identity remains in React memory only, legacy browser identity keys are removed, and request generations prevent a stale `/api/auth/me` response from clearing a newer interactive login.
- Deployment: Render-oriented server build with local and GitHub CI launch checks.
- Hotel Ops AI mode: deterministic controlled parser by default, with optional backend-only OpenAI Responses parsing when explicitly configured; all parsed tasks are strict-schema validated before permission decisions.
- Queue/worker: backend-owned task queue state with signed OTA worker boundary and local dry-run fallback.
- Booking intelligence: backend scan engine creates trend alerts and in-app/email notifications; email delivery stays provider-pending unless the backend Gmail provider is explicitly enabled and configured.
- Staff alert surface: the shared PMS header notification bell can include backend Hotel Ops notifications for users with Ops permission; read/dismiss state is persisted through backend acknowledgment routes.
- Booking email intake: backend routes exist for status, sync, events, approve/reject/reprocess, and sources; Gmail mailbox sync supports backend-owned OAuth access-token or refresh-token credentials. `/api/booking-email/status` now separates route availability from mailbox-sync readiness and reports non-secret OAuth client, refresh token, target mailbox, Gmail profile connection-test, missing-key, and last-sync status without exposing credential values. Current PMS capture state can be checked with `npm.cmd run booking-email:proof`. Historical Gmail capture can be checked with `npm.cmd run booking-email:backfill -- --query "<approved Gmail query>" --limit <n>`; the helper is dry-run by default and confirmed imports create review-only Booking Email Events for `/booking-inbox` in bounded chunks. When no explicit `--query` is supplied, the helper defaults to the approved provider-query boundary instead of the incomplete primary-mailbox-only filter, excluding known OTA security/reporting/invoice noise unless an owner-approved override is supplied. Parser/duplicate posture can be checked with `npm.cmd run booking-email:deep-scan -- --limit <n>`, and existing `NEEDS_REVIEW` / `ERROR` events can be reparsed with `npm.cmd run booking-email:reprocess -- --confirm` without auto-approving any event. OTA account-security, partner-reporting, and partner-invoice emails must classify as `UNKNOWN` and stay out of reservation/payment automation unless staff explicitly reclassify them. Render Gmail OAuth env-var presence can be checked with `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token`; new refresh-token setup can use `npm.cmd run gmail-oauth:render` with env values or a local Google OAuth client JSON file, then either `--exchange-code --code-stdin --apply-render` or `--listen --apply-render`; existing-token setup can be staged with `npm.cmd run render:gmail-oauth`. Both helpers omit credential values from output and require explicit apply flags before Render mutation. As of Slice 5BW, Render has a booking-specific Gmail OAuth refresh-token tuple ready, deploy `dep-d94reknlk1mc73bqndq0` is live with chunked confirmed-import handling, and job `job-d94rfti8qa3s73d5jhv0` imported 1000 historical provider messages as review-only Booking Email Events. `npm run booking-email:proof` then reported 1000 total events, all Needs Review, with 0 processed, 0 errors, and 0 ignored. Staff visual review and parser quality remain required before applying events.
- LINE command intake: signed LINE webhooks can optionally convert prefixed, allowlisted staff messages into Hotel Ops commands through the same backend task service; this is disabled by default.
- WhatsApp command intake: signed Meta WhatsApp webhooks can optionally convert prefixed, allowlisted staff messages into Hotel Ops commands through the same backend task service; this is disabled by default.
- Email command intake: booking mailbox sync can optionally convert prefixed, allowlisted sender messages into Hotel Ops commands through the same backend task service; this is disabled by default.
- Exact money: nullable `BIGINT` satang shadow columns and integer basis-point fields coexist with the legacy Float contract. New supported writes dual-write both representations; `MONEY_READ_AUTHORITY` defaults to `legacy_float` until reconciliation authorizes a staged switch.
- Property context: authenticated PMS requests resolve the active `SANDBOX` property through `UserPropertyMembership`. Existing users are backfilled by migration; inactive or missing memberships fail closed.
- Server synchronization: selected PMS mutations write property-scoped `DomainEvent` rows in the same transaction. Authenticated `/api/events` SSE exposes only event id, type, aggregate type/id, and timestamp with bounded catch-up.
- Rates and settings: property-scoped backend rate rules/calendar/effective-rate/recommendation endpoints and property/tax/status endpoints are implemented with strict schemas, permissions, audit records, and domain events.
- Operations foundation: persistent housekeeping tasks/issues/status histories and an idempotent backend night-audit close service are implemented. Server-mode housekeeping and Night Audit screens now use these APIs; browser-local workflow state is demo-only.
- Accounting V2: additive one-to-many accounting folios, append-only reversals/refunds, cash shifts, house accounts/A/R, journals, and exact-satang trial balance are implemented behind `ACCOUNTING_V2_ENABLED=false`. The legacy browser-KV accounting dashboard and cash reconciliation workflow are demo-only and render a truthful unavailable state in server mode.
- Direct booking: versioned availability, immutable quote, 15-minute hold, and atomic booking services/routes are implemented behind `DIRECT_BOOKING_ENABLED=false`; no card data is accepted.
- Bounded intelligence: deterministic demand, cancellation-risk, housekeeping, and rate-opportunity analyzers return explainable, suggest-only Hotel Ops recommendations and perform no mutations.
- Autonomy shadow foundation: SYSTEM-only canonical provider-event ingestion, durable cursors, property/provider/task policies, PostgreSQL advisory locking, agent-run/decision evidence, and `SHADOW_NOOP` action records are implemented as an additive engineering foundation. Snapshot, reconciliation-issue, and dead-letter tables are schema foundations only; no service yet creates or presents them. Only `OBSERVE`, `SHADOW`, and `PROHIBITED` modes exist, and no provider or PMS operational write path is exposed.
- Channel secret boundary: the autonomy migration replaces `Channel.credentials` JSON with `credentialRef` plus non-secret `credentialStatus` and adds a first-class Property foreign key. The migration aborts if any legacy row contains non-empty credential JSON so an operator must quarantine and rotate it instead of silently copying or deleting secrets.

## Relevant Implementation Files

- API entry point: `server/index.mjs`.
- Ops service and policy: `server/ops-service.mjs`.
- Scheduled scans: `server/ops-scheduler.mjs`.
- Signed worker client: `server/ops-worker-client.mjs`.
- Worker signing/replay protection: `server/ops-worker-auth.mjs`.
- OTA adapter boundary: `server/ota-adapters/index.mjs`.
- Booking.com dry-run adapter skeleton: `server/ota-adapters/booking-com.mjs`.
- Agoda, Trip.com, and Expedia dry-run adapter skeletons: `server/ota-adapters/platform-skeleton.mjs`.
- Data model: `prisma/schema.prisma` and `prisma/migrations/20260630133000_hotel_ops_command_center`.
- Booking-intelligence scan snapshots: `prisma/migrations/20260702064500_hotel_ops_scan_snapshots`.
- UI: `src/components/hotel-ops/HotelOpsCommandCenterView.tsx`.
- Today action surfacing: `src/components/today/TodayView.tsx`.
- Booking Inbox UI: `src/components/booking-email/BookingInboxView.tsx`.
- API client/types: `src/lib/hotel-ops-api-client.ts`, `src/types/hotel-ops.ts`.
- Notification bridge: `src/hooks/use-ops-notifications.ts`, `src/lib/ops-notification-display.ts`, and `src/components/notifications/NotificationCenter.tsx`.
- LINE Ops intake bridge: `server/line-ops-intake.mjs`.
- Email Ops intake bridge: `server/email-ops-intake.mjs`.
- Business and route smoke tests: `scripts/run-business-tests.mjs`, `scripts/run-e2e-tests.mjs`.
- Exact-money and payment safety: `server/money.mjs`, `scripts/run-money-tests.mjs`, and `prisma/migrations/20260716120000_exact_money_foundation`.
- Property context and events: `server/request-context.mjs`, `server/domain-events.mjs`, and `prisma/migrations/20260716130000_property_context_domain_events`.
- Legacy finance ownership and retry safety: `server/charge-idempotency.mjs`, `src/lib/durable-attempt-key.ts`, and migrations `20260717120000_property_scope_legacy_records` and `20260717140000_charge_idempotency`.
- iCal bearer-token storage: `server/ical-feed.mjs` and `prisma/migrations/20260717141000_ical_token_hash_backfill`.
- Server-backed operational services: `server/rate-service.mjs`, `server/settings-service.mjs`, `server/housekeeping-service.mjs`, `server/night-audit-service.mjs`, and `prisma/migrations/20260716140000_operations_foundation`.
- Gated foundations: `server/accounting-service.mjs`, `server/direct-booking-service.mjs`, `server/ops-analyzers.mjs`, and migrations `20260716150000_accounting_v2_foundation` and `20260716160000_direct_booking_foundation`.
- Shadow autonomy: `server/autonomy/contracts.mjs`, `policy-engine.mjs`, `action-planner.mjs`, `distributed-lock.mjs`, `retry-policy.mjs`, `shadow-service.mjs`, and migration `20260718120000_autonomy_shadow_foundation`.

## Implemented Surface

- `/ops/chat`, `/ops/approvals`, `/ops/tasks`, `/ops/intelligence`, and `/ops/settings` render through the existing navigation shell.
- `/api/ops/commands`, task, approval, human-action resolution, notification read/dismiss, intelligence, emergency-stop, OTA-status, and scan-run routes are implemented.
- `/api/ops/policy` exposes the backend-enforced permission/risk policy for the Settings policy matrix.
- High-risk task approval, denial, cancellation, alert recommendation, alert resolution, and emergency-stop mutations require reasons.
- `NEEDS_HUMAN` task resolution requires an operational reason, reuses backend run-permission and emergency-stop checks, and requeues only after authorized human action is recorded.
- Worker requests are signed, nonce-protected, credential-field rejected, and dry-run by default.
- Booking Inbox edit, link, create, approve, reject, and reprocess actions call backend booking-email routes. Edited parser details are submitted as approval payloads, matched new bookings link instead of creating duplicates, and cancellation email actions require an operational reason. Historical backfills are bounded review-queue imports; the CLI output omits message ids, senders, subjects, body text, guest data, payment data, and credentials. Duplicate review now keys off same-type provider/message-content matches rather than channel reference alone, and auto-process failures are persisted back onto the event as `ERROR` instead of aborting the sync transaction.
- Notification bell/center merges local housekeeping notifications with backend Hotel Ops notifications and keeps provider-pending or failed email delivery records visible to staff.
- Optional LINE command intake is prefix-gated, allowlisted by LINE source user id, mapped to an active PMS user, checked for `create:ops-task`, and submitted through `submitOpsCommand` with LINE message idempotency.
- Optional WhatsApp command intake is prefix-gated, HMAC signature-verified, allowlisted by sender phone/id, mapped to an active PMS user, checked for `create:ops-task`, submitted through `submitOpsCommand` with source channel `whatsapp`, and linked to source message metadata in task logs/audit.
- Optional email command intake is prefix-gated, allowlisted by sender email, mapped to an active PMS user, checked for `create:ops-task`, submitted through `submitOpsCommand` with source channel `email`, and linked to source email metadata in task logs/audit.
- Scheduler runs in-process interval scans only when `HOTEL_OPS_SCAN_INTERVAL_MINUTES` or `OPS_SCAN_INTERVAL_MINUTES` is positive.
- Cron expressions remain an external scheduler contract.
- Each Hotel Ops booking-intelligence scan now persists a durable `HotelOpsScanSnapshot` with scan window, occupancy, booking velocity, cancellation, room-type, OTA distribution, and alert mutation counts. Alerts are linked to the scan snapshot that created or last refreshed them, and the latest bounded snapshots are visible through `GET /api/ops/intelligence/scans` and the `/ops/intelligence` evidence panel.
- Server mode uses authenticated `UserPropertyMembership` context before PMS routes run. Membership role can narrow or override the compatibility `User.role` for the active property.
- `/api/openapi.json`, `/api/system/capabilities`, and `/api/events` expose the authenticated API contract, truthful capability state, and property-scoped event stream respectively.
- The server-backed Rates view persists rate rules and date-specific calendar rates, calculates effective rates in exact satang, and generates suggest-only recommendations. It does not push rates to an OTA.
- Property settings and taxes persist through `/api/settings/property` and `/api/settings/tax`; `/api/settings/status` returns a sanitized server-derived status object.
- Housekeeping task and issue routes persist assignments, constrained status transitions, operational reasons, audit evidence, and domain events. Critical issue resolution requires manager or admin authority.
- Night audit persists one run per property/business date plus idempotent attempts. Its current posting mode is `VERIFY_EXISTING_CHARGES_ONLY`: it verifies existing room charges and blocks unsafe close conditions rather than posting missing charges.
- Server-mode payment and charge surfaces use one shared, memory-only attempt-key manager. An unchanged attempt reuses its key through rerenders and uncertain retries in the same loaded application; a changed financial intent receives a different key, and a confirmed success clears the key. The helper never writes attempt material, guest data, payment references, or keys to `localStorage` or `sessionStorage`, so a full page reload is not a retry-key recovery mechanism.
- iCal export feed tokens are stored only as SHA-256 base64url hashes. Existing raw `Channel.config.exportToken` values are converted and removed by deploy migration `20260717141000_ical_token_hash_backfill`; normal channel reads and ordinary configuration updates do not return the bearer feed URL. The raw URL is disclosed only in the initial issue response or an explicit token rotation response.

## Current Boundaries

- No raw OTA credentials are exposed to frontend, prompts, task records, notifications, or proof artifacts.
- Booking.com has a dry-run adapter skeleton with selector TODOs. Real browser writes remain disabled until selector and account-owner proof exists.
- Agoda, Trip.com, and Expedia have explicit dry-run adapter skeletons with platform-specific credential status, proof placeholders, and selector-failure/human-challenge paths. Real browser reads and writes remain disabled until selectors and account-owner proof exist.
- CAPTCHA, 2FA, locked-account, and password-expired challenges are not bypassed; staff can only record authorized human completion and requeue through the audited backend flow.
- Unknown or all-platform OTA tasks still use the signed mock worker fallback.
- Email notifications are recorded as provider-pending intents by default. When `HOTEL_OPS_EMAIL_DELIVERY_ENABLED=true` and backend Gmail OAuth credentials are configured, Hotel Ops email notifications are sent through Gmail API and persisted as `SENT` or `FAILED`.
- Hotel Ops notification read/dismiss state is persisted server-side and audited separately from notification provider delivery status.
- The parser is deterministic by default and strict-schema validated. An optional OpenAI Responses parser is available only when backend environment flags and `OPENAI_API_KEY` are configured; model output is redacted, schema-validated, policy-normalized, and falls back to deterministic parsing on provider failure.
- Production launch readiness still needs credentialed account-owner proof, production user creation/verification, provider WAF/recovery proof, manual workflow/localization acceptance, booking-email parser acceptance, and demo/sample cleanup proof.
- Scan snapshots are PMS-derived operational evidence, not live OTA scrape proof. Live OTA snapshot quality still depends on verified adapter reads or imported booking data.
- Exact-money rollout is expand-only. Legacy Float columns remain present and authoritative by default; no production satang cutover, reconciliation cycle, or legacy-column removal is proven by this branch alone.
- Legacy payment and charge writes now require property-scoped idempotency keys, re-read folio ownership inside serializable transactions, and return the original result only when the normalized financial intent matches. Charge ownership is backfilled through the folio reservation; key reuse with a different charge fingerprint fails closed without appending another charge.
- `AuditLog`, `Payment`, `Charge`, and `Guest` now have first-class property ownership. Their legacy backfill migrations fail closed when ownership cannot be derived safely; applying those migrations to production data is not proven until restored-data migration and reconciliation evidence exists.
- The SSE client bridge currently translates a bounded set of reservation, room, payment, and charge events into legacy client refresh events. Other server event types remain durable and streamable but require view-specific refetch wiring.
- In server mode, Settings, housekeeping, and Night Audit use backend persistence; disposable-browser coverage is engineering evidence and does not replace staff workflow acceptance on the exact release candidate.
- Accounting V2 and direct-booking foundations are implemented but capability-gated and not production-enabled. Online card payments and a live guest-messaging provider are not implemented by this foundation.
- Autonomous provider execution is not implemented. Provider acknowledgements, read-back verification, compensation actions, credentialed webhooks/APIs, external durable scheduling, canary proof, and provider/owner approval remain later phases.

## Validation Evidence

Recent committed Hotel Ops validation has included:

- `npm.cmd test`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npx.cmd prisma validate`
- `git diff --check`
- `npm.cmd run build`
- `npm.cmd run test:e2e`
- guarded DB E2E with `ALLOW_DB_E2E=true` and disposable `E2E_DATABASE_URL`
- GitHub CI launch gate on `main`

Focused branch checks are available through `scripts/run-money-tests.mjs`, `scripts/run-rate-service-tests.mjs`, `scripts/run-settings-service-tests.mjs`, and `scripts/run-operations-foundation-tests.mjs`. Passing these local fixture checks is engineering evidence only. Database migration, staging restore/reconciliation, staff workflow, provider, recovery, WAF, and owner sign-off remain separate evidence gates.

The integration CI definition now includes an empty PostgreSQL migration lifecycle, a separately migrated and seeded disposable PostgreSQL database, `scripts/run-release-foundation-db-tests.mjs`, and `scripts/run-server-mode-browser-tests.mjs`. The guarded DB suite covers effective membership roles, missing membership, forged cross-property identifiers and source links, payment/charge property-scoped idempotency, same-intent replay, concurrent overpayment and charge retry behavior, exact-money reconciliation, audit ownership, and simultaneous last-room holds. The browser suite covers authenticated server-mode reload persistence, a controlled API failure, recovery by authoritative refetch, and SSE filtering. These are CI test contracts; they are not claims that the corrected commit has passed both jobs, that migrations have succeeded on a restored staging copy, or that staff/provider/owner proof exists.

## Provider Adapter Contract Status

- Booking.com, Agoda, Trip.com, and Expedia now expose one validated backend contract for health, declared reads, dry-run writes, retries, rate-limit metadata, and sanitized evidence.
- Current adapters have no verified live-write implementation or provider proof. `OTA_LIVE_WRITES_ENABLED` defaults off, and the contract reports no live-write capabilities even if the flag is requested.
- Provider credentials and selector details remain backend-only and are excluded from public contract DTOs. This is engineering contract evidence, not live OTA proof.
