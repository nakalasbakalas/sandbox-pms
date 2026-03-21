---
name: blueprint-route-extraction
description: Use when the task is to extract routes from app.py into Flask Blueprints, register blueprints in create_app(), update url_for() references across Python and Jinja2, or remove migrated routes from register_routes(). Do not use for business logic changes, new feature work, or ORM query modernization.
---

# Blueprint Route Extraction

## Owns
- extracting route groups from `register_routes()` in `app.py` into dedicated Blueprint modules under `routes/`
- creating well-structured Blueprint files with correct imports
- updating `url_for()` endpoint references across Python and Jinja2 templates
- registering new Blueprints in `create_app()`
- updating `_BLUEPRINT_STAFF_OR_PROVIDER` in `helpers.py` when extracting staff-facing blueprints
- removing migrated routes from `register_routes()` in `app.py`

## Does Not Own
- business logic changes or new feature implementation
- ORM query style modernization
- template layout or visual changes
- service layer refactoring
- schema migrations

## Trigger When
- a task involves extracting routes from app.py into Blueprints
- a task involves registering a new Blueprint module
- a task involves cleaning up register_routes() after extraction
- url_for references need updating after a Blueprint extraction
- the execution plan calls for continued Blueprint extraction work

## Read First
- `sandbox_pms_mvp/pms/app.py` lines 380-405 (create_app blueprint registration block)
- `sandbox_pms_mvp/pms/app.py` the `register_routes()` function (line ~999 onward)
- `sandbox_pms_mvp/pms/helpers.py` lines 410-424 (`_BLUEPRINT_STAFF_OR_PROVIDER` and `is_staff_or_provider_endpoint`)
- the target Blueprint file if it already exists in `sandbox_pms_mvp/pms/routes/`
- one existing extracted Blueprint for reference pattern (e.g. `sandbox_pms_mvp/pms/routes/cashier.py`)

## Avoid Reading Unless Needed
- service layer files (unless tracing an import)
- test files (run them to validate, don't read upfront)
- migration files
- static assets
- `docs/audit-execution-plan.md` (consult only for scope, not for how-to)

## Goal

Mechanically extract route groups from the monolithic `register_routes()` function in `app.py` into standalone Flask Blueprint modules, preserving all existing behavior verified by the test suite.

## What to inspect

### Current extraction state
- 7 Blueprints registered: auth, provider, housekeeping, messaging, reports, cashier, staff_reservations
- `app.py` currently has ~56 `@app.route` decorators in `register_routes()`
- `front_desk.py` exists in `routes/` with 24 routes but is NOT yet registered in `create_app()`
- Remaining route groups: admin (~11 routes), public booking (~7), payments/webhooks (~3), calendar (~1), pre-checkin public (~3), dashboard (~2), utility (~6)

### Route group boundaries
- group routes by URL prefix and functional area
- dual-path routes (e.g. `/staff/admin/staff-access` and `/staff/users`) need `endpoint=` set explicitly on the Blueprint route decorator
- helper functions used exclusively by one route group should move into the Blueprint module or stay in `helpers.py` if shared

### url_for endpoint references
- templates in `sandbox_pms_mvp/templates/` reference endpoints via `url_for('function_name')`
- after Blueprint extraction, these become `url_for('blueprint_name.function_name')`
- dynamic endpoint references in admin templates use variable-based `url_for(section.endpoint)` — the endpoint strings in the Python dict must be updated
- Python files also use `url_for()` in `redirect()` calls — search both `.py` and `.html`

### Registration in create_app
- Blueprint imports and `app.register_blueprint()` calls go in `create_app()` BEFORE the `register_routes(app)` call
- no `url_prefix` is used — routes carry their full path in the decorator

## Working method

1. **Identify the target route group.** List all `@app.route` decorators in `register_routes()` that belong to the target group. Note dual-path routes and their explicit `endpoint=` names.

2. **Create the Blueprint module** at `sandbox_pms_mvp/pms/routes/{name}.py` following this exact pattern:
   ```python
   """One-line docstring describing the blueprint."""
   from __future__ import annotations

   # stdlib imports
   # flask imports: Blueprint, abort, flash, redirect, render_template, request, url_for
   # relative imports: ..helpers, ..extensions, ..models, ..services.*

   {name}_bp = Blueprint("{name}", __name__)
   ```
   Use `..helpers` (double-dot relative) imports. Import only what the routes actually use.

3. **Move routes.** Change `@app.route(path)` to `@{name}_bp.route(path)`. For dual-path routes, keep `endpoint=` explicit. Move any helper functions used ONLY by these routes into the Blueprint file (above the routes). Leave shared helpers in `helpers.py`.

4. **Register in create_app().** Add the import and `app.register_blueprint({name}_bp)` in the blueprint registration block (lines 384-403 of app.py), maintaining alphabetical grouping.

5. **Update url_for references.** Search ALL Python files and ALL Jinja2 templates for bare endpoint names and update to `{name}.endpoint_name`. Use grep to find references:
   - Python: search `sandbox_pms_mvp/pms/` for `url_for('old_name` and `url_for("old_name`
   - Templates: search `sandbox_pms_mvp/templates/` for the same patterns
   For routes with explicit `endpoint=`, the endpoint name stays the same but gains the blueprint prefix.

6. **Update `_BLUEPRINT_STAFF_OR_PROVIDER`** in `helpers.py` if the new blueprint serves staff or provider endpoints. Add the blueprint name string to the frozenset.

7. **Remove migrated routes from `register_routes()`.** Delete the `@app.route` decorated functions AND any helper functions that were moved to the Blueprint module. Do not leave dead code.

8. **Validate.** Run `python -m pytest sandbox_pms_mvp/tests/ -p no:cacheprovider -q` to confirm zero regressions. If a test fails, it is almost certainly a missed `url_for()` update.

9. **Report.** State the Blueprint path, route count moved, url_for references updated, lines removed from app.py, and test results.

## Output Format
- Blueprint module path created
- route count moved (with list of URL paths)
- url_for references updated (file:line count)
- helpers.py changes (if any)
- lines removed from app.py
- test results (pass/fail count)
- remaining routes in register_routes() after extraction

## Guardrails

- do not change business logic, validation, or response content during extraction
- do not rename route functions — only change the decorator and url_for prefix
- do not use `url_prefix` on Blueprints — routes carry their full paths
- do not leave duplicate routes in both app.py and the Blueprint (Flask will raise AssertionError)
- do not merge or split routes — move them exactly as they are
- run the full test suite after every extraction batch
- preserve explicit `endpoint=` on dual-path routes

## Success Criteria
- extracted Blueprint file follows the established pattern (docstring, `from __future__`, relative imports, no `url_prefix`)
- zero `@app.route` decorators remain in `register_routes()` for the extracted group
- all `url_for()` references in Python and templates use the correct `blueprint_name.` prefix
- full test suite passes with zero new failures
- `app.py` line count decreases by the expected amount
