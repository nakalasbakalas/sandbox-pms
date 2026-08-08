# PII Governance Proof V2

Status: open.

Local engineering note (2026-08-08): allowlisted generic DTOs and three separate reason-gated, property-scoped, audited sensitive-access POST paths are implemented and covered by focused service/source tests. This is not credentialed staff-role, deployed-provider, or production audit proof.

## Environment

- Commit SHA:
- Deploy ID:
- Test date/time:
- Reviewer:

## Policy decisions

| Decision | Owner answer | Notes |
| --- | --- | --- |
| Raw booking email retention days |  |  |
| Guest ID/passport masking in lists |  |  |
| Who can view raw booking email body/headers |  |  |
| Who can view guest ID documents |  |  |
| Export/delete request owner |  |  |
| Incident response owner |  |  |

## Role access checks

| Sensitive field/action | Admin | Manager | Front desk | Housekeeping | Cashier | Pass? |
| --- | --- | --- | --- | --- | --- | --- |
| Guest phone/email in operational context |  |  |  |  |  |  |
| Nationality and ID during check-in |  |  |  |  |  |  |
| Raw booking email text |  |  |  |  |  |  |
| Raw booking email headers |  |  |  |  |  |  |
| Payment reference full value |  |  |  |  |  |  |
| Guest document link/file |  |  |  |  |  |  |

The table above intentionally remains blank until credentialed role-by-role testing is performed against an approved environment.

## Local engineering-control evidence

- [x] Generic reservation/guest responses exclude full identity numbers, raw booking-email fields, and full payment references.
- [x] Identity access requires `view:sensitive-identity`, a JSON-body reason, active property scope, and a successful audit write.
- [x] Raw booking-email access requires `view:raw-booking-email`, a JSON-body reason, active property scope, and a successful audit write.
- [x] Full payment-reference access requires `view:full-payment-reference`, a JSON-body reason, active property scope, and a successful audit write.
- [x] Focused negative tests cover wrong role, missing reason, cross-property lookup, generic redaction, minimal success responses, and audit payload hygiene.
- [x] Source checks confirm the three routes are POST-only and behind the shared authentication boundary.
- [ ] Credentialed `401`/role-denial and allowed-role checks have run in an approved deployed environment.
- [ ] Production audit rows have been inspected without copying sensitive values into evidence.

## Evidence hygiene checks

- [ ] No passport/ID numbers in GitHub issues/docs/evidence.
- [ ] No raw booking email bodies in GitHub issues/docs/evidence.
- [ ] No payment references in GitHub issues/docs/evidence.
- [ ] Sensitive screenshots are redacted or omitted.
- [ ] Staff know not to send raw ID/payment/email data through LINE/WhatsApp unless owner-approved.

## Retention/export/delete process

- [ ] Raw email retention policy documented.
- [ ] Guest document retention policy documented.
- [ ] Export process documented.
- [ ] Delete/redaction process documented.
- [ ] Sensitive-view audit trail policy documented.

## Result

- [ ] Passed
- [ ] Failed
- [ ] Accepted risk with owner/date/expiry:
