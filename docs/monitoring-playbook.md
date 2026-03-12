# Monitoring Playbook

Use this playbook to triage booking, contact, and public-site incidents.

## Primary Signals

1. Check `/health` first to distinguish general service failure from route-specific issues.
2. Review request logs and error logs with the request_id from the failing path.
3. Prioritize booking and contact regressions because they directly affect conversion.

## Booking and Contact Triage

1. Reproduce the issue on the homepage and booking entry route.
2. Note which CTA, form field, or booking step fails.
3. Capture request_id values and the exact page state before any restart or rollback.

## Operational Response

1. Decide whether the incident needs rollback, hotfix, or monitoring-only follow-up.
2. Keep Render deployment status and health checks visible during mitigation.
3. After the fix, run a smoke test and confirm logs return to the expected baseline.
