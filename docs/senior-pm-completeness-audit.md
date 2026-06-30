# Senior PM Completeness Audit

Date: 2026-06-15
Scope: `D:\sandbox-pms`
Issue: GitHub `#135` - Audit current repo structure, dependencies, and completion gaps
Mode: evidence-backed documentation and launch-contract refresh.

## Executive Risk Position

The repository is technically mature for a hotel PMS staging/internal release, but the current evidence does not support a launch-ready or production-user sign-off claim.

The strongest local technical gate now passes, the high-severity dependency audit is clean, the Render Blueprint validates, the public live health check passes, and guarded DB-mutating E2E passed against a local disposable database. Those are engineering readiness signals, not operational launch approval. The remaining launch gaps are mostly proof gaps: approved production users, production room inventory, role-by-role auth checks, manual hotel workflow acceptance, upstream WAF/rate-limit proof, rollback ownership, and live provider decisions.

## Current Validation Evidence

Validation timestamp anchor:

- `Get-Date -Format o`: `2026-06-15T14:25:35.9267983+07:00`.

Commands run on 2026-06-15:

| Command | Result | Evidence notes |
| --- | --- | --- |
| `npm.cmd audit --audit-level=high` | Passed | `found 0 vulnerabilities`. |
| `npm.cmd run launch:check` | Failed on first run | Failed inside `npm.cmd run test:e2e` with `page.goto: Timeout 60000ms exceeded` while navigating to `http://127.0.0.1:59512/`. Before that failure, `db:generate`, `db:doctor`, `lint`, `typecheck`, and business tests had passed. |
| `npm.cmd run test:e2e` | Passed on direct rerun | Documentation link smoke, Playwright browser smoke, and E2E contract checks passed. The default smoke intentionally skips DB mutation; DB workflow proof is recorded separately below. |
| `npm.cmd run launch:check` | Passed on rerun | Ran `db:generate`, `db:doctor`, `lint`, `typecheck`, business tests, E2E smoke, production build, high-severity audit, and `prisma migrate status`. Database checks against local `localhost:55432` dev and E2E databases passed; 4 migrations were up to date. |
| `npm.cmd run render:validate` | Passed | Render Blueprint valid with `totalActions: 2`. |
| `npm.cmd run live:check` | Passed | Checked `https://book.sandboxhotel.com`; DNS resolved to `216.24.57.9`; LINE reported `lineWebhookConfigured=false` and remains optional unless `LIVE_REQUIRE_LINE=true`. |
| `npm.cmd run prod:preflight` | Passed with warning | Warning: LINE credentials are not configured, so live LINE messaging remains disabled. |
| `npm.cmd run db:e2e:ready` | Passed | Prepared guarded local E2E database `localhost:55432/sandbox_hotel_e2e` with `ALLOW_DB_E2E=true`; URL password redacted by script output. |
| `npm.cmd run test:e2e:db` | Passed | Documentation link smoke, Playwright browser smoke, guarded database preparation, and database workflow E2E passed against the local disposable E2E database. |
| `git diff --check` | Passed | No whitespace errors; Git printed CRLF/LF working-copy warnings only. |

Important interpretation:

- The latest `launch:check` pass is current evidence that the integrated local engineering gate can pass.
- The earlier first-run `launch:check` timeout remains historical evidence of cold-start/browser-smoke instability, but it was not reproduced in the latest gate.
- DB-mutating workflow E2E is now proven only for the local disposable `sandbox_hotel_e2e` database, not production data.
- The live check proves public health/auth probe behavior for `book.sandboxhotel.com`; it does not prove staff login readiness, production room inventory, provider credentials, or operational workflow acceptance.

## Repository And Working Tree State

Current git context:

- Branch: `main`, tracking `origin/main`.
- Remote: `https://github.com/nakalasbakalas/sandbox-pms.git`.
- HEAD: `2064cef (HEAD -> main, origin/main, origin/HEAD) Record disposable restore test`.
- Issue `#135` is open with `planning` and `docs` labels and no issue comments at the time of this audit.

Working tree state before this documentation refresh already contained uncommitted hardening changes. This report treats those changes as current local evidence and does not revert or stage them.

Modified tracked files before this report:

