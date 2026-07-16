# Runbook - Hotel Ops AI Command Center

## Local Setup

1. Install dependencies.
2. Configure a local or disposable database URL.
3. Generate the Prisma client.
4. Apply migrations and seed only approved local/staging data.
5. Start the app in server API mode.

Commands:

```powershell
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run build
npm.cmd start
```

Use `VITE_PMS_API_MODE=server` for the frontend to use backend Hotel Ops routes.

## Required Environment

Core:

```env
DATABASE_URL=postgresql://...
SESSION_SECRET=...
OTA_DRY_RUN=true
```

Optional remote worker:

```env
OTA_WORKER_BASE_URL=https://...
OTA_WORKER_SHARED_SECRET=...
```

Optional scheduled scans:

```env
HOTEL_OPS_SCAN_INTERVAL_MINUTES=15
```

Cron expressions can be stored with `HOTEL_OPS_SCAN_CRON`, but cron execution must be provided by external infrastructure calling `POST /api/ops/scan/run`.

OTA credentials must be platform secrets only. Do not commit or log them. Booking.com adapter secrets are read from `BOOKING_COM_USERNAME` and `BOOKING_COM_PASSWORD`, with `BOOKING_USERNAME` and `BOOKING_PASSWORD` kept as compatibility aliases. Optional Agoda, Trip.com, and Expedia skeletons report credential status from `AGODA_USERNAME` / `AGODA_PASSWORD`, `TRIP_COM_USERNAME` / `TRIP_COM_PASSWORD`, and `EXPEDIA_USERNAME` / `EXPEDIA_PASSWORD`. Those adapters still run as dry-run skeletons; real browser reads or writes need verified selectors, safe test-date proof, and account-owner approval.

Booking email intake uses `BOOKING_EMAIL_PRIMARY_MAILBOX=booking@sandboxhotel.com`. Do not store a Gmail mailbox password in app config. Server sync requires either `BOOKING_EMAIL_GMAIL_ACCESS_TOKEN` or backend OAuth refresh-token credentials: `BOOKING_EMAIL_GMAIL_CLIENT_ID`, `BOOKING_EMAIL_GMAIL_CLIENT_SECRET`, and `BOOKING_EMAIL_GMAIL_REFRESH_TOKEN`. `BOOKING_EMAIL_GMAIL_SCOPES` defaults to `https://www.googleapis.com/auth/gmail.readonly`; do not broaden it unless a backend feature genuinely needs more access. `/api/booking-email/status` reports non-secret credential readiness, missing key names, the target mailbox, last sync state, and a Gmail profile connection test. For Render, prefer the durable refresh-token tuple. Use `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` to check current Render key presence without printing values, then use `npm.cmd run render:gmail-oauth` as a dry-run before applying any env-var changes. Operational/security/provider-admin emails from OTA senders are not booking events; keep those rows `UNKNOWN` / review-only unless staff confirm they are actionable reservation communications. When no explicit `--query` is supplied, historical backfill defaults to the approved provider-query boundary instead of the incomplete direct `to:booking@sandboxhotel.com` filter.

The primary Gmail source and missed-push reconciliation use that same
provider-aware default. Source ensure upgrades only an empty query or the known
legacy direct-mailbox query; it preserves an owner-customized query.

Optional LINE Hotel Ops command intake:

```env
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
HOTEL_OPS_LINE_COMMANDS_ENABLED=true
HOTEL_OPS_LINE_COMMAND_PREFIX=/ops
HOTEL_OPS_LINE_COMMAND_USER_MAP={"line-user-id":"manager-username"}
```

LINE command intake is separate from guest/staff LINE messaging. Only signed LINE webhook events with the configured prefix are considered, and only mapped active PMS users with `create:ops-task` can create Hotel Ops tasks. Confirm `GET /api/line/webhook` reports command intake enabled and the user map configured before relying on LINE commands.

Optional WhatsApp Hotel Ops command intake:

```env
WHATSAPP_WEBHOOK_APP_SECRET=...
WHATSAPP_WEBHOOK_VERIFY_TOKEN=...
HOTEL_OPS_WHATSAPP_COMMANDS_ENABLED=true
HOTEL_OPS_WHATSAPP_COMMAND_PREFIX=/ops
HOTEL_OPS_WHATSAPP_COMMAND_USER_MAP={"66812345678":"manager-username"}
```

WhatsApp command intake is inbound-only and separate from guest/staff outbound messaging. Configure the Meta webhook URL as `https://<host>/api/whatsapp/webhook`. Only `x-hub-signature-256` verified messages with the configured prefix are considered, and only mapped active PMS users with `create:ops-task` can create Hotel Ops tasks. Confirm `GET /api/whatsapp/webhook` reports the webhook secret, verify token, command intake, and user map configured before relying on WhatsApp commands.

Optional email Hotel Ops command intake from the booking mailbox:

