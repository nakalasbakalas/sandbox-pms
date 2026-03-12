# Service Layer Instructions

## Scope

This file applies to service-layer logic under `pms/services/` and the business rules those modules enforce.

## Priorities

1. Functional correctness.
2. Data integrity.
3. Explicit validation and failure handling.
4. Safe behavior under retries, duplicate submissions, and partial failures.

## Read first

When changing service logic, inspect in this order:

1. the calling route or handler in `pms/app.py`
2. the relevant service module in this directory
3. supporting models, constants, pricing, config, security, and settings helpers
4. downstream integrations such as notifications, payment orchestration, or iCal sync
5. the nearest tests covering the touched workflow

## High-risk rules

- Treat reservation, availability, rate, inventory, payment, auth, and audit logic as high risk.
- Preserve transaction boundaries and explicit error handling.
- Do not silently coerce invalid or stale states.
- Do not assume external integrations are available or healthy.
- Keep staff-visible state, guest-visible state, and persisted records aligned.
- Preserve idempotency protections where they already exist.

## Required validation mindset

Check for:

- invalid dates and stay windows
- double submissions and duplicate booking risk
- stale availability or rate reads
- mismatched room, rate, or reservation states
- missing required guest or payment data
- partial payment, refund, or deposit failures
- authorization boundary leaks in staff-facing actions
- audit trail gaps when state changes occur

## Change guidance

- Prefer extending existing service patterns over introducing parallel logic paths.
- Keep domain rules close to the service that owns them.
- If a change affects notifications or payment side effects, inspect both the write path and the retry or callback path.
- Add or update tests when changing reservation, payment, or authorization behavior.
