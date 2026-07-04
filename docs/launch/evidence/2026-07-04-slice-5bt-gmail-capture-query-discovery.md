# Slice 5BT - Gmail Capture Query Discovery

Status date: 2026-07-04.

Verdict: partial P0 progress. The connected Gmail mailbox contains historical OTA/provider booking traffic that can feed the PMS booking inbox after backend OAuth is configured, but the current default backfill query would not cover most of it. This slice is read-only mailbox discovery; it does not prove PMS capture, backend sync, or import.

## Scope

- Gmail connector profile: `booking@sandboxhotel.com`.
- Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`).
- Current live Render deploy: `dep-d94daaflk1mc73b1m6m0`, serving commit `e348fd6d076b2bf094dca1c77c372a2bbed612c4`.
- No Gmail message mutation, label change, attachment download, send, forward, Render env-var mutation, Render deploy, production database shell, production data mutation, confirmed import, or DB-mutating E2E was performed.
- No message IDs, exact subjects, booking references, guest names, raw email text, payment data, personal recipient addresses, tokens, cookies, passwords, or raw database URLs are recorded here.

## Evidence

| Check | Result | Notes |
| --- | --- | --- |
| Gmail profile | Correct mailbox | `_get_profile` returned `booking@sandboxhotel.com`. This is connector discovery access only; it cannot provide backend OAuth credentials to Render. |
| Known OTA/provider sender scan | Historical data exists | Read-only `_search_email_ids` pagination across known provider senders completed all pages and returned `993` messages. This proves there is historical provider mail worth parsing/backfilling after OAuth is ready. |
| Direct primary-mailbox query | Incomplete for provider traffic | `to:booking@sandboxhotel.com -in:spam -in:trash` returned `16` messages total. Adding the known provider-sender filter returned `0` messages. The default PMS/backfill mailbox query is therefore not enough for the observed provider traffic. |
| Recipient routing sample | Alias routing observed | Latest provider summaries were routed to a business Gmail alias, a hotel alias, and an owner/admin alias rather than directly to `booking@sandboxhotel.com`. Exact recipient addresses are intentionally omitted from this evidence file. |
| Message-type sample | Real booking workflow traffic exists | Latest summaries included OTA booking confirmations and Booking.com guest-message traffic. Event-type counts must come from the PMS parser dry-run, not from Gmail search terms. |
| Render Gmail OAuth status | Still not ready | Slice 5BS redacted status at `2026-07-04T09:43:42.829Z` reported mailbox identity keys present but every supported backend access-token and refresh-token credential path missing; overall `ready=false`; values were omitted. |

## Decision

The mailbox has enough historical data to load into `/booking-inbox`, but the safe path is:

1. Configure one supported backend Gmail OAuth credential path on Render.
2. Approve an explicit Gmail query that covers the observed provider senders and approved receiving aliases.
3. Run a dry-run backfill with that explicit query and record only aggregate parser counts.
4. Only after owner/staff review of the dry-run, run the confirmed review-only import and inspect `/booking-inbox`.

Do not rely on `--all-past` or the default `to:booking@sandboxhotel.com` query for the first historical import unless recipient coverage is reverified. Use an owner-approved explicit query instead:

```powershell
npm.cmd run booking-email:backfill -- --query "<owner-approved Gmail query>" --limit 250 --max-pages 5
```

After dry-run acceptance, the confirmed import should still be review-only and should not auto-approve reservations, cancellations, or payments.

## Boundary

This slice does not close:

- Backend Gmail OAuth on Render.
- PMS booking-email capture/backfill proof.
- Parser quality proof for Agoda, Booking.com, or other provider formats.
- Staff visual review in `/booking-inbox`.
- Launch sign-off.
