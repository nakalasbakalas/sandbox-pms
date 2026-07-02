# Launch Current Status Index

Status date: 2026-07-02.

Verdict: not launch-signed-off. The local branch is now fast-forwarded to `origin/main` at `f5b0849037a55e2c99a3d781d742ba85d2384d8c`, but the setup-completion hardening remains an uncommitted local working-tree change. Production/account-owner P0 proof remains open.

## Latest Slice

| Slice | Status | Evidence |
| --- | --- | --- |
| Slice 5H - draft PR review path | Completed; review path open | [2026-07-02-slice-5h-draft-pr-review-path.md](evidence/2026-07-02-slice-5h-draft-pr-review-path.md) |
| Slice 5G - focused publishable changeset | Completed locally | [2026-07-02-slice-5g-focused-publishable-changeset.md](evidence/2026-07-02-slice-5g-focused-publishable-changeset.md) |
| Slice 5F - current-checkout launch check after origin sync | Completed locally | [2026-07-02-slice-5f-current-checkout-launch-check-after-sync.md](evidence/2026-07-02-slice-5f-current-checkout-launch-check-after-sync.md) |
| Slice 5E - origin sync and deploy boundary | Completed; deploy still blocked | [2026-07-02-slice-5e-origin-sync-deploy-boundary.md](evidence/2026-07-02-slice-5e-origin-sync-deploy-boundary.md) |
| Slice 5D - live deploy drift and setup-gate reprobe | Completed; blocker confirmed | [2026-07-02-slice-5d-live-deploy-drift-reprobe.md](evidence/2026-07-02-slice-5d-live-deploy-drift-reprobe.md) |
| Slice 5C - Render room inventory proof attempt | Completed; proof still blocked | [2026-07-02-slice-5c-render-room-inventory-proof-attempt.md](evidence/2026-07-02-slice-5c-render-room-inventory-proof-attempt.md) |
| Slice 5B - current-checkout launch check refresh | Completed locally | [2026-07-02-slice-5b-current-checkout-launch-check.md](evidence/2026-07-02-slice-5b-current-checkout-launch-check.md) |
| Slice 5A - local secret hygiene evidence | Completed locally | [2026-07-02-slice-5a-local-secret-hygiene.md](evidence/2026-07-02-slice-5a-local-secret-hygiene.md) |
| Slice 4 - launch packet and evidence-command restoration | Completed locally | [2026-07-02-slice-4-launch-packet-evidence-command.md](evidence/2026-07-02-slice-4-launch-packet-evidence-command.md) |
| Slice 3 - read-only live Render metadata refresh | Completed with external proof gaps | [2026-07-02-slice-3-live-render-proof.md](evidence/2026-07-02-slice-3-live-render-proof.md) |
| Slice 2 - live unauthenticated auth denial and setup-gate hardening | Partial; live blocker found | [2026-07-02-slice-2-auth-unauthenticated.md](evidence/2026-07-02-slice-2-auth-unauthenticated.md) |
| Slice 1 - guarded DB-mutating E2E posture | Completed locally with caveats | [2026-07-02-slice-1-db-e2e.md](evidence/2026-07-02-slice-1-db-e2e.md) |
| Slice 0 - fresh local evidence and launch-gate unblock | Completed locally with caveats | [2026-07-02-slice-0-validation.md](evidence/2026-07-02-slice-0-validation.md) |

## Current Gate Status

| Area | Current status | Notes |
| --- | --- | --- |
| Launch packet files | Present on `origin/main`; locally updated | `origin/main` now contains the launch packet docs from PR #149. Local status/proof docs have been updated with Slice 5A-5E evidence. |
| `launch:evidence` script | Green locally | Local `package.json` keeps `launch:evidence` pointed at `scripts/launch-evidence.mjs` so the evidence inventory and secret-hygiene gate still runs. Upstream `scripts/collect-launch-evidence.mjs` remains available as a snapshot helper. |
| Local database migration state | Green after remediation | `npm.cmd run db:migrate` applied `20260702053000_add_whatsapp_message_channel` and `20260702064500_hotel_ops_scan_snapshots` to `sandbox_hotel_dev`; guarded `npm.cmd run db:e2e:ready` applied and seeded local `sandbox_hotel_e2e`. |
| Current-checkout `launch:check` | Green locally after origin sync | Slice 5F reran `npm.cmd run launch:check` on local `main` fast-forwarded to `origin/main` at `f5b0849...` with the local launch/setup-gate changes reapplied. |
| Live health check | Green | Slice 5D refreshed `npm.cmd run live:check` against the custom domain, `sandbox-hotel-pms.onrender.com`, and `sandbox-hotel-pms-v43m.onrender.com`. |
| DB-mutating E2E workflow | Green locally for current checkout before sync | Guarded local E2E prep and `npm.cmd run test:e2e:db` passed with `ALLOW_DB_E2E=true` against `sandbox_hotel_e2e` on `localhost:55432`. This is local disposable proof, not production proof; rerun if deployable code changes. |
| Real production room inventory | Blocked by tooling | Slice 5C attempted a read-only aggregate query through Render CLI. The local `psql` PATH issue was fixed for that process, but `render psql` returned empty output even for `select 1` and a deliberately invalid read query, so no production inventory proof was recorded. |
| Live unauthenticated protected API denial | Representative endpoints green | Live probes without credentials returned `401 Authentication is required` for representative protected reads and writes. |
| Live first-run setup completion gate | Blocked by live behavior | Slice 5D confirmed `GET /api/setup/status` reports `needsSetup=false` and `hasUsers=true`, but unauthenticated `POST /api/setup/complete` with empty JSON still returns setup-payload validation (`400 Add at least one room type.`). The hardening is in draft PR #150, but it is not deployed. |
| Render production service metadata | Refreshed read-only | Long-term service `sandbox-hotel-pms-v43m` is live on `7adcc01c...`; alternate `sandbox-hotel-pms` is live on `7adcc01c...`; launch service `sandbox-hotel-pms-launch` is live on `5f5b5416...`. |
| Local repository secret hygiene | Green locally | `npm.cmd run launch:evidence` found no high-confidence unredacted production secret-shaped values in tracked/unignored text files in the latest completed run. This is local worktree proof, not provider secret inventory or rotation proof. |
| Live deploy drift | Open | Local `origin/main` is `f5b0849...`; long-term live service and alternate service are still on `7adcc01c...`. The setup-gate hardening is in draft PR #150; deploying `origin/main` alone would not close the setup-gate blocker. |
| Audit threshold | High threshold green in Slice 5F | `launch:check` passed `npm.cmd audit --audit-level=high`; npm reported one moderate `js-yaml` advisory below the high threshold. |

## Remaining P0 Blockers

- Production users/auth/RBAC/logout/unauthorized-access proof is still not recorded for the target environment.
- Live first-run setup completion gate needs the local hardening published, deployed, and reprobed.
- Real production room inventory proof is still not recorded; the Render CLI `psql` path did not return usable query output in Slice 5C.
- Core hotel workflow proof is still not recorded for staging or controlled production-like acceptance.
- Production secret hygiene, secret rotation metadata, and recovery ownership proof remain external/account-owner evidence gaps.
- Live secret values were not accessed; secret key inventory/rotation timestamps remain dashboard/API evidence gaps.
- Rollback owner/deputy, database recovery owner, and WAF/rate-limit rule evidence remain unproven.

## Next Recommended Slice

Wait for PR #150 review/CI status or inspect GitHub checks. After approval, deploy the exact reviewed commit to `sandbox-hotel-pms-v43m` and rerun the setup-complete unauthenticated probe against `https://book.sandboxhotel.com`.
