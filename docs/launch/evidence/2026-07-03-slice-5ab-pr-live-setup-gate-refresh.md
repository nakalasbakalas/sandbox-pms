# Slice 5AB Launch Evidence - PR And Live Setup-Gate Refresh - 2026-07-03

Scope: refresh the highest-impact P0 deploy/setup-gate blocker with read-only GitHub, Render, and public endpoint checks.

Verdict: blocker still open. PR #150 remains green and ready for review, but no review approval is recorded and the long-term custom-domain Render service is still on the older live deploy. The public setup-complete endpoint still reaches setup payload validation instead of proving the current-checkout completed-setup hardening.

This slice did not deploy, restart, SSH, open a production database shell, mutate production data, run DB-mutating E2E, perform credentialed login, or access secret values.

## Command Results

| Command | Result | Evidence summary |
| --- | --- | --- |
| `gh pr view 150 --repo nakalasbakalas/sandbox-pms --json number,state,isDraft,headRefOid,baseRefOid,mergeStateStatus,reviewDecision,latestReviews,url` | Passed | PR #150 is `OPEN`, `isDraft=false`, merge state `CLEAN`, `reviewDecision` empty, `latestReviews=[]`, head `fbc303136253a9785446d601d5532b6efc523b8f`, base `f5b0849037a55e2c99a3d781d742ba85d2384d8c`. |
| `gh pr checks 150 --repo nakalasbakalas/sandbox-pms` | Passed | `Install, test, build, and launch-check` passed in 6m28s at GitHub Actions job `84724751654`. |
| `render whoami -o json` | Passed | Render CLI is authenticated as `nakalastravels@gmail.com`. No secret values were printed. |
| `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Latest long-term custom-domain service deploy remains `dep-d8i4q3favr4c73afbrg0`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`. |
| `render services instances srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | One observed instance id was returned for `sandbox-hotel-pms-v43m`; no secret values were printed. |
| `git rev-parse HEAD; git rev-parse origin/codex/setup-gate-launch-proof; git rev-parse origin/main` | Passed | Local `HEAD` and `origin/codex/setup-gate-launch-proof` are `fbc303136253a9785446d601d5532b6efc523b8f`; `origin/main` is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`. |
| Public `GET /healthz?deep=1` against `https://book.sandboxhotel.com` | Passed | Returned `200`, production environment, database configured, database OK, and `lineWebhookConfigured=false`. |
| Public `GET /api/setup/status` against `https://book.sandboxhotel.com` | Passed | Returned `200` with `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, and `propertyName=SANDBOX HOTEL`. |
| Public unauthenticated `POST /api/setup/complete` with empty JSON against `https://book.sandboxhotel.com` | Passed as a probe; blocker confirmed | Returned `400` with `Add at least one room type.`, proving the live service still reaches setup payload validation instead of the PR #150 completed-setup rejection. |

Public endpoint probe timestamp: `2026-07-03T00:38:57.712Z`; health payload timestamp: `2026-07-03T00:39:10.496Z`.

## Evidence Decision

This slice refreshes the setup-gate deployment blocker; it does not close it. The hardened setup behavior is still only proven in the current checkout and PR CI, not on the public custom-domain service.

## Remaining Closure Evidence

- Review approval for PR #150 or exact commit `fbc303136253a9785446d601d5532b6efc523b8f`.
- Deployment of the reviewed commit to `sandbox-hotel-pms-v43m`.
- Post-deploy public unauthenticated setup-complete reprobe showing completed setup is rejected before payload validation.

## Boundaries

- No production secret values, raw database URLs, tokens, passwords, cookies, or screenshots were recorded.
- No production database mutation was performed.
- No DB-mutating E2E ran in this slice.
- This does not prove production users/auth/RBAC/logout, real production room inventory, production-like workflow acceptance, live secret inventory/rotation, recovery ownership, or upstream WAF/rate-limit rules.
