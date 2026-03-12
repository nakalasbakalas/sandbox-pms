---
name: deploy-env-safety
description: Use when the task involves deployment, Cloudflare, domains, SSL, environment variables, secrets, staging/production separation, hosting, database connection setup, migrations, backups, rollback planning, or release safety. Do not use for purely local UI polish or content-only edits.
---

# Deploy Environment Safety

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

## Output expectations

Report:
- what is ready
- what is blocked by credentials or platform access
- what exact repo changes were made
- what exact manual platform steps remain
- what production risks still exist
