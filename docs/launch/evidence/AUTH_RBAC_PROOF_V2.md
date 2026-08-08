# Auth/RBAC Proof V2

Status: owner action required; first credentialed attempt stopped on Admin HTTP 429 before the remaining roles were tested.

## Scope

Credentialed proof for production/staging staff access. Do not record passwords, session cookies, tokens, or screenshots containing secrets.

## Environment

- Commit SHA: local candidate `d5631a1` (harness introduced at `792deff`)
- Deploy ID: production currently `dep-d9osmf9t0dsc73bphp80` on `6fea1ab`; candidate is not deployed
- Host: proposed/default `https://book.sandboxhotel.com`; owner must confirm target
- Test date/time: 2026-08-08 Asia/Bangkok; one live login attempt, then stop
- Tester: Codex coordinator

## Approved user matrix

| User label | Role | Email/username present? | Active? | Login result | Logout result | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Nick | ADMIN | supplied out of band; not persisted | unverified | 429, stopped | not run | reset/unlock required before one bounded retry |
| Hotel Manager | MANAGER | supplied out of band; not persisted | unverified | not run | not run | skipped after Admin throttle/lockout response |
| Front Desk | FRONT_DESK | supplied out of band; not persisted | unverified | not run | not run | skipped after Admin throttle/lockout response |
| House Keeping | HOUSEKEEPING | supplied out of band; not persisted | unverified | not run | not run | skipped after Admin throttle/lockout response |
| Cashier | CASHIER | supplied out of band; not persisted | unverified | not run | not run | skipped after Admin throttle/lockout response |

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
- [x] Owner action required; Admin login returned 429 before a session was created, so no further role login or logout was attempted.

The helper retained no password, cookie, token, username, or response body. The interactive wrapper and temporary redacted/state files were removed after recording this bounded result. Do not retry until another Admin has reset/unlocked Nick or the owner confirms the applicable throttle has cleared.

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
- another Admin resets/unlocks Nick and confirms the account is ready
- approved test account for each role: ADMIN, MANAGER, FRONT_DESK, HOUSEKEEPING, CASHIER (already supplied out of band for this attempt)
- credentials supplied through secure interactive stdin; do not place them in files or command arguments
- approved target host
- safe access/denial probes and forbidden response-field list for each role
- for live lockout/throttle proof: a dedicated non-operational account, named reset owner, and approved reset procedure
Command:
- npm.cmd run auth-rbac:proof -- --users-file .\.codex\auth-proof-users.local.json --require-finish-matrix
Expected redacted artifact:
- JSON with masked login labels, verified roles, status codes, forbidden-field check names, logout results, and no passwords/cookies/tokens/raw response bodies
```
