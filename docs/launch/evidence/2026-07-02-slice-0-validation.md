# Slice 0 Launch Evidence - 2026-07-02

Scope: fresh local launch evidence for `D:\sandbox-pms`, plus the smallest unblock for the current-checkout `npm.cmd run launch:check` failure. This file records local command output only. It does not prove production sign-off, production account-owner decisions, provider credentials, production room inventory, or live user/RBAC acceptance.

## Starting State

- Branch: `main...origin/main`.
- Pre-existing dirty files before this slice: `.env.example`, `server/ota-adapters/booking-com.mjs`.
- Requested launch docs missing at start: `docs/launch/CODEX_LAUNCH_FINISH_PACKET.md`, `docs/launch/LAUNCH_PROOF_MATRIX.md`, and `docs/launch/CURRENT_STATUS_INDEX.md`.
- Existing launch sources read: `LAUNCH_CHECKLIST.md`, `README.md`, `docs/launch-scope-decisions.md`, `docs/live-environment-proof.md`, and local `AGENTS.md`.

## Command Results

| Command | Result | Evidence summary |
| --- | --- | --- |
| `npm.cmd run launch:evidence` | Failed | Missing npm script: `launch:evidence`. |
| `npm.cmd run db:doctor` | Failed initially | Both local databases were reachable, but `DATABASE_URL migrate status` and `E2E_DATABASE_URL migrate status` were not clean. |
| `npm.cmd run typecheck` | Passed | TypeScript project check completed with exit code 0. |
| `npm.cmd run lint` | Passed | ESLint completed with exit code 0. |
| `npm.cmd test` | Passed | Business rule tests passed. |
| `npm.cmd run build` | Passed | Typecheck and Vite production build completed; large chunks remain a watch item. |
| `npm.cmd run prod:preflight` | Passed with expected warning | LINE credentials are not configured; live LINE messaging remains disabled. |
| `npm.cmd run render:validate` | Passed | Render Blueprint validation returned `valid: true`. |
| `npm.cmd run live:check` | Passed | `https://book.sandboxhotel.com` readiness check passed; `lineWebhookConfigured=false`; DNS resolved to `216.24.57.8`. |
| `git diff --check` | Passed with warnings | Only CRLF/LF replacement warnings for the pre-existing modified files. |
| `npm.cmd run launch:check` | Failed initially | Failed inside `npm.cmd run db:doctor` because local dev and E2E migration status were not clean. |
| `npx.cmd prisma migrate status` | Failed initially | `sandbox_hotel_dev` was missing migrations `20260702053000_add_whatsapp_message_channel` and `20260702064500_hotel_ops_scan_snapshots`. |
| `npm.cmd run db:migrate` | Passed | Applied the two pending migrations to local `sandbox_hotel_dev`. |
| `$env:ALLOW_DB_E2E='true'; npm.cmd run db:e2e:ready` | Passed | Guarded local `sandbox_hotel_e2e` was migrated and seeded in `e2e` mode. |
| `npm.cmd run db:doctor` | Passed after remediation | Prisma validate, local DB connectivity, local E2E DB connectivity, and both migrate-status checks passed. The DB-mutating E2E guard remains blocked by default without `ALLOW_DB_E2E=true`. |
| `npm.cmd run launch:check` | Passed after remediation | Ran `db:generate`, `db:doctor`, lint, typecheck, business tests, non-mutating E2E smoke, build, high-threshold audit, and Prisma migrate status successfully. |

## Launch-Gate Remediation

The highest-impact blocker preventing `npm.cmd run launch:check` from passing was stale local migration state. It was corrected by applying pending migrations only to local databases:

- Local dev database: `sandbox_hotel_dev`.
- Local disposable E2E database: `sandbox_hotel_e2e`, guarded with `ALLOW_DB_E2E=true`.

No DB-mutating E2E test was run against production. No production database URL, token, password, cookie, or credential value was recorded.

## Remaining P0 Blockers

- Production users/auth/RBAC/logout/unauthorized-access proof is not recorded for the target environment.
- Real production room inventory proof is not recorded.
- Core hotel workflow proof is not recorded for staging or controlled production-like acceptance.
- Current-checkout DB-mutating workflow E2E has not been rerun; only local E2E database preparation was refreshed.
- Production secret hygiene, rotation metadata, recovery ownership, rollback owner/deputy, and WAF/rate-limit rule evidence remain external/account-owner proof gaps.
- Live secret/recovery evidence remains unproven by this local slice.

## Next Slice

Run current-checkout DB-mutating workflow E2E against the already-prepared local disposable E2E database with `ALLOW_DB_E2E=true`, then update this evidence set and the status index.
