# Sandbox Hotel Autonomous Booking Operations

## Decision

The Sandbox PMS remains the sole authority for reservations, inventory, guests, folios, payments, housekeeping, rates, and operational history.

GPT or any future specialist agent may interpret sanitized evidence, investigate, plan, explain, and prioritize. Deterministic backend services must validate, authorize, execute, verify, and audit every action.

GPT and agent runtimes must never:

- write directly to PostgreSQL;
- receive or retain OTA, Gmail, payment, or staff credentials;
- control an unrestricted browser;
- choose their own permissions or policy;
- bypass approval or the Hotel Ops emergency stop; or
- treat confidence as authorization.

## Current Release Boundary

The current program phase is `SHADOW_FOUNDATION`.

- Only `OBSERVE`, `SHADOW`, and `PROHIBITED` autonomy policies are accepted.
- Trusted provider-event ingestion and shadow evaluation require a SYSTEM backend context; staff roles cannot assert provider source trust.
- Shadow decisions are append-only evidence and always record `writesPerformed=false`.
- No shadow module may call a provider write adapter, the OTA worker executor, reservation/payment mutation service, or unrestricted browser.
- Gmail booking ingestion remains review-only.
- OTA adapters remain dry-run/manual until provider-specific certification, acknowledgement, read-back, recovery, canary, staff, and owner proof exist.
- `OTA_LIVE_WRITES_ENABLED=false` and `DIRECT_BOOKING_ENABLED=false` remain launch gates.

## Control Flow

```text
SYSTEM-authenticated provider input
        |
        v
canonical normalized event
        |
        v
property-scoped cursor and event evidence
        |
        v
deterministic analyzer / optional typed AI interpretation
        |
        v
granular autonomy policy evaluation
        |
        v
shadow decision + SHADOW_NOOP evidence
        |
        v
audit log + domain event
```

Provider execution, acknowledgement, read-back, and compensation are deliberately absent from this phase.

## Source Trust

From highest to lowest:

1. signed OTA webhook;
2. authenticated channel-manager webhook;
3. authenticated OTA API response;
4. authenticated provider acknowledgement;
5. structured OTA email;
6. validated provider attachment;
7. free-text guest email;
8. staff command; and
9. AI interpretation without provider evidence.

Email, staff commands, and AI interpretation cannot independently establish a booking, cancellation, or cleared payment fact.

## Scheduling

Near-live ingestion and hourly reconciliation eventually run through an external durable scheduler. Every property/job occurrence must acquire a PostgreSQL advisory lock and persist its run/cursor state. In-process intervals are development compatibility only and are not production autonomy proof.

## Rollout

1. Shadow foundation: canonical events, cursors, policies, locks, and decision/no-op evidence. Snapshot, reconciliation-issue, and dead-letter schemas are reserved for the next service slice.
2. Autonomous internal operations: housekeeping tasks, operational alerts, message classification, and account-health monitoring through typed PMS commands.
3. Trusted inbound booking canary: one certified provider and room type after shadow accuracy and concurrency proof.
4. Provider availability/rate writes: provider acknowledgement, read-back, reconciliation, retry, and compensation required.
5. Bounded routine guest communications.
6. Bounded revenue/account operations.
7. Continuous supervisor with staff managing exceptions and approvals.

Each phase requires exact-release staging, recovery, staff workflow, provider, and owner evidence. Passing local or CI tests is engineering evidence only.

## OpenAI Agents SDK Boundary

The Agents SDK is optional and deferred until the durable candidate/evidence contract is proven. If introduced, its tools may read sanitized snapshots and submit typed decision candidates only. It must not expose Prisma clients, provider credentials, provider write adapters, browser automation, policy mutation, approvals, emergency-stop mutation, or direct PMS execution tools.
