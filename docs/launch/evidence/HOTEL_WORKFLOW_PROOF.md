# Hotel Workflow Proof

Date: 2026-07-02T07:26Z.

Verdict: partial. Core hotel workflow logic and guarded DB workflow E2E passed in the current checkout against a local disposable E2E database. This is not production, staging, or account-owner manual acceptance proof.

This slice did not deploy, restart, SSH, open a production database shell, mutate production data, run DB-mutating E2E against production, or access secret values.

## Commands

| Command | Result | Notes |
| --- | --- | --- |
| `npm.cmd test` | Passed | `Business rule tests passed`. Covers room assignment, check-in/out guards, payment summaries, housekeeping transitions, role/action guards, and audit-oriented service behavior. |
| `$env:ALLOW_DB_E2E='true'; $env:E2E_DATABASE_URL='postgresql://sandbox:***@localhost:55432/sandbox_hotel_e2e?schema=public'; npm.cmd run db:e2e:ready` | Passed | Prepared local disposable E2E database. Prisma generated, 11 migrations found, no pending migrations, seed ran in `e2e` mode, and local/e2e room inventory plus one database user were seeded. |
| `$env:ALLOW_DB_E2E='true'; $env:E2E_DATABASE_URL='postgresql://sandbox:***@localhost:55432/sandbox_hotel_e2e?schema=public'; npm.cmd run test:e2e:db` | Passed | Documentation link smoke, internal worker route smoke, Playwright browser smoke, guarded E2E database prepare/seed, and database workflow E2E passed. Output ended with `Database workflow e2e passed.` |

The E2E database URL used `localhost:55432/sandbox_hotel_e2e` and was redacted in command output. No production database URL was used.

## Acceptance Matrix

| Flow | Current evidence | Status |
| --- | --- | --- |
| Create reservation succeeds with valid dates | `test:e2e:db` creates a future `TWIN` reservation through `createReservation` against the disposable DB. | Local proof passed. |
| Update reservation persists and creates audit/timeline evidence | `npm.cmd test` exercises update-reservation business behavior; service code audits `MODIFIED` reservation changes. | Local logic proof passed; no fresh staging/manual proof. |
| Cancel reservation changes status and creates audit/timeline evidence | `test:e2e:db` calls `cancelReservation(..., 'CANCELLED', 'E2E cleanup marker')`; service code audits cancellation status. | Local cleanup path exercised; no fresh staging/manual proof. |
| Invalid date range is rejected with user-safe error | `npm.cmd test` covers date/night validation and check-in date guard behavior. | Local logic proof passed; no fresh staging/manual proof. |
| Assign room rejects unsafe rooms | `npm.cmd test` covers clean sellable assignment plus out-of-service, dirty, occupied, and no-room check-in blockers; `test:e2e:db` persists assignment with `assignRoom`. | Local proof passed. |
| Overbooking is rejected by room type and assigned room | Existing business rules cover room assignment safety and sellable inventory constraints; no fresh dedicated overbooking DB assertion was added in this slice. | Partial local proof; staging/manual proof still needed. |
| Check-in requires valid assigned room and marks room occupied | `npm.cmd test` covers no-room and room-readiness blockers; `test:e2e:db` checks `checkInReservation` persists `CHECKED_IN`. | Local proof passed. |
| Checkout requires settlement or override and marks room dirty | `npm.cmd test` covers unsettled-balance checkout blocker and dirty room handoff; `test:e2e:db` checks `checkOutReservation` persists `CHECKED_OUT`. | Local proof passed. |
| Payment updates folio paid/balance status | `npm.cmd test` covers payment summary and overpayment validation; `test:e2e:db` settles the folio at check-in and asserts balance `0`. | Local proof passed. |
| Housekeeping supports dirty -> cleaning -> clean/inspected | `npm.cmd test` covers `VACANT_DIRTY` -> `CLEANING` -> `INSPECTED`/`VACANT_CLEAN` transition behavior. | Local logic proof passed; no fresh staging/manual proof. |
| Critical mutations create audit/timeline evidence | Service code audits reservation create/update/assign/check-in/check-out/cancel, payment, charge, and housekeeping mutations; `test:e2e:db` freshly verifies Hotel Ops audit records. | Partial local proof; broader staging/manual PMS audit review still needed. |

## Evidence Decision

This closes a local/disposable proof gap for the core backend workflow path in the current checkout. It does not close the P0 launch blocker by itself because the launch packet asks for operational acceptance evidence, and this run did not verify the workflow against staging, controlled production-like data, or account-owner manual acceptance.

## Remaining P0 Blockers

- Core hotel workflow acceptance remains open for staging or controlled production-like/manual proof.
- Real production room inventory proof remains open.
- Live setup-completion hardening still needs review/approval, deployment of the exact reviewed commit, and public unauthenticated setup-complete reprobe.
- Production users/auth/RBAC/logout proof remains open.
- Live provider secret inventory/rotation metadata and recovery ownership proof remain external/account-owner evidence gaps.
- Rollback owner/deputy, database recovery owner, and WAF/rate-limit rule evidence remain unproven.

## Next Recommended Slice

Run credentialed staging or controlled production-like manual workflow acceptance after real room inventory and approved users are available. If PR #150 is approved first, deploy the exact reviewed commit and reprobe the live setup-complete gate.
