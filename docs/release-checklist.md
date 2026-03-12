# Release Checklist

Use this checklist before any guest-facing release or launch sign-off.

## Guardrails

1. Run the standard launch gate with `python scripts/launch_gate.py`.
2. Run the strict launch gate with `python scripts/launch_gate.py --strict-launch` when the question is true launch readiness.
3. Confirm there are no placeholder contact values, dead booking or contact CTA targets, or metadata regressions.

## Guest Journey

1. Smoke test the booking search flow from the homepage through booking entry.
2. Verify the contact surface still exposes the expected phone and email paths.
3. Check guest-facing booking, cancel, and modify routes on mobile and desktop.

## Operational Readiness

1. Confirm analytics and consent changes are either implemented or explicitly called out as launch blockers.
2. Review the rollback checklist before deployment so rollback ownership is clear.
3. Confirm monitoring coverage for booking, contact, and health-check failures.

## Release Notes

1. Record the scope, risk, and rollback trigger for the release.
2. Link any follow-up work that should not ship in the same change.
