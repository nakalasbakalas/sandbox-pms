# Sandbox PMS Finish State

**Status:** PAUSED_OWNER_ACTION
**Baseline SHA:** `6fea1ab8c00d2ca49d6a5ad44f2f559f31ea942a`
**Current branch:** `codex/final-core-closure`
**Current HEAD:** `d5631a1`
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
| F07 | Exact-satang core financial reads | COMPLETE | `bdf4f2f` | exact-money core, Cashier accounting, privacy, lifecycle, report equality, typecheck, lint, diff check PASS | Production authority/env switch remains owner-gated |
| F08 | Independent finance review | COMPLETE | `b2ab74d`, `468aae8`, `d5631a1` | independent reviewer PASS; full quality gate PASS; guarded localhost PostgreSQL workflow/release-foundation/Cashier/autonomy suites PASS | Production authority remains unchanged and owner-gated |
| F09 | Deep-health proof | COMPLETE | `b209321` | controlled generic-failure test plus refreshed 2026-08-08 `live:check` and `public-edge:proof` PASS | Public host does not expose exact deployed SHA/deploy ID; issue `#165` closure remains release-owner gated |
| F10 | Credentialed auth/RBAC proof | OWNER_ACTION_REQUIRED | `792deff`, `12d9572` | hardened helper/business tests/typecheck/lint PASS; incomplete matrix guard stopped before login as designed | Supply approved five-role credentials, target, probes, and dedicated lockout/reset approval |
| F11 | Staff workflow acceptance | OWNER_ACTION_REQUIRED | `195bc97`, `d5631a1` | guarded local disposable DB workflow/release-foundation/Cashier/autonomy suites PASS; coherent 16-step manual checklist ready | Supply approved five roles, exact deployed candidate/UAT target, testers, manual acceptance, and cleanup owner |
| F12 | Disposable recovery restore | OWNER_ACTION_REQUIRED | `195bc97` | authenticated Render inventory and current live deploy recorded; restore drill not started; no provider/database mutation attempted | Supply provider approval, recovery point/retention, owner/deputy, disposable target, and deletion owner; packet stop rule applies |
| F13 | Current WAF proof | COMPLETE | read-only | 2026-08-08 privileged Rulesets API proof plus non-destructive Cloudflare/Render probes PASS; token, expressions, bodies omitted | Setup-specific and general API-mutation Cloudflare rate limits were not established; no load/lockout probe was attempted |
| F14 | Visibility and licence decision | NOT_STARTED |  |  | Owner decision required |
| F15 | Connectivity backlog and drift closure | NOT_STARTED |  |  |  |
| F16 | Stale PR comparison and closure | NOT_STARTED |  |  | Approval required if unique unsalvaged work remains |
| F17 | Canonical release documentation | NOT_STARTED |  |  |  |
| F18 | Final candidate validation | NOT_STARTED |  |  |  |
| F19 | Independent final review | NOT_STARTED |  |  |  |
| F20 | Merge, deploy, close, tag, stop | NOT_STARTED |  |  | Production and destructive external actions require approval |

## Active task

**Task:** F12 STOP RULE
**Owner/agent:** Coordinator
**Allowed files:** ledger and the already-recorded redacted owner-action evidence only until approval arrives
**Focused validation:** none while paused; do not create production bookings, lock staff accounts, restore databases, or run provider actions
**Next exact action:** Owner supplies exact login usernames plus the missing Admin and Cashier credentials for the five-role matrix, and separately approves/names the disposable Render recovery drill inputs recorded in `DATABASE_RECOVERY_PROOF_V2.md`; then resume at F10 without committing credentials.

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
