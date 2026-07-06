# Secret, Recovery, Rollback, and WAF Provider Posture

Status date: 2026-07-04.

Verdict: partial/open. Safe Render and public-edge metadata has been refreshed through Slice 5BV, and a read-only owner-run Cloudflare WAF/rate-limit proof helper now exists. This does not close the P0 because no Cloudflare API token or zone ID is available in this environment, and 2026-07-06 Cloudflare connector/tool discovery did not expose callable Cloudflare action tools in this Codex session. Nick owns Cloudflare launch proof. Secret rotation metadata, latest recovery-point proof, and upstream WAF/rate-limit rule IDs still require account-owner/provider evidence.

## Scope

- Public target: `https://book.sandboxhotel.com`.
- Render workspace observed through CLI: `My Workspace` (`tea-d6n8kq14tr6s738stj5g`) with account email `nakalastravels@gmail.com`.
- Commands were read-only except for explicitly noted Render deploy-sync slices. No restart, SSH session, database shell, production data mutation, DB-mutating E2E, paid resource action, or secret-value access was performed.
- No production secrets, raw database URLs, tokens, passwords, cookies, or screenshots were recorded.

## 2026-07-04 Slice 5BV Refresh

Slice 5BV adds `2026-07-04-slice-5bv-current-main-runtime-sync.md` and refreshes the current custom-domain service deploy plus public-edge/WAF boundary:

- GitHub CI run `28703308473` passed for commit `d8884884faba8b50cb73c7f827aa4f9871744d4a`.
- `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit d8884884faba8b50cb73c7f827aa4f9871744d4a --wait --confirm -o json` deployed exact commit `d8884884faba8b50cb73c7f827aa4f9871744d4a`.
- Render deploy `dep-d94e5e7lk1mc73b3oh2g` is live on `sandbox-hotel-pms-v43m`, status `live`, finished `2026-07-04T10:41:18.349146Z`.
- Direct public `GET /healthz?deep=1` returned `200`, production environment, database configured/OK, `server=cloudflare`, and `X-Render-Origin-Server=Render`.
- Direct public setup-complete reprobe returned the intended production-disabled `403`.
- A first `npm.cmd run public-edge:proof` attempt aborted immediately after deploy, then a retry completed at `2026-07-04T10:42:23.971Z`: `/healthz?deep=1` returned `200`, production environment, database configured/OK, `server=cloudflare`, `cfRayPresent=true`, `cfCacheStatus=DYNAMIC`, `renderOriginServer=Render`, and common security-header presence; `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` returned `404` with response bodies omitted.
- `npm.cmd run live:check` and `npm.cmd run prod:preflight` passed. Production preflight still warns that LINE credentials are not configured.

This keeps public-edge evidence current for the latest deploy. It still does not prove customer-owned Cloudflare zone control, WAF/rate-limit rule IDs, thresholds/actions, protected hostnames, or an owner-approved non-destructive WAF/rate-limit test.

## 2026-07-04 Slice 5BU Refresh

Slice 5BU adds `2026-07-04-slice-5bu-cloudflare-waf-proof-helper.md` and the owner-run helper `npm.cmd run cloudflare:waf:proof`:

