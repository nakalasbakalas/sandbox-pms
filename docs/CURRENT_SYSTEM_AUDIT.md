# Current System Audit - Hotel Ops AI Command Center

Last reviewed: 2026-07-02

## Repository Overview

- Framework: Vite, React, TypeScript.
- Backend/runtime: Node HTTP server in `server/index.mjs`.
- Package manager: npm, use `npm.cmd` and `npx.cmd` on Windows.
- Database: Prisma with Postgres-compatible schema.
- Auth: backend session auth in server mode, role permissions in `server/rbac.mjs`.
- Deployment: Render-oriented server build with local and GitHub CI launch checks.
- Hotel Ops AI mode: deterministic controlled parser by default, with optional backend-only OpenAI Responses parsing when explicitly configured; all parsed tasks are strict-schema validated before permission decisions.
- Queue/worker: backend-owned task queue state with signed OTA worker boundary and local dry-run fallback.
- Booking intelligence: backend scan engine creates trend alerts and in-app/email notifications; email delivery stays provider-pending unless the backend Gmail provider is explicitly enabled and configured.
- Staff alert surface: the shared PMS header notification bell can include backend Hotel Ops notifications for users with Ops permission; read/dismiss state is persisted through backend acknowledgment routes.
- Booking email intake: backend routes exist for status, sync, events, approve/reject/reprocess, and sources; Gmail mailbox sync supports backend-owned OAuth access-token or refresh-token credentials.
- LINE command intake: signed LINE webhooks can optionally convert prefixed, allowlisted staff messages into Hotel Ops commands through the same backend task service; this is disabled by default.

## Relevant Implementation Files

- API entry point: `server/index.mjs`.
- Ops service and policy: `server/ops-service.mjs`.
- Scheduled scans: `server/ops-scheduler.mjs`.
- Signed worker client: `server/ops-worker-client.mjs`.
- Worker signing/replay protection: `server/ops-worker-auth.mjs`.
- OTA adapter boundary: `server/ota-adapters/index.mjs`.
- Booking.com dry-run adapter skeleton: `server/ota-adapters/booking-com.mjs`.
- Data model: `prisma/schema.prisma` and `prisma/migrations/20260630133000_hotel_ops_command_center`.
- UI: `src/components/hotel-ops/HotelOpsCommandCenterView.tsx`.
- Today action surfacing: `src/components/today/TodayView.tsx`.
- Booking Inbox UI: `src/components/booking-email/BookingInboxView.tsx`.
- API client/types: `src/lib/hotel-ops-api-client.ts`, `src/types/hotel-ops.ts`.
- Notification bridge: `src/hooks/use-ops-notifications.ts`, `src/lib/ops-notification-display.ts`, and `src/components/notifications/NotificationCenter.tsx`.
- LINE Ops intake bridge: `server/line-ops-intake.mjs`.
- Business and route smoke tests: `scripts/run-business-tests.mjs`, `scripts/run-e2e-tests.mjs`.

## Implemented Surface

- `/ops/chat`, `/ops/approvals`, `/ops/tasks`, `/ops/intelligence`, and `/ops/settings` render through the existing navigation shell.
- `/api/ops/commands`, task, approval, human-action resolution, notification read/dismiss, intelligence, emergency-stop, OTA-status, and scan-run routes are implemented.
- `/api/ops/policy` exposes the backend-enforced permission/risk policy for the Settings policy matrix.
- High-risk task approval, denial, cancellation, alert recommendation, alert resolution, and emergency-stop mutations require reasons.
- `NEEDS_HUMAN` task resolution requires an operational reason, reuses backend run-permission and emergency-stop checks, and requeues only after authorized human action is recorded.
- Worker requests are signed, nonce-protected, credential-field rejected, and dry-run by default.
- Booking Inbox edit, link, create, approve, reject, and reprocess actions call backend booking-email routes. Edited parser details are submitted as approval payloads, matched new bookings link instead of creating duplicates, and cancellation email actions require an operational reason.
- Notification bell/center merges local housekeeping notifications with backend Hotel Ops notifications and keeps provider-pending or failed email delivery records visible to staff.
- Optional LINE command intake is prefix-gated, allowlisted by LINE source user id, mapped to an active PMS user, checked for `create:ops-task`, and submitted through `submitOpsCommand` with LINE message idempotency.
- Scheduler runs in-process interval scans only when `HOTEL_OPS_SCAN_INTERVAL_MINUTES` or `OPS_SCAN_INTERVAL_MINUTES` is positive.
- Cron expressions remain an external scheduler contract.

## Current Boundaries

- No raw OTA credentials are exposed to frontend, prompts, task records, notifications, or proof artifacts.
- Booking.com has a dry-run adapter skeleton with selector TODOs. Real browser writes remain disabled until selector and account-owner proof exists.
- CAPTCHA, 2FA, locked-account, and password-expired challenges are not bypassed; staff can only record authorized human completion and requeue through the audited backend flow.
- Agoda, Trip.com, and Expedia currently use the signed mock worker path.
- Email notifications are recorded as provider-pending intents by default. When `HOTEL_OPS_EMAIL_DELIVERY_ENABLED=true` and backend Gmail OAuth credentials are configured, Hotel Ops email notifications are sent through Gmail API and persisted as `SENT` or `FAILED`.
- Hotel Ops notification read/dismiss state is persisted server-side and audited separately from notification provider delivery status.
- The parser is deterministic by default and strict-schema validated. An optional OpenAI Responses parser is available only when backend environment flags and `OPENAI_API_KEY` are configured; model output is redacted, schema-validated, policy-normalized, and falls back to deterministic parsing on provider failure.
- Production launch readiness still needs account-owner proof, production user approval, provider setup, manual workflow acceptance, and recovery owner sign-off.

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
