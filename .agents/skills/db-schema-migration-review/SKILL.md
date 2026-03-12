---
name: db-schema-migration-review
description: Use when the task touches schema design, migrations, column changes, indexes, constraints, data backfills, or query compatibility. Do not use for purely frontend or content-only work.
---

# DB Schema Migration Review

## Goal

Review and harden schema and migration work so it remains safe, performant, and operationally sound.

## What to inspect

- schema diffs
- migration order
- new and changed columns
- nullability and defaults
- indexes
- foreign keys
- uniqueness constraints
- backfill logic
- query compatibility
- rollback impact

## Working method

1. Read current schema and recent migration history.
2. Identify whether the change is additive, destructive, or transitional.
3. Check downstream usage before approving any rename, drop, or type change.
4. Evaluate index and constraint needs alongside the schema change.
5. Call out irreversible steps and data migration risk explicitly.

## Review checklist

### Safety
- Is the migration destructive?
- Can it break production queries?
- Can it lock large tables?
- Does it need a two-step rollout?
- Is rollback realistic?

### Data integrity
- Are constraints correct?
- Could nullability create bad states?
- Are defaults safe?
- Is backfill logic deterministic?
- Could duplicate or orphaned data appear?

### Performance
- Are indexes needed for new filters or joins?
- Could the change hurt hot paths?
- Are uniqueness checks too expensive or missing?

## Output expectations

Report:
- risk level
- migration shape
- required safeguards
- rollout notes
- rollback notes
- exact recommendations before merge

## Guardrails

- Prefer additive migrations when possible.
- Do not approve destructive changes casually.
- Do not ignore downstream query impact.
- Flag uncertainty clearly.
