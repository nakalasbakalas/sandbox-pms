# P0 Owner Proof Handoff

Status date: 2026-07-03.

Verdict: action required. This file is an evidence intake checklist for the remaining P0 blockers. It is not proof that those blockers are closed.

Latest intake: Slice 5AZ records owner approval for PR #150 / exact reviewed commit deployment and confirms the current live setup-complete reprobe. Slice 5BA records production aggregate room counts from a successful Render one-off job, but does not supply owner/import source proof. Slice 5BB records Booking Email capture state: the source exists, Gmail OAuth is missing, and there are zero production booking-email events. This file still needs the redacted production user table, credentialed role proof, local-only workflow acceptance decision, secret inventory, recovery owners, WAF/rate-limit rule metadata, and mailbox OAuth/backfill proof if booking-email capture is required.

## Non-Negotiable Redaction Rules

- Do not paste passwords, session cookies, bearer tokens, API keys, raw database URLs, private keys, recovery URLs, or screenshots containing those values.
- Do not record guest PII, payment details, raw room numbers if the owner treats them as sensitive, mailbox message bodies, or provider account secrets.
- Prefer role names, counts, statuses, deploy IDs, rule IDs, and timestamps over screenshots.
- If a screenshot/export is the only practical source, redact values before storing it and record who redacted it.
- Do not run DB-mutating E2E against production. Use only a disposable/staging `E2E_DATABASE_URL` with `ALLOW_DB_E2E=true`, or record a launch-owner local-only acceptance decision.

## Evidence Intake Table

Use this structure when adding real owner/provider proof:

| Area | Owner | Date/time | Source | Proof captured | Redaction performed | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Example only | TBD | TBD | TBD | TBD | TBD | Open |

## Production Users, Auth, RBAC, Logout

Current status: partial. `AUTH_RBAC_PROOF.md` proves local RBAC and live unauthenticated API denial only.

Required evidence to close:

| Required proof | Accepted redacted format | Must not include |
| --- | --- | --- |
| Approved production user list | Table with login identifier redacted or partially masked, display name/initials if approved, active status, intended role, approving owner, date. | Passwords, password hashes, cookies, private email contents. |
| Credentialed production login | Per-role note showing date/time, host, role, successful login, and first authenticated page/API check. | Passwords, cookies, session tokens, screenshots of secrets. |
| Credentialed production logout | Note showing logout action followed by `/api/auth/me` or equivalent session check returning unauthenticated status. | Cookies, session tokens. |
| Role matrix | Table of role vs allowed/denied pages/actions for admin, manager, front desk, housekeeping, cashier, and cafe staff where applicable. | Guest data or credentials. |
| Underprivileged protected-page denial | Role, attempted page, expected denial, observed denial. | Cookies or full user identity unless approved. |
| Underprivileged protected API mutation denial | Role, endpoint/method, expected denial, observed `401`/`403` or equivalent. Use a no-op/invalid payload approved by the owner. | Cookies, tokens, guest data, production mutation payloads. |
| Bootstrap/setup-token cleanup | Redacted key-name inventory or owner confirmation that setup token/bootstrap admin path is rotated, disabled, or intentionally retained with owner/date/expiry. | Secret values. |

## Real Production Room Inventory

Current status: partial. `ROOM_INVENTORY_PROOF.md` now records production aggregate room counts from Slice 5BA, but it does not prove owner-approved source of truth or that the rows are not fake seed/demo inventory.

Required evidence to close:

| Required proof | Accepted redacted format | Must not include |
| --- | --- | --- |
| Operations-approved source of truth | Owner note naming the approved source: PMS admin setup, onboarding import, or reviewed export. | Guest data or credentials. |
| Room type count | Redacted aggregate table: room type label if approved, room type count, active/inactive status. | Room numbers if sensitive, guest assignments. |
| Room count/status distribution | Aggregate count by room type/status, or redacted dashboard/export showing totals. | Guest names, reservation references, raw DB URLs. |
| Not fake seed inventory | Owner/import note or command output showing inventory came from approved onboarding/import, not prod-safe seed/demo data. | Production secrets. |

