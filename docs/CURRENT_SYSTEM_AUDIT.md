# Current System Audit - Hotel Ops AI Command Center

Last reviewed: 2026-07-13

## Repository Overview

- Framework: Vite, React, TypeScript.
- Backend/runtime: Node HTTP server in `server/index.mjs`.
- Package manager: npm, use `npm.cmd` and `npx.cmd` on Windows.
- Database: Prisma with Postgres-compatible schema.
- Auth: backend session auth in server mode, role permissions in `server/rbac.mjs`, persistent three-failure account lockout cleared by admin password reset, and redacted owner-run production proof collection through `npm.cmd run auth-rbac:proof`.
- Deployment: Render-oriented server build with local and GitHub CI launch checks.
- Hotel Ops AI mode: deterministic controlled parser by default, with optional backend-only OpenAI Responses parsing when explicitly configured; all parsed tasks are strict-schema validated before permission decisions.
- Queue/worker: backend-owned task queue state with signed OTA worker boundary and local dry-run fallback.
- Booking intelligence: backend scan engine creates trend alerts and in-app/email notifications; email delivery stays provider-pending unless the backend Gmail provider is explicitly enabled and configured.
- Staff alert surface: the shared PMS header notification bell can include backend Hotel Ops notifications for users with Ops permission; read/dismiss state is persisted through backend acknowledgment routes.
- Booking email intake: backend routes exist for status, sync, events, approve/reject/reprocess, and sources; Gmail mailbox sync supports backend-owned OAuth access-token or refresh-token credentials. `/api/booking-email/status` now separates route availability from mailbox-sync readiness and reports non-secret OAuth client, refresh token, target mailbox, Gmail profile connection-test, missing-key, and last-sync status without exposing credential values. Current PMS capture state can be checked with `npm.cmd run booking-email:proof`. Historical Gmail capture can be checked with `npm.cmd run booking-email:backfill -- --query "<approved Gmail query>" --limit <n>`; the helper is dry-run by default and confirmed imports create review-only Booking Email Events for `/booking-inbox` in bounded chunks. When no explicit `--query` is supplied, the helper defaults to the approved provider-query boundary instead of the incomplete primary-mailbox-only filter, excluding known OTA security/reporting/invoice noise unless an owner-approved override is supplied. Parser/duplicate posture can be checked with `npm.cmd run booking-email:deep-scan -- --limit <n>`, and existing `NEEDS_REVIEW` / `ERROR` events can be reparsed with `npm.cmd run booking-email:reprocess -- --confirm` without auto-approving any event. OTA account-security, partner-reporting, and partner-invoice emails must classify as `UNKNOWN` and stay out of reservation/payment automation unless staff explicitly reclassify them. Render Gmail OAuth env-var presence can be checked with `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token`; new refresh-token setup can use `npm.cmd run gmail-oauth:render` with env values or a local Google OAuth client JSON file, then either `--exchange-code --code-stdin --apply-render` or `--listen --apply-render`; existing-token setup can be staged with `npm.cmd run render:gmail-oauth`. Both helpers omit credential values from output and require explicit apply flags before Render mutation. Historical Slice 5BW evidence records that one Render service had a booking-specific Gmail OAuth refresh-token tuple, deployed chunked confirmed-import handling, and imported 1000 provider messages as review-only events. That historical service evidence is not current Lite staging credential/watch/Pub/Sub proof. Staff visual review and parser quality remain required before applying events.
- LINE command intake: signed LINE webhooks can optionally convert prefixed, allowlisted staff messages into Hotel Ops commands through the same backend task service; this is disabled by default.
- WhatsApp command intake: signed Meta WhatsApp webhooks can optionally convert prefixed, allowlisted staff messages into Hotel Ops commands through the same backend task service; this is disabled by default.
- Email command intake: booking mailbox sync can optionally convert prefixed, allowlisted sender messages into Hotel Ops commands through the same backend task service; this is disabled by default.

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

## Implemented Surface

