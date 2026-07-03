# Current Checkout Launch Gate Results

Status date: 2026-07-03.

Verdict: the deployed public-edge-helper commit is green in CI, with focused local checks also green. Slice 5BF GitHub Actions run `28672978563` passed `Install, test, build, and launch-check` for commit `0de2eb3d612a555dbd6cac92948becd16aa24cae`, and Slice 5BF deployed that commit to the custom-domain Render service. This proves engineering gate health for the deployed runtime commit, not production/account-owner launch sign-off.

Update: Slice 5AT also reran the non-destructive Slice 0 baseline validation ladder in the same checkout and all commands passed. See `2026-07-03-slice-5at-baseline-validation-refresh.md` and `DB_DOCTOR_RESULTS.md`. Later Slice 5BF records deploy/probe evidence for commit `0de2eb3d612a555dbd6cac92948becd16aa24cae`.

## Scope

- Branch: `main`.
- Commit: `0de2eb3d612a555dbd6cac92948becd16aa24cae`.
- Worktree: clean after Slice 5BF public-edge-helper commit; Slice 5BF adds current deploy/public-edge evidence.
- Production posture: no deploy, restart, SSH session, production database shell, production mutation, DB-mutating E2E against production, or secret-value access was performed.
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

The current checkout passes the authoritative local launch gate after the Slice 5AV evidence/status updates. Slice 5AT observed non-mutating E2E timeout/latency before the final pass; no gate was weakened and no production mutation was performed.

Post-merge update: Slice 5AY confirmed PR #150 merged into `origin/main` as `a01838a956f24164167ba7f91a7620a37de7f36d`, deployed live on Render deploy `dep-d93nr7nlk1mc739ldujg`, and passed the public setup-complete reprobe. Slice 5BF later confirmed current deployed helper commit `0de2eb3d612a555dbd6cac92948becd16aa24cae` is live on Render deploy `dep-d93ud5nlk1mc73a2sbv0`, public deep health is green, public-edge proof passes, and setup-complete still returns the intended production-disabled `403`.

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
