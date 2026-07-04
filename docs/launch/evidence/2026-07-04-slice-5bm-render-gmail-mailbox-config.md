# Slice 5BM - Render Gmail Mailbox Identity Config

Status date: 2026-07-04.

Verdict: partial. The Render service is now configured with the non-secret booking mailbox identifiers, and the current green `main` commit is live. This does not complete backend Gmail OAuth because no booking-specific access token or refresh-token tuple is present.

## Scope

- Target service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`).
- Public host: `https://book.sandboxhotel.com`.
- Approved mailbox identity: `booking@sandboxhotel.com`.
- No Gmail OAuth client secret, refresh token, access token, authorization code, Render token, session cookie, production database shell, production DB mutation, confirmed booking-email import, or DB-mutating E2E was used or recorded.

## Actions

| Action | Result | Notes |
| --- | --- | --- |
| Configure non-secret Render env vars | Applied | `BOOKING_EMAIL_PRIMARY_MAILBOX` and `BOOKING_EMAIL_GMAIL_USER_ID` were set on `srv-d6ns31h4tr6s73c9i8g0`; values are operational mailbox identifiers, not credentials. |
| Redacted Render Gmail OAuth status | Partial | At `2026-07-04T01:14:08.509Z`, `BOOKING_EMAIL_PRIMARY_MAILBOX` and `BOOKING_EMAIL_GMAIL_USER_ID` existed with `200`; all credential paths remained missing with `404`; `ready=false`; values and Render auth token omitted. |
| Gmail connector profile | Boundary confirmed | The connected Codex Gmail account was `Nick@intercellartrading.com`, not `booking@sandboxhotel.com`; the connector cannot supply backend OAuth refresh tokens. |
| Local OAuth inputs | Missing | No process env values were present for booking-specific or fallback Gmail OAuth client/token keys. `npm.cmd run gmail-oauth:render` failed before URL generation because no client id was present. |
| Deploy current `main` | Succeeded | Render deploy `dep-d945rdpkh4rs73ei9asg` is live for commit `c8acc1df271711d0b1c8e81419fbd76d5b6e2c4a`, finished `2026-07-04T01:13:46Z`. |
| Public-edge proof | Passed | `npm.cmd run public-edge:proof` returned `200` for `/healthz?deep=1`, database configured/OK, Cloudflare and Render origin headers, selected unwanted paths `404`, and common security-header presence. |
| Live readiness | Passed | `npm.cmd run live:check` passed; LINE remains optional/unconfigured. |
| Production preflight | Passed | `npm.cmd run prod:preflight` passed with the expected LINE-disabled warning. |
| Setup-complete reprobe | Passed | Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` returned `403` with the production-disabled setup message. |
| Booking-email proof job | Succeeded | Render job `job-d945stmq1p3s73asuam0` ran `npm run booking-email:proof` and succeeded at `2026-07-04T01:15:04Z`; Render CLI logs did not return job stdout for the checked window. |
| Historical backfill dry-run | Failed as expected while credentials are missing | Local `npm.cmd run booking-email:backfill -- --all-past --limit 250` failed with missing Gmail OAuth credentials. Render job `job-d945stsvikkc73bl8rt0` ran the same dry-run and failed at `2026-07-04T01:14:59Z`. No confirmed import was run. |
| Auth/RBAC proof helper guard | Passed as guard | `npm.cmd run auth-rbac:proof` exited before any network proof because no users file/stdin was supplied. This confirms no production credentials were used in this slice. |

## Current Backend Gmail OAuth Status

Configured on Render:

- `BOOKING_EMAIL_PRIMARY_MAILBOX`
- `BOOKING_EMAIL_GMAIL_USER_ID`

Still missing on Render:

- `BOOKING_EMAIL_GMAIL_ACCESS_TOKEN`
- `BOOKING_EMAIL_GMAIL_CLIENT_ID`
- `BOOKING_EMAIL_GMAIL_CLIENT_SECRET`
- `BOOKING_EMAIL_GMAIL_REFRESH_TOKEN`
- fallback `GMAIL_ACCESS_TOKEN`
- fallback `GMAIL_CLIENT_ID`
- fallback `GMAIL_CLIENT_SECRET`
- fallback `GMAIL_REFRESH_TOKEN`

At least one supported credential path must be present before backend Gmail scanning can work.

## Owner Close Path

From a secure owner shell with the booking mailbox OAuth client configured:

```powershell
npm.cmd run gmail-oauth:render
$authCode = Read-Host 'Paste Gmail OAuth authorization code'
$authCode | npm.cmd run gmail-oauth:render -- --exchange-code --code-stdin --apply-render --use-render-cli-token
npm.cmd run render:gmail-oauth:status -- --use-render-cli-token
npm.cmd run booking-email:backfill -- --all-past --limit 250
```

Only after a redacted dry-run shows useful scanned/candidate counts should a review-only import be considered with `--confirm`.

## Remaining Blocker

Production Booking Email capture/backfill is not working yet. The app can identify the intended mailbox on Render, but it cannot read Gmail until the booking mailbox owner completes OAuth and applies a supported backend credential path.
