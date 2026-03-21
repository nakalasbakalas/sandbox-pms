---
name: orm-query-modernization
description: Use when the task is to migrate legacy Flask-SQLAlchemy .query. patterns to modern db.session.execute(sa.select(...)) style, or to standardize ORM query patterns. Do not use for schema changes, new queries, or business logic modifications.
---

# ORM Query Modernization

## Owns
- migrating `Model.query.*` patterns to `db.session.execute(sa.select(...))` or `db.session.get()`
- ensuring correct result-set unpacking (`.scalar_one_or_none()`, `.scalars().all()`, etc.)
- adding `import sqlalchemy as sa` where missing
- preserving query semantics during migration (filters, ordering, joins, aggregations)

## Does Not Own
- new query logic or business logic changes
- schema migrations or model changes
- Blueprint extraction or route refactoring
- test query patterns (migrate separately after production code)
- performance optimization beyond the style migration

## Trigger When
- the execution plan calls for ORM query modernization work
- a module is being refactored and its `.query.` calls should be modernized in the same pass
- a task explicitly requests migration of legacy query patterns

## Read First
- the specific file(s) targeted for migration — read the full file to understand query context
- `sandbox_pms_mvp/pms/extensions.py` (confirms `db` import path)
- `sandbox_pms_mvp/pms/models.py` first 50 lines (confirms model import patterns)

## Avoid Reading Unless Needed
- templates (ORM queries never appear in templates)
- static assets
- migration files
- test files (unless migrating test queries specifically)
- `docs/audit-execution-plan.md`
- any service file not currently being migrated

## Goal

Incrementally migrate all legacy `Model.query.*` calls to the modern `db.session.execute(sa.select(...))` pattern, one file at a time, preserving exact query semantics and verifying with the test suite.

## What to inspect

### Current .query. distribution (production code, ~283 occurrences)
- `app.py`: 37
- `seeds.py`: 27
- `admin_service.py`: 23
- `housekeeping_service.py`: 23
- `auth_service.py`: 16
- `front_desk_board_service.py`: 14
- `cashier_service.py`: 13
- `ical_service.py`: 13
- `staff_reservations_service.py`: 11
- `public_booking_service.py`: 10
- `availability_service.py`: 10
- `reporting_service.py`: 9
- `messaging_service.py`: 9
- `front_desk_service.py`: 9
- `provider_portal_service.py`: 8
- `room_readiness_service.py`: 7
- `communication_service.py`: 7
- `routes/front_desk.py`: 7
- `payment_integration_service.py`: 6
- `routes/staff_reservations.py`: 6
- `reservation_service.py`: 4
- `extras_service.py`: 3
- `routes/reports.py`: 3
- Remaining files: 1-2 each

### Transformation patterns

**Simple get-by-id:**
```python
# BEFORE
obj = Model.query.get(id)
# AFTER
obj = db.session.get(Model, id)
```

**Filter + first:**
```python
# BEFORE
obj = Model.query.filter(Model.col == val).first()
obj = Model.query.filter_by(col=val).first()
# AFTER
obj = db.session.execute(sa.select(Model).where(Model.col == val)).scalar_one_or_none()
```

**Filter + all:**
```python
# BEFORE
rows = Model.query.filter(cond).all()
rows = Model.query.filter_by(k=v).all()
# AFTER
rows = db.session.execute(sa.select(Model).where(cond)).scalars().all()
```

**Order + all:**
```python
# BEFORE
rows = Model.query.order_by(Model.col.asc()).all()
# AFTER
rows = db.session.execute(sa.select(Model).order_by(Model.col.asc())).scalars().all()
```

**Count:**
```python
# BEFORE
n = Model.query.filter(cond).count()
# AFTER
n = db.session.execute(sa.select(sa.func.count()).select_from(Model).where(cond)).scalar()
```

**Join + filter:**
```python
# BEFORE
rows = Model.query.join(Other).filter(Other.col == val).all()
# AFTER
rows = db.session.execute(sa.select(Model).join(Other).where(Other.col == val)).scalars().all()
```

**Exists check (first() used as truthy):**
```python
# BEFORE
if Model.query.filter(cond).first():
# AFTER
if db.session.execute(sa.select(Model).where(cond)).scalar_one_or_none():
```

**Paginate (if used):**
```python
# BEFORE
page = Model.query.filter(cond).paginate(page=p, per_page=n)
# AFTER
stmt = sa.select(Model).where(cond)
total = db.session.execute(sa.select(sa.func.count()).select_from(stmt.subquery())).scalar()
rows = db.session.execute(stmt.offset((p-1)*n).limit(n)).scalars().all()
```

### Required imports
- `import sqlalchemy as sa` must be present at the top of the file (check if already imported)
- `from ..extensions import db` or `from .extensions import db` (already present in most files)

## Working method

1. **Pick one file.** Start with the highest-count production file that has related test coverage. Priority order: service files first (business-critical), then route files, then seeds.py, then app.py.

2. **Read the full file.** Identify every `.query.` occurrence. Note the exact pattern for each (get, filter+first, filter+all, count, join, order_by, etc.).

3. **Check imports.** Verify `import sqlalchemy as sa` exists. Add it if missing (after other stdlib imports, before Flask imports).

4. **Transform each occurrence** using the patterns above. For each transformation:
   - preserve the exact filter conditions, ordering, and joins
   - use the correct result unpacking method
   - if `first()` is used in a truthy check, use `scalar_one_or_none()` (returns None or the object)
   - if `all()` returns a list, use `.scalars().all()` (returns a list)
   - if `get()` is used, prefer `db.session.get(Model, id)` (simplest)

5. **Do NOT change logic.** The query result type and value must remain identical. If `filter_by(status="active").all()` returned a list, the replacement must also return a list.

6. **Run targeted tests.** After migrating a file, run the related test module:
   ```
   python -m pytest sandbox_pms_mvp/tests/test_<related>.py -p no:cacheprovider -q
   ```
   If no obvious test file exists, run the full suite.

7. **Report the migration count.** State how many `.query.` calls were migrated, how many remain in the file, and test results.

## Output Format
- file migrated
- occurrences before and after
- `import sqlalchemy as sa` added (yes/no)
- transformations applied (grouped by pattern type)
- test results
- remaining `.query.` count across the codebase

## Guardrails

- migrate one file at a time — do not batch multiple files without testing between them
- do not change query semantics (filters, ordering, joins, limits)
- do not refactor surrounding code during migration — only change the query pattern
- do not remove `.query.` from test files unless specifically asked (test patterns are lower priority)
- if a `.query.` pattern does not map cleanly to the transformation patterns above, flag it and skip
- verify that `scalar_one_or_none()` is used where `first()` was used (not `scalar_one()` which raises on None)
- verify that `.scalars().all()` is used where `.all()` was used (not `.scalars()` alone which returns an iterator)

## Success Criteria
- all `.query.` calls in the target file are replaced with modern `db.session.execute()` or `db.session.get()` patterns
- `import sqlalchemy as sa` is present in the file
- all related tests pass with zero regressions
- query behavior is unchanged (same results, same types)
- the file reads consistently in the modern style
