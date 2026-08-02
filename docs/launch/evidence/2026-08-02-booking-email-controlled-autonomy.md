# Booking Email Controlled Autonomy - Local Engineering Evidence

Date: 2026-08-02 (Asia/Bangkok)

Status: **local engineering and disposable-database proven; not deployed, owner-approved, staging-proven, or production-enabled.**

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

Passed on branch `codex/bookinginbox` at commit `3a42123522a61e72b3a5e0ab1ba8a94d66f66bc6`:

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
- guarded `npm.cmd run test:e2e:db` with separate local development and disposable E2E databases
- `npm.cmd run launch:check`
- `git diff --check`

The guarded database suite passed booking workflow, release-foundation, cashier-projection, and autonomy isolation/idempotency coverage. The new migration applied successfully to both local development and disposable E2E databases. The full launch gate passed database doctor, migration status, lint, typecheck, unit/contract tests, non-database E2E, production build, and high-severity dependency audit.

## Live read-only readiness inspection

- The Gmail connector profile is `booking@sandboxhotel.com`.
- Bounded Gmail searches found current provider traffic from the `booking.com`, `agoda.com`, and `trip.com` domain families. No subjects, bodies, message ids, guest data, or payment data were recorded in this evidence.
- Render CLI is authenticated to the intended workspace. Canonical production service `sandbox-hotel-pms-v43m` uses branch `main`, migration-only predeploy, and managed PostgreSQL `sandbox-hotel-pms-db-v43m`.
- Redacted Render status reports the booking-specific Gmail OAuth refresh-token tuple ready. Values were not printed.
- Production remains on the previous release. No production migration, deployment, source opt-in, or autonomous reservation write was performed at the time of this record.

## Required before activation

1. Review and complete every live OTA room label mapping, including explicit operational room ids.
2. Configure the observed approved sender-domain families; keep aligned Gmail authentication evidence mandatory.
3. Apply the migration through the normal reviewed release path and deploy the exact validated revision with global autonomy disabled.
4. Observe near-live ingestion and perform manager/front-desk acceptance for the Booking Inbox, notifications, and booking-board room placement.
5. Enable the global autonomy switch and each source separately only after the corresponding live mapping and parser evidence is accepted.
