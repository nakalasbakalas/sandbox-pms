# PMS Lite Render staging deployment

Recorded: 2026-07-14 (Asia/Bangkok)

## Verdict

The validated free Render Blueprint is deployed and healthy on its direct
Render hostname. This proves engineering staging only. Gmail shadowing,
Cloudflare hostname/edge proof, staff pilot, OTA cutovers, and production DNS
remain gated.

## Immutable identity

- Blueprint: `render-lite.yaml`
- Web service: `sandbox-hotel-pms-lite-staging`
- Render service id: `srv-d9asptjeo5us73dh0270`
- Render deploy id: `dep-d9asptreo5us73dh03b0`
- Branch: `codex/sandbox-pms-lite-v1`
- Commit: `2b2b27dd14510afff1a65e1bf24220309de0ea40`
- Deploy status: `live`
- Direct hostname: `https://sandbox-hotel-pms-lite-staging.onrender.com`

## Runtime proof

`GET /healthz?deep=1` returned:

- `ok: true`
- `uiVariant: lite`
- `writeMode: active`
- `database.configured: true`
- `database.ok: true`

`GET /api/version` returned:

- API version: `lite/v1`
- DTO version: `lite-read-v1`
- commit SHA: `2b2b27dd14510afff1a65e1bf24220309de0ea40`
- asset identifier: `assets/index-CTgbifAg.js`
- release id: `srv-d9asptjeo5us73dh0270`
- service name: `sandbox-hotel-pms-lite-staging`
- build time: `2026-07-14T05:46:19.314Z`

The root HTML referenced the same JavaScript identity plus
`assets/index-DXlVsn94.css`.

## Disposable database proof

- Database: `sandbox-hotel-pms-lite-staging-db`
- Render database id: `dpg-d9asp1jeo5us73dgus40-a`
- Plan: Free
- Region: Singapore
- PostgreSQL: 17
- Status at proof time: `available`
- Automatic expiry: `2026-08-13T05:43:35.351116Z`
- Network allowlist: empty
- Prisma connected specifically to database `sandbox_pms_lite_staging` on the
  new Render database resource.
- All 20 repository migrations applied successfully before the process began
  listening on port 10000.

No production database was used or mutated for this proof.

## Gmail/shadow boundary

The connected Gmail profile is `booking@sandboxhotel.com`, but the new staging
service does not yet contain a usable Gmail OAuth credential tuple. The
redacted Render status helper returned `ready: false` for staging. Deep health
also reports Gmail Pub/Sub disabled and missing its topic, subscription,
audience, and service-account-email settings.

The existing non-Lite Render service still reports a complete booking-specific
refresh-token tuple without printing values. Credentials were not copied into
staging automatically, because doing so without the Google Cloud Pub/Sub
resource/audience configuration would not start the required controlled
seven-day shadow comparison.

## Gates held

- Do not create `lite.sandboxhotel.com` until Gmail/Pub/Sub is configured and
  the seven-day shadow comparison is accepted.
- Do not submit Agoda or Trip.com applications without owner business/legal
  details and consent.
- Do not start the 14-day staff pilot until the staging access path is approved.
- Do not disconnect or cut over any OTA.
- Keep PR #173 in draft until all stated rollout gates pass.
