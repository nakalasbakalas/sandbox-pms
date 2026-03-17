# Workflow validation report

This report uses confirmed repository code as the source of truth. No claim below is based on assumed PMS behavior.

## Scope audited

- Booking search, hold, and public confirmation
- Reservation creation and room assignment
- Hosted payment request lifecycle and webhooks
- Front-desk and daily-report operational views
- Housekeeping / room blocking interactions
- Pre-check-in arrival readiness hooks
- Guest communication and messaging routing
- Staff auth/session handling
- Admin settings and rate-rule behavior

## Confirmed findings

### Booking / reservations

- Public booking hold creation already locks `inventory_days` rows with `with_for_update()` before marking them `held` in `/home/runner/work/sandbox-pms/sandbox-pms/sandbox_pms_mvp/pms/services/public_booking_service.py`.
- Public booking confirmation already locks the `reservation_holds` row and releases hold inventory when a duplicate booking is detected in the same flow.
- Staff room reassignment already locks reservation and target inventory rows in `/home/runner/work/sandbox-pms/sandbox-pms/sandbox_pms_mvp/pms/services/staff_reservations_service.py`.

### Payments

- Hosted payment requests, refresh, and public return flows are already centralized in `/home/runner/work/sandbox-pms/sandbox-pms/sandbox_pms_mvp/pms/services/payment_integration_service.py`.
- The authoritative truth remains the webhook/provider sync path, not the guest redirect return page.
- A real race remained around duplicate provider event inserts under concurrent webhook delivery. This is now guarded by a nested transaction/savepoint plus the existing unique index on `(provider, provider_event_id)`.

### Auth / sessions

- Runtime security validation, secure cookie requirements, HTTPS enforcement, and hardened error handling already exist in `/home/runner/work/sandbox-pms/sandbox-pms/sandbox_pms_mvp/pms/security.py`.
- Staff login clears the Flask session before setting a new auth cookie, and MFA completion rotates the persistent auth session in `/home/runner/work/sandbox-pms/sandbox-pms/sandbox_pms_mvp/pms/services/auth_service.py`.

### Rate rules / settings

- Rate rules already normalize and validate `days_of_week` in `/home/runner/work/sandbox-pms/sandbox-pms/sandbox_pms_mvp/pms/services/admin_service.py`.
- A hardcoded fallback nightly rate of `750.00` existed in pricing logic. This is now driven by the `hotel.base_rate` app setting instead.
- Central setting writes already flow through `upsert_setting`, but time-valued and key-specific hotel settings were not fully validated there. Validation is now centralized for time, currency, contact email, and contact phone.

### Communication vs messaging

- Transactional reservation/payment communications are routed through `/home/runner/work/sandbox-pms/sandbox-pms/sandbox_pms_mvp/pms/services/communication_service.py`.
- Conversation-thread and automation behavior is routed through `/home/runner/work/sandbox-pms/sandbox-pms/sandbox_pms_mvp/pms/services/messaging_service.py`.
- No duplicate subsystem was introduced; the audit preserved this split and documented it.

## Implemented changes

1. Added concurrent-safe duplicate handling for hosted payment webhook event inserts.
2. Replaced the hardcoded pricing fallback with the configurable `hotel.base_rate` setting.
3. Centralized validation in `upsert_setting` for typed/keyed hotel settings.
4. Preserved time setting types when saving property branding/settings.
5. Clarified public payment return labeling so deposit/full/balance request context renders clearly in translated UI.
6. Realigned stale tests that assumed empty seeded demo reservations.
