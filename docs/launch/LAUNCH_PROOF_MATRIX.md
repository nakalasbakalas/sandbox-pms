# Launch Proof Matrix

Status date: 2026-07-02.

Verdict: not launch-signed-off. This matrix separates confirmed evidence from open production/account-owner proof. Do not treat this file as proof by itself; each row must link to command output, redacted provider metadata, or manual acceptance evidence.

## P0 Matrix

| Area | Status | Current Evidence | Evidence Required To Close |
| --- | --- | --- | --- |
| Launch packet, index, and evidence command | Green locally | `docs/launch/CODEX_LAUNCH_FINISH_PACKET.md`, this matrix, `docs/launch/CURRENT_STATUS_INDEX.md`, `scripts/collect-launch-evidence.mjs` from `origin/main`, and local `npm.cmd run launch:evidence` through `scripts/launch-evidence.mjs`. | Keep docs current after each slice. |
| Current-checkout local launch gate | Green locally for current dirty checkout | `docs/launch/evidence/LAUNCH_GATE_RESULTS.md`; `npm.cmd run launch:check` passed on branch `codex/setup-gate-launch-proof` at commit `75810c3...` after the Slice 5I-5O evidence/status updates. | Rerun before release if code, dependencies, migrations, or environment assumptions change. |
| DB-mutating E2E posture | Green locally with caveat | `docs/launch/evidence/2026-07-02-slice-1-db-e2e.md`. | Keep proof tied to disposable/staging `E2E_DATABASE_URL`; never production. |
| Live unauthenticated protected API denial | Representative endpoints green | `docs/launch/evidence/2026-07-02-slice-2-auth-unauthenticated.md`; `docs/launch/evidence/AUTH_RBAC_PROOF.md` refreshed live unauthenticated protected read/write probes against `https://book.sandboxhotel.com`. | Add credentialed production role matrix before sign-off. |
| Live first-run setup completion gate | Blocked until review/deploy/reprobe | Draft PR #150 contains the completed-setup rejection hardening and has green CI on head SHA `75810c3...`, but Slice 5S reconfirmed the PR is still draft with no review approval recorded, the live custom-domain service remains on deploy `dep-d8i4q3favr4c73afbrg0` at commit `7adcc01c...`, and unauthenticated setup-complete still returns payload validation. See `docs/launch/evidence/2026-07-02-slice-5d-live-deploy-drift-reprobe.md`, `docs/launch/evidence/2026-07-02-slice-5e-origin-sync-deploy-boundary.md`, `docs/launch/evidence/2026-07-02-slice-5g-focused-publishable-changeset.md`, `docs/launch/evidence/2026-07-02-slice-5h-draft-pr-review-path.md`, `docs/launch/evidence/2026-07-02-slice-5i-pr-ci-green.md`, `docs/launch/evidence/2026-07-02-slice-5j-render-live-refresh.md`, `docs/launch/evidence/2026-07-02-slice-5k-pr-proof-comment.md`, and `docs/launch/evidence/2026-07-02-slice-5s-pr-live-setup-refresh.md`. | Approved review/deploy evidence plus public unauthenticated setup-complete reprobe showing rejection before payload validation. |
| Production users/auth/RBAC/logout | Partial; credentialed production proof open | `docs/launch/evidence/AUTH_RBAC_PROOF.md` records local username-first auth/RBAC tests, non-mutating E2E browser/contract smoke, and live unauthenticated protected API denial. | Approved production user list, credentialed production login/logout proof, production role matrix, protected page denial for an underprivileged role, protected API mutation denial for an underprivileged role, and bootstrap/setup-token removal or rotation evidence. |
| Real production room inventory | Open; latest read-only query path blocked | `docs/launch/evidence/ROOM_INVENTORY_PROOF.md` records the canonical inventory proof state. `docs/launch/evidence/2026-07-02-slice-5r-render-db-query-reprobe.md` and `docs/launch/evidence/2026-07-02-slice-5t-render-psql-command-shape.md` narrow the current blocker: local `psql` exists, Render CLI v2.13.0 can see the production datastore and documents non-interactive `psql`, but supported `render psql --command` variants return no stdout for known-good and invalid read-only probes. Shell `RENDER_API_KEY`, `DATABASE_URL`, and `E2E_DATABASE_URL` are absent; no Render MCP query tool is callable in this session. Unauthenticated live `/api/rooms` and `/api/today` return `401`; no production inventory counts were recorded. | Import/onboarding evidence for real room types/rooms, source owner, and no fake seed inventory, gathered through a reliable approved path such as Render MCP/API query tooling, Render dashboard connection details used without printing raw URLs, redacted dashboard/export, or credentialed PMS admin room-setup proof. |
| Core hotel workflow acceptance | Partial local proof; staging/production-like acceptance open | `docs/launch/evidence/HOTEL_WORKFLOW_PROOF.md` records fresh `npm.cmd test`, guarded local `db:e2e:ready`, and guarded local `test:e2e:db` passes against `localhost:55432/sandbox_hotel_e2e`. | Staging or controlled production-like/manual evidence for reservation creation/update/cancel, invalid date rejection, room assignment safety, check-in/out, payment/folio, housekeeping, and audit/timeline entries. |
| Secret hygiene and live secret evidence | Partial/open | Runtime behavior proves a session secret exists; local `launch:evidence` scans remain green; `docs/launch/evidence/WAF_PROVIDER_POSTURE.md` records safe Render metadata and the boundary that CLI commands used here do not expose secret key inventory or rotation timestamps. Values were not accessed. | Redacted Render secret key inventory, rotation dates where available, cleanup decision for legacy key names, and owner confirmation. |
| Recovery, rollback, and WAF ownership | Partial/open | Disposable restore test is recorded in `docs/live-environment-proof.md`; `docs/launch/evidence/WAF_PROVIDER_POSTURE.md` refreshes the current health-checked live deploy ID and public-edge probes. Named owner/deputy and WAF/rate-limit IDs are still not recorded. | Named rollback owner/deputy, database recovery owner, WAF/rate-limit rule IDs, thresholds, protected hostnames, and owner-approved non-destructive test result. |

Owner-proof intake aid: `docs/launch/evidence/P0_OWNER_PROOF_HANDOFF.md` lists the redacted evidence formats needed for the remaining P0 blockers. It is not closure proof by itself.

## Deferred Or Conditional Areas

| Area | Launch Posture | Proof Boundary |
| --- | --- | --- |
| LINE messaging | Optional/manual unless required by owner. | If required, record credentials configured, signed webhook verification, and send-test proof without exposing secrets. |
| OTA automation | iCal/manual metadata only. | No live Booking.com, Agoda, Expedia, Airbnb, or other OTA API/browser automation claim without adapter evidence, challenge handling, dry-run/default safety, and account-owner approval. |
| Payments | PMS-recorded payments only. | No live card, PromptPay, bank-transfer collection, or gateway claim without provider credentials, callback proof, reconciliation proof, and finance owner acceptance. |

## Proof Standards

- Evidence must be dated and point to a command, provider record, redacted screenshot/export, or manual acceptance note.
- Screenshots and logs must redact tokens, passwords, cookies, raw database URLs, private keys, and customer personal data.
- Local database proof must name the database target and confirm it is disposable or staging before any DB-mutating E2E command.
- Live proof must identify the public target, deploy ID or commit when available, and whether it proves behavior or only infrastructure metadata.
