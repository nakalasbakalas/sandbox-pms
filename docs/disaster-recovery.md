# Disaster Recovery And Rollback

This document defines the owner actions required before production launch sign-off. It records procedures, not secret values.

## Current Confirmed State

- Production database: Render PostgreSQL `sandbox-hotel-pms-db-v43m`.
- Public runtime: `https://book.sandboxhotel.com`.
- Current public Render service confirmed on 2026-07-14: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`).
- Current live deploy confirmed on 2026-07-14: `dep-d966aj9kh4rs73d9h10g`, commit `d18ea06eb974621281c43a57cf4d5a41994c2775`.
- The separate `sandbox-hotel-pms` service is older/stale and is not the current public runtime. Never use its deploy history as the rollback source for `sandbox-hotel-pms-v43m`.
- Historical Render recovery evidence from 2026-06-07 is retained in the proof register, but it predates the Lite exact-money migrations and is not current recovery proof.
- A fresh recovery point and a new disposable restore against the exact pre-cutover production state remain required before any Lite money migration or cutover.
- Automated public health check: `npm run live:check`.
- Local release gate: `npm run launch:check`.

## Required Owner Assignments

Record these in the live proof register before launch:

- Primary rollback owner with Render dashboard access: Nick.
- Rollback deputy with Render dashboard access: not assigned; this is an explicit follow-up or accepted-risk item before sign-off.
- Database recovery owner with Render PostgreSQL access: Nick.
- WAF/rate-limit owner with Cloudflare or upstream edge access: Nick.

The confirmed Render workspace owner from CLI is `nakalastravels@gmail.com`; do not treat that as a complete operational roster until a deputy is named.

## Backup Evidence

Latest known owner answer as of 2026-07-06: the current backup/recovery point is unknown. Set up or freshly verify recovery proof before migrations, seed changes, or launch sign-off:

1. Open the Render PostgreSQL dashboard for `sandbox-hotel-pms-db-v43m`.
2. Record the latest available recovery point and retention window in [live-environment-proof.md](live-environment-proof.md) and `docs/launch/evidence/SECRETS_AND_RECOVERY_PROOF.md`.
3. Confirm the database is `available`.
4. Do not paste database URLs, passwords, or raw backup metadata containing secrets into tracked files.

## Restore Test

A restore test must use a disposable database, never the live production database.

Historical status: a disposable restore test passed on 2026-06-07 and its temporary database was deleted. That test does not close the Lite gate because it predates the current service/deploy and exact-money migrations. Run and record a fresh disposable restore before Lite production migration or cutover. The historical evidence is in [live-environment-proof.md](live-environment-proof.md).

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
