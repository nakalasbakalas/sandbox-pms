# Deployment Runbook

This repo owns the booking engine and staff PMS domains.

## Target Mapping

- `www.sandboxhotel.com` -> `sandbox-hotel-site` Cloudflare Worker
- `book.sandboxhotel.com` -> `sandbox-pms` web service
- `staff.sandboxhotel.com` -> `sandbox-pms` web service

## Render Service Shape

Use the Blueprint in [render.yaml](render.yaml) as the starting point.

- one Python web service
- root directory: `sandbox_pms_mvp`
- two custom domains on the same service:
  - `book.sandboxhotel.com`
  - `staff.sandboxhotel.com`

## Required Production Environment Variables

Set at minimum:

- `APP_ENV=production`
- `MARKETING_SITE_URL=https://www.sandboxhotel.com`
- `BOOKING_ENGINE_URL=https://book.sandboxhotel.com`
- `STAFF_APP_URL=https://staff.sandboxhotel.com`
- `APP_BASE_URL=https://book.sandboxhotel.com`
- `PAYMENT_BASE_URL` only if your active hosted-payment provider requires it
- `TRUSTED_HOSTS=book.sandboxhotel.com,staff.sandboxhotel.com`
- `FORCE_HTTPS=1`
- `ENFORCE_CANONICAL_HOSTS=1`
- `AUTH_COOKIE_SECURE=1`
- `SESSION_COOKIE_SECURE=1`
- `DATABASE_URL`
- `SECRET_KEY`
- `AUTH_ENCRYPTION_KEY`

Render-managed Postgres URLs may be provided as `postgres://` or `postgresql://`.
The app normalizes those values to the SQLAlchemy `postgresql+psycopg://` driver automatically.

`AUTH_ENCRYPTION_KEY` must be a Fernet key (base64-encoded 32-byte secret), not a generic password string.
Generate it locally with:

```powershell
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Treat it as a long-lived secret. Rotating or clearing it without a coordinated migration will invalidate stored MFA secrets and existing encrypted iCal/feed tokens.

## Payment Provider Registration

Register guest-facing payment URLs against the booking origin:

- success / return URL base: `https://book.sandboxhotel.com/payments/return/...`
- guest payment entry URL base: `https://book.sandboxhotel.com/payments/request/...`
- webhook URL: `https://book.sandboxhotel.com/webhooks/payments/<provider>`

Do not use the brochure origin for payment return or webhook handling.

Important detail:

- the PMS generates hosted-checkout success and cancel return URLs dynamically per payment request
- for Stripe-style hosted checkout, there is no separate brochure or staff callback to register
- the fixed dashboard-side registration is the webhook endpoint on the `book` origin

For the exact provider cutover checklist, see [PAYMENT-CUTOVER-RUNBOOK.md](PAYMENT-CUTOVER-RUNBOOK.md).

## DNS Checklist

1. Create or update `www.sandboxhotel.com` to point at the Cloudflare brochure deployment.
2. Create or update `book.sandboxhotel.com` to point at the Render PMS service custom domain.
3. Create or update `staff.sandboxhotel.com` to point at the same Render PMS service custom domain.
4. Verify TLS issuance for all three hosts.
5. Confirm the PMS responds correctly on both `book` and `staff`.

## Smoke Test

After cutover:

1. Visit `https://www.sandboxhotel.com/book` and confirm it redirects to `https://book.sandboxhotel.com/`.
2. Visit `https://www.sandboxhotel.com/staff/login` and confirm it redirects to `https://staff.sandboxhotel.com/staff/login`.
3. Visit `https://book.sandboxhotel.com/staff/login` and confirm canonical redirect sends you to `staff`.
4. Visit `https://staff.sandboxhotel.com/` and confirm canonical redirect sends you to `book`.
5. Create a deposit payment request and confirm the link uses `book`.
6. Trigger a password reset and confirm the email link uses `staff`.
