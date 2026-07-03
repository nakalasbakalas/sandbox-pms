# Slice 5AK - PR And Live Setup-Gate Refresh

Date: 2026-07-03T08:49+07:00

Verdict: setup-gate P0 still blocked. PR #150 remains open, clean, not draft, and green in CI for the current head, but it has no recorded reviews and the custom-domain Render service still runs the older deploy. The public `setup/complete` endpoint still reaches payload validation instead of the current-checkout completed-setup rejection.

Scope boundary:

- No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed production login, screenshots, or secret-value access was performed.
- Render checks were read-only CLI metadata and public HTTP probes only.
- No raw database URLs, tokens, cookies, passwords, or secret values were requested or recorded.

## Local And GitHub Proof

| Check | Result | Evidence |
| --- | --- | --- |
| `git rev-parse HEAD` | Passed | Local `HEAD` is `fbc303136253a9785446d601d5532b6efc523b8f`. |
| `git rev-parse origin/codex/setup-gate-launch-proof` | Passed | Remote PR branch is `fbc303136253a9785446d601d5532b6efc523b8f`. |
| `git rev-parse origin/main` | Passed | Remote `main` is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`. |
| `gh pr view 150 --repo nakalasbakalas/sandbox-pms --json ...` | Passed | PR #150 is `OPEN`, `isDraft=false`, `mergeStateStatus=CLEAN`, `headRefOid=fbc303136253a9785446d601d5532b6efc523b8f`, `baseRefOid=f5b0849037a55e2c99a3d781d742ba85d2384d8c`, and `latestReviews=[]`. |
| `gh pr checks 150 --repo nakalasbakalas/sandbox-pms` | Passed | `Install, test, build, and launch-check` passed in 6m28s at job `84724751654`. |
| `npm.cmd test` | Passed | `Business rule tests passed`, including the current-checkout regression that completed setup rejects before setup payload validation. |

## Render And Public Proof

| Check | Result | Evidence |
| --- | --- | --- |
| `render --version; render whoami -o json` | Passed | Render CLI `v2.13.0`; authenticated as `nakalastravels@gmail.com`. |
| `render services -o json` filtered to `srv-d6ns31h4tr6s73c9i8g0` | Passed | `sandbox-hotel-pms-v43m` is `not_suspended`, repo `https://github.com/nakalasbakalas/sandbox-pms`, branch `main`, `autoDeploy=no`, Node starter service, health check `/healthz`, predeploy `npm run db:migrate && npm run db:seed`. |
| `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o text` | Passed | Current live deploy is `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, created `2026-06-06T16:38:37Z`, finished `2026-06-06T16:39:42Z`. |
| `npm.cmd run render:validate` | Passed | Render Blueprint validation returned `valid: true`. |
| `GET https://book.sandboxhotel.com/healthz?deep=1` | Passed | Returned `ok=true`, `environment=production`, `database.configured=true`, `database.ok=true`, and `lineWebhookConfigured=false` at `2026-07-03T01:48:03.040Z`. |
| `GET https://book.sandboxhotel.com/api/setup/status` | Passed | Returned `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, and `propertyName=SANDBOX HOTEL`. |
| `POST https://book.sandboxhotel.com/api/setup/complete` with `{}` | Blocker confirmed | Returned `400` with `Add at least one room type.`, proving the public service still reaches setup payload validation instead of the current-checkout completed-setup rejection. |
| `npm.cmd run live:check` | Passed | Live readiness check passed for `https://book.sandboxhotel.com`; LINE remains optional unless `LIVE_REQUIRE_LINE=true`. |

## Decision

The setup-gate hardening is still ready for review in PR #150, but it is not launch-proven live. The blocker remains: approve PR #150, deploy exact reviewed commit `fbc303136253a9785446d601d5532b6efc523b8f` to `sandbox-hotel-pms-v43m`, then reprobe unauthenticated `POST /api/setup/complete` and confirm it rejects completed setup before payload validation.

## Remaining P0 Blockers After This Slice

- PR #150 setup-gate hardening needs review approval, deployment to `sandbox-hotel-pms-v43m`, and public reprobe.
- Production users/auth/RBAC/logout/unauthorized-access proof remains open for approved users and credentialed role testing.
- Real production room inventory proof remains open.
- Core hotel workflow acceptance remains open for staging, controlled production-like, or account-owner manual proof.
- Live secret key inventory/rotation metadata, rollback/deputy/database recovery owners, and WAF/rate-limit rule IDs remain open.