- `.env.example`
- `index.html`
- `package.json`
- `package-lock.json`
- `render.yaml`
- `scripts/run-e2e-tests.mjs`
- `server/index.mjs`
- `server/login-throttle.mjs`
- `server/pms-service.mjs`
- `src/components/front-desk/ReceiptDialog.tsx`
- `src/components/messaging/CommunicationCenterView.tsx`
- `src/components/messaging/GuestCommunicationsView.tsx`
- `src/components/rates/RatePushPanel.tsx`
- `src/components/settings/DataBackupExport.tsx`
- `src/components/settings/LineSettings.tsx`
- `src/components/settings/StaffAlertSettings.tsx`
- `src/components/views/CashierView.tsx`
- `src/components/views/SystemStatusView.tsx`
- `src/hooks/use-onboarding.ts`
- `src/lib/alert-routing.ts`
- `src/lib/line.ts`
- `src/lib/print-utils.ts`
- `src/lib/reservation-document-actions.ts`
- `src/lib/server-auth-client.ts`

Untracked files before this report:

- `docs/senior-pm-completeness-audit.md`
- `src/lib/html-escape.ts`

## Architecture Map

Confirmed stack:

- Frontend: Vite, React 19, TypeScript, Tailwind, Radix UI, Phosphor icons, Recharts, Playwright smoke coverage.
- Backend: Node `.mjs` HTTP server in `server/index.mjs`.
- Persistence: Prisma 6.19.3 with PostgreSQL.
- Deployment: Render web service plus Render PostgreSQL from `render.yaml`.
- Operational mode: server-backed PMS API when `VITE_PMS_API_MODE=server`.

### Frontend Routes

`src/App.tsx` defines 24 known PMS routes with permission gates:

| Route | Required permissions |
| --- | --- |
| `today` | `view:board`, `create:reservation`, `view:housekeeping` |
| `board` | `view:board` |
| `rooms` | `view:board`, `view:housekeeping` |
| `front-desk` | `view:board`, `check-in:guest`, `check-out:guest` |
| `reservations` | `view:reservations` |
| `guests` | `view:guests` |
| `housekeeping` | `view:housekeeping` |
| `tablet-housekeeping` | `view:housekeeping` |
| `cashier` | `view:cashier` |
| `rates` | `view:rates` |
| `channels` | `view:channels` |
| `growth-suite` | `view:channels`, `view:rates`, `view:analytics` |
| `reports` | `view:reports` |
| `settings` | `view:settings` |
| `messaging` | `view:messaging` |
| `internal-comms` | `view:messaging` |
| `guest-communications` | `view:messaging` |
| `daily-summary` | `view:reports`, `view:settings` |
| `night-audit` | `view:night-audit` |
| `revenue-analytics` | `view:analytics` |
| `predictive-analytics` | `view:analytics` |
| `system-status` | `view:settings` |
| `user-management` | `manage:users` |
| `data-backup` | `view:settings` |

Auth and setup behavior observed in `src/App.tsx`:

- Unknown routes render a local not-found state.
- Authenticated users enter the app shell.
- Unauthenticated users see setup loading, setup error, onboarding, or login depending on server setup status.
- Route-level permission failures render an access-restricted state.

### Backend/API Routes

Confirmed server/API surface in `server/index.mjs`:

