# Slice 5AN - PR And Live Setup-Gate Refresh

Date: 2026-07-03T09:10:41.5283596+07:00.

Verdict: setup-gate P0 remains open. PR #150 still has the completed-setup hardening and green CI at `fbc303136253a9785446d601d5532b6efc523b8f`, but it remains open and unreviewed. The custom-domain Render service `sandbox-hotel-pms-v43m` is still live on older deploy `dep-d8i4q3favr4c73afbrg0` at commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, and the public setup-complete probe still reaches payload validation.

## Scope Boundary

- No deploy, restart, SSH session, production database shell, production mutation, DB-mutating E2E, credentialed production login, screenshot capture, or secret-value access was performed.
- All GitHub, Render, and public endpoint checks were read-only except the unauthenticated `POST /api/setup/complete` empty JSON reprobe, which returned validation failure and did not complete setup.
- No production database URL, token, password, cookie, or raw secret value was requested or recorded.

## Commands And Results

| Command | Result | Evidence Summary |
| --- | --- | --- |
| `git fetch origin main codex/setup-gate-launch-proof` | Passed | Refreshed remote refs for `main` and the launch-proof branch. |
| `git rev-parse HEAD; git rev-parse origin/main; git rev-parse origin/codex/setup-gate-launch-proof` | Passed | Local `HEAD` and `origin/codex/setup-gate-launch-proof` are `fbc303136253a9785446d601d5532b6efc523b8f`; `origin/main` is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`. |
| `gh pr view 150 --repo nakalasbakalas/sandbox-pms --json ...` | Passed | PR #150 is `OPEN`, `isDraft=false`, merge state `CLEAN`, head `fbc303136253a9785446d601d5532b6efc523b8f`, base `f5b0849037a55e2c99a3d781d742ba85d2384d8c`, with no reviews recorded. |
| `gh pr checks 150 --repo nakalasbakalas/sandbox-pms` | Passed | `Install, test, build, and launch-check` passed in 6m28s at GitHub Actions job `84724751654`. |
| `npm.cmd test` | Passed | Business rule tests passed, including the current-checkout setup-complete hardening regression. |
| `render services -o json` filtered to `sandbox-hotel-pms-v43m` | Passed | Service `srv-d6ns31h4tr6s73c9i8g0` is a Node web service on branch `main`, auto deploy `no`, plan `starter`, region `oregon`, health path `/healthz`, and pre-deploy command `npm run db:migrate && npm run db:seed`. |
| `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Latest live deploy is `dep-d8i4q3favr4c73afbrg0`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`. |
| `npm.cmd run render:validate` | Passed | Render Blueprint validation returned `valid: true`. |
| `GET https://book.sandboxhotel.com/healthz?deep=1` | Passed | Returned `ok=true`, service `sandbox-hotel-pms`, production environment, database configured and OK, LINE webhook not configured, timestamp `2026-07-03T02:10:22.666Z`. |
| `GET https://book.sandboxhotel.com/api/setup/status` | Passed | Returned `ok=true`, `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, `propertyName=SANDBOX HOTEL`. |
| `POST https://book.sandboxhotel.com/api/setup/complete` with `{}` | Failed as expected for the current live bug | Returned HTTP `400` with `{"ok":false,"error":"Add at least one room type."}`. This confirms the public service still reaches setup payload validation instead of the PR #150 completed-setup rejection. |
| `npm.cmd run live:check` | Passed | Live readiness check passed for `https://book.sandboxhotel.com`; LINE remains optional unless `LIVE_REQUIRE_LINE=true`. |

## Evidence Decision

This slice reconfirms that the fix is present and tested in the current PR branch, but not deployed to the public custom-domain service. The setup-gate P0 is still open until PR #150 or exact commit `fbc303136253a9785446d601d5532b6efc523b8f` is reviewed, deployed to `sandbox-hotel-pms-v43m`, and reprobed publicly.

## Remaining Proof Needed

- Review/approval evidence for PR #150 or the exact commit.
- Deployment evidence showing `sandbox-hotel-pms-v43m` is running the reviewed commit.
- Public unauthenticated setup-complete reprobe showing completed-setup rejection before payload validation.

## Next Recommended Slice

Get review/approval for PR #150 or exact commit `fbc303136253a9785446d601d5532b6efc523b8f`, deploy the reviewed commit to `sandbox-hotel-pms-v43m`, and rerun the public setup-complete unauthenticated probe. If deployment remains owner-gated, collect account-owner proof for production users/auth/RBAC, room inventory, workflow acceptance, secrets/recovery ownership, and WAF/rate-limit rules.
