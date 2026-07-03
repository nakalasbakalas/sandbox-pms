# Slice 5E - Origin Sync And Deploy Boundary

Date: 2026-07-02.

Scope: reconcile the local checkout with the freshly fetched `origin/main` launch packet and verify whether an approved Render deploy/reprobe can close the setup-gate blocker. This slice did not deploy, restart, SSH, open a database shell, mutate production data, run production DB E2E, or access secret values.

## Commands

| Command | Result | Notes |
| --- | --- | --- |
| `git fetch origin` | Passed | Updated `origin/main` from `2ba7410e4684697237bf14980544a4084775821c` to `f5b0849037a55e2c99a3d781d742ba85d2384d8c`, merging PR #149 from `launch-finish-packet-20260702`. |
| `git stash push -u -m "codex-launch-sync-before-origin-main"` | Passed | Preserved the dirty local launch evidence/code work before syncing. No production secrets were printed. |
| `git merge --ff-only origin/main` | Passed | Fast-forwarded local `main` from `2ba7410...` to `f5b0849...`; upstream added tracked launch packet docs and `scripts/collect-launch-evidence.mjs`. |
| `git stash pop` | Partially applied with one conflict | Reapplied tracked local changes and evidence files. `package.json` conflicted only on the `launch:evidence` script target because upstream points to `scripts/collect-launch-evidence.mjs` while the local evidence gate points to `scripts/launch-evidence.mjs`. |
| Conflict resolution in `package.json` | Passed | Kept `launch:evidence` pointed at `scripts/launch-evidence.mjs` to preserve the stronger local evidence/secret-hygiene gate. Upstream `scripts/collect-launch-evidence.mjs` remains tracked as an additional snapshot helper. |
| `git restore --staged .` | Passed | Cleared the index back to an unstaged review state after conflict resolution; file contents were preserved. |
| `git rev-parse HEAD; git rev-parse origin/main; git diff --name-only; git ls-files --others --exclude-standard` | Passed | Local `HEAD` and `origin/main` are both `f5b0849037a55e2c99a3d781d742ba85d2384d8c`. Dirty tracked files remain local, and launch evidence files plus `scripts/launch-evidence.mjs` remain untracked. |
| `render deploys create --help` | Passed | Confirmed Render deploys can be triggered with an optional `--commit` and `--wait`. The command was not run. |
| `render.yaml` review | Passed | Long-term service deploys are production-sensitive: `autoDeploy=false`, build runs `npm ci --include=dev && npm run db:generate && npm run build`, and predeploy runs `npm run db:migrate && npm run db:seed`. |
| `render deploys list <service> -o json` | Passed | Long-term custom-domain service `sandbox-hotel-pms-v43m` remains live on `7adcc01c...`; alternate `sandbox-hotel-pms` remains live on `7adcc01c...`; launch service `sandbox-hotel-pms-launch` remains live on `5f5b5416...`. |
| `git diff -- server/pms-service.mjs scripts/run-business-tests.mjs` | Passed | Confirmed the setup-completion hardening and regression test are still local working-tree changes, not committed in `origin/main`. |
| `node -e "JSON.parse(...package.json...)"` | Passed | Confirmed `package.json` is valid JSON after conflict resolution. |
| Conflict marker scan for `package.json` and `docs/launch/*.md` | Passed | No `<<<<<<<`, `=======`, or `>>>>>>>` markers found in the checked files. |
| `npm.cmd run launch:evidence` | Passed | Ran on commit `f5b0849037a55e2c99a3d781d742ba85d2384d8c`, found 10 launch evidence files, and found no high-confidence unredacted production secret-shaped values in 440 tracked/unignored text files. |
| `git diff --check` | Passed | Exited 0. Git printed LF-to-CRLF working-copy warnings only; no whitespace errors were reported. |

## Evidence Decision

The local branch is now current with `origin/main`, but the setup-completion hardening required to close the live setup-gate blocker is still an uncommitted local diff in `server/pms-service.mjs` with its regression test in `scripts/run-business-tests.mjs`.

Triggering a Render deploy of current `origin/main` would not deploy that hardening. It would also be a production-sensitive action because the long-term service predeploy runs migrations and seed. Therefore this slice intentionally did not trigger `render deploys create`.

## Remaining P0 Blockers

- Live setup-completion hardening still needs an intentional publish path for the local setup-gate code/test changes, then an approved Render deploy and unauthenticated public reprobe.
- Production users/auth/RBAC/logout proof remains open.
- Real production room inventory proof remains open.
- Core hotel workflow proof remains open.
- Live provider secret inventory/rotation metadata and recovery ownership proof remain external/account-owner evidence gaps.
- Rollback owner/deputy, database recovery owner, and WAF/rate-limit rule evidence remain unproven.

## Next Recommended Slice

Prepare a focused publishable changeset for the setup-completion hardening and launch evidence docs, keeping unrelated Booking.com selector changes separate unless intentionally included. After that changeset is reviewed/pushed, deploy the exact commit to `sandbox-hotel-pms-v43m` and rerun the setup-complete unauthenticated probe against `https://book.sandboxhotel.com`.
