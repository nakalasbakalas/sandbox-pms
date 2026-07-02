# Slice 3 Launch Evidence - Read-Only Live Render Metadata Refresh - 2026-07-02

Scope: refresh read-only Render service/database metadata and live host health without triggering deploys, restarts, database sessions, SSH, paid actions, or secret-value reads. This slice does not prove production user sign-off, production room inventory, credentialed RBAC, secret rotation timestamps, WAF rules, or owner assignments.

## Render CLI Context

| Check | Result | Evidence summary |
| --- | --- | --- |
| `render --version` | Passed | Render CLI v2.13.0 is installed. |
| `render whoami -o json` | Passed | Authenticated as `nakalastravels@gmail.com`. |
| `render workspace current -o json` | Passed | Active workspace is team workspace `My Workspace` (`tea-d6n8kq14tr6s738stj5g`). |

## Read-Only Service And Database Metadata

| Resource | Current metadata |
| --- | --- |
| Long-term custom-domain service | `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`), repo `https://github.com/nakalasbakalas/sandbox-pms`, branch `main`, auto deploy off, region `oregon`, runtime `node`, plan `starter`, health check `/healthz`, not suspended. |
| Long-term service latest deploy | `dep-d8i4q3favr4c73afbrg0`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, message `Improve board folio workflow and smoke checks`, finished `2026-06-06T16:39:42Z`, trigger `deployed_by_render`. |
| Alternate `sandbox-hotel-pms` service | `srv-d8bchr1akrks73disaog`, repo `https://github.com/nakalasbakalas/sandbox-pms`, branch `main`, auto deploy off, region `oregon`, runtime `node`, health check `/healthz`, not suspended. |
| Alternate service latest deploy | `dep-d8ekph4p3tds738mdp6g`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-01T09:13:20Z`. |
| Launch/staging service | `sandbox-hotel-pms-launch` (`srv-d8clkqho3t8c73a1eldg`), branch `codex/launch-ready-wiring`, status available through `render services`, latest deploy `dep-d8oh74m47okc739vhq2g` live on commit `5f5b54162156a658bd37ec4c2d00941feea8d037`. |
| Managed production PostgreSQL | `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`), database `sandbox_hotel_pms`, user name `sandbox_hotel_pms`, PostgreSQL 17, region `oregon`, plan `basic_256mb`, 15 GB disk, role `primary`, status `available`, not suspended. |
| Render project environment | Project `prj-d6nm1vdm5p6s7398qg70`, environment `Production` (`evm-d6nm1vdm5p6s7398qg7g`), protected status `unprotected`, network isolation disabled, IP allow list `0.0.0.0/0`. |

## Live Host Health

| Command | Result | Evidence summary |
| --- | --- | --- |
| `$env:LIVE_EXTRA_URLS='https://sandbox-hotel-pms.onrender.com,https://sandbox-hotel-pms-v43m.onrender.com'; npm.cmd run live:check` | Passed | Health, deep DB health, invalid session probe, root HEAD, and edge/DNS checks passed for `https://book.sandboxhotel.com`, `https://sandbox-hotel-pms.onrender.com`, and `https://sandbox-hotel-pms-v43m.onrender.com`. All three reported `lineWebhookConfigured=false`, which remains optional unless `LIVE_REQUIRE_LINE=true`. |

## Deploy Drift

- Local `HEAD` and `origin/main`: `2ba7410e4684697237bf14980544a4084775821c` (`Persist Hotel Ops scan snapshots`).
- Long-term live service `sandbox-hotel-pms-v43m`: commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`.
- Alternate live service `sandbox-hotel-pms`: commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`.
- Therefore, the current-checkout setup-gate hardening from Slice 2 is not proven live.

## Boundaries

- No deploy was triggered.
- No restart, SSH session, database shell, or paid resource action was run.
- No production secret values, database URLs, tokens, cookies, or passwords were requested or recorded.
- Render CLI metadata did not provide secret key inventory or rotation timestamps in the commands used here; those remain dashboard/API evidence gaps.
- Owner assignments remain unproven: rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner are still not named with access proof.

## Next Slice

Publish/deploy the current checkout through the approved branch/PR/deploy path, then rerun the unauthenticated setup-complete probe against `https://book.sandboxhotel.com`. Keep the proof separate from credentialed production-user/RBAC sign-off.
