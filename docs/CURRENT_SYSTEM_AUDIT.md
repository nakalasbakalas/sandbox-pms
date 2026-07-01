# Current System Audit - Hotel Ops AI Command Center

Last reviewed: 2026-07-01

## Repository Overview

- Framework: Vite, React, TypeScript.
- Backend/runtime: Node HTTP server in `server/index.mjs`.
- Package manager: npm, use `npm.cmd` and `npx.cmd` on Windows.
- Database: Prisma with Postgres-compatible schema.
- Auth: backend session auth in server mode, role permissions in `server/rbac.mjs`.
- Deployment: Render-oriented server build with local and GitHub CI launch checks.
- Hotel Ops AI mode: deterministic controlled parser today, not live OpenAI execution.
- Queue/worker: backend-owned task queue state with signed OTA worker boundary and local dry-run fallback.
- Booking intelligence: backend scan engine creates trend alerts and in-app/email-intent notifications.

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
- API client/types: `src/lib/hotel-ops-api-client.ts`, `src/types/hotel-ops.ts`.
- Business and route smoke tests: `scripts/run-business-tests.mjs`, `scripts/run-e2e-tests.mjs`.

## Implemented Surface

- `/ops/chat`, `/ops/approvals`, `/ops/tasks`, `/ops/intelligence`, and `/ops/settings` render through the existing navigation shell.
- `/api/ops/commands`, task, approval, notification, intelligence, emergency-stop, OTA-status, and scan-run routes are implemented.
- High-risk task approval, denial, cancellation, alert recommendation, alert resolution, and emergency-stop mutations require reasons.
- Worker requests are signed, nonce-protected, credential-field rejected, and dry-run by default.
- Scheduler runs in-process interval scans only when `HOTEL_OPS_SCAN_INTERVAL_MINUTES` or `OPS_SCAN_INTERVAL_MINUTES` is positive.
- Cron expressions remain an external scheduler contract.

## Current Boundaries

- No raw OTA credentials are exposed to frontend, prompts, task records, notifications, or proof artifacts.
- Booking.com has a dry-run adapter skeleton with selector TODOs. Real browser writes remain disabled until selector and account-owner proof exists.
- Agoda, Trip.com, and Expedia currently use the signed mock worker path.
- Email notifications are recorded as provider-pending intents unless a real provider adapter is configured.
- The parser is deterministic and schema-shaped; there is no live OpenAI parser call in production code yet.
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
