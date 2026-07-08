# Database Recovery Proof V2

Status: open.

## Environment

- Commit SHA:
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
- [ ] Accepted risk with owner/date/expiry:
