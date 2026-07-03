# Slice 5G - Focused Publishable Changeset

Date: 2026-07-02.

Scope: prepare a focused reviewable changeset for the setup-completion hardening, regression coverage, and launch evidence/status docs. This slice did not deploy, restart, SSH, open a database shell, mutate production data, run DB-mutating E2E against production, or access secret values.

## Commands

| Command | Result | Notes |
| --- | --- | --- |
| `git branch --list codex/setup-gate-launch-proof` | Passed | Confirmed the target branch did not already exist. |
| `git switch -c codex/setup-gate-launch-proof` | Passed | Created and switched to focused branch `codex/setup-gate-launch-proof` from `origin/main` commit `f5b0849037a55e2c99a3d781d742ba85d2384d8c`. |
| `git add <focused files>` | Passed | Staged launch/setup files only: setup-gate hardening, regression test, launch evidence script, launch proof/status docs, live proof register, and launch evidence files. |
| `git diff --cached --name-status` | Passed | Confirmed the staged set excludes unrelated `.env.example` and `server/ota-adapters/booking-com.mjs` Booking.com selector changes. |
| `git diff --cached --check` | Passed | No staged whitespace errors. |
| `git diff --cached -- .env.example server/ota-adapters/booking-com.mjs` | Passed | Produced no output, confirming those unrelated files are not staged. |
| `npm.cmd run launch:evidence` | Passed | Ran on branch `codex/setup-gate-launch-proof`, found 12 launch evidence files, and found no high-confidence unredacted production secret-shaped values in 442 tracked/unignored text files. |
| `git diff --check` | Passed | Exited 0. No whitespace errors were reported. |

## Focused Staged Files

- `package.json`
- `scripts/launch-evidence.mjs`
- `server/pms-service.mjs`
- `scripts/run-business-tests.mjs`
- `docs/launch/CURRENT_STATUS_INDEX.md`
- `docs/launch/LAUNCH_PROOF_MATRIX.md`
- `docs/live-environment-proof.md`
- `docs/launch/evidence/2026-07-02-slice-0-validation.md`
- `docs/launch/evidence/2026-07-02-slice-1-db-e2e.md`
- `docs/launch/evidence/2026-07-02-slice-2-auth-unauthenticated.md`
- `docs/launch/evidence/2026-07-02-slice-3-live-render-proof.md`
- `docs/launch/evidence/2026-07-02-slice-4-launch-packet-evidence-command.md`
- `docs/launch/evidence/2026-07-02-slice-5a-local-secret-hygiene.md`
- `docs/launch/evidence/2026-07-02-slice-5b-current-checkout-launch-check.md`
- `docs/launch/evidence/2026-07-02-slice-5c-render-room-inventory-proof-attempt.md`
- `docs/launch/evidence/2026-07-02-slice-5d-live-deploy-drift-reprobe.md`
- `docs/launch/evidence/2026-07-02-slice-5e-origin-sync-deploy-boundary.md`
- `docs/launch/evidence/2026-07-02-slice-5f-current-checkout-launch-check-after-sync.md`
- `docs/launch/evidence/2026-07-02-slice-5g-focused-publishable-changeset.md`

## Excluded Local Work

The following local changes remain intentionally unstaged and are not part of the setup-gate launch-proof changeset:

- `.env.example`
- `server/ota-adapters/booking-com.mjs`

Those changes relate to Booking.com selector configuration and are not required to prove or deploy the setup-completion gate hardening.

## Evidence Decision

The setup-completion hardening is now isolated on a focused `codex/` branch for review. A production deploy still must wait for an intentional push/PR/deploy decision and must deploy the exact reviewed commit before the public setup-complete reprobe can close the live setup-gate blocker.

## Remaining P0 Blockers

- Live setup-completion hardening still needs the focused changeset pushed/reviewed, deployed, and reprobed.
- Production users/auth/RBAC/logout proof remains open.
- Real production room inventory proof remains open.
- Core hotel workflow proof remains open.
- Live provider secret inventory/rotation metadata and recovery ownership proof remain external/account-owner evidence gaps.
- Rollback owner/deputy, database recovery owner, and WAF/rate-limit rule evidence remain unproven.

## Next Recommended Slice

Push the focused branch, open a review path, then deploy the exact reviewed commit to `sandbox-hotel-pms-v43m` only after approval. After deployment, rerun the unauthenticated setup-complete probe against `https://book.sandboxhotel.com`.
