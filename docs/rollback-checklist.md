# Rollback Checklist

Use this checklist when a release must be rolled back or paused.

## Before Rolling Back

1. Capture the failing request IDs, screenshots, and the affected booking or contact path.
2. Check whether the issue is code-only or whether database state is involved.
3. Decide whether the fastest safe move is a Render rollback, a revert commit, or a feature disable.

## Rollback Steps

1. Revert the last unsafe change in Render or through Git, depending on the deployment path.
2. Preserve database safety by avoiding ad hoc data edits unless the incident requires them.
3. Run a smoke test of the homepage, booking entry, and health endpoint after rollback.

## After Rollback

1. Confirm the smoke test is green and public booking is stable.
2. Document the rollback reason, timing, and remaining follow-up work.
3. Re-run monitoring checks and keep the incident visible until the replacement fix is validated.
