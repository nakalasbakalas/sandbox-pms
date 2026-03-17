# Agent and Skill System Audit

This audit uses the repository itself as the source of truth. The main evidence sits in:

- `AGENTS.md`
- `sandbox_pms_mvp/AGENTS.md`
- `sandbox_pms_mvp/pms/services/AGENTS.md`
- `.agents/skills/`
- `sandbox_pms_mvp/pms/app.py`
- `sandbox_pms_mvp/pms/services/`
- `docs/housekeeping-readiness-sync.md`
- `docs/reservation-control-layer.md`
- `docs/dashboards-and-reports.md`
- `docs/measurement-spec.md`
- `docs/pre-check-in.md`
- `MESSAGING.md`
- `scripts/launch_gate.py`
- `sandbox_pms_mvp/tests/`

## 1. Repo scan summary

### Architecture overview

- The repo is centered on a Flask PMS app under `sandbox_pms_mvp/`.
- The primary entrypoint is `sandbox_pms_mvp/pms/app.py`, backed by service modules in `sandbox_pms_mvp/pms/services/`.
- The repo also includes deployment/config assets (`render.yaml`), launch/readiness docs (`docs/`), and lightweight guardrails (`scripts/check_placeholders.py`, `scripts/check_public_surface.py`, `sandbox_pms_mvp/codex_guardrails.py`).

### Key modules

- **Booking / reservation lifecycle:** `public_booking_service.py`, `reservation_service.py`, `availability_service.py`, `docs/reservation-control-layer.md`, `tests/test_phase4_public_booking.py`
- **Front desk / cashier / ops board:** `front_desk_service.py`, `front_desk_board_service.py`, `cashier_service.py`, `tests/test_phase6_front_desk_workspace.py`, `tests/test_phase8_cashier.py`, `tests/test_phase15_front_desk_board.py`
- **Housekeeping / readiness:** `housekeeping_service.py`, `room_readiness_service.py`, `docs/housekeeping-readiness-sync.md`, `tests/test_housekeeping_readiness.py`, `tests/test_phase7_housekeeping.py`
- **Messaging / communications:** `messaging_service.py`, `communication_service.py`, `MESSAGING.md`, `tests/test_phase18_messaging.py`
- **Dashboards / reporting / analytics:** `reporting_service.py`, `docs/dashboards-and-reports.md`, `docs/measurement-spec.md`, `static/public-site.js`, `tests/test_phase12_reporting.py`, `tests/test_phase19_dashboards.py`, `tests/test_codex_guardrails.py`
- **Pre-check-in / payments / providers:** `pre_checkin_service.py`, `payment_integration_service.py`, `provider_portal_service.py`, `docs/pre-check-in.md`

### Current operational focus

Recent repo work is clearly oriented around operational maturity:

- front-desk planning board density, drag/drop, and keyboard alternatives in `tests/test_phase15_front_desk_board.py`
- housekeeping task and readiness sync in `docs/housekeeping-readiness-sync.md`
- cashier/payment status reflection in `cashier_service.py` and payment docs
- compact dashboards and daily operational reports in `docs/dashboards-and-reports.md`
- unified guest messaging hub and automation rules in `MESSAGING.md` and `tests/test_phase18_messaging.py`
- consent-aware analytics and conversion taxonomy in `docs/measurement-spec.md` and `static/public-site.js`

### Recurring work patterns

- service-first domain logic with route/template reflection checks
- phase-based targeted tests for each workflow area
- launch/readiness docs used as operational guardrails
- repo instructions split across root/app/service scopes
- repeated need to combine domain prompts with cross-cutting concerns such as security, UI polish, multilingual review, and deployment safety

### Current deficiencies in agent/skill coverage

- no dedicated skill for front-desk plus cashier workflows
- no dedicated skill for housekeeping/readiness handoff
- no dedicated skill for messaging automations and delivery states
- no dedicated skill for analytics plus reporting KPI integrity
- no central registry describing which agents should compose which skills
- root AGENTS guidance listed skills but did not explain lean composition rules for token efficiency

## 2. Agent inventory

### Existing explicit or implicit agent roles detected

