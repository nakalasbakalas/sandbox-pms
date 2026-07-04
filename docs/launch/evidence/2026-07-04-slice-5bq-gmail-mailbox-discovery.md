# Slice 5BQ - Gmail Mailbox Discovery And Backend OAuth Boundary

Status date: 2026-07-04.

Verdict: partial P0 progress. The connected Gmail connector can read the booking mailbox and confirms real booking and cancellation email traffic exists. This does not prove PMS capture is working, because Render backend Gmail OAuth still reports `ready=false` and no historical backfill/import was run.

## Scope

- Gmail connector profile: `booking@sandboxhotel.com`.
- Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`).
- Current public runtime commit remains `c8acc1df271711d0b1c8e81419fbd76d5b6e2c4a`.
- No Gmail body export, attachment download, message mutation, label change, send, forward, Render env-var mutation, Render deploy, production database shell, production data mutation, confirmed import, or DB-mutating E2E was performed.
- No message IDs, subjects, guest names, raw email text, payment data, tokens, cookies, passwords, or raw database URLs are recorded here.

## Evidence

| Check | Result | Notes |
| --- | --- | --- |
| Gmail profile | Correct mailbox | `_get_profile` returned `booking@sandboxhotel.com`. The connector can be used for read-only discovery, but it cannot supply backend OAuth refresh-token credentials to the PMS. |
| Provider sender discovery | Candidate traffic exists | Read-only Gmail search across known provider senders returned the first `100` message IDs with more pages available. The latest summary page included Agoda, Trip.com, and LittleHotelier booking messages from 2026-07-03 and 2026-07-04. Details are intentionally omitted. |
| Cancellation discovery | Candidate cancellation traffic exists | Subject-focused Gmail searches for English and Thai cancellation terms returned at least `100` message IDs with more pages available. The latest summary page included LittleHotelier, Trip.com, and Ascend Travel cancellation-style messages. Details are intentionally omitted. |
| Render Gmail OAuth status | Not ready | `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` completed at `2026-07-04T09:01:27.767Z`; non-secret mailbox identity keys exist, but every supported backend booking-specific and fallback credential path remains `ready=false`. Values were omitted. |
| Booking Email proof job | Succeeded, aggregate stdout unavailable | Render job `job-d94cogtckfvc739odqig` ran `npm run booking-email:proof` and reached `succeeded` at `2026-07-04T09:03:26Z`. Render CLI logs returned no stdout for the checked window, so this job status alone does not close capture proof. |

## Decision

The mailbox has data worth importing, but the PMS still cannot perform the intended server-side Gmail sync/backfill until one supported backend credential path is configured on Render. To load past bookings and cancellations into `/booking-inbox` for visual review:

1. Configure the booking-mailbox backend OAuth refresh-token tuple on Render through `npm.cmd run gmail-oauth:render` from a secure owner shell.
2. Rerun `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` and require one credential option to report `ready=true`.
3. Run `npm.cmd run booking-email:backfill -- --all-past --limit 250` as a dry-run and review aggregate capture/parser counts.
4. Only after the dry-run is acceptable, run the confirmed review-only import path and have staff inspect `/booking-inbox`.

This slice does not close launch sign-off or booking-email capture proof.
