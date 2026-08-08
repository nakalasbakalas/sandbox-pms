# Database Recovery Proof V2

Status: owner action required; restore drill not started.

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
| Disposable restore test date |  |  |  |
| Restore test target |  |  | Must not be production. |
| Restore test result |  |  |  |

Authenticated Render CLI evidence confirmed the production database is available and the current production service is live on deploy `dep-d9osmf9t0dsc73bphp80`, commit `6fea1ab8c00d2ca49d6a5ad44f2f559f31ea942a`. The CLI did not expose recovery-point or retention metadata. No restore was started.

## Migration safety

- [ ] `npx prisma migrate status` recorded for target.
- [ ] Rollback plan reviewed.
- [ ] Last known-good deploy ID recorded.
- [ ] Database shell was not opened against production except by approved owner action.
- [ ] DB-mutating E2E was not run against production.

## Result

- [ ] Passed
- [ ] Failed
- [x] Owner action required; no provider action or database mutation was attempted.

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
