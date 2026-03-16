# Flask App Instructions

## Scope

This file applies to the Flask PMS application under `sandbox_pms_mvp/`, including route handlers, templates, and static assets.

## Priorities

1. Preserve business truth across public and staff flows.
2. Keep guest experiences clear and conversion-aware.
3. Keep staff and admin workflows fast, accurate, and predictable.
4. Minimize regressions when touching shared templates or CSS.

## Read in this order

1. `pms/app.py` or the relevant app entry point
2. the service module backing the route or form
3. matching templates in `templates/`
4. shared styling in `static/styles.css`
5. supporting models, config, security, pricing, branding, and i18n helpers
6. the nearest tests covering the touched flow

## Public experience rules

- Do not invent guest-facing claims, pricing, policies, or availability behavior.
- Keep booking CTAs obvious and key information easy to scan.
- Favor concise copy over marketing bloat.
- Preserve multilingual alignment when editing content.
- Check mobile behavior after layout or copy changes.

## Staff and admin experience rules

- Prioritize readability and speed of action over decoration.
- Keep tables, statuses, filters, and forms consistent.
- Surface destructive or high-impact actions clearly.
- Avoid silent failure states.
- Preserve auditability and role-appropriate behavior.

## Change rules

- Keep route context, template expectations, and form handling aligned.
- When touching shared CSS, check both public pages and staff/admin screens for unintended bleed.
- Do not weaken auth, booking, payment, or admin safeguards to simplify the UI.
- Prefer small template changes over broad redesigns unless the task explicitly calls for it.
- Preserve accessible semantics and obvious validation messaging.

## Validation

After non-trivial app changes:

- `pre-commit run --all-files` — runs placeholder check, public-surface check, and codex guardrail tests
- `python -m pytest sandbox_pms_mvp/tests/ -p no:cacheprovider -q` — full suite, or run a targeted module for speed
- `python scripts/launch_gate.py` when changing guest-facing routes, templates, or metadata
- check the affected route/template pairing for missing context or broken conditionals
- call out any manual browser verification you could not perform
