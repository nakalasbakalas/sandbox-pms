# Database Recovery Proof V2

Status: Render/provider restore owner-deferred; local synthetic disposable restore passed on 2026-08-08.

## Environment

- Commit SHA: local candidate `d5631a1`
- Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`)
- Render database: `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`)
- Test date/time: authenticated inventory/deploy inspection on 2026-08-08
- Owner: Nick (owner/admin; recovery approval still required)
- Deputy:

## Backup/recovery evidence

| Item | Value | Evidence location | Notes |
| --- | --- | --- | --- |
| Latest backup/recovery point timestamp |  |  |  |
| Retention window |  |  |  |
| Backup provider/source | Render Postgres |  |  |
| Restore owner has dashboard access |  |  |  |
| Deputy has dashboard access |  |  |  |
| Disposable restore test date | 2026-08-08 | Local Docker/Prisma drill | Provider restore explicitly skipped by owner for now. |
| Restore test target | Local temporary Docker PostgreSQL `sandbox_hotel_recovery_drill` | Redacted local proof output | Created with isolated temporary storage; not production. |
| Restore test result | PASS, local synthetic source only | Aggregate reconciliation and deep-health result below | Temporary target, dump, and server process removed after proof. |

Authenticated Render CLI evidence confirmed the production database is available and the current production service is live on deploy `dep-d9osmf9t0dsc73bphp80`, commit `6fea1ab8c00d2ca49d6a5ad44f2f559f31ea942a`. The CLI did not expose recovery-point or retention metadata. No restore was started.

## Local fallback drill

- Candidate: `820bf244569b2873915650af107a98c3a7e1b8ad`
- Source: localhost `sandbox_hotel_e2e`, classified synthetic/disposable
- Target: uniquely named temporary Docker PostgreSQL instance containing `sandbox_hotel_recovery_drill`
- Dump/restore duration: 17.8 seconds
- Prisma migration status: up to date
- Candidate deep health: `ok=true`, production-mode configuration, database configured and healthy
- Cleanup: temporary server stopped; Docker target and temporary dump directory removed

| Aggregate | Source | Restored |
| --- | ---: | ---: |
| Properties | 14 | 14 |
| Room types | 8 | 8 |
| Rooms | 42 | 42 |
| Guests | 69 | 69 |
| Reservations | 63 | 63 |
| Folios | 63 | 63 |
| Charges | 75 | 75 |
| Payments | 12 | 12 |
| Room-date inventory | 32 | 32 |
| Audit logs | 265 | 265 |

All recorded aggregates matched. This proves local dump/restore mechanics and candidate compatibility only. It does not prove Render recovery-point freshness, retention, provider restore permissions, owner/deputy readiness, or production recovery time.

## Migration safety

- [x] `npx prisma migrate status` recorded for the local restored target.
- [ ] Rollback plan reviewed.
- [x] Last known-good production deploy ID recorded.
- [x] Database shell was not opened against production.
- [x] DB-mutating E2E and the recovery drill were not run against production.

## Result

- [ ] Passed
- [ ] Failed
- [x] Render/provider recovery remains owner-deferred; the explicitly authorized local fallback drill passed.

```text
OWNER ACTION REQUIRED
Gate: DISPOSABLE DATABASE RESTORE
Required inputs:
- owner approval for Render/provider recovery actions
- current backup/recovery point and retention window
- named recovery owner and rollback deputy with dashboard access
- latest known-good deploy ID
- approved disposable database/service target and deletion owner
Execution:
- restore only to the disposable target, verify/apply migrations, start the exact candidate, run deep health, and compare only the aggregate counts listed in docs/finish/CODEX_FINISH_PACKET.md F12
- save redacted timestamps, duration, aggregate reconciliation, and result before destroying the disposable restore
Stop condition:
- do not run against production and do not continue provider actions until the above inputs and approval are supplied
```
