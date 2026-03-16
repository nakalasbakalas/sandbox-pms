# State Flow Map

## Booking lifecycle

1. Guest enters via `/book` or `/availability`
2. Hold request posts to `/booking/hold`
3. Confirmation posts to `/booking/confirm`
4. Reservation is created through shared reservation services
5. Staff can inspect and mutate reservations through `/staff/reservations/*`
6. Guest/self-service routes also exist for modify and cancel flows

### Operational state concerns

- Booking creation, repricing, and inventory changes are centralized in service code.
- Reservation detail view is used by staff operations after creation.
- In this pass, the reservation detail read path was repaired so housekeeping can access a **redacted** detail screen again.

## Payment lifecycle

1. Reservation or deposit flow creates / reuses a payment request
2. Guest is redirected to hosted payment surface
3. Provider returns guest to public payment return route
4. Provider webhook applies authoritative payment outcome
5. Payment state feeds folio and reservation payment summaries
6. Refunds and manual postings are handled through cashier services

### Operational state concerns

- Payment webhooks remain one of the highest-risk production paths.
- Financial correctness depends on idempotent event application and strong auditability.

## Room / inventory lifecycle

1. Availability is searched by room type / date
2. Reservation hold or confirm consumes availability
3. Staff assignment selects an eligible room
4. Check-in validates room readiness and payment requirements
5. Stay progresses to occupied state
6. Check-out posts final charges and returns room to turnover workflow

### Operational state concerns

- Room readiness and housekeeping status directly affect assignability.
- Check-in and checkout depend on both reservation truth and operational room state.

## Housekeeping lifecycle

1. Room appears in housekeeping board / task surfaces
2. Staff update room status or tasks
3. Maintenance / closure states feed readiness and inventory logic
4. Housekeeping may need reservation detail context for an active stay or upcoming arrival

### Operational state concerns

- Least-privilege RBAC should not remove operationally necessary read access.
- Financial data must stay hidden from housekeeping roles.
- Current repaired behavior:
  - housekeeping can open reservation detail
  - folio summary stays restricted
  - edit endpoints still require `reservation.edit`

## Auth / role-sensitive flows

1. Staff login establishes session
2. Route handlers enforce permission checks
3. Templates further hide privileged actions using `can(...)`
4. Sensitive POST actions require stronger permissions than read-only views

### Current repaired role flow

- `staff_reservation_detail` now accepts either:
  - `reservation.view`, or
  - `housekeeping.view`
- This keeps the view available to housekeeping without granting cashier or edit powers.

## Async / scheduled process lifecycle

1. External scheduler invokes Flask CLI jobs
2. Notification dispatch job processes queued deliveries
3. Reminder jobs send pre-arrival and failed-payment nudges
4. iCal sync imports external calendar blocks

### Operational state concerns

- These jobs are externally triggered; there is no built-in scheduler in the app itself.
- Production safety depends on idempotent handlers, durable logs, and careful deployment scheduling.
