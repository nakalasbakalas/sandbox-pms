---
name: hotel-booking-flow-qa
description: Use when the task touches booking, reservation, availability, room selection, rates, deposits, payments, confirmation states, guest data capture, or admin-side booking reflection. Do not use for unrelated content-only or purely decorative UI changes.
---

# Hotel Booking Flow QA

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

## Output expectations

Report:
- broken or risky states
- weak assumptions
- UX leaks
- validation gaps
- admin reflection gaps
- exact fixes applied
