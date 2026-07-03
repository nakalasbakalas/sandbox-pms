# Secret, Recovery, Rollback, and WAF Provider Posture

Status date: 2026-07-03.

Verdict: partial/open. Safe Render and public-edge metadata has been refreshed through Slice 5AY, but this does not close the P0. Secret rotation metadata, named recovery/rollback owners, latest recovery-point proof, and upstream WAF/rate-limit rule IDs still require account-owner/provider evidence.

## Scope

- Public target: `https://book.sandboxhotel.com`.
- Render workspace observed through CLI: `My Workspace` (`tea-d6n8kq14tr6s738stj5g`) with account email `nakalastravels@gmail.com`.
- Commands were read-only. No deploy, restart, SSH session, database shell, production mutation, DB-mutating E2E, paid resource action, or secret-value access was performed.
- No production secrets, raw database URLs, tokens, passwords, cookies, or screenshots were recorded.

## 2026-07-03 Slice 5AV Refresh

Slice 5AV adds `2026-07-03-slice-5av-secrets-recovery-waf-refresh.md` and refreshes the current read-only provider/public posture:

- `tool_search` exposed no callable Render MCP service, database, secret, backup, or WAF/rate-limit tooling in this session.
- `render --version` returned Render CLI `v2.13.0`; the CLI reported a newer version is available.
- `render --help` and targeted command help checks still exposed no top-level env-var, secret-manager, backup, recovery, WAF, or rate-limit command.
- `render workspaces -o json`, `render projects -o json`, and `render environments prj-d6nm1vdm5p6s7398qg70 -o json` confirmed workspace `My Workspace`, project `My project`, and a `Production` environment with `protectedStatus=unprotected`, `networkIsolationEnabled=false`, and IP allow list `0.0.0.0/0`.
- Sanitized `render services -o json` review confirmed the target web service is not suspended and the target Postgres resource remains `available`.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` confirmed the latest live custom-domain service deploy remains `dep-d8i4q3favr4c73afbrg0`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`.
- Direct public `GET /healthz?deep=1` returned `200`, database configured, database OK, `server=cloudflare`, `CF-RAY` present, and `X-Render-Origin-Server=Render`.
- Non-destructive probes for `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` returned `404` with Cloudflare response headers.
- `npm.cmd run prod:preflight` passed with the expected LINE-disabled warning; `npm.cmd run live:check` passed.

This refresh does not change the WAF/rate-limit boundary: public edge headers and 404 probes prove routing/denial behavior for selected paths, not customer-owned WAF or rate-limit rule configuration.

## 2026-07-03 Slice 5AY Update

Slice 5AY adds `2026-07-03-slice-5ay-housekeeping-sync.md` and refreshes the custom-domain service deploy and public edge health:

- `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` confirmed the latest live custom-domain service deploy is `dep-d93nr7nlk1mc739ldujg`, status `live`, commit `a01838a956f24164167ba7f91a7620a37de7f36d`, finished `2026-07-03T09:17:54Z`.
- `render services instances srv-d6ns31h4tr6s73c9i8g0 -o json` confirmed observed instance `srv-d6ns31h4tr6s73c9i8g0-8wxvc`, created `2026-07-03T09:17:22Z`.
- Direct public `GET /healthz?deep=1` returned `200`, database configured, database OK, `server=cloudflare`, `CF-RAY` present, and `X-Render-Origin-Server=Render`.
- Direct public setup-complete reprobe returned the intended production-disabled `403`.

This update proves the setup-gate hardening is live on the Cloudflare-fronted Render service. It still does not prove customer-owned WAF/rate-limit rule configuration.

## 2026-07-03 Slice 5BD Update

Slice 5BD adds `2026-07-03-slice-5bd-current-deploy-sync.md` and refreshes the custom-domain service deploy after the Render Gmail OAuth helper landed:

