# Launch Proof Matrix

Last updated: 2026-07-02

This matrix converts the remaining launch blockers into proof artifacts. It is designed for short Codex runs: choose one row group, complete evidence, update status, then stop.

Status values:

- `todo`: not started in this branch
- `in_progress`: actively being proved/fixed
- `proved`: command/manual evidence exists and is linked
- `blocked`: cannot proceed without named external input
- `deferred`: accepted for later with owner/date/impact

## Current evidence baseline

`LAUNCH_CHECKLIST.md`, `README.md`, `docs/launch-scope-decisions.md`, and `docs/live-environment-proof.md` already contain June 2026 launch-hardening evidence. The current operator report says the latest current-checkout gate is not green, so fresh July evidence must supersede older pass claims before final sign-off.

## P0 — must close before sign-off

| ID | Launch blocker | Primary owner | Required artifact | Command/manual proof | Done criteria | Status |
| --- | --- | --- | --- | --- | --- | --- |
| P0-1 | Production users and secure access path | Security engineer | `docs/launch/evidence/AUTH_RBAC_PROOF.md` | Username-first login by intended role; logout; unauthorized route/API denial; admin/manager-only actions | Real approved users can access only intended paths; bootstrap path rotated/removed | todo |
| P0-2 | Production room inventory | Backend/database engineer + hotel ops | `docs/launch/evidence/ROOM_INVENTORY_PROOF.md` | `npm run rooms:import -- --file ./ops/rooms.production.json --confirm` or approved onboarding proof; room count/type/status review | Real room set represented; setup-required state cannot be mistaken for production-ready | todo |
| P0-3 | Core hotel workflow acceptance | Hotel ops + QA/E2E | `docs/launch/evidence/HOTEL_WORKFLOW_PROOF.md` | Reservation create/update/cancel; assign/reject; overbooking reject; check-in/out; payment; housekeeping; audit/timeline | Every Hotel Workflow checklist row has evidence | todo |
| P0-4 | DB-mutating E2E posture | QA/E2E + backend/database | `docs/launch/evidence/DB_E2E_POSTURE.md` | `npm run db:e2e:ready`; `ALLOW_DB_E2E=true npm run test:e2e:db` on staging/disposable DB, or formal local-only acceptance | Mutating E2E is safe and documented; no production DB risk | todo |
| P0-5 | Secret hygiene and ownership proof | Security + SRE/DevOps | `docs/launch/evidence/SECRETS_AND_RECOVERY_PROOF.md` | Redacted secret inventory; rotation dates; repo/log/screenshot review; owner/deputy/recovery owner list; rollback test | No prod secrets exposed; rollback/recovery ownership is proved | todo |
| P0-6 | Current checkout launch gating green | Release lead + QA | `docs/launch/evidence/LAUNCH_GATE_RESULTS.md` and `docs/launch/evidence/DB_DOCTOR_RESULTS.md` | `npm run launch:check`; `npm run db:doctor`; command output redacted | Current gate passes cleanly or single precise blocker remains | todo |
| P0-7 | Live production secret and recovery evidence | SRE/DevOps | `docs/launch/evidence/SECRETS_AND_RECOVERY_PROOF.md` | Live environment redacted verification; backup/restore/rollback owner validation | Evidence is from live environment, not only docs | todo |

## P1 — before guest-facing launch or formal defer

| ID | Launch blocker | Primary owner | Required artifact | Command/manual proof | Done criteria | Status |
| --- | --- | --- | --- | --- | --- | --- |
| P1-1 | Upstream WAF/rate-limit proof | SRE/DevOps | `docs/launch/evidence/WAF_PROVIDER_POSTURE.md` | Rule IDs, thresholds, protected hostnames, non-destructive test result | WAF/rate-limit posture is proved or formally deferred | todo |
| P1-2 | Provider posture decisions | Release lead + operations | `docs/launch/evidence/WAF_PROVIDER_POSTURE.md` | Mark LINE, OTA automation, payments as `live`, `manual`, `disabled`, or `deferred`; align with `docs/launch-scope-decisions.md` | No provider has ambiguous readiness | todo |
| P1-3 | Browser cold-start instability | QA/E2E | `docs/launch/evidence/BROWSER_E2E_STABILITY.md` | Rerun `npm run test:e2e`; capture server readiness/page.goto behavior | Timeout fixed, or documented with exact root cause and defer | todo |
| P1-4 | Localization and tablet/manual ops acceptance | Localization/tablet UX reviewer | `docs/launch/evidence/LOCALIZATION_TABLET_ACCEPTANCE.md` | Thai/English labels, empty states, demo copy, front-desk flow, housekeeping tablet review | Launch paths are usable and hotel-appropriate | todo |

## P2 — post-sign-off cleanup

| ID | Cleanup item | Primary owner | Required artifact | Command/manual proof | Done criteria | Status |
| --- | --- | --- | --- | --- | --- | --- |
| P2-1 | Current-status index | Documentation owner | `docs/launch/CURRENT_STATUS_INDEX.md` | Root doc review | Stale completion docs no longer overstate readiness | in_progress |
| P2-2 | Documentation sprawl reduction | Documentation owner | `docs/launch/CURRENT_STATUS_INDEX.md` | Root completion/proof file inventory | Confidence risk is reduced or tracked | todo |
| P2-3 | Large frontend chunk review | Frontend engineer | Follow-up issue or PR | Review `index`, `ReportsView`, `SettingsView` after blockers close | Chunk risk is tracked post-launch | todo |
| P2-4 | Line-ending warnings | Release lead | `docs/launch/CURRENT_STATUS_INDEX.md` or follow-up PR | `git diff --check` | Warnings normalized or explicitly accepted | todo |

## Evidence artifact rules

Every proof artifact should include:

1. Date/time and environment.
2. Actor/owner.
3. Scope.
4. Command or manual steps.
5. Redacted output or screenshots reference.
6. Pass/fail conclusion.
7. Follow-up owner and date for failures/deferred items.
8. Explicit confirmation that no production secrets are included.

## Minimum launch gate bundle

Before any sign-off PR is marked ready, the following artifact bundle should exist and be current:

- `docs/launch/evidence/LAUNCH_GATE_RESULTS.md`
- `docs/launch/evidence/DB_DOCTOR_RESULTS.md`
- `docs/launch/evidence/AUTH_RBAC_PROOF.md`
- `docs/launch/evidence/ROOM_INVENTORY_PROOF.md`
- `docs/launch/evidence/HOTEL_WORKFLOW_PROOF.md`
- `docs/launch/evidence/DB_E2E_POSTURE.md`
- `docs/launch/evidence/SECRETS_AND_RECOVERY_PROOF.md`
- `docs/launch/evidence/WAF_PROVIDER_POSTURE.md`
- `docs/launch/evidence/BROWSER_E2E_STABILITY.md`
- `docs/launch/evidence/LOCALIZATION_TABLET_ACCEPTANCE.md`
- `docs/launch/CURRENT_STATUS_INDEX.md`
