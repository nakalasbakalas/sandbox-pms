# PII governance remediation

Status: ready-to-implement policy and test spec.

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
| Guest name/phone/email | Yes | Yes | Yes | Limited | Yes | Housekeeping should see only operationally necessary guest name/room. |
| Nationality / ID number / DOB | Yes | Yes | Yes during check-in | No | No | Mask in lists; reveal in check-in context only. |
| Raw booking email text/headers | Yes | Yes | No by default | No | No | Staff can review parsed summaries; raw text is elevated access. |
| Payment references | Yes | Yes | Limited | No | Yes | Mask except last 4/reference suffix in lists. |
| Guest documents | Yes | Yes | Yes during check-in | No | No | Access should be audited. |

## Implementation patches

1. Add API response modes:

```js
function canViewRawBookingEmail(user) {
  return canPerformAction(user, 'view:settings') || canPerformAction(user, 'view:financial-reports')
}

function maskIdNumber(value) {
  const text = String(value || '')
  if (text.length <= 4) return text ? '••••' : undefined
  return `${'•'.repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`
}
```

2. Booking email event response should default to parsed details only. Raw fields should require explicit `includeRaw=1` and elevated permission.

3. Add audit event whenever raw email/document/ID fields are opened:

```js
await createAudit(tx, user, 'VIEW_SENSITIVE_FIELD', 'BookingEmailEvent', event.id, {
  fields: ['rawText', 'rawHeaders'],
  reason: body.reason || 'operational review',
})
```

4. Add retention configuration:

```env
BOOKING_EMAIL_RAW_RETENTION_DAYS=90
GUEST_DOCUMENT_RETENTION_POLICY=owner-approved
MASK_GUEST_ID_IN_LISTS=true
```

5. Add a scheduled/raw-cleanup command after owner approval:

```bash
node scripts/redact-old-booking-email-raw.mjs --dry-run
node scripts/redact-old-booking-email-raw.mjs --confirm
```

## Required tests

- Front desk can approve parsed booking event without raw headers/text.
- Front desk cannot fetch raw booking email text.
- Manager/admin can fetch raw booking email text with explicit reason.
- Housekeeping cannot view ID number, DOB, raw booking email, or payment reference.
- Cashier can view payment method/reference suffix but not raw email or ID documents.
- Sensitive-view audit records are created.

## Operational policy

- Do not paste passport/ID numbers into GitHub issues, launch evidence, logs, screenshots, or AI prompts.
- Do not paste raw booking emails into evidence. Use redacted summaries.
- Export/delete requests require owner approval and a dated evidence record.
- Raw email retention must be timeboxed; parsed operational records may be retained longer if legally/operationally necessary.
- Staff training must include: what not to screenshot, what not to send over LINE/WhatsApp, and how to report a suspected data exposure.
