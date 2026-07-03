# Auth, RBAC, Logout, and Unauthorized Access Proof

Status date: 2026-07-03.

Verdict: partial. Slice 5AI refreshed local auth/RBAC behavior, live unauthenticated API denial, and representative live protected-page login gating for this checkout/public target, but the production users/auth/RBAC/logout P0 is not closed. There is still no redacted approved production user list, credentialed production login/logout proof, role-by-role production matrix, underprivileged-role denial proof, or bootstrap/temporary-access removal proof.

## Scope

- Public target probed: `https://book.sandboxhotel.com`.
- Render context: `render whoami -o json` and `render services -o json` succeeded from the configured Render CLI session. The service inventory included the Sandbox PMS Render services; no raw database URLs, tokens, passwords, cookies, or secret values were printed or recorded.
- Credential posture: no production credentials, cookies, session tokens, passwords, or database URLs were supplied.
- DB posture: no DB-mutating E2E was run for this slice.

## Local Auth And RBAC Evidence

Command: `npm.cmd test`

Latest result: pass on 2026-07-03.

Observed output:

```text
Business rule tests passed
```

Relevant assertions covered by the business tests include:

- Server auth user mapping supports `User.username` as the login identifier.
- Username-only staff users can omit email and store `email=null`.
- Username-only and null-email user creation normalize backend roles and create audit records.
- Hotel Ops permission guards deny unknown/viewer roles and block forbidden/destructive commands.

Command: `npm.cmd run test:e2e`

Latest result: pass on retry on 2026-07-03. The first Slice 5AI attempt timed out after about 184 seconds and produced no usable proof output; the orphaned validation processes started by that attempt were identified and stopped before retrying.

Observed output:

```text
Documentation link smoke passed.
Internal worker route smoke passed.
Playwright browser smoke passed.
E2E contract and browser smoke checks passed.
Database-mutating workflow e2e not requested. Run npm run test:e2e:db with ALLOW_DB_E2E=true and E2E_DATABASE_URL set to a disposable/staging database.
```

Relevant assertions covered by the non-mutating E2E smoke include:

- Local browser login reaches the authenticated Today view.
- Browser login does not write a JavaScript-readable legacy session token.
- Front desk and housekeeping seeded users get expected route access/denial states for Hotel Ops routes.
- Server RBAC contract assertions cover admin, manager, front desk, housekeeping, and unknown-route denial.
- Protected API route contracts for auth, users, and Hotel Ops commands are present.

## Live Unauthenticated API Denial Evidence

Command: Node `fetch` probe against `https://book.sandboxhotel.com` without credentials or cookies.

Latest result: pass on 2026-07-03.

| Method | Path | Status | Response |
| --- | --- | ---: | --- |
| GET | `/api/auth/me` | 401 | `ok=false`, `Authentication is required.` |
| POST | `/api/auth/logout` | 200 | `ok=true` |
| GET | `/api/rooms` | 401 | `ok=false`, `Authentication is required.` |
| GET | `/api/reservations` | 401 | `ok=false`, `Authentication is required.` |
| POST | `/api/reservations` | 401 | `ok=false`, `Authentication is required.` |
| POST | `/api/payments` | 401 | `ok=false`, `Authentication is required.` |
| GET | `/api/users` | 401 | `ok=false`, `Authentication is required.` |
| GET | `/api/settings/room-setup` | 401 | `ok=false`, `Authentication is required.` |
| POST | `/api/ops/commands` | 401 | `ok=false`, `Authentication is required.` |

Interpretation:

- Live protected reads and mutations rejected unauthenticated callers with `401 Authentication is required.`.
- The unauthenticated `/api/auth/logout` response only proves the endpoint is callable to clear a session cookie. It does not prove credentialed production logout for an approved production user.

## Live Unauthenticated Protected Page Evidence

Command: headless Playwright probe against `https://book.sandboxhotel.com` with empty browser storage state.

Latest result: pass for representative deployed protected pages on 2026-07-03.

| Path | Status | Result |
| --- | ---: | --- |
| `/` | 200 | Login form visible; one password input; no protected workspace terms observed. |
| `/rooms` | 200 | Login form visible; one password input; no room/workspace terms observed. |
| `/reservations` | 200 | Login form visible; one password input; no reservation/workspace terms observed. |
| `/cashier` | 200 | Login form visible; one password input; no cashier/payment/folio terms observed. |
| `/housekeeping` | 200 | Login form visible; one password input; no housekeeping-board terms observed. |
| `/settings` | 200 | Login form visible; one password input; no settings/workspace terms observed. |
| `/user-management` | 200 | Login form visible; one password input; no user-management terms observed. |

Route drift:

- `/ops/settings` returned `200` but rendered `Page not found`, so it is not counted as protected-page access proof for the older live deploy.
- The live login label is still `Email address`, while the current checkout uses username-first copy. This is deploy-drift evidence, not a failure of unauthenticated page gating.

Canonical evidence:

- `docs/launch/evidence/2026-07-03-slice-5ai-auth-rbac-unauth-refresh.md`
- `docs/launch/evidence/2026-07-02-slice-5z-live-protected-page-gate.md`

## Implementation Checks Used For Interpretation

- `server/index.mjs` has `requireUser()` behind protected API routes and raises `401 Authentication is required.` when the session cookie is missing or invalid.
- `server/index.mjs` implements `/api/auth/logout` by returning `ok=true` with a cleared session cookie.
- `server/rbac.mjs` defines the backend role-permission map and denies unknown routes by default.
- `server/security.mjs` creates `HttpOnly`, `SameSite=Lax` session cookies and adds `Secure` in production.

## Rejected Non-Evidence

An initial PowerShell probe using `[System.Net.Http.HttpClient]` failed because that type was unavailable in this PowerShell session. It produced no usable HTTP status proof and was not used for the verdict.

## Still Required To Close P0

- Redacted approved production user list, including login identifiers and intended roles.
- Credentialed production login proof for each required role, without recording credentials or cookies.
- Credentialed production logout/session-clearing proof for at least one approved production user.
- Production role matrix proof showing intended access and denial for admin/manager/front desk/housekeeping/cashier/cafe roles as applicable.
- Protected production page denial proof for an underprivileged role; unauthenticated representative page-gating proof is now recorded separately.
- Protected production API mutation denial proof for an underprivileged role.
- Bootstrap/setup-token/temporary access removal or rotation evidence.
