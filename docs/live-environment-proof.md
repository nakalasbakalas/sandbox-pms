# Live Environment Proof Register

Latest validation refresh: 2026-07-04.
Latest external provider evidence refresh: 2026-07-04T17:43+07:00.

This register records point-in-time external evidence gathered from the live Render workspace, public HTTPS endpoints, DNS, and provider documentation. It must not contain secret values. Use the Render dashboard or CLI for the current deploy ID after later documentation-only releases.

## 2026-07-04T17:43+07:00 Current Main Runtime Sync

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: deploy current green `main` to the long-term Render service, run public setup/deep-health/public-edge probes, run live readiness and production preflight, and refresh redacted Render Gmail OAuth status. No secret values, credentialed PMS login, production database shell, production data mutation, confirmed booking-email import, WAF mutation, provider setting change, screenshot capture, or DB-mutating E2E was performed.
- GitHub CI run `28703308473` passed for commit `d8884884faba8b50cb73c7f827aa4f9871744d4a`, including lint, typecheck, business tests, E2E smoke, build, and launch gate.
- `npm.cmd run launch:evidence` passed on a clean tree at commit `d8884884faba8b50cb73c7f827aa4f9871744d4a`, with dirty entries `0` and no high-confidence production secret findings in `518` tracked/unignored text files.
- Render deploy `dep-d94e5e7lk1mc73b3oh2g` is live on `sandbox-hotel-pms-v43m`, serving commit `d8884884faba8b50cb73c7f827aa4f9871744d4a`, finished `2026-07-04T10:41:18.349146Z`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and `Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.` at `2026-07-04T10:42:02Z`.
- `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, production environment, and database configured/OK at `2026-07-04T10:42:21.866Z`.
- The first `npm.cmd run public-edge:proof` attempt aborted immediately after deploy; a retry passed at `2026-07-04T10:42:23.971Z`: `/healthz?deep=1` returned `200`, production environment, database configured/OK, Cloudflare headers, Render origin header, selected common unwanted paths returned `404`, and response bodies were omitted except bounded health fields.
- `npm.cmd run live:check` passed for `https://book.sandboxhotel.com`; LINE remains optional/unconfigured unless explicitly required.
- `npm.cmd run prod:preflight` passed with the expected warning that LINE credentials are not configured and live LINE messaging remains disabled.
- `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` returned `ready=false` at `2026-07-04T10:41:40.483Z`: non-secret mailbox identity keys existed, but all supported booking-specific and fallback credential keys were still missing. Values and Render auth tokens were omitted.
- Canonical evidence: `docs/launch/evidence/2026-07-04-slice-5bv-current-main-runtime-sync.md`.

Still not proven by this refresh:

- Booking-email capture/backfill with real Gmail data; backend Gmail OAuth credentials remain missing.
- Approved production user list, credentialed login/logout proof, role matrix, underprivileged denial proof, and bootstrap/setup-token rotation or retention decision.
- Owner/import proof confirming production room inventory is the approved real source and not fake seed/demo data.
- Explicit owner decision accepting local disposable DB workflow proof or requiring staging/controlled production-like evidence.
- Redacted secret inventory/rotation metadata, named rollback owner/deputy/database recovery owner, latest recovery point/retention proof, WAF/rate-limit rule metadata, and legacy key cleanup decisions.

## 2026-07-04T16:44+07:00 Current Main Render Deploy Sync

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: deploy current green `main` to the long-term Render service, run public setup/deep-health/public-edge probes, and refresh redacted Render Gmail OAuth status. No secret values, credentialed PMS login, production database shell, production data mutation, confirmed booking-email import, WAF mutation, provider setting change, screenshot capture, or DB-mutating E2E was performed.
- GitHub CI run `28701971403` passed for commit `e348fd6d076b2bf094dca1c77c372a2bbed612c4`, including lint, typecheck, business tests, E2E smoke, build, and launch gate.
- Render deploy `dep-d94daaflk1mc73b1m6m0` is live on `sandbox-hotel-pms-v43m`, serving commit `e348fd6d076b2bf094dca1c77c372a2bbed612c4`, finished `2026-07-04T09:43:28.291471Z`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and `Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.` at `2026-07-04T09:43:42Z`.
- `GET https://book.sandboxhotel.com/healthz?deep=1` returned `ok=true`, production environment, and database configured/OK at `2026-07-04T09:43:42.591Z`.
- `npm.cmd run public-edge:proof` passed at `2026-07-04T09:43:55.241Z`: `/healthz?deep=1` returned `200`, production environment, database configured/OK, Cloudflare headers, Render origin header, selected common unwanted paths returned `404`, and response bodies were omitted except bounded health fields.
- `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` returned `ready=false` at `2026-07-04T09:43:42.829Z`: non-secret mailbox identity keys existed, but all supported booking-specific and fallback credential keys were still missing. Values and Render auth tokens were omitted.
- Canonical evidence: `docs/launch/evidence/2026-07-04-slice-5bs-current-main-render-deploy.md`.

Still not proven by this refresh:

- Booking-email capture/backfill with real Gmail data; backend Gmail OAuth credentials remain missing.
- Approved production user list, credentialed login/logout proof, role matrix, underprivileged denial proof, and bootstrap/setup-token rotation or retention decision.
- Owner/import proof confirming production room inventory is the approved real source and not fake seed/demo data.
- Explicit owner decision accepting local disposable DB workflow proof or requiring staging/controlled production-like evidence.
- Redacted secret inventory/rotation metadata, named rollback owner/deputy/database recovery owner, latest recovery point/retention proof, WAF/rate-limit rule metadata, and legacy key cleanup decisions.

## 2026-07-04T16:05+07:00 Gmail Mailbox Discovery And Backend OAuth Boundary

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: read-only Gmail connector profile/search, redacted Render Gmail OAuth status, and aggregate-only Booking Email proof job status. No Gmail body export, attachment download, Gmail mutation, Render env-var mutation, deploy, production database shell, production data mutation, confirmed import, or DB-mutating E2E was performed.
- Gmail connector profile returned `booking@sandboxhotel.com`.
- Read-only Gmail provider-sender discovery returned the first `100` message IDs with more pages available. The latest summary page included Agoda, Trip.com, and LittleHotelier booking messages from 2026-07-03 and 2026-07-04. Message IDs, subjects, guest names, raw text, and payment data are omitted.
- Subject-focused cancellation discovery returned at least `100` message IDs with more pages available. The latest summary page included LittleHotelier, Trip.com, and Ascend Travel cancellation-style messages. Message details are omitted.
- `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` returned `ready=false` at `2026-07-04T09:01:27.767Z`: the non-secret mailbox identity keys existed, but all supported booking-specific and fallback credential keys were still missing. Values and Render auth tokens were omitted.
- Render one-off job `job-d94cogtckfvc739odqig` ran `npm run booking-email:proof` and succeeded at `2026-07-04T09:03:26Z`; Render CLI logs did not return job stdout for the checked window.
- Canonical evidence: `docs/launch/evidence/2026-07-04-slice-5bq-gmail-mailbox-discovery.md`.

Still not proven by this refresh:

- PMS booking-email capture/backfill with real Gmail data; backend Gmail OAuth credentials remain missing.
- Review-only import into `/booking-inbox`; no `--confirm` backfill was run.

## 2026-07-04T08:15+07:00 Render Gmail Mailbox Identity Config

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: configure non-secret booking mailbox identifiers on Render, deploy current green `main`, run public health/setup probes, public-edge proof, production preflight, redacted Render Gmail OAuth status, and Booking Email proof/backfill jobs. No secret values, credentialed PMS login, production database shell, production mutation, confirmed booking-email import, WAF mutation, provider secret change, or screenshot capture was performed.
- GitHub CI run `28690040884` passed for commit `c8acc1df271711d0b1c8e81419fbd76d5b6e2c4a`, including lint, typecheck, business tests, E2E smoke, build, and launch gate.
- Render deploy `dep-d945rdpkh4rs73ei9asg` is live on `sandbox-hotel-pms-v43m`, serving commit `c8acc1df271711d0b1c8e81419fbd76d5b6e2c4a`, finished `2026-07-04T01:13:46Z`.
- `BOOKING_EMAIL_PRIMARY_MAILBOX` and `BOOKING_EMAIL_GMAIL_USER_ID` were set on Render as non-secret booking mailbox identifiers. Values are operational mailbox identifiers, not tokens.
- `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` returned `ready=false` at `2026-07-04T01:14:08.509Z`: the two mailbox identity keys existed, but all supported booking-specific and fallback credential keys were still missing. Values and Render auth tokens were omitted.
- `npm.cmd run public-edge:proof` passed at `2026-07-04T01:14:11.343Z`: `/healthz?deep=1` returned `200`, production environment, database configured/OK, Cloudflare headers, Render origin header, selected common unwanted paths returned `404`, and response bodies were omitted except bounded health fields.
- `npm.cmd run live:check` passed; DNS lookup resolved `book.sandboxhotel.com` to `216.24.57.9`; LINE remains optional/unconfigured.
- `npm.cmd run prod:preflight` passed with the expected LINE-disabled warning.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and `Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.`
- The connected Codex Gmail account was `Nick@intercellartrading.com`, not `booking@sandboxhotel.com`; the connector cannot provide backend OAuth refresh tokens.
- No local process values were present for supported booking-specific/fallback Gmail OAuth keys. `npm.cmd run gmail-oauth:render` exited before URL generation because no `BOOKING_EMAIL_GMAIL_CLIENT_ID` or `GMAIL_CLIENT_ID` was present.
- Local `npm.cmd run booking-email:backfill -- --all-past --limit 250` failed before scanning with missing Gmail OAuth credentials.
- Render one-off job `job-d945stmq1p3s73asuam0` ran `npm run booking-email:proof` and succeeded at `2026-07-04T01:15:04Z`; Render CLI logs did not return job stdout for the checked window.
- Render one-off job `job-d945stsvikkc73bl8rt0` ran `npm run booking-email:backfill -- --all-past --limit 250` and failed at `2026-07-04T01:14:59Z` while backend Gmail OAuth credentials remained missing. No confirmed import was run.
- Canonical evidence: `docs/launch/evidence/2026-07-04-slice-5bm-render-gmail-mailbox-config.md`.

Still not proven by this refresh:

- Booking-email capture/backfill with real Gmail data; backend Gmail OAuth credentials remain missing.
- Approved production user list, credentialed login/logout proof, role matrix, underprivileged denial proof, and bootstrap/setup-token rotation or retention decision.
- Owner/import proof confirming production room inventory is the approved real source and not fake seed/demo data.
- Explicit owner decision accepting local disposable DB workflow proof or requiring staging/controlled production-like evidence.
- Redacted secret inventory/rotation metadata, named rollback owner/deputy/database recovery owner, latest recovery point/retention proof, WAF/rate-limit rule metadata, and legacy key cleanup decisions.

