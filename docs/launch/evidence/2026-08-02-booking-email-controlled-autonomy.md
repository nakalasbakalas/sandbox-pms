# Booking Email Controlled Autonomy - Local Engineering Evidence

Date: 2026-08-02 (Asia/Bangkok)

Status: **local engineering candidate; not deployed, owner-approved, staging-proven, or provider-proven.**

## Scope implemented

- Gmail polling defaults to 30 seconds when near-live sync is enabled.
- Each message retains raw content/headers plus deterministic `parsedDetails` and `automationDecision` JSON.
- Autonomous PMS writes are double opt-in and disabled by default.
- Only authenticated, trusted-domain, high-confidence `NEW_BOOKING` events can be created automatically.
- The external OTA room label must resolve through one active property/provider channel mapping with explicit PMS room ids.
- Room availability is checked with the authoritative assignment validator and the mapped room is assigned during the reservation transaction.
- Consistent same-reference messages can corroborate extraction; contradictory evidence blocks automation.
- Existing or duplicate reservations are linked instead of recreated.
- Low-confidence, conflicting, unmapped, or otherwise blocked events remain in review and create at most one in-app manager notification.
- Trip.com is represented consistently as `TRIP` in booking-source and channel-provider records.
- Cancellation, modification, payment, guest-message, unknown, historical backfill, and reprocess paths remain review-gated.

## Local validation

Passed in the dirty local checkout on branch `codex/bookinginbox`, based on commit `15880efd64ad0c5f5a412546eeb8d81e95cd8d35`:

- `node --check server/pms-service.mjs`
- `node --check server/ops-scheduler.mjs`
- `node --check server/ical-feed.mjs`
- `npm.cmd run db:generate`
- `npx.cmd prisma validate` with a non-secret placeholder `DATABASE_URL`
- `npm.cmd run typecheck`
- `node scripts/run-channel-sync-tests.mjs`
- `node scripts/run-business-tests.mjs`
- `npm.cmd run lint`
- `npm.cmd test`
- `npm.cmd run build`
- `npm.cmd run test:e2e`
- `npm.cmd run render:validate`
- `npm.cmd run launch:evidence`
- `git diff --check`

The non-database E2E run passed documentation-link, internal-worker-route, API-contract, and Playwright browser smoke checks.

## Unverified boundary

The new disposable-database acceptance cases cover automatic creation, mapped room assignment, Trip.com source preservation, decision evidence, manager notification, and replay idempotency. They were not executed in this pass because Docker Desktop was not running and PostgreSQL at `localhost:55432/sandbox_hotel_e2e` was unavailable. No database migration was applied to staging or production.

## Required before activation

1. Start the disposable PostgreSQL environment and pass the guarded database-mutating suite with `ALLOW_DB_E2E=true` and the non-production `E2E_DATABASE_URL`.
2. Review and complete every live OTA room label mapping, including explicit operational room ids.
3. Approve the exact provider sender domains and verify real Gmail `Authentication-Results` behavior.
4. Perform manager/front-desk acceptance for the Booking Inbox, notifications, and booking-board room placement.
5. Apply the migration through the normal reviewed release path and deploy the exact validated revision.
6. Enable the global autonomy switch and each source separately, beginning with controlled live observation and emergency-stop readiness.