```env
HOTEL_OPS_EMAIL_COMMANDS_ENABLED=true
HOTEL_OPS_EMAIL_COMMAND_PREFIX=/ops
HOTEL_OPS_EMAIL_COMMAND_USER_MAP={"manager@example.com":"manager-username"}
```

Email command intake runs only after booking-email sync imports messages through the server Gmail OAuth path. A subject or body such as `/ops Check bookings for next weekend` is converted into an Ops task only when the sender email is mapped to an active PMS user with `create:ops-task`. The created task stores source email metadata in task logs and audit records.

Booking Inbox operators:

1. Use `/booking-inbox` to review imported booking email events.
2. Use Approve & Apply only when the extracted guest, dates, room type, amount kind, currency, occupancy, and reservation match are clear. Payment, cancellation, modification, and other non-new-booking events must already show the exact linked reservation; otherwise use Link / Create first. Never apply a guest-name/date suggestion as write authority. Currency must be explicit and equal the configured property currency; never guess, relabel, convert, or edit the persisted money value. If an email shows conflicting totals, reject or reprocess it after verifying the OTA Extranet; the PMS will not choose one. For OTA new/modification events, only an explicit stay total can set pricing; payment/deposit labels cannot become the stay total.
3. Use Edit Parsed Details Then Apply when the parser is close but needs corrected stay, payment, or guest fields.
4. Use Link / Create Reservation to link matched events by reservation id or create only clearly unmatched new bookings. Link mode intentionally ignores incomplete edited occupancy fields; creation requires one verified age from 0 through 17 for every child.
5. Enter an operational reason for modification and cancellation email actions.
6. Use Reprocess only for stale `NEEDS_REVIEW` or `ERROR` events after parser changes; it reparses immutable raw content and stored Gmail authentication evidence, replaces the old parser result/match, returns the event to review, and does not auto-approve it.
7. Treat missing mailbox sync credentials as a provider setup issue; existing imported events can still be reviewed if backend routes are available.

Historical booking mailbox capture:

1. Check current PMS capture state without scanning Gmail:

```powershell
npm.cmd run booking-email:proof
```

2. Confirm backend Gmail OAuth credentials are configured on Render without printing values:

```powershell
npm.cmd run render:gmail-oauth:status -- --use-render-cli-token
```

Use `RENDER_API_KEY` instead of `--use-render-cli-token` when an automation API key is available. The status output is ready only when one supported credential path is present: the booking-specific refresh-token tuple, booking-specific access token, fallback refresh-token tuple, or fallback access token.

3. If the booking mailbox does not yet have a durable backend refresh token, generate a Google OAuth consent URL from a secure shell. The OAuth client must allow the redirect URI shown in the command output. The default local redirect URI is `http://127.0.0.1:53682/oauth2callback`. If the owner has a Google OAuth client JSON download, keep it in an untracked local path such as `.\.codex\google-oauth-client.local.json` and pass it with `--credentials-file`.

```powershell
npm.cmd run gmail-oauth:render
npm.cmd run gmail-oauth:render -- --credentials-file .\.codex\google-oauth-client.local.json
```

Authorize the `booking@sandboxhotel.com` mailbox, then paste the returned authorization code only into a local prompt and pipe it to the exchange/apply helper. The helper exchanges the code with Google and writes the refresh-token tuple directly to Render without printing the authorization code, client secret, access token, refresh token, or Render auth token:

```powershell
$authCode = Read-Host 'Paste Gmail OAuth authorization code'
$authCode | npm.cmd run gmail-oauth:render -- --credentials-file .\.codex\google-oauth-client.local.json --exchange-code --code-stdin --apply-render --use-render-cli-token
```

Alternatively, use the local callback listener from the same secure shell. The helper prints the consent URL, waits on the configured loopback redirect URI, captures the returned code locally, exchanges it, and applies the Render env vars without printing token values:

```powershell
npm.cmd run gmail-oauth:render -- --credentials-file .\.codex\google-oauth-client.local.json --listen --apply-render --use-render-cli-token
```

4. If an approved refresh token already exists in the local process environment, prepare Render env-var updates without printing values by first running:

```powershell
npm.cmd run render:gmail-oauth
```

5. After the required local process env vars are present, apply them to the custom-domain Render service only from a secure shell:

```powershell
npm.cmd run render:gmail-oauth -- --apply --use-render-cli-token
```

Use `RENDER_API_KEY` instead of `--use-render-cli-token` when an automation API key is available. The helper updates only the known booking-email Gmail keys and omits all values from output.

6. Redeploy the Render service so the new env vars reach runtime.
7. Dry-run a bounded historical scan first:

```powershell
npm.cmd run booking-email:backfill -- --limit 250 --max-pages 5
```

This default dry-run uses the approved provider-query boundary. Use `--query "<owner-approved Gmail query>"` only when an owner-approved override needs a different slice, or `--primary-mailbox-query` when troubleshooting only the direct primary-mailbox route.

