# Launch Current Status Index

Status date: 2026-07-02.

Verdict: not launch-signed-off. Slice 5V moved PR #150 from draft to ready for review, and GitHub CI is green for head `e2ee2bd8a84edc485e2270c985918ae78a7709ee`. PR #150 still has no review approval and is not deployed to the custom-domain Render service. Production/account-owner P0 proof remains open.

## Latest Slice

| Slice | Status | Evidence |
| --- | --- | --- |
| Slice 5V - PR ready for review | Completed; approval/deploy still open | [2026-07-02-slice-5v-pr-ready-for-review.md](evidence/2026-07-02-slice-5v-pr-ready-for-review.md) |
| Slice 5U - evidence publish and PR CI refresh | Completed; PR CI green, not live proof | [2026-07-02-slice-5u-evidence-publish-ci.md](evidence/2026-07-02-slice-5u-evidence-publish-ci.md) |
| Slice 5T - Render PSQL command-shape reprobe | Completed; room inventory proof still blocked | [2026-07-02-slice-5t-render-psql-command-shape.md](evidence/2026-07-02-slice-5t-render-psql-command-shape.md) |
| Slice 5S - PR and live setup-gate refresh | Completed; setup-gate P0 still blocked | [2026-07-02-slice-5s-pr-live-setup-refresh.md](evidence/2026-07-02-slice-5s-pr-live-setup-refresh.md) |
| Slice 5R - Render DB query path reprobe | Completed; room inventory proof still blocked | [2026-07-02-slice-5r-render-db-query-reprobe.md](evidence/2026-07-02-slice-5r-render-db-query-reprobe.md) |
| Slice 5Q - P0 owner-proof handoff | Completed; not closure proof | [P0_OWNER_PROOF_HANDOFF.md](evidence/P0_OWNER_PROOF_HANDOFF.md) |
| Slice 5P - current-checkout launch gate refresh | Completed locally | [LAUNCH_GATE_RESULTS.md](evidence/LAUNCH_GATE_RESULTS.md) |
| Slice 5O - secret/recovery/WAF provider posture | Partial; owner/provider proof still open | [WAF_PROVIDER_POSTURE.md](evidence/WAF_PROVIDER_POSTURE.md) |
| Slice 5N - auth/RBAC proof audit | Partial; production credentialed proof still open | [AUTH_RBAC_PROOF.md](evidence/AUTH_RBAC_PROOF.md) |
| Slice 5M - core hotel workflow local proof | Completed locally; production-like acceptance still open | [HOTEL_WORKFLOW_PROOF.md](evidence/HOTEL_WORKFLOW_PROOF.md) |
| Slice 5L - production room inventory proof audit | Completed; proof still blocked | [ROOM_INVENTORY_PROOF.md](evidence/ROOM_INVENTORY_PROOF.md) |
| Slice 5K - PR proof comment | Completed; PR head unchanged | [2026-07-02-slice-5k-pr-proof-comment.md](evidence/2026-07-02-slice-5k-pr-proof-comment.md) |
| Slice 5J - read-only Render and live refresh | Completed; blocker still open | [2026-07-02-slice-5j-render-live-refresh.md](evidence/2026-07-02-slice-5j-render-live-refresh.md) |
| Slice 5I - PR CI green | Completed; local evidence only | [2026-07-02-slice-5i-pr-ci-green.md](evidence/2026-07-02-slice-5i-pr-ci-green.md) |
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
| Current-checkout `launch:check` | Green locally for current dirty checkout | Slice 5P reran `npm.cmd run launch:check` on branch `codex/setup-gate-launch-proof` at commit `75810c3...` after the Slice 5I-5O evidence/status updates. |
| PR #150 CI | Green for head `e2ee2bd...`; ready for review | Slice 5U pushed docs-only evidence commit `e2ee2bd...` and GitHub Actions run `28575335525` completed successfully, including lint, typecheck, business tests, E2E smoke, build, and launch gate. Slice 5V marked PR #150 ready for review; it remains `OPEN`, `isDraft=false`, merge state `CLEAN`, with no review approval recorded. |
| Live health check | Green | Slice 5J refreshed `npm.cmd run live:check` against the custom domain; LINE remains optional and unconfigured. |
| DB-mutating E2E workflow | Green locally for current checkout before sync | Guarded local E2E prep and `npm.cmd run test:e2e:db` passed with `ALLOW_DB_E2E=true` against `sandbox_hotel_e2e` on `localhost:55432`. This is local disposable proof, not production proof; rerun if deployable code changes. |
| Core hotel workflow proof | Partial local proof | `HOTEL_WORKFLOW_PROOF.md` records fresh `npm.cmd test`, guarded local `db:e2e:ready`, and guarded local `test:e2e:db` passes against `localhost:55432/sandbox_hotel_e2e`. This is local disposable proof only; staging or controlled production-like/manual acceptance remains open. |
| Real production room inventory | Blocked by tooling/access | `ROOM_INVENTORY_PROOF.md` records the canonical inventory proof state. Slice 5T confirmed local `psql` exists and Render CLI non-interactive command shapes were tested, but every supported `render psql --command` variant still returned no stdout for valid and invalid read-only probes. Shell `RENDER_API_KEY`, `DATABASE_URL`, and `E2E_DATABASE_URL` were absent, and this session could not list/add MCP servers through the local `codex` executable. No production inventory counts are recorded. |
| Production users/auth/RBAC/logout | Partial; production credentialed proof open | `AUTH_RBAC_PROOF.md` records fresh local `npm.cmd test`, non-mutating `npm.cmd run test:e2e`, and live unauthenticated protected API denial for representative reads/mutations. It does not include an approved production user list, credentialed production login/logout, role-by-role production matrix, or bootstrap-removal proof. |
| Live unauthenticated protected API denial | Representative endpoints green; refreshed in Slice 5N | Live probes without credentials returned `401 Authentication is required` for protected reads and writes including auth/me, rooms, reservations, payments, users, room setup, and Hotel Ops commands. |
| Live first-run setup completion gate | Blocked by live behavior | Slice 5S confirmed `GET /api/setup/status` reports `needsSetup=false`, `hasProperty=true`, and `hasUsers=true`, but unauthenticated `POST /api/setup/complete` with empty JSON still returns setup-payload validation (`400 Add at least one room type.`). The hardening is in PR #150 with green CI for `e2ee2bd...`, and the PR is now ready for review, but it is not approved or deployed. |
| Render production service metadata | Refreshed read-only | Slice 5S confirmed long-term service `sandbox-hotel-pms-v43m` is live on deploy `dep-d8i4q3favr4c73afbrg0`, commit `7adcc01c...`; alternate `sandbox-hotel-pms` is live on deploy `dep-d8ekph4p3tds738mdp6g`, commit `7adcc01c...`; PR #150 head is `75810c3...` and `origin/main` is `f5b0849...`. |
| Local repository secret hygiene | Green locally | `npm.cmd run launch:evidence` found no high-confidence unredacted production secret-shaped values in tracked/unignored text files in the latest completed run. This is local worktree proof, not provider secret inventory or rotation proof. |
| Secret/recovery/WAF provider posture | Partial; owner-gated gaps remain | `WAF_PROVIDER_POSTURE.md` refreshes safe Render workspace/project/environment/deploy metadata, public-edge probes, and the current health-checked live deploy reference. Secret rotation metadata, named rollback/deputy/database recovery owners, and upstream WAF/rate-limit rule IDs remain unproven. |
| P0 owner-proof handoff | Ready for owner/provider evidence intake | `P0_OWNER_PROOF_HANDOFF.md` lists the exact redacted evidence needed for production users/auth/RBAC/logout, real room inventory, production-like workflow acceptance, DB E2E acceptance, PR #150 deployment/reprobe, secrets/recovery, and WAF/rate-limit proof. This file is not closure evidence by itself. |
| Live deploy drift | Open | Slice 5V confirmed PR #150 head is `e2ee2bd...`; `origin/main` is `f5b0849...`; long-term live service and alternate service are still on `7adcc01c...`. The setup-gate hardening is in PR #150 and ready for review; deploying `origin/main` alone would not close the setup-gate blocker. |
| Audit threshold | High threshold green in Slice 5P | `launch:check` passed `npm.cmd audit --audit-level=high`; npm reported one moderate `js-yaml` advisory below the high threshold. |

