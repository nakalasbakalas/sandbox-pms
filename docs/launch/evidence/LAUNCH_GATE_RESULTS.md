# Current Checkout Launch Gate Results

Status date: 2026-07-04.

Verdict: the Slice 5BV source commit is green in CI, the local launch-evidence inventory passes, and the current deployed runtime commit remains green with focused live checks. Slice 5BV confirms GitHub Actions run `28703308473` passed for commit `d8884884faba8b50cb73c7f827aa4f9871744d4a`, `npm.cmd run launch:evidence` passed cleanly at that commit, and that commit is live on the custom-domain Render service as `dep-d94e5e7lk1mc73b3oh2g`. This proves engineering gate health and focused live health, not production/account-owner launch sign-off.

Update: Slice 5AT also reran the non-destructive Slice 0 baseline validation ladder in the same checkout and all commands passed. See `2026-07-03-slice-5at-baseline-validation-refresh.md` and `DB_DOCTOR_RESULTS.md`. Later Slice 5BF records deploy/probe evidence for commit `0de2eb3d612a555dbd6cac92948becd16aa24cae`. Slice 5BH confirms run `28674129355` passed for docs/status commit `1d2ea176b5759e98f30d038a8f3985ab299105af`. Slice 5BJ confirms CI run `28688152726` passed for commit `04d06d3351fa02154e258a35b84a379dd219db22`. Slice 5BK confirms CI run `28688693681` passed for commit `c377f6a9f0cc8e6c2dbbca53366e50767b30f272`. Slice 5BM confirms CI run `28690040884` passed for commit `c8acc1df271711d0b1c8e81419fbd76d5b6e2c4a` and that commit is live on Render. Slice 5BN confirms CI run `28692255198` passed for repository secret-redaction source commit `26444eda87e31a6c90c19f7a13f47c7e74706beb`; this is a docs/runtime-example redaction commit and does not change the deployed app runtime. Slice 5BO confirms CI run `28700849720` passed for Cloudflare/WAF-boundary evidence commit `72592dacc1d6b3189fe7061aad6fd6ac932df72e`; Slice 5BS confirms CI run `28701971403` passed for commit `e348fd6d076b2bf094dca1c77c372a2bbed612c4` and that commit was live on Render; Slice 5BV confirms CI run `28703308473` passed for commit `d8884884faba8b50cb73c7f827aa4f9871744d4a` and that commit is live on Render.

## Scope

- Branch: `main`.
- Current repository commit: `d8884884faba8b50cb73c7f827aa4f9871744d4a` before Slice 5BV evidence updates.
- Current deployed runtime commit: `d8884884faba8b50cb73c7f827aa4f9871744d4a`.
- Worktree: clean before the Slice 5BV evidence updates; Slice 5BV adds current-runtime sync evidence.
- Production posture: Slice 5BV performed a Render deploy of commit `d8884884faba8b50cb73c7f827aa4f9871744d4a`; no OAuth env-var mutation, restart, SSH session, production database shell, production data mutation, DB-mutating E2E against production, confirmed booking-email import, or secret-value access was performed.
- DB-mutating E2E posture: not run by `launch:check`; the gate confirmed it remains blocked unless `ALLOW_DB_E2E=true`.

## Command

| Command | Result | Notes |
| --- | --- | --- |
| `npm.cmd run launch:check` | Failed/inconclusive | First Slice 5AT attempt hit the 5-minute tool timeout before returning command output. |
| `npm.cmd run launch:check` | Failed | Second Slice 5AT attempt reached non-mutating `test:e2e` and failed with `page.waitForFunction: Timeout 20000ms exceeded` in `assertProtectedRouteAccess` at `scripts/run-e2e-tests.mjs:351`. |
| PowerShell-managed `npm.cmd run test:e2e` | Passed | Direct non-mutating E2E retry passed in about 292 seconds and did not run DB-mutating workflow E2E. |
| `npm.cmd run launch:check` | Passed | Final Slice 5AT retry completed all launch-check subcommands in the current checkout on 2026-07-03 after Slice 5AT docs/evidence updates. |
| `npm.cmd run launch:check` | Passed | Follow-up rerun after final Slice 5AT evidence wording/link edits passed in the current checkout. |
| `npm.cmd run launch:check` | Passed | Slice 5AV rerun after secrets/recovery/WAF evidence/status updates completed all launch-check subcommands in the current checkout. |
| `npm.cmd run launch:check` | Passed | GitHub Actions run `28672978563` completed launch-check successfully for commit `0de2eb3d612a555dbd6cac92948becd16aa24cae`. |
| GitHub Actions CI | Passed | Run `28672978563` completed `Install, test, build, and launch-check` successfully for commit `0de2eb3d612a555dbd6cac92948becd16aa24cae`. |
| GitHub Actions CI | Passed | Slice 5BH confirmed run `28674129355` completed `Install, test, build, and launch-check` successfully for docs/status commit `1d2ea176b5759e98f30d038a8f3985ab299105af`. |
| GitHub Actions CI | Passed | Slice 5BJ confirmed run `28688152726` completed `Install, test, build, and launch-check` successfully for deployed commit `04d06d3351fa02154e258a35b84a379dd219db22`. |
| GitHub Actions CI | Passed | Slice 5BK confirmed run `28688693681` completed `Install, test, build, and launch-check` successfully for deployed commit `c377f6a9f0cc8e6c2dbbca53366e50767b30f272`. |
| GitHub Actions CI | Passed | Slice 5BM confirmed run `28690040884` completed `Install, test, build, and launch-check` successfully for deployed commit `c8acc1df271711d0b1c8e81419fbd76d5b6e2c4a`. |
| GitHub Actions CI | Passed | Slice 5BN confirmed run `28692255198` completed successfully for repository secret-redaction source commit `26444eda87e31a6c90c19f7a13f47c7e74706beb`. |
| GitHub Actions CI | Passed | Slice 5BP confirmed run `28700849720` completed `Install, test, build, and launch-check` successfully for commit `72592dacc1d6b3189fe7061aad6fd6ac932df72e`. |
| GitHub Actions CI | Passed | Slice 5BS confirmed run `28701971403` completed `Install, test, build, and launch-check` successfully for commit `e348fd6d076b2bf094dca1c77c372a2bbed612c4`. |
| GitHub Actions CI | Passed | Slice 5BV confirmed run `28703308473` completed `Install, test, build, and launch-check` successfully for commit `d8884884faba8b50cb73c7f827aa4f9871744d4a`. |
| `npm.cmd run launch:evidence` | Passed | Slice 5BV ran on a clean tree at commit `d8884884faba8b50cb73c7f827aa4f9871744d4a`; no unredacted secret-shaped values were found in launch evidence docs and no high-confidence unredacted production secret-shaped values were found in 518 tracked/unignored text files. |
| `node scripts/configure-render-gmail-oauth.mjs --status --use-render-cli-token` | Passed; not ready | Slice 5BV redacted status completed at `2026-07-04T10:41:40.483Z`; mailbox identity keys exist, but every supported booking-specific and fallback Gmail credential path remains `ready=false`. Values were omitted. |

