# Slice 5AI Launch Evidence - Auth/RBAC Unauthenticated Refresh - 2026-07-03

Scope: refresh local auth/RBAC regression evidence and live unauthenticated protected API/page denial evidence.

Verdict: partial P0 progress only. Local auth/RBAC business tests passed, non-mutating E2E smoke passed on retry, and representative live protected API/page probes reject or gate unauthenticated access. This does not close production users/auth/RBAC/logout because no approved production user list, credentialed production login/logout, role-by-role matrix, underprivileged-role denial, or bootstrap-removal evidence was supplied.

This slice did not deploy, restart, SSH, open a production database shell, mutate production data, run DB-mutating E2E, perform credentialed production login, capture screenshots, or access secret values.

## Command Results

| Command | Result | Evidence summary |
| --- | --- | --- |
| `git rev-parse HEAD` | Passed | Local checkout is `fbc303136253a9785446d601d5532b6efc523b8f`. |
| `npm.cmd test` | Passed | Business rule tests passed. |
| First `npm.cmd run test:e2e` | Timed out | Timed out after about 184 seconds with no usable proof output. The orphaned `npm`, `scripts/run-e2e-tests.mjs`, and Vite validation processes started by this attempt were identified by command line and stopped. |
| Retry `npm.cmd run test:e2e` | Passed | Documentation link smoke, internal worker route smoke, Playwright browser smoke, and E2E contract/browser smoke checks passed. DB-mutating workflow E2E was not requested. |
| Node `fetch` unauthenticated API probe | Passed | Representative protected reads and mutations returned `401 Authentication is required.`; unauthenticated logout returned `200 ok=true`, which only proves the endpoint can clear a session cookie. |
| Headless Playwright protected-page probe with empty storage | Passed with deploy-drift note | Representative protected pages rendered a login form with one password input and no checked protected workspace terms. `/ops/settings` rendered `Page not found` and is treated as live deploy drift, not access proof. |

## Live Unauthenticated API Denial

Target: `https://book.sandboxhotel.com`. No cookies, credentials, session tokens, passwords, or database URLs were supplied.

| Method | Path | Status | Result |
| --- | --- | ---: | --- |
| GET | `/api/auth/me` | 401 | `ok=false`, `Authentication is required.` |
| POST | `/api/auth/logout` | 200 | `ok=true`; cookie-clear endpoint only, not credentialed logout proof. |
| GET | `/api/rooms` | 401 | `ok=false`, `Authentication is required.` |
| GET | `/api/reservations` | 401 | `ok=false`, `Authentication is required.` |
| POST | `/api/reservations` | 401 | `ok=false`, `Authentication is required.` |
| POST | `/api/payments` | 401 | `ok=false`, `Authentication is required.` |
| GET | `/api/users` | 401 | `ok=false`, `Authentication is required.` |
| GET | `/api/settings/room-setup` | 401 | `ok=false`, `Authentication is required.` |
| POST | `/api/ops/commands` | 401 | `ok=false`, `Authentication is required.` |

## Live Protected Page Gate

Target: `https://book.sandboxhotel.com`. Browser context used empty storage state.

| Path | HTTP status | Result |
| --- | ---: | --- |
| `/` | 200 | Login form visible; one password input; no checked protected workspace terms observed. |
| `/rooms` | 200 | Login form visible; one password input; no checked protected workspace terms observed. |
| `/reservations` | 200 | Login form visible; one password input; no checked protected workspace terms observed. |
| `/cashier` | 200 | Login form visible; one password input; no checked protected workspace terms observed. |
| `/housekeeping` | 200 | Login form visible; one password input; no checked protected workspace terms observed. |
| `/settings` | 200 | Login form visible; one password input; no checked protected workspace terms observed. |
| `/user-management` | 200 | Login form visible; one password input; no checked protected workspace terms observed. |
| `/ops/settings` | 200 | `Page not found`; no login form; treated as older-live-deploy route drift, not protected-page proof. |

## Evidence Decision

Unauthenticated live access remains blocked for representative API reads/mutations and gated for representative deployed protected pages. Local username-first auth/RBAC and route-contract checks remain green in the current checkout.

This still does not prove production role readiness. The missing proof requires approved credentials or owner-provided redacted evidence.

## Still Required To Close

- Redacted approved production user list with login identifiers and intended roles.
- Credentialed production login proof for required roles, without recording credentials or cookies.
- Credentialed production logout/session-clearing proof for at least one approved production user.
- Role-by-role production access matrix for admin, manager, front desk, housekeeping, cashier, and cafe roles as applicable.
- Protected production page/API denial for an underprivileged role.
- Bootstrap/setup-token/temporary access removal or rotation evidence.
