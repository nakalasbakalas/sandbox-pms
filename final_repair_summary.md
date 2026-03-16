# Final Repair Summary

## What was fixed

- Repaired a production-relevant RBAC regression in `sandbox_pms_mvp/pms/app.py`.
- `GET /staff/reservations/<reservation_id>` now allows either:
  - `reservation.view`, or
  - `housekeeping.view`
- This restores housekeeping access to the reservation detail surface needed for operations.
- Financial data remains protected because the template still hides folio/payment detail unless `folio.view` is present.
- Mutation routes under the same workspace still require stronger permissions such as `reservation.edit`.

## What remains

- Payment-provider webhook reliability still needs deeper live and concurrency validation.
- Scheduled job overlap / duplicate-run safety needs broader automated coverage.
- External calendar sync still needs live feed validation and failure-observability review.

## What needs live credential validation

- Hosted payment provider checkout + webhook round trip
- SMTP-backed outbound email delivery and retry behavior
- Any external calendar feeds configured in production

## Risky areas requiring manual review

- Payment webhook duplicate and replay handling under real provider retry behavior
- Reservation/inventory concurrency during simultaneous edits or peak booking traffic
- End-to-end check-in / checkout flows with real operational data

## Validation completed

- `pre-commit run --all-files`
- `python scripts/launch_gate.py`
- `python -m pytest sandbox_pms_mvp/tests/test_phase5_staff_reservations_workspace.py::test_housekeeping_detail_hides_folio_summary -q`
- `python -m pytest sandbox_pms_mvp/tests/test_phase10_admin_panel.py::test_staff_user_manager_and_role_permissions_change_backend_authorization -q`
- `python -m pytest sandbox_pms_mvp/tests/test_phase3_auth.py sandbox_pms_mvp/tests/test_phase5_staff_reservations_workspace.py sandbox_pms_mvp/tests/test_phase7_housekeeping.py sandbox_pms_mvp/tests/test_phase10_admin_panel.py -q`

## Implemented fix status

- Reservation detail operational access regression: **fixed**
- Remaining audit items: **documented for follow-up**