- Official Cloudflare docs identify the WAF phases as `http_request_firewall_custom`, `http_ratelimit`, and `http_request_firewall_managed`, and the Rulesets API read path as account/zone ruleset list and view operations.
- `scripts/prove-cloudflare-waf-rules.mjs` reads Cloudflare Rulesets API metadata only. It summarizes rule IDs, actions, enabled status, rate-limit thresholds, and target-hostname coverage while omitting API tokens, action parameters, response bodies, and rule expressions by default.
- `npm.cmd run cloudflare:waf:proof -- --help` passed and printed the owner-run usage path.
- `npm.cmd run cloudflare:waf:proof` failed as expected with redacted `ready=false` output because `CLOUDFLARE_API_TOKEN`/`CF_API_TOKEN` and `CLOUDFLARE_ZONE_ID`/`CF_ZONE_ID` are absent.
- `npm.cmd test` passed with coverage for WAF/rate-limit ruleset summarization and redaction defaults.
- `wrangler` and `cloudflared` are still unavailable on PATH in this session.
- Local environment key-presence checks for `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CF_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, and `CF_ZONE_ID` all returned absent. No values were printed.
- A first `npm.cmd run public-edge:proof` attempt aborted at the request layer, then a retry passed at `2026-07-04T10:22:28.812Z`: `/healthz?deep=1` returned `200`, production environment, database configured/OK, `server=cloudflare`, `CF-RAY` present, `CF-Cache-Status=DYNAMIC`, `X-Render-Origin-Server=Render`, and common security-header presence; `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` returned `404` with bodies omitted.

This improves the collection path for privileged Cloudflare WAF/rate-limit proof. It still does not prove customer-owned zone access, WAF/rate-limit rule IDs, thresholds/actions, protected hostnames, or owner-approved non-destructive WAF/rate-limit behavior.

## 2026-07-04 Slice 5BS Refresh

Slice 5BS adds `2026-07-04-slice-5bs-current-main-render-deploy.md` and refreshes the current custom-domain service deploy plus public-edge/WAF boundary:

- GitHub CI run `28701971403` passed for commit `e348fd6d076b2bf094dca1c77c372a2bbed612c4`.
- `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit e348fd6d076b2bf094dca1c77c372a2bbed612c4 --wait --confirm -o json` deployed exact commit `e348fd6d076b2bf094dca1c77c372a2bbed612c4`.
- Render deploy `dep-d94daaflk1mc73b1m6m0` is live on `sandbox-hotel-pms-v43m`, status `live`, finished `2026-07-04T09:43:28.291471Z`.
- Direct public `GET /healthz?deep=1` returned `200`, production environment, database configured/OK, `server=cloudflare`, and `X-Render-Origin-Server=Render`.
- Direct public setup-complete reprobe returned the intended production-disabled `403`.
- `npm.cmd run public-edge:proof` completed at `2026-07-04T09:43:55.241Z`: `/healthz?deep=1` returned `200`, production environment, database configured/OK, `server=cloudflare`, `cfRayPresent=true`, `cfCacheStatus=DYNAMIC`, `renderOriginServer=Render`, and common security-header presence; `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` returned `404` with response bodies omitted.

This keeps public-edge evidence current for the latest deploy. It still does not prove customer-owned Cloudflare zone control, WAF/rate-limit rule IDs, thresholds/actions, protected hostnames, or an owner-approved non-destructive WAF/rate-limit test.

## 2026-07-04 Slice 5BO Refresh

Slice 5BO adds `2026-07-04-slice-5bo-cloudflare-waf-boundary-refresh.md` and refreshes the public-edge/WAF boundary:

- GitHub CI run `28695722234` passed for commit `e75960716c4f6c0e1fbeeec7e626f2fd6e787ca6`.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 --output json` confirmed the latest live custom-domain service deploy remains `dep-d945rdpkh4rs73ei9asg`, status `live`, commit `c8acc1df271711d0b1c8e81419fbd76d5b6e2c4a`, finished `2026-07-04T01:13:46.233348Z`.
- Tool discovery did not expose a callable Cloudflare WAF/rate-limit inspection action in this session.
- `wrangler` and `cloudflared` were not found on PATH.
- Local environment key-presence checks for `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CF_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, and `CF_ZONE_ID` all returned absent. No values were printed.
- `Resolve-DnsName book.sandboxhotel.com` resolved through the Render/Cloudflare-backed chain and returned A records `216.24.57.8` and `216.24.57.9`.
- An initial full `npm.cmd run public-edge:proof` attempt aborted, then single-path probes for `/healthz?deep=1`, `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` each passed.
- A retry of full `npm.cmd run public-edge:proof` completed at `2026-07-04T08:35:09.546Z`: `/healthz?deep=1` returned `200`, production environment, database configured/OK, `server=cloudflare`, `cfRayPresent=true`, `cfCacheStatus=DYNAMIC`, `renderOriginServer=Render`, and common security-header presence; `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` returned `404` with response bodies omitted.

This keeps public-edge evidence current and documents the exact local Cloudflare inspection gap. It still does not prove customer-owned Cloudflare zone control, WAF/rate-limit rule IDs, thresholds/actions, protected hostnames, or an owner-approved non-destructive WAF/rate-limit test.

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

## 2026-07-03 Slice 5BF Update

Slice 5BF adds `2026-07-03-slice-5bf-public-edge-proof-helper.md` and a repeatable no-secret public-edge proof command, then deploys that helper to the long-term public Render service:

- `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit 0de2eb3d612a555dbd6cac92948becd16aa24cae --wait --confirm --output json` deployed exact commit `0de2eb3d612a555dbd6cac92948becd16aa24cae`.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 --output json` confirmed latest live deploy `dep-d93ud5nlk1mc73a2sbv0`, status `live`, commit `0de2eb3d612a555dbd6cac92948becd16aa24cae`, finished `2026-07-03T16:45:40Z`.
- Direct public `GET /healthz?deep=1` returned `200`, database configured, database OK, `server=cloudflare`, `CF-RAY` present, and `X-Render-Origin-Server=Render`.
- Direct public setup-complete reprobe returned the intended production-disabled `403`.
- `npm.cmd run public-edge:proof` completed at `2026-07-03T16:45:57.468Z`.
- `/healthz?deep=1` returned `200`, `ok=true`, production environment, database configured/OK, `server=cloudflare`, `cfRayPresent=true`, `cfCacheStatus=DYNAMIC`, and `renderOriginServer=Render`.
- `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` each returned `404` with Cloudflare and Render origin headers.
- Probed responses reported `strictTransportSecurityPresent=true`, `contentSecurityPolicyPresent=true`, and `xFrameOptionsPresent=true`.
- The command sent no cookies or authorization headers, requested no secrets, and omitted response bodies except bounded health fields.
- Tool discovery exposed no callable Cloudflare actions; local `wrangler` was not found; no `CLOUDFLARE*` or `CF_*` process env credentials were present.

