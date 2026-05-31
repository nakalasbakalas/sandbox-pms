# AAA+ Readiness Completion Audit

Date: 2026-05-31

This document maps the external audit findings in `C:/Users/nakal/Downloads/deep-research-report.md` to the current repo state.

## Findings Closed

| Audit finding | Current evidence |
| --- | --- |
| Browser-stored bearer token flow | Frontend auth no longer stores or reads `auth:pms-token`; API helpers use same-origin cookie credentials; server login no longer returns a session token body; server auth reads only the `pms_session` HttpOnly cookie. |
| No repository-enforced CI | `.github/workflows/ci.yml` runs install, Prisma generation, lint, typecheck, business tests, Playwright E2E smoke, build, and launch gate checks on pull requests and `main` pushes. |
| No real browser/UI automation | `npm run test:e2e` now starts Vite, logs in with Playwright, verifies Today and Board navigation, performs checkout and check-in front-desk flows, confirms no legacy browser token is written, and runs local documentation-link smoke. |
| No application-layer login throttling | `server/login-throttle.mjs` enforces per-IP and per-account throttling; `/api/auth/login` returns `429` with `Retry-After` during lockout; E2E contract tests cover account and IP lockout behavior. |
| Incomplete app containerization | `Dockerfile`, `Dockerfile.dev`, `.dockerignore`, and `docker-compose.yml` provide production build, dev image, and full app + Postgres + migration/seed stack. |
| Dependency lag | React, React DOM, React types, Tailwind packages, Zod, Vite React plugin, and semver-allowed patch/minor packages were updated. Vite 8 and Prisma 7 are held in `docs/dependency-upgrade-plan.md` because current peer/audit evidence makes those major upgrades unsafe to ship now. |
| Missing contributor/governance docs | `CONTRIBUTING.md`, `docs/operational-runbook.md`, `docs/dependency-upgrade-plan.md`, `STAFF-ALERTS.md`, and `SYSTEM-ARCHITECTURE-MAP.md` are present and local doc links pass smoke validation. |

## Verification

The following gates pass locally:

- `npm.cmd run lint`
- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run test:e2e`
- `npm.cmd run build`
- `npm.cmd audit --audit-level=moderate`
- `npm.cmd run launch:check`
- `npm.cmd run live:check`
- `render blueprints validate -o json`

## Final Readiness State

Repo-controlled AAA+ readiness is complete: auth/session hardening, CI, browser E2E, login throttling, containerization, dependency holds, production URL alignment, live health automation, release documentation, and runbooks are all present and validated.

Confirmed live evidence includes `https://book.sandboxhotel.com` health checks after commit `3de37ab`, deep database connectivity, Render PostgreSQL availability, Render starter-plan deployment metadata and successful predeploy logs for the custom-domain service, and signed-cookie session behavior without exposing secrets.

The remaining items are external account-owner evidence, not app code defects:

- Render secret-manager key inventory and rotation dates, with values redacted.
- Render PostgreSQL backup/recovery point and restore-test record.
- Named rollback owner and deputy.
- Upstream WAF/rate-limit rule IDs, thresholds, and non-destructive test result.

Those are tracked in `docs/live-environment-proof.md`, `docs/disaster-recovery.md`, and `docs/upstream-waf-rate-limit.md`.
