# Sandbox Hotel PMS

Boutique hotel property-management system for front desk, rooms, reservations, housekeeping, cashier, reporting, settings, and launch operations.

## Current Launch Status

Status date: 2026-06-15.

The codebase is in launch-hardening, not final launch sign-off. Automated checks can prove build, routing, business-rule, browser-smoke, API-contract, database-connectivity, and live-health behavior. They do not prove account-owner decisions, production user approval, provider credential ownership, role-by-role manual acceptance, WAF configuration, or launch go/no-go.

Current integration posture:

- LINE: server webhook/status support exists. Live LINE messaging must stay disabled/manual unless the account owner provides credentials, webhook configuration, signature validation, and send-test proof.
- OTA: launch posture is iCal/manual metadata only. Booking.com, Agoda, Expedia, or Airbnb API automation is not live without provider adapters and sandbox/production evidence.
- Payments: launch posture is PMS-recorded payments only. Card, PromptPay, bank transfer, and online payment records require references, but no live gateway/PromptPay collection adapter is proven.
- Production data: `SEED_MODE=prod-safe` must not create fake operational guests, reservations, payments, invoices, room inventory, or demo staff users. Production room inventory is imported or configured separately.

Open launch proof work is tracked in GitHub issues #136-#142. Scope decisions and go/no-go boundaries are documented in [docs/launch-scope-decisions.md](docs/launch-scope-decisions.md). The checklist is [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md).

## Local Development

Use `npm.cmd`/`npx.cmd` from PowerShell if script execution blocks `npm.ps1` or `npx.ps1`.

```bash
npm install
npm run db:up
cp .env.local.example .env
cp .env.local.example .env.local
npm run db:doctor
npm run db:ready
npm run dev
```

Database setup, seed modes, disposable E2E safety, and Render database wiring are documented in [docs/database.md](docs/database.md). Windows Docker setup is documented in [docs/docker-setup-windows.md](docs/docker-setup-windows.md).

## Validation

Run the smallest relevant check first, then widen:

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run prod:preflight
npm run render:validate
npm run live:check
npm run launch:check
npm audit --audit-level=high
npx prisma migrate status
```

Database-mutating E2E is guarded and must only run against a disposable or staging database:

```bash
ALLOW_DB_E2E=true E2E_DATABASE_URL="postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public" npm run db:e2e:ready
ALLOW_DB_E2E=true E2E_DATABASE_URL="postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public" npm run test:e2e:db
```

Never run DB-mutating E2E against the Render production database.

## Production Data

Production room inventory is imported separately from prod-safe seed:

```bash
npm run rooms:import -- --file ./ops/rooms.production.json --confirm
```

Against a production-like database URL, the room import also requires:

```env
ALLOW_PROD_ROOM_ONBOARDING=true
```

Real staff users must be approved and configured through hash-only `SEED_USERS_JSON`, a setup-token flow, or an explicitly reviewed bootstrap path. Do not commit plaintext credentials.

## Production Operations

Primary runbooks:

- [docs/production-environment.md](docs/production-environment.md)
- [docs/live-environment-proof.md](docs/live-environment-proof.md)
- [docs/operational-runbook.md](docs/operational-runbook.md)
- [docs/disaster-recovery.md](docs/disaster-recovery.md)
- [docs/upstream-waf-rate-limit.md](docs/upstream-waf-rate-limit.md)

Before launch sign-off, the live proof register must record current production-secret metadata with values redacted, rollback owner and deputy, database recovery owner, latest known-good deploy ID, backup/restore evidence, WAF/rate-limit rule IDs, production user/role proof, and accepted deferrals.

## License

MIT License. See [LICENSE](LICENSE).
