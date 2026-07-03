# Live Environment Proof Register

Latest validation refresh: 2026-07-02.
Latest external provider evidence refresh: 2026-07-02T08:00Z.

This register records point-in-time external evidence gathered from the live Render workspace, public HTTPS endpoints, DNS, and provider documentation. It must not contain secret values. Use the Render dashboard or CLI for the current deploy ID after later documentation-only releases.

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
