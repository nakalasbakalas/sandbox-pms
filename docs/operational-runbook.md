# Operational Runbook

## Release Gate

Run the local release gate before guest-facing deployment:

```bash
npm run launch:check
```

The gate covers Prisma client generation, database diagnostics, lint, typecheck, business tests, browser E2E smoke, build, and high-severity audit checks.

Run the live public-runtime check after deployment:

```bash
npm run live:check
```

Set `LIVE_APP_URL` or `LIVE_EXTRA_URLS` when validating a non-default production host.

External live-environment evidence is tracked in [live-environment-proof.md](live-environment-proof.md). Do not treat launch readiness as signed off until that register has current proof for production secrets, hosted database connectivity, backups, rollback ownership, and upstream WAF/rate-limit configuration.

Backup, restore, and rollback procedures are defined in [disaster-recovery.md](disaster-recovery.md). Upstream WAF and rate-limit expectations are defined in [upstream-waf-rate-limit.md](upstream-waf-rate-limit.md).

## Production Environment

Required production values:

- `NODE_ENV=production`
- `VITE_PMS_API_MODE=server`
- `DATABASE_URL`
- `SESSION_SECRET`
- `SEED_MODE=prod-safe`
- `APP_URL`
- `ALLOWED_ORIGINS`

Login throttling is enabled in the app process. Keep the defaults unless an incident review requires a different value:

- `LOGIN_THROTTLE_WINDOW_MS=900000`
- `LOGIN_LOCKOUT_MS=900000`
- `LOGIN_ACCOUNT_MAX_ATTEMPTS=5`
- `LOGIN_IP_MAX_ATTEMPTS=20`

An upstream WAF or platform rate limit is still recommended, but it is not a substitute for the application-layer limiter.

## Deployment

Render deployment uses `render.yaml`. The production sequence is:

1. Install dependencies.
2. Generate Prisma client.
3. Build the Vite app.
4. Run migrations.
5. Run `prod-safe` seed.
6. Start `node server/index.mjs`.

Docker deployment can use:

```bash
docker compose up --build
```

The Compose stack starts Postgres, runs migrations and seed once, then starts the app on `http://localhost:10000`.

## Auth Sessions

Server mode uses signed `HttpOnly` cookie sessions. Frontend code must not store session tokens in `localStorage`, Spark KV, IndexedDB, or JavaScript-readable cookies.

If staff report login loops:

1. Confirm `SESSION_SECRET` is stable across deploys.
2. Confirm `APP_URL` and `ALLOWED_ORIGINS` match the browser origin.
3. Check whether the login throttle is returning `429`.
4. Confirm browser cookies are accepted for the app origin.

## Rollback

For application regressions, rollback to the last known good deployment from the hosting dashboard. For schema changes, review the Prisma migration before rollback and avoid destructive database edits without a backup.

Before launch, assign a rollback owner and deputy in the live proof register. The owner must have Render dashboard access, know the current production service ID, and record the latest known-good deploy ID before each release.

Before any database recovery:

- Take a fresh backup.
- Record the deployment version and migration state.
- Verify the target database is production only when intentionally performing production recovery.

## Incident Notes

Record incident start time, user-visible impact, suspected subsystem, mitigation, and follow-up action. Do not paste credentials, guest identifiers, payment references, or raw integration tokens into incident notes.