- `/ops/chat`, `/ops/approvals`, `/ops/tasks`, `/ops/intelligence`, and `/ops/settings` render through the existing navigation shell.
- `/api/ops/commands`, task, approval, human-action resolution, notification read/dismiss, intelligence, emergency-stop, OTA-status, and scan-run routes are implemented.
- `/api/ops/policy` exposes the backend-enforced permission/risk policy for the Settings policy matrix.
- High-risk task approval, denial, cancellation, alert recommendation, alert resolution, and emergency-stop mutations require reasons.
- `NEEDS_HUMAN` task resolution requires an operational reason, reuses backend run-permission and emergency-stop checks, and requeues only after authorized human action is recorded.
- Worker requests are signed, nonce-protected, credential-field rejected, and dry-run by default.
- Booking Inbox edit, link, create, approve, reject, and reprocess actions call backend booking-email routes. Edited parser details are submitted only for apply/create modes; linking does not require missing OTA child-age details. Payment, cancellation, modification, and other non-new-booking writes require an explicit or previously exact-linked reservation id and never use guest-name/date similarity as write authority. Matched new bookings link instead of creating duplicates, modification and cancellation email actions require an operational reason, and processed events cannot be reprocessed. Reprocess rebuilds from immutable raw text and Gmail authentication headers, discards stale parsed fields, and recomputes the exact match. Historical backfills are bounded review-queue imports; the CLI output omits message ids, senders, subjects, body text, guest data, payment data, and credentials. Duplicate review now keys off same-type provider/message-content matches rather than channel reference alone, and auto-process failures are persisted back onto the event as `ERROR` instead of aborting the sync transaction.
- Notification bell/center merges local housekeeping notifications with backend Hotel Ops notifications and keeps provider-pending or failed email delivery records visible to staff.
- Optional LINE command intake is prefix-gated, allowlisted by LINE source user id, mapped to an active PMS user, checked for `create:ops-task`, and submitted through `submitOpsCommand` with LINE message idempotency.
- Optional WhatsApp command intake is prefix-gated, HMAC signature-verified, allowlisted by sender phone/id, mapped to an active PMS user, checked for `create:ops-task`, submitted through `submitOpsCommand` with source channel `whatsapp`, and linked to source message metadata in task logs/audit.
- Optional email command intake is prefix-gated, allowlisted by sender email, mapped to an active PMS user, checked for `create:ops-task`, submitted through `submitOpsCommand` with source channel `email`, and linked to source email metadata in task logs/audit.
- Scheduler runs in-process interval scans only when `HOTEL_OPS_SCAN_INTERVAL_MINUTES` or `OPS_SCAN_INTERVAL_MINUTES` is positive.
- Cron expressions remain an external scheduler contract.
- Each Hotel Ops booking-intelligence scan now persists a durable `HotelOpsScanSnapshot` with scan window, occupancy, booking velocity, cancellation, room-type, OTA distribution, and alert mutation counts. Alerts are linked to the scan snapshot that created or last refreshed them, and the latest bounded snapshots are visible through `GET /api/ops/intelligence/scans` and the `/ops/intelligence` evidence panel.

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

## Lite V1 Audit Addendum

The Lite implementation is a parallel client and API slice, not a replacement backend. `src-lite/` uses the existing authenticated Node/Prisma services for operational writes and adds focused read models for Front Desk, Bookings, Board, Housekeeping, Channel Desk, Settings, and release metadata. The booking board response keeps complete reservation segments separate from rooms and unassigned bookings. PostgreSQL remains authoritative; browser storage is not an operational data store.

Implemented in the current worktree:

