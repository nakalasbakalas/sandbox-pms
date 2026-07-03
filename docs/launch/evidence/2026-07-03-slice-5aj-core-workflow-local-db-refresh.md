# Slice 5AJ - Core Workflow Local DB Refresh

Date: 2026-07-03T08:40+07:00

Verdict: partial P0 progress. Core PMS workflow E2E passed again in the current checkout against the local disposable `sandbox_hotel_e2e` database with `ALLOW_DB_E2E=true`. This is not staging, production, real room inventory, production user, or account-owner manual acceptance proof.

Local HEAD: `fbc303136253a9785446d601d5532b6efc523b8f`

Scope boundary:

- No deploy, restart, SSH session, Render database shell, production database mutation, credentialed production login, secret-value access, or screenshot capture was performed.
- DB-mutating E2E was run only against `localhost:55432/sandbox_hotel_e2e` with the URL redacted in evidence.
- This slice does not mark the launch checklist `Hotel Workflows` items complete because the launch packet still requires staging, controlled production-like, or owner-accepted manual evidence for final sign-off.

## Commands

| Command | Result | Evidence |
| --- | --- | --- |
| `$env:ALLOW_DB_E2E='true'; $env:E2E_DATABASE_URL='postgresql://sandbox:***@localhost:55432/sandbox_hotel_e2e?schema=public'; npm.cmd run db:e2e:ready` | Passed | Prisma generated, 11 migrations found, no pending migrations, and `SEED_MODE=e2e` seeded local/e2e room inventory plus one database user. |
| `$env:ALLOW_DB_E2E='true'; $env:E2E_DATABASE_URL='postgresql://sandbox:***@localhost:55432/sandbox_hotel_e2e?schema=public'; npm.cmd run test:e2e:db` | Passed | Documentation link smoke, internal worker route smoke, Playwright browser smoke, guarded DB prepare/seed, and database workflow E2E passed. Output ended with `Database workflow e2e passed.` |

## Workflow Coverage From This Run

The DB workflow E2E in `scripts/run-e2e-tests.mjs` exercised these persisted backend paths:

- Finds a sellable `TWIN` room from the disposable E2E room inventory.
- Creates a future direct reservation with valid dates through `createReservation`.
- Assigns a clean sellable room through `assignRoom` and asserts the assigned room persisted.
- Checks the reservation in through `checkInReservation`, including guest identity details and a cash payment for the folio balance.
- Asserts check-in persisted as `CHECKED_IN` and the folio balance became `0`.
- Checks the reservation out through `checkOutReservation` and asserts `CHECKED_OUT`.
- Cancels the reservation during cleanup with a bounded E2E marker.
- Exercises Hotel Ops command submission, owner approval, signed worker execution, scan snapshot persistence, emergency-stop write blocking, and audit-log assertions in the same disposable DB run.

## Acceptance Boundary

This refresh strengthens local evidence for the core workflow path but does not close the P0 launch blocker alone. Final launch sign-off still needs staging or controlled production-like/manual acceptance covering real operational users and inventory, or a recorded owner decision accepting local-only proof with its limitation.

## Remaining P0 Blockers After This Slice

- Production users/auth/RBAC/logout/unauthorized-access proof remains open for approved users and credentialed role testing.
- Live first-run setup completion gate still needs PR #150 approval, deployment of the reviewed commit, and public reprobe.
- Real production room inventory proof remains open.
- Core hotel workflow acceptance remains open for staging, controlled production-like, or account-owner manual proof.
- Live secret key inventory/rotation metadata, rollback/deputy/database recovery owners, and WAF/rate-limit rule IDs remain open.
