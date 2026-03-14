# Site Audit Report

## Executive summary
- Audited the Flask-based Sandbox Hotel PMS application rooted in `sandbox_pms_mvp/`.
- Baseline validation was healthy locally: pre-commit checks passed, launch gate passed, targeted communication tests passed, and the full pytest suite passed (`443 passed, 6 skipped, 2 deselected`).
- The highest-risk areas remain booking, payment, auth, staff operations, and messaging because they are routed through the large `sandbox_pms_mvp/pms/app.py` entry point and shared service modules.
- Applied one low-risk cleanup fix: removed the redundant `notification_service.py` wrapper by inlining its private email-outbox delivery helper into `communication_service.py`, then added a focused regression test for SMTP-backed notification delivery.

## Detected stack/frameworks
- Python 3.11/3.12 runtime targets
- Flask 3.x application factory (`/home/runner/work/sandbox-pms/sandbox-pms/sandbox_pms_mvp/app.py`, `/home/runner/work/sandbox-pms/sandbox-pms/sandbox_pms_mvp/pms/app.py`)
- SQLAlchemy + Flask-Migrate/Alembic
- Pytest test suite under `sandbox_pms_mvp/tests`
- Render Blueprint deployment via `/home/runner/work/sandbox-pms/sandbox-pms/render.yaml`
- Pre-commit hooks for placeholder/public-surface/guardrail checks

## Key risk areas
1. Public booking and payment routes in `sandbox_pms_mvp/pms/app.py`
2. Staff authentication and MFA flows in `sandbox_pms_mvp/pms/app.py` and `sandbox_pms_mvp/pms/services/auth_service.py`
3. Front desk, housekeeping, cashier, and reporting service modules
4. Messaging/communications flows in `sandbox_pms_mvp/pms/services/communication_service.py` and `sandbox_pms_mvp/pms/services/messaging_service.py`
5. Deployment/runtime configuration in `render.yaml` and `sandbox_pms_mvp/pms/config.py`

## Critical issues found
- No local critical failing validation was reproduced during this audit.
- The app still carries significant operational complexity in `sandbox_pms_mvp/pms/app.py`, so future changes in booking/payment/auth flows should continue to be handled surgically.

## Functional issues found
- A redundant internal helper module existed for email-outbox delivery: `sandbox_pms_mvp/pms/services/notification_service.py` was only imported by `communication_service.py` and contained a single helper.
- No broken guest/staff validation commands were reproduced locally; launch gate and regression tests passed.
- GitHub Actions run `23090024976` reported `action_required`, but the Actions API returned no jobs and no failed-job logs at inspection time, so no remote-only failure could be concretely attributed to repository code from this session.

## Redundancy/duplication findings
- Removed confirmed redundancy: `notification_service.py` duplicated a private email-delivery concern that only `communication_service.py` used.
- Deferred duplication candidate: SMTP sending logic also exists in `sandbox_pms_mvp/pms/services/messaging_service.py` for the guest messaging hub. That overlap was documented but not refactored because it spans a separate subsystem and was not required to stabilize current behavior.
- Template-usage pruning was intentionally deferred because simple route-only scans produce false positives for shared/partial templates.

## Obsolete/dead code findings
- Deleted `sandbox_pms_mvp/pms/services/notification_service.py` after verifying the only in-repo reference was the import from `communication_service.py`.
- No other files were deleted because wider dead-code claims were not fully proven by reference tracing during this pass.

## UI/UX polish findings
- No guest-facing or staff-facing UI changes were made in this pass.
- No screenshot was required because no visual surface changed.

## Security/resilience findings
- Existing validation and test coverage around communication delivery remained intact after the cleanup.
- The refactor did not loosen auth, payment, booking, or permission behavior.
- Broad exception handling still exists in several modules; that is a documented resilience/maintainability follow-up rather than a change made here.

## Fixes applied
1. Inlined the private email-outbox delivery helper into `sandbox_pms_mvp/pms/services/communication_service.py`.
2. Removed the now-unused `sandbox_pms_mvp/pms/services/notification_service.py` module.
3. Added a targeted SMTP-dispatch regression test in `sandbox_pms_mvp/tests/test_phase11_communications.py`.

## Items intentionally not changed
- Did not refactor the large route surface in `sandbox_pms_mvp/pms/app.py` because that would be high churn and outside the smallest-safe-change scope.
- Did not consolidate SMTP logic across the communications service and messaging hub because they belong to different operational flows and need broader review before shared extraction.
- Did not delete any templates beyond the verified redundant helper module because template reachability needs deeper usage tracing.
- Did not change database schema, migrations, payment logic, auth logic, or deployment behavior.

## Remaining recommended next steps
1. Investigate why GitHub Actions run `23090024976` shows `action_required` while the API exposes zero jobs.
2. Audit and, where safe, narrow broad `except Exception` blocks in communications, iCal, and app route handlers.
3. Evaluate whether the SMTP transport logic shared by communications and messaging should be centralized behind a common internal helper.
4. Continue any larger cleanup in small subsystem-specific PRs instead of broad rewrites.
