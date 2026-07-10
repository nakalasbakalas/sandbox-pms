# Channel synchronization lite finalization plan

**Plan date:** 2026-07-10  
**Branch:** `feat/channel-sync-lite-finalize`  
**Target:** `main`

## Objective

Finalize the smallest operationally useful channel-connectivity release without enabling direct OTA automation:

- Gmail-backed near-live inbound capture into the review inbox;
- a human-operated outbound availability queue;
- accurate Agoda/Trip.com application tracking;
- a Channex channel-only contingency for a later true two-way requirement.

The PMS remains the sole operational system of record.

## Scan result

The base branch is current with `main` and adds the scheduler, queue service, CLI, tests, Render variables, documentation, and provider-application issues. The audit found four release blockers:

1. **Stale scheduler assertion** — the test still expects `start.started=true` when only the email scheduler starts, even though `started` now specifically represents the Hotel Ops scan timer.
2. **Generic worker-path escape** — a manual queue item is stored as an `UPDATE_AVAILABILITY` Hotel Ops task. The generic approval path can move it to `QUEUED`, and the generic run path can complete it through a dry-run worker without the required provider confirmation.
3. **CLI actor impersonation** — the CLI accepts an arbitrary actor ID, label, and role from command-line flags instead of resolving an active PMS user.
4. **Unsupported source ambiguity** — the Gmail scheduler currently treats every enabled booking-email source as Gmail-pollable even when the source type is manual, IMAP, or otherwise unsupported by the lite synchronizer.

## Lite scope

### Included

- Explicitly enabled, credential-gated Gmail polling.
- Review-only ingestion and existing de-duplication.
- Manual queue create/list/approve/mark-sent/mark-failed/cancel operations.
- Existing Hotel Ops task and approval visibility.
- Operator CLI with database-resolved actor identity.
- Guardrails preventing every generic worker path from executing manual queue records.
- Tests, runbook, activation and rollback instructions, and a reviewable pull request.

### Deferred

- Direct OTA API adapters and production credentials.
- Gmail push notifications/history cursors.
- Automated ARI dispatch.
- New channel-management UI.
- Channex staging/client/webhooks.
- Agoda or Trip.com external application submission.

## Execution plan

### Phase 1 — Freeze semantics

- [x] Record the executed finalization prompt.
- [x] Record this plan and the lite in/out boundary.
- [ ] Add a shared/manual-queue discriminator that existing Hotel Ops code can recognize.

### Phase 2 — Close cross-path safety gaps

- [ ] Make generic approval leave manual availability records in `APPROVED`, never worker `QUEUED`.
- [ ] Block manual availability records in generic queue and run evaluation paths.
- [ ] Preserve safe generic deny/cancel behavior.
- [ ] Add explicit audit/log messaging for manual approval.

### Phase 3 — Harden operator identity and polling

- [ ] Resolve mutating CLI actors from active PMS users by ID, username, or email.
- [ ] Ignore/remove caller-supplied role and label authority.
- [ ] Poll only Gmail-backed source types supported by the lite synchronizer.
- [ ] Report skipped unsupported sources separately from import failures.

### Phase 4 — Complete lifecycle tests

- [ ] Correct email-only scheduler startup assertions.
- [ ] Add missing-credential and provider-filter tests.
- [ ] Add per-source failure isolation coverage.
- [ ] Add manual-worker-block coverage.
- [ ] Add queue approval/completion/failure/cancellation and authorization coverage.
- [ ] Confirm provider confirmation is mandatory.

### Phase 5 — Release documentation

- [ ] Update the v2 runbook to identify the lite release as manual-only.
- [ ] Add activation checks, rollback steps, and operator commands using resolved PMS actors.
- [ ] Keep issues #168, #169, and #170 as external/future tracks, not release completion claims.

### Phase 6 — Validation and PR

- [ ] Run syntax/static checks available in the execution environment.
- [ ] Open a pull request to trigger clean-checkout CI.
- [ ] Inspect CI job steps and logs.
- [ ] Correct any CI failure on the branch.
- [ ] Mark the plan with the final commit, PR, and validation result.

## Acceptance criteria

The lite version is ready for review when all are true:

1. Near-live polling is explicit, OAuth-gated, bounded, non-overlapping, source-isolated, and review-only.
2. No manual availability item can enter or complete through an OTA worker path.
3. Approval and completion are separate actions; completion requires provider evidence.
4. CLI mutations are attributed to an active PMS user resolved from the database.
5. Tests exercise both the intended path and the previously unsafe cross-path behavior.
6. Documentation makes no live/direct/zero-lag claim.
7. Pull-request CI passes lint, typecheck, business tests, E2E smoke tests, build, and launch check.

## Activation sequence after merge

1. Confirm Gmail OAuth secrets in the deployment secret store.
2. Enable `BOOKING_EMAIL_NEAR_LIVE_ENABLED=true` with a conservative interval, initially 120 seconds.
3. Verify source `lastSyncAt` advances and each message appears once in the review inbox.
4. Create a non-production availability item with an active PMS admin/manager actor.
5. Approve it in the existing approval interface or CLI and verify it remains `APPROVED`.
6. Confirm the generic run action rejects it.
7. Perform the provider update manually and record the provider confirmation through the queue command.
8. Monitor errors and disable the email flag to roll back inbound polling; manual queue records remain auditable in the database.

## External blockers that do not block the lite merge

- Agoda owner/business questionnaire fields and authenticated submission.
- Trip.com authorized partner account and application reference.
- Channex commercial/staging account, credentials, mapping, certification, and measured latency.
- Any direct provider sandbox or production credentials.
