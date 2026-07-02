# Slice 2 Launch Evidence - Live Unauthenticated Auth Denial And Setup Gate - 2026-07-02

Scope: gather non-destructive live auth denial proof for representative protected endpoints, identify setup-gate behavior, and harden the current checkout without using production credentials. This slice does not prove credentialed login, logout after a real session, role-by-role RBAC, approved production users, or production sign-off.

## Live Target

- Target: `https://book.sandboxhotel.com`.
- Probe style: no valid cookies, no credentials, no production session state, empty JSON bodies for mutation endpoints.
- Safety boundary: mutation probes were expected to fail at authentication before handler execution.

## Live Probe Results

| Probe | Result | Evidence summary |
| --- | --- | --- |
| `GET /api/auth/me` without cookie | Passed | Returned `401 Authentication is required.` |
| `GET /api/auth/me` with invalid `pms_session=a.b` | Passed | Returned `401 Authentication is required.` |
| `GET /api/auth/can-view?route=settings` without cookie | Passed | Returned `401 Authentication is required.` |
| `POST /api/auth/logout` without cookie | Passed with limited scope | Returned `200` and a clearing `Set-Cookie` header for `pms_session`; this proves the logout endpoint emits a clearing cookie, not that a real production session was invalidated. |
| Protected read APIs without cookie | Passed | `/api/front-desk/board`, `/api/reservations`, `/api/settings/room-setup`, `/api/users`, and `/api/ops/policy` returned `401 Authentication is required.` |
| Protected mutation APIs without cookie | Passed | `/api/reservations`, `/api/payments`, `/api/users`, `/api/settings/rooms`, `/api/ops/commands`, and `/api/booking-email/sync` returned `401 Authentication is required.` |
| `GET /api/setup/status` | Informational | Returned `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, `propertyName=SANDBOX HOTEL`. |
| `POST /api/setup/complete` without setup token | Failed boundary expectation | Returned `400 Add at least one room type.` The empty body did not mutate production, but the response shows the request reached setup payload validation instead of being rejected before validation. |

## Current-Checkout Hardening

Changed `server/pms-service.mjs` so `completeInitialSetup` checks existing setup state and operational-record state before validating the submitted setup payload. This makes a completed setup return the completed-setup rejection before setup payload validation.

Added a regression in `scripts/run-business-tests.mjs` proving a completed setup rejects before invalid payload validation and before operational-record counts.

## Validation

| Command | Result | Evidence summary |
| --- | --- | --- |
| `npm.cmd test` | Passed | Business rule tests passed, including the new completed-setup regression. |
| `npm.cmd run lint` | Passed | ESLint completed with exit code 0. |
| `npm.cmd run typecheck` | Passed | TypeScript project check completed with exit code 0. |
| `npm.cmd run build` | Passed | Production build completed after the hardening change. |
| `npm.cmd run launch:check` | Timed out first, then passed on rerun | First attempt hit the 15-minute tool timeout while inside the build phase; stuck validation child processes were stopped. A rerun with a longer timeout completed `db:generate`, `db:doctor`, lint, typecheck, business tests, non-mutating E2E smoke, build, high-threshold audit, and Prisma migrate status successfully. |

## Boundaries And Remaining Proof

- The live setup-gate hardening is not proven live until this checkout is deployed and the unauthenticated setup-complete probe is rerun.
- This slice did not use, store, print, or verify production passwords, tokens, session cookies, or raw database URLs.
- This slice did not prove real production login users, credentialed logout, role-by-role RBAC, admin/manager restrictions, or production user-management behavior.
- The live environment should also be checked for whether `ALLOW_PUBLIC_SETUP` is intentionally enabled; repository `render.yaml` sets `ALLOW_PUBLIC_SETUP=false`, so the live `400` response needs follow-up.

## Next Slice

Deploy or otherwise verify the setup-completion hardening in the target environment, then rerun the setup-complete unauthenticated probe. After that, continue with credentialed production users/auth/RBAC/logout proof using redacted role evidence.
