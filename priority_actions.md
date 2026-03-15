# Priority Actions

## Immediate follow-ups
1. Verify the latest Render deployment directly in the platform dashboard/logs and complete the documented smoke test (`/health`, homepage, availability, hold flow, staff login, admin pages, seeded data).
2. Investigate the latest PR-head GitHub Actions runs, which completed as `action_required` with zero jobs and no failed-job logs; this likely requires GitHub UI/policy inspection rather than repository edits.
3. Keep future changes to booking, payment, auth, and staff operations scoped and test-backed because the current baseline is green and should not be destabilized.

## Medium-priority improvements
1. Update GitHub Actions usage to stay ahead of the Node 24 marketplace-action migration deadline noted in current CI logs.
2. Review broad `except Exception` patterns in `sandbox_pms_mvp/pms/app.py`, `communication_service.py`, and `ical_service.py`.
3. Decide whether `communication_service.py` and `messaging_service.py` should share an internal SMTP transport helper.
4. Produce a deeper template reachability audit before deleting any guest/staff templates.

## Later enhancements
1. Break out subsystem-specific cleanup PRs for the largest service modules rather than attempting repository-wide rewrites.
2. Consider adding an explicit static-analysis/typecheck step only if the team wants stricter maintenance guardrails.