| Method | Path | Surface |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Login |
| `POST` | `/api/auth/logout` | Logout |
| `GET` | `/api/auth/me` | Session/user check |
| `GET` | `/api/auth/can-view` | Route permission probe |
| `GET` | `/api/setup/status` | First-run setup status |
| `POST` | `/api/setup/complete` | First-run setup completion |
| `GET` | `/api/today` | Today dashboard data |
| `GET` | `/api/front-desk/board` | Front desk board |
| `POST` | `/api/front-desk/walk-in` | Walk-in reservation |
| `GET` | `/api/rooms` | Room list |
| `GET` | `/api/channels/ical` | iCal channels |
| `POST` | `/api/channels/ical/:provider` | Enable/update hosted iCal feed |
| `DELETE` | `/api/channels/ical/:provider` | Disable hosted iCal feed |
| `GET` | `/api/settings/room-setup` | Room setup state |
| `POST` | `/api/settings/room-types` | Create room type |
| `PATCH` | `/api/settings/room-types/:id` | Update room type |
| `DELETE` | `/api/settings/room-types/:id` | Delete room type |
| `POST` | `/api/settings/rooms` | Create room |
| `PATCH` | `/api/settings/rooms/:id` | Update room |
| `DELETE` | `/api/settings/rooms/:id` | Delete room |
| `GET` | `/api/reservations` | Reservation list |
| `POST` | `/api/reservations` | Create reservation |
| `PATCH` | `/api/reservations/:id` | Update reservation |
| `POST` | `/api/reservations/:id/assign-room` | Assign room |
| `POST` | `/api/reservations/:id/check-in` | Check in |
| `POST` | `/api/reservations/:id/check-out` | Check out |
| `POST` | `/api/reservations/:id/cancel` | Cancel |
| `POST` | `/api/reservations/:id/no-show` | Mark no-show |
| `POST` | `/api/housekeeping/rooms/:id/status` | Update housekeeping status |
| `POST` | `/api/rooms/:id/operational-status` | Update room operational status |
| `POST` | `/api/payments` | Create payment |
| `POST` | `/api/charges` | Create charge |
| `GET` | `/api/guests` | Guest list |
| `POST` | `/api/guests` | Create guest |
| `PATCH` | `/api/guests/:id` | Update guest |
| `GET` | `/healthz` and `/api/health` | Health |
| `GET`/`POST` | `/api/line/webhook` | LINE webhook config/status and signature-checked webhook |
| `GET` | `/ical/:token.ics` | Hosted iCal feed |

Security-relevant current local changes observed in the dirty tree:

- First-run setup is guarded by `INITIAL_SETUP_TOKEN` or `ALLOW_PUBLIC_SETUP=true`.
- Proxy headers are opt-in through `TRUST_PROXY_HEADERS=true`.
- Production base-origin calculation prefers configured app origin over forwarded host/proto.
- Payment references are required for card, bank-transfer, and online payments.
- LINE browser-side sending is disabled; live sending requires server/provider configuration.
- Local messaging/alert paths no longer claim successful provider delivery without provider configuration.

### Prisma Data Model

`prisma/schema.prisma` defines these models:

- `Property`
- `RoomType`
- `Room`
- `Guest`
- `Reservation`
- `RoomDateInventory`
- `InventoryHold`
- `Folio`
- `Charge`
- `Payment`
- `GuestDocument`
- `ReservationLog`
- `RoomStatusLog`
- `User`
- `RateRule`
- `RateCalendar`
- `Channel`
- `ChannelMapping`
- `ChannelSyncLog`
- `Message`
- `MessageTemplate`
- `AuditLog`

Key enums include:

- `RoomOpStatus`
- `RoomStatus`
- `ReservationStatus`
- `BookingSource`
- `InventoryStatus`
- `HoldStatus`
- `FolioStatus`
- `ChargeCategory`
- `PaymentMethod`
- `ReservationAction`
- `UserRole`
- `RateAdjustmentType`
- `ChannelProvider`
- `ChannelSyncType`
- `MessageChannel`
- `MessageStatus`

Migrations present:

- `20260527000000_init`
- `20260527140000_launch_mvp_hardening`
- `20260530123000_real_property_config`
- `20260531010000_add_out_of_order_room_op_status`

Current validation evidence from `launch:check` rerun:

- Prisma client generation passed.
- `db:doctor` reported Prisma validate `ok`.
- Local `DATABASE_URL` and `E2E_DATABASE_URL` connectivity passed.
- Local dev and E2E migration status passed.
- `prisma migrate status` reported 4 migrations and schema up to date for the local dev database.

### Deployment Config

`render.yaml` currently defines:

- Web service: `sandbox-hotel-pms-v43m`.
- Runtime: Node.
- Plan: `starter`.
- Build: `npm ci --include=dev && npm run db:generate && npm run build`.
- Predeploy: `npm run db:migrate && npm run db:seed`.
- Start: `npm run start`.
- Health path: `/healthz`.
- `autoDeploy: false`.
- App URL: `https://book.sandboxhotel.com`.
- Allowed origins: `https://book.sandboxhotel.com`, `https://sandbox-hotel-pms-v43m.onrender.com`, `https://sandbox-hotel-pms.onrender.com`.
- Production first-run setup: `ALLOW_PUBLIC_SETUP=false`, `INITIAL_SETUP_TOKEN` secret.
- Proxy trust: `TRUST_PROXY_HEADERS=false`.
- Database binding: `sandbox-hotel-pms-db-v43m`.
- Seed mode: `prod-safe`.
- Secrets and optional provider keys are marked `sync: false` where appropriate.

