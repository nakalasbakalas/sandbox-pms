# System Process Audit

## System map

- **Primary app entry points**
  - `sandbox_pms_mvp/app.py`
  - `sandbox_pms_mvp/pms/app.py`
- **Core booking and reservation services**
  - `sandbox_pms_mvp/pms/services/public_booking_service.py`
  - `sandbox_pms_mvp/pms/services/reservation_service.py`
  - `sandbox_pms_mvp/pms/services/staff_reservations_service.py`
- **Operational services**
  - `sandbox_pms_mvp/pms/services/front_desk_service.py`
  - `sandbox_pms_mvp/pms/services/housekeeping_service.py`
  - `sandbox_pms_mvp/pms/services/cashier_service.py`
- **Payments / integrations / notifications**
  - `sandbox_pms_mvp/pms/services/payment_integration_service.py`
  - `sandbox_pms_mvp/pms/services/communication_service.py`
  - `sandbox_pms_mvp/pms/services/ical_service.py`
- **Security / auth / roles**
  - `sandbox_pms_mvp/pms/services/auth_service.py`
  - `sandbox_pms_mvp/pms/permissions.py`
  - `sandbox_pms_mvp/pms/constants.py`
  - `sandbox_pms_mvp/migrations/versions/20260316_02_rbac_least_privilege.py`
- **High-value tests**
  - `sandbox_pms_mvp/tests/test_phase3_auth.py`
  - `sandbox_pms_mvp/tests/test_phase5_staff_reservations_workspace.py`
  - `sandbox_pms_mvp/tests/test_phase7_housekeeping.py`
  - `sandbox_pms_mvp/tests/test_phase9_hosted_payments.py`
  - `sandbox_pms_mvp/tests/test_phase10_admin_panel.py`

## Process inventory

| Process name | Components/files involved | Current behavior | Expected behavior | Issue found | Severity | Recommended fix | Implemented fix status |
|---|---|---|---|---|---|---|---|
| Public booking hold / confirm | `pms/app.py`, `public_booking_service.py`, `reservation_service.py` | Public routes exist for hold and confirm; reservation creation and inventory allocation are centralized in service layer. | Hold and confirm should stay atomic, reject invalid state, and avoid duplicate side effects. | No direct local failure reproduced in this audit pass, but this remains a high-risk area because flow complexity is concentrated in shared service code. | High | Keep future changes transaction-safe and covered by targeted booking lifecycle tests. | No code change in this pass |
| Booking modify / cancel | `pms/app.py`, `staff_reservations_service.py`, `reservation_service.py` | Staff and guest modification/cancellation routes exist; service layer recalculates stay and status. | Changes should revalidate availability and preserve auditability. | No direct failing test reproduced locally. | Medium | Add more edge-case tests around duplicate requests and overlapping modifications. | No code change in this pass |
| Reservation detail access for operations | `pms/app.py`, `staff_reservations_service.py`, `templates/reservation_detail.html`, `tests/test_phase5_staff_reservations_workspace.py` | Detail page redacts folio content unless `folio.view` is present; edit endpoints still require stronger permissions. | Housekeeping should be able to open reservation detail needed for operations while still being blocked from financial and edit actions. | Regression introduced by least-privilege rebalance: `/staff/reservations/<id>` required `reservation.view` only, causing housekeeping users to receive `403` even though the page already redacted payment data. | High | Allow either `reservation.view` or `housekeeping.view` on the read-only reservation detail route. | **Fixed** in `sandbox_pms_mvp/pms/app.py` |
| Check-in / check-out / room assignment | `front_desk_service.py`, `room_readiness_service.py`, `pms/app.py` | Service layer coordinates room readiness, payment collection, and state changes. | Operational actions should reject impossible room and balance states. | No direct failing test reproduced locally. | High | Keep validation in service layer; add more concurrency and stale-room-assignment tests later. | No code change in this pass |
| Housekeeping status transitions | `housekeeping_service.py`, `pms/app.py`, `tests/test_phase7_housekeeping.py` | Separate housekeeping flows exist with role-specific endpoints and task/history records. | Housekeeping must retain the minimum data needed to execute room operations. | RBAC change accidentally blocked a housekeeping-supported reservation-detail workflow. | High | Restore access to redacted detail surface without reintroducing folio or edit permissions. | **Fixed** indirectly by reservation detail permission repair |
| Payment request / webhook application | `payment_integration_service.py`, `pms/app.py`, `cashier_service.py`, `tests/test_phase9_hosted_payments.py` | Provider webhook endpoint exists and payment application is centralized. | Webhooks must be idempotent, authenticated, and safe under retries. | Audit found this area to be operationally sensitive, but no local failing test reproduced during this pass. | Critical | Add deeper duplicate-delivery and concurrent-delivery test coverage; review locking and uniqueness guarantees before payment-provider cutover. | No code change in this pass |
| Notifications / reminders | `communication_service.py`, CLI commands, related templates/tests | Notification queueing and dispatch exist with retry-oriented states. | Scheduled runs should avoid duplicates and surface failures clearly. | No direct local failure reproduced. | Medium | Add job-level observability and duplicate-run coverage later. | No code change in this pass |
| Reporting / dashboards | `reporting_service.py`, `pms/app.py`, dashboard tests | Reports are built from live DB queries with shared reporting functions. | Staff dashboards should remain permission-correct and consistent. | No direct failure reproduced in focused regression runs. | Medium | Keep shared report functions covered by role-based tests. | No code change in this pass |

## Summary

- Baseline repo checks passed before code changes:
  - `pre-commit run --all-files`
  - `python scripts/launch_gate.py`
- Full local pytest initially failed at:
  - `sandbox_pms_mvp/tests/test_phase5_staff_reservations_workspace.py::test_housekeeping_detail_hides_folio_summary`
- Recent GitHub Actions failure investigated:
  - `Codex Guardrails` run `23123080210`
  - Failure step: full pytest suite
  - Reported failing test there: `sandbox_pms_mvp/tests/test_phase10_admin_panel.py::test_staff_user_manager_and_role_permissions_change_backend_authorization`
  - That CI failure did **not** reproduce locally after environment sync; the current local reproducible regression was the housekeeping detail access break.
