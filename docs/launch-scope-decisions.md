# Launch Scope Decisions

Status date: 2026-07-17.

This document records launch-critical scope choices that must not be inferred from UI labels, architecture docs, closed issues, or unchecked provider assumptions. It contains no secrets.

Current posture: **owner-accepted pilot / launch-hardening**. Full production launch sign-off remains blocked until `docs/launch/LAUNCH_PROOF_PACK_V2.md` is complete or any remaining risk is explicitly accepted with owner, expiry date, workaround, and customer-impact note.

## Decision Register

| Area | Launch posture | Owner | User-facing label impact | Go/no-go effect |
| --- | --- | --- | --- | --- |
| Overall launch status | Owner-accepted pilot / launch-hardening. Do not call the PMS fully launched or independently launch-signed-off until V2 evidence is complete. | Nick | Docs, PRs, release notes, and UI/runbooks must avoid “fully launched”, “production signed-off”, or “externally verified” unless V2 proof supports it. | Full production go/no-go remains blocked by open V2 gates. Controlled owner pilot can continue if risks are accepted. |
| V2 command evidence | Must be rerun from a clean checkout on the exact deploy candidate: remediation check, typecheck, lint, tests, E2E, build, prod preflight, Render validation, live check, public-edge proof, audit, and Prisma migration status. | Release owner TBD | Release notes must cite dated command evidence, not stale previous runs. | P0 blocker for full sign-off. |
| LINE messaging | Disabled/manual unless credentials, webhook URL, signature validation, and send-test proof are recorded. | Account owner TBD | UI must say server-managed, draft, manual, or disabled when live send proof is absent. | Not a launch blocker if accepted as manual/disabled; blocker if automated LINE messaging is required for launch. |
| OTA/channel automation | iCal/manual metadata only. No live OTA API adapter is proven for Booking.com, Agoda, Expedia, or Airbnb. | Operations owner TBD | Channel screens must not imply live API sync or automated booking import unless adapter evidence exists. | Not a launch blocker if accepted as manual/iCal; blocker if live OTA API automation is required. |
| Payments | PMS-recorded payments only. Card, bank transfer, PromptPay, and online payment records require references; no live gateway collection adapter is proven. | Finance/account owner TBD | Payment screens must describe recording/receipt workflows, not live gateway collection. | Not a launch blocker if offline/PMS-recorded payments are accepted; blocker if online collection is required. Live payment gateway/PromptPay automation is blocked while money precision remains Float-authoritative. |
| Production users and roles | Launch-required users are Nick `ADMIN`, Hui `ADMIN`, Hotel Manager `MANAGER`, Front Desk `FRONT_DESK`, plus Housekeeping and Cashier if those workflows are included in sign-off. Username-only users are allowed; each production user still needs active status and intentional-null-email proof. Staff accounts lock after three failed attempts and require admin password reset. | Nick | No plaintext credentials in repo or screenshots. Role proof must use redacted evidence. | P0 blocker until production users are created/verified and credentialed login/logout plus role-matrix proof exists. |
| Production room inventory | Nick confirms the current production inventory is real, but owner/import/admin proof is still required for full sign-off. Future room mapping/customization should be maintained in app by admins. | Nick | Empty or incomplete room state must be labeled as setup-required, not production inventory. | Requires redacted owner/import/admin proof matching aggregate inventory and proving no demo/seed inventory remains. |
| DB-mutating E2E | Local disposable DB-mutating E2E is accepted as engineering proof; staging DB-mutating E2E is optional unless Nick later requires it. Production DB-mutating E2E is forbidden. | Nick | Launch notes must say proof is local disposable engineering evidence, not production mutation proof. | Not a blocker when local disposable proof is current and green; rerun staging only if Nick later requests it. |
| Rollback and recovery | Nick owns Render, Gmail/OAuth, database backups, and emergency recovery. Latest backup/recovery point is unknown until freshly verified. Rollback deputy remains unassigned unless Nick appoints one. | Nick | Runbooks must show Nick as primary owner and keep recovery point proof open until current provider evidence exists. | P0 blocker until latest recovery point/retention proof is recorded; deputy is accepted risk only with explicit owner sign-off. |
| WAF/rate limiting | App-layer login throttling and persistent three-failure account lockout exist. Historical 2026-07-07 provider evidence records the zone-level managed WAF, custom probe rule, and login rate-limit rule for the public hosts. | Nick | Cite the dated provider evidence and do not describe it as current-candidate proof without a fresh read-only check. | Historical configuration proof is preserved; current provider proof remains a release gate if WAF posture could have changed. |
| Money precision | Float is acceptable only for owner-accepted pilot and low-volume internal reconciliation. Integer satang or Decimal must be implemented before high-volume financial use or live payment automation. | Finance/account owner TBD | Cashier/reporting docs must say daily reconciliation is required while Float remains authoritative. | P1 blocker before gateway/PromptPay automation or high-volume financial reliance. |
| PII governance | Raw emails, ID fields, DOB, documents, and payment references require masking/access controls, sensitive-view audit logs, retention policy, export/delete process, and staff training proof. | Privacy/operations owner TBD | Evidence must use redacted summaries only. Staff UI should avoid exposing raw/ID/payment data outside intended roles. | P1/P0 depending on operational scope and data volume. |
| Repository visibility/license | Repo is public and launch/provider docs expose operational posture. License metadata must reflect the correct owner. | Nick | Public repo exposure must be explicitly accepted or repo should be made private. | Owner decision required before broad distribution or full sign-off. |

## Deferred Feature Rules

Any deferred launch feature must record:

- Owner.
- Target date or decision review date.
- User-facing label impact.
- Whether launch can proceed without it.
- Evidence required to close the deferral.
- Expiry date for accepted risk.
- Operational workaround and customer/staff impact.

## Current Evidence Sources

- [LAUNCH_CHECKLIST.md](../LAUNCH_CHECKLIST.md)
- [docs/launch/LAUNCH_PROOF_PACK_V2.md](launch/LAUNCH_PROOF_PACK_V2.md)
- [docs/live-environment-proof.md](live-environment-proof.md)
- [docs/production-environment.md](production-environment.md)
- [docs/database.md](database.md)
- [docs/disaster-recovery.md](disaster-recovery.md)
