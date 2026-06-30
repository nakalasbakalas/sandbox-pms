# Launch Scope Decisions

Status date: 2026-06-15.

This document records launch-critical scope choices that must not be inferred from UI labels, architecture docs, or unchecked provider assumptions. It contains no secrets.

## Decision Register

| Area | Launch posture | Owner | User-facing label impact | Go/no-go effect |
| --- | --- | --- | --- | --- |
| LINE messaging | Disabled/manual unless credentials, webhook URL, signature validation, and send-test proof are recorded. | Account owner TBD | UI must say server-managed, draft, manual, or disabled when live send proof is absent. | Not a launch blocker if accepted as manual/disabled; blocker if automated LINE messaging is required for launch. |
| OTA/channel automation | iCal/manual metadata only. No live OTA API adapter is proven for Booking.com, Agoda, Expedia, or Airbnb. | Operations owner TBD | Channel screens must not imply live API sync or automated booking import unless adapter evidence exists. | Not a launch blocker if accepted as manual/iCal; blocker if live OTA API automation is required. |
| Payments | PMS-recorded payments only. Card, bank transfer, PromptPay, and online payment records require references; no live gateway collection adapter is proven. | Finance/account owner TBD | Payment screens must describe recording/receipt workflows, not live gateway collection. | Not a launch blocker if offline/PMS-recorded payments are accepted; blocker if online collection is required. |
| Production users and roles | Approved real users only through hash-only seed, setup-token flow, or reviewed bootstrap. | Property owner TBD | No plaintext credentials in repo or screenshots. Role proof must use redacted evidence. | P0 blocker until approved user list and role matrix proof exist. |
| Production room inventory | Real room inventory must be imported/configured through onboarding/import, not prod-safe seed. | Operations owner TBD | Empty or incomplete room state must be labeled as setup-required, not production inventory. | P0 blocker until production inventory proof exists. |
| DB-mutating E2E | Disposable/staging database only with `ALLOW_DB_E2E=true`; never production. | Engineering owner TBD | Launch notes must say whether the DB-backed E2E proof passed or is accepted risk. | P0 blocker unless passed or explicitly accepted by launch owner. |
| Rollback and recovery | Rollback owner, deputy, DB recovery owner, latest known-good deploy ID, and current backup/restore evidence must be recorded. | Launch owner TBD | Runbooks must show assigned owners or explicitly mark them TBD. | P0 blocker for final sign-off. |
| WAF/rate limiting | App-layer login throttling exists; upstream Cloudflare/edge rule IDs and thresholds are not proven in repo. | Edge owner TBD | Do not claim upstream WAF/rate-limit is configured until rule IDs and tests are recorded. | P1/P0 depending on accepted launch risk. |

## Deferred Feature Rules

Any deferred launch feature must record:

- Owner.
- Target date or decision review date.
- User-facing label impact.
- Whether launch can proceed without it.
- Evidence required to close the deferral.

## Current Evidence Sources

- [LAUNCH_CHECKLIST.md](../LAUNCH_CHECKLIST.md)
- [docs/live-environment-proof.md](live-environment-proof.md)
- [docs/production-environment.md](production-environment.md)
- [docs/database.md](database.md)
- [docs/disaster-recovery.md](disaster-recovery.md)
