# Slice 5BC - Gmail OAuth Render Configuration Check

Date: 2026-07-03

## Verdict

Backend Gmail OAuth is not configured on the custom-domain Render service yet.

This slice added safe Render Blueprint placeholders for the durable Gmail refresh-token env vars, but no credential values were written because no usable backend OAuth secret material was available in the local process or repo-local env defaults.

## Target

- Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`)
- Booking mailbox: `booking@sandboxhotel.com`
- PMS helper deploy: `dep-d93sdvl7vvec73dlfdn0`

## Checks

| Check | Result | Notes |
| --- | --- | --- |
| Local process env key presence | Missing | No `BOOKING_EMAIL_GMAIL_*` or fallback `GMAIL_*` OAuth credential values were present in the shell environment. |
| Repo-local env key presence | Incomplete | `.env.local` contains `BOOKING_EMAIL_GMAIL_USER_ID`, but `BOOKING_EMAIL_GMAIL_ACCESS_TOKEN` is blank. No refresh-token tuple is present. Values were not printed. |
| Render API direct env-var lookup | Missing | The target service returned `404` for `BOOKING_EMAIL_GMAIL_USER_ID`, `BOOKING_EMAIL_GMAIL_ACCESS_TOKEN`, `BOOKING_EMAIL_GMAIL_CLIENT_ID`, `BOOKING_EMAIL_GMAIL_CLIENT_SECRET`, `BOOKING_EMAIL_GMAIL_REFRESH_TOKEN`, and fallback `GMAIL_*` credential names. Values were not printed. |
| Fresh Render proof job | Succeeded | `job-d93smuuq1p3s73a93330` ran `npm run booking-email:proof`. The CLI reported job success; job stdout was not returned by `render logs`. |
| Gmail connector profile | Blocked | The connected Gmail plugin returned `token_expired`, so it cannot currently be used to inspect mailbox state. In any case, connector OAuth is not a backend Render credential path. |

## Blueprint Sync

`render.yaml` now declares the non-secret booking mailbox and the durable Gmail OAuth refresh-token env-var names with `sync: false`:

- `BOOKING_EMAIL_PRIMARY_MAILBOX=booking@sandboxhotel.com`
- `BOOKING_EMAIL_GMAIL_USER_ID`
- `BOOKING_EMAIL_GMAIL_CLIENT_ID`
- `BOOKING_EMAIL_GMAIL_CLIENT_SECRET`
- `BOOKING_EMAIL_GMAIL_REFRESH_TOKEN`

## Required Owner Action

Add the durable backend Gmail OAuth refresh-token tuple to Render service `sandbox-hotel-pms-v43m` without pasting values into chat, docs, logs, screenshots, or commits:

- `BOOKING_EMAIL_GMAIL_CLIENT_ID`
- `BOOKING_EMAIL_GMAIL_CLIENT_SECRET`
- `BOOKING_EMAIL_GMAIL_REFRESH_TOKEN`
- Optional: `BOOKING_EMAIL_GMAIL_USER_ID=me` or the approved mailbox user id

After the secrets are added, redeploy the service, then rerun:

```powershell
render jobs create srv-d6ns31h4tr6s73c9i8g0 --start-command "npm run booking-email:backfill -- --all-past --limit 250" --output json
render jobs create srv-d6ns31h4tr6s73c9i8g0 --start-command "npm run booking-email:proof" --output json
```

Only run confirmed import after the dry-run aggregate counts are reviewed:

```powershell
render jobs create srv-d6ns31h4tr6s73c9i8g0 --start-command "npm run booking-email:backfill -- --all-past --limit 250 --confirm" --output json
```