`npm.cmd run render:validate` passed on 2026-06-15.

### Operational Docs

Current docs with launch relevance:

- `LAUNCH_CHECKLIST.md`: 25 checked items and 35 unchecked items. Unchecked items include production secret proof, production users, production room inventory, role-by-role auth checks, core workflow acceptance, localization/tablet checks, rollback ownership, WAF/rate-limit rule proof, and DB-mutating E2E.
- `docs/live-environment-proof.md`: records point-in-time Render, DNS, health, database, restore-test, the 2026-06-15 local/live validation refresh, and remaining provider-side proof gaps.
- `docs/production-environment.md`: explicitly says the current production server does not consume live OTA or payment provider credentials, and warns not to claim OTA, card, PromptPay, or payment-gateway accounts are live without provider adapters, secrets, sandbox tests, and webhook checks.
- `docs/disaster-recovery.md`: restore procedure exists and a disposable restore test passed on 2026-06-07, but owner/deputy/database-recovery assignments are still marked TBD.
- `docs/upstream-waf-rate-limit.md`: app login throttling exists, but upstream Cloudflare/edge rule IDs, thresholds, and test evidence are still required.
- `docs/ical-ota-setup-guide.md`: iCal is positioned as date-block/reservation-pull support; guest details, rates, restrictions, payments, and manual confirmation remain outside iCal automation.
- `docs/database.md`: documents production database safety, `prod-safe` seeding, room import guardrails, and the rule that mutating E2E must never use production data.
- `docs/operational-runbook.md`: points to release checks, live evidence, rollback, restore, and incident notes.

## Dependency Status

Current high-severity audit:

- `npm.cmd audit --audit-level=high`: passed with `found 0 vulnerabilities`.

Relevant current `package.json` and lockfile changes:

- `@github/spark` changed from `>=0.43.1 <1` to `^0.46.3`.
- `vite` changed from `^7.3.3` to `^7.3.5`.
- `overrides.esbuild` added as `0.28.1`.
- `package-lock.json` updated `@github/spark` to `0.46.3`.
- `package-lock.json` updated `vite` to `7.3.5`.
- `package-lock.json` updated top-level `esbuild` and platform packages to `0.28.1`.
- Older nested Vite `esbuild@0.27.7` lockfile entries were removed.

Dependency risk interpretation:

- The previous high-severity `vite`/`esbuild` advisory state is no longer reproduced by the current high-severity audit.
- This is current local evidence only. Re-run `npm.cmd audit --audit-level=high` after every package or lockfile change and before release.
- `npm audit` does not prove runtime provider safety, production credential hygiene, or browser smoke stability.

## Completion Assessment

| Area | Current status | Evidence |
| --- | --- | --- |
| Repo architecture map | Current in this report | Frontend routes, API routes, Prisma models/migrations, deployment config, and ops docs are enumerated above. |
| Local technical release gate | Passes | Latest `npm.cmd run launch:check` passed on 2026-06-15. |
| Cold E2E reliability | Watch item | Earlier `launch:check` failed on a 60s Playwright navigation timeout before passing on rerun; latest pass did not reproduce it. |
| Dependency audit | Clean at high threshold | `npm.cmd audit --audit-level=high` found 0 vulnerabilities. |
| Render Blueprint | Valid | `npm.cmd run render:validate` passed. |
| Live public health | Passing, limited proof | `npm.cmd run live:check` passed against `https://book.sandboxhotel.com`; LINE remains optional/disabled. |
| Production env preflight | Passing with known disabled provider | `npm.cmd run prod:preflight` passed with LINE disabled warning. |
| Production users | Not proven | Launch checklist still has user and bootstrap credential items unchecked. |
| Production room inventory | Not proven | Launch checklist still requires approved operational/onboarding inventory proof. |
| Auth/RBAC launch proof | Not signed off | Code has route permissions, but role-by-role manual checks remain unchecked. |
| Core hotel workflow acceptance | Not signed off | Reservation, overbooking, check-in, checkout, payment/folio, housekeeping, and audit/timeline acceptance items remain unchecked. |
| DB-mutating E2E | Passed locally | `db:e2e:ready` and `test:e2e:db` passed with `ALLOW_DB_E2E=true` against local disposable `sandbox_hotel_e2e`. |
| LINE messaging | Optional/disabled, not live | Live/preflight checks report LINE not configured. |
| OTA/payment provider integrations | Not live by docs | Production docs state no live OTA/payment provider adapters are consumed by the server. |
| WAF/rate-limit | Not proven upstream | App throttle exists; upstream edge rule IDs/thresholds/test proof are still missing. |
| DR/rollback | Partially proven | Disposable restore test passed; rollback owner/deputy/access proof still missing. |
| Localization/tablet launch acceptance | Not signed off | Thai/English labels, demo copy sweep, empty states, tablet reception/housekeeping usability remain unchecked. |

