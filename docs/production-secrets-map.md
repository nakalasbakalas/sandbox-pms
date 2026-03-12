# Production Secrets Map

Store production secrets in Render. Do not commit real values to this repository.

## Required Secrets

- `SECRET_KEY`: Flask session and signing secret. Must be unique per environment.
- `AUTH_ENCRYPTION_KEY`: Fernet key for encrypted auth state and sensitive app secrets.
- `DATABASE_URL`: Render-managed PostgreSQL connection string.
- `ADMIN_EMAIL`: bootstrap admin identity for production-safe startup validation.
- `ADMIN_PASSWORD`: bootstrap admin credential that should be rotated after first secure access.

## Related Secrets

- `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`: outbound email delivery.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: hosted payment integration when payments are enabled.

## Ownership

1. Keep Render as the source of truth for production secret storage.
2. Rotate secrets when team access changes or when compromise is suspected.
3. Update the release checklist if secret handling changes for a launch-critical flow.
