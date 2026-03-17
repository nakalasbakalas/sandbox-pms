---
name: front-desk-cashier-ops
description: Use when the task touches front-desk workspace, arrivals/departures, room assignment, drag-and-drop planning board behavior, check-in/check-out, cashier handoff, folio clarity, or high-density operational validation states. Do not use for purely public-site marketing or schema-only work.
---

# Front Desk Cashier Ops

## Owns
- front-desk workspace and planning-board workflow integrity
- arrivals, departures, walk-in, no-show, and room-move behavior
- cashier handoff, balance visibility, and payment-status clarity at the desk
- dense operational UI behavior tied to real workflow states
- validation, error messaging, and auditability around desk actions

## Does Not Own
- public-site marketing or SEO work
- housekeeping task lifecycle internals
- deployment or secrets configuration
- schema migration design

## Trigger When
- a task changes `/staff/front-desk`, `/staff/front-desk/board`, or cashier surfaces
- drag, resize, density, keyboard-move, or planning-board behavior changes
- check-in, check-out, no-show, walk-in, or room assignment logic changes
- cashier detail, payment-summary, or front-desk validation messages change

## Read First
- `sandbox_pms_mvp/pms/app.py` front-desk and cashier routes
- `sandbox_pms_mvp/pms/services/front_desk_service.py`
- `sandbox_pms_mvp/pms/services/front_desk_board_service.py`
- `sandbox_pms_mvp/pms/services/cashier_service.py`
- `sandbox_pms_mvp/pms/services/reporting_service.py` for desk dashboard reflection
- matching templates and `sandbox_pms_mvp/tests/test_phase6_front_desk_workspace.py`
- `sandbox_pms_mvp/tests/test_phase8_cashier.py`
- `sandbox_pms_mvp/tests/test_phase15_front_desk_board.py`
- `sandbox_pms_mvp/tests/test_phase19_dashboards.py`

## Avoid Reading Unless Needed
- public-site marketing templates
- provider portal or channel-manager modules
- unrelated migration history

## Goal

Keep desk-side workflows fast, dense, explicit, and operationally correct.

## What to inspect

### Core workflow states
- arrivals and departures lists
- room assignment and room moves
- check-in, check-out, no-show, and walk-in flows
- cashier balances, payment status, refunds, and charge posting visibility
- dashboard counters that summarize desk workload

### Board interaction integrity
- drag-and-drop and keyboard alternatives
- density modes and high-density readability
- inline filters, search, tabs, and overflow actions
- badge, lane, and room status consistency

### Validation and UX clarity
- failed check-in or room-move explanations
- stale state handling
- duplicate submission protection
- back-link and return-path behavior
- audit trail creation for high-impact desk actions

## Working method

1. Trace the affected workflow from route to service to template.
2. Confirm the underlying room, reservation, and folio states that drive the UI.
3. Tighten validation and operator-facing error clarity before polishing visuals.
4. Preserve compact, high-signal layouts when the screen is operationally dense.
5. Validate both happy-path and invalid-state behavior.

## Output Format
- workflow states reviewed
- validation or error-clarity gaps found
- board or cashier reflection gaps found
- exact fixes applied
- follow-up items if another domain skill is also needed

## Guardrails

- do not trade correctness for visual simplification
- do not hide important validation failures behind generic success copy
- do not break cashier, folio, or payment reflection while changing desk UX
- keep keyboard-accessible alternatives when drag interactions exist

## Success Criteria
- desk-side actions remain explicit and state-correct
- dense board and dashboard surfaces stay readable and actionable
- cashier and payment state is reflected accurately where staff acts on it
- invalid workflow states fail clearly instead of silently