- `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit 163d49c2ff58eef5447e93f07d42babbf3b59d58 --wait --confirm --output json` deployed exact commit `163d49c2ff58eef5447e93f07d42babbf3b59d58`.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 --output json` confirmed latest live deploy `dep-d93t86hkh4rs73e0io4g`, status `live`, commit `163d49c2ff58eef5447e93f07d42babbf3b59d58`, finished `2026-07-03T15:26:55Z`.
- Direct public `GET /healthz?deep=1` returned `200`, database configured, database OK, `server=cloudflare`, `CF-RAY` present, and `X-Render-Origin-Server=Render`.
- Direct public setup-complete reprobe returned the intended production-disabled `403`.
- `npm.cmd run live:check` and `npm.cmd run prod:preflight` passed; preflight still warns that LINE credentials are not configured.

This update keeps app/deploy status current. It still does not prove customer-owned WAF/rate-limit rule configuration.

## 2026-07-03 Slice 5BE Update

Slice 5BE adds `2026-07-03-slice-5be-gmail-oauth-status-tool.md` and refreshes the custom-domain service deploy after the redacted Render Gmail OAuth status command landed:

- `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit ad2b7267d7ac625708b935fa058361e86dfa09fb --wait --confirm --output json` deployed exact commit `ad2b7267d7ac625708b935fa058361e86dfa09fb`.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 --output json` confirmed latest live deploy `dep-d93tr24vikkc73b3quug`, status `live`, commit `ad2b7267d7ac625708b935fa058361e86dfa09fb`, finished `2026-07-03T16:07:00Z`.
- Direct public `GET /healthz?deep=1` returned `200`, database configured, database OK, `server=cloudflare`, `CF-RAY` present, and `X-Render-Origin-Server=Render`.
- Direct public setup-complete reprobe returned the intended production-disabled `403`.
- `npm.cmd run live:check` and `npm.cmd run prod:preflight` passed; preflight still warns that LINE credentials are not configured.

This update keeps app/deploy status current. It still does not prove customer-owned WAF/rate-limit rule configuration.

## 2026-07-03 Slice 5AR Refresh

Slice 5AR adds `2026-07-03-slice-5ar-secrets-recovery-waf-refresh.md` and reconfirms the available Render CLI path still cannot safely expose env-var key inventory, secret rotation metadata, backup/recovery-point metadata, or WAF/rate-limit rule IDs:

- `render --help` lists no top-level env-var, secret-manager, backup, recovery, or WAF/rate-limit command.
- `render services --help` lists only `create` and `instances`.
- `render services env --help` returned services help only, not an env-var inventory subcommand.
- `render backups --help` returned `unknown command "backups" for "render"`.
- `render ea --help` exposes object storage only in this session.
- Sanitized `render services -o json` review confirmed the target service and database are not suspended, and the production database remains `available`.
- Public `GET /healthz?deep=1` returned `200`, production environment, and database OK at `2026-07-03T02:33:24.710Z`.

This refresh does not change the WAF/rate-limit boundary: public edge headers and 404 probes prove routing behavior, not customer-owned WAF or rate-limit rule configuration.

## 2026-07-03 Slice 5AC Refresh

Slice 5AC adds `SECRETS_AND_RECOVERY_PROOF.md` and confirms the available Render CLI path still cannot safely expose env-var key inventory or rotation metadata:

- `render env --help` returned `unknown command "env"`.
- `render ea --help` exposed only object-storage early-access commands in this session.
- Sanitized `render services -o json` selection confirmed the target service and database are not suspended, and the production database remains `available`.
- Public `GET /healthz?deep=1` returned `200`, production environment, and database OK at `2026-07-03T00:43:45.079Z`.

This refresh does not change the WAF/rate-limit boundary: public edge headers and 404 probes prove routing behavior, not customer-owned WAF or rate-limit rule configuration.

## Commands And Results

