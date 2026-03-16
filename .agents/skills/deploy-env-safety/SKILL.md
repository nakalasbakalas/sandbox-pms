---
name: deploy-env-safety
description: Use when the task involves deployment, Cloudflare, domains, SSL, environment variables, secrets, staging/production separation, hosting, database connection setup, migrations, backups, rollback planning, or release safety. Do not use for purely local UI polish or content-only edits.
---

# Deploy Environment Safety

## Owns
- secrets handling review
- environment separation verification
- deployment config correctness
- release safety and rollback planning
- smoke test and launch readiness guidance

## Does Not Own
- feature implementation
- UI styling
- business logic changes
- database schema design

## Trigger When
- a deployment is being prepared or reviewed
- environment variables or secrets are added, changed, or audited
- a production incident requires rollback investigation
- staging and production configs diverge unexpectedly

## Read First
- `render.yaml`
- `DEPLOYMENT-RUNBOOK.md`
- `RENDER_DEPLOY_CHECKLIST.md`
- `.env.example` or equivalent config documentation
- `sandbox_pms_mvp/pms/app.py` startup config

## Avoid Reading Unless Needed
- component templates
- static assets
- unrelated service logic

## Goal

Keep deployment and environment work safe, explicit, and production-aware.

## Primary concerns

- secrets handling
- environment separation
- domain / DNS assumptions
- SSL / HTTPS readiness
- app-server configuration
- database connection safety
- migration order
- backup expectations
- rollback planning
- release verification

## Rules

- Never claim an external deployment action was completed unless verified.
- Never assume credentials exist.
- Never hardcode secrets.
- Never mix staging and production casually.
- Never make destructive migration suggestions without warning and rollback thinking.
- Prefer hosted checkout / minimized PCI exposure when payment is involved.
- Prefer explicit, reviewable config changes.

## Working method

1. Inspect the current deployment shape and config files first.
2. Identify missing credentials, missing environment variables, or unsafe assumptions.
3. Separate local preparation from external platform actions.
4. If external access is unavailable, prepare the repo and provide exact next operator steps.
5. Keep production risk low.

## Checklist

### Environment
- local
- staging
- production
- secret naming consistency
- no client exposure of server secrets

### Deployment
- domain routing
- HTTPS
- reverse proxy assumptions
- static asset handling
- app start commands
- health checks

### Database
- connection safety
- migration order
- backup awareness
- restore thinking
- least-surprise config

### Release safety
- rollback path
- smoke test list
- error visibility
- logging expectations
- admin access boundaries

## Output Format
- What is ready
- What is blocked by credentials or platform access
- Exact repo changes made
- Exact manual platform steps remaining
- Production risks still open

## Success Criteria
- all environment variables and secrets are accounted for
- staging and production configs are verified as distinct
- rollback path is stated
- no external action is claimed as complete unless confirmed
