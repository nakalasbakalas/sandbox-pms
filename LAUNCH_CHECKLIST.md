# Hotel PMS Launch Checklist

Checked command-based items reflect point-in-time evidence recorded in `docs/launch/evidence/` and `docs/live-environment-proof.md`. Items that require account-owner action, live credentials, production data ownership, provider dashboards, or role-by-role manual sign-off may be closed only by proof or explicit owner accepted-risk sign-off.

Current release posture (2026-08-01): **core PMS engineering-ready and provider-deployed; full operational sign-off remains open**. Merged `main` is `8c22f55ab6503dd5121886b611db9f880911101a` from PR #194. GitHub run `30706415049` passed both required jobs. The paid Render PMS and isolated dry-run OTA worker serve that exact revision, both public domains are verified on the paid PMS, and post-cutover live and edge checks pass. This does not enable real OTA writes or prove credentialed staff acceptance, payment-provider operation, or a recovery restore drill. See `docs/launch/evidence/2026-08-01-final-pms-release.md`.

## Historical 2026-07-04 to 2026-07-07 Evidence Refresh

- [x] Owner-directed completion deploy: commit `d18ea06eb974621281c43a57cf4d5a41994c2775` passed GitHub CI run `28800962218`, deployed live to Render as `dep-d966aj9kh4rs73d9h10g`, and passed post-deploy `live:check`, `public-edge:proof`, `prod:preflight`, and redacted Render Gmail OAuth status on 2026-07-07. Remaining external proof gaps are owner-accepted operational risk; see `docs/launch/evidence/2026-07-07-owner-completion-deploy-and-issue-closure.md`.
- [x] Slice 5BP source commit `72592dacc1d6b3189fe7061aad6fd6ac932df72e` passed GitHub CI run `28700849720`, including launch gate; see `docs/launch/evidence/2026-07-04-slice-5bp-current-checkout-validation-refresh.md` and `docs/launch/evidence/LAUNCH_GATE_RESULTS.md`.
- [x] Local `npm.cmd run launch:evidence` passes cleanly at commit `72592dacc1d6b3189fe7061aad6fd6ac932df72e`; see `docs/launch/evidence/2026-07-04-slice-5bp-current-checkout-validation-refresh.md`.
- [x] Slice 5AT non-destructive baseline validation passes in the current checkout, including `launch:evidence`, `db:doctor`, typecheck, lint, tests, build, production preflight, Render Blueprint validation, live readiness, and whitespace checks; see `docs/launch/evidence/2026-07-03-slice-5at-baseline-validation-refresh.md` and `docs/launch/evidence/DB_DOCTOR_RESULTS.md`.
- [x] Guarded local disposable DB-mutating E2E passes with `ALLOW_DB_E2E=true` against `localhost:55432/sandbox_hotel_e2e`; see `docs/launch/evidence/DB_E2E_POSTURE.md`.
- [x] Guarded local core workflow DB E2E passes against `localhost:55432/sandbox_hotel_e2e`; see `docs/launch/evidence/2026-07-03-slice-5aj-core-workflow-local-db-refresh.md`.
- [x] Local repository/evidence secret hygiene scan passes through `npm.cmd run launch:evidence`; see `docs/launch/evidence/SECRETS_AND_RECOVERY_PROOF.md`, `docs/launch/evidence/2026-07-04-slice-5bn-repo-secret-redaction.md`, and `docs/launch/evidence/2026-07-04-slice-5bp-current-checkout-validation-refresh.md`.
- [x] Public deep health for `https://book.sandboxhotel.com/healthz?deep=1` returns `200` with database OK in the latest public-edge proof refresh; see `docs/launch/evidence/2026-07-04-slice-5bo-cloudflare-waf-boundary-refresh.md`.
- [x] PR #150 setup-gate hardening is owner-approved, merged, deployed to `sandbox-hotel-pms-v43m`, and reprobed on the public custom-domain service. Slice 5AZ confirmed the current live Render deploy `dep-d93ordnaqgkc73cd2ke0` serves commit `1c493116b7eb84ab010097903ff641cd526d8cb6`; unauthenticated setup-complete returns the intended production-disabled `403`.
- [x] Production aggregate room-inventory counts were captured without room numbers or sensitive data. Slice 5BA Render job `job-d93pfr6q1p3s73a2ufh0` on deploy `dep-d93pe7hkh4rs73dp5bcg` returned `33` total rooms across two redacted room-type buckets, with `33` operationally available and `0` inactive.
- [x] Historical production/account-owner issue closure was recorded by owner-directed accepted-risk sign-off for deploy `dep-d966aj9kh4rs73d9h10g`. A later 2026-07-07 pass recorded zone-level Cloudflare WAF/rate-limit proof and Render recovery metadata; credentialed production auth, provider secret inventory/rotation, staff parser review, manual workflow acceptance, and demo/sample cleanup were not independently proven. See `docs/launch/evidence/2026-07-07-owner-completion-deploy-and-issue-closure.md` and `docs/launch/evidence/2026-07-07-cloudflare-waf-zone-proof.md`. This historical evidence does not approve or provider-prove a later candidate.

## Historical 2026-06-15 Validation Evidence