8. Review the redacted JSON counts for scanned messages, existing events, new candidates, event type mix, and extraction confidence.
9. If the preview looks correct, import the same bounded set as Booking Inbox review events:

```powershell
npm.cmd run booking-email:backfill -- --limit 250 --max-pages 5 --confirm
```

10. For larger history loads, keep the same approved query and increase `--limit`/`--max-pages`; confirmed imports use `--import-batch-size 50` by default to avoid one giant database transaction.
11. Before rollout or after parser changes, inspect the live queue without exposing message content:

```powershell
npm.cmd run booking-email:deep-scan -- --limit 500
```

12. After parser changes, reprocess only review/error events and keep them in staff review:

```powershell
npm.cmd run booking-email:reprocess -- --confirm
npm.cmd run booking-email:deep-scan -- --limit 500 --strict
```

If strict scan still fails on `NEW_BOOKING` rows with missing stay dates, inspect whether the sample is real reservation mail or OTA partner/security noise before widening parser heuristics.
11. Open `/booking-inbox` to visually inspect Needs Review, Errors, Processed, and Ignored tabs. Confirmed backfill does not approve, create, modify, cancel, charge, or assign reservations by itself.

Public edge posture proof:

```powershell
npm.cmd run public-edge:proof
```

This command is read-only and sends no cookies or authorization headers. It records DNS availability, selected public response statuses, Cloudflare/Render header presence, and bounded health fields while omitting response bodies. Treat it as public-edge routing evidence only; it does not prove Cloudflare account ownership, WAF rule IDs, rate-limit thresholds, or an owner-approved rate-limit test.

Credentialed auth/RBAC/logout proof:

1. The owner prepares a local, untracked JSON file with approved production users and passwords. Do not commit the file and do not paste passwords into docs, issues, screenshots, or chat.

```json
{
  "users": [
    {
      "identity": "approved-login@example.com",
      "password": "paste locally only",
      "role": "MANAGER",
      "approvedBy": "Owner initials",
      "approvedAt": "2026-07-04",
      "firstCheck": { "method": "GET", "path": "/api/auth/me", "expectStatus": 200 },
      "denialProbes": [
        { "label": "underprivileged user-management denial", "method": "GET", "path": "/api/users", "expectStatus": 403 }
      ]
    }
  ]
}
```

2. Run the proof helper from a secure shell:

```powershell
npm.cmd run auth-rbac:proof -- --users-file .\.codex\auth-proof-users.local.json
```

For stdin-only handling:

```powershell
Get-Content .\.codex\auth-proof-users.local.json -Raw | npm.cmd run auth-rbac:proof -- --users-stdin
```

The helper logs in, verifies `/api/auth/me`, runs the first authenticated check and any owner-approved denial probes, logs out, then confirms `/api/auth/me` returns unauthenticated. Output masks login identifiers, keeps cookies in memory only, omits response bodies except bounded role/status fields, and rejects mutating denial probes unless `--allow-mutating-denial-probes` is explicitly set for an owner-approved no-op/invalid payload.

Staff account lockout:

1. Staff accounts lock after three failed login attempts.
2. A locked user cannot authenticate until an admin resets that user's password from user management.
3. Password reset clears `failedLoginAttempts` and `lockedAt`. Do not unlock by editing production database rows directly unless emergency recovery is explicitly approved and recorded.
4. Do not paste passwords, hashes, cookies, or session tokens into issue comments, screenshots, docs, or chat.

Hotel Ops notification center:

1. In server mode, the shared header notification bell shows backend Hotel Ops notifications for users with Ops permission.
2. Provider-pending email intents mean the PMS recorded the notification but no mail provider has delivered it yet.
3. To enable backend Gmail delivery, set `HOTEL_OPS_EMAIL_DELIVERY_ENABLED=true`, `HOTEL_OPS_EMAIL_PROVIDER=gmail`, and backend Gmail OAuth credentials. Do not use a mailbox password.
4. Gmail delivery changes email notification status to `SENT` or `FAILED`; failures keep redacted provider error metadata for staff review.
5. Read/dismiss controls persist server-side acknowledgment records and audit entries; provider delivery status stays unchanged.

## Daily Operation

Manager:

1. Open `/ops/chat`.
2. Submit a specific operational instruction.
3. Review parsed preview and task status.
4. Use `/ops/tasks` for queue and worker outcomes.
5. Use `/ops/intelligence` for trend alerts and recommendations.

Parser mode:

- The parser is deterministic by default.
- To enable backend-only OpenAI Responses parsing, set `HOTEL_OPS_AI_PARSER_ENABLED=true` and configure `OPENAI_API_KEY` as a backend secret.
- `/ops/chat` shows whether the latest command used deterministic parsing, OpenAI parsing, or deterministic fallback.
- If the provider call fails or returns malformed output, the backend falls back to deterministic parsing and records the redacted fallback reason in task logs/audit metadata.

Owner or approver:

