# Slice 5BB - Booking Email Capture Proof

Date: 2026-07-03.

Status: partial. Booking Email proof tooling is implemented, validated, pushed, deployed, and run against production. The current production result shows the booking mailbox source exists, but Gmail OAuth credentials are missing and no booking email events have been captured into the PMS database yet.

## Scope

- Add a bounded historical booking-email backfill helper for Gmail scan dry-runs and review-only event imports.
- Add a read-only booking-email capture proof helper for current PMS database state.
- Deploy the helpers to the existing Render service.
- Run redacted production proof without printing message ids, senders, recipients, subjects, raw bodies, guest data, payment data, or credential values.

No production reservation, payment, cancellation, room, user, setup, WAF, or secret mutation was performed. The failed Gmail dry-run did not scan mailbox contents because provider credentials were missing.

## Code And Deploy

| Item | Result |
| --- | --- |
| Backfill helper commit | `e1f3f1cc82ac7cfc5097ec95363b75802851a6a6` (`Add booking email backfill helper`) |
| Dry-run safety fix commit | `20d92e76bc745d6a91d70b80788c5539f822c433` (`Keep booking email backfill dry run non-mutating`) |
| Capture proof helper commit | `2866b8b0aefd50520d0b1c4f4eeffd441dbecd07` (`Add booking email capture proof helper`) |
| Final GitHub CI | Run `28666446514`, job `85019246267`, passed `Install, test, build, and launch-check` |
| Final Render deploy | `dep-d93sdvl7vvec73dlfdn0`, live on commit `2866b8b0aefd50520d0b1c4f4eeffd441dbecd07` |
| Public live check after final deploy | `npm.cmd run live:check`, passed for `https://book.sandboxhotel.com` |

GitHub CI retained the existing Node.js 20 deprecation annotation for `actions/checkout@v4` and `actions/setup-node@v4` being forced to Node.js 24.

## Production Jobs

| Command | Job | Result |
| --- | --- | --- |
| `npm run booking-email:backfill -- --all-past --limit 250` | `job-d93s947lk1mc739udskg` | Failed before scanning Gmail: `Gmail API OAuth credentials are not configured for booking email sync.` |
| `npm run booking-email:proof` | `job-d93sfb57vvec73dliai0` | Succeeded with aggregate-only production capture proof. |

## Redacted Production Capture Result

Observed at `2026-07-03T14:31:33.954Z` from Render job `job-d93sfb57vvec73dliai0`.

| Field | Observed |
| --- | --- |
| Database host | `dpg-d6ns2d94tr6s73c9hve0-a` |
| Database | `sandbox_hotel_pms` |
| Schema | `pms_v2` |
| Gmail credential configured | `false` |
| Gmail credential mode | `missing` |
| Source provider | `GMAIL` |
| Source mailbox | `booking@sandboxhotel.com` |
| Source enabled | `true` |
| Auto-process safe events | `false` |
| Review threshold | `0.85` |
| Last sync | `null` |
| Last error | `Gmail API credentials are not configured for this server.` |
| Total Booking Email Events | `0` |
| Source-message events | `0` |
| Linked events | `0` |
| Needs review | `0` |
| Processed | `0` |
| Errors | `0` |
| Ignored | `0` |
| Event type counts | all `0` for `NEW_BOOKING`, `MODIFICATION`, `CANCELLATION`, `PAYMENT_NOTICE`, `GUEST_MESSAGE`, and `UNKNOWN` |

## Verdict

Capture has not worked yet on the production PMS: there are zero booking-email events in the production database, and the Gmail provider credential mode is `missing`.

It is possible to load historical mailbox bookings into the app after backend Gmail OAuth is configured. The safe path is:

1. Configure backend Gmail OAuth credentials on Render: either `BOOKING_EMAIL_GMAIL_ACCESS_TOKEN` / `GMAIL_ACCESS_TOKEN`, or the refresh-token tuple `BOOKING_EMAIL_GMAIL_CLIENT_ID`, `BOOKING_EMAIL_GMAIL_CLIENT_SECRET`, and `BOOKING_EMAIL_GMAIL_REFRESH_TOKEN`.
2. Rerun `npm run booking-email:backfill -- --all-past --limit 250` as a dry-run and review aggregate counts.
3. If the dry-run looks correct, rerun with `--confirm` to import review-only Booking Email Events.
4. Open `/booking-inbox` and visually review the events before approving/linking/creating reservations, payments, or cancellations.

## Remaining Gap

Production Gmail OAuth credentials are required before any mailbox scan or historical capture can occur. Raw mailbox passwords and the Codex Gmail connector are not production app credential paths.
