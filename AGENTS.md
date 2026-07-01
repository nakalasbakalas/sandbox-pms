# AGENTS.md - Sandbox Hotel PMS

## Default Stance

- Report risks, regressions, and unknowns before polish or implementation notes.
- Never invent business facts, policies, metrics, credentials, or integration status.
- Prefer minimal, reviewable diffs over broad rewrites.
- Separate UI polish from logic refactors unless the user explicitly asks to combine them.
- Default to report-only for production-sensitive changes unless the requested fix is clearly low risk and locally verifiable.

## Project Mission

This repository is the Sandbox Hotel PMS. Current work includes the operational PMS, booking-email intake, staff/user management, and the controlled Hotel Ops AI Command Center.

The Hotel Ops system lets authorized hotel staff submit operational instructions, turns those instructions into structured tasks, applies role and approval checks, executes only approved safe work through backend services or OTA adapters, monitors booking trends, and records audit evidence.

## Safety Model

Do not build flows where hotel staff directly use the owner ChatGPT login, OpenAI API key, OTA credentials, mailbox password, or unrestricted browser agent.

Staff must use controlled PMS interfaces with authentication, roles, approvals, audit logs, idempotency, and emergency-stop controls. Production mutations must go through backend API/service functions, especially `server/pms-service.mjs` and `server/ops-service.mjs`.

## Non-Negotiable Constraints

- No CAPTCHA or 2FA bypass.
- No credential exposure in frontend code, prompts, logs, screenshots, notifications, docs, or commits.
- Do not store pasted mailbox/admin passwords in repo files, skills, memory, logs, screenshots, or final summaries.
- Booking email intake uses `booking@sandboxhotel.com` as the primary mailbox, but server sync requires backend Gmail API credentials: either an access token or OAuth refresh-token credentials, not a raw mailbox password.
- Admin-created staff login users may be username-only. Email may be null, username must be unique, and the normal password policy still applies.
- LINE Hotel Ops command intake must remain opt-in, signed-webhook-only, prefix-gated, allowlisted by LINE source user id, mapped to active PMS users, and submitted through `server/ops-service.mjs`.
- High-risk booking, payment, OTA, or Hotel Ops write actions require approval unless an explicit backend policy safely pre-approves them.
- Destructive, ambiguous, denial, cancellation, alert-resolution, emergency-stop, and booking-changing actions require an operational reason and audit evidence.
- Emergency stop must block write operations.
- Every task attempt must be auditable, including denied and failed tasks.
- Browser automation must support dry-run mode and default to dry-run.
- Worker results are untrusted at the PMS boundary. Sanitize persisted and displayed summaries, errors, and proof artifacts.
- Prefer incremental changes that match the existing repo structure.

## Hotel Ops Task Taxonomy

Supported task types:

- `READ_RESERVATIONS`
- `READ_GUEST_MESSAGES`
- `DRAFT_GUEST_REPLY`
- `SEND_GUEST_REPLY`
- `READ_RATES`
- `UPDATE_RATE`
- `READ_AVAILABILITY`
- `UPDATE_AVAILABILITY`
- `CLOSE_ROOM`
- `OPEN_ROOM`
- `UPDATE_DESCRIPTION`
- `UPDATE_PHOTOS`
- `SCAN_BOOKINGS`
- `GENERATE_RECOMMENDATION`
- `NO_OP_CLARIFY`
- `FORBIDDEN`

## Role Mapping

- `ADMIN` maps to owner-level authority.
- `MANAGER` maps to hotel-manager authority.
- `FRONT_DESK`, `HOUSEKEEPING`, `CASHIER`, and `CAFE_STAFF` map to staff authority.
- `SYSTEM` is reserved for scheduled jobs and internal execution only.

## Required Validation

Use strict schemas for model outputs, service payloads, booking-email events, and worker calls. Reject unknown task types, unknown platforms, missing required dates, impossible rates, invalid usernames, duplicate payment references, duplicate booking references, credential-shaped payload fields, and attempts to access credentials or bypass security.

Use PowerShell with `npm.cmd` and `npx.cmd` in this repo. Run the smallest credible check first, then widen when risk remains:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npx.cmd prisma validate
git diff --check
npm.cmd run build
npm.cmd run test:e2e
```

For database-mutating E2E, require `ALLOW_DB_E2E=true` and a disposable or staging `E2E_DATABASE_URL`. Never point DB-mutating E2E at production-like data.

## Documentation Required

Maintain these docs when changing Hotel Ops, booking-email intake, auth, payments, OTA adapters, or launch boundaries:

- `docs/CURRENT_SYSTEM_AUDIT.md`
- `docs/IMPLEMENTATION_SPEC.md`
- `docs/RUNBOOK.md`
- `docs/SECURITY_MODEL.md`
- `docs/OTA_ADAPTER_GUIDE.md`
- `docs/ACCEPTANCE_TESTS.md`

Do not claim launch readiness from local tests alone. Separate engineering readiness from live account-owner sign-off and production proof.
