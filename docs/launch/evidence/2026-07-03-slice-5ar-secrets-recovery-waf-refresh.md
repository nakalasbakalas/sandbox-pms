# Slice 5AR - Secrets, Recovery, And WAF Provider Posture Refresh

Date: 2026-07-03T09:32:59.6934670+07:00.

Verdict: partial/open. Safe Render workspace, service, database, deploy, live health, and public-edge metadata were refreshed, but this does not close launch sign-off. Secret key inventory, rotation timestamps, latest recovery point/retention proof, named rollback/deputy/database recovery owners, and upstream WAF/rate-limit rule IDs remain owner/provider-gated.

## Scope Boundary

- No deploy, restart, SSH session, interactive database shell, production database mutation, DB-mutating E2E, credentialed production login, screenshot capture, paid resource action, or secret-value access was performed.
- No production database URL, token, password, cookie, private key, session value, or raw secret value was requested or recorded.
- Public probes were non-destructive and limited to common denied paths plus `/healthz?deep=1`.

## Commands And Results

| Command | Result | Evidence Summary |
| --- | --- | --- |
| `render --help` | Passed | Render CLI v2.13.0 exposes deploys, jobs, logs, restart, services, workflows, workspaces, login, whoami, workspace, kv-cli, pgcli, psql, ssh, blueprints, environments, projects, docs, early access, and skills. No top-level env-var, secret-manager, backup, or recovery command is listed. |
| `render services --help` | Passed | `services` exposes `create` and `instances`; no env-var or secret inventory subcommand is listed. |
| `render services env --help` | Passed as services help only | The command returned `render services` help with only `create` and `instances`, so no usable non-interactive service-env subcommand was exposed. |
| `render backups --help` | Failed as unsupported command | Render CLI returned `unknown command "backups" for "render"`. |
| `render ea --help` | Passed | Early-access commands expose object storage only in this session; no secret-manager, backup, recovery, or WAF command is listed. |
| `render whoami -o json` | Passed | Confirmed the CLI is authenticated. The output includes the account email but no secret values. |
| `render workspaces -o json` | Passed | Confirmed workspace `My Workspace` (`tea-d6n8kq14tr6s738stj5g`) as a team workspace. |
| `render projects -o json` | Passed | Confirmed project `My project` (`prj-d6nm1vdm5p6s7398qg70`). |
| `render environments prj-d6nm1vdm5p6s7398qg70 -o json` | Passed | The `Production` environment reports `protectedStatus=unprotected`, `networkIsolationEnabled=false`, and IP allow list `0.0.0.0/0`. This is environment metadata, not WAF/rate-limit proof. |
| Sanitized `render services -o json` review | Passed | Confirmed Render PostgreSQL `sandbox-hotel-pms-db-v43m` is `available`, primary, PostgreSQL 17, region `oregon`, plan `basic_256mb`, 15 GB disk, and not suspended. Confirmed `sandbox-hotel-pms-v43m` is a not-suspended web service for `nakalasbakalas/sandbox-pms`, health path `/healthz`, starter plan, region `oregon`. |
| `render services instances srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Confirmed one observed instance `srv-d6ns31h4tr6s73c9i8g0-2brwp`, created `2026-06-06T16:39:10Z`. |
| `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Latest live deploy remains `dep-d8i4q3favr4c73afbrg0`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`. |
| Public edge probes for `/.env`, `/wp-login.php`, `/phpmyadmin/`, `/vendor/` | Passed as non-destructive probes | Each path returned `404` with Cloudflare and Render headers present. This proves routing/edge behavior only, not customer-owned WAF/rate-limit rules. |
| `GET https://book.sandboxhotel.com/healthz?deep=1` | Passed | Returned `200`, `ok=true`, production environment, database configured and OK, LINE webhook not configured, timestamp `2026-07-03T02:33:24.710Z`. |
| `npm.cmd run live:check` | Passed | Live readiness check passed for `https://book.sandboxhotel.com`; LINE remains optional unless `LIVE_REQUIRE_LINE=true`. |

## Evidence Decision

This slice strengthens current provider posture evidence without accessing secrets or mutating production. The live app remains healthy and the target Render service/database remain available, but no command output proves secret rotation, secret custody, backup/recovery-point freshness, rollback ownership, or upstream WAF/rate-limit configuration.

The P0 remains open until account-owner/provider evidence supplies:

- Redacted Render secret key inventory and rotation dates, or owner-confirmed rotation status where timestamps are unavailable.
- Cleanup/retention decision for legacy/compatibility env keys with rollback impact considered.
- Named rollback owner, rollback deputy, and database recovery owner with Render access.
- Latest recovery point and retention window from Render dashboard/API.
- WAF/rate-limit provider, owner, protected hostnames, rule IDs, thresholds/actions, and owner-approved non-destructive test result.

## Next Recommended Slice

Collect owner/provider evidence for secret inventory and recovery ownership. If owner-gated evidence is unavailable, continue with PR #150 approval/deploy/reprobe or credentialed production auth/RBAC proof.
