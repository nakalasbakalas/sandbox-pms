# Codex Launch Finish Packet

Last updated: 2026-07-02

Use this as the first instruction packet for the next Codex run in `nakalasbakalas/sandbox-pms`. It is scoped to prevent another long, overloaded session. The repo already has launch-hardening evidence through 2026-06-15, but current launch sign-off still depends on proof-heavy operational work and a fresh green gate in the current checkout.

## Mission

Act as a coordinated launch team and finish only the work required to make Sandbox Hotel PMS launch-signoff ready. Do not expand into new product features unless a change directly satisfies `LAUNCH_CHECKLIST.md`, restores the local/live launch gate, or produces launch proof for a listed P0/P1 item.

The team roles are:

- Release lead: sequence work into small PRs, keep `LAUNCH_CHECKLIST.md` honest, update the current-status index, and stop after each gate.
- Backend/database engineer: fix migration-status, seed/import posture, room inventory readiness, E2E database safety, and data-integrity checks.
- Security engineer: verify auth, role access, session logout, unauthorized route/API denial, secret hygiene, credential rotation, and bootstrap removal.
- Hotel operations expert: validate the reservation, room-assignment, occupancy, folio, housekeeping, and audit/timeline workflows against real hotel operations.
- QA/E2E engineer: stabilize browser smoke, isolate DB-mutating E2E, and collect reproducible evidence.
- SRE/DevOps engineer: verify Render/live environment secrets, backups, rollback owners, recovery owners, WAF/rate-limit posture, and monitoring.
- Localization/tablet UX reviewer: verify Thai/English labels, empty states, demo-copy removal, front-desk flow, and housekeeping tablet usability.
- Documentation owner: produce concise proof artifacts and prevent stale docs from overstating readiness.

## Repo-specific facts

- This is the correct repo: `nakalasbakalas/sandbox-pms`.
- `LAUNCH_CHECKLIST.md` is the launch sign-off source of truth.
- Existing launch posture is documented in `README.md`, `docs/launch-scope-decisions.md`, and `docs/live-environment-proof.md`.
- `package.json` exposes the relevant gate commands: `db:doctor`, `db:e2e:ready`, `rooms:import`, `real-data:import`, `prod:preflight`, `render:validate`, `live:check`, `test:e2e`, `test:e2e:db`, and `launch:check`.
- The June 15 docs say `launch:check` passed then, but the current operator report says the latest current-checkout run is not green because `db:doctor` reports configured DB migrate-status failures/unavailability and DB-mutating E2E is blocked without `ALLOW_DB_E2E=true`. Treat the current report as fresher than old proof until rerun.
- `docs/live-environment-proof.md` already states what is still not proven: approved production users, current production room inventory, current Render secret rotation metadata, named rollback/deputy/recovery/WAF owners, upstream WAF/rate-limit rule IDs, and live provider send/charge evidence.

## Non-negotiable guardrails

1. Never commit production secrets, credential values, screenshots containing secrets, raw database URLs, access tokens, session cookies, or bootstrap passwords.
2. Do not run DB-mutating E2E against production. It must use an approved disposable/staging database and `ALLOW_DB_E2E=true`, or the launch owner must explicitly accept local-only proof.
3. Do not mark setup-required or seed-only inventory as production-ready inventory. Real inventory must be imported or configured through approved onboarding/import.
4. Prefer small, reviewable changes. One Codex run should complete one slice below, commit evidence, then stop.
5. Do not weaken launch gates to force green. If a gate is noisy, fix it or document a formal defer/accepted risk with owner, expiry, impact, and rollback path.
6. Do not invent provider readiness. LINE messaging, OTA automation, and payments must each be marked one of: `live`, `manual`, `disabled`, or `deferred`.
7. Any live-environment proof must be redacted and must identify environment, date, actor/owner, exact command/manual check, and pass/fail result.

## Current blocker summary

### P0 — must close before sign-off

- Prove production users and secure access path: approved real user list, username-first login, logout, intended roles, unauthorized route/API blocked, bootstrap rotated/removed.
- Prove production room inventory: real room set import/onboarding; setup-required state is not mistaken for production-ready inventory.
- Close core hotel workflow acceptance: reservation create/update/cancel, room assignment, blocked/occupied rejection, overbooking rejection, check-in, check-out, folio/payment balance, housekeeping transitions, audit/timeline evidence.
- Decide and record DB-mutating E2E posture: staging/disposable DB with `ALLOW_DB_E2E=true`, or explicit local-only proof acceptance.
- Finish secret hygiene and ownership proof: redacted secret inventory, rotation dates, no prod secrets in repo/logs/screenshots, named rollback/deputy/database recovery owners, tested rollback path.
- Re-run or repair local launch gating so `npm run launch:check` passes cleanly in the current checkout.
- Verify production secret and recovery evidence in the live environment, not only in docs.

### P1 — before guest-facing launch or formal defer

- Prove upstream WAF/rate-limit configuration: rule IDs, thresholds, protected hostnames, and a non-destructive test result.
- Lock provider posture decisions for LINE messaging, OTA automation, and payments.
- Fix or document browser cold-start instability if `scripts/run-e2e-tests.mjs` still times out at initial `page.goto`.
- Complete localization and tablet/manual ops acceptance: Thai/English labels, empty states, demo copy, front-desk flow, housekeeping tablet review.

