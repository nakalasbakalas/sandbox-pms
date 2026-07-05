# Slice 5BX - Current Status Sync After Gmail Backfill

Status date: 2026-07-05.

Verdict: documentation and issue status are synced after the Gmail OAuth/backfill slice. This slice does not add new production owner proof and does not change launch readiness.

## Scope

- Confirm current `main` is clean after the Gmail OAuth/backfill evidence commits.
- Confirm final docs-only CI is green.
- Remove stale next-step wording that still suggested configuring Gmail OAuth after Render already reported the booking-specific refresh-token tuple `ready=true`.
- Keep remaining P0 blockers explicit.

## Evidence

| Check | Result | Notes |
| --- | --- | --- |
| Worktree | Clean | `git status --short` returned no entries before this documentation update. |
| Final docs-only CI | Passed | GitHub CI run `28726783220` passed for commit `6373ba5206cee3ecf196c7b7a37f19b954fa7db4`, including lint, typecheck, business tests, E2E smoke, build, and launch gate. |
| Recent CI chain | Passed | GitHub CI runs `28726046155`, `28726322076`, `28726610725`, and `28726783220` are all green for the Gmail/backfill code, evidence, live-proof register, and final live-proof note commits. |
| Open launch issues | Still open | `gh issue list --state open --limit 30` returned launch issues `#142`, `#140`, `#138`, `#137`, and `#136` open. No issue was closed because owner/provider proof remains missing. |
| Gmail OAuth status | Ready from prior slice | Slice 5BW records `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` returning `ready=true` for the booking-specific refresh-token tuple, with values omitted. |

## Remaining Work

- Run `npm.cmd run auth-rbac:proof` from a secure owner shell with approved production users to collect credentialed login/logout, role matrix, and underprivileged denial proof.
- Collect owner/source proof that the production room inventory counts came from the approved real property source and not fake seed/demo data.
- Record owner acceptance of local disposable DB workflow proof or provide an approved staging target for DB-mutating E2E.
- Collect redacted provider secret inventory/rotation decisions, rollback owner/deputy, database recovery owner, latest recovery point/retention proof, and Cloudflare WAF/rate-limit rule evidence.
- Have approved staff/admin review imported `/booking-inbox` events before applying any reservation, cancellation, payment, or guest-message action.
