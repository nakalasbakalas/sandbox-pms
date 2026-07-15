# PMS Lite Render staging deployment

Recorded: 2026-07-14 (Asia/Bangkok)

Exact-application revalidation: 2026-07-15 13:07 (Asia/Bangkok)

## Verdict

The validated free Render Blueprint is deployed and healthy on its direct
Render hostname. This proves engineering staging only. Gmail shadowing,
Cloudflare hostname/edge proof, staff pilot, OTA cutovers, and production DNS
remain gated.

## Immutable identity

- Blueprint: `render-lite.yaml`
- Web service: `sandbox-hotel-pms-lite-staging`
- Render service id: `srv-d9asptjeo5us73dh0270`
- Render deploy id: `dep-d9bi61vaqgkc739ellj0`
- Branch: `codex/sandbox-pms-lite-v1`
- Reviewed application commit: `bf203398737836e680d72dbdbb5f8b915c636ce2`
- Deploy status: `live`
- Direct hostname: `https://sandbox-hotel-pms-lite-staging.onrender.com`

## Runtime proof

`GET /healthz?deep=1` returned:

- `ok: true`
- `uiVariant: lite`
- `database.configured: true`
- `database.ok: true`

The public deep-health response is intentionally bounded to `ok`, service,
UI variant, timestamp, and database status. It does not expose environment,
write-mode, integration, or missing-configuration inventories.

`GET /api/version` returned:

- API version: `lite/v1`
- DTO version: `lite-read-v1`
- commit SHA: `bf203398737836e680d72dbdbb5f8b915c636ce2`
- asset identifier: `assets/index-DWzxGq80.js`
- release id: `srv-d9asptjeo5us73dh0270`
- service name: `sandbox-hotel-pms-lite-staging`
- environment: `staging`
- build time: `2026-07-15T06:05:30.590Z`

The root HTML referenced the same JavaScript identity plus
`assets/index-C2aq233g.css`.

Render CLI reported the exact-commit deploy as `live`, and the version, root,
and deep-health probes returned HTTP 200 at 2026-07-15 13:07 Asia/Bangkok. The
previous deploy `dep-d9b5qphkh4rs73chqd10` at commit `0583c6ab...` is
deactivated and must not be cited as the current application release identity.

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
- All 22 repository migrations applied successfully before the process began
  listening on port 10000.

No production database was used or mutated for this proof.

## Gmail/shadow boundary

The connected Gmail profile is `booking@sandboxhotel.com`, but the staging
service does not yet contain a usable Gmail OAuth credential tuple. The
redacted Render status helper returned `ready: false` for staging. The bounded
public deep-health response no longer exposes integration or missing-
configuration inventories. No Gmail shadow proof is claimed.

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
