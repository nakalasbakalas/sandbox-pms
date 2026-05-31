# Contributing

## Local Setup

Use Node.js `22.12.0` or newer. Install dependencies with:

```bash
npm ci --include=dev
```

For local database-backed work, start disposable PostgreSQL:

```bash
npm run db:up
npm run db:ready
```

For a full containerized app plus database stack:

```bash
docker compose up --build
```

## Quality Gates

Run the smallest relevant check first, then widen before opening a pull request:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Before release or deployment-sensitive changes, run:

```bash
npm run launch:check
```

After a production deploy, verify the public runtime:

```bash
npm run live:check
```

Dependency major-version holds are tracked in [docs/dependency-upgrade-plan.md](docs/dependency-upgrade-plan.md).

Database-mutating E2E requires an explicitly disposable database:

```bash
ALLOW_DB_E2E=true E2E_DATABASE_URL="postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public" npm run test:e2e:db
```

## Change Rules

Keep changes focused on one intent. Treat auth, payment-adjacent flows, guest data, production seed behavior, database migrations, and deploy configuration as high-scrutiny surfaces.

Do not commit real credentials, live database URLs, guest data, staff passwords, or production integration tokens. Use generated password hashes for seeded users and keep live secrets in the hosting provider.

## Pull Requests

Every pull request should state:

- What changed.
- Which risk surface it touches.
- Which checks were run.
- Any live-ops or deployment follow-up required.

CI runs install, lint, typecheck, tests, browser E2E smoke, build, and launch checks on pull requests and pushes to `main`.
