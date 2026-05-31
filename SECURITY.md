# Security

## Sandbox Hotel PMS Security Policy

Server mode uses signed `HttpOnly` cookie sessions. Frontend code must not persist session material in `localStorage`, Spark KV, IndexedDB, JavaScript-readable cookies, or bearer headers. API requests rely on same-origin cookie credentials.

The login endpoint includes application-layer throttling by normalized account and client IP. Defaults are documented in `.env.example` and [docs/operational-runbook.md](docs/operational-runbook.md). Keep an upstream WAF or platform rate limit in place where available, but do not rely on upstream controls as the only brute-force protection.

Do not commit live secrets, production database URLs, LINE channel credentials, session secrets, guest data exports, or password hashes tied to real users. Use generated password hashes for seeded users and keep live secrets in the hosting provider.

## Reporting Security Issues

Report suspected vulnerabilities privately to the repository owner or operational owner. Do not disclose guest data, staff credentials, payment references, or live integration tokens in public issues, pull requests, screenshots, or chat transcripts.

Include:

- Affected environment and URL.
- Reproduction steps.
- Expected and actual behavior.
- Impact assessment.
- Relevant logs with credentials and guest data redacted.

## High-Scrutiny Surfaces

Treat these areas as security-sensitive and require full validation before release:

- Authentication, sessions, RBAC, user management, and seed users.
- Guest data, documents, reservation history, folios, payments, and exports.
- Production database migrations, import scripts, backup/restore, and rollback paths.
- Deployment config, `render.yaml`, domain/origin allowlists, and live secrets.
- LINE, OTA, payment, WAF, monitoring, and any other live integration.
