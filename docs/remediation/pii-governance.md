# PII governance remediation

Status: local engineering controls implemented; live staff-role and retention proof remain open.

## Data inventory

Sensitive data surfaces include:

- Guest profile: name, email, phone, nationality, ID type/number, date of birth, VIP/blacklist flags, preferences, notes.
- Reservation: stay dates, channel reference, special requests, notes, source email linkage.
- Guest documents: file name, URL, uploader, reservation linkage.
- Booking Email Events: sender, recipient, subject, raw headers, raw text, parsed details, source message IDs, payment notices.
- Payments: amount, method, reference/fingerprint, notes, processor.

## Access policy

| Data surface | Admin | Manager | Front desk | Housekeeping | Cashier | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Guest name/phone/email | Yes | Yes | Yes | Limited name only | No | Housekeeping sees only operationally necessary guest name/room; Cashier uses the allowlisted folio projection. |
| Nationality / ID number / DOB | Yes | Yes | Yes during check-in | No | No | Mask in lists; reveal in check-in context only. |
| Raw booking email text/headers | Yes | Yes | No by default | No | No | Staff can review parsed summaries; raw text is elevated access. |
| Payment references | Yes | Yes | Limited | No | Yes | Mask except last 4/reference suffix in lists. |
| Guest documents | Yes | Yes | Yes during check-in | No | No | Access should be audited. |

## Implemented engineering controls

- Generic reservation, guest, Board, Cashier, and booking-email responses use allowlisted DTOs and do not return full identity numbers, raw email evidence, or full payment references.
- Elevated access is separate and POST-only, with a non-empty operational reason in the JSON body:
  - `POST /api/reservations/:id/identity-view`
  - `POST /api/booking-email/events/:id/raw-view`
  - `POST /api/cashier/payments/:id/reference-view`
- Dedicated permissions follow the approved role matrix: identity for Admin/Manager/Front Desk (Front Desk only for active check-in context), raw email for Admin/Manager, and full payment reference for Admin/Manager/Cashier.
- Each lookup is property-scoped and writes an audit row before returning data. Audit rows identify actor, property, entity, requested fields, and reason without storing the sensitive values.
- Raw-email output allowlists the body plus the stored message ID, date, authentication results, and reply-to headers; unrelated or credential-shaped stored header keys are not returned.

## Open policy and retention work

1. Owner approval is still required before adding retention configuration:

```env
BOOKING_EMAIL_RAW_RETENTION_DAYS=90
GUEST_DOCUMENT_RETENTION_POLICY=owner-approved
MASK_GUEST_ID_IN_LISTS=true
```

2. Add a scheduled/raw-cleanup command after owner approval:

```bash
node scripts/redact-old-booking-email-raw.mjs --dry-run
node scripts/redact-old-booking-email-raw.mjs --confirm
```

## Local engineering tests

- `node scripts/run-privacy-projection-tests.mjs` proves generic DTO redaction.
- `node scripts/run-sensitive-access-tests.mjs` proves permission denials, reason validation, property isolation, minimal success DTOs, audit evidence, and the shared authentication source guard.
- Credentialed live role checks, staff acceptance, and production audit-row inspection remain open.

## Operational policy

- Do not paste passport/ID numbers into GitHub issues, launch evidence, logs, screenshots, or AI prompts.
- Do not paste raw booking emails into evidence. Use redacted summaries.
- Export/delete requests require owner approval and a dated evidence record.
- Raw email retention must be timeboxed; parsed operational records may be retained longer if legally/operationally necessary.
- Staff training must include: what not to screenshot, what not to send over LINE/WhatsApp, and how to report a suspected data exposure.