## 2026-07-04T07:19+07:00 Current Main Deploy And Gmail Boundary

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: deploy current green `main` evidence commit, run public health/setup probes, public-edge proof, production preflight, redacted Render Gmail OAuth status, Gmail connector account posture, and Booking Email proof/backfill jobs. No secret values, credentialed PMS login, production database shell, production mutation, confirmed booking-email import, WAF mutation, provider setting change, or screenshot capture was performed.
- GitHub CI run `28688693681` passed for commit `c377f6a9f0cc8e6c2dbbca53366e50767b30f272`, including lint, typecheck, business tests, E2E smoke, build, and launch gate.
- Render deploy `dep-d945194vikkc73bj92ng` is live on `sandbox-hotel-pms-v43m`, serving commit `c377f6a9f0cc8e6c2dbbca53366e50767b30f272`, finished `2026-07-04T00:18:12Z`.
- `npm.cmd run public-edge:proof` passed at `2026-07-04T00:18:32.148Z`: `/healthz?deep=1` returned `200`, production environment, database configured/OK, Cloudflare headers, Render origin header, selected common unwanted paths returned `404`, and response bodies were omitted except bounded health fields.
- `npm.cmd run live:check` passed; DNS lookup resolved `book.sandboxhotel.com` to `216.24.57.9`; LINE remains optional/unconfigured.
- `npm.cmd run prod:preflight` passed with the expected LINE-disabled warning.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and `Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.`
- `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` returned `ready=false` for all supported booking-specific and fallback Gmail credential paths at `2026-07-04T00:18:29.594Z`; values and Render auth tokens were omitted.
- No local process values were present for supported booking-specific/fallback Gmail OAuth keys or `RENDER_API_KEY`.
- The connected Codex Gmail account was `Nick@intercellartrading.com`, not `booking@sandboxhotel.com`; a bounded connector search for `booking@sandboxhotel.com` returned no messages. This is not backend booking-mailbox proof.
- `npm.cmd run gmail-oauth:render` exited before URL generation because no `BOOKING_EMAIL_GMAIL_CLIENT_ID` or `GMAIL_CLIENT_ID` was present; no values were printed or applied.
- Render one-off job `job-d9452ocvikkc73bjd3lg` ran `npm run booking-email:proof` and succeeded at `2026-07-04T00:19:12Z`; Render CLI logs did not return job stdout for the checked window.
- Render one-off job `job-d9452p8js32c73dl4sr0` ran `npm run booking-email:backfill -- --all-past --limit 250` and failed at `2026-07-04T00:19:14Z` while backend Gmail OAuth remained missing. No confirmed import was run.
- Canonical evidence: `docs/launch/evidence/2026-07-04-slice-5bk-current-main-deploy-gmail-boundary.md`.

Still not proven by this refresh:

- Booking-email capture/backfill with real Gmail data; backend Gmail OAuth remains missing.
- Approved production user list, credentialed login/logout proof, role matrix, underprivileged denial proof, and bootstrap/setup-token rotation or retention decision.
- Owner/import proof confirming production room inventory is the approved real source and not fake seed/demo data.
- Explicit owner decision accepting local disposable DB workflow proof or requiring staging/controlled production-like evidence.
- Redacted secret inventory/rotation metadata, named rollback owner/deputy/database recovery owner, latest recovery point/retention proof, WAF/rate-limit rule metadata, and legacy key cleanup decisions.

## 2026-07-04T06:56+07:00 Current Helper Deploy Sync

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: deploy current green helper commit, run public health/setup probes, public-edge proof, production preflight, redacted Render Gmail OAuth status, and Booking Email proof job. No secret values, credentialed PMS login, production database shell, production mutation, confirmed booking-email import, WAF mutation, provider setting change, or screenshot capture was performed.
- GitHub CI run `28688152726` passed for commit `04d06d3351fa02154e258a35b84a379dd219db22`, including lint, typecheck, business tests, E2E smoke, build, and launch gate.
- Render deploy `dep-d944ml4vikkc73bido10` is live on `sandbox-hotel-pms-v43m`, serving commit `04d06d3351fa02154e258a35b84a379dd219db22`, finished `2026-07-03T23:55:30Z`.
- `npm.cmd run public-edge:proof` passed at `2026-07-03T23:55:52.008Z`: `/healthz?deep=1` returned `200`, production environment, database configured/OK, Cloudflare headers, Render origin header, selected common unwanted paths returned `404`, and response bodies were omitted except bounded health fields.
- `npm.cmd run live:check` passed; DNS lookup resolved `book.sandboxhotel.com` to `216.24.57.8`; LINE remains optional/unconfigured.
- `npm.cmd run prod:preflight` passed with the expected LINE-disabled warning.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and `Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.`
- `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` returned `ready=false` for all supported booking-specific and fallback Gmail credential paths at `2026-07-03T23:55:49.692Z`; values and Render auth tokens were omitted.
- No local process values were present for supported booking-specific/fallback Gmail OAuth keys or `RENDER_API_KEY`.
- `npm.cmd run gmail-oauth:render` exited before URL generation because no `BOOKING_EMAIL_GMAIL_CLIENT_ID` or `GMAIL_CLIENT_ID` was present; no values were printed or applied.
- Render one-off job `job-d944o5ojs32c73dk9gog` ran `npm run booking-email:proof` and succeeded at `2026-07-03T23:56:37Z`; Render CLI logs did not return job stdout for the checked window.
- Dry-run historical backfill was not rerun because backend Gmail OAuth remains unconfigured. The latest prior dry-run backfill job remains `job-d9446csvikkc73bh3ba0`, which failed while OAuth was missing.
- Canonical evidence: `docs/launch/evidence/2026-07-04-slice-5bj-current-helper-deploy-sync.md`.

Still not proven by this refresh:

- Booking-email capture/backfill with real Gmail data; backend Gmail OAuth remains missing.
- Approved production user list, credentialed login/logout proof, role matrix, underprivileged denial proof, and bootstrap/setup-token rotation or retention decision.
- Owner/import proof confirming production room inventory is the approved real source and not fake seed/demo data.
- Explicit owner decision accepting local disposable DB workflow proof or requiring staging/controlled production-like evidence.
- Redacted secret inventory/rotation metadata, named rollback owner/deputy/database recovery owner, latest recovery point/retention proof, WAF/rate-limit rule metadata, and legacy key cleanup decisions.

## 2026-07-04T06:18+07:00 Live Gmail And Launch Status Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: refresh current live deploy metadata, public health/setup probes, public-edge proof, production preflight, redacted Render Gmail OAuth status, Gmail connector account posture, and Booking Email proof/backfill jobs. No secret values, credentialed PMS login, production database shell, production mutation, confirmed booking-email import, WAF mutation, provider setting change, or screenshot capture was performed.
- Latest `main` CI run `28674129355` passed for commit `1d2ea176b5759e98f30d038a8f3985ab299105af`.
- Current live Render deploy remains `dep-d93ud5nlk1mc73a2sbv0` on `sandbox-hotel-pms-v43m`, serving app/helper commit `0de2eb3d612a555dbd6cac92948becd16aa24cae`, finished `2026-07-03T16:45:40Z`.
- `npm.cmd run public-edge:proof` passed at `2026-07-03T23:16:30.015Z`: `/healthz?deep=1` returned `200`, production environment, database configured/OK, Cloudflare headers, Render origin header, selected common unwanted paths returned `404`, and response bodies were omitted except bounded health fields.
- `npm.cmd run live:check` passed; DNS lookup resolved `book.sandboxhotel.com` to `216.24.57.8`; LINE remains optional/unconfigured.
- `npm.cmd run prod:preflight` passed with the expected LINE-disabled warning.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and `Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.`
- `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` returned `ready=false` for all supported booking-specific and fallback Gmail credential paths at `2026-07-03T23:16:27.518Z`; values and Render auth tokens were omitted.
- The Gmail connector profile was reachable, but the connected account was not `booking@sandboxhotel.com`; no mailbox search, message-body scan, or import was performed from that account.
- Render one-off job `job-d94460uq1p3s73apai5g` ran `npm run booking-email:proof` and succeeded at `2026-07-03T23:17:48Z`; Render CLI logs did not return job stdout for the checked window.
- Render one-off job `job-d9446csvikkc73bh3ba0` ran dry-run `npm run booking-email:backfill -- --all-past --limit 250` and failed at `2026-07-03T23:18:39Z` while Gmail OAuth remained unconfigured. No confirmed import was run.
- Canonical evidence: `docs/launch/evidence/2026-07-04-slice-5bh-live-gmail-refresh.md`.

Still not proven by this refresh:

- Booking-email capture/backfill with real Gmail data; backend Gmail OAuth remains missing.
- Approved production user list, credentialed login/logout proof, role matrix, underprivileged denial proof, and bootstrap/setup-token rotation or retention decision.
- Owner/import proof confirming production room inventory is the approved real source and not fake seed/demo data.
- Explicit owner decision accepting local disposable DB workflow proof or requiring staging/controlled production-like evidence.
- Redacted secret inventory/rotation metadata, named rollback owner/deputy/database recovery owner, latest recovery point/retention proof, WAF/rate-limit rule metadata, and legacy key cleanup decisions.

## 2026-07-03T16:46Z Public Edge Helper Deploy And Proof

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: deploy the current green public-edge-helper commit, run public health/setup probes, run the no-secret public-edge proof command, and refresh live/preflight checks. No secret values, credentialed login, production database shell, production mutation, WAF mutation, provider setting change, or screenshot capture was performed.
- GitHub Actions CI run `28672978563` passed for commit `0de2eb3d612a555dbd6cac92948becd16aa24cae`.
- Render deploy `dep-d93ud5nlk1mc73a2sbv0` is live on `sandbox-hotel-pms-v43m`, serving commit `0de2eb3d612a555dbd6cac92948becd16aa24cae`, finished `2026-07-03T16:45:40Z`.
- Direct `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, `environment=production`, database configured and OK, `Server: cloudflare`, `CF-RAY` present, and `X-Render-Origin-Server=Render` at `2026-07-03T16:45:55Z`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and `Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.`
- `npm.cmd run public-edge:proof` passed at `2026-07-03T16:45:57.468Z`: `/healthz?deep=1` returned `200`, selected common unwanted paths returned `404`, Cloudflare and Render origin headers were present, and response bodies were omitted except bounded health fields.
- `npm.cmd run live:check` passed for `https://book.sandboxhotel.com`; `npm.cmd run prod:preflight` passed with the expected LINE-disabled warning.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5bf-public-edge-proof-helper.md`.

Still not proven by this refresh:

- Booking-email capture/backfill with real Gmail data; backend Gmail OAuth remains missing.
- Approved production user list, credentialed login/logout proof, role matrix, underprivileged denial proof, and bootstrap/setup-token rotation or retention decision.
- Owner/import proof confirming production room inventory is the approved real source and not fake seed/demo data.
- Explicit owner decision accepting local disposable DB workflow proof or requiring staging/controlled production-like evidence.
- Redacted secret inventory/rotation metadata, named rollback owner/deputy/database recovery owner, latest recovery point/retention proof, WAF/rate-limit rule metadata, and legacy key cleanup decisions.

