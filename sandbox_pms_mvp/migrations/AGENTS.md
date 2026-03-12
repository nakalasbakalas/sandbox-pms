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

## Validation

After DB changes, check:

- migration ordering
- forward application
- rollback assumptions
- query and service compatibility
- required indexes and constraints
- nullability and default behavior
- seed or bootstrap compatibility when relevant
