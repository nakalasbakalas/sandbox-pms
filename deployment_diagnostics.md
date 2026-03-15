# Deployment Diagnostics

## Deployment configuration summary
- Platform target inferred from repo: **Render Blueprint**
- Blueprint file: `render.yaml`
- App root: `sandbox_pms_mvp`
- Runtime: `python`
- Health check: `/health`
- Predeploy migration step: `flask --app app db upgrade`
- Start command: Gunicorn serving `app:app`
- Web region: `oregon`
- Database region: `oregon`
- Custom domains:
  - `book.sandboxhotel.com`
  - `staff.sandboxhotel.com`

## Environment/config alignment
- `sandbox_pms_mvp/pms/config.py`:
  - normalizes `DATABASE_URL` into a SQLAlchemy psycopg URI
  - infers `TRUSTED_HOSTS` from `APP_BASE_URL`, `BOOKING_ENGINE_URL`, `STAFF_APP_URL`, `MARKETING_SITE_URL`, `RENDER_EXTERNAL_URL`, and explicit host entries
  - defaults `BOOKING_ENGINE_URL` and `STAFF_APP_URL` coherently from `APP_BASE_URL`
- `render.yaml` sets matching URL env vars:
  - `MARKETING_SITE_URL=https://www.sandboxhotel.com`
  - `BOOKING_ENGINE_URL=https://book.sandboxhotel.com`
  - `STAFF_APP_URL=https://staff.sandboxhotel.com`
  - `APP_BASE_URL=https://book.sandboxhotel.com`
  - `TRUSTED_HOSTS=book.sandboxhotel.com,staff.sandboxhotel.com,sandbox-hotel-pms-v43m.onrender.com`

## Inferred deployment risks
1. **External secret dependency**
   - Render secrets are intentionally unsynced and must be present at deploy time.
   - Missing/weak secrets will block secure startup.
2. **Migration safety**
   - Recent production commits specifically fixed PostgreSQL boolean defaults in migrations, which indicates migrations are an active deployment risk area and should continue to be reviewed carefully.
3. **Live verification gap**
   - No Render dashboard or runtime log access was available from this session, so live deploy success/failure could not be proven directly.
4. **CI platform drift**
   - Latest successful GitHub Actions logs include a Node.js 20 deprecation warning for marketplace actions. This is not a deploy blocker today, but it is a time-bound maintenance risk.
5. **GitHub Actions dispatch anomaly**
   - The latest PR-head workflow runs (`23102726132`, `23102757598`) completed as `action_required` without starting any jobs and without exposing failed-job logs through the API.

## Build/runtime mismatch findings
- No repo-level build command exists beyond Python dependency install and runtime startup.
- Current CI and local validation show no mismatch between repository code and the tested runtime path.
- No asset-path breakage was reproduced locally.
- One documentation-only mismatch was found and fixed: broken absolute local markdown links in `sandbox_pms_mvp/README.md`.

## Env/config mismatches found
- No code-vs-blueprint env var mismatch was reproduced.
- Remaining env risk is operational rather than repository-based: secrets and optional provider credentials must be set correctly in Render.

## Platform-specific blockers
- **Blocked externally:** confirming the latest Render deployment status, release logs, and post-deploy smoke results.
- **Blocked externally:** verifying whether the latest deployment required a manual bootstrap (`seed-reference-data`, `bootstrap-inventory`) on the target database.
- **Blocked externally:** determining why the latest PR-head GitHub Actions runs resolved to `action_required` with zero jobs and no logs.

## Exact recovery steps requiring external access
1. Open the Render dashboard for service `sandbox-hotel-pms-v43m`.
2. Confirm the latest deploy build, migration step, and health check all completed successfully.
3. Verify required secrets exist and are non-placeholder:
   - `SECRET_KEY`
   - `AUTH_ENCRYPTION_KEY`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
4. If the target database was freshly provisioned, run:
   - `flask --app app seed-reference-data`
   - `flask --app app bootstrap-inventory`
5. Run the documented smoke test:
   - `GET /health`
   - homepage
   - availability search
   - booking hold page
   - staff login
   - admin pages
   - seeded data presence
6. Schedule a CI maintenance PR to address GitHub’s Node 24 marketplace-action migration.
7. Open the latest PR-head Actions runs in the GitHub UI and check for approval, policy, or workflow-dispatch warnings that are not exposed through the MCP job/log APIs.