## 2026-07-03T16:08Z Render Sync After Gmail OAuth Status Tool

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: deploy the current green status-tool commit, run public health/setup probes, verify booking-email proof job status, and recheck Gmail OAuth credential absence. No secret values, credentialed login, production database shell, production mutation, WAF mutation, provider setting change, or screenshot capture was performed.
- GitHub Actions CI run `28671225263` passed for commit `ad2b7267d7ac625708b935fa058361e86dfa09fb`.
- Render deploy `dep-d93tr24vikkc73b3quug` is live on `sandbox-hotel-pms-v43m`, serving commit `ad2b7267d7ac625708b935fa058361e86dfa09fb`, finished `2026-07-03T16:07:00Z`.
- Direct `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, `environment=production`, database configured and OK, `Server: cloudflare`, `CF-RAY` present, and `X-Render-Origin-Server=Render` at `2026-07-03T16:07:28Z`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and `Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.`
- `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` returned `ready=false` for booking-specific and fallback Gmail credential paths at `2026-07-03T16:07:50.737Z`; values and Render auth tokens were omitted.
- Render one-off job `job-d93tsq5aeets73ej4pvg` ran `npm run booking-email:proof` and succeeded at `2026-07-03T16:08:39Z`.
- `npm.cmd run live:check` passed for `https://book.sandboxhotel.com`; `npm.cmd run prod:preflight` passed with the expected LINE-disabled warning.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5be-gmail-oauth-status-tool.md`.

Still not proven by this refresh:

- Booking-email capture/backfill with real Gmail data; backend Gmail OAuth remains missing.
- Approved production user list, credentialed login/logout proof, role matrix, underprivileged denial proof, and bootstrap/setup-token rotation or retention decision.
- Owner/import proof confirming production room inventory is the approved real source and not fake seed/demo data.
- Explicit owner decision accepting local disposable DB workflow proof or requiring staging/controlled production-like evidence.
- Redacted secret inventory/rotation metadata, named rollback owner/deputy/database recovery owner, latest recovery point/retention proof, WAF/rate-limit rule metadata, and legacy key cleanup decisions.

## 2026-07-03T15:28Z Current Deploy Sync After Gmail OAuth Helper

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: deploy the current green application/helper commit, run public health/setup probes, verify booking-email proof/backfill job status, and recheck Gmail OAuth credential absence. No secret values, credentialed login, production database shell, production mutation, WAF mutation, provider setting change, or screenshot capture was performed.
- GitHub Actions CI run `28669196029` passed for commit `163d49c2ff58eef5447e93f07d42babbf3b59d58`.
- Render deploy `dep-d93t86hkh4rs73e0io4g` is live on `sandbox-hotel-pms-v43m`, serving commit `163d49c2ff58eef5447e93f07d42babbf3b59d58`, finished `2026-07-03T15:26:55Z`.
- Direct `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, `environment=production`, database configured and OK, `Server: cloudflare`, `CF-RAY` present, and `X-Render-Origin-Server=Render` at `2026-07-03T15:27:45.025Z`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and `Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.`
- Render API returned missing (`404`) for the booking-email Gmail OAuth env-var names and fallback `GMAIL_*` names; no values were printed.
- Follow-up Slice 5BE added `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token`; the command currently reports `ready=false` for booking-specific and fallback Gmail credential paths, with values omitted.
- Local `npm.cmd run render:gmail-oauth` reported missing required `BOOKING_EMAIL_GMAIL_CLIENT_ID`, `BOOKING_EMAIL_GMAIL_CLIENT_SECRET`, and `BOOKING_EMAIL_GMAIL_REFRESH_TOKEN`; values were omitted.
- Render one-off job `job-d93t9me7r5hc73dohjag` ran `npm run booking-email:proof` and succeeded.
- Render one-off job `job-d93t9mdaeets73ehrus0` ran `npm run booking-email:backfill -- --all-past --limit 250` and failed while Gmail OAuth remained unconfigured.
- `npm.cmd run live:check` passed for `https://book.sandboxhotel.com`; `npm.cmd run prod:preflight` passed with the expected LINE-disabled warning.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5bd-current-deploy-sync.md`.

Still not proven by this refresh:

- Booking-email capture/backfill with real Gmail data; backend Gmail OAuth remains missing.
- Approved production user list, credentialed login/logout proof, role matrix, underprivileged denial proof, and bootstrap/setup-token rotation or retention decision.
- Owner/import proof confirming production room inventory is the approved real source and not fake seed/demo data.
- Explicit owner decision accepting local disposable DB workflow proof or requiring staging/controlled production-like evidence.
- Redacted secret inventory/rotation metadata, named rollback owner/deputy/database recovery owner, latest recovery point/retention proof, WAF/rate-limit rule metadata, and legacy key cleanup decisions.

## 2026-07-03T11:07Z Room Inventory Proof Helper Deploy And Job

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: deploy the counts-only room inventory proof helper and run it as a Render one-off job. No production database mutation, credentialed login, room-number export, guest data, user data, payment data, raw database URL, secret-value access, WAF mutation, or provider setting change was performed.
- GitHub Actions CI run `28656054381`, job `84985283168`, passed for commit `527e231e3821eda6f70fdf1d3436e81bb098b0d7`, including launch gate.
- Render deploy `dep-d93pe7hkh4rs73dp5bcg` is live on `sandbox-hotel-pms-v43m`, serving commit `527e231e3821eda6f70fdf1d3436e81bb098b0d7`.
- Deploy predeploy ran `npm run db:migrate && npm run db:seed`; migrations had no pending migrations, prod-safe seed ran, and prod-safe seed skipped room inventory.
- Render one-off job `job-d93pfr6q1p3s73a2ufh0` ran `npm run rooms:proof` and succeeded.
- The job reported production target `sandbox_hotel_pms`, schema `pms_v2`, host id `dpg-d6ns2d94tr6s73c9hve0-a`; no raw database URL was printed.
- Aggregate output: property code `SANDBOX`, `2` room types, `33` total rooms, `33` operationally available rooms, `0` inactive rooms, current statuses `VACANT_CLEAN=32` and `OCCUPIED_CLEAN=1`, with all other tracked current statuses `0`.
- Redacted room-type buckets: `ROOM_TYPE_01=17`, `ROOM_TYPE_02=16`.
- The job output omitted room numbers, guest data, reservation data, user data, payment data, and raw database URL. Room-type labels were redacted because `--include-room-type-labels` was not used.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5ba-room-inventory-proof-helper.md` and `docs/launch/evidence/ROOM_INVENTORY_PROOF.md`.

Still not proven by this refresh:

- Owner/import source-of-truth evidence proving these rows are the approved real room inventory and not fake seed/demo data.
- Approved production user list, credentialed login/logout proof, role matrix, underprivileged denial proof, and bootstrap/setup-token rotation or retention decision.
- Explicit owner decision accepting local disposable DB workflow proof or requiring staging/controlled production-like evidence.
- Redacted secret inventory/rotation metadata, named rollback owner/deputy/database recovery owner, latest recovery point/retention proof, WAF/rate-limit rule metadata, and legacy key cleanup decisions.

## 2026-07-03T10:34Z Owner Response Intake And Setup-Gate Reprobe

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: owner-response intake, Render deploy metadata, public health/setup probes, and issue-closure classification. No production credentialed login, database shell, production database mutation, secret-value access, WAF mutation, provider setting change, or screenshot capture was performed.
- Owner response: PR #150 or exact reviewed commit `fbc303136253a9785446d601d5532b6efc523b8f` is approved for deployment to `sandbox-hotel-pms-v43m`.
- Current live deploy: `dep-d93ordnaqgkc73cd2ke0`, serving commit `1c493116b7eb84ab010097903ff641cd526d8cb6`, status `live`.
- Prior deploy `dep-d93oli7aqgkc73ccodv0` is deactivated; PR #150 merge deploy `dep-d93nr7nlk1mc739ldujg` is deactivated but its setup-gate hardening remains included in the current live commit.
- Direct `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, `environment=production`, database configured and OK, `Server: cloudflare`, `CF-RAY` present, and `x-render-origin-server: Render`.
- `GET https://book.sandboxhotel.com/api/setup/status` returned `200` with `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, `propertyName=SANDBOX HOTEL`, and `setupTokenRequired=false`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and `Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.`
- This closes the setup-gate deployment/reprobe blocker for the current public deploy.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5az-owner-response-intake.md`.

Still not proven by this refresh:

- Approved production user list, credentialed login/logout proof, role matrix, underprivileged denial proof, and bootstrap/setup-token rotation or retention decision.
- Current production room inventory counts and approved source-of-truth confirmation.
- Explicit owner decision accepting local disposable DB workflow proof or requiring staging/controlled production-like evidence.
- Redacted secret inventory/rotation metadata, named rollback owner/deputy/database recovery owner, latest recovery point/retention proof, WAF/rate-limit rule metadata, and legacy key cleanup decisions.

## 2026-07-03T09:29Z Housekeeping Sync And Live Setup-Gate Reprobe

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: read-only GitHub PR/issue metadata, Render deploy metadata, public health/setup probes, and local repository sync status. No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed login, screenshots, WAF mutation, or secret-value access was performed.
- `git fetch --prune origin` completed.
- PR #150 is `MERGED`; `gh pr view 150 --repo nakalasbakalas/sandbox-pms` reports merge commit `a01838a956f24164167ba7f91a7620a37de7f36d`, merged at `2026-07-03T09:03:43Z`.
- `origin/main` is `a01838a956f24164167ba7f91a7620a37de7f36d`.
- PR #150 CI remains green: `Install, test, build, and launch-check` completed successfully in GitHub Actions job `84724751654`.
- Open launch issues remain #136, #137, #138, #140, and #142. No launch-proof issue was closed in this refresh.
- Render CLI is available as `render v2.13.0`.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` reports latest live deploy `dep-d93nr7nlk1mc739ldujg`, status `live`, serving commit `a01838a956f24164167ba7f91a7620a37de7f36d`, finished `2026-07-03T09:17:54Z`.
- Previous live deploy `dep-d8i4q3favr4c73afbrg0` is deactivated.
- `render services instances srv-d6ns31h4tr6s73c9i8g0 -o json` reports observed instance `srv-d6ns31h4tr6s73c9i8g0-8wxvc`, created `2026-07-03T09:17:22Z`.
- Direct `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, `environment=production`, database configured and OK, `server=cloudflare`, `CF-RAY` present, and `X-Render-Origin-Server=Render`.
- `GET https://book.sandboxhotel.com/api/setup/status` returned `200` with `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, and `propertyName=SANDBOX HOTEL`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and `Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.`
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5ay-housekeeping-sync.md`.

Still not proven by this refresh:

- Approved production user list and role-by-role access matrix against the target environment.
- Current production room inventory configured through onboarding/import.
- Staging or controlled production-like workflow acceptance, if required by the launch owner.
- Secret key inventory and rotation timestamps.
- Named rollback owner, rollback deputy, database recovery owner, latest recovery point/retention proof, and WAF/rate-limit owner/rule IDs.