| Command | Result | Evidence Summary |
| --- | --- | --- |
| `render workspaces -o json` | Passed | Confirmed CLI workspace `My Workspace` (`tea-d6n8kq14tr6s738stj5g`); latest refresh Slice 5AV. |
| `render projects -o json` | Passed | Confirmed project `My project` (`prj-d6nm1vdm5p6s7398qg70`); latest refresh Slice 5AV. |
| `render environments prj-d6nm1vdm5p6s7398qg70 -o json` | Passed; risk remains | Environment `Production` (`evm-d6nm1vdm5p6s7398qg7g`) reports `protectedStatus=unprotected`, `networkIsolationEnabled=false`, and IP allow list `0.0.0.0/0`; latest refresh Slice 5AV. |
| `render services --help` / `render services env --help` / `render backups --help` / `render ea --help` | Mixed; no usable secret/recovery command | Slice 5AV found no service env-var inventory, backup/recovery-point, or WAF/rate-limit command exposed by the current CLI. `render backups --help` failed as an unsupported command. |
| `render services -o json` | Passed | Confirmed target service and datastore metadata without secret values; latest refresh Slice 5AV. |
| `render services instances srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Long-term service has one observed instance id `srv-d6ns31h4tr6s73c9i8g0-8wxvc`, created `2026-07-03T09:17:22Z` in the latest Slice 5AY refresh. |
| `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Current long-term custom-domain service deploy is `dep-d93tr24vikkc73b3quug`, status `live`, commit `ad2b7267d7ac625708b935fa058361e86dfa09fb`, finished `2026-07-03T16:07:00Z`. |
| `render deploys list srv-d8bchr1akrks73disaog -o json` | Passed | Alternate service deploy is `dep-d8ekph4p3tds738mdp6g`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-01T09:13:20.6391Z`. |
| `render deploys list srv-d8clkqho3t8c73a1eldg -o json` | Passed | Launch service deploy is `dep-d8oh74m47okc739vhq2g`, status `live`, commit `5f5b54162156a658bd37ec4c2d00941feea8d037`, finished `2026-06-16T09:13:59.052325Z`; this is not the custom-domain production target. |
| Public-edge probes | Passed | Slice 5AV direct `/healthz?deep=1` returned `200` with Cloudflare and Render origin headers; `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` returned `404` with Cloudflare response headers. |
| `npm.cmd run prod:preflight` | Passed with warning | Production preflight passed; LINE credentials remain unconfigured and live LINE messaging remains disabled. |
| `npm.cmd run live:check` | Passed | Public health/deep-health passed for `https://book.sandboxhotel.com`; LINE remains optional and unconfigured unless `LIVE_REQUIRE_LINE=true`. Latest Slice 5AV run resolved `book.sandboxhotel.com` to `216.24.57.9`. |

## Current Provider Posture

- Long-term custom-domain Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`).
- Current live deploy for that service: `dep-d93tr24vikkc73b3quug`, commit `ad2b7267d7ac625708b935fa058361e86dfa09fb`.
- Render PostgreSQL target remains `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) with status `available`, region `oregon`, and plan `basic_256mb` as reported by safe service metadata.
- Render Production environment metadata reports `protectedStatus=unprotected`, `networkIsolationEnabled=false`, and IP allow list `0.0.0.0/0`.
- Public edge responses prove routing/denial behavior only. They do not prove customer-owned Cloudflare zone control, managed WAF rules, rule IDs, thresholds, or rate-limit behavior.

## Secret Evidence Boundary

- Local repository secret hygiene remains covered by `npm.cmd run launch:evidence`.
- Runtime behavior previously proved a production `SESSION_SECRET` exists because invalid session-cookie probes return `401` instead of a production secret-missing failure.
- The Render CLI commands used in this slice do not expose env-var key inventory or rotation timestamps safely.
- No provider secret values were requested or recorded.

Still required:

- Redacted Render secret key inventory.
- Rotation dates or owner-confirmed rotation status where the provider exposes them.
- Cleanup decision for legacy/compatibility key names such as older bootstrap/admin keys, with rollback impact considered.
- Owner confirmation that required production secrets are stored in Render/provider secret storage and not in repo files.

## Recovery And Rollback Boundary

- `docs/disaster-recovery.md` was updated to use the current live deploy `dep-d93tr24vikkc73b3quug` as the latest health-checked live deploy reference.
- A disposable restore test from 2026-06-07 remains recorded in `docs/live-environment-proof.md`; this slice did not create another restore target.
- The current slice did not test a live rollback because that is a production-sensitive action and no rollback owner/deputy has been named.

Still required:

- Named rollback owner with Render dashboard access.
- Named rollback deputy with Render dashboard access.
- Named database recovery owner with Render PostgreSQL access.
- Latest recovery point/retention proof from the Render dashboard or API, with values redacted where needed.
- Tested rollback path or a launch-owner accepted risk with owner/date/expiry.

## WAF And Rate-Limit Boundary

Non-destructive public probes:

| Path | Status | Edge Evidence |
| --- | ---: | --- |
| `/.env` | 404 | Cloudflare response headers present |
| `/wp-login.php` | 404 | Cloudflare response headers present |
| `/phpmyadmin/` | 404 | Cloudflare response headers present |
| `/vendor/` | 404 | Cloudflare response headers present |
| `/healthz?deep=1` | 200 | Cloudflare response headers and Render origin header present |

Still required:

- Edge provider/zone owner confirmation.
- WAF or rate-limit rule IDs.
- Protected hostnames.
- Thresholds and actions.
- Non-destructive rate-limit/WAF test result approved by the edge owner.