1. Open `/ops/approvals`.
2. Review task, platform, dates, rate or availability, proof context, and risk.
3. Approve or deny with an operational reason.
4. Use emergency stop from `/ops/settings` if write automation should pause.

## Scheduled Scan Operation

1. Configure a positive interval in minutes.
2. Restart the app server.
3. Confirm `/ops/settings` shows scheduler state and next scan time.
4. Monitor `/ops/intelligence` for alerts and latest scan evidence.
5. Treat recommendations as separate approval-gated tasks.
6. Use the scan evidence panel or `GET /api/ops/intelligence/scans` as backend evidence for how an alert was produced or refreshed; snapshots are PMS-derived and do not prove live OTA scrape coverage unless live adapter reads are configured and separately verified.

The scheduler runs as `SYSTEM`, skips overlaps, and redacts credential-like failure text.

## Policy Review

Use `/ops/settings` to review the backend-enforced Permission and Approval Policy before enabling operational workflows. The matrix is read from `/api/ops/policy` and shows parser mode, risk level, allowed roles, approval role, disabled MVP tasks, rate limits, all-room-close protection, and emergency-stop coverage.

## Human Challenges

The worker must not bypass CAPTCHA, 2FA, locked-account, or password-expired flows.

When a challenge appears:

1. Mark task `NEEDS_HUMAN`.
2. Store safe trace proof.
3. Notify owner or manager.
4. Let an authorized person complete the challenge outside automated bypass.
5. Record the completion reason from `/ops/tasks` using the `Human done` action.
6. Resume only when account policy and session state allow it; the backend requeues the task and staff must run it explicitly.

## Validation Ladder

