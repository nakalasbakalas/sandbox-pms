---
name: hotel-booking-flow-qa
description: Use when the task touches booking, reservation, availability, room selection, rates, deposits, payments, confirmation states, guest data capture, or admin-side booking reflection. Do not use for unrelated content-only or purely decorative UI changes.
---

# Hotel Booking Flow QA

## Owns
- guest booking journey integrity
- availability and rate logic review
- deposit and payment handoff validation
- booking confirmation and failure state behavior
- admin-side booking reflection and audit trail

## Does Not Own
- general UI polish unrelated to booking
- deployment config
- schema migrations
- content translation

## Trigger When
- any code touches the booking form, availability query, or rate calculation
- deposit or payment integration is modified
- confirmation emails or success pages change
- admin booking views or status displays are modified

## Read First
- `sandbox_pms_mvp/pms/app.py` booking-related routes
- `sandbox_pms_mvp/pms/services/` reservation and availability modules
- booking templates in `sandbox_pms_mvp/templates/`
- tests covering the booking and payment flows

## Avoid Reading Unless Needed
- unrelated admin dashboards
- housekeeping or reporting modules
- static assets and styles (unless layout breaks booking UX)

## Goal

Audit and protect the real guest booking journey and the related admin reflection flow.

## Primary flows to inspect

### Guest-side
- availability search
- room / rate presentation
- booking form
- required-field validation
- deposit / payment handoff
- success state
- failure state
- confirmation messaging

### Admin / operations side
- booking record creation
- booking status visibility
- payment / deposit reflection
- inventory impact
- role-appropriate access
- auditability of booking changes

## QA checklist

### Functional integrity
- data flows to the correct destination
- field validation is complete
- edge cases are handled
- duplicate submission risk is reduced
- invalid states are blocked
- user messaging is accurate

### UX integrity
- no confusing steps
- no silent failures
- no misleading confirmations
- no broken back buttons / refresh states
- clear next actions after submit / fail

### Data integrity
- no missing required fields
- consistent payload structure
- no weak assumptions around room, date, or rate logic
- no destructive side effects without controls

### Safety
- do not fake success
- do not assume live payment success without confirmation
- do not weaken validation
- do not expose sensitive admin-only details on guest surfaces

## Working method

1. Map the flow from entry to confirmation.
2. Identify all dependent states and boundaries.
3. Inspect both UI and underlying logic.
4. Patch weak states, validation gaps, and misleading UX.
5. Validate the journey end-to-end where possible.

## Output Format
- Broken or risky states found
- Weak assumptions identified
- UX leaks
- Validation gaps
- Admin reflection gaps
- Exact fixes applied

## Success Criteria
- full booking journey from search to confirmation has no silent failure states
- duplicate submission risk is addressed
- admin reflection of guest booking is accurate
- payment handoff produces correct success and failure outcomes