## Remaining Launch Gaps

### P0 - Must Close Before Production-User Sign-Off

1. Production users and secure access path are not proven.
   - Confirmed evidence: `LAUNCH_CHECKLIST.md` still leaves real login users, bootstrap credential controls, initial admin/staff users, backend login, logout, role testing, unauthorized page access, unauthorized API mutations, and user/settings restrictions unchecked.
   - Required proof: approved hash-only `SEED_USERS_JSON` or explicitly approved legacy bootstrap, login/logout evidence, role-by-role route and mutation checks, temporary credential rotation/removal if any bootstrap path was used.

2. Production room inventory is not proven.
   - Confirmed evidence: the checklist still requires production room inventory through approved operational/onboarding flow and explicitly not fake seed data.
   - Required proof: approved room inventory source, import/onboarding command or UI path, setup status proof, and target environment verification.

3. Core hotel workflows lack signed acceptance evidence.
   - Confirmed evidence: checklist items for valid reservation creation, invalid date rejection, blocked/occupied/non-sellable assignment rejection, overbooking rejection, check-in occupancy, checkout dirty-room handoff, folio/payment balance updates, housekeeping status progression, and audit/timeline records remain unchecked.
   - Required proof: dated pass/fail evidence from staging or controlled production-like environment, with any deferrals explicitly owned and dated.

4. DB-mutating E2E has only been proven on local disposable data.
   - Confirmed evidence: `npm.cmd run db:e2e:ready` and `npm.cmd run test:e2e:db` passed with `ALLOW_DB_E2E=true` against `localhost:55432/sandbox_hotel_e2e`.
   - Required proof before production sign-off: decide whether this local disposable proof is accepted, or rerun against a staging database controlled by the launch owner.

5. Production secret hygiene and owner proof are incomplete.
   - Confirmed evidence: checklist still leaves no-production-secrets proof unchecked, and `docs/live-environment-proof.md` says secret key names were verified without rotation timestamps.
   - Required proof: redacted Render secret inventory metadata, key names and rotation dates, no committed production secrets, and owner confirmation.

### P1 - Must Close Before Guest-Facing Launch Or Formally Defer

1. Cold-start E2E/browser-smoke reliability is unstable.
   - Confirmed evidence: first `npm.cmd run launch:check` failed on 60s Playwright navigation timeout; direct rerun and second launch check passed.
   - Required action: increase or adaptive-wait the first browser navigation timeout, add dev-server readiness evidence, or accept this as a documented local Windows cold-start flake with CI-specific mitigation.

2. Upstream WAF/rate-limit proof is missing.
   - Confirmed evidence: `docs/upstream-waf-rate-limit.md` says no Cloudflare token/zone/rule evidence was available and requires rule IDs, thresholds, actions, hostnames, and non-destructive test results.
   - Required action: account owner configures/exports upstream edge controls and records redacted proof.

3. Rollback ownership is incomplete.
   - Confirmed evidence: `docs/disaster-recovery.md` still requires primary rollback owner, deputy, database recovery owner, and WAF/rate-limit owner with access.
   - Required action: assign named owners, confirm dashboard access, and record latest known-good deploy ID before launch.

4. Provider integration posture needs sign-off.
   - Confirmed evidence: LINE is disabled by live/preflight checks; production docs state OTA/payment providers are not live server integrations.
   - Required action: write a launch decision: disabled/manual, iCal-only/metadata-only, or fully live with credentials, sandbox tests, and webhook proof. Do not let UI or launch notes imply live automation where only PMS recording/manual workflows exist.

