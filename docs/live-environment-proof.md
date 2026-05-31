# Live Environment Proof Register

Verified at: 2026-05-31T03:03Z

This register records external evidence gathered from the live Render workspace, public HTTPS endpoints, DNS, and provider documentation. It must not contain secret values.

## Confirmed Live Runtime

- Public custom domain `https://book.sandboxhotel.com` returned `200` for `/healthz` and `/healthz?deep=1`.
- `https://book.sandboxhotel.com/healthz?deep=1` returned `database.configured=true` and `database.ok=true`.
- `https://sandbox-hotel-pms.onrender.com/healthz?deep=1` returned `database.configured=true` and `database.ok=true`.
- `https://sandbox-hotel-pms-v43m.onrender.com/healthz?deep=1` returned `database.configured=true` and `database.ok=true`.
- Invalid signed-cookie probe against `/api/auth/me` returned `401 Authentication is required` on all three hosts. Under the production server code path, a missing `SESSION_SECRET` would throw while verifying a dotted session token, so this proves a production session secret is present without exposing it.
- `npm run live:check` passed against `https://book.sandboxhotel.com`.
- Health payload reports `lineWebhookConfigured=false`; LINE live secrets are not configured on the verified runtime.

## Confirmed Render Resources

- Render CLI is authenticated to team workspace `My Workspace` as `nakalastravels@gmail.com`.
- Managed PostgreSQL datastore `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) is `available`, region `oregon`, version `17`, plan `basic_256mb`, database name `sandbox_hotel_pms`.
- Render database logs during the deep health checks show SSL-authorized connections to `sandbox_hotel_pms` from the app, including the `sandbox_hotel_pms` database user.
- Service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) is live on commit `85c0e2bf6117223673fdec53d747a8c7039bee6c`.
- `sandbox-hotel-pms-v43m` is on the `starter` plan and its latest deploy ran `npm run db:migrate && npm run db:seed` successfully in `prod-safe` mode on 2026-05-30T16:05Z. The seed log confirms `Users: 0 database users seeded`.
- Service `sandbox-hotel-pms` (`srv-d8bchr1akrks73disaog`) is also live on commit `85c0e2bf6117223673fdec53d747a8c7039bee6c`; current Render metadata includes `buildPlan=starter`.

## Domain And Edge Path

- DNS for `book.sandboxhotel.com` currently CNAMEs to `sandbox-hotel-pms-v43m.onrender.com`.
- HTTPS responses from `book.sandboxhotel.com` include `Server: cloudflare`, `CF-RAY`, `x-render-origin-server: Render`, and `cf-cache-status: DYNAMIC`.
- This proves a Cloudflare-backed Render edge path for the public domain. It does not prove a customer-owned Cloudflare zone, custom WAF rule, or rate-limit rule.

## External Items Still Not Proven

- Production secret inventory beyond behavioral proof: Render CLI and local environment checks did not expose secret key metadata such as creation time, last rotation, or exact configured key set. Do not print secret values; verify presence and rotation status in Render's secret manager.
- Database backup status: Render PostgreSQL is available on a paid database plan, but this pass did not prove the latest recovery point, backup retention, or a successful restore test. Use Render's Postgres recovery/backups UI and record the latest recovery point plus a restore-test date before launch.
- Rollback ownership: no named rollback owner, deputy, or access check is recorded in the repo or provider metadata. Assign an owner with Render dashboard access before claiming launch readiness.
- Upstream WAF/rate-limit configuration: no Cloudflare API token, zone access, rule IDs, thresholds, or test evidence were available. The app-layer login limiter is separate and does not replace upstream controls.
- Service/domain alignment: `APP_URL` and `ALLOWED_ORIGINS` are aligned to `https://book.sandboxhotel.com`; the remaining ownership item is to choose one Render service as the long-term production service for the custom domain and rollback path.

## Required Evidence Before Sign-Off

- Render secret manager screenshot or exported metadata showing required key names only, with values redacted.
- Render Postgres backup/recovery evidence showing latest available recovery point and retention.
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
