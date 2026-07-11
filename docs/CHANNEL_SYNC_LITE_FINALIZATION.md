# Channel synchronization lite finalization plan

**Plan date:** 2026-07-10  
**Branch:** `feat/channel-sync-lite-finalize`  
**Target:** `main`  
**Pull request:** [#171](https://github.com/nakalasbakalas/sandbox-pms/pull/171)

## Objective

Finalize the smallest operationally useful channel-connectivity release without enabling direct OTA automation:

- Gmail-backed near-live inbound capture into the review inbox;
- a human-operated outbound availability queue;
- accurate Agoda/Trip.com application tracking;
- a Channex channel-only contingency for a later true two-way requirement.

The PMS remains the sole operational system of record.

## Scan result

The base branch was current with `main` and already contained a first implementation of the scheduler, queue service, CLI, tests, Render variables, documentation, and provider-application issues. The audit found five release blockers:

1. **Stale scheduler assertion** — the test expected `start.started=true` when only the email scheduler started, even though `started` now specifically represents the Hotel Ops scan timer.
2. **Generic worker-path escape** — a manual queue item was stored as an `UPDATE_AVAILABILITY` Hotel Ops task. Generic approval could move it to `QUEUED`, and generic run could complete it through a dry-run worker without the required provider confirmation.
3. **CLI actor impersonation** — the CLI accepted an arbitrary actor ID, label, and role instead of resolving an active PMS user.
4. **Unsupported source ambiguity** — the Gmail scheduler treated every enabled booking-email source as Gmail-pollable, including manual and IMAP source types unsupported by the lite synchronizer.
5. **Emergency-stop inconsistency** — generic UI approval honored the Hotel Ops emergency stop, but the dedicated CLI approval path did not.

All five blockers are corrected in PR #171.

## Lite scope

### Included

- Explicitly enabled, credential-gated Gmail polling.
- Review-only ingestion and existing de-duplication.
- Manual queue create/list/approve/mark-sent/mark-failed/cancel operations.
- Existing Hotel Ops task and approval visibility.
- Operator CLI with database-resolved actor identity.
- Guardrails preventing every generic worker path from executing manual queue records.
- Emergency-stop enforcement at both generic and dedicated approval paths.
- Tests, runbook, activation and rollback instructions, and a reviewable pull request.

### Deferred

- Direct OTA API adapters and production credentials.
- Gmail push notifications/history cursors.
- Automated ARI dispatch.
- A new full channel-management UI.
- Channex staging/client/webhooks.
- Agoda or Trip.com external application submission.

## Executed plan

### Phase 1 — Freeze semantics

- [x] Record the executed finalization prompt.
- [x] Record the lite in/out boundary.
- [x] Add a shared manual-queue discriminator recognized by the Hotel Ops service and UI.

### Phase 2 — Close cross-path safety gaps

- [x] Make generic approval leave manual availability records in `APPROVED`, never worker `QUEUED`.
- [x] Block manual availability records in generic queue and run evaluation paths.
- [x] Preserve safe generic deny/cancel behavior.
- [x] Add explicit audit/log messaging for manual approval.
- [x] Enforce the emergency stop in both generic and dedicated approval paths.

### Phase 3 — Harden operator identity and polling

- [x] Resolve mutating CLI actors from active PMS users by ID, username, or email.
- [x] Ignore caller-supplied role and label authority.
- [x] Poll only Gmail-backed source types supported by the lite synchronizer.
- [x] Report skipped unsupported sources separately from import failures.
- [x] Keep near-live polling disabled by default in the Render blueprint.

### Phase 4 — Complete lifecycle tests

- [x] Correct email-only scheduler startup assertions.
- [x] Add missing-credential and provider-filter tests.
- [x] Add per-source failure-isolation coverage.
- [x] Add manual-worker-block coverage.
- [x] Add queue approval/completion/failure/cancellation and authorization coverage.
- [x] Confirm provider confirmation is mandatory.
- [x] Confirm emergency stop leaves the item and approval pending.

### Phase 5 — Release documentation

- [x] Update the v2 runbook to identify the lite release as manual-only.
- [x] Add activation checks, rollback steps, and operator commands using resolved PMS actors.
- [x] Keep issues #168, #169, and #170 as external/future tracks, not release-completion claims.
- [x] Remove all one-off patch runners and temporary workflows from the final diff.

### Phase 6 — Validation and PR

- [x] Run JavaScript syntax checks for the changed backend, CLI, and test files.
- [x] Run dependency installation and Prisma client generation in GitHub Actions.
- [x] Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` before the implementation commit.
- [x] Open PR #171 to trigger the repository clean-checkout CI gate.
- [x] Inspect the CI steps for install, Prisma generation, lint, typecheck, business tests, E2E smoke, build, and launch-check.
- [x] Correct the final emergency-stop consistency gap and add its regression test.
- [x] Record the execution result and authoritative validation rule here.

## Execution result

The lite implementation is complete on `feat/channel-sync-lite-finalize` and is under review in PR #171. The product diff contains no temporary patch workflow or patch-runner file.

Branch-level GitHub Actions validation completed before the implementation commit with:

- syntax checks;
- `npm ci --include=dev`;
- `npm run db:generate`;
- `npm test`;
- `npm run typecheck`;
- `npm run build`;
- `git diff --check`.

The repository pull-request workflow is the authoritative clean-checkout result for the exact PR head. It additionally runs lint, Playwright E2E smoke tests, and `npm run launch:check`. PR #171 must remain unmerged unless its latest CI run is green.

## Acceptance criteria

The lite version is ready for review when all are true:

1. Near-live polling is explicit, OAuth-gated, bounded, non-overlapping, source-isolated, and review-only.
2. No manual availability item can enter or complete through an OTA worker path.
3. Approval and completion are separate actions; completion requires provider evidence.
4. CLI mutations are attributed to an active PMS user resolved from the database.
5. Emergency stop blocks approval through both the UI-backed generic path and the dedicated CLI path.
6. Tests exercise both the intended path and the previously unsafe cross-path behavior.
7. Documentation makes no live/direct/zero-lag claim.
8. Pull-request CI passes lint, typecheck, business tests, E2E smoke tests, build, and launch check.

## Activation sequence after merge

1. Confirm Gmail OAuth secrets and authenticated mailbox ownership in the deployment secret store.
2. Deploy with `BOOKING_EMAIL_NEAR_LIVE_ENABLED=false`.
3. Explicitly enable polling with a conservative initial interval of 120 seconds.
4. Verify source `lastSyncAt` advances and each message appears once in the review inbox.
5. Create a non-production availability item with an active PMS admin/manager actor.
6. Approve it in the existing approval interface or CLI and verify it remains `APPROVED`.
7. Confirm the generic run action rejects it.
8. Enable the emergency stop in a safe environment and confirm approval remains pending.
9. Disable the emergency stop, perform the provider update manually, and record the provider confirmation through the queue command.
10. Monitor errors and disable the email flag to roll back inbound polling; manual queue records remain auditable in the database.

## External blockers that do not block the lite merge

- Agoda owner/business questionnaire fields and authenticated submission.
- Trip.com authorized partner account and application reference.
- Channex commercial/staging account, credentials, mapping, certification, and measured latency.
- Any direct provider sandbox or production credentials.
