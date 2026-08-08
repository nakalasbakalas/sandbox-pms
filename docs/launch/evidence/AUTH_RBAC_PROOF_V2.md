# Auth/RBAC Proof V2

Status: owner action required; harness ready, credentialed proof not run.

## Scope

Credentialed proof for production/staging staff access. Do not record passwords, session cookies, tokens, or screenshots containing secrets.

## Environment

- Commit SHA: local harness candidate `792deff`
- Deploy ID: not supplied
- Host: proposed/default `https://book.sandboxhotel.com`; owner must confirm target
- Test date/time: 2026-08-08 Asia/Bangkok (harness validation only)
- Tester: Codex coordinator

## Approved user matrix

| User label | Role | Email/username present? | Active? | Login result | Logout result | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Owner/admin | ADMIN | approved label only | unverified | not run | not run | ignored template has no credential |
| Manager | MANAGER | approved label only | unverified | not run | not run | ignored template has no credential |
| Front desk | FRONT_DESK | approved label only | unverified | not run | not run | ignored template has no credential |
| Housekeeping | HOUSEKEEPING | missing | unverified | not run | not run | owner must supply dedicated approved account |
| Cashier | CASHIER | missing | unverified | not run | not run | owner must supply dedicated approved account |

## Route access matrix

| Route | Admin | Manager | Front desk | Housekeeping | Cashier | Expected result notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/` / Today |  |  |  |  |  |  |
| `/board` |  |  |  |  |  |  |
| `/rooms` |  |  |  |  |  |  |
| `/front-desk` |  |  |  |  |  |  |
| `/reservations` |  |  |  |  |  |  |
| `/housekeeping` |  |  |  |  |  |  |
| `/tablet-housekeeping` |  |  |  |  |  |  |
| `/cashier` |  |  |  |  |  |  |
| `/rates` |  |  |  |  |  |  |
| `/settings` |  |  |  |  |  |  |
| `/user-management` |  |  |  |  |  |  |

## API denial probes

| Probe | User/session | Expected | Actual | Pass? |
| --- | --- | --- | --- | --- |
| Unauthenticated `GET /api/reservations` | none | 401 |  |  |
| Unauthorized settings mutation | non-admin | 403 |  |  |
| Unauthorized user management route/action | non-admin | 403 |  |  |

## Result

- [ ] Passed
- [ ] Failed
- [x] Owner action required; no credentialed session was attempted.

## Harness readiness

- Expected roles are required and verified against `/api/auth/me`.
- `--require-finish-matrix` requires exactly one ADMIN, MANAGER, FRONT_DESK, HOUSEKEEPING, and CASHIER before any login request.
- Safe authenticated access probes support recursive forbidden-response-field assertions without printing response bodies.
- Denial probes remain GET/HEAD by default; mutating denial probes require the explicit owner-approved flag.
- Login identifiers are masked; passwords and cookies are never printed or persisted by the helper.
- Local three-attempt lockout behavior is covered by `scripts/run-business-tests.mjs`. A live lockout exercise is intentionally not automated because it can strand an operational account.

```text
OWNER ACTION REQUIRED
Gate: AUTH/RBAC
Required inputs:
- approved test account for each role: ADMIN, MANAGER, FRONT_DESK, HOUSEKEEPING, CASHIER
- credentials supplied only in .codex/auth-proof-users.local.json or stdin
- approved target host
- safe access/denial probes and forbidden response-field list for each role
- for live lockout/throttle proof: a dedicated non-operational account, named reset owner, and approved reset procedure
Command:
- npm.cmd run auth-rbac:proof -- --users-file .\.codex\auth-proof-users.local.json --require-finish-matrix
Expected redacted artifact:
- JSON with masked login labels, verified roles, status codes, forbidden-field check names, logout results, and no passwords/cookies/tokens/raw response bodies
```
