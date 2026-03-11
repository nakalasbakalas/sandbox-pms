# Sandbox Hotel PMS - Repository Root

This is the root of the Sandbox Hotel Property Management System repository.

The main application code is located in the `sandbox_pms_mvp/` directory.

## Quick Start

```bash
cd sandbox_pms_mvp
pip install -r requirements.txt
flask db upgrade
flask run
```

## Deployment

This repository is a server-rendered Flask application and requires a Python host with a database.
It is not deployable to GitHub Pages as a static site without a separate export/build step.

Render is now configured through the root [render.yaml](render.yaml) Blueprint. It provisions:

- a Python web service rooted at [sandbox_pms_mvp](sandbox_pms_mvp)
- a managed PostgreSQL database
- predeploy schema migration only
- a `/health` health check

Before the first deploy, set these required secret env vars in Render:

- `AUTH_ENCRYPTION_KEY` using `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Production startup now fails fast if `ADMIN_EMAIL` or `ADMIN_PASSWORD` is missing.

If you stay on the default Render hostname, `APP_BASE_URL` can fall back to `RENDER_EXTERNAL_URL`.
Set `APP_BASE_URL` and `TRUSTED_HOSTS` only after your custom domain or final hostname is known.

For the first production bootstrap on an empty database, run `flask --app app seed-reference-data` and then
`flask --app app bootstrap-inventory` manually from a Render shell or one-off job after the service is up.

For a step-by-step dashboard checklist, use [RENDER_DEPLOY_CHECKLIST.md](RENDER_DEPLOY_CHECKLIST.md).

