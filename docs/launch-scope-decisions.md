# Launch Scope Decisions

Status date: 2026-07-06.

This document records launch-critical scope choices that must not be inferred from UI labels, architecture docs, or unchecked provider assumptions. It contains no secrets.

## Decision Register

| Area | Launch posture | Owner | User-facing label impact | Go/no-go effect |
| --- | --- | --- | --- | --- |
| LINE messaging | Disabled/manual unless credentials, webhook URL, signature validation, and send-test proof are recorded. | Account owner TBD | UI must say server-managed, draft, manual, or disabled when live send proof is absent. | Not a launch blocker if accepted as manual/disabled; blocker if automated LINE messaging is required for launch. |
| OTA/channel automation | iCal/manual metadata only. No live OTA API adapter is proven for Booking.com, Agoda, Expedia, or Airbnb. | Operations owner TBD | Channel screens must not imply live API sync or automated booking import unless adapter evidence exists. | Not a launch blocker if accepted as manual/iCal; blocker if live OTA API automation is required. |
| Payments | PMS-recorded payments only. Card, bank transfer, PromptPay, and online payment records require references; no live gateway collection adapter is proven. | Finance/account owner TBD | Payment screens must describe recording/receipt workflows, not live gateway collection. | Not a launch blocker if offline/PMS-recorded payments are accepted; blocker if online collection is required. |
| Production users and roles | Launch-required users are Nick `ADMIN`, Hui `ADMIN`, Hotel Manager `MANAGER`, and Front Desk `FRONT_DESK`. `HOUSEKEEPING`, `CASHIER`, and `CAFE_STAFF` are not launch-required unless Nick expands scope. Username-only users are allowed; each production user still needs active status and intentional-null-email proof. Staff accounts lock after three failed attempts and require admin password reset. | Nick | No plaintext credentials in repo or screenshots. Role proof must use redacted evidence. | P0 blocker until production users are created/verified and credentialed login/logout plus role-matrix proof exists. |
| Production room inventory | Nick confirms the current production inventory is real. Future room mapping/customization should be maintained in app by admins. | Nick | Empty or incomplete room state must be labeled as setup-required, not production inventory. | Still requires redacted owner/import/admin proof matching the aggregate inventory and proving no demo/seed inventory remains. |
| DB-mutating E2E | Local disposable DB-mutating E2E is accepted as launch engineering proof; staging DB-mutating E2E is optional unless Nick later requires it. Production DB-mutating E2E is forbidden. | Nick | Launch notes must say proof is local disposable engineering evidence, not production mutation proof. | Not a blocker when local disposable proof is current and green; rerun staging only if Nick later requests it. |
| Rollback and recovery | Nick owns Render, Gmail/OAuth, database backups, and emergency recovery. Latest backup/recovery point is verified in the authenticated Render dashboard recovery modal as `2026-07-07 15:29:56` UTC+07:00 (`2026-07-07T08:29:56Z`); PITR restores cover the past 3 days and exports are retained for at least 7 days. Rollback deputy remains unassigned unless Nick appoints one. | Nick | Runbooks must show Nick as primary owner and keep the verified recovery point proof recorded. | P0 blocker only until a rollback deputy is recorded; recovery point/retention proof is now verified. |
| WAF/rate limiting | App-layer login throttling exists and persistent three-failure account lockout is implemented. Upstream Cloudflare/edge rule IDs and thresholds are not proven in repo. | Nick | Do not claim upstream WAF/rate-limit is configured until rule IDs and tests are recorded. | P1/P0 depending on accepted launch risk; WAF proof remains open. |

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
