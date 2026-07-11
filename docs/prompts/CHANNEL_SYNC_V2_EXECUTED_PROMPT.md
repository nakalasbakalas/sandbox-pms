# Executed prompt: channel synchronization v2

**Execution date:** 2026-07-10  
**Repository:** `nakalasbakalas/sandbox-pms`  
**Implementation branch:** `feat/channel-sync-v2`

## Prompt

You are the senior integration engineer responsible for extending SANDBOX HOTEL PMS without replacing its existing operational core.

Implement a production-oriented channel synchronization v2 with the following strategy:

1. Add **near-live inbound booking-email synchronization** using the existing Gmail OAuth integration and booking-email parser.
2. Add a **manual outbound availability queue** for Booking.com, Agoda, Trip.com, Expedia, and a future Channex channel-manager path.
3. Start Agoda and Trip.com direct API access work in parallel, while accurately distinguishing “application preparation” from an externally submitted or approved application.
4. When true live two-way synchronization becomes essential, use a **channel-only provider such as Channex**, not a second complete PMS.

### Non-negotiable safety rules

- The PMS remains the single operational system of record.
- “Near-live” means short-interval polling; do not describe it as a zero-lag webhook.
- Scheduled inbound email passes are review-only. They may capture, classify, de-duplicate, and queue events, but must not automatically create/cancel/modify reservations or post payments.
- Reuse the existing `BookingEmailSource`, `BookingEmailEvent`, and Gmail OAuth implementation.
- Reuse the existing Hotel Ops task/approval/log/audit models for outbound availability work instead of introducing a parallel queue database.
- Queue creation must never call an OTA.
- Approval must never dispatch an OTA write.
- A queue item may be completed only after a human records a provider confirmation/reference.
- Every queue mutation must be idempotent and auditable.
- Keep existing OTA browser adapters in dry-run mode. Do not enable browser writes.
- Never commit OTA passwords, OAuth tokens, API keys, identity documents, or commercial application data.
- Do not claim Agoda or Trip.com access is submitted or approved unless an external reference exists.
- Channex, if adopted, is a transport/distribution layer only. It must not own front desk, folios, housekeeping, guest profiles, or accounting.

### Inbound implementation requirements

- Extend the existing in-process scheduler so it can poll all enabled booking-email sources.
- Require `BOOKING_EMAIL_NEAR_LIVE_ENABLED=true` plus configured Gmail OAuth credentials.
- Support a bounded polling interval and batch size through environment variables.
- Default to a 120-second interval and 25-message batch.
- Prevent overlapping runs.
- Continue processing other enabled sources if one source fails.
- Redact secrets from scheduler errors.
- Use the existing source-message and booking-reference de-duplication.
- Preserve the existing manual sync endpoint and review inbox.
- Expose a testable policy function that reports whether polling is requested, configured, enabled, review-only, and mutation-disabled.

### Outbound implementation requirements

- Implement a dedicated service over `HotelOpsTask` for availability queue operations.
- Support providers `booking`, `agoda`, `trip`, `expedia`, and `channex`.
- Validate provider hotel ID, room mapping, date range, room count/open/closed state, and operational reason.
- Create deterministic idempotency keys.
- Store provider/delivery metadata in `permissionDecision` with `autoDispatch: false`.
- Create an owner approval record, task log, and audit log in the same transaction.
- Support list, approve, mark sent, mark failed, and cancel operations.
- Require a provider confirmation/reference for `mark sent`.
- Provide a CLI suitable for an operator/runbook without exposing credentials.
- Keep Channex mapped to the existing generic/all platform until a certified adapter is implemented.

### Direct API access work

Create auditable GitHub issues for:

- Agoda Direct Supply / YCS API partner application.
- Trip.com Open Platform direct API application.
- Channex staging, latency, mapping, webhook/idempotency, pricing, and certification evaluation.

Each direct-API issue must contain:

- status,
- required owner/business inputs,
- technical scope,
- secret-handling rules,
- sandbox/certification steps,
- definition of done.

### Configuration and documentation

- Add documented environment variables for near-live polling and the selected channel-only provider.
- Enable guarded near-live polling in the Render blueprint; it must remain disabled at runtime when Gmail OAuth is incomplete.
- Add npm scripts for the queue CLI, policy display, and tests.
- Add a complete architecture/runbook document.
- Record this prompt in the repository.
- Update the main README and OTA adapter guide so no document implies live OTA writes already exist.

### Tests and acceptance criteria

Add automated tests proving:

- polling is disabled without an explicit flag,
- polling is disabled without OAuth credentials,
- interval and batch bounds are enforced,
- scheduled sync is review-only,
- scheduled sync never enables operational mutations,
- queue normalization rejects invalid dates and open inventory without room counts,
- Channex is treated as a channel-manager target,
- queue creation creates one task, one approval, one log, and one audit record,
- duplicate queue submissions return the existing task,
- policy selects manual outbound mode and Channex for a future zero-lag channel layer.

Run the repository test/build checks available in CI. Open a pull request with an exact summary, risk statement, activation steps, and explicit external blockers.

## Execution notes

The implementation deliberately does **not** submit provider forms, enable direct OTA writes, or merge/deploy automatically. Agoda and Trip.com submissions require owner-authorized business information and authenticated provider accounts. Their GitHub issues are application dossiers and execution checklists, not fabricated evidence of external submission.
