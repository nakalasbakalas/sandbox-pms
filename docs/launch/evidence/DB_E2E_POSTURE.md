# DB-Mutating E2E Posture

Last refreshed: 2026-07-03T11:36+07:00.

Verdict: green locally with caveat. The current checkout has guarded DB-mutating E2E proof against a disposable local database only. This is not production, staging, production room inventory, production user, or account-owner acceptance proof.

## Latest Evidence

| Date | Slice | Result | Evidence |
| --- | --- | --- | --- |
| 2026-07-03 | Slice 5AY - housekeeping sync and validation refresh | Passed locally with `ALLOW_DB_E2E=true` against local disposable `sandbox_hotel_e2e`. | [2026-07-03-slice-5ay-housekeeping-sync.md](2026-07-03-slice-5ay-housekeeping-sync.md) |
| 2026-07-03 | Slice 5AJ - core workflow local DB refresh | Passed locally with `ALLOW_DB_E2E=true` against local disposable `sandbox_hotel_e2e`. | [2026-07-03-slice-5aj-core-workflow-local-db-refresh.md](2026-07-03-slice-5aj-core-workflow-local-db-refresh.md) |
| 2026-07-03 | Slice 5AA - DB-mutating E2E posture refresh | Passed locally with `ALLOW_DB_E2E=true` against local disposable `sandbox_hotel_e2e`. | [2026-07-03-slice-5aa-db-e2e-posture-refresh.md](2026-07-03-slice-5aa-db-e2e-posture-refresh.md) |
| 2026-07-02 | Slice 1 - guarded DB-mutating E2E posture | Passed locally with caveats. | [2026-07-02-slice-1-db-e2e.md](2026-07-02-slice-1-db-e2e.md) |

## Guardrail

DB-mutating E2E may only run with:

- `ALLOW_DB_E2E=true`
- A safe disposable or staging `E2E_DATABASE_URL`
- No production database target

The latest July 3 refresh used the local disposable target redacted by tooling as `postgresql://sandbox:***@localhost:55432/sandbox_hotel_e2e?schema=public`.

## Latest July 3 Command Results

| Command | Result | Notes |
| --- | --- | --- |
| `$env:ALLOW_DB_E2E='true'; npm.cmd run db:e2e:ready` | Passed on 2026-07-03T11:36+07:00 | Prisma generated, 11 migrations checked with no pending migrations, and the E2E seed completed. |
| `$env:ALLOW_DB_E2E='true'; npm.cmd run test:e2e:db` | Passed on 2026-07-03T11:36+07:00 | Documentation link smoke, internal worker route smoke, Playwright browser smoke, guarded DB prep, and database workflow E2E passed. |

## Launch Boundary

This posture closes the local guard/evidence question for DB-mutating E2E in the current checkout. It does not close production launch sign-off because the remaining P0 blockers require live/account-owner proof for production users/auth/RBAC/logout, real room inventory, workflow acceptance, secret inventory/rotation, recovery ownership, and WAF/rate-limit configuration.
