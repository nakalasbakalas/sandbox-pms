# Command Evidence V2

Status: open.

Record current command proof from a clean checkout of the exact deploy candidate. Do not paste secrets, raw database URLs, cookies, tokens, passwords, raw guest data, payment references, or raw mailbox content.

## Candidate

| Item | Value |
| --- | --- |
| Commit SHA |  |
| Branch/tag |  |
| Deploy ID |  |
| Host |  |
| Tester |  |
| Date/time |  |
| Working tree clean? |  |
| Node version |  |
| npm version |  |

## Required command results

| Command | Required? | Status | Redacted evidence location / notes |
| --- | --- | --- | --- |
| `npm run remediation:check` | Yes | Open |  |
| `npm run typecheck` | Yes | Open |  |
| `npm run lint` | Yes | Open |  |
| `npm test` | Yes | Open |  |
| `npm run test:e2e` | Yes | Open |  |
| `npm run build` | Yes | Open |  |
| `npm run prod:preflight` | Yes | Open |  |
| `npm run render:validate` | Yes | Open |  |
| `npm run live:check` | Yes | Open |  |
| `npm run public-edge:proof` | Yes | Open |  |
| `npm audit --audit-level=high` | Yes | Open |  |
| `npx prisma migrate status` | Yes | Open |  |

## Guarded DB-mutating E2E

Production DB-mutating E2E remains forbidden.

| Command | Target DB classification | Status | Notes |
| --- | --- | --- | --- |
| `npm run db:e2e:ready` with `ALLOW_DB_E2E=true` | Disposable/staging only | Open |  |
| `npm run test:e2e:db` with `ALLOW_DB_E2E=true` | Disposable/staging only | Open |  |

## Conclusion

- [ ] Passed for full production sign-off.
- [ ] Failed; blockers listed below.
- [ ] Owner-accepted pilot only; full sign-off deferred.

## Blockers / accepted risks

| Item | Owner | Expiry/review date | Workaround | Customer/staff impact |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |
