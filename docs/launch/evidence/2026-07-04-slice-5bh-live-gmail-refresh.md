# Slice 5BH - Live Gmail And Launch Status Refresh

Status: partial/open. The live app and public edge remain healthy, the launch issue tracker remains synced, and Booking Email capture remains blocked by missing backend Gmail OAuth credentials on Render.

## Scope

- Local date/time: 2026-07-04 morning, Asia/Bangkok.
- Repository: `nakalasbakalas/sandbox-pms`.
- Branch: `main`.
- Local checkout at refresh start: `1d2ea176b5759e98f30d038a8f3985ab299105af` (`Record launch issue tracker sync`).
- Current live Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`).
- Current live Render deploy: `dep-d93ud5nlk1mc73a2sbv0`, app/helper commit `0de2eb3d612a555dbd6cac92948becd16aa24cae`, finished `2026-07-03T16:45:40Z`.
- No source code change, deploy, restart, production database shell, production mutation, DB-mutating E2E, confirmed booking-email import, WAF mutation, provider setting change, or secret-value access was performed.

## Commands And Results

| Check | Result | Evidence Summary |
| --- | --- | --- |
| `git fetch --prune origin` | Passed | Local `main` remained synced with `origin/main` before docs edits. |
| `gh run list --branch main --limit 5` | Passed | Latest `main` CI run `28674129355` for commit `1d2ea176b5759e98f30d038a8f3985ab299105af` passed. |
| `render deploys list srv-d6ns31h4tr6s73c9i8g0 --output json` | Passed | Current live deploy remains `dep-d93ud5nlk1mc73a2sbv0`, app/helper commit `0de2eb3d612a555dbd6cac92948becd16aa24cae`. Docs-only commits after that are not claimed as deployed. |
| `npm.cmd run public-edge:proof` | Passed | At `2026-07-03T23:16:30.015Z`, `/healthz?deep=1` returned `200`, production environment, database configured/OK, Cloudflare headers, Render origin header, and common security-header presence. `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` returned `404`. Response bodies were omitted except bounded health fields. |
| `npm.cmd run live:check` | Passed | Public live readiness passed for `https://book.sandboxhotel.com`; DNS lookup resolved to `216.24.57.8`; LINE remains optional/unconfigured. |
| `npm.cmd run prod:preflight` | Passed with warning | Production preflight passed; LINE credentials remain unconfigured and live LINE messaging remains disabled. |
| Public `POST /api/setup/complete` with `{}` | Passed as denial | At `2026-07-03T23:16:39.932Z`, unauthenticated setup-complete returned `403` with the intended production-disabled setup message. |
| Local env key presence check | Missing inputs | No local process env values were present for supported Gmail OAuth key names or `RENDER_API_KEY`. Values were not printed. |
| `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` | Missing | At `2026-07-03T23:16:27.518Z`, Render reported all supported booking-specific and fallback Gmail credential paths `ready=false`; values and Render auth token were omitted. |
| Gmail connector profile check | Wrong account for this proof | The connector is reachable again, but the connected account is not `booking@sandboxhotel.com` and is not a production app-server credential path. No mailbox search or message-body scan was performed from this account. |
| `render jobs create ... "npm run booking-email:proof"` | Succeeded | Production one-off job `job-d94460uq1p3s73apai5g` ran the aggregate Booking Email capture proof and reached `succeeded` at `2026-07-03T23:17:48Z`. Render CLI logs did not return job stdout for the checked window. |
| `render jobs create ... "npm run booking-email:backfill -- --all-past --limit 250"` | Failed as expected while OAuth is missing | Production one-off job `job-d9446csvikkc73bh3ba0` ran dry-run historical backfill and reached `failed` at `2026-07-03T23:18:39Z`, consistent with missing backend Gmail OAuth. No confirmed import was run. |
| `gh issue list --state open` | Open issues unchanged | Open launch issues remain `#136`, `#137`, `#138`, `#140`, and `#142`. |
| GitHub issue `#142` status comment | Posted | <https://github.com/nakalasbakalas/sandbox-pms/issues/142#issuecomment-4879825330> records the July 4 live/Gmail refresh and keeps launch sign-off open. |

## Booking Email Decision

Booking Email historical scanning and visual review in `/booking-inbox` remain blocked at the mailbox-provider boundary:

- Server-side Gmail sync still needs one supported backend OAuth path configured on Render: booking-specific or fallback access token, or booking-specific or fallback refresh-token tuple.
- The current Gmail connector account is not the Sandbox booking mailbox and cannot be treated as production server credentials.
- No raw mailbox password, Gmail OAuth value, Render auth token, message body, sender, recipient, subject, guest data, payment data, or booking details were recorded.

## Evidence Decision

This slice refreshes current live and Gmail readiness evidence. It does not close launch sign-off because the remaining P0 blockers still require owner/provider proof or secure backend Gmail OAuth configuration.
