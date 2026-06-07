# Disaster Recovery And Rollback

This document defines the owner actions required before production launch sign-off. It records procedures, not secret values.

## Current Confirmed State

- Production database: Render PostgreSQL `sandbox-hotel-pms-db-v43m`.
- Public runtime: `https://book.sandboxhotel.com`.
- Long-term production Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`).
- Latest known-good live deploy: `dep-d8ekncs2m8qs7391cvig`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished at 2026-06-01T09:09:36Z.
- Render Postgres point-in-time recovery status: `AVAILABLE`, with recovery starting at 2026-06-03T21:59:41Z during the 2026-06-07 provider check.
- Disposable restore test: passed on 2026-06-07 using temporary restored database `dpg-d8ip6rdckfvc73c2qirg-a`, then deleted.
- Automated public health check: `npm run live:check`.
- Local release gate: `npm run launch:check`.

## Required Owner Assignments

Record these in the live proof register before launch:

- Primary rollback owner with Render dashboard access.
- Rollback deputy with Render dashboard access.
- Database recovery owner with Render PostgreSQL access.
- WAF/rate-limit owner with Cloudflare or upstream edge access.

The confirmed Render workspace owner from CLI is `nakalastravels@gmail.com`; do not treat that as a complete operational roster until a deputy is named.

## Backup Evidence

Before migrations, seed changes, or launch sign-off:

1. Open the Render PostgreSQL dashboard for `sandbox-hotel-pms-db-v43m`.
2. Record the latest available recovery point and retention window in [live-environment-proof.md](live-environment-proof.md).
3. Confirm the database is `available`.
4. Do not paste database URLs, passwords, or raw backup metadata containing secrets into tracked files.

## Restore Test

A restore test must use a disposable database, never the live production database.

Status as of 2026-06-07T15:57Z: a disposable restore test passed. The temporary restored database was deleted after validation. The full evidence record is in [live-environment-proof.md](live-environment-proof.md).

Record:

- Tester.
- Date and time.
- Source recovery point.
- Restore target.
- Validation command or query.
- Result.

Minimum validation after restore:

```bash
npm run db:generate
npm run db:doctor
```

If a restored database is used for E2E, set `ALLOW_DB_E2E=true` and `E2E_DATABASE_URL` to the disposable restore target only.

## Application Rollback

For app regressions:

1. Identify the latest known-good Render deploy ID.
2. Roll back from the Render service dashboard.
3. Run `npm run live:check`.
4. Confirm `/healthz?deep=1` reports `database.ok=true`.
5. Record the rollback owner, deploy ID, timestamp, and result.

For schema changes, review the Prisma migration before app rollback. Do not run destructive database edits without a current backup/recovery point and owner approval.
