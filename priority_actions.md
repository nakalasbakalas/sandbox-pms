# Priority Actions

## Immediate follow-ups
1. Re-check GitHub Actions run `23090024976` directly in GitHub or via the API once job metadata is available, because it reported `action_required` without exposed job details.
2. Keep future changes to booking, payment, auth, and staff operations scoped and test-backed because local baseline is currently green.

## Medium-priority improvements
1. Review broad `except Exception` patterns in `sandbox_pms_mvp/pms/app.py`, `communication_service.py`, and `ical_service.py`.
2. Decide whether `communication_service.py` and `messaging_service.py` should share an internal SMTP transport helper.
3. Produce a deeper template reachability audit before deleting any guest/staff templates.

## Later enhancements
1. Break out subsystem-specific cleanup PRs for the largest service modules rather than attempting repository-wide rewrites.
2. Consider adding an explicit static-analysis/typecheck step only if the team wants stricter maintenance guardrails.
