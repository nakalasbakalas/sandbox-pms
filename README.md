# sandbox-pms

Canonical operational PMS and booking engine for Sandbox Hotel.

Use this repository as the single source of truth for:
- live availability and booking engine behavior
- reservations and inventory allocation
- front desk, housekeeping, cashier, and payments
- staff auth, admin configuration, communications, reporting, and security hardening

The companion `nakalasbakalas/sandbox-hotel-site` repository is brochure-only and must not contain active PMS business logic.

Primary application code lives in `sandbox_pms_mvp/`.

Recommended domain topology:

- `www.sandboxhotel.com` -> `sandbox-hotel-site`
- `book.sandboxhotel.com` -> public booking engine in `sandbox-pms`
- `staff.sandboxhotel.com` -> staff PMS in `sandbox-pms`

Render is now configured through the root [render.yaml](render.yaml) Blueprint. It provisions:

- a Python web service rooted at [sandbox_pms_mvp](sandbox_pms_mvp)
- a managed PostgreSQL database
- predeploy schema migration only
- a `/health` health check

The current committed Blueprint names are:

- web service: `sandbox-hotel-pms-v43m`
- database: `sandbox-hotel-pms-db-v43m`

Before the first deploy, set these required secret env vars in Render:

- `SECRET_KEY` with a unique 32+ character random secret
- `AUTH_ENCRYPTION_KEY` using `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Production startup now fails fast if `SECRET_KEY`, `AUTH_ENCRYPTION_KEY`, `ADMIN_EMAIL`, or `ADMIN_PASSWORD` is missing or insecure.

If you stay on the default Render hostname, `APP_BASE_URL` can fall back to `RENDER_EXTERNAL_URL`.
Set `APP_BASE_URL` and `TRUSTED_HOSTS` only after your custom domain or final hostname is known.

For the first production bootstrap on an empty database, run `flask --app app seed-reference-data` and then
`flask --app app bootstrap-inventory` manually from a Render shell or one-off job after the service is up.
Run `flask --app app sync-role-permissions` only when you intentionally want the seeded permission map reapplied to existing system roles.

For a step-by-step dashboard checklist, use [RENDER_DEPLOY_CHECKLIST.md](RENDER_DEPLOY_CHECKLIST.md).

See [sandbox_pms_mvp/DEPLOYMENT-TOPOLOGY.md](sandbox_pms_mvp/DEPLOYMENT-TOPOLOGY.md) for the URL model, canonical-host behavior, and deployment runbook.
For platform cutover steps, see [DEPLOYMENT-RUNBOOK.md](DEPLOYMENT-RUNBOOK.md).
For hosted-payment provider setup on the live `book` origin, see [PAYMENT-CUTOVER-RUNBOOK.md](PAYMENT-CUTOVER-RUNBOOK.md).
Production-oriented environment defaults for the live domain split are in [sandbox_pms_mvp/.env.production.example](sandbox_pms_mvp/.env.production.example).

Repo layout:

- the application intentionally lives under `sandbox_pms_mvp/`
- repo-level deployment files such as [render.yaml](render.yaml) and [.gitignore](.gitignore) now treat that subtree as the canonical app root
- local-only state such as virtualenvs, SQLite files, caches, and instance data are ignored at the repo root

Codex guardrails:

- install dev tooling with `pip install -r sandbox_pms_mvp/requirements-dev.txt`
- install local hooks with `pre-commit install`
- run `python scripts/launch_gate.py` for the standard guest-facing guardrail pass
- run `python scripts/launch_gate.py --strict-launch` before release sign-off
- use the global `sandbox-launch-gate` skill in Codex when you want the same workflow guided automatically
