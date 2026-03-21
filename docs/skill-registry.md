# Skill Registry

This registry captures the current high-value skill set for Sandbox Hotel PMS. Each entry is grounded in existing repository modules, docs, and tests.

## Priority summary

| Priority | Skills |
| --- | --- |
| **P0** | `front-desk-cashier-ops`, `housekeeping-readiness-board`, `analytics-reporting-integrity`, `hotel-booking-flow-qa`, `security-surface-check`, `deploy-env-safety`, `sandbox-ui-polish` |
| **P1** | `guest-messaging-workflows`, `performance-seo-accessibility`, `thai-first-content-guard`, `db-schema-migration-review`, `repo-audit-cleanup`, `blueprint-route-extraction`, `execution-plan-ops`, `orm-query-modernization` |
| **P2** | None recommended right now; keep the roster lean until a repeat pattern proves otherwise. |

## `analytics-reporting-integrity`

- **Objective:** protect stable event taxonomy, consent-aware measurement, attribution, and dashboard KPI definitions.
- **Best use cases:** `public-site.js` changes, measurement spec updates, dashboard/report metric changes, analytics guardrail work.
- **Standard workflow:** read measurement spec → inspect event/KPI implementation → compare docs/tests → update implementation and tests together.
- **Expected outputs:** event/KPI inventory, gaps, exact fixes, follow-up instrumentation list.
- **Prompt compression opportunities:** removes repeated explanations of `dataLayer`, consent, attribution, and shared reporting definitions.
- **What repeated work it replaces:** generic "please audit analytics/GA4/reporting/consent/KPIs" prompt boilerplate.
- **Dependencies / related agents:** `web-conversion-guardian`, `booking-revenue-guard`.

## `db-schema-migration-review`

- **Objective:** keep schema, migration order, constraints, and rollout safety explicit.
- **Best use cases:** model column changes, new migration files, constraint updates, backfill planning.
- **Standard workflow:** inspect models and recent migration chain → classify additive vs destructive → review downstream usage → document rollout/rollback.
- **Expected outputs:** risk level, migration shape, safeguards, rollback notes.
- **Prompt compression opportunities:** packages migration-safety questions that otherwise get rewritten every time.
- **What repeated work it replaces:** one-off migration risk reviews.
- **Dependencies / related agents:** `release-safety-steward`, `booking-revenue-guard`.

## `deploy-env-safety`

- **Objective:** keep deployment config, environment variables, secrets, rollback, and release safety reviewable.
- **Best use cases:** `render.yaml` changes, rollout checklists, secret mapping, env setup, CI/release audits.
- **Standard workflow:** inspect deployment docs/config → separate repo-safe changes from external operator steps → verify smoke tests and rollback guidance.
- **Expected outputs:** ready items, blocked external actions, repo changes made, manual steps remaining, open production risks.
- **Prompt compression opportunities:** avoids re-listing deployment cautions and external-verification disclaimers.
- **What repeated work it replaces:** bespoke deployment safety prompts.
- **Dependencies / related agents:** `release-safety-steward`, `repo-systems-auditor`.

## `blueprint-route-extraction`

- **Objective:** move routes out of the monolith safely while preserving endpoint contracts, `url_for()` stability, and app registration order.
- **Best use cases:** `app.py` route extraction, blueprint registration, endpoint-name reconciliation, template `url_for()` migration.
- **Standard workflow:** map source route cluster -> extract blueprint -> register in `create_app()` -> update endpoint references -> rerun targeted route tests.
- **Expected outputs:** extracted route slice, endpoint compatibility notes, targeted validation results.
- **Prompt compression opportunities:** avoids restating the same blueprint-extraction sequencing and endpoint-drift cautions.
- **What repeated work it replaces:** ad hoc "move these routes out of app.py" prompts.
- **Dependencies / related agents:** `repo-systems-auditor`, `ops-console-orchestrator`, `web-conversion-guardian`.

## `front-desk-cashier-ops`

