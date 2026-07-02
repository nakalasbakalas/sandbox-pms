# Slice 5S - PR And Live Setup-Gate Refresh

Date: 2026-07-02T15:01+07:00.

Verdict: completed, but the live first-run setup-completion P0 remains open. PR #150 is still green and mergeable, but it remains a draft and is not deployed to the custom-domain production service.

No production deploy, restart, SSH session, production database mutation, DB-mutating E2E, credentialed production login, secret-value access, or raw database URL access was performed.

## GitHub PR State

| Check | Result |
| --- | --- |
| `gh pr view 150 --repo nakalasbakalas/sandbox-pms --json ...` | Passed |
| PR state | `OPEN` |
| Draft status | `true` |
| Merge state | `CLEAN` |
| Review decision | Empty / no approval recorded |
| PR head branch | `codex/setup-gate-launch-proof` |
| PR head SHA | `75810c3fbcf73d6f8a790a607beb3bb3b0bf69a0` |
| PR base branch | `main` |
| PR base SHA | `f5b0849037a55e2c99a3d781d742ba85d2384d8c` |
| CI status | `SUCCESS` for `Install, test, build, and launch-check` |
| CI job URL | `https://github.com/nakalasbakalas/sandbox-pms/actions/runs/28571649967/job/84710575613` |
| Existing proof comment | `https://github.com/nakalasbakalas/sandbox-pms/pull/150#issuecomment-4863179917` |

`gh pr checks 150 --repo nakalasbakalas/sandbox-pms` passed and reported:

- `Install, test, build, and launch-check`: pass, 6m29s.

`git ls-remote origin refs/heads/main refs/heads/codex/setup-gate-launch-proof` passed and confirmed:

- `origin/codex/setup-gate-launch-proof`: `75810c3fbcf73d6f8a790a607beb3bb3b0bf69a0`
- `origin/main`: `f5b0849037a55e2c99a3d781d742ba85d2384d8c`

## Render Deploy State

| Service | Command | Live deploy | Live commit | Status |
| --- | --- | --- | --- | --- |
| `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) | `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` | `dep-d8i4q3favr4c73afbrg0` | `7adcc01c609f5a6b9789d8de08e48e48651c5ae6` | `live` |
| `sandbox-hotel-pms` (`srv-d8bchr1akrks73disaog`) | `render deploys list srv-d8bchr1akrks73disaog -o json` | `dep-d8ekph4p3tds738mdp6g` | `7adcc01c609f5a6b9789d8de08e48e48651c5ae6` | `live` |

Neither live PMS service is running PR #150 head `75810c3fbcf73d6f8a790a607beb3bb3b0bf69a0`, and neither is running current `origin/main` `f5b0849037a55e2c99a3d781d742ba85d2384d8c`.

## Live Public Probe

Target: `https://book.sandboxhotel.com`

Node `fetch` probe completed at `2026-07-02T08:00:54.915Z`.

| Request | Status | Result |
| --- | --- | --- |
| `GET /healthz?deep=1` | `200` | `ok=true`, environment `production`, database configured and OK, LINE webhook not configured. |
| `GET /api/setup/status` | `200` | `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, property name `SANDBOX HOTEL`. |
| `POST /api/setup/complete` with `{}` and no credentials | `400` | Still returns `Add at least one room type.` |

The live setup-complete response still proves the deployed code validates setup payload before rejecting completed setup. The expected hardened behavior from PR #150 is not live yet.

## Decision

The setup-completion hardening remains blocked on review/approval and deployment of the exact reviewed commit, followed by the same public unauthenticated reprobe.

Do not mark this P0 complete from the green PR CI alone. Green PR CI proves the proposed hardening is build/test/launch-gate clean; it does not prove live production behavior until the reviewed commit is deployed to the custom-domain service and reprobed.

## Next Required Evidence

To close this P0:

1. PR #150 is reviewed/approved, or exact commit `75810c3fbcf73d6f8a790a607beb3bb3b0bf69a0` is explicitly approved for production deployment.
2. `sandbox-hotel-pms-v43m` deploy records the reviewed commit SHA and deploy ID.
3. `GET /api/setup/status` still shows completed setup.
4. Unauthenticated `POST /api/setup/complete` with `{}` rejects completed setup before setup payload validation.
5. No production secrets, cookies, tokens, raw database URLs, or setup credentials are recorded.
