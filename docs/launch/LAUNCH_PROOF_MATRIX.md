# Launch Proof Matrix

Status date: 2026-07-02.

Verdict: not launch-signed-off. This matrix separates confirmed evidence from open production/account-owner proof. Do not treat this file as proof by itself; each row must link to command output, redacted provider metadata, or manual acceptance evidence.

## P0 Matrix

| Area | Status | Current Evidence | Evidence Required To Close |
| --- | --- | --- | --- |
| Launch packet, index, and evidence command | Green locally | `docs/launch/CODEX_LAUNCH_FINISH_PACKET.md`, this matrix, `docs/launch/CURRENT_STATUS_INDEX.md`, `scripts/collect-launch-evidence.mjs` from `origin/main`, and local `npm.cmd run launch:evidence` through `scripts/launch-evidence.mjs`. | Keep docs current after each slice. |
| Current-checkout local launch gate | Green locally after origin sync | `docs/launch/evidence/2026-07-02-slice-5f-current-checkout-launch-check-after-sync.md`; `npm.cmd run launch:check` passed after fast-forwarding to `origin/main` `f5b0849...` and reapplying local launch/setup-gate changes. | Rerun before release if code, dependencies, migrations, or environment assumptions change. |
| DB-mutating E2E posture | Green locally with caveat | `docs/launch/evidence/2026-07-02-slice-1-db-e2e.md`. | Keep proof tied to disposable/staging `E2E_DATABASE_URL`; never production. |
| Live unauthenticated protected API denial | Representative endpoints green | `docs/launch/evidence/2026-07-02-slice-2-auth-unauthenticated.md`. | Add credentialed production role matrix before sign-off. |
| Live first-run setup completion gate | Blocked until review/deploy/reprobe | Draft PR #150 contains the completed-setup rejection hardening and evidence docs, but live services remain on older commits and unauthenticated setup-complete still returns payload validation; see `docs/launch/evidence/2026-07-02-slice-5d-live-deploy-drift-reprobe.md`, `docs/launch/evidence/2026-07-02-slice-5e-origin-sync-deploy-boundary.md`, `docs/launch/evidence/2026-07-02-slice-5g-focused-publishable-changeset.md`, and `docs/launch/evidence/2026-07-02-slice-5h-draft-pr-review-path.md`. | Approved review/deploy evidence plus public unauthenticated setup-complete reprobe showing rejection before payload validation. |
| Production users/auth/RBAC/logout | Open | No current redacted role-by-role proof recorded. | Approved production user list, login/logout proof, role matrix, protected page denial, protected API mutation denial. |
| Real production room inventory | Open; latest read-only query path blocked | `docs/launch/evidence/2026-07-02-slice-5c-render-room-inventory-proof-attempt.md` records a failed/inconclusive Render CLI aggregate-query attempt. No production inventory counts were recorded. | Import/onboarding evidence for real room types/rooms, source owner, and no fake seed inventory, gathered through a reliable approved path such as Render MCP query, redacted dashboard/export, working non-interactive `psql`, or credentialed PMS admin room-setup proof. |
| Core hotel workflow acceptance | Open | Local business tests pass, but no staging/production-like operational acceptance is recorded. | Dated workflow evidence for reservation creation, invalid date rejection, room assignment safety, check-in/out, payment/folio, housekeeping, and audit/timeline entries. |
| Secret hygiene and live secret evidence | Partial/open | Runtime behavior proves a session secret exists; provider metadata did not expose safe rotation timestamps. Values were not accessed. | Redacted Render secret key inventory, rotation dates where available, cleanup decision for legacy key names, and owner confirmation. |
| Recovery, rollback, and WAF ownership | Open | Disposable restore test is recorded in `docs/live-environment-proof.md`; named owner/deputy and WAF/rate-limit IDs are not recorded. | Named rollback owner/deputy, database recovery owner, latest known-good deploy ID, WAF/rate-limit rule IDs, thresholds, and non-destructive test result. |

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