## 2026-07-03T04:19Z PR And Live Setup-Gate Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: read-only GitHub PR metadata, GitHub Actions check state, Render service/deploy metadata, Render Blueprint validation, local business-rule tests, public setup/health probes, and `live:check` retry behavior. No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed login, screenshots, or secret-value access was performed.
- Local `HEAD` and remote `origin/codex/setup-gate-launch-proof` are `fbc303136253a9785446d601d5532b6efc523b8f`; remote `origin/main` is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`.
- PR #150 remains `OPEN`, `isDraft=false`, merge state `CLEAN`, with no reviews recorded. Head is `fbc303136253a9785446d601d5532b6efc523b8f`; base is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`; `updatedAt=2026-07-02T10:51:15Z`.
- `gh pr checks 150 --repo nakalasbakalas/sandbox-pms` reported `Install, test, build, and launch-check` passed in 6m28s at GitHub Actions job `84724751654`.
- Long-term custom-domain service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) remains a not-suspended Node web service on branch `main`, auto deploy `no`, health path `/healthz`, starter plan, region `oregon`.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` confirmed the latest live deploy is still `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, status `live`, finished `2026-06-06T16:39:42.109323Z`.
- `render services instances srv-d6ns31h4tr6s73c9i8g0 -o json` confirmed one observed instance `srv-d6ns31h4tr6s73c9i8g0-2brwp`, created `2026-06-06T16:39:10Z`.
- `npm.cmd test` passed with `Business rule tests passed`; the current checkout includes setup-complete hardening coverage.
- `npm.cmd run render:validate` passed with Render Blueprint validation `valid: true`.
- `npm.cmd run prod:preflight` passed with the expected LINE-disabled warning.
- First `npm.cmd run live:check` attempt failed with a Node `AbortError`; an immediate retry passed for `https://book.sandboxhotel.com`.
- Direct `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, database configured, database OK, `server=cloudflare`, `CF-RAY` present, and `X-Render-Origin-Server=Render`.
- `GET https://book.sandboxhotel.com/api/setup/status` returned `200` with `ok=true`, `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, and `propertyName=SANDBOX HOTEL`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `400` and `Add at least one room type.`, so the public service still reaches setup-payload validation instead of the PR #150 completed-setup rejection.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5aw-pr-live-setup-gate-refresh.md`.

Still not proven by this refresh:

- Current setup-gate hardening on the public site.
- Approved production user list and role-by-role access matrix against the target environment.
- Current production room inventory configured through onboarding/import.
- Secret key inventory and rotation timestamps.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.

## 2026-07-03T03:58Z Secrets, Recovery, And WAF Provider Posture Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: safe Render CLI command discovery, workspace/project/environment metadata, sanitized service/database/deploy metadata, public edge probes, `prod:preflight`, and `live:check`. No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed login, screenshots, paid resource action, or secret-value access was performed.
- Render CLI is authenticated as `nakalastravels@gmail.com`; no token or secret value was printed.
- `tool_search` exposed no callable Render MCP service, database, secret, backup, or WAF/rate-limit tools in this session.
- `render --version` returned Render CLI `v2.13.0`; `render --help`, `render services --help`, `render services env --help`, `render backups --help`, and `render ea --help` still exposed no usable safe env-var key inventory, secret rotation metadata, backup/recovery-point metadata, or WAF/rate-limit rule metadata path. `render backups --help` failed as unsupported.
- `render workspaces -o json` and `render projects -o json` confirmed workspace `My Workspace` (`tea-d6n8kq14tr6s738stj5g`) and project `My project` (`prj-d6nm1vdm5p6s7398qg70`).
- `render environments prj-d6nm1vdm5p6s7398qg70 -o json` confirmed `Production` (`evm-d6nm1vdm5p6s7398qg7g`) reports `protectedStatus=unprotected`, `networkIsolationEnabled=false`, and IP allow list `0.0.0.0/0`. This is provider posture evidence, not WAF/rate-limit rule proof.
- Sanitized `render services -o json` review confirmed Render PostgreSQL `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) is `available`, plan `basic_256mb`, region `oregon`.
- Sanitized `render services -o json` review confirmed `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) is a not-suspended web service for `nakalasbakalas/sandbox-pms`, branch `main`, auto deploy `no`, health path `/healthz`, starter plan, region `oregon`, runtime `node`.
- `render services instances srv-d6ns31h4tr6s73c9i8g0 -o json` confirmed one observed instance `srv-d6ns31h4tr6s73c9i8g0-2brwp`, created `2026-06-06T16:39:10Z`.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` confirmed the latest live deploy remains `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, status `live`, finished `2026-06-06T16:39:42.109323Z`.
- `npm.cmd run prod:preflight` passed with the expected LINE-disabled warning.
- `npm.cmd run live:check` passed against `https://book.sandboxhotel.com`; LINE remains optional unless `LIVE_REQUIRE_LINE=true`; DNS resolved to `216.24.57.9` from this resolver.
- Direct `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, database configured, database OK, `server=cloudflare`, `CF-RAY` present, and `X-Render-Origin-Server=Render`.
- Non-destructive public probes for `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` returned `404` with Cloudflare response headers.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5av-secrets-recovery-waf-refresh.md`, `docs/launch/evidence/SECRETS_AND_RECOVERY_PROOF.md`, and `docs/launch/evidence/WAF_PROVIDER_POSTURE.md`.

Still not proven by this refresh:

- Redacted secret key inventory and rotation timestamps.
- Owner confirmation for production secret custody and cleanup decisions for legacy/compatibility keys.
- Latest recovery point and retention window from Render dashboard/API.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.
- Upstream WAF/rate-limit rule IDs, thresholds, protected hostnames, and owner-approved non-destructive rate-limit test result.

## 2026-07-03T03:39Z PR And Live Setup-Gate Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: read-only GitHub PR metadata, GitHub Actions check state, Render service/deploy metadata, Render Blueprint validation, local setup-gate regression test, public setup/health probes, and `live:check` retry behavior. No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed login, screenshots, or secret-value access was performed.
- Local `HEAD` and remote `origin/codex/setup-gate-launch-proof` are `fbc303136253a9785446d601d5532b6efc523b8f`; remote `origin/main` is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`.
- PR #150 remains `OPEN`, `isDraft=false`, merge state `CLEAN`, with no reviews recorded. Head is `fbc303136253a9785446d601d5532b6efc523b8f`; base is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`; `updatedAt=2026-07-02T10:51:15Z`.
- `gh pr checks 150 --repo nakalasbakalas/sandbox-pms` reported `Install, test, build, and launch-check` passed in 6m28s at GitHub Actions job `84724751654`.
- Render CLI is authenticated as `nakalastravels@gmail.com`; no token or secret value was printed.
- Long-term custom-domain service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) remains present in the Render service inventory for `nakalasbakalas/sandbox-pms`, branch `main`, auto deploy `no`, health path `/healthz`, maintenance mode disabled, not suspended.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` confirmed the latest live deploy is still `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, status `live`, finished `2026-06-06T16:39:42.109323Z`.
- `render services instances srv-d6ns31h4tr6s73c9i8g0 -o json` confirmed one observed instance `srv-d6ns31h4tr6s73c9i8g0-2brwp`, created `2026-06-06T16:39:10Z`.
- `npm.cmd test` passed with `Business rule tests passed`; the current checkout includes setup-complete hardening coverage.
- `npm.cmd run render:validate` passed with Render Blueprint validation `valid: true`.
- First `npm.cmd run live:check` attempt failed with a Node `AbortError`; an immediate retry passed for `https://book.sandboxhotel.com`.
- Direct `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, service `sandbox-hotel-pms`, production environment, database configured, database OK, and `integrations.lineWebhookConfigured=false` at `2026-07-03T03:39:17.605Z`.
- `GET https://book.sandboxhotel.com/api/setup/status` returned `200` with `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, and `propertyName=SANDBOX HOTEL`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `400` and `Add at least one room type.`, so the public service still reaches setup-payload validation instead of the PR #150 completed-setup rejection.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5au-pr-live-setup-gate-refresh.md`.

Still not proven by this refresh:

- Current setup-gate hardening on the public site.
- Approved production user list and role-by-role access matrix against the target environment.
- Current production room inventory configured through onboarding/import.
- Secret key inventory and rotation timestamps.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.

## 2026-07-03T02:33Z Secrets, Recovery, And WAF Provider Posture Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: safe Render CLI command discovery, workspace/project/environment metadata, sanitized service/database/deploy metadata, public edge probes, and live health checks. No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed login, screenshots, paid resource action, or secret-value access was performed.
- `render --help` showed Render CLI v2.13.0 exposes deploys, jobs, logs, restart, services, workflows, workspaces, auth/session commands, blueprints, environments, projects, docs, early access, and skills. No top-level env-var, secret-manager, backup, recovery, or WAF/rate-limit command is listed.
- `render services --help` listed only `create` and `instances`; `render services env --help` returned services help only, not an env-var inventory command.
- `render backups --help` returned `unknown command "backups" for "render"`.
- `render ea --help` exposed object storage only in this session.
- `render workspaces -o json` and `render projects -o json` confirmed workspace `My Workspace` (`tea-d6n8kq14tr6s738stj5g`) and project `My project` (`prj-d6nm1vdm5p6s7398qg70`).
- `render environments prj-d6nm1vdm5p6s7398qg70 -o json` confirmed `Production` environment metadata reports `protectedStatus=unprotected`, `networkIsolationEnabled=false`, and IP allow list `0.0.0.0/0`. This is not WAF/rate-limit rule proof.
- Sanitized `render services -o json` review confirmed Render PostgreSQL `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) is `available`, primary, PostgreSQL 17, region `oregon`, plan `basic_256mb`, 15 GB disk, and not suspended.
- Sanitized `render services -o json` review confirmed `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) is a not-suspended web service for `nakalasbakalas/sandbox-pms`, health path `/healthz`, starter plan, region `oregon`.
- `render services instances srv-d6ns31h4tr6s73c9i8g0 -o json` confirmed one observed instance `srv-d6ns31h4tr6s73c9i8g0-2brwp`, created `2026-06-06T16:39:10Z`.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` confirmed the latest live deploy remains `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, status `live`, finished `2026-06-06T16:39:42.109323Z`.
- Non-destructive public probes for `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` returned `404` with Cloudflare and Render headers present.
- Direct `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, production environment, database configured, database OK, and `lineWebhookConfigured=false` at `2026-07-03T02:33:24.710Z`.
- `npm.cmd run live:check` passed against `https://book.sandboxhotel.com`.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5ar-secrets-recovery-waf-refresh.md`, `docs/launch/evidence/SECRETS_AND_RECOVERY_PROOF.md`, and `docs/launch/evidence/WAF_PROVIDER_POSTURE.md`.

Still not proven by this refresh:

- Redacted secret key inventory and rotation timestamps.
- Owner confirmation for production secret custody and cleanup decisions for legacy/compatibility keys.
- Latest recovery point and retention window from Render dashboard/API.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.
- Upstream WAF/rate-limit rule IDs, thresholds, protected hostnames, and owner-approved non-destructive rate-limit test result.

