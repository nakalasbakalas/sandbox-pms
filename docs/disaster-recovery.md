# Disaster Recovery And Rollback

This document defines the owner actions required before production launch sign-off. It records procedures, not secret values.

## Current Confirmed State

- Production database: Render PostgreSQL `sandbox-hotel-pms-db-v43m`.
- Public runtime: `https://book.sandboxhotel.com`.
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