| Current role | Evidence | What it does now | Keep / merge / split / retire |
| --- | --- | --- | --- |
| Repo instruction layer | `AGENTS.md` | broad repo operating rules and skill list | **Keep**, but tighten routing |
| App instruction layer | `sandbox_pms_mvp/AGENTS.md` | Flask/app-specific guardrails | **Keep** |
| Service instruction layer | `sandbox_pms_mvp/pms/services/AGENTS.md` | business-rule and validation posture for services | **Keep** |
| Existing skill pack | `.agents/skills/` | eight focused reusable review packets | **Keep**, expand where the repo has outgrown coverage |
| Launch-gate / guardrail checker role | `scripts/launch_gate.py`, `sandbox_pms_mvp/codex_guardrails.py` | checks public-surface and docs readiness | **Keep**, use as validation not as a substitute for domain skills |
| GitHub workflow agents | `.github/workflows/codex-guardrails.yml`, dynamic Copilot/Claude workflows | CI execution and agent automation | **Keep**, but outside the repo-local skill registry |

### Keep / merge / split / retire conclusions

- **Keep:** the three AGENTS layers and all existing eight skills.
- **Split:** generic PMS operational work into narrower skills for front desk/cashier, housekeeping/readiness, messaging, and analytics/reporting.
- **Retire:** no skill is strongly obsolete yet; the bigger issue is missing operational coverage rather than excess skills.
- **Standardize:** agent roles should live in one registry instead of being implied across scattered docs.

## 3. Recommended agent set

See `docs/agent-registry.md` for the implementation-ready registry. The lean target model is:

| Agent | Mission | Why needed now |
| --- | --- | --- |
| `repo-systems-auditor` | maintain repo map, registries, prompt quality, and cleanup direction | agent/skill layer now spans multiple docs and needs a single steward |
| `booking-revenue-guard` | protect booking, pre-check-in, deposit, payment, and revenue-critical flows | booking/payments are mature, high-risk modules |
| `ops-console-orchestrator` | protect front-desk, planning-board, cashier, and dense ops dashboards | recent work heavily emphasized compact staff operations |
| `web-conversion-guardian` | protect multilingual public-site UX, analytics, SEO, and accessibility | public site now has consent-aware tracking and launch gates |
| `release-safety-steward` | protect deploy, env, migrations, integrations, and CI/release safety | release docs, Render config, migrations, and webhooks now matter |
| `guest-communications-operator` | protect unified messaging hub, templates, automations, and follow-up states | messaging is now a first-class product module |

## 4. Recommended skill set

See `docs/skill-registry.md` for the full registry. The high-value additions are:

- `front-desk-cashier-ops`
- `housekeeping-readiness-board`
- `guest-messaging-workflows`
- `analytics-reporting-integrity`

These are justified by real repo assets, not hypothetical systems:

- `front_desk_service.py`, `front_desk_board_service.py`, `cashier_service.py`, `tests/test_phase15_front_desk_board.py`
- `housekeeping_service.py`, `room_readiness_service.py`, `docs/housekeeping-readiness-sync.md`
- `messaging_service.py`, `communication_service.py`, `MESSAGING.md`, `tests/test_phase18_messaging.py`
- `static/public-site.js`, `docs/measurement-spec.md`, `docs/dashboards-and-reports.md`, `reporting_service.py`

## 5. Gap analysis

### Missing agents

- no explicit repo-systems steward
- no lean public-site conversion agent
- no explicit messaging-focused operator
- no lean ops-console agent for front desk + cashier + readiness composition

### Missing skills

- front-desk and cashier workflow review
- housekeeping and readiness handoff review
- messaging automation and delivery-state review
- analytics and KPI-definition integrity review

### Outdated prompts or gaps

- root AGENTS skill list did not explain how to choose the narrowest skill set first
- app-level AGENTS guidance did not route common app tasks to the most relevant domain skill
- there was no registry explaining keep/merge/add/remove decisions

### Duplicated or vague logic

- operational PMS work had to be described repeatedly in task prompts because there was no reusable skill for desk/cashier/readiness/messaging/analytics specifics
- cross-cutting skills such as UI, SEO, Thai-first content, and security were strong, but domain routing was too broad for the newer operational features

## 6. Implementation plan

### Phase 1: quick wins

- update `AGENTS.md` with new skill names and token-efficiency routing rules
- update `sandbox_pms_mvp/AGENTS.md` with app-level skill routing
- add registry docs: `docs/agent-registry.md`, `docs/skill-registry.md`, `docs/agent-skill-migration.md`
- **Risk:** low
- **Expected benefit:** immediate clarity, less prompt duplication, faster skill selection

### Phase 2: medium structural improvements

- add four missing skills under `.agents/skills/`
- keep each skill narrow, with explicit read order and guardrails
- add tests to keep AGENTS routing and registry docs in sync
- **Risk:** low to medium
- **Expected benefit:** day-to-day operational tasks use reusable domain packets instead of large custom prompts

