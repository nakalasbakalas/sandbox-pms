# Slice 5AH Launch Evidence - PR And Live Setup-Gate Refresh - 2026-07-03

Scope: refresh PR #150 review/CI state, Render custom-domain deploy metadata, and public setup-gate behavior.

Verdict: completed, but the live setup-complete gate remains blocked. PR #150 is still open with no reviews recorded, the custom-domain Render service is still live on older commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, and unauthenticated setup-complete still reaches payload validation instead of the current-checkout completed-setup rejection.

This slice did not deploy, restart, SSH, open a production database shell, mutate production data, run DB-mutating E2E, perform credentialed production login, or access secret values.

## Command Results

| Command | Result | Evidence summary |
| --- | --- | --- |
| `git rev-parse HEAD` | Passed | Local checkout remains `fbc303136253a9785446d601d5532b6efc523b8f`. |
| `git ls-remote origin refs/heads/main refs/heads/codex/setup-gate-launch-proof` | Passed | Remote PR branch is `fbc303136253a9785446d601d5532b6efc523b8f`; remote `main` is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`. |
| `gh pr view 150 --repo nakalasbakalas/sandbox-pms --json ...` | Passed | PR #150 is `OPEN`, `isDraft=false`, `mergeStateStatus=CLEAN`, `headRefOid=fbc303136253a9785446d601d5532b6efc523b8f`, `baseRefOid=f5b0849037a55e2c99a3d781d742ba85d2384d8c`, and `latestReviews=[]`. |
| `gh pr checks 150 --repo nakalasbakalas/sandbox-pms` | Passed | GitHub Actions check `Install, test, build, and launch-check` passed in 6m28s at job `84724751654`. |
| `render whoami -o json` | Passed | Render CLI is authenticated as `nakalastravels@gmail.com`; no secret values were printed. |
| `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Custom-domain service latest deploy is still `dep-d8i4q3favr4c73afbrg0`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`. |
| `render services get srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Service metadata still shows `sandbox-hotel-pms-v43m`, repo `nakalasbakalas/sandbox-pms`, branch `main`, `autoDeploy=no`, health check `/healthz`, and predeploy `npm run db:migrate && npm run db:seed`. |
| `npm.cmd run render:validate` | Passed | Render Blueprint validation returned `valid: true` and `totalActions: 2`. |
| First `npm.cmd run live:check` | Failed transiently | Node raised `DOMException [AbortError]: This operation was aborted`. |
| Retry `npm.cmd run live:check` | Passed | `https://book.sandboxhotel.com` passed live readiness; LINE remains optional and unconfigured unless `LIVE_REQUIRE_LINE=true`. |
| Direct `GET https://book.sandboxhotel.com/healthz?deep=1` | Passed | Returned `200`, `ok=true`, production environment, database configured, database OK, and `lineWebhookConfigured=false` at `2026-07-03T01:16:49.912Z`. |
| Direct `GET https://book.sandboxhotel.com/api/setup/status` | Passed | Returned `200`, `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, and `propertyName=SANDBOX HOTEL`. |
| Direct unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON | Blocker confirmed | Returned `400` with `Add at least one room type.`, so the public service still reaches setup-payload validation instead of rejecting completed setup before payload validation. |

## Evidence Decision

The current-checkout setup-gate hardening remains reviewed-code-only evidence, not live production proof. The public custom-domain service has not deployed PR #150 head `fbc303136253a9785446d601d5532b6efc523b8f`, and the public setup-complete endpoint still shows the older behavior.

## Still Required To Close

- PR #150 review approval or equivalent owner approval for exact commit `fbc303136253a9785446d601d5532b6efc523b8f`.
- Deployment of the exact reviewed commit to `sandbox-hotel-pms-v43m`.
- Public unauthenticated setup-complete reprobe showing completed setup is rejected before payload validation.
