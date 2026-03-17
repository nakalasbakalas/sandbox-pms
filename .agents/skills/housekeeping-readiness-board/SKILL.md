---
name: housekeeping-readiness-board
description: Use when the task touches housekeeping tasks, room status, readiness rules, departure turnover, room blocking, readiness APIs, or housekeeping/front-desk board reflection. Do not use for unrelated public-site or cashier-only work.
---

# Housekeeping Readiness Board

## Owns
- housekeeping task lifecycle integrity
- room-readiness and sellability rules
- housekeeping board and front-desk room-status reflection
- departure turnover task creation and duplicate-prevention logic
- readiness-related validation and handoff from housekeeping to front desk

## Does Not Own
- public booking flow work
- cashier and folio behavior unrelated to room readiness
- deployment or secret management
- translation-only copy cleanup

## Trigger When
- housekeeping board filters, actions, or status labels change
- room readiness or assignability logic changes
- checkout turnover, blocking, maintenance, or inspection flow changes
- front-desk needs to reflect housekeeping states differently

## Read First
- `docs/housekeeping-readiness-sync.md`
- `sandbox_pms_mvp/pms/services/housekeeping_service.py`
- `sandbox_pms_mvp/pms/services/room_readiness_service.py`
- `sandbox_pms_mvp/pms/services/front_desk_board_service.py`
- `sandbox_pms_mvp/pms/services/front_desk_service.py`
- `sandbox_pms_mvp/tests/test_housekeeping_readiness.py`
- `sandbox_pms_mvp/tests/test_phase7_housekeeping.py`
- `sandbox_pms_mvp/tests/test_phase15_front_desk_board.py`

## Avoid Reading Unless Needed
- guest-facing marketing templates
- unrelated payment integrations
- migration files older than the current housekeeping/readiness chain

## Goal

Keep room readiness truthful so both housekeeping and front desk can act on the same operational reality.

## What to inspect

### Room readiness rules
- sellable vs not sellable room states
- blocked, out-of-order, out-of-service, and maintenance states
- occupied vs vacant transitions
- clean, inspected, dirty, pickup, and cleaning-in-progress behavior

### Task workflow
- create, assign, start, complete, inspect, and cancel actions
- duplicate task prevention
- urgency and priority calculation
- staff role boundaries on housekeeping actions

### Board reflection and handoff
- housekeeping board visibility and quick actions
- front-desk room-ready indicators
- departure turnover auto-task reflection after checkout
- SSE or polling refresh assumptions where relevant

## Working method

1. Confirm the readiness rule before touching UI labels.
2. Check both housekeeping and front-desk surfaces for consistent reflection.
3. Preserve explicit task status transitions and timestamps.
4. Validate checkout-to-turnover-to-ready handoff end to end.
5. Flag any ambiguous state that could cause a bad room assignment.

## Output Format
- readiness rules reviewed
- task lifecycle risks found
- board reflection gaps found
- exact fixes applied
- follow-up checks for front-desk coordination

## Guardrails

- do not make a room look assignable when readiness rules say otherwise
- do not collapse distinct housekeeping states into vague labels
- do not remove auditability around task completion or inspection
- preserve duplicate-prevention safeguards on turnover tasks

## Success Criteria
- readiness logic remains a single source of truth
- housekeeping and front-desk surfaces agree on room state
- turnover and inspection flows stay explicit and testable
- operators can distinguish blocked, dirty, in-progress, and ready rooms clearly