## 2026-07-03T02:28Z PR And Live Setup-Gate Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: read-only GitHub PR metadata, GitHub Actions check state, Render deploy metadata, Render Blueprint validation, local setup-gate regression test, and public setup/health probes against `https://book.sandboxhotel.com`. No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed login, screenshots, or secret-value access was performed.
- Local `HEAD` and remote `origin/codex/setup-gate-launch-proof` are `fbc303136253a9785446d601d5532b6efc523b8f`; remote `origin/main` is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`.
- PR #150 remains `OPEN`, `isDraft=false`, merge state `CLEAN`, with no reviews recorded. Head is `fbc303136253a9785446d601d5532b6efc523b8f`; base is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`; `updatedAt=2026-07-02T10:51:15Z`.
- `gh pr checks 150 --repo nakalasbakalas/sandbox-pms` reported `Install, test, build, and launch-check` passed in 6m28s at GitHub Actions job `84724751654`.
- `npm.cmd test` passed with `Business rule tests passed`; the current checkout includes setup-complete hardening coverage.
- Long-term custom-domain service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) remains present in the Render service inventory for `nakalasbakalas/sandbox-pms`, health path `/healthz`, not suspended.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` confirmed the latest live deploy is still `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, status `live`, finished `2026-06-06T16:39:42.109323Z`.
- `npm.cmd run render:validate` passed with Render Blueprint validation `valid: true`.
- Direct `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, service `sandbox-hotel-pms`, production environment, database configured, database OK, and `integrations.lineWebhookConfigured=false` at `2026-07-03T02:28:28.490Z`.
- `GET https://book.sandboxhotel.com/api/setup/status` returned `200` with `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, and `propertyName=SANDBOX HOTEL`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `400` and `Add at least one room type.`, so the public service still reaches setup-payload validation instead of the PR #150 completed-setup rejection.
- `npm.cmd run live:check` passed against `https://book.sandboxhotel.com`.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5aq-pr-live-setup-gate-refresh.md`.

Still not proven by this refresh:

- Current setup-gate hardening on the public site.
- Approved production user list and role-by-role access matrix against the target environment.
- Current production room inventory configured through onboarding/import.
- Secret key inventory and rotation timestamps.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.

## 2026-07-03T02:21Z Production Room Inventory CLI Query-Path Reprobe

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: read-only Render CLI command-shape checks, non-interactive aggregate SQL query-path probes, local import-artifact presence check, and unauthenticated public room endpoint probes. No deploy, restart, SSH session, interactive production database shell, production database mutation, DB-mutating E2E, credentialed login, screenshots, or secret-value access was performed.
- `render psql --help` confirmed documented non-interactive syntax is `render psql [postgresID|postgresName] -c "SELECT ..." -o text/json`, with optional raw `psql` args after `--`.
- `render pgcli --help` confirmed no non-interactive command flag; `render postgres --help` returned `unknown command "postgres"` for Render CLI v2.13.0.
- Codex tool discovery exposed no callable Render MCP database query/list tool in this session.
- `Test-Path .\ops\rooms.production.json` returned `False`; the current checkout has no local production-room import artifact at that path.
- `render services -o json` filtered to `sandbox-hotel-pms-db-v43m` confirmed Render PostgreSQL `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) is available, primary, PostgreSQL 17, region `oregon`, plan `basic_256mb`, database `sandbox_hotel_pms`, and not suspended. This proves resource status only, not room rows.
- With PostgreSQL 16 prepended to `PATH`, `render psql dpg-d6ns2d94tr6s73c9hve0-a -c 'SELECT 1 AS probe;' -o text` returned exit code 0 with empty output.
- With PostgreSQL 16 prepended to `PATH`, `render psql sandbox-hotel-pms-db-v43m -c 'SELECT 1 AS probe;' -o text` returned exit code 0 with empty output.
- With PostgreSQL 16 prepended to `PATH`, `render psql dpg-d6ns2d94tr6s73c9hve0-a -c 'SELECT * FROM __codex_nonexistent_probe__;' -o text` returned exit code 0 with empty output even for deliberately invalid SQL.
- With PostgreSQL 16 prepended to `PATH`, `render psql dpg-d6ns2d94tr6s73c9hve0-a -c 'COPY (SELECT 1 AS probe) TO STDOUT WITH CSV HEADER;' -o text` returned exit code 0 with empty output.
- With PostgreSQL 16 prepended to `PATH`, aggregate `Room` total/type-count and room status distribution queries both returned `{ "output": "" }`; no inventory counts were returned.
- Unauthenticated `GET https://book.sandboxhotel.com/api/rooms` and `GET https://book.sandboxhotel.com/api/today` both returned `401 Authentication is required`, so the public endpoints are protected and cannot be used as unauthenticated inventory proof.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5ap-room-inventory-cli-reprobe.md` and `docs/launch/evidence/ROOM_INVENTORY_PROOF.md`.

Still not proven by this refresh:

- Current production room inventory configured through approved onboarding/import.
- Room-type counts and room status distribution.
- Property/operations owner approval for the real room source.
- Approved production user list and role-by-role access matrix against the target environment.
- Secret key inventory and rotation timestamps.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.

## 2026-07-03T02:10Z PR And Live Setup-Gate Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: read-only GitHub PR metadata, GitHub Actions check state, Render deploy metadata, Render Blueprint validation, local setup-gate regression test, and public setup/health probes against `https://book.sandboxhotel.com`. No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed login, screenshots, or secret-value access was performed.
- Local `HEAD` and remote `origin/codex/setup-gate-launch-proof` are `fbc303136253a9785446d601d5532b6efc523b8f`; remote `origin/main` is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`.
- PR #150 remains `OPEN`, `isDraft=false`, merge state `CLEAN`, with no reviews recorded. Head is `fbc303136253a9785446d601d5532b6efc523b8f`; base is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`.
- `gh pr checks 150 --repo nakalasbakalas/sandbox-pms` reported `Install, test, build, and launch-check` passed in 6m28s at GitHub Actions job `84724751654`.
- `npm.cmd test` passed with `Business rule tests passed`; the current checkout includes the completed-setup regression that rejects before payload validation.
- Long-term custom-domain service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) remains a Node service on branch `main`, auto deploy `no`, health path `/healthz`, and predeploy command `npm run db:migrate && npm run db:seed`.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` confirmed the latest live deploy is `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, status `live`, finished `2026-06-06T16:39:42.109323Z`.
- `npm.cmd run render:validate` passed with Render Blueprint validation `valid: true`.
- Direct `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, production environment, database configured, database OK, and `lineWebhookConfigured=false` at `2026-07-03T02:10:22.666Z`.
- `GET https://book.sandboxhotel.com/api/setup/status` returned `200` with `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, and `propertyName=SANDBOX HOTEL`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `400` and `Add at least one room type.`, so the public service still reaches setup-payload validation instead of the PR #150 completed-setup rejection.
- `npm.cmd run live:check` passed against `https://book.sandboxhotel.com`.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5an-pr-live-setup-gate-refresh.md`.

Still not proven by this refresh:

- Current setup-gate hardening on the public site.
- Approved production user list and role-by-role access matrix against the target environment.
- Current production room inventory configured through onboarding/import.
- Secret key inventory and rotation timestamps.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.

## 2026-07-03T01:57Z Production Room Inventory Query-Path Reprobe

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: read-only Render metadata, non-interactive aggregate SQL query-path probes, and unauthenticated public room endpoint probes. No deploy, restart, SSH session, interactive production database shell, production database mutation, DB-mutating E2E, credentialed login, screenshots, or secret-value access was performed.
- Codex tool discovery exposed no callable Render MCP database query/list tool in this session.
- Shell `RENDER_API_KEY`, `DATABASE_URL`, and `E2E_DATABASE_URL` were absent; no values were printed.
- `render services -o json` filtered to Sandbox PMS resources confirmed `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) is available, primary, PostgreSQL 17, region `oregon`, plan `basic_256mb`, database `sandbox_hotel_pms`, and not suspended. This proves resource status only, not room rows.
- Local `psql` is not on the default process `PATH`, but PostgreSQL 16 client `psql (PostgreSQL) 16.13` exists under `C:\Program Files\PostgreSQL\16\bin`.
- With PostgreSQL 16 prepended to `PATH`, `render psql dpg-d6ns2d94tr6s73c9hve0-a --command 'SELECT 1 AS probe;' --output json` returned exit code 0 with an empty output field.
- With PostgreSQL 16 prepended to `PATH`, `render psql dpg-d6ns2d94tr6s73c9hve0-a --command 'SELECT * FROM __codex_nonexistent_probe__;' --output json` returned exit code 0 with an empty output field even for a deliberately invalid table.
- With PostgreSQL 16 prepended to `PATH`, the aggregate read-only room-count query returned exit code 0 with an empty output field; no inventory counts were returned.
- `render pgcli dpg-d6ns2d94tr6s73c9hve0-a -- -c 'SELECT 1 AS probe;'` failed as a non-interactive path because `render pgcli` can only be used interactively.
- Unauthenticated `GET https://book.sandboxhotel.com/api/rooms` and `GET https://book.sandboxhotel.com/api/today` both returned `401 Authentication is required`, so the public endpoints are protected and cannot be used as unauthenticated inventory proof.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5al-room-inventory-query-path-reprobe.md` and `docs/launch/evidence/ROOM_INVENTORY_PROOF.md`.

Still not proven by this refresh:

- Current production room inventory configured through approved onboarding/import.
- Room-type counts and room status distribution.
- Property/operations owner approval for the real room source.
- Approved production user list and role-by-role access matrix against the target environment.
- Secret key inventory and rotation timestamps.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.

## 2026-07-03T01:49Z PR And Live Setup-Gate Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: read-only GitHub PR metadata, GitHub Actions check state, Render deploy metadata, Render Blueprint validation, local setup-gate regression test, and public setup/health probes against `https://book.sandboxhotel.com`. No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed login, screenshots, or secret-value access was performed.
- Local `HEAD` and remote `origin/codex/setup-gate-launch-proof` are `fbc303136253a9785446d601d5532b6efc523b8f`; remote `origin/main` is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`.
- PR #150 remains `OPEN`, `isDraft=false`, merge state `CLEAN`, with no reviews recorded. Head is `fbc303136253a9785446d601d5532b6efc523b8f`; base is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`.
- `gh pr checks 150 --repo nakalasbakalas/sandbox-pms` reported `Install, test, build, and launch-check` passed in 6m28s at GitHub Actions job `84724751654`.
- `npm.cmd test` passed with `Business rule tests passed`; the current checkout includes the completed-setup regression that rejects before payload validation.
- Render CLI is authenticated as `nakalastravels@gmail.com`.
- Long-term custom-domain service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) remains live on deploy `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42Z`.
- `npm.cmd run render:validate` passed with Render Blueprint validation `valid: true`.
- Direct `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, production environment, database configured, database OK, and `lineWebhookConfigured=false` at `2026-07-03T01:48:03.040Z`.
- `GET https://book.sandboxhotel.com/api/setup/status` returned `200` with `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, and `propertyName=SANDBOX HOTEL`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `400` and `Add at least one room type.`, so the public service still reaches setup payload validation instead of the PR #150 completed-setup rejection.
- `npm.cmd run live:check` passed against `https://book.sandboxhotel.com`.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5ak-pr-live-setup-gate-refresh.md`.

Still not proven by this refresh:

- Current setup-gate hardening on the public site.
- Approved production user list and role-by-role access matrix against the target environment.
- Current production room inventory configured through onboarding/import.
- Secret key inventory and rotation timestamps.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.

## 2026-07-03T01:29Z Auth/RBAC Unauthenticated Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: local auth/RBAC regression commands plus live unauthenticated API and protected-page probes against `https://book.sandboxhotel.com`. No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed login, screenshots, or secret-value access was performed.
- Local `HEAD` is `fbc303136253a9785446d601d5532b6efc523b8f`.
- `npm.cmd test` passed with `Business rule tests passed`.
- First `npm.cmd run test:e2e` attempt timed out after about 184 seconds and produced no usable proof output. The orphaned `npm`, `scripts/run-e2e-tests.mjs`, and Vite validation processes from that attempt were identified by command line and stopped.
- Retry `npm.cmd run test:e2e` passed: documentation link smoke, internal worker route smoke, Playwright browser smoke, and E2E contract/browser smoke checks passed. DB-mutating workflow E2E was not requested.
- Unauthenticated API probes returned `401 Authentication is required.` for `GET /api/auth/me`, `GET /api/rooms`, `GET /api/reservations`, `POST /api/reservations`, `POST /api/payments`, `GET /api/users`, `GET /api/settings/room-setup`, and `POST /api/ops/commands`. Unauthenticated `POST /api/auth/logout` returned `200 ok=true`, which only proves the endpoint can clear a session cookie.
- Headless browser probes with empty storage showed a login form with one password input and no checked protected workspace terms for `/`, `/rooms`, `/reservations`, `/cashier`, `/housekeeping`, `/settings`, and `/user-management`.
- `/ops/settings` returned `200` but rendered `Page not found`; this remains older-live-deploy route drift, not protected-page access proof.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5ai-auth-rbac-unauth-refresh.md` and `docs/launch/evidence/AUTH_RBAC_PROOF.md`.

Still not proven by this refresh:

- Approved production user list.
- Credentialed production login/logout.
- Role-by-role production route/API access and denial.
- Protected page/API denial for an underprivileged production role.
- Bootstrap/setup-token removal or rotation evidence.

## 2026-07-03T01:16Z PR And Live Setup-Gate Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: read-only GitHub PR metadata, GitHub Actions check state, Render deploy metadata, Render Blueprint validation, and public setup/health probes against `https://book.sandboxhotel.com`. No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed login, or secret-value access was performed.
- Local `HEAD` and remote `origin/codex/setup-gate-launch-proof` are `fbc303136253a9785446d601d5532b6efc523b8f`; remote `origin/main` is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`.
- PR #150 remains `OPEN`, `isDraft=false`, merge state `CLEAN`, with no reviews recorded. Head is `fbc303136253a9785446d601d5532b6efc523b8f`; base is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`.
- `gh pr checks 150 --repo nakalasbakalas/sandbox-pms` reported `Install, test, build, and launch-check` passed in 6m28s at GitHub Actions job `84724751654`.
- Render CLI is authenticated as `nakalastravels@gmail.com`.
- Long-term custom-domain service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) remains live on deploy `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`.
- `npm.cmd run render:validate` passed with Render Blueprint validation `valid: true`.
- First `npm.cmd run live:check` attempt failed with a Node `AbortError`; an immediate retry passed for `https://book.sandboxhotel.com`.
- Direct `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, production environment, database configured, database OK, and `lineWebhookConfigured=false` at `2026-07-03T01:16:49.912Z`.
- `GET https://book.sandboxhotel.com/api/setup/status` returned `200` with `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, and `propertyName=SANDBOX HOTEL`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `400` and `Add at least one room type.`, so the public service still reaches setup payload validation instead of the PR #150 completed-setup rejection.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5ah-pr-live-setup-gate-refresh.md`.

