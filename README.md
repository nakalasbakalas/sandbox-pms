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

See [sandbox_pms_mvp/DEPLOYMENT-TOPOLOGY.md](sandbox_pms_mvp/DEPLOYMENT-TOPOLOGY.md) for the URL model, canonical-host behavior, and deployment runbook.
For platform cutover steps, see [DEPLOYMENT-RUNBOOK.md](DEPLOYMENT-RUNBOOK.md).
For hosted-payment provider setup on the live `book` origin, see [PAYMENT-CUTOVER-RUNBOOK.md](PAYMENT-CUTOVER-RUNBOOK.md).
Production-oriented environment defaults for the live domain split are in [sandbox_pms_mvp/.env.production.example](sandbox_pms_mvp/.env.production.example).

Repo layout:

- the application intentionally lives under `sandbox_pms_mvp/`
- repo-level deployment files such as [render.yaml](render.yaml) and [.gitignore](.gitignore) now treat that subtree as the canonical app root
- local-only state such as virtualenvs, SQLite files, caches, and instance data are ignored at the repo root