This improves repeatability of public-edge evidence. It still does not prove customer-owned WAF/rate-limit rule configuration.

## 2026-07-04 Slice 5BH Update

Slice 5BH adds `2026-07-04-slice-5bh-live-gmail-refresh.md` and refreshes the no-secret public-edge proof:

- `render deploys list srv-d6ns31h4tr6s73c9i8g0 --output json` confirmed current live deploy remains `dep-d93ud5nlk1mc73a2sbv0`, status `live`, commit `0de2eb3d612a555dbd6cac92948becd16aa24cae`.
- `npm.cmd run public-edge:proof` completed at `2026-07-03T23:16:30.015Z`.
- `/healthz?deep=1` returned `200`, `ok=true`, production environment, database configured/OK, `server=cloudflare`, `cfRayPresent=true`, `cfCacheStatus=DYNAMIC`, and `renderOriginServer=Render`.
- `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` each returned `404` with Cloudflare and Render origin headers.
- Probed responses reported `strictTransportSecurityPresent=true`, `contentSecurityPolicyPresent=true`, and `xFrameOptionsPresent=true`.

This keeps public-edge evidence current. It still does not prove customer-owned WAF/rate-limit rule configuration.

## 2026-07-04 Slice 5BM Update

Slice 5BM adds `2026-07-04-slice-5bm-render-gmail-mailbox-config.md`, configures non-secret booking mailbox identity keys on Render, and refreshes the current custom-domain service deploy plus public-edge proof:

- `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit c8acc1df271711d0b1c8e81419fbd76d5b6e2c4a --wait --confirm --output json` deployed exact commit `c8acc1df271711d0b1c8e81419fbd76d5b6e2c4a`.
- Render deploy `dep-d945rdpkh4rs73ei9asg` is live on `sandbox-hotel-pms-v43m`, finished `2026-07-04T01:13:46Z`.
- `npm.cmd run public-edge:proof` completed at `2026-07-04T01:14:11.343Z`.
- `/healthz?deep=1` returned `200`, `ok=true`, production environment, database configured/OK, `server=cloudflare`, `cfRayPresent=true`, `cfCacheStatus=DYNAMIC`, and `renderOriginServer=Render`.
- `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` each returned `404` with Cloudflare and Render origin headers.
- Probed responses reported `strictTransportSecurityPresent=true`, `contentSecurityPolicyPresent=true`, and `xFrameOptionsPresent=true`.
- The command sent no cookies or authorization headers, requested no secrets, and omitted response bodies except bounded health fields.

This keeps public-edge evidence current. It still does not prove customer-owned WAF/rate-limit rule configuration.

## 2026-07-04 Slice 5BJ Update

Slice 5BJ adds `2026-07-04-slice-5bj-current-helper-deploy-sync.md` and deploys the current green helper commit to the long-term public Render service:

