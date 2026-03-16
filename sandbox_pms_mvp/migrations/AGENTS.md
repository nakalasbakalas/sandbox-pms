# Database And Migration Instructions

## Scope

This file applies to Alembic migrations, schema changes, and data-integrity work under `sandbox_pms_mvp/migrations/`.

## Priorities

1. Protect data integrity.
2. Keep migrations reviewable and reversible where possible.
3. Avoid destructive assumptions.
4. Preserve performance on operational paths.

## Read first

1. SQLAlchemy models in `pms/models.py`
2. migration history in `migrations/versions/`
3. query and service usage that depends on the affected tables or columns
4. indexes, constraints, and uniqueness rules
5. seed paths or bootstrap scripts when reference data is involved

## Rules

- Do not make destructive schema changes casually.
- Prefer additive migrations when possible.
- Flag data backfills and irreversible transforms clearly.
- Consider indexes and constraints alongside schema changes.
- Think through rollback impact before proposing a migration sequence.
- Keep PostgreSQL behavior as the source of truth even if SQLite compatibility exists for local work.

## Two-phase migration pattern

Use this pattern for any NOT NULL column addition or constraint tightening on a table with existing data:

1. **Phase 1** — add the column as nullable with no constraint.
2. **Phase 2** — backfill existing rows with a safe default or computed value.
3. **Phase 3** — add the NOT NULL constraint or uniqueness constraint only after backfill is confirmed complete.

Never combine column addition, backfill, and constraint tightening in a single migration step on production-scale tables.

## Lock risk

- `ALTER TABLE` statements that rewrite rows or add non-nullable columns without defaults can briefly table-lock on PostgreSQL.
- Adding an index with `CREATE INDEX CONCURRENTLY` avoids locking but cannot run inside a transaction block.
- Renaming or dropping columns is destructive and cannot be rolled back without a restore.
- Flag any change that could lock the `reservations`, `rooms`, or `payments` tables — these are on the hot operational path.

## Service layer coordination

Before delivering a migration that renames, drops, or changes the type of a column, confirm with the service layer (`pms/services/`) and route handlers (`pms/app.py`) that the new schema is compatible. Schema and service changes should ship together or in a safe sequence.

## Validation

After DB changes, check:

- migration ordering
- forward application
- rollback assumptions
- query and service compatibility
- required indexes and constraints
- nullability and default behavior
- seed or bootstrap compatibility when relevant