Still not proven by this refresh:

- Current setup-gate hardening on the public site.
- Approved production user list and role-by-role access matrix against the target environment.
- Current production room inventory configured through onboarding/import.
- Secret key inventory and rotation timestamps.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.

## 2026-07-03T00:44Z Secrets And Recovery Proof Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: safe Render CLI metadata and public deep-health check. No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed login, or secret-value access was performed.
- Render CLI v2.13.0 exposed no `render env` command; `render env --help` returned `unknown command "env"`. The available CLI path did not expose secret key inventory or rotation metadata safely.
- `render ea --help` showed early-access commands only for object storage in this session; no secret-manager or recovery metadata command was available there.
- Sanitized `render services -o json` selection confirmed Render PostgreSQL `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) is `available`, primary, PostgreSQL 17, `basic_256mb`, 15 GB, region `oregon`, and `not_suspended`.
- Sanitized `render services -o json` selection confirmed custom-domain service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) is Node on starter plan, branch `main`, repo `nakalasbakalas/sandbox-pms`, auto deploy `no`, region `oregon`, and `not_suspended`.
- `render environments prj-d6nm1vdm5p6s7398qg70 -o json` confirmed Production environment `evm-d6nm1vdm5p6s7398qg7g` remains `protectedStatus=unprotected`, `networkIsolationEnabled=false`, with IP allow list `0.0.0.0/0`.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` confirmed latest live deploy `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`.
- `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, production environment, database configured, database OK, and `lineWebhookConfigured=false` at `2026-07-03T00:43:45.079Z`.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5ac-secrets-recovery-proof-refresh.md` and `docs/launch/evidence/SECRETS_AND_RECOVERY_PROOF.md`.

Still not proven by this refresh:

- Redacted Render secret key inventory and rotation timestamps.
- Owner confirmation for production secret custody and cleanup decisions for legacy/compatibility keys.
- Named rollback owner, rollback deputy, and database recovery owner.
- Latest recovery point/retention proof from Render dashboard/API.
- Upstream WAF/rate-limit rule IDs, thresholds, protected hostnames, and owner-approved non-destructive rate-limit test result.

## 2026-07-03T00:39Z PR And Live Setup-Gate Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: read-only GitHub PR metadata, GitHub Actions check state, Render deploy metadata, and public setup/health probes against `https://book.sandboxhotel.com`. No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed login, or secret-value access was performed.
- PR #150 remains `OPEN`, `isDraft=false`, merge state `CLEAN`, with no review approval recorded. Head is `fbc303136253a9785446d601d5532b6efc523b8f`; base is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`.
- `gh pr checks 150 --repo nakalasbakalas/sandbox-pms` reported `Install, test, build, and launch-check` passed in 6m28s at GitHub Actions job `84724751654`.
- Render CLI is authenticated as `nakalastravels@gmail.com`.
- Long-term custom-domain service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) remains live on deploy `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`.
- Local `HEAD` and `origin/codex/setup-gate-launch-proof` are `fbc303136253a9785446d601d5532b6efc523b8f`; `origin/main` is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`.
- `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, production environment, and database configured/OK.
- `GET https://book.sandboxhotel.com/api/setup/status` returned `200` with `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, and `propertyName=SANDBOX HOTEL`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `400` and `Add at least one room type.`, so the public service still reaches setup payload validation instead of the PR #150 completed-setup rejection.
- Canonical evidence: `docs/launch/evidence/2026-07-03-slice-5ab-pr-live-setup-gate-refresh.md`.

Still not proven by this refresh:

- Current setup-gate hardening on the public site.
- Approved production user list and role-by-role access matrix against the target environment.
- Current production room inventory configured through onboarding/import.
- Secret key inventory and rotation timestamps.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.

## 2026-07-02T11:15Z Live Protected Page Gate Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: headless browser probes against `https://book.sandboxhotel.com` with empty storage state. No production credentials, cookies, session tokens, passwords, database URLs, screenshots, or secret values were supplied or recorded.
- Representative protected paths `/`, `/rooms`, `/reservations`, `/cashier`, `/housekeeping`, `/settings`, and `/user-management` returned HTTP `200`, stayed on the requested path, rendered the login form, exposed one password input, and did not expose checked protected workspace terms.
- The live login label is still `Email address`, which is older than the current checkout's username-first label and remains deploy-drift evidence.
- `/ops/settings` returned HTTP `200` but rendered `Page not found`; it is recorded as live deploy route drift, not protected-page access proof.
- Canonical evidence: `docs/launch/evidence/2026-07-02-slice-5z-live-protected-page-gate.md`.

Still not proven by this refresh:

- Credentialed production login/logout.
- Production role-by-role access matrix and underprivileged-role denial.
- Bootstrap/setup-token removal or rotation evidence.
- Current setup-gate hardening on the public site.

## 2026-07-02T10:52Z PR Approval Handoff And Render Deploy Metadata Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: GitHub PR metadata, PR comment handoff, and read-only Render deploy metadata. No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed login, or secret-value access was performed.
- PR #150 is `OPEN`, `isDraft=false`, merge state `CLEAN`, with no review approval recorded. Head is `fbc303136253a9785446d601d5532b6efc523b8f`.
- `gh pr checks 150 --repo nakalasbakalas/sandbox-pms` reported `Install, test, build, and launch-check` passed in 6m28s.
- GitHub Actions run `28576051274`, job `84724751654`, completed successfully at `2026-07-02T08:29:46Z`.
- `gh pr comment 150 --repo nakalasbakalas/sandbox-pms --body <handoff text>` posted the current-head approval/deploy/reprobe checklist at `https://github.com/nakalasbakalas/sandbox-pms/pull/150#issuecomment-4864897300`.
- Render CLI v2.13.0 is authenticated as `nakalastravels@gmail.com`.
- Long-term custom-domain service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) remains live on deploy `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`.
- `npm.cmd run live:check` had one final-validation attempt fail with a Node `AbortError`; an immediate retry passed against `https://book.sandboxhotel.com`.
- Direct `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, production environment, database configured, and database OK.
- Canonical evidence: `docs/launch/evidence/2026-07-02-slice-5x-pr-approval-handoff-comment.md`.

Still not proven by this refresh:

- Current setup-gate hardening on the public site.
- Approved production user list and role-by-role access matrix against the target environment.
- Current production room inventory configured through onboarding/import.
- Secret key inventory and rotation timestamps.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.

## 2026-07-02T08:00Z PR And Live Setup-Gate Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: GitHub PR metadata, Render deploy metadata, and unauthenticated public setup probes. No deploy, restart, SSH session, database shell, production database mutation, DB-mutating E2E, credentialed login, or secret-value access was performed.
- PR #150 remains `OPEN`, `isDraft=true`, merge state `CLEAN`, with no review approval recorded. Head is `75810c3fbcf73d6f8a790a607beb3bb3b0bf69a0`; base `main` is `f5b0849037a55e2c99a3d781d742ba85d2384d8c`.
- `gh pr checks 150 --repo nakalasbakalas/sandbox-pms` reported `Install, test, build, and launch-check` passed in 6m29s.
- `origin/codex/setup-gate-launch-proof` remains `75810c3fbcf73d6f8a790a607beb3bb3b0bf69a0`; `origin/main` remains `f5b0849037a55e2c99a3d781d742ba85d2384d8c`.
- Long-term custom-domain service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) remains live on deploy `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`.
- Alternate service `sandbox-hotel-pms` (`srv-d8bchr1akrks73disaog`) remains live on deploy `dep-d8ekph4p3tds738mdp6g`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-01T09:13:20.6391Z`.
- `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, production environment, and database configured/OK.
- `GET https://book.sandboxhotel.com/api/setup/status` returned `200` with `needsSetup=false`, `hasProperty=true`, and `hasUsers=true`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `400` and `Add at least one room type.`, so the public service still reaches setup payload validation instead of the PR #150 completed-setup rejection.
- Canonical evidence: `docs/launch/evidence/2026-07-02-slice-5s-pr-live-setup-refresh.md`.