## Launch Check Subcommands

| Subcommand | Result | Evidence Summary |
| --- | --- | --- |
| `npm.cmd run db:generate` | Passed | Prisma Client v6.19.3 generated successfully. |
| `npm.cmd run db:doctor` | Passed | `DATABASE_URL` and `E2E_DATABASE_URL` were configured to local `localhost:55432` databases; connectivity and migrate status were ok for both. The script redacted the password in URL output. DB-mutating E2E remained blocked because `ALLOW_DB_E2E=true` was not set. |
| `npm.cmd run lint` | Passed | ESLint completed without reported errors. |
| `npm.cmd run typecheck` | Passed | `tsc -b --noEmit` completed successfully. |
| `npm.cmd test` | Passed | Business rule tests passed. |
| `npm.cmd run test:e2e` | Passed | Documentation link smoke, internal worker route smoke, Playwright browser smoke, and E2E contract/browser smoke checks passed. DB-mutating workflow E2E was not requested. |
| `npm.cmd run build` | Passed | Typecheck and Vite production build passed. |
| `npm.cmd audit --audit-level=high` | Passed threshold | npm reported one moderate `js-yaml` advisory; the high audit threshold passed. |
| `npx.cmd prisma migrate status` | Passed | Local `sandbox_hotel_dev` schema was up to date with 11 migrations. |

## Evidence Decision

The current checkout is green in GitHub CI through Slice 5BV, and the local launch-evidence inventory/secret scan passes on a clean tree at commit `d8884884faba8b50cb73c7f827aa4f9871744d4a`. The authoritative local `launch:check` pass remains the Slice 5AV/5AT evidence unless rerun before release. Slice 5AT observed non-mutating E2E timeout/latency before the final pass; no gate was weakened and no production mutation was performed.

Post-merge update: Slice 5AY confirmed PR #150 merged into `origin/main` as `a01838a956f24164167ba7f91a7620a37de7f36d`, deployed live on Render deploy `dep-d93nr7nlk1mc739ldujg`, and passed the public setup-complete reprobe. Slice 5BF later confirmed deployed helper commit `0de2eb3d612a555dbd6cac92948becd16aa24cae` was live on Render deploy `dep-d93ud5nlk1mc73a2sbv0`. Slice 5BJ confirmed helper commit `04d06d3351fa02154e258a35b84a379dd219db22` was live on Render deploy `dep-d944ml4vikkc73bido10`. Slice 5BK confirmed commit `c377f6a9f0cc8e6c2dbbca53366e50767b30f272` was live on Render deploy `dep-d945194vikkc73bj92ng`. Slice 5BM confirms deployed runtime commit `c8acc1df271711d0b1c8e81419fbd76d5b6e2c4a` was live on Render deploy `dep-d945rdpkh4rs73ei9asg`. Slice 5BS confirms deployed runtime commit `e348fd6d076b2bf094dca1c77c372a2bbed612c4` was live on Render deploy `dep-d94daaflk1mc73b1m6m0`. Slice 5BV confirms current deployed runtime commit `d8884884faba8b50cb73c7f827aa4f9871744d4a` is live on Render deploy `dep-d94e5e7lk1mc73b3oh2g`, public deep health is green, public-edge proof passes, live/preflight checks pass, and setup-complete still returns the intended production-disabled `403`.

This does not close launch sign-off because several P0 items require live/account-owner proof:

- Production users/auth/RBAC/logout/unauthorized-access proof.
- Booking-email Gmail OAuth configuration and backfill proof, if booking-email capture is required for launch.
- Real production room inventory proof.
- Staging or controlled production-like core workflow acceptance.
- Redacted live secret key inventory/rotation metadata and owner confirmation.
- Named rollback/deputy/database recovery owners.
- WAF/rate-limit rule IDs, thresholds, and owner-approved test evidence.

## Next Recommended Slice

Capture account-owner proof for production auth/RBAC, room inventory, secrets, recovery ownership, and WAF/rate-limit rules. Rerun `npm.cmd run launch:check` before release if code, dependency, migration, or environment assumptions change.