### Phase 3: deeper specialization and optimization

- use the new registries as the source of truth for future agent additions
- add new skills only when a repeat workflow proves current coverage is insufficient
- optionally extend guardrails if agent docs become launch-critical
- **Risk:** low
- **Expected benefit:** prevents prompt-system sprawl while keeping future additions disciplined

## 7. Concrete deliverables generated

- **Agent index / registry:** `docs/agent-registry.md`
- **Skill index / registry:** `docs/skill-registry.md`
- **Agent prompt templates:** `docs/agent-skill-migration.md`
- **Skill template format:** `docs/agent-skill-migration.md`
- **Migration notes:** `docs/agent-skill-migration.md`

## 8. Priority table

| Item | Type | Priority | Reason |
| --- | --- | --- | --- |
| `front-desk-cashier-ops` | skill | P0 | recent front-desk board, validation, and cashier work needs a dedicated packet |
| `housekeeping-readiness-board` | skill | P0 | readiness and housekeeping handoff is a real, test-backed domain |
| `analytics-reporting-integrity` | skill | P0 | analytics spec, consent JS, and KPI docs now exist |
| `repo-systems-auditor` | agent | P0 | prompt/skill layer now needs a steward |
| `ops-console-orchestrator` | agent | P0 | compact front-desk operations are central to current work |
| `web-conversion-guardian` | agent | P0 | multilingual public-site plus analytics work is ongoing |
| `guest-messaging-workflows` | skill | P1 | messaging is mature and deserves a dedicated packet |
| `guest-communications-operator` | agent | P1 | useful now, but can compose from skill registry immediately |
| `booking-revenue-guard` | agent | P1 | already mostly covered by existing booking skill and docs |
| `release-safety-steward` | agent | P1 | important, but current deploy/security/migration skills already cover most needs |

## 9. Token optimization strategy

- extract stable domain instructions into skills instead of repeating them in every task prompt
- narrow agent scope so a front-desk task does not also haul in unrelated booking or marketing context
- reuse the registries instead of rescanning the repo to answer "which agent/skill should handle this?"
- standardize output formats so audits, plans, and handoffs are checklist-based and concise
- use one domain skill first, then add only required cross-cutting skills such as security, UI polish, SEO, or Thai-first content
- keep agent count lower than skill count: agents orchestrate, skills specialize

## 10. Final recommendation

### Smallest high-value agent set

- `repo-systems-auditor`
- `booking-revenue-guard`
- `ops-console-orchestrator`
- `web-conversion-guardian`
- `release-safety-steward`
- `guest-communications-operator`

### Smallest high-value skill additions

- `front-desk-cashier-ops`
- `housekeeping-readiness-board`
- `guest-messaging-workflows`
- `analytics-reporting-integrity`

### What should be removed

- no active skill should be removed right now
- avoid adding more agent roles until a repeat workflow proves a real gap

### What should be standardized

- registry docs as the source of truth
- kebab-case skill names
- one domain skill first, then cross-cutting composition
- checklist-style outputs and validation notes

## Final roster

### A. Recommended final agent roster

- `repo-systems-auditor`
- `booking-revenue-guard`
- `ops-console-orchestrator`
- `web-conversion-guardian`
- `release-safety-steward`
- `guest-communications-operator`

### B. Recommended final skill roster

- `analytics-reporting-integrity`
- `db-schema-migration-review`
- `deploy-env-safety`
- `front-desk-cashier-ops`
- `guest-messaging-workflows`
- `housekeeping-readiness-board`
- `hotel-booking-flow-qa`
- `performance-seo-accessibility`
- `repo-audit-cleanup`
- `sandbox-ui-polish`
- `security-surface-check`
- `thai-first-content-guard`

### C. Exact next 10 actions to implement

1. Start routing front-desk and cashier tasks through `front-desk-cashier-ops`.
2. Start routing housekeeping/readiness tasks through `housekeeping-readiness-board`.
3. Start routing messaging/template/automation tasks through `guest-messaging-workflows`.
4. Start routing analytics/reporting tasks through `analytics-reporting-integrity`.
5. Treat `docs/agent-registry.md` as the source of truth for new agent proposals.
6. Treat `docs/skill-registry.md` as the source of truth for new skill proposals.
7. Add cross-links from future domain docs back to the relevant skill when a pattern becomes stable.
8. Keep future prompt updates focused on routing and boundaries, not duplicating full skill content.
9. Extend tests whenever a new skill is added so AGENTS routing and docs stay in sync.
10. Only add another agent after at least two repeated task types still feel underpowered with the current roster.
