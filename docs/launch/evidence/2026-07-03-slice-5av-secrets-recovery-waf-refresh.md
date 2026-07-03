# Slice 5AV - Secrets, Recovery, And WAF Provider Posture Refresh

Date: 2026-07-03T03:58Z.

Verdict: partial/open. This slice refreshed read-only Render CLI, public health, and public edge evidence for the production provider posture. It did not close the P0 because live secret key inventory, rotation metadata, named recovery/rollback owners, latest recovery-point proof, retention-window proof, and upstream WAF/rate-limit rule IDs remain account-owner/provider-gated.

## Scope

- Target public host: `https://book.sandboxhotel.com`.
- Render workspace observed through CLI: `My Workspace` (`tea-d6n8kq14tr6s738stj5g`).
- Render project observed through CLI: `My project` (`prj-d6nm1vdm5p6s7398qg70`).
- Commands were read-only. No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed login, paid resource action, screenshots, or secret-value access was performed.
- No production secrets, raw database URLs, tokens, passwords, cookies, or private keys were printed or recorded.

## Commands And Results

| Command | Result | Evidence Summary |
| --- | --- | --- |
| `tool_search` for Render service/database/secret tooling | Passed; no usable Render MCP tools exposed | The session exposed no callable Render MCP service, database, secret, backup, or WAF/rate-limit tooling. CLI/dashboard evidence remains the available path. |
| `render --version` | Passed | Render CLI `v2.13.0`; CLI reported a newer version is available. |
| `render --help` filtered for deploy/service/env/secret/backup/recovery/WAF/rate commands | Passed | No top-level env-var, secret-manager, backup, recovery, WAF, or rate-limit command was listed. |
| `render services --help` | Passed | Only `create` and `instances` were exposed under `services`. |
| `render services env --help` | Passed; no env inventory | Returned services help, not a service env-var inventory command. |
| `render backups --help` | Failed as unsupported | CLI returned `unknown command "backups" for "render"`. |
| `render ea --help` | Passed | Early-access commands exposed object storage only. |
| `render whoami -o json` | Passed | CLI authenticated as the expected account email; no token or secret was printed. |
| `render workspaces -o json` | Passed | Confirmed workspace `My Workspace` (`tea-d6n8kq14tr6s738stj5g`). |
| `render projects -o json` | Passed | Confirmed project `My project` (`prj-d6nm1vdm5p6s7398qg70`). |
| `render environments prj-d6nm1vdm5p6s7398qg70 -o json` | Passed; risk remains | `Production` (`evm-d6nm1vdm5p6s7398qg7g`) reports `protectedStatus=unprotected`, `networkIsolationEnabled=false`, and IP allow list `0.0.0.0/0`. This is provider posture evidence, not WAF/rate-limit rule proof. |
| Sanitized `render services -o json` summary | Passed | Confirmed Postgres `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) is `available`, plan `basic_256mb`, region `oregon`; confirmed web service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) is a not-suspended `web_service` on branch `main`, auto-deploy `no`, health path `/healthz`, plan `starter`, region `oregon`, runtime `node`. |
| `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Latest live deploy remains `dep-d8i4q3favr4c73afbrg0`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`. |
| `render services instances srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Observed instance `srv-d6ns31h4tr6s73c9i8g0-2brwp`, created `2026-06-06T16:39:10Z`. |
| `npm.cmd run prod:preflight` | Passed with warning | Production preflight passed; LINE credentials remain unconfigured and live LINE messaging remains disabled. |
| `npm.cmd run live:check` | Passed | Public readiness check passed for `https://book.sandboxhotel.com`; LINE remains optional unless `LIVE_REQUIRE_LINE=true`; DNS resolved to `216.24.57.9` from this resolver. |
| Direct `GET /healthz?deep=1` | Passed | Returned `200`, JSON `ok=true`, database configured, database OK, `server=cloudflare`, `CF-RAY` present, and `X-Render-Origin-Server=Render`. |
| Public edge probes for `/.env`, `/wp-login.php`, `/phpmyadmin/`, `/vendor/` | Passed as denial behavior | Each returned `404` with Cloudflare response headers. This proves those public paths are not exposed through the edge; it does not prove customer-owned WAF/rate-limit rules. |
| `npm.cmd run launch:evidence` | Passed | Launch evidence inventory passed; no unredacted secret-shaped values were found in launch evidence docs and no high-confidence unredacted production secret-shaped values were found in tracked/unignored text files. |
| `git diff --check` | Passed with line-ending warnings | No whitespace errors were reported; Git warned that several working-copy files will be normalized from LF to CRLF when touched. |
| `npm.cmd run launch:check` | Passed | Current-checkout launch gate passed after the Slice 5AV evidence/status updates. DB-mutating E2E remained blocked unless `ALLOW_DB_E2E=true` is set for a disposable/staging database. |

## Evidence Boundary

- Runtime health confirms the app can reach its configured production database through the public health path.
- Render resource metadata confirms the observed web service and Postgres database still exist and are not suspended/unavailable.
- CLI command discovery confirms this available Render CLI path still does not expose safe env-var key inventory, rotation timestamps, latest backup/recovery-point metadata, or WAF/rate-limit rule IDs.
- The Render Production environment posture is still broad: unprotected, network isolation disabled, IP allow list `0.0.0.0/0`.
- Public edge probes only show Cloudflare routing and 404 behavior for selected paths; they do not prove managed WAF rules, rate-limit thresholds, protected hostnames, or owner-approved rate-limit tests.

## Still Required To Close P0

- Redacted production secret key inventory with required key names only.
- Secret rotation dates where available, or owner-confirmed rotation status where the provider does not expose timestamps.
- Cleanup/retention decision for legacy or compatibility keys, including rollback impact.
- Named rollback owner and deputy with Render dashboard access.
- Named database recovery owner with Render PostgreSQL access.
- Latest recovery point and retention window from Render dashboard/API, redacted where needed.
- Edge provider/zone owner confirmation, WAF/rate-limit rule IDs, thresholds, protected hostnames, and an owner-approved non-destructive test result.
