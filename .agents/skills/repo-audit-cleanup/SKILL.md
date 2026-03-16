---
name: repo-audit-cleanup
description: Use when the task is to audit, refactor, simplify, condense, de-duplicate, remove legacy code, remove dirty parts, clean architecture, or prepare the codebase before further feature work. Do not use for purely new feature implementation unless cleanup is explicitly part of the task.
---

# Repo Audit Cleanup

## Owns
- dead code identification and removal
- duplicate logic consolidation
- naming normalization
- dependency hygiene
- technical debt triage

## Does Not Own
- new feature implementation
- business logic changes
- schema migrations
- deployment config changes

## Trigger When
- codebase has accumulated clutter before a feature sprint
- duplicate logic is slowing new work
- lint, type, or build issues are caused by clutter
- a pre-release cleanup pass is requested

## Read First
- `sandbox_pms_mvp/requirements.txt` and `requirements-dev.txt`
- entry points: `sandbox_pms_mvp/pms/app.py`
- the module or directory targeted for cleanup
- related tests covering the area

## Avoid Reading Unless Needed
- unrelated service modules
- deployment runbooks
- migration history (unless dependency hygiene requires it)

## Goal

Perform a disciplined cleanup pass that makes the codebase leaner, clearer, and easier to extend without introducing unnecessary behavior changes.

## What this skill should look for

### Dead code
- unused components
- unused hooks
- unused utilities
- unreachable routes
- obsolete pages
- stale scripts
- duplicate old versions
- backup files
- unused assets
- commented-out legacy blocks

### Dirty code
- duplicate logic
- repeated UI patterns
- inconsistent naming
- redundant state
- redundant config
- stale TODO / FIXME / HACK notes
- thin wrappers with no value
- overly complex abstractions
- repeated API / validation / transformation logic

### System refinement
- places to merge overlapping systems
- opportunities to reduce boilerplate
- simpler data flow options
- better separation of concerns
- clearer file boundaries

### Dependency hygiene
- unused dependencies
- overlapping packages
- stale imports
- config drift
- lint / type / test / build issues caused by clutter

## Workflow

### 1. Audit first
Before editing, produce a concise report with:
- executive summary
- findings by category
- planned cleanup actions
- risk level for each action
- explicit guardrails

### 2. Cleanup second
Then implement the cleanup:
- delete confidently when references confirm non-use
- consolidate only when it reduces complexity
- flatten unnecessary abstractions
- normalize naming only where it improves clarity
- avoid style-only churn

### 3. Validate
Run available:
- lint
- typecheck
- tests
- build

### 4. Report
End with:
- what was cleaned
- files removed
- files substantially refactored
- systems consolidated
- risks / follow-up
- validation results

## Output Format
- Audit summary by category
- Planned cleanup actions with risk levels
- Files removed
- Files refactored
- Validation results
- Remaining follow-up items

## Guardrails

- Preserve intended behavior unless clearly fixing a bug.
- Do not introduce major new dependencies.
- Do not rewrite healthy code for cosmetic reasons alone.
- Do not leave partial migrations.
- Flag ambiguity instead of guessing.
- Prefer boring, durable code.

## Success Criteria
- codebase has fewer unused files, duplicate patterns, or stale imports
- lint, type, and test baseline passes after cleanup
- no behavior regressions introduced
- cleanup leaves a reviewable, cohesive diff
