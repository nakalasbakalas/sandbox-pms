# Executed prompt: finalize channel synchronization lite

**Execution date:** 2026-07-10  
**Repository:** `nakalasbakalas/sandbox-pms`  
**Base implementation:** `feat/channel-sync-v2`  
**Finalization branch:** `feat/channel-sync-lite-finalize`

## Prompt

You are the senior integration and release engineer responsible for converting the existing channel-sync v2 branch into a small, safe, mergeable **lite release**.

First scan the current repository, the complete `main...feat/channel-sync-v2` diff, the existing booking-email implementation, Hotel Ops task lifecycle, scheduler startup path, CLI, tests, Render blueprint, documentation, and connectivity issues. Do not assume the previous implementation is internally isolated: test every path by which an existing Hotel Ops approval or run action could act on a manual availability item.

### Lite release definition

The lite release contains only:

1. **Near-live inbound email capture**
   - Poll Gmail through the existing OAuth integration at a bounded short interval.
   - Import and de-duplicate booking-related messages into the existing review inbox.
   - Always use review-only mode.
   - Never automatically create, modify, cancel, charge, pay, or link an operational reservation.

2. **Manual outbound availability queue**
   - Create audited availability-change records for Booking.com, Agoda, Trip.com, Expedia, and a future Channex transport path.
   - Require owner/manager approval.
   - Never call an OTA worker, browser adapter, or provider API.
   - Complete an item only after a human records a provider confirmation/reference.
   - Preserve deterministic idempotency, task logs, and audit logs.

3. **Connectivity follow-up tracking only**
   - Keep Agoda and Trip.com direct API applications in PREPARING state until an authenticated owner submits them and records an external reference.
   - Keep Channex as a documented channel-only contingency, not as a second PMS and not as implemented production synchronization.

### Explicitly out of scope

- Direct Agoda, Trip.com, Booking.com, Expedia, or Channex API writes.
- Browser automation or CAPTCHA/2FA bypass.
- Zero-lag or webhook claims for Gmail polling.
- A second property-management system.
- New rate, restriction, payment, folio, accounting, housekeeping, or guest-profile ownership outside the PMS.
- External provider form submission without owner-authorized business data and authenticated accounts.
- A large new channel-management UI. Reuse the existing Hotel Ops task/approval visibility and provide an operator CLI/runbook for final delivery attestation.

### Required audit corrections

1. Repair any stale test expectation caused by separating Hotel Ops scan startup from email-scheduler startup.
2. Prevent a manual availability queue item from being queued or run through the generic Hotel Ops OTA-worker path.
3. Make generic Hotel Ops approval safe for manual queue records: approval may move the item to `APPROVED`, but must not move it to worker `QUEUED` state.
4. Add defense-in-depth so manual queue records cannot be sent to the OTA worker even if another caller attempts to queue or run them.
5. Stop the CLI from trusting caller-supplied labels or roles. Resolve the actor from an active PMS user record and use the database role/name for authorization and audit.
6. Poll only booking-email source types supported by the Gmail-backed lite synchronizer; skip unsupported source types without treating them as successful Gmail imports.
7. Validate queue filters and lifecycle transitions with clear errors rather than leaking provider/ORM implementation errors.

### Tests and release gates

Add or update tests proving:

- polling is disabled without the explicit flag;
- polling is disabled without Gmail OAuth credentials;
- interval and batch limits are bounded;
- email-only startup reports `backgroundStarted=true`, `bookingEmailStarted=true`, and scan `started=false`;
- scheduled email imports always pass `reviewOnly: true`;
- unsupported source providers are skipped;
- one source failure does not stop another supported source;
- manual queue records cannot pass `evaluateOpsTaskRun`;
- generic approval of a manual queue record does not queue it for worker execution;
- queue creation, approval, completion, failure, cancellation, idempotency, logs, and audits obey the manual-only lifecycle;
- completion requires a provider confirmation/reference;
- unauthorized or fabricated CLI roles cannot authorize a mutation;
- Channex remains a channel-only future option and automatic dispatch remains false.

Run the repository CI-equivalent checks available through GitHub Actions: dependency install, Prisma generation, lint, typecheck, business tests, E2E smoke tests, build, and launch check. Open a pull request only after the branch contains the final prompt, execution plan, code corrections, tests, and accurate activation/rollback documentation.

### Safety and truthfulness

- Do not commit credentials, mailbox contents, guest PII, provider references from production, or business application secrets.
- Do not deploy or merge automatically.
- Do not state that external provider access is submitted, approved, certified, live, real-time, or zero-lag without evidence.
- Record any check that could not be run and rely on PR CI for the authoritative clean-checkout result.

## Execution rule

Implement the smallest complete correction set. Prefer removing or blocking unsafe cross-path behavior over adding features. The result is complete when the lite path is internally consistent, CI-clean, documented, reviewable, and still defaults to no automatic external write.