5. Localization/tablet/manual ops acceptance is not complete.
   - Confirmed evidence: Thai/English labels, demo/prototype copy, operational empty states, tablet reception, and tablet housekeeping items are still unchecked.
   - Required action: manual device/viewport review with operations lead, then record current evidence.

### P2 - Post-Sign-Off Quality And Maintainability

1. Documentation sprawl still creates confidence risk.
   - Confirmed evidence: many root-level historical completion documents remain alongside current docs and can overstate readiness if read out of context.
   - Recommended action: add a current-status index that points to this audit, `LAUNCH_CHECKLIST.md`, and live proof docs, then archive or mark stale historical "complete" docs.

2. Build output remains large in several chunks.
   - Confirmed evidence: latest build emitted large chunks such as `index` around 1.15 MB, `ReportsView` around 589 KB, and `SettingsView` around 355 KB before gzip.
   - Recommended action: performance budget and chunk review after launch blockers, not before P0 proof.

3. Line-ending warnings add noise to validation.
   - Confirmed evidence: `git diff --check` passed but printed CRLF/LF warnings for many modified files.
   - Recommended action: normalize repository `.gitattributes` or accept platform-specific warnings explicitly.

## Assumptions And Unknowns

Confirmed facts:

- Current local `launch:check` passes.
- High-severity npm audit is clean in this checkout.
- Render Blueprint validates locally.
- Public live health check for `https://book.sandboxhotel.com` passes.
- LINE live messaging is not configured in the checked environment.
- Launch checklist still has account-owner, production-data, role-matrix, workflow-acceptance, WAF, and recovery-owner items unchecked.
- DB-mutating E2E passed only against local disposable data, not production data.

Assumptions:

- The local uncommitted hardening changes are intended work in progress because issue `#135` explicitly says to preserve them.
- The local `localhost:55432` databases are disposable/dev/E2E targets based on `db:doctor` output, not production targets.
- The launch checklist remains the source of truth for manual acceptance until superseded by a newer signed checklist.

Unknowns requiring human/provider access:

- Current Render dashboard secret rotation timestamps.
- Whether approved staff/admin user records exist in production with hash-only credentials.
- Whether production room inventory has been configured and verified on the intended live service.
- Whether the account owner has configured Cloudflare or equivalent upstream WAF/rate-limit rules.
- Whether named rollback and database recovery owners have active dashboard access.
- Whether hotel operations accepts manual/iCal-only OTA and PMS-recorded payment workflows for launch.

## Recommended Execution Plan

1. Close P0 operational proof before changing more product UI.
   - Verify production users.
   - Verify production room inventory.
   - Run core reservation/check-in/checkout/payment/housekeeping/audit acceptance.
   - Decide whether local disposable DB E2E is sufficient or rerun DB-mutating E2E against staging data.
   - Record evidence in `LAUNCH_CHECKLIST.md` and `docs/live-environment-proof.md`.

2. Stabilize the release gate.
   - Monitor or document the earlier cold `test:e2e` navigation timeout.
   - Re-run `npm.cmd run launch:check`.
   - Keep the earlier first-run failure in the evidence register as a watch item unless CI or repeated local runs prove it stable.

3. Finish provider and operations sign-off.
   - Decide LINE/OTA/payment launch posture.
   - Configure upstream WAF/rate-limit and record redacted proof.
   - Assign rollback, deputy, database recovery, and WAF owners.
   - Verify Thai/English and tablet workflows.

4. Only after P0 proof, prepare a final go/no-go packet.
   - Include current command outputs, exact dates, checked launch checklist items, accepted deferrals, and owner names.
   - Avoid any wording that claims launch-ready, live integration, or production-user readiness unless the matching evidence is in the repo or provider register.

## Immediate Next Commands

For DB-mutating workflow proof, use only a disposable/staging database:

```powershell
$env:ALLOW_DB_E2E='true'
$env:E2E_DATABASE_URL='postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public'
npm.cmd run db:e2e:ready
npm.cmd run test:e2e:db
```

For release gate follow-up after any material code/config change:

```powershell
npm.cmd audit --audit-level=high
npm.cmd run launch:check
npm.cmd run render:validate
npm.cmd run live:check
git diff --check
```