- **Objective:** protect front-desk, planning-board, cashier, and dense operational validation workflows.
- **Best use cases:** room moves, arrivals/departures, drag/drop board behavior, check-in/out, cashier detail, operational error clarity.
- **Standard workflow:** trace route → service → template → validate desk-side states → confirm board/cashier reflection → run focused tests.
- **Expected outputs:** state audit, validation gaps, reflection fixes, follow-up items.
- **Prompt compression opportunities:** bundles front-desk board density, cashier reflection, and desk validation rules into one reusable packet.
- **What repeated work it replaces:** long custom prompts for front-desk board plus cashier plus validation changes.
- **Dependencies / related agents:** `ops-console-orchestrator`, `booking-revenue-guard`.

## `execution-plan-ops`

- **Objective:** keep the audit execution plan accurate, verified, and useful as the repo's current work ledger.
- **Best use cases:** reconciling plan status, marking completed items, identifying the next highest-priority task, documenting verified phase progress.
- **Standard workflow:** read the plan -> verify codebase reality -> update only the confirmed items -> note discrepancies and next actions.
- **Expected outputs:** corrected phase status, completed-item notes, remaining backlog, verified next-step recommendation.
- **Prompt compression opportunities:** replaces repeated plan-tracking and reconciliation boilerplate.
- **What repeated work it replaces:** one-off "what's next / mark this done / reconcile the plan" prompts.
- **Dependencies / related agents:** `repo-systems-auditor`.

## `guest-messaging-workflows`

- **Objective:** protect the unified guest messaging hub, templates, automations, and delivery states.
- **Best use cases:** inbox/thread updates, automation rules, templates, inbound webhooks, follow-up logic.
- **Standard workflow:** inspect message/thread/automation flow → validate linkage and delivery-state handling → check retries and copy alignment.
- **Expected outputs:** thread-state audit, delivery/automation risks, exact fixes, follow-up provider/content items.
- **Prompt compression opportunities:** replaces repeated context about conversation threads, automation rules, delayed events, and delivery attempts.
- **What repeated work it replaces:** generic messaging or communications review prompts.
- **Dependencies / related agents:** `guest-communications-operator`.

## `housekeeping-readiness-board`

- **Objective:** protect room-readiness truth, housekeeping tasks, and housekeeping/front-desk reflection.
- **Best use cases:** room status changes, readiness logic, turnover tasks, housekeeping board updates, front-desk room-ready reflection.
- **Standard workflow:** verify readiness rule → trace task lifecycle → compare housekeeping and front-desk reflection → validate handoff tests.
- **Expected outputs:** readiness rule audit, task-lifecycle issues, reflection gaps, exact fixes.
- **Prompt compression opportunities:** replaces repeated explanations of readiness, turnover, inspection, and board-sync behavior.
- **What repeated work it replaces:** custom prompts for housekeeping + readiness + board sync review.
- **Dependencies / related agents:** `ops-console-orchestrator`.

## `hotel-booking-flow-qa`

- **Objective:** protect the guest booking journey and admin reflection of bookings.
- **Best use cases:** availability, rates, booking form, deposit/payment handoff, confirmation/failure states.
- **Standard workflow:** map booking flow end to end → inspect data and UX integrity → validate admin reflection and payment status.
- **Expected outputs:** broken states, weak assumptions, UX leaks, validation gaps, exact fixes.
- **Prompt compression opportunities:** prevents re-describing booking flow checkpoints every time.
- **What repeated work it replaces:** ad hoc booking QA prompts.
- **Dependencies / related agents:** `booking-revenue-guard`.

## `performance-seo-accessibility`

- **Objective:** protect semantic structure, metadata, accessibility basics, and performance after UI changes.
- **Best use cases:** template updates, mobile rendering fixes, metadata work, public-surface quality checks.
- **Standard workflow:** inspect template and shared CSS → identify highest-impact issues → validate semantics, metadata, and keyboard/mobile behavior.
- **Expected outputs:** semantic/perf/a11y gaps, exact fixes, residual risks.
- **Prompt compression opportunities:** collects front-end quality heuristics into one reusable checklist.
- **What repeated work it replaces:** generic SEO/a11y/performance prompt paragraphs.
- **Dependencies / related agents:** `web-conversion-guardian`.