Still not proven by this refresh:

- Current setup-gate hardening on the public site.
- Approved production user list and role-by-role access matrix against the target environment.
- Current production room inventory configured through onboarding/import.
- Secret key inventory and rotation timestamps.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.

## 2026-07-02T07:14Z Read-Only Render And Setup-Gate Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Render CLI v2.13.0 is authenticated as `nakalastravels@gmail.com`.
- PR #150 remains open, draft, mergeable, and green for head `75810c3fbcf73d6f8a790a607beb3bb3b0bf69a0`.
- `npm.cmd run render:validate` passed with Render Blueprint validation `valid: true`.
- `npm.cmd run live:check` passed for `https://book.sandboxhotel.com`; LINE remains optional and unconfigured.
- Long-term custom-domain service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) remains live on deploy `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`.
- Alternate service `sandbox-hotel-pms` (`srv-d8bchr1akrks73disaog`) remains live on deploy `dep-d8ekph4p3tds738mdp6g`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-01T09:13:20.6391Z`.
- Launch service `sandbox-hotel-pms-launch` (`srv-d8clkqho3t8c73a1eldg`) remains live on deploy `dep-d8oh74m47okc739vhq2g`, commit `5f5b54162156a658bd37ec4c2d00941feea8d037`, finished `2026-06-16T09:13:59.052325Z`. It is not treated as the custom-domain production target in this proof.
- `GET https://book.sandboxhotel.com/api/setup/status` returned `200` with `needsSetup=false`, `hasProperty=true`, and `hasUsers=true`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `400` and `Add at least one room type.`, so the public service still reaches setup payload validation instead of the PR #150 completed-setup rejection.
- No deploy, restart, SSH session, database shell, production mutation, or paid resource action was run. No production secret values, database URLs, tokens, cookies, or passwords were requested or recorded.

Still not proven by this refresh:

- Current setup-gate hardening on the public site.
- Approved production user list and role-by-role access matrix against the target environment.
- Current production room inventory configured through onboarding/import.
- Secret key inventory and rotation timestamps.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.

## 2026-07-02T07:20Z Production Room Inventory Proof Attempt

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Render PostgreSQL `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) is available and not suspended, but this proves only database resource status.
- Non-interactive Render CLI `psql` remains inconclusive: `select 1 as probe;` returned no output for both datastore name and datastore id, and a deliberately invalid read query also returned empty output.
- Unauthenticated `GET https://book.sandboxhotel.com/api/rooms` returned `401 Authentication is required`.
- Unauthenticated `GET https://book.sandboxhotel.com/api/today` returned `401 Authentication is required`.
- No production room inventory counts were recorded. No deploy, restart, SSH session, database mutation, DB-mutating E2E against production, or secret-value access was performed.

Still not proven by this refresh:

- Current production room inventory configured through onboarding/import.
- Approved production user list and role-by-role access matrix against the target environment.
- Secret key inventory and rotation timestamps.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.

## 2026-07-02 Origin Sync And Deploy Boundary

- Tester: Codex in local checkout `D:\sandbox-pms`.
- `git fetch origin` updated `origin/main` to `f5b0849037a55e2c99a3d781d742ba85d2384d8c`, merging PR #149 from `launch-finish-packet-20260702`.
- Local `main` was fast-forwarded to `origin/main` at `f5b0849037a55e2c99a3d781d742ba85d2384d8c`, and the dirty launch evidence/code work was reapplied.
- The setup-completion hardening in `server/pms-service.mjs` and its regression coverage in `scripts/run-business-tests.mjs` remain local working-tree changes, not committed in `origin/main`.
- Long-term custom-domain service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) remains live on deploy `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`.
- Alternate service `sandbox-hotel-pms` (`srv-d8bchr1akrks73disaog`) remains live on deploy `dep-d8ekph4p3tds738mdp6g`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-01T09:13:20.6391Z`.
- Launch service `sandbox-hotel-pms-launch` (`srv-d8clkqho3t8c73a1eldg`) is live on deploy `dep-d8oh74m47okc739vhq2g`, commit `5f5b54162156a658bd37ec4c2d00941feea8d037`, finished `2026-06-16T09:13:59.052325Z`. It is not treated as the custom-domain production target in this proof.
- The Render deploy command was inspected but not run. The long-term service deployment path is production-sensitive because `render.yaml` defines predeploy as `npm run db:migrate && npm run db:seed`.
- No deploy, restart, SSH session, database shell, production mutation, or paid resource action was run. No production secret values, database URLs, tokens, cookies, or passwords were requested or recorded.

Still not proven by this refresh:

- Current setup-gate hardening on the public site.
- Approved production user list and role-by-role access matrix against the target environment.
- Current production room inventory configured through onboarding/import.
- Secret key inventory and rotation timestamps.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.

## 2026-07-02T06:33Z Live Deploy Drift And Setup-Gate Reprobe

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Local `HEAD` and `origin/main` were both `2ba7410e4684697237bf14980544a4084775821c`.
- Long-term custom-domain service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) latest deploy was still `dep-d8i4q3favr4c73afbrg0`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`.
- Alternate service `sandbox-hotel-pms` (`srv-d8bchr1akrks73disaog`) latest deploy was still `dep-d8ekph4p3tds738mdp6g`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-01T09:13:20.6391Z`.
- Public host validation passed for `https://book.sandboxhotel.com`, `https://sandbox-hotel-pms.onrender.com`, and `https://sandbox-hotel-pms-v43m.onrender.com` using `LIVE_EXTRA_URLS=... npm.cmd run live:check`; all three reported `lineWebhookConfigured=false`, which remains optional unless LINE is required.
- `GET https://book.sandboxhotel.com/api/setup/status` returned `200` with `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, and `propertyName=SANDBOX HOTEL`.
- Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `400` and `Add at least one room type.`, so the live public service still reaches setup payload validation instead of rejecting completed setup before validation.
- This refresh confirms live deploy drift remains open and the current-checkout setup-gate hardening is not proven live.
- No deploy, restart, SSH session, database shell, production mutation, or paid resource action was run. No production secret values, database URLs, tokens, cookies, or passwords were requested or recorded.

Still not proven by this refresh:

- Current-checkout setup-gate hardening on the public site.
- Approved production user list and role-by-role access matrix against the target environment.
- Current production room inventory configured through onboarding/import.
- Secret key inventory and rotation timestamps.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.

## 2026-07-02 Read-Only Render And Live Host Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Render CLI v2.13.0 is authenticated as `nakalastravels@gmail.com` in team workspace `My Workspace` (`tea-d6n8kq14tr6s738stj5g`).
- Public host validation passed for `https://book.sandboxhotel.com`, `https://sandbox-hotel-pms.onrender.com`, and `https://sandbox-hotel-pms-v43m.onrender.com` using `LIVE_EXTRA_URLS=... npm.cmd run live:check`; all three reported `lineWebhookConfigured=false`, which remains optional unless LINE is required.
- Long-term custom-domain service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) is not suspended and is live on deploy `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6` (`Improve board folio workflow and smoke checks`), finished `2026-06-06T16:39:42Z`.
- Alternate service `sandbox-hotel-pms` (`srv-d8bchr1akrks73disaog`) is not suspended and is live on deploy `dep-d8ekph4p3tds738mdp6g`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-01T09:13:20Z`.
- Local `origin/main` at the time of this refresh is `2ba7410e4684697237bf14980544a4084775821c`, so both live services lag the current repo and do not include the current-checkout setup-gate hardening.
- Managed production PostgreSQL `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) is `available`, primary, PostgreSQL 17, region `oregon`, plan `basic_256mb`, 15 GB disk, and not suspended.
- Render project environment `Production` (`evm-d6nm1vdm5p6s7398qg7g`) reports `protectedStatus=unprotected`, network isolation disabled, and IP allow list `0.0.0.0/0`.
- No deploy, restart, SSH session, database shell, or paid resource action was run. No production secret values, database URLs, tokens, cookies, or passwords were requested or recorded.

Still not proven by this refresh:

- Secret key inventory and rotation timestamps; the CLI commands used for this refresh did not expose those metadata fields safely.
- Approved production user list and role-by-role access matrix against the target environment.
- Current production room inventory configured through onboarding/import.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner with access proof.
- Upstream Cloudflare/WAF rule IDs and thresholds.
- Live LINE, OTA API, PromptPay, card gateway, or other payment-provider send/charge evidence.
- Current-checkout setup-gate hardening on the public site; live services are on older deploys.

## 2026-06-15 Local And Live Validation Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Code validation passed: `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run test:e2e`, `npm.cmd run build`, `npm.cmd run prod:preflight`, `npm.cmd run render:validate`, `npm.cmd run live:check`, and `npm.cmd run launch:check`.
- `npm.cmd run prod:preflight` passed with the expected warning: LINE credentials are not configured, so live LINE messaging remains disabled.
- `npm.cmd run live:check` passed against `https://book.sandboxhotel.com`; the public health payload reported `lineWebhookConfigured=false`.
- `npm.cmd run launch:check` passed. During that gate, `db:doctor` reported `DATABASE_URL` and `E2E_DATABASE_URL` reachable on local PostgreSQL at `localhost:55432`, Prisma validation ok, and migration status ok for both configured local databases.
- `npm.cmd audit --audit-level=high` returned `found 0 vulnerabilities` inside `launch:check`.
- Guarded DB-mutating E2E passed on the local disposable database only: `ALLOW_DB_E2E=true`, `E2E_DATABASE_URL=postgresql://sandbox:***@localhost:55432/sandbox_hotel_e2e?schema=public`, `npm.cmd run db:e2e:ready`, then `npm.cmd run test:e2e:db`.
- The DB-mutating E2E seed used `SEED_MODE=e2e`, created local/e2e room inventory, skipped database users, and finished with `Database workflow e2e passed`.

Still not proven by this refresh:

- Approved production user list and role-by-role access matrix against the target environment.
- Current production room inventory configured through onboarding/import.
- Current Render secret rotation metadata or screenshots with values redacted.
- Named rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner.
- Upstream Cloudflare/WAF rule IDs and thresholds.
- Live LINE, OTA API, PromptPay, card gateway, or other payment-provider send/charge evidence.

