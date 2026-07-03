# Slice 5AW - PR And Live Setup-Gate Refresh

Date: 2026-07-03T04:19Z.

Verdict: completed as a read-only refresh; setup-gate P0 remains open. PR #150 is still open, not draft, clean, unreviewed, and green in CI for head `fbc303136253a9785446d601d5532b6efc523b8f`. The public custom-domain Render service still runs older commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, so the current-checkout completed-setup hardening is not proven live. The unauthenticated public setup-complete probe still reaches payload validation and returns `400 Add at least one room type.`.

## Scope

- Target repo: `nakalasbakalas/sandbox-pms`.
- Public target: `https://book.sandboxhotel.com`.
- Branch: `codex/setup-gate-launch-proof`.
- Local `HEAD`: `fbc303136253a9785446d601d5532b6efc523b8f`.
- Remote `origin/codex/setup-gate-launch-proof`: `fbc303136253a9785446d601d5532b6efc523b8f`.
- Remote `origin/main`: `f5b0849037a55e2c99a3d781d742ba85d2384d8c`.
- Commands were read-only except local validation. No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed production login, screenshots, or secret-value access was performed.

## Commands And Results

| Command | Result | Evidence Summary |
| --- | --- | --- |
| `git fetch origin` | Passed | Remote refs refreshed without changing the dirty worktree. |
| `git rev-parse HEAD` / `origin/codex/setup-gate-launch-proof` / `origin/main` | Passed | Local head and branch remote are `fbc303136253a9785446d601d5532b6efc523b8f`; `origin/main` is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`. |
| `gh pr view 150 --repo nakalasbakalas/sandbox-pms --json ...` | Passed | PR #150 is `OPEN`, `isDraft=false`, `mergeStateStatus=CLEAN`, no `reviewDecision`, no latest reviews, head `fbc303136253a9785446d601d5532b6efc523b8f`, base `f5b0849037a55e2c99a3d781d742ba85d2384d8c`, `updatedAt=2026-07-02T10:51:15Z`. |
| `gh pr checks 150 --repo nakalasbakalas/sandbox-pms` | Passed | `Install, test, build, and launch-check` passed in 6m28s at GitHub Actions job `84724751654`. |
| Sanitized `render services -o json` summary | Passed | Long-term custom-domain service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) is a not-suspended Node web service on branch `main`, auto deploy `no`, health path `/healthz`, starter plan, region `oregon`, URL `https://sandbox-hotel-pms-v43m.onrender.com`. |
| `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Latest live deploy remains `dep-d8i4q3favr4c73afbrg0`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`. |
| `render services instances srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Observed instance `srv-d6ns31h4tr6s73c9i8g0-2brwp`, created `2026-06-06T16:39:10Z`. |
| `npm.cmd test` | Passed | Business rule tests passed; this covers the current-checkout setup-complete hardening locally. |
| `npm.cmd run render:validate` | Passed | Render Blueprint validation returned `valid: true`. |
| `npm.cmd run prod:preflight` | Passed with warning | Production preflight passed; LINE credentials remain unconfigured and live LINE messaging remains disabled. |
| `npm.cmd run live:check` | Failed first attempt | First attempt failed with Node `AbortError`; no readiness claim was made from this failed attempt. |
| `npm.cmd run live:check` | Passed on retry | Public readiness check passed for `https://book.sandboxhotel.com`; LINE remains optional unless `LIVE_REQUIRE_LINE=true`; DNS resolved to `216.24.57.9` from this resolver. |
| Direct `GET /healthz?deep=1` | Passed | Returned `200`, `ok=true`, database configured, database OK, `server=cloudflare`, `CF-RAY` present, and `X-Render-Origin-Server=Render`. |
| Direct `GET /api/setup/status` | Passed | Returned `200` body `ok=true`, `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, `propertyName=SANDBOX HOTEL`. |
| Direct unauthenticated `POST /api/setup/complete` with `{}` | Failed as expected for current live deploy | Returned `400` body `{"ok":false,"error":"Add at least one room type."}`. This proves the public live service still reaches setup payload validation instead of the PR #150 completed-setup rejection. |

## Evidence Decision

The current checkout and PR remain ready for review from an engineering-gate perspective, but the live setup-gate P0 is still blocked. Closing it requires review/approval of PR #150 or exact commit `fbc303136253a9785446d601d5532b6efc523b8f`, deployment of that reviewed commit to `sandbox-hotel-pms-v43m`, and a public unauthenticated setup-complete reprobe showing rejection before payload validation.

This slice does not close production users/auth/RBAC/logout, real room inventory, production-like workflow acceptance, live secret inventory, recovery ownership, recovery-point proof, or WAF/rate-limit rule proof.
