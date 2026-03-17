# Efficiency upgrades

The implementation deliberately reused the existing PMS services instead of introducing parallel systems.

## Applied efficiency-focused improvements

### 1. Webhook duplicate handling stays in the existing payment service

- The payment webhook improvement was added directly inside `payment_integration_service.py`.
- This avoids a second deduplication table or background reconciliation path.
- The database unique index remains the final source of truth, while the service now converts concurrent duplicate inserts into a normal duplicate outcome.

### 2. Base-rate fallback is now data-driven

- Pricing no longer needs a code edit to change the fallback nightly rate.
- The existing `app_settings` table is reused through the new `hotel.base_rate` seed value.
- This reduces operational churn and keeps rate behavior auditable.

### 3. Setting validation stays centralized

- Validation was added to `upsert_setting()` rather than scattered across multiple routes.
- Property-branding saves and legacy setting updates now share the same typed/keyed validation path for the hotel settings changed in this audit.

### 4. Communication vs messaging remained single-owner by responsibility

- Transactional reservation/payment notifications continue to use `communication_service.py`.
- Conversation threads, inbound routing, and automation continue to use `messaging_service.py`.
- The audit explicitly avoided creating overlapping delivery logic.
