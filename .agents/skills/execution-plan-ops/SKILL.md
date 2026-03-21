---
name: execution-plan-ops
description: Use when the task involves reading, updating, or tracking progress in the PMS audit execution plan, marking items complete, identifying next work, or reconciling actual codebase state against the plan. Do not use for implementing the work items themselves.
---

# Execution Plan Ops

## Owns
- reading and interpreting the audit execution plan
- marking items as complete with status notes
- identifying the next highest-priority incomplete item
- reconciling plan state against actual codebase state
- updating phase summaries and progress tables
- maintaining the plan document structure and formatting consistency

## Does Not Own
- implementing the work items described in the plan
- Blueprint extraction or ORM migration (use the dedicated skills)
- business logic, UI, or deployment changes
- writing new execution plan sections from scratch

## Trigger When
- a user asks what work remains or what to do next
- a user asks to mark an item as complete after finishing work
- a user asks for the current state of a phase or the overall plan
- a user asks to reconcile what the plan says versus what the code shows
- work has been completed and the plan needs updating

## Read First
- `docs/audit-execution-plan.md` — the full plan document

## Avoid Reading Unless Needed
- source code files (only read to verify claims, not upfront)
- templates, static assets, migrations
- test files
- service layer files

## Goal

Keep the execution plan accurate, up-to-date, and useful as the single source of truth for remaining PMS audit work.

## What to inspect

### Plan document structure (10 sections)
- **Phase 0-2 Execution Summaries** (lines 9-66) — completed phases with status tables
- **Section 1: Executive Summary** (line 69) — overall assessment
- **Section 2: What the Repo Contains** (line 97) — module inventory (Complete / Partial / Unclear / Missing)
- **Section 3: Key Findings** (line 170) — F-01 through F-10 with severity and fix status
- **Section 4: Comprehensive To-Do Backlog** (line 251) — 17 categories, ~120 items with checkbox status
- **Section 5: Recommended Phases** (line 411) — Phase 0-5 with objectives, to-dos, dependencies, criteria
- **Section 6: Critical Path** (line 584) — ordered 8-step critical path
- **Section 7: Quick Wins** (line 603) — QW-1 through QW-11
- **Section 8: Hidden Risks** (line 623) — R-01 through R-10
- **Section 9: Open Questions** (line 657) — Q-01 through Q-06
- **Section 10: Final Build Order** (line 670) — 26-step priority sequence

### Phase status tracking
- Phase 0: COMPLETE (2026-03-18)
- Phase 1: COMPLETE (2026-03-19)
- Phase 2: COMPLETE (2026-03-19), except proforma invoice (deferred to Phase 4)
- Phase 3: IN PROGRESS — 12 items completed, remaining: blueprint extraction (admin, board, front_desk), ORM migration, mobile housekeeping, keyboard shortcuts, group booking, early/late fees, guest checkout, accessibility
- Phase 4-5: Not started

### Checkbox and status conventions
- `- [x]` = completed item (often with a status note in parentheses)
- `- [ ]` = incomplete item
- `| ... | ✅ Done |` in status tables for phase summaries
- Items moved between phases are noted with "(deferred to Phase N)"
- Completed items include parenthetical notes: `*(description of what was done)*`
- Strikethrough (`~~text~~`) on original text of verified/superseded items

### Verification commands
When asked to verify a plan item, check:
- `grep -c "@.*_bp.route" sandbox_pms_mvp/pms/routes/*.py` for route counts per blueprint
- `grep -rc "\.query\." sandbox_pms_mvp/pms/ --include="*.py"` for ORM migration progress
- `wc -l sandbox_pms_mvp/pms/app.py` for monolith size tracking
- `python -m pytest sandbox_pms_mvp/tests/ -p no:cacheprovider -q --tb=no` for test baseline

## Working method

1. **Read the full plan document.** Always read `docs/audit-execution-plan.md` completely before answering questions or making updates.

2. **For "what's next" queries:** Find the current in-progress phase (Phase 3). Read its "Remaining to-dos" list. Cross-reference with the backlog in Section 4 to identify the highest-priority incomplete item. Report the item, its category, and its dependencies.

3. **For "mark complete" updates:** Update the specific item in BOTH places it appears:
   - The phase section (add to Completed items table or check the box)
   - The Section 4 backlog (check the `[x]` box and add status note)
   Add parenthetical notes describing what was done and which commit/branch.

4. **For "reconcile" queries:** Run targeted grep/wc commands to verify codebase state against plan claims. Report discrepancies. Update the plan if the code is ahead of the documented state.

5. **For phase transitions:** When all items in a phase are complete (or deferred), update the phase status header from "IN PROGRESS" to "COMPLETE" with the date. Update the next phase status to "IN PROGRESS".

6. **Maintain formatting consistency.** Match the existing markdown style: status tables use `| Item | Status | Notes |` format, checkboxes use `- [x]` / `- [ ]`, phase headers include `**Status:**` bold labels.

## Output Format
- current phase and status
- items completed since last update
- next recommended work item(s) with rationale
- discrepancies found (if reconciling)
- updated plan sections (if modifying)

## Guardrails

- do not fabricate completion status — verify against the codebase before marking items done
- do not delete or restructure plan sections — only update content within the existing structure
- do not change severity ratings or finding descriptions from the original audit
- preserve the original item text when marking complete — add status notes as parenthetical additions
- when deferring items, note the target phase and reason
- do not update the plan optimistically before work is verified

## Success Criteria
- plan accurately reflects the current state of the codebase
- completed items have clear status notes with commit/branch references
- the next recommended item is genuinely the highest-priority incomplete work
- phase transitions are recorded with dates
- no phantom completions (items marked done that are not actually done)
