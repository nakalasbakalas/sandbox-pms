# Sandbox PMS Finish State

**Status:** IN_PROGRESS
**Baseline SHA:** `6fea1ab8c00d2ca49d6a5ad44f2f559f31ea942a`
**Current branch:** `codex/final-core-closure`
**Current HEAD:** `5d9a72f5939397dd0dae000a4afa151a7a0d9afd`
**Last updated:** 2026-08-08 (Asia/Bangkok)

## Gates

| ID | Gate | Status | Commit/PR | Validation | Blocker or owner action |
|---|---|---|---|---|---|
| F00 | Freeze and ledger | COMPLETE | `1cfc6f8` | `git fetch origin --prune`; exact baseline confirmed | Setup kit remains untracked by design during ledger-only commit |
| F01 | Privacy response reconnaissance | COMPLETE | read-only | packet-bounded `rg` scout; exposure paths mapped | Booking-email sync response permission path needs confirmation during F02 |
| F02 | Role-specific response projections | COMPLETE | `c8c2b05` | `test:privacy-projections`; Cashier/Board projection tests; typecheck; lint; diff check | Live/provider proof not attempted |
| F03 | Audited sensitive-access endpoints | COMPLETE | `f9154c5` | sensitive-access/privacy/Cashier/property tests; typecheck; lint; diff check | Credentialed deployed-role and production audit proof remain open for F10-F11 |
| F04 | Independent privacy review | COMPLETE | `02d7419` | reviewer PASS; full Wave 1 typecheck/lint/test/e2e/build/diff gate PASS | Credentialed/live proof remains F10-F11 |
| F05 | Float-authoritative money map | COMPLETE | read-only | packet-bounded scout mapped exact paths, Float reads, reports/exports, and nullable shadows | Deployed authority and live mismatch counts remain owner/runtime proof |
| F06 | Read-only money reconciliation | COMPLETE | `5d9a72f` | `test:money-reconcile`; typecheck; lint; diff check | Real database reconciliation not run; owner/runtime proof remains open |
| F07 | Exact-satang core financial reads | IN_PROGRESS |  |  | Production authority/env switch remains owner-gated |
| F08 | Independent finance review | NOT_STARTED |  |  |  |
| F09 | Deep-health proof | NOT_STARTED |  |  |  |
| F10 | Credentialed auth/RBAC proof | NOT_STARTED |  |  | Owner-approved test accounts and target required |
| F11 | Staff workflow acceptance | NOT_STARTED |  |  | Staging or controlled-live approval required |
| F12 | Disposable recovery restore | NOT_STARTED |  |  | Owner approval and named recovery owners required |
| F13 | Current WAF proof | NOT_STARTED |  |  | Provider credentials may be required |
| F14 | Visibility and licence decision | NOT_STARTED |  |  | Owner decision required |
| F15 | Connectivity backlog and drift closure | NOT_STARTED |  |  |  |
| F16 | Stale PR comparison and closure | NOT_STARTED |  |  | Approval required if unique unsalvaged work remains |
| F17 | Canonical release documentation | NOT_STARTED |  |  |  |
| F18 | Final candidate validation | NOT_STARTED |  |  |  |
| F19 | Independent final review | NOT_STARTED |  |  |  |
| F20 | Merge, deploy, close, tag, stop | NOT_STARTED |  |  | Production and destructive external actions require approval |

## Active task

**Task:** F07
**Owner/agent:** Exact-money implementation writer
**Allowed files:** mapped core lifecycle/booking-email/financial DTO/report/export/Board/assistant money consumers and focused exact-money tests
**Focused validation:** Cashier accounting, lifecycle, report/export equality, idempotency, typecheck, lint, diff check
**Next exact action:** Make core reads and outputs satang-authoritative with base-10 API strings, preserving compatibility only at formatting boundaries; do not switch production env.

## Decisions

| Decision | Value | Owner | Date |
|---|---|---|---|
| Repository visibility | PENDING |  |  |
| Exact-money production authority | PENDING |  |  |
| UAT target | PENDING |  |  |
| Disposable recovery restore | PENDING |  |  |
| Release tag | `v1.0.0-internal` recommended |  |  |

## Deferred after core finish

- Live OTA writes
- Agoda/Trip.com applications
- Channex evaluation
- Payment-provider automation
- Accounting V2 activation
- New dashboards, autonomy, and optional architecture work
