# Test Gap Report

## Existing strong coverage observed

- Staff auth and RBAC:
  - `sandbox_pms_mvp/tests/test_phase3_auth.py`
  - `sandbox_pms_mvp/tests/test_phase10_admin_panel.py`
- Reservation workspace and operational detail flows:
  - `sandbox_pms_mvp/tests/test_phase5_staff_reservations_workspace.py`
- Housekeeping:
  - `sandbox_pms_mvp/tests/test_phase7_housekeeping.py`
- Hosted payments:
  - `sandbox_pms_mvp/tests/test_phase9_hosted_payments.py`

## Missing or weak tests for critical operational flows

| Area | Gap |
|---|---|
| Payment webhook handling | Add duplicate-delivery and replay tests for the same provider event ID under repeated callback conditions. |
| Payment webhook concurrency | Add tests that simulate near-simultaneous webhook delivery for the same payment request to verify no duplicate folio side effects. |
| Booking modification concurrency | Add tests for conflicting stay-date changes and room reassignment collisions. |
| Scheduled jobs | Add duplicate-run/idempotency tests for notification dispatch and reminder commands. |
| External calendar sync | Add malformed-feed, duplicate-block, and partial-failure tests. |
| Reservation detail RBAC | Existing regression test is good; keep it because it caught a real least-privilege regression. |

## Regression covered by this repair

- `sandbox_pms_mvp/tests/test_phase5_staff_reservations_workspace.py::test_housekeeping_detail_hides_folio_summary`
- Focused verification also reran:
  - `sandbox_pms_mvp/tests/test_phase10_admin_panel.py::test_staff_user_manager_and_role_permissions_change_backend_authorization`
  - `sandbox_pms_mvp/tests/test_phase3_auth.py`
  - `sandbox_pms_mvp/tests/test_phase7_housekeeping.py`
  - `sandbox_pms_mvp/tests/test_phase10_admin_panel.py`
