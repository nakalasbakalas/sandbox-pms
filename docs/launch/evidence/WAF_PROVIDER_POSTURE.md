# Secret, Recovery, Rollback, and WAF Provider Posture

Status date: 2026-07-02.

Verdict: partial/open. This slice refreshed safe Render and public-edge metadata and corrected the current rollback deploy reference, but it does not close the P0. Secret rotation metadata, named recovery/rollback owners, and upstream WAF/rate-limit rule IDs still require account-owner/provider evidence.

## Scope

- Public target: `https://book.sandboxhotel.com`.
- Render workspace observed through CLI: `My Workspace` (`tea-d6n8kq14tr6s738stj5g`) with account email `nakalastravels@gmail.com`.
- Commands were read-only. No deploy, restart, SSH session, database shell, production mutation, DB-mutating E2E, paid resource action, or secret-value access was performed.
- No production secrets, raw database URLs, tokens, passwords, cookies, or screenshots were recorded.

## Commands And Results

| Command | Result | Evidence Summary |
| --- | --- | --- |
| `render workspaces -o json` | Passed | Confirmed CLI workspace `My Workspace` (`tea-d6n8kq14tr6s738stj5g`). |
| `render projects -o json` | Passed | Confirmed project `My project` (`prj-d6nm1vdm5p6s7398qg70`). |
| `render environments prj-d6nm1vdm5p6s7398qg70 -o json` | Passed | Environment `Production` (`evm-d6nm1vdm5p6s7398qg7g`) reports `protectedStatus=unprotected`, `networkIsolationEnabled=false`, and IP allow list `0.0.0.0/0`. |
| `render services -o json` | Passed | Confirmed target service and datastore metadata without secret values. |
| `render services instances srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Long-term service has one observed instance id `srv-d6ns31h4tr6s73c9i8g0-2brwp`, created `2026-06-06T16:39:10Z`. |
| `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Current long-term custom-domain service deploy is `dep-d8i4q3favr4c73afbrg0`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`. |
| `render deploys list srv-d8bchr1akrks73disaog -o json` | Passed | Alternate service deploy is `dep-d8ekph4p3tds738mdp6g`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-01T09:13:20.6391Z`. |
| `render deploys list srv-d8clkqho3t8c73a1eldg -o json` | Passed | Launch service deploy is `dep-d8oh74m47okc739vhq2g`, status `live`, commit `5f5b54162156a658bd37ec4c2d00941feea8d037`, finished `2026-06-16T09:13:59.052325Z`; this is not the custom-domain production target. |
| Node `fetch` public-edge probes | Passed | `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` returned `404`; `/healthz?deep=1` returned `200`. Each response exposed Cloudflare and Render edge headers. |
| `npm.cmd run live:check` | Passed | Public health/deep-health passed for `https://book.sandboxhotel.com`; LINE remains optional and unconfigured unless `LIVE_REQUIRE_LINE=true`. |

## Current Provider Posture

- Long-term custom-domain Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`).
- Current live deploy for that service: `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`.
- Render PostgreSQL target remains `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) with status `available`, primary role, PostgreSQL 17, region `oregon`, plan `basic_256mb`, disk 15 GB, and not suspended as reported by safe service metadata.
- Public edge responses include Cloudflare and Render headers, but this proves routing only. It does not prove customer-owned Cloudflare zone control, managed WAF rules, rule IDs, thresholds, or rate-limit behavior.

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

- `docs/disaster-recovery.md` was updated to use the current live deploy `dep-d8i4q3favr4c73afbrg0` as the latest health-checked live deploy reference.
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
| `/.env` | 404 | Cloudflare and Render headers present |
| `/wp-login.php` | 404 | Cloudflare and Render headers present |
| `/phpmyadmin/` | 404 | Cloudflare and Render headers present |
| `/vendor/` | 404 | Cloudflare and Render headers present |
| `/healthz?deep=1` | 200 | Cloudflare and Render headers present |

Still required:

- Edge provider/zone owner confirmation.
- WAF or rate-limit rule IDs.
- Protected hostnames.
- Thresholds and actions.
- Non-destructive rate-limit/WAF test result approved by the edge owner.