- [x] `npm.cmd run typecheck` passes.
- [x] `npm.cmd run lint` passes.
- [x] `npm.cmd test` passes.
- [x] `npm.cmd run test:e2e` passes, including API contract assertions, documentation link smoke, and Playwright browser smoke.
- [x] `npm.cmd run build` passes.
- [x] `npm.cmd run prod:preflight` passes with the expected warning that LINE credentials are not configured.
- [x] `npm.cmd run render:validate` passes.
- [x] `npm.cmd run live:check` passes against `https://book.sandboxhotel.com` and reports `lineWebhookConfigured=false`.
- [x] `npm.cmd run launch:check` passes.
- [x] `npm.cmd audit --audit-level=high` passes the high-severity threshold.
- [x] Guarded local disposable DB E2E passes with `ALLOW_DB_E2E=true` and `E2E_DATABASE_URL` pointed at `localhost:55432/sandbox_hotel_e2e`.

Scope decisions for LINE, OTA, payments, production users, room inventory, DB-mutating E2E, rollback, and WAF ownership are tracked in `docs/launch-scope-decisions.md`.

## Environment

- [x] `DATABASE_URL` is configured for the production PostgreSQL database.
- [x] `SESSION_SECRET` is configured with a long random value.
- [ ] `SESSION_SECRET` is generated by Render Blueprint or from `npm run prod:credentials`.
- [x] `VITE_PMS_API_MODE=server` is set for production builds.
- [x] `SEED_MODE=prod-safe` is set for production seed.
- [ ] Real login users are configured only through approved hash-only `SEED_USERS_JSON` entries, setup/default owner flow, or admin-created staff records. Approved launch users are Nick `ADMIN`, Hui `ADMIN`, Hotel Manager `MANAGER`, and Front Desk `FRONT_DESK`; active status and intentional-null-email proof are still required.
- [ ] If using bootstrap credentials, approved emails are set explicitly and temporary passwords are stored only in an ignored local credential bundle.
- [x] LINE credentials are configured only if live messaging is enabled.
- [x] `npm run prod:preflight` passes against the exact production env values before deploy.
- [x] No high-confidence unredacted production secret-shaped values are committed in tracked/unignored text files, based on `npm.cmd run launch:evidence` at commit `72592dacc1d6b3189fe7061aad6fd6ac932df72e`; see `docs/launch/evidence/2026-07-04-slice-5bp-current-checkout-validation-refresh.md`.

## Database

- [x] Render production service is linked to `sandbox-hotel-pms-db-v43m`, not the legacy web service named `sandbox-hotel-pms-db`.
- [ ] Database backup/snapshot is taken before applying migrations or seed to an existing production database. Nick owns backup/recovery; latest recovery point is unknown until freshly verified in Render.
- [x] `npm run db:generate` passes.
- [x] `npm run db:doctor` reports the intended target database and no failing configured checks.
- [x] `npm run db:migrate` has been applied to the target database.
- [x] The Render service is connected to `nakalasbakalas/sandbox-pms`.
- [x] Historical production deploys ran `npm run db:migrate && npm run db:seed` in `prod-safe` mode without creating fake guests, reservations, payments, invoices, operational room inventory, or demo staff users.
- [ ] Before deploying the release-foundation candidate, verify the active Render service matches the committed migration-only `preDeployCommand: npm run db:migrate`. Routine production deploys must not seed; onboarding/import or recovery seeding is a separate owner-reviewed action.
- [ ] Initial admin/staff login users exist only if explicitly seeded through approved secure credentials.
- [ ] Production room inventory has been configured through an approved operational/onboarding flow, not fake seed data. Nick states current inventory is real; redacted source/admin proof is still required.
- [ ] Any legacy bootstrap admin has logged in successfully and the temporary seed credential has been rotated or removed.

## Security

- [ ] Backend auth login works.
- [ ] Logout clears the session.
- [ ] Admin, manager, front desk, housekeeping, and cashier roles were tested.
- [ ] Unauthorized users cannot open protected pages.
- [ ] Unauthorized users cannot call protected API mutations. Production denial probes should stay non-mutating `GET`/`HEAD` unless Nick separately approves a no-op/invalid mutating payload.
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

- [x] HTTPS/domain is configured.
- [x] The public domain points to the intended Render service and matches `APP_URL` and `ALLOWED_ORIGINS`.
- [x] Backup and restore plan is documented for the database.
- [ ] Latest database backup/recovery point and retention window are freshly verified in Render for launch sign-off. The latest point is currently unknown and must be set up or freshly verified.
- [x] A restore test has passed against a disposable database.
- [x] Rollback plan exists for app and database migrations.
- [ ] Rollback owner and deputy are named and have Render dashboard access.
- [ ] Upstream WAF/rate-limit rules are configured and recorded with rule IDs and thresholds.
- [x] Monitoring/health checks are configured and the `/healthz` endpoint returns 200.
- [x] `npm run typecheck` passes.
- [x] `npm run lint` passes.
- [x] `npm test` passes.
- [x] `npm run build` passes.
- [x] `npm run launch:check` passes.
- [x] `npm run db:e2e:ready` passes against a disposable/staging E2E database.
- [x] Database-mutating E2E tests have passed against a local disposable database with `ALLOW_DB_E2E=true` and a non-production `E2E_DATABASE_URL`.
- [ ] If later required by Nick, database-mutating E2E tests have passed against an approved staging database with `ALLOW_DB_E2E=true`. Current launch engineering proof accepts the local disposable DB E2E boundary; production DB-mutating E2E remains forbidden.