- `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit 04d06d3351fa02154e258a35b84a379dd219db22 --wait --confirm --output json` deployed exact commit `04d06d3351fa02154e258a35b84a379dd219db22`.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 --output json` confirmed latest live deploy `dep-d944ml4vikkc73bido10`, status `live`, commit `04d06d3351fa02154e258a35b84a379dd219db22`, finished `2026-07-03T23:55:30Z`.
- `npm.cmd run public-edge:proof` completed at `2026-07-03T23:55:52.008Z`.
- `/healthz?deep=1` returned `200`, `ok=true`, production environment, database configured/OK, `server=cloudflare`, `cfRayPresent=true`, `cfCacheStatus=DYNAMIC`, and `renderOriginServer=Render`.
- `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` each returned `404` with Cloudflare and Render origin headers.
- Probed responses reported `strictTransportSecurityPresent=true`, `contentSecurityPolicyPresent=true`, and `xFrameOptionsPresent=true`.
- The command sent no cookies or authorization headers, requested no secrets, and omitted response bodies except bounded health fields.

This keeps public-edge evidence current. It still does not prove customer-owned WAF/rate-limit rule configuration.

## 2026-07-04 Slice 5BK Update

Slice 5BK adds `2026-07-04-slice-5bk-current-main-deploy-gmail-boundary.md` and deploys exact current `main` evidence commit to the long-term public Render service:

- `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit c377f6a9f0cc8e6c2dbbca53366e50767b30f272 --wait --confirm --output json` deployed exact commit `c377f6a9f0cc8e6c2dbbca53366e50767b30f272`.
- `render deploys list srv-d6ns31h4tr6s73c9i8g0 --output json` confirmed latest live deploy `dep-d945194vikkc73bj92ng`, status `live`, commit `c377f6a9f0cc8e6c2dbbca53366e50767b30f272`, finished `2026-07-04T00:18:12Z`.
- `npm.cmd run public-edge:proof` completed at `2026-07-04T00:18:32.148Z`.
- `/healthz?deep=1` returned `200`, `ok=true`, production environment, database configured/OK, `server=cloudflare`, `cfRayPresent=true`, `cfCacheStatus=DYNAMIC`, and `renderOriginServer=Render`.
- `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` each returned `404` with Cloudflare and Render origin headers.
- Probed responses reported `strictTransportSecurityPresent=true`, `contentSecurityPolicyPresent=true`, and `xFrameOptionsPresent=true`.
- The command sent no cookies or authorization headers, requested no secrets, and omitted response bodies except bounded health fields.

This keeps public-edge evidence current. It still does not prove customer-owned WAF/rate-limit rule configuration.

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
| `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Current long-term custom-domain service deploy is `dep-d94e5e7lk1mc73b3oh2g`, status `live`, commit `d8884884faba8b50cb73c7f827aa4f9871744d4a`, finished `2026-07-04T10:41:18Z`. |
| `render deploys list srv-d8bchr1akrks73disaog -o json` | Passed | Alternate service deploy is `dep-d8ekph4p3tds738mdp6g`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-01T09:13:20.6391Z`. |
| `render deploys list srv-d8clkqho3t8c73a1eldg -o json` | Passed | Launch service deploy is `dep-d8oh74m47okc739vhq2g`, status `live`, commit `5f5b54162156a658bd37ec4c2d00941feea8d037`, finished `2026-06-16T09:13:59.052325Z`; this is not the custom-domain production target. |
| `npm.cmd run public-edge:proof` | Passed | Slice 5BV direct `/healthz?deep=1` returned `200` with Cloudflare and Render origin headers plus common security-header presence; `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` returned `404` with Cloudflare/Render response headers. Response bodies were omitted. |
| `npm.cmd run cloudflare:waf:proof -- --help` | Passed | Slice 5BU added an owner-run helper for read-only Cloudflare Rulesets API WAF/rate-limit proof. |
| `npm.cmd run cloudflare:waf:proof` | Failed as expected; missing owner inputs | Slice 5BU produced redacted `ready=false` output because no Cloudflare API token or zone ID is available in this environment. |
| `npm.cmd run prod:preflight` | Passed with warning | Production preflight passed; LINE credentials remain unconfigured and live LINE messaging remains disabled. |
| `npm.cmd run live:check` | Passed | Public health/deep-health passed for `https://book.sandboxhotel.com`; LINE remains optional and unconfigured unless `LIVE_REQUIRE_LINE=true`. Latest Slice 5AV run resolved `book.sandboxhotel.com` to `216.24.57.9`. |

## Current Provider Posture

- Long-term custom-domain Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`).
- Current live deploy for that service: `dep-d94e5e7lk1mc73b3oh2g`, commit `d8884884faba8b50cb73c7f827aa4f9871744d4a`.
- Render PostgreSQL target remains `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) with status `available`, region `oregon`, and plan `basic_256mb` as reported by safe service metadata.
- Render Production environment metadata reports `protectedStatus=unprotected`, `networkIsolationEnabled=false`, and IP allow list `0.0.0.0/0`.
- Public edge responses prove routing/denial/header behavior only. They do not prove customer-owned Cloudflare zone control, managed WAF rules, rule IDs, thresholds, or rate-limit behavior.

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

- `docs/disaster-recovery.md` was updated to use the current live deploy `dep-d94e5e7lk1mc73b3oh2g` as the latest health-checked live deploy reference.
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
