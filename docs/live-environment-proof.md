# Live Environment Proof Register

Verified at: 2026-06-02T08:25Z

This register records point-in-time external evidence gathered from the live Render workspace, public HTTPS endpoints, DNS, and provider documentation. It must not contain secret values. Use the Render dashboard or CLI for the current deploy ID after later documentation-only releases.

## 2026-06-02 Provider Evidence Refresh

- Render CLI v2.13.0 is authenticated to team workspace `My Workspace` as `nakalastravels@gmail.com`.
- Long-term production service is `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`): repo `https://github.com/nakalasbakalas/sandbox-pms`, branch `main`, manual deploys, starter plan, health check `/healthz`, build `npm ci --include=dev && npm run db:generate && npm run build`, predeploy `npm run db:migrate && npm run db:seed`, start `npm run start`.
- Latest live deploy for `sandbox-hotel-pms-v43m` is `dep-d8ekncs2m8qs7391cvig`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6` (`Improve board folio workflow and smoke checks`), finished at 2026-06-01T09:09:36Z.
- DNS currently maps `book.sandboxhotel.com` -> `sandbox-hotel-pms-v43m.onrender.com` -> Render/Cloudflare edge hosts; `https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `database.configured=true`, `database.ok=true`, and `lineWebhookConfigured=false` at 2026-06-02T08:22:50Z.
- Production preflight was run against the retrieved Render environment for `sandbox-hotel-pms-v43m`; it passed with the expected warning that LINE credentials are not configured, so live LINE messaging remains disabled.
- Render env-var API exposed configured key names only in this record. Required runtime keys with values present include `DATABASE_URL`, `SESSION_SECRET`, `VITE_PMS_API_MODE`, `APP_URL`, `ALLOWED_ORIGINS`, `SEED_MODE`, and `NODE_ENV`; `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` are present but blank. The API response used here did not include creation, update, or rotation timestamps for individual keys.
- Legacy or compatibility key names are still present on the Render service, including `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SECRET_KEY`, and Python-era app settings. Values were not printed. Treat these as cleanup candidates only after confirming they are not required by any active rollback path.
- Render PostgreSQL `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) is `available`, primary, PostgreSQL 17, region `oregon`, plan `basic_256mb`, disk 15 GB, not suspended.
- Render Postgres recovery API reports `recoveryStatus=AVAILABLE` with point-in-time recovery starting at 2026-05-29T21:59:40Z. Recent database logs also show successful WAL archive-push events at 2026-06-02T08:20Z and 2026-06-02T08:25Z.
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
- Restore test status: Render point-in-time recovery is available from 2026-05-29T21:59:40Z, but no disposable-database restore test was triggered or recorded in this pass.
- Rollback ownership: no named rollback owner, deputy, or access check is recorded in the repo or provider metadata. Assign an owner with Render dashboard access before claiming launch readiness.
- Upstream WAF/rate-limit configuration: no Cloudflare API token, zone access, rule IDs, or thresholds were available. Common probe paths returned 404 through Cloudflare, but the app-layer login limiter is separate and does not replace upstream controls.

## Required Evidence Before Sign-Off

- Render secret manager screenshot or exported metadata showing required key names and rotation dates only, with values redacted.
- Restore test record against a disposable database, including tester, date, source recovery point, and result.
- Rollback owner and deputy, with the latest known-good deploy ID and a tested rollback path.
- Upstream WAF/rate-limit rule IDs, thresholds, protected hostnames, and a non-destructive test result.

Operational procedures:

- [Disaster Recovery And Rollback](disaster-recovery.md)
- [Upstream WAF And Rate-Limit Plan](upstream-waf-rate-limit.md)

Provider references:

- [Render Postgres Recovery and Backups](https://render.com/docs/postgresql-backups)
- [Render Rollbacks](https://render.com/docs/rollbacks)
- [Cloudflare Rate Limiting Rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
