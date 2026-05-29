# Sandbox Hotel PMS Launch Checklist

## Environment

- [ ] `DATABASE_URL` is configured for the production PostgreSQL database.
- [ ] `SESSION_SECRET` is configured with a long random value.
- [ ] `VITE_PMS_API_MODE=server` is set for production builds.
- [ ] A bootstrap credential is set for the first deploy: `SEED_USER_PASSWORD_HASH` is preferred, or `SEED_ADMIN_PASSWORD` is set as a one-time temporary secret.
- [ ] LINE credentials are configured only if live messaging is enabled.
- [ ] No production secrets are committed to the repository.

## Database

- [ ] Render production service is linked to `sandbox-hotel-pms-db-v43m`, not the legacy web service named `sandbox-hotel-pms-db`.
- [ ] Database backup/snapshot is taken before applying migrations or seed to an existing production database.
- [ ] `npm run db:generate` passes.
- [ ] `npm run db:migrate` has been applied to the target database.
- [ ] The Render Blueprint preDeploy command runs `npm run db:migrate && npm run db:seed`.
- [ ] `npm run db:seed` has been run with secure bootstrap credentials and created the initial admin user.
- [ ] Rooms 201-215 and 301-315 are sellable.
- [ ] Rooms 216 and 316 are out of service / non-sellable.
- [ ] The bootstrap admin has logged in successfully and the temporary seed credential has been rotated or removed.

## Security

- [ ] Backend auth login works.
- [ ] Logout clears the session.
- [ ] Admin, manager, front desk, housekeeping, and cashier roles were tested.
- [ ] Unauthorized users cannot open protected pages.
- [ ] Unauthorized users cannot call protected API mutations.
- [ ] User-management and settings actions are admin/manager restricted as intended.

## Hotel Workflows

- [ ] Create reservation succeeds with valid dates.
- [ ] Invalid date ranges are rejected.
- [ ] Room assignment rejects occupied, blocked, out-of-service, and non-sellable rooms.
- [ ] No-overbooking is verified by room type and assigned room.
- [ ] Check-in requires a valid assigned room.
- [ ] Check-in marks the room occupied.
- [ ] Checkout requires settlement or explicit unpaid override.
- [ ] Checkout marks the room dirty and sends it to housekeeping.
- [ ] Payment creation updates folio paid/balance status.
- [ ] Housekeeping can move dirty -> cleaning -> clean -> inspected.
- [ ] Critical mutations create audit/timeline entries.

## Localization And UX

- [ ] Thai/English language switch persists for staff workflows.
- [ ] Main navigation labels are verified in Thai.
- [ ] Status labels are verified in Thai and English.
- [ ] No demo/prototype copy is visible in launch paths.
- [ ] Empty states are operational and not placeholder-like.
- [ ] Tablet reception and housekeeping views are usable.

## Operations

- [ ] HTTPS/domain is configured.
- [ ] Backup and restore plan is documented for the database.
- [ ] Rollback plan exists for app and database migrations.
- [ ] Monitoring/health checks are configured and the `/healthz` endpoint returns 200.
- [ ] `npm run launch:check` passes.
- [ ] Database-mutating e2e tests have passed against staging with `PMS_E2E_MUTATE_DB=1`.
