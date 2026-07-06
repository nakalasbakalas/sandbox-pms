# 2026-07-06 Issue Remediation Pass

## Verdict

Not launch-signed-off. This pass refreshed current engineering, deploy, Gmail, public-edge, and local disposable DB proof after `main` was deployed as Render deploy `dep-d95qsnvavr4c73aqics0`, but the remaining open issues still require owner/provider/manual evidence before truthful closure.

## Current Source And Runtime

- Repository: `nakalasbakalas/sandbox-pms`.
- Branch: `main`.
- Commit: `ce13cf6d3d1880b776a90e9f2e75db62ffef8ab0`.
- GitHub Actions: run `28794902800` passed for `ce13cf6`, including install, Prisma generate, lint, typecheck, business tests, E2E smoke, build, and launch gate.
- Render service: `srv-d6ns31h4tr6s73c9i8g0`.
- Render deploy: `dep-d95qsnvavr4c73aqics0`, status `live`, finished `2026-07-06T13:34:57Z`.

## Commands And Results

All commands below were run from `D:\sandbox-pms`.

| Check | Result | Boundary |
| --- | --- | --- |
| `git status --short --branch` | clean, `main...origin/main` | Source tree is synchronized. |
| `npm.cmd run prod:preflight` | passed | LINE remains disabled/manual unless required and configured. |
| `npm.cmd audit --audit-level=high` | passed high threshold | One moderate `js-yaml` advisory remains below the configured threshold. |
| `npx.cmd prisma migrate status` | passed; local `sandbox_hotel_dev` schema up to date | Local target only, not production DB shell proof. |
| `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` | passed; `ready=true` | Booking-specific Gmail refresh-token tuple exists on Render; values omitted. |
| `npm.cmd run public-edge:proof` | passed | Cloudflare/Render routing and public denied-path posture only, not WAF/rate-limit rule proof. |
| `npm.cmd run live:check` | passed | Public app health and optional LINE posture checked. |
| `$env:ALLOW_DB_E2E='true'; npm.cmd run db:e2e:ready` | passed | Local disposable `localhost:5432/sandbox_hotel_e2e`, not production. |
| `$env:ALLOW_DB_E2E='true'; npm.cmd run test:e2e:db` | passed | Local disposable DB-mutating proof only. |
| `npm.cmd run cloudflare:waf:proof` | blocked as designed | Missing `CLOUDFLARE_API_TOKEN`/`CF_API_TOKEN` and `CLOUDFLARE_ZONE_ID`/`CF_ZONE_ID`. |

## Issue Decisions

| Issue | Decision | Reason |
| --- | --- | --- |
| `#136` | Closed before this evidence pass | Scope/planning is now documented; remaining proof is tracked by the other launch issues. |
| `#137` | Keep open | Still needs approved production user list, credentialed login/logout proof, role matrix, underprivileged denial proof, and bootstrap/setup-token cleanup or retention decision. |
| `#138` | Keep open | Automated route/E2E proof is green, but manual desktop/tablet workflow acceptance, role-by-role target-environment denial evidence, Thai/English label review, and launch-copy sweep are still not recorded. |
| `#140` | Keep open | Local disposable DB E2E and migration proof are refreshed, but owner/import source proof for real production inventory, backup/recovery-point evidence, and any owner-required staging acceptance are still missing. |
| `#142` | Keep open | Final sign-off depends on closure or accepted-risk handling of `#137`, `#138`, and `#140`, plus recovery/WAF/provider evidence. |

## Current Blockers

- Production auth/RBAC/logout: owner-run credentialed proof is still missing.
- Dashboard/manual UX acceptance: manual desktop/tablet route workflow and localization proof is still missing.
- Database/inventory: production aggregate room counts exist, but owner/import source-of-truth and backup/recovery evidence are still missing.
- WAF/rate-limit: public-edge proof is green, but Cloudflare rule IDs, thresholds, protected-hostname coverage, and approved non-destructive test evidence are still owner-token/zone gated.
- Booking Inbox: backend Gmail OAuth/backfill mechanics are ready, but imported events remain review-only until staff/admin parser review accepts them.

## Closure Boundary

Do not close the remaining launch issues from this evidence alone. The current repository, CI, Render deploy, and local disposable DB proof are green; the remaining closure criteria are external owner/provider/manual proof items.
