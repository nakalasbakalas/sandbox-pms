# Slice 5BW - Gmail OAuth and Backfill

Status date: 2026-07-05.

Verdict: backend Gmail OAuth is configured on Render and the first provider-query backfill dry-run is proven. Historical review-only import needed a code fix because the original 1000-message confirmed import attempted too much work in one Prisma transaction.

## Scope

- Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`).
- Booking mailbox: `booking@sandboxhotel.com`.
- No mailbox password, OAuth client secret, authorization code, access token, refresh token, Render token, raw database URL, Gmail body, attachment, message id, guest data, payment data, or raw provider email was recorded.
- The provider query was bounded to common OTA/provider senders and excluded spam/trash.

## Evidence

| Check | Result | Notes |
| --- | --- | --- |
| Google OAuth client | Created | Web OAuth client configured with loopback redirect `http://127.0.0.1:53682/oauth2callback`; local client JSON stayed under ignored `.codex`. |
| Booking mailbox consent | Granted | OAuth was granted by the browser session for `booking@sandboxhotel.com` with Gmail readonly scope. |
| Render env update | Passed | `npm.cmd run gmail-oauth:render -- --credentials-file .\.codex\google-oauth-client.local.json --exchange-code --code-stdin --apply-render --use-render-cli-token` received access and refresh tokens and updated `BOOKING_EMAIL_GMAIL_CLIENT_ID`, `BOOKING_EMAIL_GMAIL_CLIENT_SECRET`, and `BOOKING_EMAIL_GMAIL_REFRESH_TOKEN`; values were omitted. |
| Render Gmail OAuth status | Ready | `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` at `2026-07-05T01:32:52.707Z` reported the booking-specific refresh-token tuple `ready=true`; values were omitted. |
| Runtime redeploy | Live | Render deploy `dep-d94r76t7vvec73e0c2v0` deployed commit `a62e9bb841c98875a7060e6b4df0c41cac0cdc56` and finished live at `2026-07-05T01:32:39.915371Z`. |
| Public deep health | Green | `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, production environment, database configured/OK, Cloudflare server header, and Render origin header after the redeploy. |
| Provider-query dry-run | Passed | Render job `job-d94r9f57vvec73e0e600` succeeded. It scanned 250 messages, found 0 existing events and 250 new candidate events, imported 0 events, and omitted all message-level and credential data. |
| Dry-run event mix | Captured | Event counts: 5 new booking, 0 modification, 227 cancellation, 2 payment notice, 7 guest message, 9 unknown. Confidence counts: 27 high, 203 medium, 20 low. Field presence counts: channel reference 230, guest name 28, stay dates 0, room type 226, amount 246, payment status 207. |
| Full confirmed import attempt | Failed safely | Render job `job-d94rat1o3t8c739dnvgg` failed before completion with Prisma transaction timeout: the original CLI imported all fetched events in one transaction. The failure did not approve, create, modify, cancel, charge, or assign reservations. |
| Backfill CLI fix | Added | `scripts/booking-email-backfill.mjs` now chunks confirmed imports using `--import-batch-size`, default `50`, while preserving dry-run behavior and review-only semantics. |

## Validation

- `node --check scripts\booking-email-backfill.mjs` passed.
- `npm.cmd test` passed.
- `npx.cmd prisma validate` passed with a disposable local Postgres-shaped `DATABASE_URL`.
- `git diff --check` passed.

## Remaining Work

- Deploy the chunked backfill CLI commit.
- Retry the confirmed review-only historical import with the same approved provider query and `--confirm`.
- Open `/booking-inbox` with an approved staff/admin role and visually review Needs Review, Errors, Processed, and Ignored tabs.
- Parser quality still needs staff review; dry-run counts show stay-date extraction was absent for the sampled provider messages.