### P2 — post-sign-off cleanup

- Keep a current-status index so stale “complete” docs do not overstate readiness.
- Reduce confidence risk from documentation sprawl across root-level completion/proof files.
- Review large frontend chunks after blockers close, especially `index`, `ReportsView`, and `SettingsView` if still large.
- Normalize line endings or explicitly accept current `git diff --check` warnings.

## Execution model: one slice per Codex run

Each slice includes an objective, allowed scope, required evidence, and stop condition. Complete only one slice per run unless every acceptance check in that slice is already green.

### Slice 0 — baseline snapshot and launch evidence scaffold

Objective: produce a fresh, redacted launch state without changing app behavior.

Allowed scope:

- Run non-destructive checks.
- Generate a launch evidence template with `npm run launch:evidence`.
- Fill only facts proven in the current checkout/environment.
- Update `docs/launch/CURRENT_STATUS_INDEX.md` with proved/blocked/deferred status.

Commands:

```bash
npm run launch:evidence
npm run db:doctor
npm run typecheck
npm run lint
npm test
npm run build
npm run prod:preflight
npm run render:validate
npm run live:check
git diff --check
```

Do not run DB-mutating E2E here unless an approved staging/disposable database is configured.

Evidence files:

- `docs/launch/evidence/LAUNCH_GATE_RESULTS.md`
- `docs/launch/evidence/DB_DOCTOR_RESULTS.md`
- `docs/launch/CURRENT_STATUS_INDEX.md`

Stop condition:

- A current status index exists and clearly states which P0/P1/P2 items are proved, blocked, or formally deferred.

### Slice 1 — local launch gate and database doctor repair

Objective: make current-checkout `npm run launch:check` green without hiding real DB safety failures.

Allowed scope:

- Fix local environment defaults, migrate-status invocation, test isolation, or documentation gaps.
- Improve error messages only if the underlying failure remains visible.
- Keep `db:doctor` strict for configured databases.

Required checks:

```bash
npm run db:generate
npm run db:doctor
npm run launch:check
```

If DB-mutating E2E is part of the gate, use only a safe DB:

```bash
ALLOW_DB_E2E=true E2E_DATABASE_URL="postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public" npm run db:e2e:ready
ALLOW_DB_E2E=true E2E_DATABASE_URL="postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public" npm run test:e2e:db
```

Acceptance:

- `DATABASE_URL` migrate status is clean for the intended local/staging target.
- `E2E_DATABASE_URL` is either clean and safe, or explicitly absent with DB-mutating E2E not claimed as complete.
- `launch:check` result is copied into `docs/launch/evidence/LAUNCH_GATE_RESULTS.md` with secrets redacted.

Stop condition:

- Gate is green, or one precise remaining root cause is documented with owner and next command.

### Slice 2 — production users, auth, RBAC, and secure access path

Objective: prove access is secure for real intended roles.

Allowed scope:

- Tests and small fixes for username-first login, logout/session clearing, route guards, API authorization, and admin/manager restrictions.
- Remove or rotate any bootstrap path only after replacement real users are confirmed.

Required proof:

- Approved real user list by role, redacted.
- Login verified for intended roles.
- Logout clears session and protected state.
- Unauthorized route access blocked.
- Unauthorized protected API mutation blocked.
- Bootstrap credential path rotated, disabled, or removed.

Evidence file:

- `docs/launch/evidence/AUTH_RBAC_PROOF.md`

Stop condition:

- Every Security section item in `LAUNCH_CHECKLIST.md` has a matching proof row, or a named blocker is documented.

### Slice 3 — production room inventory proof

Objective: ensure the system reflects the real room set and does not treat setup-required state as launch-ready.

Allowed scope:

- Room import/onboarding validation.
- Inventory readiness guard.
- Clear UI/API state distinction between setup-required and production-ready inventory.
- Tests for room counts/types/statuses if available.

Commands to consider:

```bash
npm run rooms:import -- --file ./ops/rooms.production.json --confirm
ALLOW_PROD_ROOM_ONBOARDING=true npm run rooms:import -- --file ./ops/rooms.production.json --confirm
npm run db:doctor
```

Required proof:

- Real room source approved by operations/property owner.
- Import/onboarding result count matches expected real room set.
- Room types and room numbers are redacted only if needed, but counts/status distribution are visible.
- Setup-required state cannot pass launch-ready checks.

Evidence file:

- `docs/launch/evidence/ROOM_INVENTORY_PROOF.md`

Stop condition:

- Production inventory is proved or launch remains explicitly blocked.

### Slice 4 — core hotel workflow acceptance

Objective: prove the PMS can operate a stay from booking to checkout with correct constraints and audit evidence.

Allowed scope:

- Tests and fixes for reservation lifecycle, assignment constraints, no-overbooking, check-in/out, folio/payment balance, housekeeping transitions, and audit/timeline.
- Small UI fixes only when needed for the flow to be operable.

Minimum acceptance matrix:

| Flow | Required result |
| --- | --- |
| Create reservation | Valid dates succeed |
| Update reservation | Valid edit persists and audit/timeline entry exists |
| Cancel reservation | Status changes correctly and audit/timeline entry exists |
| Invalid date range | Rejected with user-safe error |
| Assign room | Occupied/blocked/out-of-service/non-sellable rejected |
| Overbooking | Rejected by room type and assigned room |
| Check-in | Requires valid assigned room and marks room occupied |
| Checkout | Requires settlement or explicit unpaid override; marks room dirty |
| Payment | Folio paid/balance status updates correctly |
| Housekeeping | Dirty -> cleaning -> clean -> inspected is supported and audited |

Evidence file:

- `docs/launch/evidence/HOTEL_WORKFLOW_PROOF.md`

Stop condition:

- All `Hotel Workflows` checklist items have command/manual evidence, or blockers are exact and bounded.

### Slice 5 — DB-mutating E2E and browser cold-start stability

Objective: decide and prove E2E posture without risking production data.

Allowed scope:

- Fix `scripts/run-e2e-tests.mjs` cold-start/page.goto timing if reproducible.
- Add readiness wait, server health polling, deterministic base URL, browser startup diagnostics, or test timeout adjustments where justified.
- Document local-only proof if staging DB is not approved.

Required safe E2E path:

```bash
export E2E_DATABASE_URL="<approved disposable/staging URL>"
export ALLOW_DB_E2E=true
npm run db:e2e:ready
npm run test:e2e:db
npm run test:e2e
npm run launch:check
```

Evidence files:

- `docs/launch/evidence/DB_E2E_POSTURE.md`
- `docs/launch/evidence/BROWSER_E2E_STABILITY.md`

Stop condition:

- Staging/disposable DB-mutating E2E passes, or formal local-only proof acceptance is documented with owner and limitation.

### Slice 6 — secrets, recovery, WAF/rate-limit, provider posture

Objective: close operational sign-off that cannot be inferred from code.

Allowed scope:

- Documentation and non-secret config checks.
- Live environment verification with redacted outputs.
- No production secret values in commits or logs.

Required proof files:

- `docs/launch/evidence/SECRETS_AND_RECOVERY_PROOF.md`
- `docs/launch/evidence/WAF_PROVIDER_POSTURE.md`

Acceptance:

- Secret inventory is redacted and complete enough for ownership.
- Rotation dates are recorded for high-risk credentials.
- Rollback owner, deputy, DB recovery owner, and restore path owner are named.
- Rollback path is tested or explicitly blocked with date/owner.
- WAF/rate-limit rule IDs, thresholds, protected hostnames, and non-destructive test result are recorded.
- LINE, OTA automation, and payments each have a posture: `live`, `manual`, `disabled`, or `deferred`.

Stop condition:

- No P0 operational proof remains missing.

### Slice 7 — localization, tablet/manual ops, and doc-sprawl cleanup

Objective: close P1/P2 confidence risks after P0 is stable.

Allowed scope:

- Thai/English label verification.
- Empty-state cleanup.
- Demo/prototype copy removal from launch paths.
- Tablet reception and housekeeping usability fixes.
- Current-status index and stale-doc warnings.
- Line-ending normalization or explicit acceptance.

Evidence file:

- `docs/launch/evidence/LOCALIZATION_TABLET_ACCEPTANCE.md`

Stop condition:

- The current-status index prevents stale completion docs from overstating launch readiness.

## Final sign-off definition

A final launch PR can be marked ready only when all of the following are true:

- Every P0 item is either proved complete or explicitly not launching.
- `npm run launch:check` passes in the intended checkout/environment, with output captured and redacted.
- `npm run db:doctor` shows the intended target database and no failing configured checks.
- DB-mutating E2E posture is documented: staging/disposable pass, or formal local-only acceptance.
- Production secrets and recovery proof are verified in the live environment.
- Real room inventory is proved.
- Core hotel workflow evidence exists.
- P1 items are complete or formally deferred with owner/date.
- P2 cleanup is either complete or placed into post-launch issues.

## Codex final response template

When a slice is complete, respond with:

1. Slice completed.
2. Files changed.
3. Commands run and exact pass/fail result.
4. Evidence files created/updated.
5. Remaining P0 blockers.
6. Next recommended slice.
7. Explicit note that no production secrets were committed.

## Pull request body template for launch slices

```markdown
## Scope
- Slice:
- P0/P1/P2 items addressed:

## Commands run
- [ ] npm run launch:evidence
- [ ] npm run db:doctor
- [ ] npm run typecheck
- [ ] npm run lint
- [ ] npm test
- [ ] npm run test:e2e
- [ ] npm run test:e2e:db
- [ ] npm run build
- [ ] npm run prod:preflight
- [ ] npm run render:validate
- [ ] npm run live:check
- [ ] npm run launch:check
- [ ] git diff --check

## Evidence
- docs/launch/evidence/...

## Safety
- [ ] No production secrets committed
- [ ] DB-mutating E2E was not run against production
- [ ] Any live evidence is redacted

## Remaining launch blockers
- ...
```
