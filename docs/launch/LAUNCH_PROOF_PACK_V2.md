# Launch Proof Pack V2

Status: ready-to-fill proof template.

Purpose: replace accepted-risk launch closure with current, dated, independently reviewable evidence. Do not paste secrets, passwords, cookies, raw database URLs, raw guest data, raw payment data, or raw mailbox content into this file or any linked evidence file.

## Required evidence index

| Gate | Owner | Evidence file | Status | Acceptance standard |
| --- | --- | --- | --- | --- |
| Credentialed auth/RBAC proof | Owner / admin | `docs/launch/evidence/AUTH_RBAC_PROOF_V2.md` | Open | Approved users can log in/out; admin, manager, front desk, housekeeping, and cashier can access only intended routes/actions; unauthorized route/API probes return 401/403. |
| Staff workflow acceptance | Front desk lead / manager | `docs/launch/evidence/STAFF_WORKFLOW_ACCEPTANCE_V2.md` | Open | Reservation create/edit/cancel, invalid dates, no-overbooking, room assignment, check-in, checkout, folio/payment, charges, housekeeping handoff, reports, and exports are manually accepted. |
| Database backup/recovery proof | Owner / Render admin | `docs/launch/evidence/DATABASE_RECOVERY_PROOF_V2.md` | Open | Fresh backup/recovery point, retention window, restore owner/deputy, and disposable restore-test result are recorded. |
| Cloudflare WAF/rate-limit proof | Owner / Cloudflare admin | `docs/launch/evidence/CLOUDFLARE_WAF_PROOF_V2.md` | Open | Rule IDs, rule names, protected hostnames, thresholds, challenge/block action, and last-tested probe result are recorded. |
| Dynamic room-type regression proof | Engineer | `docs/launch/evidence/DYNAMIC_ROOM_TYPE_PROOF_V2.md` | Open | At least one non-Twin/non-Double room type renders as its own section, can be selected for reservation, and survives API mapping. |
| Money precision decision | Owner / finance | `docs/launch/evidence/MONEY_PRECISION_DECISION_V2.md` | Open | Decimal/integer-satang migration decision is signed off before large financial-volume use, or accepted Float risk is explicitly timeboxed. |
| Booking Inbox parser review | Staff reviewer | `docs/launch/evidence/BOOKING_INBOX_PARSER_REVIEW_V2.md` | Open | Sample Booking.com/Agoda/Expedia/Airbnb/direct emails are reviewed without raw mailbox disclosure; create/modify/cancel/payment events are approved/rejected correctly. |
| Thai/English UX review | Thai-speaking operator / manager | `docs/launch/evidence/LOCALIZATION_UX_REVIEW_V2.md` | Open | Main operational labels, statuses, dialogs, empty states, tablet housekeeping, and launch-copy cleanup are verified. |
| PII governance proof | Owner / privacy reviewer | `docs/launch/evidence/PII_GOVERNANCE_PROOF_V2.md` | Open | Access, retention, masking, export/delete process, and raw email access policy are documented and staff-approved. |

## Command evidence to refresh

Run from a clean checkout on the candidate commit:

```bash
npm run remediation:check
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run prod:preflight
npm run render:validate
npm run live:check
npm run public-edge:proof
npm audit --audit-level=high
npx prisma migrate status
```

Guarded DB checks remain forbidden against production:

```bash
ALLOW_DB_E2E=true E2E_DATABASE_URL="postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public" npm run db:e2e:ready
ALLOW_DB_E2E=true E2E_DATABASE_URL="postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public" npm run test:e2e:db
```

## Auth/RBAC proof checklist

- [ ] User list is approved and contains no plaintext committed credentials.
- [ ] Admin login works.
- [ ] Manager login works.
- [ ] Front desk login works.
- [ ] Housekeeping login works.
- [ ] Cashier login works.
- [ ] Logout clears the session cookie.
- [ ] Unknown route displays access/not-found behavior without data leakage.
- [ ] Unauthorized route probes are denied.
- [ ] Unauthorized API mutation probes are denied with non-mutating or deliberately invalid payloads only.
- [ ] Login throttle/lockout behavior is tested with safe test accounts.

## Manual workflow proof checklist

- [ ] Create reservation succeeds with valid dates.
- [ ] Invalid date ranges are rejected.
- [ ] Room assignment rejects occupied, blocked, out-of-service, and non-sellable rooms.
- [ ] Overbooking is rejected by room type and assigned room.
- [ ] Check-in requires a valid assigned room and guest identity/payment resolution or approved override.
- [ ] Check-in marks the room occupied.
- [ ] Checkout requires settlement or explicit unpaid override.
- [ ] Checkout marks the room dirty and creates housekeeping work.
- [ ] Payment creation updates folio paid/balance.
- [ ] Housekeeping can move dirty → cleaning → clean → inspected.
- [ ] Critical mutations create audit/timeline entries.

## Evidence hygiene rules

- Redact secret values completely; record only presence, source system, timestamp, and owner.
- Record deploy IDs, commit SHAs, run IDs, and command names.
- Use screenshots only when they show non-sensitive provider status or redacted configuration.
- Never include guest names, passport/ID numbers, raw emails, payment references, cookies, tokens, or database URLs.
- Every accepted deferral must have an owner, expiry date, rollback/workaround, and customer impact note.
