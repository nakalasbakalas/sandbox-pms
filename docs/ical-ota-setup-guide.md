# iCal OTA Recovery-Only Compatibility Guide

iCal is a delayed date-block compatibility tool. It is not the primary Lite booking, cancellation, inventory, or rate synchronization path and must not be presented as live, automatic, two-way, or overbooking-proof.

## Approved Use

Use iCal only as an owner-approved recovery aid when the normal reviewed Gmail intake, direct provider connection, channel rail, or manual Channel Desk workflow is unavailable.

iCal may help staff compare blocked stay dates. It does not reliably carry:

- booking lifecycle state or timely cancellations;
- room-type inventory counts for a multi-room hotel;
- rates, restrictions, taxes, deposits, or payments;
- complete guest, reference, message, or modification details; or
- proof that an OTA accepted an availability change.

Provider polling intervals are outside PMS control. A stale calendar can leave rooms oversold or unnecessarily blocked. Staff must verify every recovery action in the authoritative OTA Extranet and PMS.

## Safer Lite Operating Order

1. Use authenticated Gmail API watch/history intake for near-live inbound booking and cancellation evidence.
2. Keep every email-derived event in staff review until an authorized user approves it.
3. Use Channel Desk absolute-availability tasks for manual outbound Booking.com, Agoda, and Trip.com updates.
4. Pursue approved Agoda/Trip.com direct APIs or a channel-only rail when true two-way automation is required.
5. Use iCal only during a documented recovery incident and remove or disable it when the primary path is restored.

## Recovery Setup

Production/server mode requires a deployed HTTPS PMS, server auth, a database, an authorized Manager/Admin, and verified room mappings. A private export URL has this general form:

```text
https://your-pms-domain.example/ical/<private-token>.ics
```

Treat the URL as a secret. Do not put it in tracked files, screenshots, chat, or public logs.

During an approved recovery incident:

1. Record the incident owner, affected provider/listing, start time, and reason.
2. Configure exactly one path per OTA listing; never connect both directly and through another hub.
3. Map the provider listing to the exact PMS room scope.
4. Import the provider feed or paste a downloaded `.ics` payload if browser fetch is unavailable.
5. Review every pending date block before creating or changing a PMS reservation.
6. Verify guest, provider reference, lifecycle state, dates, room type, money, and cancellation state in the OTA Extranet.
7. If an export feed is used, verify the provider actually consumed it; publishing a URL is not delivery proof.
8. Reconcile the PMS and all affected Extranets before ending the incident.

Never infer a cancellation from a missing calendar event. Never let an iCal event directly mutate a reservation, payment, or room assignment without staff review.

## Recovery Controls

- `Publish URL` exposes a private date-block feed in server mode only.
- `Export .ics` creates a file for a one-time owner-controlled recovery transfer.
- `Rotate` replaces an exposed private token; remove the previous URL from every consumer.
- `Disconnect` disables the compatibility connection after the incident.

If availability differs, the OTA Extranet and reviewed PMS reservation evidence must be reconciled manually. If rates differ, correct them in the provider or certified channel path; iCal cannot repair rates.

## Required Evidence

Record only redacted operational evidence:

- incident owner and timestamps;
- provider/listing scope;
- number of reviewed, accepted, rejected, and unresolved blocks;
- final PMS-versus-Extranet reconciliation result; and
- token rotation/disconnection result.

An iCal recovery run does not satisfy the Lite Gmail, direct API, channel rail, staging, or cutover acceptance gates.
