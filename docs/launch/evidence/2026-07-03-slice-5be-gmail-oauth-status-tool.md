# Slice 5BE - Gmail OAuth Render Status Tool

Date: 2026-07-03

## Verdict

Backend Gmail OAuth is still not configured on the custom-domain Render service, and no booking-email Gmail values were available locally to apply. This slice adds a repeatable redacted Render status command so future checks can confirm key presence and credential-path readiness without ad hoc API snippets or secret exposure.

## Target

- Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`)
- Booking mailbox: `booking@sandboxhotel.com`
- Current live deploy at check time: `dep-d93tr24vikkc73b3quug`

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| GitHub CI | Passed | Run `28671225263` completed `Install, test, build, and launch-check` successfully for commit `ad2b7267d7ac625708b935fa058361e86dfa09fb`. |
| Exact Render deploy | Passed | `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit ad2b7267d7ac625708b935fa058361e86dfa09fb --wait --confirm --output json` returned live deploy `dep-d93tr24vikkc73b3quug`, finished `2026-07-03T16:07:00Z`. |
| Public deep health | Passed | `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, `environment=production`, database configured/OK, Cloudflare server header, `CF-RAY`, and `X-Render-Origin-Server=Render` at `2026-07-03T16:07:28Z`. |
| Setup-complete public reprobe | Passed | Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and the production-disabled setup message at `2026-07-03T16:07:26Z`. |
| Live readiness and production preflight | Passed with expected warning | `npm.cmd run live:check` passed. `npm.cmd run prod:preflight` passed with the existing LINE credentials warning; live LINE messaging remains disabled. |
| New status command | Passed | `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` completed and printed only key names, HTTP status, existence booleans, credential-option readiness, and redaction metadata. |
| Render Gmail OAuth status | Missing | At `2026-07-03T16:07:50.737Z`, the status command returned `ready=false`. Render returned `404` for `BOOKING_EMAIL_PRIMARY_MAILBOX`, `BOOKING_EMAIL_GMAIL_USER_ID`, `BOOKING_EMAIL_GMAIL_ACCESS_TOKEN`, `BOOKING_EMAIL_GMAIL_CLIENT_ID`, `BOOKING_EMAIL_GMAIL_CLIENT_SECRET`, `BOOKING_EMAIL_GMAIL_REFRESH_TOKEN`, and fallback `GMAIL_*` credential names. |
| Supported credential paths | Not ready | Booking-specific refresh-token tuple, booking-specific access token, fallback refresh-token tuple, and fallback access token all reported `ready=false`. |
| Local Gmail OAuth dry-run | Missing inputs | `npm.cmd run render:gmail-oauth` still reports missing required `BOOKING_EMAIL_GMAIL_CLIENT_ID`, `BOOKING_EMAIL_GMAIL_CLIENT_SECRET`, and `BOOKING_EMAIL_GMAIL_REFRESH_TOKEN`; values are omitted. |
| Booking-email proof job | Succeeded | Render one-off job `job-d93tsq5aeets73ej4pvg` ran `npm run booking-email:proof` on the current service and succeeded at `2026-07-03T16:08:39Z`. |
| Secret exposure check | Passed by construction | Status output includes `valuePrinted=false` for each key and `redaction.values=omitted`; no env-var values or Render auth tokens were printed. |

## Added Operator Command

```powershell
npm.cmd run render:gmail-oauth:status -- --use-render-cli-token
```

Use `RENDER_API_KEY` instead of `--use-render-cli-token` when the automation shell already has a Render API key. Append `--require-ready` after the npm argument separator when a CI or release gate should fail if no supported backend Gmail credential path is present.

## Current Decision

No Render mutation was performed in this slice because the required backend Gmail OAuth secret values are not available in the local process environment and are not present on Render. Booking-email capture/backfill remains blocked until the owner securely configures one supported backend Gmail credential path, redeploys, and reruns the dry-run backfill/proof jobs.
