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

Render is now configured through the root [render.yaml](C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/render.yaml) Blueprint. It provisions:

- a Python web service rooted at [sandbox_pms_mvp](C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/sandbox_pms_mvp)
- a managed PostgreSQL database
- predeploy migration plus reference-data bootstrap
- a `/health` health check

Before the first deploy, set these required secret env vars in Render:

- `AUTH_ENCRYPTION_KEY` using `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

If you stay on the default Render hostname, `APP_BASE_URL` can fall back to `RENDER_EXTERNAL_URL`.
Set `APP_BASE_URL` and `TRUSTED_HOSTS` only after your custom domain or final hostname is known.

For a step-by-step dashboard checklist, use [RENDER_DEPLOY_CHECKLIST.md](C:/Users/nakal/Downloads/sandbox_hotel_pms_mvp/RENDER_DEPLOY_CHECKLIST.md).