## `orm-query-modernization`

- **Objective:** replace legacy Flask-SQLAlchemy `.query` patterns with modern `db.session.execute(sa.select(...))` or `db.session.get(...)` usage.
- **Best use cases:** service-layer modernization passes, query-style consistency work, incremental ORM cleanup by module.
- **Standard workflow:** read the full target file -> map each `.query` pattern -> migrate without changing semantics -> rerun the nearest test coverage.
- **Expected outputs:** migrated file, pattern-by-pattern transformation notes, remaining `.query` count, validation results.
- **Prompt compression opportunities:** avoids re-explaining result-shape, `.first()` semantics, and `select()` migration rules on each module.
- **What repeated work it replaces:** repetitive ORM modernization prompts for each service file.
- **Dependencies / related agents:** `repo-systems-auditor`, `ops-console-orchestrator`, `booking-revenue-guard`.

## `repo-audit-cleanup`

- **Objective:** identify dead code, duplicated logic, stale prompt instructions, and dependency/config clutter.
- **Best use cases:** repo cleanup passes, prompt-system refreshes, architecture simplification, docs consolidation.
- **Standard workflow:** audit first → plan cleanup with risk → implement surgical cleanup → validate and report.
- **Expected outputs:** audit summary, cleanup actions, files removed/refactored, validation results.
- **Prompt compression opportunities:** gives a stable cleanup workflow instead of repeating audit instructions.
- **What repeated work it replaces:** one-off cleanup/audit prompt scaffolding.
- **Dependencies / related agents:** `repo-systems-auditor`.

## `sandbox-ui-polish`

- **Objective:** improve visual hierarchy, compactness, CTA clarity, and mobile UX without inventing business claims.
- **Best use cases:** public-site polish, staff screen cleanup, navigation/card/form consistency, compact layout refinement.
- **Standard workflow:** inspect affected templates/CSS → prioritize highest-impact polish → keep behavior stable → validate mobile/layout results.
- **Expected outputs:** hierarchy improvements, mobile/readability fixes, consistency fixes.
- **Prompt compression opportunities:** removes repeated visual-design direction from UI requests.
- **What repeated work it replaces:** generic "make it cleaner/premium/compact" prompt text.
- **Dependencies / related agents:** `web-conversion-guardian`, `ops-console-orchestrator`.

## `security-surface-check`

- **Objective:** audit auth boundaries, validation, escaping, CSRF/session assumptions, and exposed secrets.
- **Best use cases:** auth changes, new forms, admin/booking edits, inbound webhooks, post-feature security reviews.
- **Standard workflow:** map trust boundaries → inspect input/output paths → prioritize exploitable issues → fix and report.
- **Expected outputs:** critical/medium/low findings, recommended fixes, fixes applied, follow-up items.
- **Prompt compression opportunities:** standardizes practical security review prompts across product areas.
- **What repeated work it replaces:** repetitive security checklist prose.
- **Dependencies / related agents:** `release-safety-steward`, `booking-revenue-guard`, `guest-communications-operator`.

## `thai-first-content-guard`

- **Objective:** keep Thai-first multilingual guest-facing content aligned, concise, and factually correct.
- **Best use cases:** CTA wording, guest messaging copy, public-site translation cleanup, contact details, addresses, maps links.
- **Standard workflow:** compare Thai truth source to EN/ZH variants → normalize facts and CTA wording → remove translation artifacts.
- **Expected outputs:** inconsistencies found, copy blocks cleaned, normalized details, follow-up gaps.
- **Prompt compression opportunities:** avoids re-describing multilingual alignment expectations on every content change.
- **What repeated work it replaces:** generic translation/copy review prompts.
- **Dependencies / related agents:** `web-conversion-guardian`, `guest-communications-operator`.