- `GET /api/lite/v1/front-desk`, `/bookings`, `/board`, `/housekeeping`, and `/channel-desk`, plus `GET /api/version`.
- Complete core stay operations: same-day walk-in, versioned room assignment/date edits, identity/payment-gated check-in, reasoned no-show, exact folio charges/payments, zero-balance checkout, unpaid-folio follow-up, and dirty-room housekeeping handoff. Every active create form collects one age per child, staff cannot manually post a `ROOM` charge, and checkout releases the reservation's physical room-date rows before any early-checkout availability is queued.
- Gmail Pub/Sub push validation using Google OIDC audience/service-account checks, an expected subscription and mailbox, a bounded payload, and a numeric history cursor.
- Durable/idempotent `BookingEmailPushDelivery` records, per-source leases, retry/coalescing state, Gmail history reconciliation, watch renewal, and `npm.cmd run booking-email:maintenance`.
- Forced review-only Gmail ingestion. Receipt or reconciliation creates/updates review-queue events; it does not auto-apply a reservation, modification, cancellation, payment, or room assignment.
- Booking-email money keeps parser evidence: stay totals, payments, and deposits remain distinct; unmarked currency is never invented; conflicting same-kind values stay in review. Approval applies only the persisted amount, semantic type, and property-matching currency, so reviewer input cannot replace or relabel money. A verified OTA stay total is stored as inclusive exact satang with persistent provenance, so local occupancy supplements are not added again and a later non-pricing edit cannot reprice it. Repricing also fails closed unless the folio has exactly one system-managed active room charge.
- Booking-email provenance is internal-only: public charge, payment, walk-in, check-in, and checkout payloads cannot claim a `sourceEmailEventId`. Deposit-paid state is derived from cumulative exact payments crossing a positive deposit threshold and is reconciled after provider repricing.
- Provider-scoped Booking.com, Agoda, and Trip.com reservation attribution and external-reference matching.
- Durable manual channel connections, room mappings, and availability tasks with official-domain Extranet URLs, immutable target snapshots, coalescing, supersession/revision checks, current-availability retry, completion evidence, and audit records. A connection cannot be enabled until every room type with at least one physical room has an active mapping and a bounded initial absolute-availability baseline is staged in the same transaction; the database prevents two PMS room types from sharing the same active provider room/rate-plan target. Reconciliation skips unmapped provider/room cells and writes a blocking audit record instead of creating a task that staff cannot safely execute.
- A disabled Channex adapter boundary. Automatic availability delivery is rejected until a certified account, secret path, mapping, and live verification exist.
- An authenticated SSE invalidation channel. Its allowlisted payload contains only event type, timestamp, optional opaque id, and optional reason; clients refetch authorized APIs and poll as fallback.

Material boundaries and open risks:

- Push is best-effort near-live intake, not guaranteed zero-lag synchronization. The five-minute maintenance cron is a reconciliation target and must still be configured and proven on Render staging.
- Manual channel tasks do not write to Booking.com, Agoda, or Trip.com. Staff must update each Extranet; overbooking exposure exists until all tasks are completed.
- Booking.com does not offer ordinary direct Connectivity API access to an individual property through its normal Extranet account. Agoda and Trip.com partner applications require owner-controlled legal/business details, provider onboarding, and testing; no application submission or approval is claimed in repository code.
- The Channex boundary is disabled and is only the recommended future rail if certified, automatic inventory distribution becomes essential.
- Lite DTOs read integer satang as authoritative. Runtime writers use exact satang arithmetic and derive legacy Float fields from the same validated integer for rollback parity. The schema/migration includes nullable satang fields, tax basis points, audited backfill SQL, and a read-only reconciliation command. Production cutover remains open until disposable restore, zero-difference reconciliation, staging workflow, and 30-day rollback evidence exists.
- The legacy-email cutover archives completed, rejected/ignored, or already-past rows while keeping unresolved active, future, or undated `NEEDS_REVIEW`/`ERROR` work actionable so Gmail message-id deduplication cannot strand a live booking or cancellation.
- The six Lite Prisma migrations (manual queue, Gmail push, satang expansion/backfill, mapping-target uniqueness, immutable task targets/read-only legacy email evidence, and provider-total provenance) have been applied and exercised in an isolated local PostgreSQL E2E schema, including post-workflow money reconciliation and automatic schema removal. The immutable-target migration also reopens historically auto-closed folios for active stays and marks every pre-snapshot channel target unverified so reconciliation must replace it. This is engineering proof only; the migrations have not been applied to or proven on Render staging or production.
- No Lite Render deployment, Gmail watch/Pub/Sub configuration, cron schedule, Cloudflare route/WAF path, production migration, staff acceptance, or OTA provider approval is established by this worktree.

The full Lite boundary, rollout sequence, and outstanding proof are documented in `docs/LITE_ARCHITECTURE.md`.
