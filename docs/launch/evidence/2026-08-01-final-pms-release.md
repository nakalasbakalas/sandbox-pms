# 2026-08-01 Final Core PMS Release Evidence

## Verdict

The core Sandbox Hotel PMS is engineering-ready and live on the migrated paid Render service. Full operational sign-off remains open for credentialed staff acceptance, live OTA writes, payment-provider operation, and an actual recovery restore drill.

## Repository and CI

- Source hardening commit: `cb1966a6317c566318004729fb4f93919184acfd`.
- Pull request: #194.
- Merged `main`: `8c22f55ab6503dd5121886b611db9f880911101a`.
- GitHub Actions run: `30706415049`.
- Required jobs passed: `Fast checks and launch gate`; `PostgreSQL migrations, seed, and guarded E2E`.

The release fixes forged Booking Inbox import, cancellation authority/reason/lifecycle bypass, event/action mode confusion, no-op modification processing, and public overpayment bypass. It also pins the production Node major and points the PMS at the isolated dry-run worker.

## Validation

- `npm.cmd test`: pass.
- `npm.cmd run typecheck`: pass.
- `npm.cmd run lint`: pass.
- `npx.cmd prisma validate`: pass.
- `npm.cmd run build`: pass.
- `npm.cmd run test:e2e`: pass.
- Guarded disposable PostgreSQL `npm.cmd run test:e2e:db`: pass.
- `npm.cmd run test:e2e:release-db`: pass, including Booking Inbox cancellation and modification authority/lifecycle coverage.
- `npm.cmd run launch:check`: pass.
- `npm.cmd audit --audit-level=high`: pass with zero vulnerabilities.
- Both Render Blueprints validate.

## Render deployment

- Paid PMS service: `srv-d6ns31h4tr6s73c9i8g0`.
- Final paid deploy: `dep-d9n1p93l550s7395ekog`, exact merge commit, live.
- Runtime: Node `22.23.2`.
- Predeploy: `npm run db:migrate` only.
- Production database: all 26 migrations applied; no pending migration.
- Direct deep health: `https://sandbox-hotel-pms-v43m.onrender.com/healthz?deep=1` returned `200`, application OK, database OK.

- Dry-run worker service: `srv-d9mrlkm417fc73c2o53g`.
- Final worker deploy: `dep-d9n1p38ae00c73amj6fg`, exact merge commit, live.
- Worker remains `OTA_DRY_RUN=true` with autodeploy disabled and `/healthz` configured.
- Signing secret was rotated on both services and omitted from all evidence.
- Signed proof job: `job-d9n1qf3l550s7395git0`, succeeded. The response recorded `workerMode: remote-signed-worker`, `signed: true`, `dryRun: true`, `changed: false`, and safe redacted proof artifacts.

## Public routing and edge proof

- `book.sandboxhotel.com` and `staff.sandboxhotel.com` were detached from free service `srv-d8bchr1akrks73disaog` and verified on the paid PMS.
- Both public deep-health endpoints returned `200` with the production database OK after cutover.
- `npm.cmd run live:check`: pass.
- `npm.cmd run public-edge:proof`: pass through Cloudflare with HSTS, CSP, X-Frame-Options, Cloudflare ray evidence, and unsafe probe paths returning `404`.
- Authenticated Cloudflare dashboard inspection showed 33 enabled zone security rules, including enabled hostname-scoped common-probe blocking and login throttling for the PMS hostnames.
- `npm.cmd run cloudflare:waf:proof -- --require-rules` could not run locally because no Cloudflare API token is stored in the checkout. No token was added.

## Recovery and release boundaries

- Render provider metadata showed three days of point-in-time recovery and at least seven days of export retention. No restore was started, so restoration is not proven.
- Real OTA writes remain disabled and require live provider credentials, selectors/API certification, owner approval, and production proof.
- Credentialed production role-by-role staff acceptance remains open.
- Live payment-provider collection remains open.
- LINE and WhatsApp integrations are optional and currently not configured.

## Local database incident disclosure

During disposable-database setup, one reset command initially targeted the local development database because only `E2E_DATABASE_URL` was overridden while Prisma read `DATABASE_URL`. The local development database was reset and immediately reseeded. Production and staging databases were not touched. Any unbacked-up local-only records that existed before the reset are recoverable only from a local backup. The command was corrected by binding `DATABASE_URL` to the disposable E2E database, and the full guarded database suite then passed.
