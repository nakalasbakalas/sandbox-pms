# Slice 5AU - PR And Live Setup-Gate Refresh

Status date: 2026-07-03T10:39:47+07:00.

Verdict: completed as a read-only refresh; setup-gate P0 remains open. PR #150 is still open, green, clean, and unreviewed. The custom-domain Render service is still serving the older `7adcc01c...` deploy, and the public setup-complete probe still reaches setup payload validation instead of rejecting completed setup before validation.

## Scope

- Branch: `codex/setup-gate-launch-proof`.
- Local/current PR head: `fbc303136253a9785446d601d5532b6efc523b8f`.
- Public target: `https://book.sandboxhotel.com`.
- Render custom-domain service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`).
- No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed production login, screenshots, or secret-value access was performed.

## Commands And Probes

| Command / Probe | Result | Evidence Summary |
| --- | --- | --- |
| `git ls-remote origin refs/heads/main refs/heads/codex/setup-gate-launch-proof` | Passed | `origin/main` is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`; `origin/codex/setup-gate-launch-proof` is `fbc303136253a9785446d601d5532b6efc523b8f`. |
| `gh pr view 150 --repo nakalasbakalas/sandbox-pms --json ...` | Passed | PR #150 remains `OPEN`, `isDraft=false`, `mergeStateStatus=CLEAN`, `reviewDecision` empty, no reviews/latest reviews, head `fbc303136253a9785446d601d5532b6efc523b8f`, base `f5b0849037a55e2c99a3d781d742ba85d2384d8c`, updated `2026-07-02T10:51:15Z`. |
| `gh pr checks 150 --repo nakalasbakalas/sandbox-pms` | Passed | GitHub Actions job `84724751654` remains green for `Install, test, build, and launch-check` in 6m28s. |
| `render whoami -o json` | Passed | Render CLI is authenticated as `nakalastravels@gmail.com`. No token or secret value was printed. |
| Filtered `render services -o json` | Passed | Target service `sandbox-hotel-pms-v43m` is a not-suspended Node web service on branch `main`, auto deploy `no`, health path `/healthz`, repo `nakalasbakalas/sandbox-pms`, region `oregon`, one configured instance, and maintenance mode disabled. |
| `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Latest live deploy remains `dep-d8i4q3favr4c73afbrg0`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`. |
| `render services instances srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | One observed instance: `srv-d6ns31h4tr6s73c9i8g0-2brwp`, created `2026-06-06T16:39:10Z`. |
| `npm.cmd test` | Passed | Business rule tests passed; local setup-gate hardening coverage remains green in the current checkout. |
| `npm.cmd run render:validate` | Passed | Render Blueprint validation returned `valid: true` with two planned actions. |
| `npm.cmd run live:check` | Failed then passed on retry | First attempt failed with Node `AbortError`. Immediate retry passed for `https://book.sandboxhotel.com`, with `lineWebhookConfigured=false` informational unless LINE is required; DNS resolved to `216.24.57.9`. |
| Direct `GET /healthz?deep=1` | Passed | Returned `200`, `ok=true`, production environment, database configured, database OK, `lineWebhookConfigured=false`, timestamp `2026-07-03T03:39:17.605Z`. |
| Direct `GET /api/setup/status` | Passed | Returned `200`, `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, and `propertyName=SANDBOX HOTEL`. |
| Direct unauthenticated `POST /api/setup/complete` with `{}` | P0 still open | Returned `400` and `Add at least one room type.`, proving the public service still reaches setup payload validation instead of the PR #150 completed-setup rejection. |

## Evidence Decision

This slice does not close the setup-gate P0. The approved/deployed public target still needs:

- PR #150 review/approval or explicit approval of commit `fbc303136253a9785446d601d5532b6efc523b8f`.
- Deployment of the reviewed commit to `sandbox-hotel-pms-v43m`.
- A public unauthenticated setup-complete reprobe showing completed setup is rejected before payload validation.

## Next Recommended Slice

Get PR #150 reviewed/approved and deploy exact commit `fbc303136253a9785446d601d5532b6efc523b8f` to `sandbox-hotel-pms-v43m`, then rerun the public setup-complete probe. If approval/deploy is not available, collect owner/provider proof for production auth/RBAC, room inventory, workflow acceptance, secrets/recovery, and WAF/rate-limit rules.