## 2026-07-02T14:34+07:00 Auth/RBAC Unauthenticated Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: read-only/unauthenticated HTTP probes plus Render CLI service inventory. No production credentials, cookies, session tokens, database URLs, or secret values were supplied.
- `render whoami -o json` and `render services -o json` succeeded through the configured Render CLI session; the service inventory included Sandbox PMS services and did not print raw connection strings or secret values.
- Node `fetch` probes against `https://book.sandboxhotel.com` returned `401 Authentication is required.` for unauthenticated `GET /api/auth/me`, `GET /api/rooms`, `GET /api/reservations`, `POST /api/reservations`, `POST /api/payments`, `GET /api/users`, `GET /api/settings/room-setup`, and `POST /api/ops/commands`.
- Unauthenticated `POST /api/auth/logout` returned `200 ok=true`, which only proves the endpoint can clear a session cookie; it is not credentialed production logout proof.
- Canonical evidence: `docs/launch/evidence/AUTH_RBAC_PROOF.md`.

Still not proven by this refresh:

- Approved production user list.
- Credentialed production login/logout.
- Role-by-role production route/API access and denial.
- Bootstrap/setup-token removal or rotation evidence.

## 2026-07-02T14:41+07:00 Secret, Recovery, Rollback, And WAF Posture Refresh

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: read-only Render CLI metadata, non-destructive public-edge probes, and `npm.cmd run live:check`. No deploy, restart, SSH session, database shell, production mutation, DB-mutating E2E, paid resource action, or secret-value access was performed.
- `render workspaces -o json` confirmed workspace `My Workspace` (`tea-d6n8kq14tr6s738stj5g`).
- `render projects -o json` confirmed project `My project` (`prj-d6nm1vdm5p6s7398qg70`).
- `render environments prj-d6nm1vdm5p6s7398qg70 -o json` confirmed environment `Production` (`evm-d6nm1vdm5p6s7398qg7g`) with `protectedStatus=unprotected`, `networkIsolationEnabled=false`, and IP allow list `0.0.0.0/0`.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` confirmed the long-term custom-domain service current live deploy is `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`.
- `render services instances srv-d6ns31h4tr6s73c9i8g0 -o json` returned one observed instance id `srv-d6ns31h4tr6s73c9i8g0-2brwp`.
- `npm.cmd run live:check` passed for `https://book.sandboxhotel.com`; LINE remains optional and unconfigured unless `LIVE_REQUIRE_LINE=true`.
- Non-destructive public-edge probes against `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` returned `404`; `/healthz?deep=1` returned `200`. Each response exposed Cloudflare and Render headers, proving the edge path but not customer-owned WAF/rate-limit rule configuration.
- Canonical evidence: `docs/launch/evidence/WAF_PROVIDER_POSTURE.md`.

Still not proven by this refresh:

- Redacted Render secret key inventory or rotation timestamps.
- Owner confirmation for production secret custody and cleanup decisions for legacy/compatibility keys.
- Named rollback owner, rollback deputy, and database recovery owner.
- Current recovery point/retention proof from Render dashboard/API.
- Upstream WAF/rate-limit rule IDs, thresholds, protected hostnames, and owner-approved non-destructive rate-limit test result.

## 2026-06-07 Disposable Restore Test

- Tester: Codex using the locally authenticated Render CLI/API session for `nakalastravels@gmail.com`.
- Date/time: 2026-06-07T15:51Z-15:57Z.
- Source recovery point: 2026-06-07T14:51:09Z, selected from the Render point-in-time recovery window for `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`).
- Restore target: temporary Render PostgreSQL `sandbox-hotel-pms-db-v43m-copy` (`dpg-d8ip6rdckfvc73c2qirg-a`), database `sandbox_hotel_pms_snep`, user `sandbox_hotel_pms`, plan `basic_256mb`.
- Validation command: `npm.cmd run db:generate`, then `npm.cmd run db:doctor` with `DATABASE_URL` and `E2E_DATABASE_URL` set in process memory to the restored database external URL. The URL value was not printed beyond the script's existing password-redacted summary.
- Result: restore target became `available`; Prisma client generation passed; `db:doctor` reported Prisma validate `ok`, restored database connectivity `ok`, restored database migrate status `ok`, and `Doctor summary: No failing configured checks`.
- Cleanup: the temporary restored database was deleted via Render API at 2026-06-07T15:57:55Z, and a follow-up retrieve returned `404`, confirming the disposable target was removed.

## 2026-06-02 Provider Evidence Refresh

- Render CLI v2.13.0 is authenticated to team workspace `My Workspace` as `nakalastravels@gmail.com`.
- Long-term production service is `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`): repo `https://github.com/nakalasbakalas/sandbox-pms`, branch `main`, manual deploys, starter plan, health check `/healthz`, build `npm ci --include=dev && npm run db:generate && npm run build`, predeploy `npm run db:migrate && npm run db:seed`, start `npm run start`.
- Latest live deploy for `sandbox-hotel-pms-v43m` is `dep-d8ekncs2m8qs7391cvig`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6` (`Improve board folio workflow and smoke checks`), finished at 2026-06-01T09:09:36Z.
- DNS currently maps `book.sandboxhotel.com` -> `sandbox-hotel-pms-v43m.onrender.com` -> Render/Cloudflare edge hosts; `https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `database.configured=true`, `database.ok=true`, and `lineWebhookConfigured=false` at 2026-06-02T08:22:50Z.
- Production preflight was run against the retrieved Render environment for `sandbox-hotel-pms-v43m`; it passed with the expected warning that LINE credentials are not configured, so live LINE messaging remains disabled.
- Render env-var API exposed configured key names only in this record. Required runtime keys with values present include `DATABASE_URL`, `SESSION_SECRET`, `VITE_PMS_API_MODE`, `APP_URL`, `ALLOWED_ORIGINS`, `SEED_MODE`, and `NODE_ENV`; `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` are present but blank. The API response used here did not include creation, update, or rotation timestamps for individual keys.
- Legacy or compatibility key names are still present on the Render service, including `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SECRET_KEY`, and Python-era app settings. Values were not printed. Treat these as cleanup candidates only after confirming they are not required by any active rollback path.
- Render PostgreSQL `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) is `available`, primary, PostgreSQL 17, region `oregon`, plan `basic_256mb`, disk 15 GB, not suspended.
- Render Postgres recovery API reports `recoveryStatus=AVAILABLE`; the 2026-06-07 restore-test pass reported recovery starting at 2026-06-03T21:59:41Z.
- Latest `sandbox-hotel-pms-v43m` deploy logs show predeploy `npm run db:migrate && npm run db:seed`, `prisma migrate deploy`, `prisma db seed`, and `Seed completed successfully` at 2026-06-01T09:08Z.
- Non-destructive probe paths `/.env`, `/wp-login.php`, and `/phpmyadmin/` returned `404` through Cloudflare. This confirms those paths are not exposed, but does not prove customer-owned Cloudflare WAF or rate-limit rule IDs.
- Unauthenticated `GET /api/auth/me` returned `401 Authentication is required`.

## Confirmed Live Runtime

- Public custom domain `https://book.sandboxhotel.com` returned `200` for `/healthz` and `/healthz?deep=1`.
- `https://book.sandboxhotel.com/healthz?deep=1` returned `database.configured=true` and `database.ok=true`.
- `https://sandbox-hotel-pms.onrender.com/healthz?deep=1` returned `database.configured=true` and `database.ok=true`.
- `https://sandbox-hotel-pms-v43m.onrender.com/healthz?deep=1` returned `database.configured=true` and `database.ok=true`.
- Invalid signed-cookie probe against `/api/auth/me` returned `401 Authentication is required` on all three hosts. Under the production server code path, a missing `SESSION_SECRET` would throw while verifying a dotted session token, so this proves a production session secret is present without exposing it.
- `npm run live:check` passed against `https://book.sandboxhotel.com` during the 2026-05-31T03:48Z proof pass after the `3de37ab` deployment.
- Health payload reports `lineWebhookConfigured=false`; LINE live secrets are not configured on the verified runtime.

## Confirmed Render Resources

- Render CLI is authenticated to team workspace `My Workspace` as `nakalastravels@gmail.com`.
- Managed PostgreSQL datastore `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) is `available`, region `oregon`, version `17`, plan `basic_256mb`, database name `sandbox_hotel_pms`.
- Render database logs during the deep health checks show SSL-authorized connections to `sandbox_hotel_pms` from the app, including the `sandbox_hotel_pms` database user.
- Service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) was verified live on commit `3de37abe51fd8b62b72e7f409c8a486b9f1503ad`; deploy `dep-d8dqrqnavr4c7381skpg` finished live at 2026-05-31T03:43:46Z.
- `sandbox-hotel-pms-v43m` is on the `starter` plan and deploy `dep-d8dqrqnavr4c7381skpg` ran `npm run db:migrate && npm run db:seed` successfully in `prod-safe` mode on 2026-05-31T03:42Z-03:43Z. The seed log confirms `Seed completed successfully`.
- The 2026-06-02 refresh selects `sandbox-hotel-pms-v43m` as the long-term production service because the public custom domain resolves to it and its latest live deploy is healthy.
- Service `sandbox-hotel-pms` (`srv-d8bchr1akrks73disaog`) was also verified live on commit `3de37abe51fd8b62b72e7f409c8a486b9f1503ad`; deploy `dep-d8dqt4n7f7vs73cgqr3g` finished live at 2026-05-31T03:46:16Z. Current Render metadata includes `buildPlan=starter`, but the latest deploy log still reported the predeploy command as skipped, so do not use this service as the long-term production rollback path until the Render service ownership/plan metadata path is resolved in the dashboard.

## Domain And Edge Path

- DNS for `book.sandboxhotel.com` currently CNAMEs to `sandbox-hotel-pms-v43m.onrender.com`.
- HTTPS responses from `book.sandboxhotel.com` include `Server: cloudflare`, `CF-RAY`, `x-render-origin-server: Render`, and `cf-cache-status: DYNAMIC`.
- This proves a Cloudflare-backed Render edge path for the public domain. It does not prove a customer-owned Cloudflare zone, custom WAF rule, or rate-limit rule.

## External Items Still Not Proven

- Production secret inventory beyond behavioral proof: the configured Render key names were verified without printing values, but key creation and rotation timestamps were not exposed by the API response used for this pass. Verify rotation status in Render's secret manager.
- Rollback ownership: no named rollback owner, deputy, or access check is recorded in the repo or provider metadata. Assign an owner with Render dashboard access before claiming launch readiness.
- Upstream WAF/rate-limit configuration: no Cloudflare API token, zone access, rule IDs, or thresholds were available. Common probe paths returned 404 through Cloudflare, but the app-layer login limiter is separate and does not replace upstream controls.

## Required Evidence Before Sign-Off

- Render secret manager screenshot or exported metadata showing required key names and rotation dates only, with values redacted.
- Rollback owner and deputy, with the latest known-good deploy ID and a tested rollback path.
- Upstream WAF/rate-limit rule IDs, thresholds, protected hostnames, and a non-destructive test result.

Operational procedures:

- [Disaster Recovery And Rollback](disaster-recovery.md)
- [Upstream WAF And Rate-Limit Plan](upstream-waf-rate-limit.md)

Provider references:

- [Render Postgres Recovery and Backups](https://render.com/docs/postgresql-backups)
- [Render Rollbacks](https://render.com/docs/rollbacks)
- [Cloudflare Rate Limiting Rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
