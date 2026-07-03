# Slice 5I - PR CI Green

Date: 2026-07-02.

Scope: verify GitHub Actions CI for draft PR #150 after publishing the focused setup-completion hardening branch. This slice did not deploy, restart, SSH, open a database shell, mutate production data, run DB-mutating E2E against production, or access secret values.

## Commands

| Command | Result | Notes |
| --- | --- | --- |
| `gh pr view 150 --json number,title,url,state,isDraft,headRefName,headRefOid,baseRefName,mergeable,statusCheckRollup` | Passed | PR #150 is open, draft, mergeable, base `main`, head `codex/setup-gate-launch-proof`, head SHA `75810c3fbcf73d6f8a790a607beb3bb3b0bf69a0`. |
| `gh run list --branch codex/setup-gate-launch-proof --limit 5 --json ...` | Passed | Initially showed CI runs in progress for `75810c3...` and previous `ca49fb8...`. |
| `gh run view 28571649967 --json ... jobs` | Passed | Latest CI run for `75810c3...` completed successfully. |
| `npm.cmd run launch:evidence` | Passed | Found 14 launch evidence files and no high-confidence unredacted production secret-shaped values in 444 tracked/unignored text files. |
| `git diff --check` | Passed | Exited 0. Git printed LF-to-CRLF working-copy warnings only; no whitespace errors were reported. |

## CI Result

- PR: `https://github.com/nakalasbakalas/sandbox-pms/pull/150`
- Workflow: `CI`
- Run: `https://github.com/nakalasbakalas/sandbox-pms/actions/runs/28571649967`
- Job: `Install, test, build, and launch-check`
- Head SHA: `75810c3fbcf73d6f8a790a607beb3bb3b0bf69a0`
- Status: completed
- Conclusion: success
- Started: `2026-07-02T06:59:52Z`
- Completed: `2026-07-02T07:06:21Z`

## Successful CI Steps

- Set up job
- Check out repository
- Set up Node.js
- Install dependencies
- Install Playwright Chromium
- Generate Prisma client
- Lint
- Typecheck
- Business tests
- E2E smoke tests
- Build
- Launch gate

## Evidence Decision

The focused setup-completion hardening PR has a green CI run on head SHA `75810c3fbcf73d6f8a790a607beb3bb3b0bf69a0`.

This does not prove live production behavior. The PR is still draft, and the custom-domain Render service has not deployed this head SHA.

This evidence file is intentionally recorded locally after the green run. Pushing it as an additional PR commit would change the PR head SHA and trigger a new CI run, so treat the CI proof as tied to `75810c3...` unless this evidence commit is later pushed and CI is rerun.

## Remaining P0 Blockers

- Live setup-completion hardening still needs review/approval, deployment of the exact reviewed commit, and public unauthenticated setup-complete reprobe.
- Production users/auth/RBAC/logout proof remains open.
- Real production room inventory proof remains open.
- Core hotel workflow proof remains open.
- Live provider secret inventory/rotation metadata and recovery ownership proof remain external/account-owner evidence gaps.
- Rollback owner/deputy, database recovery owner, and WAF/rate-limit rule evidence remain unproven.

## Next Recommended Slice

Review/approve PR #150 or explicitly decide whether to keep it draft. After approval, deploy the exact reviewed commit to `sandbox-hotel-pms-v43m` and rerun the unauthenticated setup-complete probe against `https://book.sandboxhotel.com`.
