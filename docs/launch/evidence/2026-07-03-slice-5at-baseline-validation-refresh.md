# Slice 5AT - Baseline Validation Refresh

Status date: 2026-07-03T09:50:07+07:00.

Verdict: completed locally. The non-destructive Slice 0 baseline validation ladder passed in the current checkout at commit `fbc303136253a9785446d601d5532b6efc523b8f`, and a final `npm.cmd run launch:check` retry also passed. This is local engineering and public-readiness proof only; it is not production/account-owner launch sign-off.

## Scope

- Branch: `codex/setup-gate-launch-proof`.
- Commit: `fbc303136253a9785446d601d5532b6efc523b8f`.
- Worktree: dirty with prior launch evidence/status docs, plus unrelated pre-existing `.env.example` and `server/ota-adapters/booking-com.mjs` changes.
- No deploy, restart, SSH session, production database shell, production mutation, DB-mutating E2E, credentialed production login, screenshot capture, or secret-value access was performed.
- DB-mutating E2E was intentionally not run in this slice. `npm.cmd run db:doctor` confirmed it remains blocked unless `ALLOW_DB_E2E=true` is set, and the configured E2E target is the local `localhost:55432/sandbox_hotel_e2e` database.

## Commands

| Command | Result | Evidence Summary |
| --- | --- | --- |
| `npm.cmd run launch:evidence` | Passed | Required launch docs and evidence files were present; launch evidence secret hygiene found no unredacted secret-shaped values; current-tree scan found no high-confidence unredacted production secret-shaped values. |
| `npm.cmd run db:doctor` | Passed | Local `DATABASE_URL` and local `E2E_DATABASE_URL` were configured; Prisma validate, connectivity, and migrate status passed for both. DB-mutating E2E remained blocked without `ALLOW_DB_E2E=true`. |
| `npm.cmd run typecheck` | Passed | `tsc -b --noEmit` completed successfully. |
| `npm.cmd run lint` | Passed | ESLint completed without reported errors. |
| `npm.cmd test` | Passed | Business rule tests passed. |
| `npm.cmd run build` | Passed | Build ran typecheck and completed the Vite production build successfully. |
| `npm.cmd run prod:preflight` | Passed | Passed with expected warning that LINE credentials are not configured and live LINE messaging remains disabled. |
| `npm.cmd run render:validate` | Passed | Render Blueprint validation returned `valid: true` with two planned actions. |
| `npm.cmd run live:check` | Passed | `https://book.sandboxhotel.com` passed live readiness; `lineWebhookConfigured=false` remains informational unless LINE is required. DNS resolved to `216.24.57.8`. |
| `git diff --check` | Passed | Exit code 0. Git reported line-ending normalization warnings only. |

## Current-Checkout Launch Gate Retry

After the baseline docs/evidence updates, `npm.cmd run launch:check` was rerun to verify the final checkout state. The first two attempts did not provide closure, but the final retry passed:

| Command | Result | Evidence Summary |
| --- | --- | --- |
| `npm.cmd run launch:check` | Failed/inconclusive | First attempt hit the 5-minute tool timeout before returning command output. No production mutation was involved. |
| `npm.cmd run launch:check` | Failed | Second attempt reached `npm.cmd run test:e2e` and failed with `page.waitForFunction: Timeout 20000ms exceeded` in `assertProtectedRouteAccess` at `scripts/run-e2e-tests.mjs:351`. This was a non-mutating browser smoke failure. |
| `npm.cmd run test:e2e` | Failed/inconclusive | Direct retry hit the 5-minute tool timeout before returning command output. |
| PowerShell-managed `npm.cmd run test:e2e` | Passed | Completed documentation link smoke, internal worker route smoke, Playwright browser smoke, and E2E contract/browser smoke checks in about 292 seconds. DB-mutating workflow E2E was not requested. |
| `npm.cmd run launch:check` | Passed | Final retry completed `db:generate`, `db:doctor`, lint, typecheck, business-rule tests, non-mutating E2E, build, high-threshold audit, and Prisma migrate status in about 595 seconds. `npm audit --audit-level=high` passed with one moderate `js-yaml` advisory below the high threshold. |
| `npm.cmd run launch:check` | Passed | Follow-up rerun after the final Slice 5AT evidence wording/link edits passed in about 525 seconds with the same non-mutating scope and audit posture. |

The observed non-mutating E2E timeout is residual flake/latency risk for the launch gate, but it did not persist after retry and no validation gate was weakened.

## Evidence Decision

The current checkout still has a green local baseline validation posture and a final green `launch:check` result after retry. This reinforces the Slice 5AS launch-gate result but does not close P0 items that require provider evidence or account-owner approval.

Remaining P0 blockers after this slice:

- Production users/auth/RBAC/logout/unauthorized-access proof.
- Live setup-completion hardening approval, deploy, and public reprobe.
- Real production room inventory proof.
- Staging or controlled production-like core workflow acceptance, if required by the owner.
- Redacted live secret key inventory/rotation metadata and owner confirmation.
- Named rollback/deputy/database recovery owners plus latest recovery-point/retention proof.
- WAF/rate-limit rule IDs, thresholds, and owner-approved non-destructive test evidence.

## Next Recommended Slice

Use the existing PR #150 approval/deploy/reprobe handoff to get the setup-gate hardening reviewed and deployed, or collect the owner/provider proof listed in `P0_OWNER_PROOF_HANDOFF.md` for auth/RBAC, real room inventory, workflow acceptance, secrets/recovery, and WAF/rate-limit rules.
