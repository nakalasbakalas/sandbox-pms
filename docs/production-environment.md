# Production Environment And Live Accounts

This repo can generate app-owned secrets and validate production environment variables. It cannot create or verify third-party business accounts without the account owner's authenticated provider access.

## App-Owned Credentials

Generate an ignored local credential bundle:

```bash
npm run prod:credentials
```

The generated file is `ops/production-credentials.local` and is ignored by git.

Use these values as follows:

- `SESSION_SECRET`: Render can generate this automatically from `render.yaml`. Use the local value only on platforms without generated secrets.
- `SEED_USERS_JSON`: preferred for approved real staff/admin accounts, using hash-only entries.
- `SEED_ADMIN_EMAIL`: legacy single-admin bootstrap fallback.
- `SEED_ADMIN_PASSWORD_HASH`: set this in Render only for the legacy bootstrap fallback.
- `SEED_ADMIN_TEMP_PASSWORD`: only generated when `npm run prod:credentials -- --with-temp-admin --admin-email owner@example.com` is used for the legacy bootstrap path.

Before deployment, run:

```bash
npm run prod:preflight
```

The preflight verifies production mode, server auth mode, safe seed mode, a real database URL, a strong session secret, safe E2E flags, seed user shape/hash validity, legacy bootstrap email/hash pairing, and complete LINE credentials when LINE is enabled.

## Render Environment

The intended Render web service is connected to `https://github.com/nakalasbakalas/sandbox-pms`, branch `main`. Confirm the live Render service connection before running migrations or production seed.

The committed Blueprint defines the intended production resources:

- web service: `sandbox-hotel-pms`
- managed PostgreSQL database: `sandbox-hotel-pms-db-v43m`
- health check: `/healthz`
- production auth mode: `VITE_PMS_API_MODE=server`
- production app URL: `APP_URL=https://sandbox-hotel-pms.onrender.com`
- browser API allowlist: `ALLOWED_ORIGINS=https://sandbox-hotel-pms.onrender.com`
- production seed mode: `SEED_MODE=prod-safe`
- generated session secret: `SESSION_SECRET`

Apply a new Blueprint only from a repository branch that contains the current `render.yaml`. The Dashboard path is:

```text
https://dashboard.render.com/blueprint/new?repo=https://github.com/nakalasbakalas/sandbox-pms
```

Fill all `sync: false` values in Render's secret manager before first deploy. Do not paste live secrets into tracked files.

The committed Blueprint uses the `starter` instance type so Render can run `preDeployCommand`. If the active service is kept on the free instance type, Render skips pre-deploy commands; apply migrations and `SEED_MODE=prod-safe` seed through a reviewed one-time Render build command or move the service to a supported paid instance type before relying on pre-deploy.

If a custom domain replaces the default Render host, update both `APP_URL` and `ALLOWED_ORIGINS` before deploying. The server blocks browser-origin `/api/*` requests that are not same-origin or listed in `ALLOWED_ORIGINS`; non-browser webhooks without an `Origin` header still work.

## LINE Live Account

A LINE Official Account and Messaging API channel must be created by the account owner in LINE's developer console. After the channel exists, set:

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`

Use this webhook URL after the Render service has a stable HTTPS URL:

```text
https://<production-host>/api/line/webhook
```

The webhook endpoint returns a safe configuration status on `GET` and verifies `x-line-signature` on `POST`.

## OTA And Payment Accounts

The current production server does not consume live OTA or payment provider credentials. Do not claim OTA, card, PromptPay, or payment-gateway accounts are live until provider-specific server adapters, secret names, sandbox tests, and production webhook checks are implemented and verified.

For launch, treat OTA channels as operational metadata unless live provider adapters are added. Treat PromptPay/card/payment collection as recorded PMS payments unless a real payment gateway integration is added.
