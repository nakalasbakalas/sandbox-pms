# Sandbox Hotel PMS Deployment

## Required Environment

- `DATABASE_URL`: PostgreSQL connection string for the production database.
- `SESSION_SECRET`: long random secret for signed PMS sessions.
- `VITE_PMS_API_MODE=server`: enables backend login/session mode in the frontend.
- Optional LINE settings only after the live channel is ready:
  - `LINE_CHANNEL_SECRET`
  - `LINE_CHANNEL_ACCESS_TOKEN`

Do not commit production secrets. Use the deployment platform secret manager.

## Existing Render Production Target

The current production Blueprint targets the Render web service `sandbox-hotel-pms` and reuses the existing managed PostgreSQL database `sandbox-hotel-pms-db-v43m`. Do not use the legacy Render web service named `sandbox-hotel-pms-db` as the database target; it is a Python web service, not the PostgreSQL datastore.

Render internal database URLs only resolve from inside Render's private network. Use Render's managed database link or the external database URL for local migration checks. Never commit either URL.

## Initial Database Setup

1. Generate Prisma Client:
   ```bash
   npm run db:generate
   ```
2. Apply migrations:
   ```bash
   npm run db:migrate
   ```
3. Seed Sandbox Hotel inventory and bootstrap users:
   ```bash
   SEED_ADMIN_PASSWORD="replace-with-long-temporary-password" npm run db:seed
   ```

The seed creates Sandbox Hotel, Twin rooms 201-215, Double rooms 301-315, and non-sellable rooms 216 and 316 as out of service. Seed passwords are hashed with PBKDF2 and are never printed.

## Password Hash Option

To provide a precomputed bootstrap hash instead of temporary password environment variables:

```bash
npm run security:hash-password -- "long-temporary-password"
```

Set the result as `SEED_USER_PASSWORD_HASH` only for initial provisioning, then rotate real staff passwords.

## Production Run

```bash
npm run build
npm start
```

Health checks:

```bash
curl https://your-domain.example/api/health
curl https://your-domain.example/api/health?deep=1
```

## Launch Gate

Run before every production release:

```bash
npm run launch:check
```

When `DATABASE_URL` is present, the command also checks Prisma migration status. Database-mutating e2e tests run only when `PMS_E2E_MUTATE_DB=1`; use that only against a disposable or staging database.

## Current Production Boundary

The Node backend now enforces auth/RBAC and transaction-safe reservation, assignment, check-in, check-out, housekeeping, and payment mutations. The React UI can still run in local/Spark mode for offline workflows; set `VITE_PMS_API_MODE=server` for backend sessions in deployed environments.