## Remaining P0 Blockers

- Production users/auth/RBAC/logout/unauthorized-access proof is only partially recorded: local RBAC and live unauthenticated denial are proven, but approved production users, credentialed production login/logout, role matrix, and bootstrap-removal evidence are still open.
- Live first-run setup completion gate needs the local hardening published, deployed, and reprobed.
- Real production room inventory proof is still not recorded; the Render CLI `psql` path did not return usable query output and unauthenticated live room-count endpoints are correctly protected.
- Core hotel workflow proof now has local disposable DB evidence, but staging or controlled production-like/manual acceptance is still not recorded.
- Production secret hygiene has local repository proof, but live secret key inventory/rotation metadata and owner confirmation remain account-owner/provider evidence gaps.
- Recovery/rollback proof is partially refreshed with the current health-checked live deploy ID, but rollback owner/deputy and database recovery owner remain unnamed.
- Upstream WAF/rate-limit rule IDs, thresholds, and owner-approved non-destructive rate-limit test evidence remain unproven.

## Next Recommended Slice

Use `P0_OWNER_PROOF_HANDOFF.md` to collect account-owner proof for production auth/RBAC, room inventory, workflow acceptance, secrets/recovery ownership, and WAF/rate-limit rules. For room inventory specifically, use Render MCP/API query tooling, Render dashboard connection details without printing the raw URL, a redacted dashboard/export, or credentialed PMS admin proof rather than the current CLI `psql` path. If owner-gated proofs are not available, review/approve PR #150, deploy the exact reviewed commit to `sandbox-hotel-pms-v43m`, and rerun the setup-complete unauthenticated probe.