For Hotel Ops changes, run the smallest credible checks first:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npx.cmd prisma validate
git diff --check
npm.cmd run build
npm.cmd run test:e2e
```

For DB lifecycle proof, use a disposable/staging database:

```powershell
$env:ALLOW_DB_E2E='true'
$env:E2E_DATABASE_URL='postgresql://...'
npm.cmd run test:e2e:db
```

Never run DB-mutating E2E against production data.

## Lite V1 Staging Runbook

Lite rollout is staging-first. Do not point an unverified Lite service, migration, cron, or DB-mutating E2E command at production data.

### Build And Local Validation

```powershell
npm.cmd ci --include=dev
npm.cmd run db:generate
npm.cmd run typecheck:lite
npm.cmd run test:lite
npm.cmd test
npm.cmd run lint
npx.cmd prisma validate
npm.cmd run build:lite
git diff --check
```

`npm.cmd run test:e2e` is the normal non-mutating server-mode boundary. `npm.cmd run test:e2e:lite` is deliberately database-mutating: it refuses to start without `ALLOW_DB_E2E=true` and an unmistakably disposable/staging `E2E_DATABASE_URL`, creates a unique temporary schema, applies migrations, seeds test-only users, runs real browser workflows plus money reconciliation, and drops the schema afterward. Never reuse a production-like URL.

Build the Lite client with `npm.cmd run build:lite`. The server selects `dist-lite` only when `PMS_UI_VARIANT=lite`; otherwise it serves the legacy build. Keep the legacy path available during the pilot.

### Staging Configuration

`render-lite.yaml` is the free-instance staging baseline: one Free web service
plus one disposable Free Postgres database in Singapore. It creates no paid
instance resource, but workspace quotas and bandwidth/build overages still apply.
It has manual deploys
(`autoDeployTrigger: off`), pins Node `22.12.0`, serves the Lite build, runs
the repository migration chain before each start, and uses `/healthz?deep=1` so
Render checks database connectivity. Multi-statement historical migrations are
not universally retry-safe after interruption; do not describe the chain as
idempotent. It does not contain the paid maintenance cron and does not reference
the production PMS database.

Public health responses are deliberately bounded to service/UI identity,
timestamp, and database configured/healthy state. They must not expose secret
values, missing secret names, write-mode configuration, provider configuration,
or privileged diagnostics. A healthy response is availability evidence only; it
does not prove Gmail, Cloudflare, provider, recovery, or owner acceptance.

If a migration is interrupted, stop application writes and preserve the failed
database. Record `npx.cmd prisma migrate status`, the failed migration name, and
the database recovery point without printing connection details. Rehearse the
repair on a disposable restore first. Only after reviewing the partial DDL/data
may the database owner restore the database or run `npx.cmd prisma migrate resolve --rolled-back <migration_name>`, then retry `npm.cmd run db:migrate`.
Never use `migrate resolve` to conceal an unknown production state.

Render Free Postgres is staging-only: it expires after 30 days, has no backups,
and Render permits only one active Free Postgres database per workspace. A Free
web service can spin down and has no shell, SSH, one-off-job, or pre-deploy-command
support. Do not treat this disposable pilot as production or recovery evidence.

Render generates `SESSION_SECRET` once when the service is created and preserves
the existing value on later Blueprint syncs. Before applying the Blueprint, the
owner must provide these user-supplied `sync: false` values
in the Render creation form without pasting them into repo files, logs, or chat:

- `SEED_USERS_JSON`: a JSON array containing at least one approved `ADMIN` with
  `passwordHash`; never include a `password` field;
- Gmail OAuth and Pub/Sub values only when the staging mailbox integration is
  ready to be exercised.

Generate the one-time staging admin bundle without putting a password in shell
arguments or terminal output:

```powershell
npm.cmd run staging:credentials:lite -- --username lite-owner --first-name Lite --last-name Owner
```

The command refuses to overwrite an existing file and writes the login,
generated temporary password, and hash-only `SEED_USERS_JSON` to the ignored
`.codex/lite-staging-bootstrap.local` file. Enter only the `SEED_USERS_JSON`
value in Render's secret field. Keep the local file private, verify the first
login, rotate the temporary password, remove `SEED_USERS_JSON` from Render, and
then delete the local file through the normal owner credential-cleanup process.

When creating the Blueprint, explicitly select branch
`codex/sandbox-pms-lite-v1` and Blueprint Path `render-lite.yaml`. The root
`render.yaml` manages the existing production service and must not be selected
for the Lite staging deployment.

The `initialDeployHook` runs `scripts/render-lite-staging-bootstrap.mjs` once after
the first successful deploy. It refuses any database other than
`sandbox_pms_lite_staging`, any non-empty PMS database, plaintext seed password
variables, and any seed payload without a hash-only admin. The prod-safe seed
creates staging property/room-type/login foundations but does not create demo room
inventory. Verify the first admin login, then remove `SEED_USERS_JSON` from Render;
later restarts run migrations only and never reseed or reset the database. Public
first-run setup remains disabled.

Minimum runtime configuration remains:

```env
DATABASE_URL=postgresql://...disposable-or-staging...
SESSION_SECRET=...
PMS_UI_VARIANT=lite
CHANNEL_SYNC_QUEUE_BACKEND=lite_manual
BOOKING_EMAIL_NEAR_LIVE_ENABLED=false
```

Render supplies `RENDER_EXTERNAL_URL`, which the server uses for its initial
same-origin boundary. If a separate staging custom domain is added later, update
both `APP_URL` and `ALLOWED_ORIGINS` in Render before routing traffic to it.

Gmail history sync still requires the backend Gmail OAuth tuple described earlier in this runbook. Near-live push additionally requires:

```env
BOOKING_EMAIL_GMAIL_PUBSUB_ENABLED=true
BOOKING_EMAIL_GMAIL_PUBSUB_TOPIC=projects/<project>/topics/<topic>
BOOKING_EMAIL_GMAIL_PUBSUB_SUBSCRIPTION=projects/<project>/subscriptions/<subscription>
BOOKING_EMAIL_GMAIL_PUBSUB_AUDIENCE=https://<staging-host>/api/booking-email/gmail/push
BOOKING_EMAIL_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL=<push-service-account>
```

The push subscription must use Google authenticated push with the configured service-account identity and exact audience. Do not paste or print OIDC tokens, OAuth values, message ids, raw messages, or guest/payment data while configuring or proving the path.

### Database Migration Gate

Before applying the Lite schema migrations:

1. Confirm the target database is disposable/staging and independently resettable.
2. Generate and validate Prisma locally.
3. Take or verify the applicable staging recovery point.
4. Apply with `npm.cmd run db:migrate`.
5. Run `npm.cmd run db:status` and focused Lite/Gmail/manual-channel tests.
6. Run `npm.cmd run money:reconcile` with the same target `DATABASE_URL` and require `status=PASS` with zero unexplained differences.
7. Inspect only redacted aggregate counts and migration state.

The Lite migrations add the manual channel queue/provider attribution, Gmail watch/source state and durable push deliveries, nullable integer-satang authority fields with audited Float backfill (including `RateCalendar.rateSatang`), database-enforced active OTA mapping-target uniqueness, immutable task target snapshots, read-only legacy email evidence, and the exact provider-total satang/currency provenance pair. The rate-calendar/provider-storage follow-up removes rigid provider `CHECK` constraints while the backend allowlist remains the authority for enabled adapters. The immutable-target migration reopens folios that the older runtime auto-closed for still-active stays. It marks every historical task target unverified rather than inferring it from a newer mapping, so reconciliation must supersede that work before completion. PMS runtime writes keep Float in rollback parity with satang.

Two additional migrations are part of this Wave 1 apply boundary:

- `20260715150000_payment_reversal_idempotency` adds payment entry kind, reversal linkage/reason, payment/charge request ids, charge-void actor/time/request metadata, and database constraints for signed exact-satang shape plus Float-shadow parity.
- `20260715160000_user_session_revocation` adds the non-null defaulted `User.sessionVersion` used to invalidate previously issued session tokens.

Nullable satang remains permitted only for quarantined legacy rows. New writes must use exact satang and derive the legacy Float shadow from it. Do not mark the production money or auth cutover complete until the target restore/migration, reconciliation, representative workflow, role/session, and rollback-period proof is captured.

Before any staging migration, prove populated legacy backfill against a disposable database:

```powershell
$env:ALLOW_DB_E2E='true'
$env:E2E_DATABASE_URL='<disposable PostgreSQL URL>'
npm.cmd run test:money-backfill:db
```

The command creates and removes an isolated schema. It must refuse a production-like URL and must never be pointed at production. Passing it proves repository migration behavior, not the fresh Render recovery/restore or live reconciliation gate.

### Core Hotel Operation

Use one browser action at a time and confirm the persisted result before moving on:

1. Create a booking or same-day walk-in with an exact THB amount. Enter one age for every declared child; Lite sends integer satang and the backend rejects occupancy/pricing ambiguity.
2. On Booking Board, assign only a matching available room. If another user changed the booking, a `409` requires refresh; never overwrite the newer state.
3. Before check-in, record nationality and ID/passport number, confirm room readiness, and collect the balance. Manager/Admin may use pay-later or identity-later only with an operational reason.
4. Keep the folio open throughout an active stay, including a prepaid stay, so incidentals can be posted. Record each charge and payment from the folio and verify the exact balance. Overpayment is refused.
   Use one client request id per payment or incidental-charge intent; a retry must reuse that id. A conflicting reuse is an error, not a second write.
   An actor with `refund:payment` may reverse all or part of an original payment with a recorded reason. Verify a separate negative reversal row, its link to the original payment, the recalculated folio/deposit state, and `PAYMENT_REVERSED` audit evidence. Never edit or delete the original payment.
   Manager/Admin may void a non-room charge with a reason. Verify the original row is retained with void actor/time/request metadata and `CHARGE_VOIDED` audit evidence. Room charges must be changed through reservation pricing, not the void route.
5. Check out only at zero balance in normal operation. A Manager/Admin unpaid override requires a reason and leaves the folio open; later settlement closes it automatically.
6. Checkout sends the room to `VACANT_DIRTY` and releases that reservation's room-date rows before early-checkout availability work is staged. Housekeeping progresses it through the permitted cleaning states without receiving guest, email, rate, folio, or payment data.
7. Mark no-show only for an active arrival on or after its Bangkok arrival date and always record the reason. A future arrival or terminal booking must be rejected.

Generic booking edits are unavailable after check-in because changing a checked-in room/type through that form can corrupt occupied-room state. Use checkout or an owner-approved dedicated in-house extension/room-move workflow; do not work around this backend guard.

For release proof, run the guarded disposable `npm.cmd run test:e2e:lite`; it directly clicks Board assign/edit, Thai check-in error and success, folio charge/payment, checkout, no-show, concurrent room assignment, and stale-edit rejection. This is engineering proof only, not staff or production acceptance.

Auth and privacy checks for the staging target:

1. Confirm an old or versionless session token receives `401` after the migration.
2. Confirm lockout, password change, role change, active-state change, deactivation, and logout each invalidate already-issued sessions through `sessionVersion`.
3. Confirm Cashier can reach only the narrow Lite payment-reconciliation booking projection and cannot call legacy reservation, guest, board, booking-email review, or booking-email evidence APIs.
4. Confirm Front Desk/Manager/Admin normal booking-email list/detail responses contain no raw Gmail URL, source message id, headers, or body.
5. When raw evidence is operationally necessary, Manager/Admin submits a reason to `POST /api/booking-email/events/:id/evidence`; verify property scoping and `BOOKING_EMAIL_EVIDENCE_VIEWED`. Do not copy the returned Gmail locator or source id into logs or release evidence.

These checks require approved disposable/staging accounts and data. Local unit tests alone are not credentialed staging or production role proof.

### Gmail Watch, Push, And Five-Minute Fallback

Near-live authenticated Pub/Sub push is the primary path and does not require the
Render cron. The fallback cron is isolated in
`render-lite-cron-opt-in.yaml`. Applying that second Blueprint creates a billable
Render Cron Job with a current USD 1/month minimum. Do not apply it without
explicit owner cost approval. Apply `render-lite.yaml` first. The opt-in cron is
an independently valid Blueprint with no implicit service/database binding; its
Render creation form requires the owner to supply the Lite staging database URL
and reviewed Gmail configuration. Never substitute the production database or
copy values into the repository, terminal output, logs, or chat.

After approval, configure the opt-in cron on the same reviewed commit and staging
database:

```text
Schedule: */5 * * * *
Command: npm.cmd run booking-email:maintenance
```

Render's Linux runtime may invoke the package script as `npm run booking-email:maintenance`; the repository's Windows validation convention remains `npm.cmd`. Capture the actual Render command and schedule in deployment evidence.

Validate structure before any apply:

```powershell
render blueprints validate render-lite.yaml
render blueprints validate render-lite-cron-opt-in.yaml
```

The branch must already exist on GitHub for Render's remote validation. Both
Blueprints must validate independently in the selected Render workspace before
apply. A missing branch, an unavailable Free Postgres slot, or an unreviewed
staging secret is an apply blocker, not permission to substitute production
resources.

One maintenance run renews due Gmail watches, drains/retries durable Pub/Sub deliveries, and performs bounded history reconciliation. Run once manually on staging before enabling the schedule:

```powershell
npm.cmd run booking-email:maintenance
```

Expected output is redacted aggregate JSON. A healthy run has at least one enabled source, no errors, no delivery failures, and no reconciliation failures. This proves only that run. It does not prove continuous push delivery or zero-lag synchronization.

Lite startup fails closed if the legacy 120-second booking-email poller is enabled or if the queue backend is not `lite_manual`. Do not weaken that guard. Pub/Sub plus the separately scheduled maintenance/reconciliation command is the Lite path; the legacy poller must remain off.

Delivery retries use a default maximum of eight claimed attempts. A non-retryable error or an eighth failed attempt remains visible as a redacted terminal `FAILED` row but is excluded from later claims. Do not clear or rewrite the attempt count merely to hide a failure. Investigate the provider/configuration cause, preserve the failed record, and use the reviewed reconciliation/manual intake path; a source-lease collision does not consume an attempt because no provider call ran.

To prove the end-to-end path safely:

1. Verify `/api/booking-email/status` and Channel Desk show non-secret Gmail readiness.
2. Verify the Gmail watch has a future expiry without recording its secret values.
3. Send or identify one owner-approved non-production provider fixture through the staging mailbox.
4. Confirm a durable push delivery reaches `SUCCEEDED` or is safely `COALESCED` by history reconciliation.
5. Confirm the booking email appears as `NEEDS_REVIEW` and no reservation/inventory changed before approval.
6. For any declared children, confirm the parser captured one integer age from 0 through 17 per child. A missing, invalid, or count-mismatched age list must remain review work and must not be applied until the complete list is verified.
7. Before approving a modification/cancellation, verify no same-time or newer non-legacy lifecycle event for the same reservation/provider reference remains in `NEEDS_REVIEW`, `ERROR`, or `PROCESSED`. The older event must fail closed rather than overtake that timeline.
8. Approve only a staging fixture with an operational reason and verify the PMS audit plus absolute-availability reconciliation for every enabled OTA, including stale-task supersession on the source provider.
9. Test a missed/failed push and confirm the five-minute maintenance run recovers a retryable row without duplicate reservation creation; separately confirm non-retryable/exhausted rows remain visible and unclaimable.

All Gmail source/event operations must resolve to the configured `SANDBOX` property. Exercise a cross-property source/event id only against disposable fixture data and require `404`/no mutation for source update/sync, event approve/reject/reprocess/evidence, and delivery processing.

If Pub/Sub is unhealthy, leave the review queue enabled, keep the maintenance cron running, and treat intake as reconciliation-based rather than near-live. If Gmail OAuth or reconciliation is unhealthy, stop relying on mailbox intake and use the existing manual booking process until the source is healthy. Never bypass the review gate to compensate for delay.

### Manual Channel Desk Operation

This Channel Desk workflow is the only Lite outbound queue. The separate `availability:queue` CLI stores legacy Hotel Ops tasks and must not run in a Lite environment; it rejects commands when `CHANNEL_SYNC_QUEUE_BACKEND=lite_manual`. Do not enable the 120-second in-process poller beside Gmail Pub/Sub/history reconciliation.

Manager/Admin setup:

1. Create/save only the intended provider connection and leave it disabled during mapping setup.
2. Store a provider property id only when verified; never store credentials.
3. Save an official HTTPS Extranet URL without query parameters, fragments, embedded credentials, or non-standard ports.
4. While the connection is disabled, map every PMS room type that has at least one physical room to verified OTA room/rate-plan identifiers. Temporarily out-of-service rooms still count because they can return to sale.
5. Confirm that no two PMS room types use the same active OTA room-type/rate-plan target, choose the initial 1–90-day availability horizon (90 days by default), then enable the connection.
6. Confirm the initial baseline tasks and `MANUAL_CHANNEL_INITIAL_BASELINE_STAGED` audit. The backend enables and stages this connection in one serializable transaction, so incomplete mappings, conflicting mappings, an invalid horizon, or task-staging failure leave it disabled. Run a later reasoned reconciliation only when the baseline range must be extended or recalculated.

Front Desk/Manager/Admin completion:

1. Refresh Channel Desk and open the current task.
2. Confirm provider, PMS room type, displayed external room type id/name, rate-plan id, stay date, revision, and desired availability.
3. Open the official Extranet and update the value manually.
4. Return to Lite and complete the task using the same current revision and exact confirmed availability.
5. If the task changed, refresh; do not complete a stale revision.

Manager/Admin may retry a failed task or reopen a completed task only with an operational reason. The backend recalculates current absolute availability and snapshots the current mapping into the next revision; it never blindly copies an old target/value. A newer PMS inventory state may supersede an open task. Completed means a staff operator attested that the Extranet was updated; it is not an independent OTA API read-back.

Escalate overdue or failed tasks immediately because the workflow cannot guarantee zero-lag inventory or prevent overbooking while Extranets differ. Booking.com stays manual. Agoda and Trip.com partner application submission/approval require owner-controlled business/legal details and provider testing. The Channex path must remain disabled until a certified account, secret handling, mappings, sandbox tests, and owner acceptance are complete.

If `MANUAL_CHANNEL_TASKS_SKIPPED_UNMAPPED` appears in audit logs, keep the affected inventory under manual control, add/repair the active mapping, and run reconciliation again. The service deliberately creates no task for an unknown external target; an audit record is evidence of the gap, not proof that the OTA was updated.

Completion and reopen/retry also resolve tasks through the configured `SANDBOX` property relation. A cross-property task id must return not found before any status, revision, mapping, or availability change.

### SSE And Client Recovery

`GET /api/realtime/events` is an authenticated invalidation signal, not a booking data feed. If SSE disconnects, the client receives `sync-required` on reconnect and continues fallback polling. Verify mutations by refetching the authoritative API; do not infer success from an SSE signal. The current hub is process-local and has no replay; keep the Lite pilot to one web instance. For more than one server instance, add and prove a shared event bus before relying on cross-instance live refresh.

### Settings And Client Usability Checks

Settings must use only authenticated `GET /api/lite/v1/settings` for its property, room/type, non-secret Gmail health/count, and manual mapping snapshot. Confirm opening Settings issues no booking-board/channel-worklist request and queries no reservation, booking-email review, reservation-log, or manual-task rows.

On desktop and mobile, verify blank Front Desk/Housekeeping dates show a localized validation state without issuing a request; mobile exposes a working logout control; same-day Housekeeping turnover shows both departure and arrival context; every modal traps Tab/Shift+Tab, closes on Escape, and restores prior focus; operational timestamps are locale-formatted with a bounded invalid-value fallback; and the added status/error copy is reviewed in English and Thai. These checks are staff/usability evidence only after humans perform them on the exact staged build.

### Release And Cutover Gate

Do not promote Lite beyond staging until all of these are recorded for the exact commit:

- green Lite, legacy, business, lint, Prisma, build, and approved disposable DB E2E checks;
- successful staging application of the full migration chain, including payment reversal/idempotency and session revocation, plus failed-migration recovery/restore evidence;
- Gmail OAuth/watch/push/cron/reconciliation proof with review-only behavior;
- terminal Gmail delivery visibility/unclaimability at non-retryable or eight-attempt failure, plus lifecycle ordering and child-age review proof;
- Booking.com, Agoda, and Trip.com parser/review fixtures and duplicate/out-of-order handling;
- manual task coalescing, supersession, absolute source-provider reconciliation, completion, age, and audit proof;
- completed exact-money migration/reconciliation plus reasoned reversal/void and idempotent-retry proof, not merely API satang projection;
- credentialed session revocation, Cashier least-privilege, and booking-email evidence-gate proof;
- role, tablet/desktop, Thai/English, and Thai-speaking staff acceptance;
- bounded Settings-query, blank-date, mobile logout, same-day turnover, modal keyboard/focus, and localized timestamp acceptance;
- provider application decisions, Cloudflare routing/WAF evidence, and owner go/no-go.

Local and CI validation cannot close Gmail provider operation, Render migration or recovery state, Cloudflare DNS/proxy/WAF enforcement, OTA approval, staff acceptance, or owner go/no-go.

Use a separate pilot hostname and manual Render release before any public domain move. Keep the existing service available during the pilot and retain a tested rollback for 30 days. See `docs/LITE_ARCHITECTURE.md` for the sequential OTA and domain cutover boundary.

### Apply and verify the Lite 30-room inventory

The inventory writer is intentionally staging-specific. Run it only after the prod-safe property bootstrap and only with the Lite staging environment values already supplied through the approved secret path:

```powershell
npm.cmd run staging:inventory:lite
```

The command must report exactly 30 rooms, 15 `DOUBLE`, and 15 `TWIN`. It must refuse any database other than `sandbox_pms_lite_staging`, any non-staging tier, any non-Lite UI variant, or any seed mode other than `prod-safe`. A refusal caused by unexpected/drifted rooms is a stop condition: inspect and reconcile; do not delete or force-reassign inventory.

For lifecycle proof, use only a disposable PostgreSQL target:

```powershell
$env:ALLOW_DB_E2E='true'
$env:E2E_DATABASE_URL='<disposable-postgresql-url>'
npm.cmd run test:e2e:lite
```

The harness creates and removes its own isolated schema and covers standard booking/contact edit, assignment, identity/check-in, room and extra charges, payment, folio retrieval/printing, checkout, housekeeping turnover, atomic walk-in, cancellation/no-show reasons, concurrency, and stale edits. Never point it at production-like data.
