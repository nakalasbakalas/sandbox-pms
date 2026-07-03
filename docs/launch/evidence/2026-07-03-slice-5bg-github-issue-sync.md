# Slice 5BG - GitHub Launch Issue Sync

Status: partial/open. The GitHub issue tracker is synced with the current launch evidence, deployed runtime, and remaining owner/provider blockers. No launch issue was closed because the remaining acceptance criteria still require credentialed production or owner/provider proof.

## Scope

- Repository: `nakalasbakalas/sandbox-pms`.
- Branch: `main`.
- Docs/status commit at sync time: `c2525ccdda23fdf15f7b42a1cc67c40f88e9ce4f` (`Record public edge deploy evidence`).
- Current live runtime at sync time: Render deploy `dep-d93ud5nlk1mc73a2sbv0`, commit `0de2eb3d612a555dbd6cac92948becd16aa24cae`.
- No source code change, deploy, restart, production database shell, production mutation, credentialed login, mailbox scan, WAF mutation, provider setting change, or secret-value access was performed.

## Issue Comments Posted

| Issue | Comment | Sync Summary |
| --- | --- | --- |
| `#142` final QA and sign-off | <https://github.com/nakalasbakalas/sandbox-pms/issues/142#issuecomment-4878191707> | Current deployed runtime, docs commit, green CI, public health/setup proof, Gmail OAuth blocker, and remaining launch sign-off blockers. |
| `#137` production auth/setup/users/RBAC | <https://github.com/nakalasbakalas/sandbox-pms/issues/137#issuecomment-4878193327> | Setup-complete gate closed for current public deploy; production user table, credentialed role matrix, underprivileged denial, and setup-token cleanup proof still open. |
| `#140` database/inventory/DB E2E | <https://github.com/nakalasbakalas/sandbox-pms/issues/140#issuecomment-4878193333> | Production aggregate room counts remain recorded; owner/import source proof, DB E2E acceptance or staging rerun, and current recovery evidence still open. |
| `#136` launch scope decisions | <https://github.com/nakalasbakalas/sandbox-pms/issues/136#issuecomment-4878195103> | LINE, OTA, payments, booking-email, and WAF/rate-limit posture restated as owner/credential/provider-gated decisions. |
| `#138` dashboard/navigation acceptance | <https://github.com/nakalasbakalas/sandbox-pms/issues/138#issuecomment-4878195101> | Automated route/E2E proof remains green, but manual route acceptance, role-denial proof, localization review, and no-demo-copy sweep are still open. |

## Current Issue State After Sync

- `#136` remains open: launch-scope owner decisions and accepted deferrals still required.
- `#137` remains open: production auth/RBAC/logout evidence still required.
- `#138` remains open: manual route/workflow acceptance still required.
- `#140` remains open: room source-of-truth, DB E2E acceptance/staging proof, and recovery evidence still required.
- `#142` remains open: final launch sign-off still requires closure or owner acceptance of the remaining P0 blockers.

## Booking Email Boundary

The issue sync repeats the current booking-email blocker without exposing secrets:

- Backend booking-email tooling exists and is deployed in the current runtime lineage.
- `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` still reports all supported Gmail credential paths as `ready=false`.
- The Codex Gmail connector is not available for mailbox scanning in this session because the connector token is expired.
- Historical booking/cancellation backfill remains blocked until a supported backend Gmail OAuth credential path is configured on Render, then redacted dry-run backfill and proof jobs pass.

## Evidence Decision

This slice improves tracker alignment only. It does not reduce the production/account-owner proof burden and does not provide launch sign-off.
