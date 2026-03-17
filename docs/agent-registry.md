# Agent Registry

This registry defines the lean agent roster recommended for the current Sandbox Hotel PMS repository. The goal is to keep the agent layer small while reflecting the repo's actual operational modules under `sandbox_pms_mvp/`, the current docs in `docs/`, and the validation/guardrail system in `scripts/` and `sandbox_pms_mvp/tests/`.

## P0 agents

## `repo-systems-auditor`

- **Mission:** audit repository structure, identify prompt/skill drift, remove redundant instructions, and keep the internal agent system aligned with real repo work.
- **Scope boundaries:** repo mapping, docs, prompt assets, guardrails, dead-code and duplicate-instruction cleanup.
- **Trigger conditions:** repo audit, standards update, prompt cleanup, documentation consolidation, launch-readiness audit prep.
- **Core responsibilities:** maintain registries, keep AGENTS guidance current, consolidate overlapping prompt logic, and route work to narrower domain skills.
- **Non-goals:** product feature implementation, schema design, UI redesign.
- **Required skills:** `repo-audit-cleanup`, `deploy-env-safety` when release docs are touched.
- **Suggested tools/access:** `search_code_subagent`, `view`, `rg`, `glob`, `bash`, GitHub Actions MCP for workflow context.
- **Why needed now:** the repo now includes multiple AGENTS files, eight-plus skills, launch-gate scripts, workflow automation, and expanding product modules that can drift without a dedicated systems steward.
- **Token-efficiency notes:** this agent should produce registries and migration notes once, then let narrower agents reuse them instead of rescanning the repo.

## `booking-revenue-guard`

- **Mission:** protect booking, pre-check-in, payment, deposit, and revenue-critical workflows from guest entry through financial reflection.
- **Scope boundaries:** public booking, reservation lifecycle, hosted payments, provider portal handoff, pre-check-in, payment architecture, deposit states.
- **Trigger conditions:** changes in `public_booking_service.py`, `reservation_service.py`, `payment_integration_service.py`, `pre_checkin_service.py`, booking templates, or payment docs.
- **Core responsibilities:** verify availability/rate integrity, deposit/payment reflection, confirmation/failure states, and auditability.
- **Non-goals:** front-desk planning-board behavior, housekeeping task internals, generic visual cleanup.
- **Required skills:** `hotel-booking-flow-qa`, `db-schema-migration-review` when schema changes exist, `security-surface-check` for payment/auth surfaces.
- **Suggested tools/access:** Flask tests, payment docs, targeted pytest, CodeQL, code review.
- **Why needed now:** booking, hosted payments, pre-check-in, and payment-status architecture are now first-class repo concerns with dedicated services, docs, and tests.
- **Token-efficiency notes:** keep guest-revenue logic in one agent instead of repeatedly combining generic booking, payment, and validation prompts.

## `ops-console-orchestrator`

- **Mission:** keep front-desk, planning-board, cashier, readiness, and dense staff dashboard workflows operationally correct.
- **Scope boundaries:** `/staff`, `/staff/front-desk`, `/staff/front-desk/board`, cashier detail, room moves, desk validation messaging, operational dashboard reflection.
- **Trigger conditions:** front-desk workspace updates, drag-and-drop planning board work, room-assignment changes, cashier workflow changes, compact staff console refinement.
- **Core responsibilities:** protect shift workflows, validation/error clarity, dense UI behavior tied to live states, and cross-surface consistency.
- **Non-goals:** public marketing pages, standalone SEO work, provider integrations.
- **Required skills:** `front-desk-cashier-ops`, `housekeeping-readiness-board` when readiness is involved, `sandbox-ui-polish` for visual cleanup only.
- **Suggested tools/access:** targeted pytest for front desk, cashier, dashboards, browser verification for operational UI changes.
- **Why needed now:** the repo now has a compact front-desk board, density modes, keyboard drag alternatives, cashier service, and role-aware dashboards.
- **Token-efficiency notes:** route all desk-side work here first so prompts do not restate board, cashier, and dashboard context every time.

## `web-conversion-guardian`

- **Mission:** protect multilingual public-site quality, conversion clarity, analytics instrumentation, and search/accessibility health.
- **Scope boundaries:** guest-facing templates, shared public-site JS/CSS, measurement spec, branding/copy alignment, metadata, dataLayer events.
- **Trigger conditions:** changes to public templates, CTA flow, contact surfaces, `public-site.js`, analytics docs, or multilingual public copy.
- **Core responsibilities:** keep guest-facing pages clear, mobile-ready, trackable, accessible, and multilingual-aligned.
- **Non-goals:** staff-only workflows, cashier internals, housekeeping logic.
- **Required skills:** `sandbox-ui-polish`, `performance-seo-accessibility`, `analytics-reporting-integrity`, `thai-first-content-guard`.
- **Suggested tools/access:** launch gate, targeted public-surface tests, browser verification with screenshots when UI changes.
- **Why needed now:** the repo includes a multilingual marketing/booking site, consent-aware analytics, and launch-gate checks tied to public surfaces.
- **Token-efficiency notes:** pairs four stable cross-cutting skills so public-site changes can use structured checklists instead of re-explaining launch rules.

## `release-safety-steward`

- **Mission:** keep deployments, secrets, migrations, integrations, and security-sensitive rollout steps safe and explicit.
- **Scope boundaries:** `render.yaml`, release docs, environment variables, database migrations, webhooks, rollback plans, production-readiness checks.
- **Trigger conditions:** deployment/config changes, secret/integration changes, rollback planning, migration releases, CI/launch-gate investigation.
- **Core responsibilities:** verify env separation, secret handling, migration order, rollback steps, webhook safety, and workflow health.
- **Non-goals:** feature UI polish, unrelated business-copy work.
- **Required skills:** `deploy-env-safety`, `db-schema-migration-review`, `security-surface-check`.
- **Suggested tools/access:** GitHub Actions MCP, Render/deployment docs, pre-commit, launch gate, full pytest when appropriate.
- **Why needed now:** the repo has Render deployment config, launch docs, migration chains, webhook-sensitive messaging/payment flows, and CI guardrails.
- **Token-efficiency notes:** centralize infra/release prompts here instead of scattering deployment warnings across feature agents.

## P1 agents

## `guest-communications-operator`

- **Mission:** protect the messaging hub, templates, automation rules, and reservation-linked guest communications.
- **Scope boundaries:** inbox, thread detail, message templates, delivery attempts, inbound webhooks, delayed automation, staff follow-up signals.
- **Trigger conditions:** messaging routes/services, template changes, automation-rule changes, inbound communication handling.
- **Core responsibilities:** keep delivery states explicit, preserve reservation/guest linkage, and guard automation/retry behavior.
- **Non-goals:** public marketing site work, general translation cleanup, non-communication payment flows.
- **Required skills:** `guest-messaging-workflows`, `thai-first-content-guard` when guest copy changes, `security-surface-check` for inbound/webhook work.
- **Suggested tools/access:** messaging docs, test_phase18_messaging, targeted service-level testing.
- **Why needed now:** the repo now includes a unified guest messaging hub with channel adapters, template models, automation rules, and delayed-event processing.
- **Token-efficiency notes:** avoids repeatedly restating thread, template, automation, and delivery-state rules in general booking prompts.
