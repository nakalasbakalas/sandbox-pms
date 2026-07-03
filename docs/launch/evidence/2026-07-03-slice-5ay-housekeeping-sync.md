# 2026-07-03 Slice 5AY - Housekeeping Sync And Live Setup-Gate Reprobe

Status: completed; setup-gate deploy/reprobe blocker closed, broader launch sign-off still open.

## Scope

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: repository/GitHub synchronization, Render deploy state, public health/setup probes, and local housekeeping status. No production database mutation, credentialed production login, secret-value access, deploy restart, or WAF rule mutation was performed.

## Current GitHub State

- `git fetch --prune origin` completed.
- Local branch `codex/setup-gate-launch-proof` points at `fbc303136253a9785446d601d5532b6efc523b8f`, and its old upstream branch is gone because PR #150 was merged.
- `origin/main` points at `a01838a956f24164167ba7f91a7620a37de7f36d`, the merge commit for PR #150.
- `gh pr view 150 --repo nakalasbakalas/sandbox-pms` reports PR #150 state `MERGED`, merged at `2026-07-03T09:03:43Z`, merge commit `a01838a956f24164167ba7f91a7620a37de7f36d`.
- PR #150 CI remains green: GitHub Actions job `84724751654` completed successfully for `Install, test, build, and launch-check`.
- Open launch issues remain #136, #137, #138, #140, and #142.
- Open PRs are Dependabot-only at the time of this refresh: #144, #145, #146, #147, and #148. PR #148 is unstable/failing CI; #144-#147 are clean/green but are dependency updates, not launch-proof blockers.

## Current Render And Public State

- Render CLI is available as `render v2.13.0`.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` reports latest live deploy `dep-d93nr7nlk1mc739ldujg`.
- Live deploy `dep-d93nr7nlk1mc739ldujg` serves merge commit `a01838a956f24164167ba7f91a7620a37de7f36d`, created `2026-07-03T09:15:10Z`, finished `2026-07-03T09:17:54Z`, status `live`.
- Previous long-lived deploy `dep-d8i4q3favr4c73afbrg0` is now deactivated.
- `render services instances srv-d6ns31h4tr6s73c9i8g0 -o json` reports observed instance `srv-d6ns31h4tr6s73c9i8g0-8wxvc`, created `2026-07-03T09:17:22Z`.
- `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, `environment=production`, database configured and OK, `server=cloudflare`, `CF-RAY` present, and `X-Render-Origin-Server=Render`.
- `GET https://book.sandboxhotel.com/api/setup/status` returned `200` with `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, and `propertyName=SANDBOX HOTEL`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with `{}` returned `403` and `Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.`

## Decision

The PR #150 setup-completion hardening has moved from review/deploy blocked to merged, live on Render, and publicly reprobed on the Cloudflare-fronted custom domain. This closes the specific setup-gate deploy/reprobe blocker.

## Local Validation

Validation was run after the status/documentation updates and Booking.com selector-readiness changes in the local worktree.

| Command | Result | Notes |
| --- | --- | --- |
| `rg -n "^(<<<<<<<|=======|>>>>>>>)" .` | Passed | No active merge-conflict marker lines found. |
| `git diff --check` | Passed | Only CRLF conversion warnings were reported by Git for existing Markdown/doc files. |
| `npm.cmd run launch:evidence` | Passed | Evidence inventory passed; no unredacted secret-shaped values were found in launch evidence docs or high-confidence production secret-shaped tracked/unignored text files. |
| `npm.cmd run db:generate` | Passed | Prisma Client v6.19.3 generated. |
| `npx.cmd prisma validate` | Passed | Prisma schema is valid. |
| `npm.cmd run db:doctor` | Initially failed, then passed | Initial failure was Docker daemon/local Postgres unavailable. Docker Desktop was started, `sandbox-hotel-postgres` became healthy on `localhost:55432`, and the rerun passed for dev and E2E DB connectivity/migration status. |
| `npm.cmd run typecheck` | Passed | TypeScript build check completed. |
| `npm.cmd run lint` | Passed | ESLint completed without reported errors. |
| `npm.cmd test` | Passed | Business rule tests passed. |
| `npm.cmd run render:validate` | Passed | Render Blueprint validation returned `valid: true`. |
| `npm.cmd run live:check` | Passed | Public live readiness check passed for `https://book.sandboxhotel.com`; LINE remains optional/unconfigured unless required. |
| `npm.cmd run build` | Passed | Vite production build completed. |
| `npm.cmd run launch:check` | Passed | Integrated gate passed after Docker/Postgres was available; high-severity audit threshold passed while npm still reported one moderate `js-yaml` advisory. |
| `$env:ALLOW_DB_E2E='true'; npm.cmd run db:e2e:ready; npm.cmd run test:e2e:db` | Passed | Guarded DB-mutating E2E ran only against local disposable `sandbox_hotel_e2e` on `localhost:55432`; no production DB target was used. |

This does not close full launch sign-off. The remaining P0 blockers still require account-owner or credentialed production proof:

- Approved production user list, credentialed login/logout, role matrix, and underprivileged-role denial.
- Current real production room inventory and source-owner approval.
- Staging or controlled production-like core workflow acceptance if required by the launch owner.
- Redacted live secret key inventory, rotation metadata, and owner confirmation.
- Named rollback owner, rollback deputy, database recovery owner, latest recovery point/retention proof, and WAF/rate-limit owner/rule IDs.
