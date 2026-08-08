# Database Recovery Proof V2

Status: owner action required; restore drill not started.

## Environment

- Commit SHA: local candidate `12d9572`
- Render service:
- Render database:
- Test date/time:
- Owner:
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
