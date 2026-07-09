# Launch Proof Pack V2

Status: open proof gate. Full production launch sign-off is blocked until every required gate below is complete or explicitly timeboxed with owner-approved accepted risk.

Purpose: replace accepted-risk launch closure with current, dated, independently reviewable evidence. Do not paste secrets, passwords, cookies, raw database URLs, raw guest data, raw payment data, or raw mailbox content into this file or any linked evidence file.

Language rule: until this pack is complete, use **owner-accepted pilot** or **launch-hardening** language. Do not describe the PMS as fully launched, production-signed-off, externally verified, or ready for unattended hotel operations.

## Required evidence index

| Gate | Owner | Evidence file | Status | Acceptance standard |
| --- | --- | --- | --- | --- |
| V2 command evidence pack | Engineer / release owner | `docs/launch/evidence/COMMAND_EVIDENCE_V2.md` | Open | Clean checkout of the exact deploy candidate runs remediation check, typecheck, lint, business tests, E2E smoke, build, prod preflight, Render validation, live check, public-edge proof, high-severity audit, and Prisma migration status. |
| Credentialed auth/RBAC proof | Owner / admin | `docs/launch/evidence/AUTH_RBAC_PROOF_V2.md` | Open | Approved users can log in/out; admin, manager, front desk, housekeeping, and cashier can access only intended routes/actions; unauthorized route/API probes return 401/403. |
| Staff workflow acceptance | Front desk lead / manager | `docs/launch/evidence/STAFF_WORKFLOW_ACCEPTANCE_V2.md` | Open | Reservation create/edit/cancel, invalid dates, no-overbooking, room assignment, check-in, checkout, folio/payment, charges, housekeeping handoff, reports, and exports are manually accepted. |
| Database backup/recovery proof | Owner / Render admin | `docs/launch/evidence/DATABASE_RECOVERY_PROOF_V2.md` | Open | Fresh backup/recovery point, retention window, rollback owner, rollback deputy, DB recovery owner, latest known-good deploy ID, and disposable restore-test result are recorded. |
| Cloudflare WAF/rate-limit proof | Owner / Cloudflare admin | `docs/launch/evidence/CLOUDFLARE_WAF_PROOF_V2.md` | Open | Rule IDs, rule names, protected hostnames, thresholds, challenge/block action, and last-tested probe result are recorded from an owner-provided read token. |
| Dynamic room-type regression proof | Engineer | `docs/launch/evidence/DYNAMIC_ROOM_TYPE_PROOF_V2.md` | Open | At least one non-Twin/non-Double room type renders as its own section, can be selected for reservation, and survives API mapping. |
| Money precision decision | Owner / finance | `docs/launch/evidence/MONEY_PRECISION_DECISION_V2.md` | Open | Decimal/integer-satang migration decision is signed off before high-volume financial use, or accepted Float risk is explicitly timeboxed and blocked from live payment-gateway automation. |
| Booking Inbox parser review | Staff reviewer | `docs/launch/evidence/BOOKING_INBOX_PARSER_REVIEW_V2.md` | Open | Sample Booking.com/Agoda/Expedia/Airbnb/direct emails are reviewed without raw mailbox disclosure; create/modify/cancel/payment events are approved/rejected correctly. |
| Thai/English UX review | Thai-speaking operator / manager | `docs/launch/evidence/LOCALIZATION_UX_REVIEW_V2.md` | Open | Main operational labels, statuses, dialogs, empty states, tablet housekeeping, and launch-copy cleanup are verified. |
| PII governance proof | Owner / privacy reviewer | `docs/launch/evidence/PII_GOVERNANCE_PROOF_V2.md` | Open | Access, retention, masking, export/delete process, raw email access policy, sensitive-view audit, and staff training are documented and staff-approved. |
| Deep-health/public diagnostics hardening | Engineer | `docs/launch/evidence/DEEP_HEALTH_HARDENING_V2.md` | Open | Public deep-health diagnostics do not expose raw database, driver, network, host, SQL, or provider exception text. |
| Repository visibility and license decision | Owner / maintainer | `docs/launch/evidence/REPO_VISIBILITY_LICENSE_DECISION_V2.md` | Open | License copyright owner is correct, repository visibility is owner-approved, and public exposure of hostnames/proof docs is accepted or repo is made private. |

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
- [ ] Edit reservation succeeds for approved fields and records timeline/audit evidence.
- [ ] Cancel reservation succeeds with reason and records timeline/audit evidence.
- [ ] Invalid date ranges are rejected.
- [ ] Room assignment rejects occupied, blocked, out-of-service, and non-sellable rooms.
- [ ] Overbooking is rejected by room type and assigned room.
- [ ] Check-in requires a valid assigned room and guest identity/payment resolution or approved override.
- [ ] Check-in marks the room occupied.
- [ ] Checkout requires settlement or explicit unpaid override.
- [ ] Checkout marks the room dirty and creates housekeeping work.
- [ ] Payment creation updates folio paid/balance.
- [ ] Charge posting updates folio totals and audit/timeline evidence.
- [ ] Housekeeping can move dirty → cleaning → clean → inspected.
- [ ] Reports and exports are available only to intended roles and contain expected totals.
- [ ] Critical mutations create audit/timeline entries.

## Evidence hygiene rules

- Redact secret values completely; record only presence, source system, timestamp, and owner.
- Record deploy IDs, commit SHAs, run IDs, and command names.
- Use screenshots only when they show non-sensitive provider status or redacted configuration.
- Never include guest names, passport/ID numbers, raw emails, payment references, cookies, tokens, or database URLs.
- Every accepted deferral must have an owner, expiry date, rollback/workaround, and customer impact note.
- No evidence file may convert an owner-only blocked gate into “done” without the actual owner/provider proof or a named accepted-risk expiry.