Accepted collection paths:

- Credentialed PMS admin room setup proof with secrets and guest data redacted.
- Render MCP/API aggregate query that returns counts only.
- Owner-exported CSV/table with room numbers removed or masked where needed.

## Core Hotel Workflow Acceptance

Current status: partial local proof. `HOTEL_WORKFLOW_PROOF.md` proves business tests and disposable local DB E2E only.

Required evidence to close:

| Workflow | Accepted redacted proof | Safety condition |
| --- | --- | --- |
| Reservation create/update/cancel | Staging or owner-approved controlled production-like scenario with audit/timeline evidence. | Avoid real guest PII; use disposable/staging where possible. |
| Invalid date rejection | Screenshot/log/API result with redacted payload. | No real guest data. |
| Room assignment safety | Evidence that unavailable/occupied/conflicting room assignment is blocked. | Use staging or approved test records. |
| Check-in/check-out | Controlled scenario showing status transition and audit/timeline entry. | Owner-approved test record only if production-like. |
| Payment/folio recording | Evidence of PMS-recorded payment/folio workflow. | No card/bank/PromptPay secrets or live gateway claims. |
| Housekeeping update | Evidence of room status transition and audit/log entry. | No guest PII. |

## DB-Mutating E2E Posture

Current status: local disposable proof exists. Final launch still needs either accepted local-only proof or staging proof if the launch owner requires stronger coverage.

Required evidence to close:

- `ALLOW_DB_E2E=true` explicitly set.
- `E2E_DATABASE_URL` points to a disposable/staging database, not production.
- `npm.cmd run db:e2e:ready` passes.
- `npm.cmd run test:e2e:db` passes.
- If not rerun outside local, launch owner records local-only proof acceptance with owner/date/limitation.

## Live Setup-Completion Hardening

Current status: closed for the current public deploy. Slice 5AZ records owner approval for PR #150 / exact commit `fbc303136253a9785446d601d5532b6efc523b8f`; current Render deploy `dep-d93ordnaqgkc73cd2ke0` is live on `sandbox-hotel-pms-v43m`, serving commit `1c493116b7eb84ab010097903ff641cd526d8cb6`; unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` returns the intended production-disabled `403`.

Maintenance evidence for future setup/auth route deploys:

- Deploy record with deploy ID and commit SHA.
- Public reprobe against `https://book.sandboxhotel.com/api/setup/complete` showing completed setup is rejected before setup payload validation.
- No production secrets or payloads recorded.

## Secrets, Recovery, Rollback, WAF

Current status: partial/open. `WAF_PROVIDER_POSTURE.md` records safe Render metadata and public edge probes only.

Required evidence to close:

| Area | Accepted redacted proof | Must not include |
| --- | --- | --- |
| Render secret inventory | Key-name list, configured/missing status, rotation date/status where available, owner/date. | Secret values, raw DB URLs, tokens. |
| Legacy key cleanup | Owner decision for legacy/admin/bootstrap key names: remove, rotate, or retain with reason/expiry. | Secret values. |
| Rollback owner | Named owner with Render dashboard access confirmation. | Passwords or invite links. |
| Rollback deputy | Named deputy with Render dashboard access confirmation. | Passwords or invite links. |
| Database recovery owner | Named owner with Render PostgreSQL/recovery access confirmation. | Database URLs or credentials. |
| Recovery point/retention | Render dashboard/API metadata showing current backup/recovery status and retention window. | Recovery URLs or credentials. |
| Rollback path | Tested rollback or owner-approved dry-run/accepted risk with latest known-good deploy ID. | Credentials. |
| WAF/rate-limit rules | Edge provider, zone/account, rule IDs, protected hostnames, thresholds/actions, and non-destructive test result. | Cloudflare/API tokens. |

## Open Launch Decision Needed

The fastest path to launch sign-off now requires owner-supplied proof or explicit accepted-risk decisions for the remaining P0s. Local tests and unauthenticated probes cannot substitute for:

- approved production users and role behavior,
- real production inventory,
- credentialed production workflow acceptance,
- secret rotation and recovery ownership,
- upstream WAF/rate-limit configuration.
