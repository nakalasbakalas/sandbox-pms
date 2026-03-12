# Render Deploy Checklist

Use this checklist for the first live Render deployment of this repository.

## 1. Create the Blueprint

In Render:

1. Click `New` -> `Blueprint`.
2. Connect this repository.
3. Confirm Render is reading [render.yaml](render.yaml) from the repo root.

This Blueprint creates:

- web service: `sandbox-hotel-pms`
- Postgres database: `sandbox-hotel-pms-db`

## 2. Enter required secret values

Render will prompt for these `sync: false` variables during the first Blueprint creation:

### `AUTH_ENCRYPTION_KEY`

Generate it locally with:

```powershell
cd C:\Users\nakal\Downloads\sandbox_hotel_pms_mvp\sandbox_pms_mvp
.\.venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Paste the full output into Render.

### `ADMIN_EMAIL`

Recommended value:

```text
admin@yourdomain.com
```

### `ADMIN_PASSWORD`

Use a unique password manager-generated secret.

Recommended minimum:

- 24+ characters
- random, not memorable
- not reused anywhere else

The service will not boot in production if either `ADMIN_EMAIL` or `ADMIN_PASSWORD` is missing.

## 3. Deploy

Approve the Blueprint creation.

Render will then:

1. build the Python service
2. provision the Postgres database
3. run:

```text
flask --app app db upgrade
```

4. start Gunicorn
5. health check `GET /health`

## 4. Bootstrap data once

On a brand-new database, open a Render Shell for the web service and run:

```text
flask --app app seed-reference-data
flask --app app bootstrap-inventory
```

Run `flask --app app sync-role-permissions` only when you intentionally want to apply seeded permission changes to existing system roles.

## 5. First login

After deploy completes:

1. Open the Render service URL.
2. Go to `/staff/login`.
3. Sign in with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` you provided.
4. Immediately change the admin password from the staff security area.

## 6. Post-deploy settings

If you stay on the default Render hostname, the app can use Render's `RENDER_EXTERNAL_URL` automatically.

If you add a custom domain, then manually add these environment variables in the Render dashboard and redeploy:

### `APP_BASE_URL`

Example:

```text
https://hotel.example.com
```

### `TRUSTED_HOSTS`

Examples:

```text
hotel.example.com
```

or

```text
hotel.example.com,sandbox-hotel-pms.onrender.com
```

Use the actual Render hostname shown in your dashboard if it differs.

## 7. Optional production email/payment setup

Leave these disabled until you have real providers ready:

- `PAYMENT_PROVIDER=disabled`
- SMTP variables blank
- Stripe variables blank

When enabling them later, set:

- `PAYMENT_PROVIDER`
- `PAYMENT_BASE_URL` if required by the provider flow
- `SMTP_HOST`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `MAIL_FROM`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

## 8. Smoke test after deploy

Check all of these manually:

1. `/health` returns `{"status":"ok"}`
2. homepage loads
3. availability search works
4. booking hold page opens
5. staff login works
6. admin pages load
7. database-backed content exists after manual bootstrap

## 9. Important note

Do not keep live secret files inside the repository. Use [sandboxhotel-render.template.env](sandbox_pms_mvp/sandboxhotel-render.template.env) only as a local placeholder reference and set the real values directly in Render.
Use Render-managed environment variables only.

