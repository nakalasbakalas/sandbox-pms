# PMS Lite Render staging deployment

Recorded: 2026-07-14 (Asia/Bangkok)

Exact-application revalidation: 2026-07-15 14:05 (Asia/Bangkok)

## Verdict

The validated free Render Blueprint is deployed and healthy on its direct
Render hostname. This proves engineering staging only. Gmail shadowing,
Cloudflare hostname/edge proof, staff pilot, OTA cutovers, and production DNS
remain gated.

## Immutable identity

- Blueprint: `render-lite.yaml`
- Web service: `sandbox-hotel-pms-lite-staging`
- Render service id: `srv-d9asptjeo5us73dh0270`
- Render deploy id: `dep-d9bj0rmcjfls738g425g`
- Branch: `codex/sandbox-pms-lite-v1`
- Reviewed application commit: `5a7ac9254735d1280d811ff5f97ca3cab297e385`
- GitHub CI: run #206 (`29395778538`), both jobs passed
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
- commit SHA: `5a7ac9254735d1280d811ff5f97ca3cab297e385`
- asset identifier: `assets/index-hUnVFC0e.js`
- release id: `srv-d9asptjeo5us73dh0270`
- service name: `sandbox-hotel-pms-lite-staging`
- environment: `staging`
- build time: `2026-07-15T07:02:41.918Z`

The root HTML referenced the same JavaScript identity plus
`assets/index-CaQiWPXh.css`.

Render CLI reported the exact-commit deploy as `live`, and the version, root,
and deep-health probes returned HTTP 200 at 2026-07-15 14:05 Asia/Bangkok. The
previous exact-application deploy `dep-d9bi61vaqgkc739ellj0` at commit
`bf203398...` is deactivated and must not be cited as the current application
release identity.

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
- Startup logs reported `22 migrations found` and `No pending migrations to
  apply` before the process began listening on port 10000.

No production database was used or mutated for this proof.

## Gmail/shadow boundary

The connected Gmail profile is `booking@sandboxhotel.com`. A redacted Render
status check on 2026-07-15 reported the booking-specific refresh-token tuple
as present and `ready: true` without printing values. Pub/Sub is still disabled,
and its topic, subscription, audience, and service-account-email settings are
absent. The bounded public deep-health response no longer exposes integration
or missing-configuration inventories. OAuth presence alone is not intake,
watch, missed-push recovery, or seven-day shadow proof.

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
