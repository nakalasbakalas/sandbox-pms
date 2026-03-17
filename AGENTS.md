# Sandbox Hotel PMS Repo Instructions

## Purpose

This workspace contains the Sandbox Hotel PMS application, deployment material, and Codex repo guidance.
The primary Flask application lives under `sandbox_pms_mvp/`.

Primary priorities:

1. Preserve operational truth and business accuracy.
2. Improve clarity, maintainability, and reliability without unnecessary churn.
3. Keep booking, payment, auth, and data flows safe.
4. Prefer reviewable, durable changes over clever shortcuts.

## Non-negotiable product rules

- Do not invent amenities, services, policies, integrations, rates, or operational claims.
- Preserve multilingual alignment when editing Thai, English, or Chinese content.
- Do not introduce fake production-facing data unless it is clearly marked as mock or dev-only.
- Do not weaken booking, payment, authentication, authorization, admin, or data-safety behavior for convenience.
- Do not claim deployment or external integration changes were completed unless they were actually verified.

## How to work in this repo

- Start by reading the relevant Flask entry points, services, models, templates, and tests instead of guessing.
- Prefer surgical edits over broad rewrites.
- Prefer deletion over extra abstraction when cleanup reduces complexity.
- Reuse healthy existing patterns before adding new ones.
- Keep behavior stable unless fixing a bug or implementing a requested change.
- Keep changes cohesive and easy to review in Git.

## Skills

Specialized skill files live under `.agents/skills/`. Each skill defines a focused area of expertise with its own read order, guardrails, and success criteria.

Load the relevant skill at task start when the task matches its trigger conditions:

- `analytics-reporting-integrity` — dataLayer / GA4-ready event taxonomy, conversion tracking, attribution, dashboard KPI definition integrity
- `db-schema-migration-review` — schema changes, migrations, indexes, backfills
- `deploy-env-safety` — deployments, secrets, environment config, rollback planning
- `front-desk-cashier-ops` — front desk board, check-in/out, room moves, cashier handoff, dense operational validation states
- `guest-messaging-workflows` — messaging hub, templates, automation rules, delivery tracking, guest communication workflows
- `housekeeping-readiness-board` — room status, housekeeping tasks, readiness sync, front-desk handoff
- `hotel-booking-flow-qa` — booking, availability, rates, guest journey, payments
- `performance-seo-accessibility` — page speed, SEO metadata, ARIA, Core Web Vitals
- `repo-audit-cleanup` — dead code removal, deduplication, dependency hygiene
- `sandbox-ui-polish` — visual hierarchy, layout, CTA clarity, mobile UX
- `security-surface-check` — auth boundaries, input validation, CSRF, secret exposure
- `thai-first-content-guard` — Thai-first copy correctness, multilingual alignment

Prefer the narrowest domain skill first, then add only the cross-cutting skills that are truly needed:

- default to one domain skill plus at most one or two cross-cutting skills
- prefer `front-desk-cashier-ops` over generic UI polish when the task changes board behavior, check-in/out, room moves, cashier actions, or staff validation messaging
- prefer `housekeeping-readiness-board` when the change touches room status, readiness, turnover tasks, or housekeeping/front-desk reflection
- prefer `guest-messaging-workflows` when the change touches threads, templates, automations, delivery status, or guest communication context
- prefer `analytics-reporting-integrity` when the change touches `public-site.js`, conversion events, attribution, manager dashboards, or KPI definitions
- add `sandbox-ui-polish` only for visual hierarchy and layout work, and add `performance-seo-accessibility` only when semantics, metadata, performance, or accessibility are in scope

## Change strategy

For any substantial task:

1. Inspect the real source files first.
2. Trace the affected flow end to end when touching booking, payment, auth, admin, or reporting logic.
3. Reuse existing patterns where they are healthy.
4. Simplify or consolidate weak patterns only when the result is clearly safer or easier to maintain.
5. Validate after edits.

## Validation protocol

Before running commands, detect the actual toolchain from the repo:

- inspect `sandbox_pms_mvp/requirements.txt`
- inspect `sandbox_pms_mvp/requirements-dev.txt`
- inspect `pytest.ini`
- inspect `render.yaml` and deployment runbooks when deployment behavior is relevant
- inspect `sandbox_pms_mvp/app.py` and `sandbox_pms_mvp/pms/app.py` before assuming app entry points

After non-trivial changes, run the relevant available checks:

- `pre-commit run --all-files` — runs placeholder check, public-surface check, and codex guardrail tests
- `python -m pytest sandbox_pms_mvp/tests/ -p no:cacheprovider -q` — full test suite
- `python scripts/launch_gate.py` for guest-facing launch, contact, metadata, or operational-readiness work
- `python scripts/launch_gate.py --strict-launch` before release sign-off when launch readiness is the actual question
- targeted test modules for the touched flow when that is faster or safer

If a check does not exist, say so explicitly.
If a command fails, report the failing area clearly instead of hiding it.

## File-routing guidance

When exploring the codebase, prefer this order:

1. repo-level deployment or environment docs when the task is operational
2. `sandbox_pms_mvp/pms/app.py` and related route handlers
3. relevant service modules under `sandbox_pms_mvp/pms/services`
4. models, pricing, settings, config, and security helpers under `sandbox_pms_mvp/pms`
5. matching templates and `sandbox_pms_mvp/static/styles.css`
6. tests under `sandbox_pms_mvp/tests`
7. migrations under `sandbox_pms_mvp/migrations` for schema-impacting work

## High-risk areas

Treat these as high risk:

- room availability
- rate calculation
- booking forms and holds
- deposits and hosted payments
- confirmation and notification flows
- admin dashboards and configuration
- role-based access and staff auth
- guest records and audit trails
- inventory updates
- migrations and data backfills
- environment and deployment configuration

For high-risk areas:

- inspect the end-to-end flow before editing
- preserve validation and auditability
- keep failure states explicit
- do not assume third-party credentials or live access

## UX and brand expectations

Guest-facing UI should be:

- premium but restrained
- clear before flashy
- mobile-first
- conversion-aware
- easy to scan
- accessible

Staff-facing UI should be:

- fast to parse
- accurate
- role-appropriate
- consistent in status, table, and form behavior

## Documentation feedback loop

If a recurring repo-specific rule becomes obvious during work, update the nearest relevant instructions file or propose the update so future tasks improve.
