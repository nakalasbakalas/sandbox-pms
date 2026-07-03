# Current Checkout Launch Gate Results

Status date: 2026-07-02.

Verdict: current-checkout local launch gate is green. This proves local engineering gate health for the current checkout, not production/account-owner launch sign-off.

## Scope

- Branch: `codex/setup-gate-launch-proof`.
- Commit: `75810c3fbcf73d6f8a790a607beb3bb3b0bf69a0`.
- Worktree: dirty with launch evidence/status docs and unrelated pre-existing `.env.example` plus `server/ota-adapters/booking-com.mjs` changes.
- Production posture: no deploy, restart, SSH session, production database shell, production mutation, DB-mutating E2E against production, or secret-value access was performed.
- DB-mutating E2E posture: not run by `launch:check`; the gate confirmed it remains blocked unless `ALLOW_DB_E2E=true`.

## Command

| Command | Result | Notes |
| --- | --- | --- |
| `npm.cmd run launch:check` | Passed | Completed all launch-check subcommands in the current checkout. |

## Launch Check Subcommands

| Subcommand | Result | Evidence Summary |
| --- | --- | --- |
| `npm.cmd run db:generate` | Passed | Prisma Client v6.19.3 generated successfully. |
| `npm.cmd run db:doctor` | Passed | `DATABASE_URL` and `E2E_DATABASE_URL` were configured to local `localhost:55432` databases; connectivity and migrate status were ok for both. The script redacted the password in URL output. |
| `npm.cmd run lint` | Passed | ESLint completed without reported errors. |
| `npm.cmd run typecheck` | Passed | `tsc -b --noEmit` completed successfully. |
| `npm.cmd test` | Passed | Business rule tests passed. |
| `npm.cmd run test:e2e` | Passed | Documentation link smoke, internal worker route smoke, Playwright browser smoke, and E2E contract/browser smoke checks passed. DB-mutating workflow E2E was not requested. |
| `npm.cmd run build` | Passed | Typecheck and Vite production build passed. |
| `npm.cmd audit --audit-level=high` | Passed threshold | npm reported one moderate `js-yaml` advisory; the high audit threshold passed. |
| `npx.cmd prisma migrate status` | Passed | Local `sandbox_hotel_dev` schema was up to date with 11 migrations. |

## Evidence Decision

The current checkout passes the authoritative local launch gate after the Slice 5I-5O evidence and status updates. This supports current local engineering readiness.

This does not close launch sign-off because several P0 items require live/account-owner proof:

- Production users/auth/RBAC/logout/unauthorized-access proof.
- Live setup-completion hardening deployment and reprobe.
- Real production room inventory proof.
- Staging or controlled production-like core workflow acceptance.
- Redacted live secret key inventory/rotation metadata and owner confirmation.
- Named rollback/deputy/database recovery owners.
- WAF/rate-limit rule IDs, thresholds, and owner-approved test evidence.

## Next Recommended Slice

Capture account-owner proof for production auth/RBAC, room inventory, secrets, recovery ownership, and WAF/rate-limit rules. If owner-gated proof is not available, review/approve PR #150, deploy the exact reviewed commit to `sandbox-hotel-pms-v43m`, and rerun the setup-complete unauthenticated probe.
