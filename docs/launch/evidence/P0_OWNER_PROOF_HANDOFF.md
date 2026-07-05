# P0 Owner Proof Handoff

Status date: 2026-07-05.

Verdict: action required. This file is an evidence intake checklist for the remaining P0 blockers. It is not proof that those blockers are closed.

Latest intake: Slice 5BY deploys green `main` commit `bf37942ad77223e47f8fea41dc88e9921d7ddfec` to Render deploy `dep-d94s6oa8qa3s73d6bum0` and confirms setup gate, deep health, public edge, live readiness, production preflight, and redacted Gmail OAuth status. Slice 5BW configures backend Gmail OAuth on Render, imports 1000 provider messages into `/booking-inbox` as review-only Needs Review events, and leaves staff parser review open. Slice 5BZ adds `npm.cmd run owner-proof:validate`, a local template and redaction validator for owner/provider proof intake. Slice 5BU adds `npm.cmd run cloudflare:waf:proof`, a read-only owner-run Cloudflare WAF/rate-limit ruleset proof helper. Cloudflare API token and zone ID are still absent in this environment, so WAF/rate-limit rule IDs and thresholds remain open. Slice 5BL adds `npm.cmd run auth-rbac:proof`, an owner-run helper for collecting credentialed production login/logout and underprivileged denial evidence without printing passwords, cookies, tokens, full login identifiers, or raw response bodies. Slice 5BA records production aggregate room counts from a successful Render one-off job, but does not supply owner/import source proof. This file still needs the redacted production user table, actual credentialed role proof output, local-only workflow acceptance decision, secret inventory, recovery owners, WAF/rate-limit rule metadata, and staff acceptance of booking-email parser/review quality.

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

Optional local validator before submitting proof:

```powershell
npm.cmd run owner-proof:validate -- --init-template
# Edit .\.codex\owner-proof-intake.local.json locally; keep it untracked.
npm.cmd run owner-proof:validate -- --file .\.codex\owner-proof-intake.local.json
npm.cmd run owner-proof:validate -- --file .\.codex\owner-proof-intake.local.json --require-complete
```

The validator reports missing/open areas and obvious secret-shaped strings without echoing the raw proof object. It does not prove provider truth by itself; it is a redaction and completeness aid before evidence is summarized into this handoff or launch docs.

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

Safe owner-run helper:

```powershell
npm.cmd run auth-rbac:proof -- --users-file .\.codex\auth-proof-users.local.json
```

The local input file must remain untracked and must not be copied into docs, issues, chat, or screenshots. Use `--users-stdin` if the owner prefers stdin-only handling. The helper masks login identifiers, keeps cookies in memory only, confirms login/logout with `/api/auth/me`, and rejects mutating denial probes unless `--allow-mutating-denial-probes` is explicitly set for an owner-approved no-op or invalid payload.

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

Current status: closed for the current public deploy. Slice 5AZ records owner approval for PR #150 / exact commit `fbc303136253a9785446d601d5532b6efc523b8f`; Slice 5BV confirms current Render deploy `dep-d94e5e7lk1mc73b3oh2g` is live on `sandbox-hotel-pms-v43m`, serving commit `d8884884faba8b50cb73c7f827aa4f9871744d4a`; unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` returns the intended production-disabled `403`.

Maintenance evidence for future setup/auth route deploys:

- Deploy record with deploy ID and commit SHA.
- Public reprobe against `https://book.sandboxhotel.com/api/setup/complete` showing completed setup is rejected before setup payload validation.
- No production secrets or payloads recorded.

## Booking Email Capture And Backfill

Current status: loaded for staff review. Slice 5BW configures Render backend Gmail OAuth with the booking-specific refresh-token tuple `ready=true`, records a successful provider-query dry-run, deploys chunked confirmed backfill handling, imports 1000 provider messages as review-only Booking Email Events, and confirms PMS capture with `npm run booking-email:proof`. The proof reports 1000 total events, 1000 source-message events, 1000 Needs Review, 0 processed, 0 errors, and 0 ignored. This closes the OAuth/backfill mechanics blocker, but staff still need to review parser output in `/booking-inbox`.

Required evidence to close:

| Required proof | Accepted redacted format | Must not include |
| --- | --- | --- |
| Gmail OAuth configured on Render | Key-name status only from `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` showing one supported backend credential path `ready=true`. | Client secret, refresh token, access token, OAuth consent screenshots containing secrets. |
| Historical dry-run backfill | Redacted aggregate output from `npm run booking-email:backfill -- --query "<owner-approved Gmail query>" --limit 250 --max-pages 5` showing scanned count, existing/new candidates, event type mix, and confidence distribution. Do not use the default primary-mailbox query for the first historical import unless recipient coverage is reverified. | Message IDs, senders, recipients, subjects, raw email text, guest/payment data. |
| Review-only import if accepted | Confirmed import job ID and aggregate event counts; staff still review in `/booking-inbox`. | Raw email contents, credentials, production mutation payloads. |
| Staff visual review | Owner/staff note that `/booking-inbox` Needs Review, Errors, Processed, and Ignored tabs were inspected and parser quality is acceptable or gaps are accepted. | Raw message bodies, guest/payment details, credentials. |

Safe owner setup command:

```powershell
npm.cmd run gmail-oauth:render
npm.cmd run gmail-oauth:render -- --credentials-file .\.codex\google-oauth-client.local.json
$authCode = Read-Host 'Paste Gmail OAuth authorization code'
$authCode | npm.cmd run gmail-oauth:render -- --credentials-file .\.codex\google-oauth-client.local.json --exchange-code --code-stdin --apply-render --use-render-cli-token
npm.cmd run gmail-oauth:render -- --credentials-file .\.codex\google-oauth-client.local.json --listen --apply-render --use-render-cli-token
npm.cmd run booking-email:backfill -- --query "<owner-approved Gmail query>" --limit 250 --max-pages 5
npm.cmd run booking-email:backfill -- --query "<owner-approved Gmail query>" --limit 1000 --max-pages 20 --confirm
npm.cmd run booking-email:proof
```

## Secrets, Recovery, Rollback, WAF

Current status: partial/open. `WAF_PROVIDER_POSTURE.md` records safe Render metadata, public edge probes, and the current local Cloudflare tooling/env gap only. Slice 5BU adds an owner-run Cloudflare Rulesets API helper, but it still requires a Cloudflare token and zone ID from an owner shell.

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

Public-edge routing proof can be refreshed without owner secrets using `npm.cmd run public-edge:proof`; Slice 5BV refreshed it successfully. This does not replace the privileged WAF/rate-limit rule proof above.

Safe owner-run WAF/rate-limit proof command:

```powershell
$env:CLOUDFLARE_API_TOKEN = '<redacted owner token>'
$env:CLOUDFLARE_ZONE_ID = '<redacted zone id>'
npm.cmd run cloudflare:waf:proof -- --hostname book.sandboxhotel.com --probe-url https://book.sandboxhotel.com/.env
```

If account-level WAF/rate-limit rulesets are used, also set `CLOUDFLARE_ACCOUNT_ID` or pass `--account-id`. The helper omits action parameters and rule expressions by default; use `--include-expressions` only if the owner approves recording expressions in redacted evidence.

## Open Launch Decision Needed

The fastest path to launch sign-off now requires owner-supplied proof or explicit accepted-risk decisions for the remaining P0s. Local tests and unauthenticated probes cannot substitute for:

- approved production users and role behavior,
- real production inventory,
- credentialed production workflow acceptance,
- secret rotation and recovery ownership,
- upstream WAF/rate-limit configuration.
