# Sandbox Hotel PMS

Boutique hotel property-management system for front desk, rooms, reservations, housekeeping, cashier, reporting, settings, and launch operations.

## Current Launch Status

Status date: 2026-07-17.

The codebase is an **owner-accepted pilot / launch-hardening system**, not a fully launched or independently launch-signed-off PMS. Use “owner-accepted pilot” or “launch-hardening” language until the V2 launch proof pack is complete, current, and reviewed.

Automated checks can prove build, routing, business-rule, browser-smoke, API-contract, database-connectivity, and live-health behavior. Historical provider evidence also records the 2026-07-07 Cloudflare zone-level WAF/rate-limit configuration and Render recovery metadata for that point in time. Neither proves that the current release candidate is staging-proven, owner-approved, provider-proven, or ready for final launch go/no-go.

Current integration posture:

- LINE: server webhook/status support exists. Live LINE messaging must stay disabled/manual unless the account owner provides credentials, webhook configuration, signature validation, and send-test proof.
- OTA: iCal/manual metadata remains the launch-safe integration. Channel-sync v2 adds an audited **manual outbound availability queue** over existing Hotel Ops task/approval models. Queue creation and approval never call an OTA, and completion requires a human-entered provider confirmation. Direct Booking.com, Agoda, Trip.com, Expedia, Airbnb, or Channex production writes are not enabled without provider access, mappings, sandbox/certification evidence, and a reviewed adapter.
- Direct API access: Agoda and Trip.com application dossiers are tracked in [#168](https://github.com/nakalasbakalas/sandbox-pms/issues/168) and [#169](https://github.com/nakalasbakalas/sandbox-pms/issues/169). They are **preparing**, not submitted or approved. A channel-only Channex contingency is tracked in [#170](https://github.com/nakalasbakalas/sandbox-pms/issues/170).
- Payments: launch posture is PMS-recorded payments only. Card, PromptPay, bank transfer, and online payment records require references, but no live gateway/PromptPay collection adapter is proven.
- Booking email: Gmail OAuth/backfill support can import provider messages into review-only Booking Email Events. When explicitly enabled and OAuth is complete, the in-process scheduler polls enabled sources every 120 seconds by default. Scheduled passes are review-only; staff approval is still required before creating, modifying, cancelling, charging, or linking operational reservations.
- Production data: `SEED_MODE=prod-safe` must not create fake operational guests, reservations, payments, invoices, room inventory, or demo staff users. Production room inventory is imported or configured separately and still requires redacted owner/import/admin proof before full sign-off.

Full production sign-off is blocked until the required V2 evidence files are completed. Start with [docs/launch/LAUNCH_PROOF_PACK_V2.md](docs/launch/LAUNCH_PROOF_PACK_V2.md), then record dated command/manual/provider proof under `docs/launch/evidence/`.

## Local Development

Use `npm.cmd`/`npx.cmd` from PowerShell if script execution blocks `npm.ps1` or `npx.ps1`.

```bash
npm install
cp .env.local.example .env
cp .env.local.example .env.local
npm run db:bootstrap
npm run dev
```

`db:bootstrap` uses native PostgreSQL 16 on `localhost:5432` when that service is already running, and falls back to the Docker Compose database stack on `localhost:55432` when Docker Desktop is available instead.

Database setup, seed modes, disposable E2E safety, and Render database wiring are documented in [docs/database.md](docs/database.md). Windows Docker and native PostgreSQL setup are documented in [docs/docker-setup-windows.md](docs/docker-setup-windows.md).

## Validation

Run the smallest relevant check first, then widen. For a candidate release, use the V2 evidence command pack from a clean checkout of the exact deploy candidate:

```bash
npm run remediation:check
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run prod:preflight
npm run render:validate
npm run live:check
npm run public-edge:proof
npm audit --audit-level=high
npx prisma migrate status
```

Database-mutating E2E is guarded and must only run against a disposable or owner-approved staging database:

```bash
ALLOW_DB_E2E=true E2E_DATABASE_URL="postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public" npm run db:e2e:ready
ALLOW_DB_E2E=true E2E_DATABASE_URL="postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public" npm run test:e2e:db
```

Never run DB-mutating E2E against the Render production database.

## Channel Synchronization V2

The lite release boundary, audit findings, execution plan, activation checks, and rollback steps are in [docs/CHANNEL_SYNC_LITE_FINALIZATION.md](docs/CHANNEL_SYNC_LITE_FINALIZATION.md). The architecture and operator runbook remain in [docs/CHANNEL_SYNC_V2.md](docs/CHANNEL_SYNC_V2.md). The executed prompts are recorded in [docs/prompts/CHANNEL_SYNC_LITE_FINALIZATION_EXECUTED_PROMPT.md](docs/prompts/CHANNEL_SYNC_LITE_FINALIZATION_EXECUTED_PROMPT.md) and [docs/prompts/CHANNEL_SYNC_V2_EXECUTED_PROMPT.md](docs/prompts/CHANNEL_SYNC_V2_EXECUTED_PROMPT.md).

Inspect the enforced policy:

```bash
npm run channel-sync:policy
```

Use the manual outbound queue:

```bash
npm run availability:queue -- help
npm run availability:queue -- list
```

Near-live inbound polling requires the following non-secret configuration plus Gmail OAuth secrets:

```env
BOOKING_EMAIL_NEAR_LIVE_ENABLED=true
BOOKING_EMAIL_SYNC_INTERVAL_SECONDS=120
BOOKING_EMAIL_SYNC_BATCH_LIMIT=25
CHANNEL_MANAGER_PROVIDER=channex
```

“Near-live” is short-interval polling, not a zero-lag webhook. Channex is a channel-only contingency and must not become a second PMS.

## Production Data

Production room inventory is imported separately from prod-safe seed:

```bash
npm run rooms:import -- --file ./ops/rooms.production.json --confirm
```

Against a production-like database URL, the room import also requires:

```env
ALLOW_PROD_ROOM_ONBOARDING=true
```

Generate redacted aggregate room-inventory proof after import/onboarding:

```bash
npm run rooms:proof
```

Use `-- --include-room-type-labels` only when the operations owner approves exposing room-type labels in evidence. The proof output is counts-only; it omits room numbers, guests, users, payments, reservations, and raw database URLs. It still needs owner/import confirmation before production room inventory is launch-signed-off.

Booking mailbox history can be scanned through backend Gmail OAuth credentials without exposing email contents in logs:

```bash
npm run gmail-oauth:render
npm run booking-email:proof
npm run booking-email:backfill -- --all-past --limit 250
npm run booking-email:backfill -- --all-past --limit 250 --confirm
```

The Gmail OAuth helper generates a Google consent URL and can exchange an authorization code directly into Render env vars without printing token values. The proof command is read-only database evidence of current capture state. The backfill command without `--confirm` is Gmail scan dry-run only. By default it uses the approved provider query boundary rather than the incomplete primary-mailbox-only filter, excluding known OTA security/reporting/invoice noise while keeping explicit `--query` available for owner-approved overrides. The confirmed command imports review-only Booking Email Events for `/booking-inbox`; staff approval is still required before creating, modifying, cancelling, charging, or linking reservations.

Real staff users must be approved and configured through hash-only `SEED_USERS_JSON`, a setup-token flow, or an explicitly reviewed bootstrap path. Staff accounts can be username-only when email is not available. Do not commit plaintext credentials.

## Production Operations

Primary runbooks:

- [docs/production-environment.md](docs/production-environment.md)
- [docs/live-environment-proof.md](docs/live-environment-proof.md)
- [docs/operational-runbook.md](docs/operational-runbook.md)
- [docs/disaster-recovery.md](docs/disaster-recovery.md)
- [docs/upstream-waf-rate-limit.md](docs/upstream-waf-rate-limit.md)

Hotel Ops command-center docs:

- [docs/CURRENT_SYSTEM_AUDIT.md](docs/CURRENT_SYSTEM_AUDIT.md)
- [docs/IMPLEMENTATION_SPEC.md](docs/IMPLEMENTATION_SPEC.md)
- [docs/RUNBOOK.md](docs/RUNBOOK.md)
- [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md)
- [docs/OTA_ADAPTER_GUIDE.md](docs/OTA_ADAPTER_GUIDE.md)
- [docs/CHANNEL_SYNC_V2.md](docs/CHANNEL_SYNC_V2.md)
- [docs/ACCEPTANCE_TESTS.md](docs/ACCEPTANCE_TESTS.md)

Before full production launch sign-off, the V2 proof pack must record current production-secret metadata with values redacted, rollback owner and deputy, database recovery owner, latest known-good deploy ID, backup/restore evidence, Cloudflare WAF/rate-limit rule IDs, production user/role proof, staff workflow acceptance, PII governance proof, money precision decision, and accepted deferrals.

## License

MIT License. See [LICENSE](LICENSE).
