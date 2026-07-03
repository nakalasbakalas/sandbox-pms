# Database Doctor Results

Status date: 2026-07-03T09:50:07+07:00.

Verdict: local database doctor passed. This is local database readiness proof only; it is not production database proof and it is not staging DB-mutating E2E acceptance.

## Command

| Command | Result | Evidence Summary |
| --- | --- | --- |
| `npm.cmd run db:doctor` | Passed | Prisma validate, database connectivity, and Prisma migrate status passed for both configured local database targets. No failing configured checks were reported. |

## Redacted Target Summary

| Environment variable | Target | Result |
| --- | --- | --- |
| `DATABASE_URL` | `localhost:55432/sandbox_hotel_dev`, schema `public`, user `sandbox`, password redacted by the script | Connectivity and migrate status passed. |
| `E2E_DATABASE_URL` | `localhost:55432/sandbox_hotel_e2e`, schema `public`, user `sandbox`, password redacted by the script | Connectivity and migrate status passed. |

## DB-Mutating E2E Boundary

Database-mutating E2E remains blocked unless `ALLOW_DB_E2E=true` is explicitly set. The configured E2E database in this run was the local disposable `sandbox_hotel_e2e` target on `localhost:55432`; no production database mutation or production-like E2E was performed.
