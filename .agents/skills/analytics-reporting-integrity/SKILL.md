---
name: analytics-reporting-integrity
description: Use when the task touches public-site analytics, dataLayer events, consent-aware conversion tracking, attribution fields, measurement specs, dashboards, or reporting KPI definitions. Do not use for unrelated layout-only polish or schema-only work.
---

# Analytics Reporting Integrity

## Owns
- public-site analytics taxonomy and dataLayer integrity
- consent-aware event wiring and attribution continuity
- dashboard and daily-report KPI definition consistency
- measurement-spec and launch-gate analytics alignment
- operational metric naming and drill-through sanity checks

## Does Not Own
- pure visual polish without tracking or KPI impact
- vendor credential rollout or secret storage
- unrelated backend cleanup
- schema migration design

## Trigger When
- `public-site.js`, analytics attributes, or consent UI changes
- booking attribution, CTA tracking, or conversion events change
- manager dashboard or daily report metric definitions change
- measurement docs or launch-gate analytics checks need updating

## Read First
- `docs/measurement-spec.md`
- `docs/dashboards-and-reports.md`
- `sandbox_pms_mvp/static/public-site.js`
- `sandbox_pms_mvp/pms/services/reporting_service.py`
- `sandbox_pms_mvp/tests/test_phase12_reporting.py`
- `sandbox_pms_mvp/tests/test_phase19_dashboards.py`
- `sandbox_pms_mvp/tests/test_codex_guardrails.py`

## Avoid Reading Unless Needed
- unrelated housekeeping or payment internals
- deployment files unless analytics env wiring is in scope
- marketing copy blocks unrelated to tracking

## Goal

Keep conversion tracking and operational reporting truthful, stable, and easy to extend without metric drift.

## What to inspect

### Public-site measurement
- stable event names and payload shape
- consent gating before non-essential analytics
- CTA, gallery, contact, and booking-request instrumentation
- source and campaign attribution continuity

### Reporting integrity
- metric definitions shared across dashboards and daily reports
- room, revenue, balance, and booking-source KPI consistency
- drill-through destinations and filter semantics
- operator-facing label clarity for metrics

### Documentation and launch gates
- measurement spec alignment
- guardrail coverage for analytics readiness
- missing test coverage around new metrics or events

## Working method

1. Confirm the canonical event or metric definition before editing implementation.
2. Reuse existing event names and report functions where possible.
3. Keep consent and attribution behavior explicit.
4. Add or update tests whenever a KPI definition or event taxonomy changes.
5. Pair with `performance-seo-accessibility` or `sandbox-ui-polish` only if the same task also changes presentation.

## Output Format
- events or KPIs reviewed
- taxonomy or metric-drift gaps found
- consent or attribution gaps found
- exact fixes applied
- follow-up instrumentation items

## Guardrails

- do not invent vanity metrics
- do not rename stable events casually
- do not fire non-essential analytics before consent
- do not let dashboard labels drift from the underlying definition

## Success Criteria
- event taxonomy stays stable and documented
- consent-aware analytics behavior remains intact
- dashboards and reports share the same KPI definitions
- tracking and reporting changes are backed by focused tests
