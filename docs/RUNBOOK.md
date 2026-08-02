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

### Demand Calendar Preload (Nakhon Si Thammarat 2027)

- Generate manifest, CSV, and backup in one versioned output:

```powershell
npm.cmd run rates:preload:nakhon-2027
```

- Import the generated CSV in **Rates → Bulk Rate Upload**.
- Keep `sourceStatus=PROJECTED` rows for planning.
- Promote to `CONFIRMED` only before strict enforcement is expected to apply.
- Before push, verify:
  - Twin base remains `750`.
  - Double base remains `850`.
  - Source has `365` rows with tier mix `42/162/106/41/14`.
- Push workflow:
  - dry-run/verification pass in the rate push panel first.
  - owner-approved live pass after proof capture.
- Rollback evidence:
  - preserve `*.manifest.json` and `*.rate-overrides-backup.json` outputs for revert review.

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

Near-live sync defaults to the approved-provider sender query rather than `to:booking@sandboxhotel.com`; keep that boundary unless an owner-approved source query is required, because BCC and forwarded OTA messages may not expose the mailbox in the `To` header.

Before reprocessing a backlog, verify that a normal booking confirmation containing cancellation-policy or cancellation-fee boilerplate is classified as `NEW_BOOKING`; only an explicit booking/reservation cancellation phrase, notification, or status should classify as `CANCELLATION`.

If a provider template contains a THB-like account/reference number outside the PMS money safety range, the parser must omit the amount and continue review-only reprocessing; never reduce, truncate, or manually coerce the value.

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
2. Use Approve & Apply only when the extracted guest, dates, room type, amount, and reservation match are clear.
3. Use Edit Parsed Details Then Apply when the parser is close but needs corrected stay, payment, or guest fields.
4. Use Link / Create Reservation to link matched events by reservation id or create only clearly unmatched new-booking events. Payment notices cannot create reservations; guest messages and unknown events are link-only.
5. Enter an operational reason for cancellation and modification apply. Cancellation requires `cancel:reservation`; modification requires `edit:reservation`.
6. Never use edited details to override a folio balance. An amount above the authoritative outstanding balance must fail and be investigated.
7. Treat the public sync request body as untrusted. It rejects caller-supplied `events`; use the bounded Gmail backfill helper for provider-fetched history.
8. Use Reprocess only for stale `NEEDS_REVIEW` or `ERROR` events after parser changes; reprocess returns the event to the review queue and does not auto-approve it.
9. Treat missing mailbox sync credentials as a provider setup issue; existing imported events can still be reviewed if backend routes are available.
10. In Sources / Settings, only a manager or administrator may enable controlled autonomy for a source. The global server policy must already report ready.
11. Confirm each OTA room label is mapped to exactly one PMS room type and the intended operational room ids before enabling source autonomy. Trip.com mappings use provider `TRIP`.
12. Treat `Manager notified` as an exception requiring review. Resolve missing/contradictory guest, stay, amount, provider, authentication, room-mapping, or room-availability evidence; do not lower the 95% hard floor.
13. Verify processed cards show `AUTO_APPLIED` or an `AUTO_LINKED_*` decision and open the Booking Board to confirm the assigned room and stay dates.

Controlled near-live activation (production owner step):

```powershell
BOOKING_EMAIL_NEAR_LIVE_ENABLED=true
BOOKING_EMAIL_SYNC_INTERVAL_SECONDS=30
BOOKING_EMAIL_AUTONOMY_ENABLED=true
BOOKING_EMAIL_TRUSTED_SENDER_DOMAINS=<owner-approved comma-separated domains>
BOOKING_EMAIL_AUTONOMY_MIN_CONFIDENCE=0.95
BOOKING_EMAIL_AUTO_ASSIGN_ROOMS=true
BOOKING_EMAIL_REQUIRE_AUTHENTICATION_RESULTS=true
BOOKING_EMAIL_NOTIFY_MANAGER=true
```

Keep `BOOKING_EMAIL_REQUIRE_CORROBORATION=false` unless the owner requires a second consistent provider email before any automatic creation. Activation is incomplete until Gmail profile proof, real provider-message parser proof, every active OTA room mapping, a safe test booking, Booking Board assignment, and manager notification behavior are verified in the target environment.

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

Reprocess rebuilds extraction from stored canonical email text and does not reuse the prior derived `parsedDetails` JSON. Agoda confirmation bodies may be stored as one whitespace-collapsed line even when Gmail displays a table; verify that provider labels still resolve and that `Booking ID ... - CANCELLED` subjects remain cancellations.

For collapsed layouts, confirm aggregate field-shape evidence before widening a regex: Agoda dates must be exact date tokens within 80 non-numeric characters of `Check-in`/`Check-out`, and Trip.com guest values must terminate at `Room Type`.

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
4. If a server-mode login appears to revert to the sign-in screen, capture redacted request status and correlation ids for `/api/auth/login` and `/api/auth/me`. Do not restore access by writing `auth:current-user` or a token into browser storage.
5. Run `npm.cmd run test:server-auth-authority` and the guarded `npm.cmd run test:e2e:server` before accepting an auth-bootstrap correction. The browser test deliberately delivers a stale failed `/api/auth/me` after a successful interactive login.
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

For authenticated server-mode reload and error truth, build in server mode and use the same guarded disposable database:

```powershell
$env:VITE_PMS_API_MODE='server'
$env:VITE_DATA_MODE='server'
npm.cmd run build
npm.cmd run test:e2e:server
```

The CI integration job runs the empty-database migration lifecycle, disposable migration/seed lifecycle, guarded PostgreSQL concurrency/reconciliation suite, and this browser suite. Rerun both required CI jobs on the exact release commit; local execution does not replace GitHub, restored-staging, staff, provider, or owner evidence.

## OTA Provider Contract Checks

Keep `OTA_LIVE_WRITES_ENABLED=false` in local, staging, and production environments until an individual provider has implemented and owner-approved live proof. `OTA_ENABLE_REAL_BROWSER_WRITES` does not override this contract gate.

Run the focused contract check with:

```powershell
node scripts/run-provider-adapter-tests.mjs
```

The check must show an empty `liveWrites` capability for every current provider, reject a non-dry-run Booking.com mutation, and prove credential-shaped evidence is removed. Provider health output is configuration evidence only, not proof of a live read or write.

## Exact-Money Migration And Cutover

The exact-money migration is expand-only. Do not drop or rewrite legacy Float columns during this release.

1. Keep `MONEY_READ_AUTHORITY=legacy_float` in local, staging, and production before migration.
2. Take a fresh recovery point and restore a sanitized production copy to staging. Never use production-like data for DB-mutating E2E.
3. Validate the schema and apply the additive migrations to an empty database and the restored staging copy:

```powershell
npm.cmd run db:generate
npx.cmd prisma validate
npx.cmd prisma migrate deploy
node scripts/run-money-tests.mjs
```

4. Reconcile every legacy/satang pair. The release owner must retain row counts for null satang shadows, rows where rounded legacy baht differs from satang, and aggregate totals for reservations, folios, charges, payments, rates, booking-email amounts, and Hotel Ops rate amounts.
5. Quarantine and resolve any out-of-range, null, or non-zero-variance row. Do not manufacture a satang value when the migration intentionally left an unsafe legacy value null.
6. Exercise create reservation, charge, payment, booking-email apply, rate, settings-fee, and Hotel Ops rate paths and prove both representations are written.
7. Set `MONEY_READ_AUTHORITY=satang` in staging only. Run the full validation ladder, exact-zero checkout, payment replay/conflict, night-audit totals, reports, and staff workflow checks for one full operating cycle.
8. For `/api/payments` and `/api/charges`, retain the same `x-idempotency-key` while retrying one uncertain request. A same-intent charge retry must return the original row; a changed amount, quantity, category, description, folio, date, or booking-email source with the same key must return `409`. Never delete or repost a charge to repair a retry.
9. Server-mode financial screens reuse an unchanged attempt key only within the same loaded application. The manager is memory-only and clears the key after confirmed success. If the page was reloaded after an uncertain response, inspect/refetch the authoritative folio and audit state before attempting another write; do not assume the prior key can be reconstructed.
10. Prove in disposable PostgreSQL that concurrent overpayment permits only one valid winner, simultaneous same-intent charge retries append one charge, changed-intent replays return `409`, and the same key can be used independently in two properties.
11. If a regression appears, restore `MONEY_READ_AUTHORITY=legacy_float`; additive satang columns remain in place. Database restoration is reserved for data corruption, not a normal application rollback.
12. Switch production only with recorded reconciliation, recovery, staff, and owner approval. Retain dual-write and legacy read compatibility for at least 30 days and one complete operating cycle.

An invalid or missing read-authority value falls back to `legacy_float`. That fallback is a compatibility control, not evidence that reconciliation succeeded.

## iCal Export Token Migration And Rotation

The server-mode Channel Manager is an authority boundary, not a channel manager proof screen:

1. Load `/channels` and confirm it reports manual/review-gated iCal and dry-run/unproven OTA capability evidence.
2. If any channel, mapping, room-setup, or capability request fails, stop. The screen must show `Channel Manager unavailable`, block writes, and must not display browser fixtures.
3. Channel configuration, export-token rotation, mapping changes, and channel removal require `manage:channels`, a valid `x-idempotency-key`, and an operational reason containing no URL, credential, email address, or phone number. Retain the same key for an unchanged uncertain retry; changed intent returns `409`. A `view:channels` user is read-only.
4. Do not paste or store an inbound provider iCal URL. The PMS supports hosted outbound date-block feeds only until an approved secret-reference service exists. Migration `20260719100000_remove_raw_ical_import_urls` must remove legacy `config.importUrl` values during deploy.
5. Initial issue and rotation require `x-idempotency-key`. Retain the same key when retrying an uncertain request: the same intent replays the original URL without a second audit event while that token is still current or in grace. Changed intent, disabled channels, and expired/superseded token attempts return `409`. A new export URL is visible only on issue/rotation. Prior hashed tokens remain valid for 15 minutes; update the provider, verify the new feed, then allow the grace window to expire.
6. Configuration/removal reasons are JSON-body fields and must contain no credentials, URLs, email addresses, or phone numbers.
7. Apply migration `20260719103000_channel_mutation_idempotency` before deploying this API/UI pair. Run `npm.cmd run test:channels-server-authority` after changing channel UI, iCal configuration, mapping validation, idempotency, or capability wording.
8. If `Save to PMS` fails, record the inline sanitized error shown in the still-open dialog. Correct the stated prerequisite and retry the unchanged form so the original idempotency key is reused; do not create a channel or mapping directly in PostgreSQL.

Rate push, rate parity, real-time inventory, provider sync logs/performance, and browser iCal reservation imports are demo-only. Do not use them as server, staging, or provider evidence.

Migration `20260717141000_ical_token_hash_backfill` requires PostgreSQL `pgcrypto`, hashes the exact UTF-8 token bytes with SHA-256, stores the unpadded base64url digest, and removes the raw `Channel.config.exportToken` field in the same update.

1. Apply it first to an empty database and a restored sanitized staging copy through `npx.cmd prisma migrate deploy`.
2. Retain only a count-based postcondition; do not select or print channel config values:

```sql
SELECT COUNT(*) AS "rawTokenCount"
FROM "Channel"
WHERE jsonb_typeof("config") = 'object'
  AND "config" ? 'exportToken';
```

3. Require `rawTokenCount = 0`. A migration failure or non-zero count blocks deployment and must be investigated without copying raw token values into tickets, logs, or screenshots.
4. After migration, normal channel reads cannot recover the full feed URL. Capture a newly issued URL only from its initial issue response, or explicitly rotate the token and update the authorized provider calendar with the newly disclosed URL.
5. Rotation invalidates the prior URL. Treat provider update/refresh behavior as separate provider evidence; a local feed test is not provider certification or proof that the provider consumed the new URL.

The focused regression command is:

```powershell
node scripts/run-ical-property-scope-tests.mjs
```

That test and an empty-database migration are engineering evidence only. Do not state that legacy production tokens are removed until the exact migration and postcondition have been proven in that environment.

## Property Membership And Request Context

Authenticated PMS routes require an active membership for the configured `SANDBOX` property. A valid session with no active membership returns `403`.

- The membership migration backfills existing users. Setup and user-management operations maintain compatibility membership records.
- Diagnose a membership denial by checking the user active state, the `SANDBOX` property, and the `(userId, propertyId)` membership. Do not change the global role as a shortcut for a missing membership.
- Compare the role returned by login and `/api/auth/me` with the active membership role, not the legacy `User.role`. Requests re-resolve membership, so an already-issued session must be denied immediately after membership deactivation.
- Role and membership changes require an authorized admin workflow and audit evidence. Never insert a production membership merely to make a proof script pass.
- Property-isolation testing must use a disposable database with at least two properties and forged cross-property resource ids.

## Domain Event Stream

`GET /api/events` is an authenticated, property-scoped SSE endpoint. It requires `view:board`, `view:cashier`, or `view:guests`; do not publish it as a public webhook. Events are filtered by the union of aggregate domains permitted by the effective role: board access does not expose finance, rate, settings, or guest-profile identifiers; cashier authority contributes charge, folio, payment, and reservation invalidations; guest-directory authority contributes guest and reservation invalidations. The server revalidates user and membership authority on every poll and closes the stream after revocation. No stream exposes event metadata or grants a mutation permission.

- `SSE_ENABLED=true` enables the endpoint. Set it to `false` to return a controlled `503` without disabling the underlying transactional event records.
- Browser reconnect uses the last event id. Operators may use `?after=<non-negative-id>` only while authenticated; invalid or negative ids return `400`.
- The stream sends sanitized aggregate identifiers, not metadata, actor ids, guest data, payment details, or credentials.
- A stream interruption is recoverable. The client must reconnect/refetch authoritative data; it must not infer that the underlying transaction failed.
- Database growth, catch-up lag, and retention need staging observation before a retention job is introduced. Do not delete event rows without a reviewed retention and recovery policy.

## Server Rate And Property Settings Operation

Use the server-backed Rates screen only when the PMS API is enabled. Rate writes require `edit:rates`; reads and suggest-only recommendations require `view:rates`.

- Rate recommendations do not apply themselves and do not push to an OTA.
- Property and tax settings writes require manager/admin authority and an operational reason.
- Monetary settings use satang strings; percentages use integer basis points.
- `/api/settings/status` and `/api/system/capabilities` report server configuration only. Provider, staging, WAF, recovery, and owner proof must be collected separately.
- If a rate/settings mutation fails, leave the UI unchanged, retain the backend error code/message in safe form, and refetch from the server. Do not fall back to browser-local persistence in server mode.

Run the focused checks with:

```powershell
node scripts/run-rate-service-tests.mjs
node scripts/run-settings-service-tests.mjs
```

## Housekeeping And Night-Audit Foundation

The persistent services are available through `/api/housekeeping/tasks`, `/api/housekeeping/issues`, `/api/night-audit/runs`, and `/api/night-audit/close`.

- Every create, assignment, transition, close, or override requires authenticated property context; mutations require a non-empty operational reason.
- Housekeeping assignees must be active members of the same property. Critical issue resolution requires manager/admin authority.
- Night-audit close requires an explicit business date and idempotency key. Reuse the same key only when retrying the same attempt.
- The current night audit verifies existing room charges. `UNPOSTED_ROOM_CHARGES` and `EMERGENCY_STOP` cannot be overridden; do not mark the business date complete manually.
- In server mode, housekeeping and Night Audit use the persistent APIs and refetch after confirmed writes. Browser-local workflow state is restricted to explicit demo mode. Disposable-DB browser checks and staff acceptance remain staging gates.

Run the focused fixture check with:

```powershell
node scripts/run-operations-foundation-tests.mjs
```

Passing the focused checks proves service behavior against fixtures. It does not prove migrations against real data, production scheduling, live staff acceptance, recovery, or provider readiness.

## Server Booking Board Operations

Run:

```powershell
npm.cmd run test:booking-board-operations
npm.cmd run test:reservation-commands
```

In server mode, select an unassigned stay or an assigned timeline segment before choosing a compatible target room or editing stay dates. The PMS validates room type, room operational status, inventory blocks, overlapping reservations, capacity, and property ownership before accepting the command. Do not interpret a disabled button as proof of availability; the backend response is authoritative.

The Board deliberately performs no optimistic move, resize, lifecycle, guest, or charge success. After a confirmed success or definitive client failure it refetches the Board range. The PMS records property-scoped command fingerprints; retry an unchanged network or `5xx` outcome only with its original in-memory key, request body, and reservation update token. Do not change the room, form, or stale token before reconciling an ambiguous outcome. A full reload must show the persisted server state.

In server mode, `/rooms` is a read-only operational projection of `/api/front-desk/board`. If it shows **Rooms unavailable**, use Retry only after restoring the authenticated backend path; do not treat room/property/type data in browser storage as a fallback. After retry or reload, reconcile the displayed property, room type, and room number with the server snapshot. Users without `view:board` must not use `/rooms`; the Housekeeping membership includes `view:board`, so its permitted projection must omit guest contact/profile data, folio identifiers, and financial values.

In server mode, `/reservations` requires both the authenticated reservation list and authenticated Board room/readiness snapshot. If it shows **Reservations unavailable**, restore the backend path and use Retry; do not create a booking or trust a browser-stored reservation, guest, room, or unassigned-stay record while either snapshot is unavailable. Once both authoritative snapshots return, reload before continuing a delayed workflow. `view:reservations` is required to enter the route, and create/edit/lifecycle actions remain subject to their own backend permissions and idempotency rules.

In server mode, Front Desk, `/guests`, and `/messaging` must never be recovered by restoring browser KV values. If any of those workspaces shows its unavailable state, restore the authenticated API and use its Retry control before viewing operational metrics, rows, Front Desk assistant context, or creating work. Guest creation requires `edit:reservation` in addition to route access. Messaging records drafts only and requires `send:guest-messages`; `view:messaging` remains read-only. Use the Drafts tab to confirm the saved record survives reload, and do not treat a draft as provider delivery. If a draft response is uncertain, reload and recompose only the unchanged intent so the same opaque idempotency key can replay the original row. The retry record must contain no recipient, contact, subject, or body material and is cleared after authoritative read-back.

In server mode, if `/cashier` shows **Cashier unavailable**, do not post a charge, collect a payment, or use browser-stored folio/accounting data. Restore the authenticated `GET /api/cashier/folios` path, use Retry or reload, then verify the returned folio before retrying the unchanged financial intent. An uncertain payment or charge keeps only a hashed slot, intent fingerprint, and opaque idempotency key in same-tab `sessionStorage`; this lets a reload reuse the same backend replay key without storing folio, guest, amount, reference, or credential data. Confirmed success clears it. A `CAFE_STAFF` user may post a permitted charge after authority is restored, but must not collect or record a payment.

When creating a reservation or standalone guest profile through the staff API, send a new `x-idempotency-key` for the logical create. If the response is uncertain, retry the unchanged request with that same key before changing any field. A successful retry returns the original entity rather than creating a second guest, reservation, folio, or initial charge. Do not reuse the key for a different guest, stay, or creation type; that is a `409`. The opaque key and one-way fingerprint survive a same-tab reload without persisting the guest or reservation material, so reconcile the authoritative server state and retry only the unchanged intent.

Room assignment and lifecycle requests send `x-reservation-expected-updated-at` and the same `expectedUpdatedAt` body value. A mismatch or stale token is a `409`: inspect the refetched reservation before creating a new command. Check-in and check-out also require an explicit lifecycle idempotency key.

Use the selected-reservation command drawer for:

- cancellation or no-show only with a recorded reason; future arrivals cannot be marked no-show and checked-in stays must be checked out;
- guest name/contact/VIP changes only with both reservation-edit and guest-view permissions; stale guest timestamps fail with `409`;
- extras only with `post:charges`, an open folio, and backend `legacyFolioCharges` capability evidence. Enter baht with at most two decimals; the browser converts the string to integer satang without Float arithmetic.

If a lifecycle or guest request returns `409`, inspect the refetched reservation before trying a new command. If an extra request has an unknown network outcome, reconcile the folio before changing any material field. Never repost an extra with a new key merely because the first response was lost.

Guided check-in/check-out and cashier actions are sanitized navigation handoffs. Their URLs contain only allowlisted workflow and record identifiers, and the destination clears the query after consuming it. Front Desk AI may suggest or open these staff workflows, but it applies no reservation, room, folio, payment, rate, or availability change.

Room-block creation/clearing is not yet a Board timeline command. Use the existing permissioned inventory/settings flow until it is separately wired and tested. Reservations are never destructively deleted from the operational Board; correct lifecycle mistakes through audited status actions, and correct posted finances only through append-only reversals/refunds.

## Accounting V2 And Direct Booking Gates

Keep `ACCOUNTING_V2_ENABLED=false` and `DIRECT_BOOKING_ENABLED=false` until their acceptance matrices pass. Accounting uses append-only exact-satang corrections; never delete a posted financial row. Run `node scripts/run-accounting-v2-tests.mjs` before any staging exercise.

The legacy Accounting Dashboard and Cash Reconciliation tabs must remain unavailable in server mode until they use the Accounting V2 APIs. Run `npm.cmd run test:cashier-accounting-mode`; never treat browser-KV entries or cash counts as operational evidence.

Direct booking does not accept card data. Enabled staging also requires a backend-only `DIRECT_BOOKING_TOKEN_SECRET` with at least 32 characters. Run `node scripts/run-direct-booking-tests.mjs`, then prove concurrent last-room holds, idempotent replay, expiry, recovery, WAF/rate limiting, and staff handling against the exact release candidate before owner approval. Never print or persist the raw hold token after its issue response.

Deterministic analyzers are read-only. Run `node scripts/run-ops-analyzer-tests.mjs`; staff must submit any accepted recommendation through `/api/ops/commands`, where the existing permission, approval, reason, audit, idempotency, and emergency-stop controls apply.

## Autonomy Shadow Foundation

Keep every provider write and near-live automation gate disabled. The autonomy foundation accepts only `OBSERVE`, `SHADOW`, and `PROHIBITED` policy records and produces only `SHADOW_NOOP` action evidence.

Before applying migration `20260718120000_autonomy_shadow_foundation` to a restored staging copy, record counts only:

```sql
SELECT count(*) AS nonempty_legacy_channel_credentials
FROM "Channel"
WHERE "credentials" IS NOT NULL
  AND "credentials" <> '{}'::jsonb;

SELECT count(*) AS orphaned_channel_properties
FROM "Channel" c
LEFT JOIN "Property" p ON p.id = c."propertyId"
WHERE p.id IS NULL;
```

Both counts must be zero. A non-zero credential count requires backend secret-reference migration, credential rotation, and owner-approved reconciliation. Do not print the JSON, silently copy it, or weaken the migration guard. A non-zero orphan count requires property-ownership reconciliation.

After migration, `Channel.credentials` deliberately remains as a deprecated old-app rollback compatibility column. New Prisma clients ignore it. PostgreSQL defaults it to `{}` and constraint `Channel_credentials_must_be_empty` rejects every non-empty insert or update. Do not remove this column during the rollback window and do not weaken or bypass the constraint.

Run:

```powershell
npm.cmd run test:autonomy
$env:ALLOW_DB_E2E='true'
$env:E2E_DATABASE_URL='<disposable PostgreSQL URL>'
npm.cmd run test:e2e:autonomy
```

The guarded database test proves replay idempotency, concurrent locking, property isolation, emergency-stop blocking, audit/domain evidence, empty-only rollback-column enforcement, and no reservation/payment/provider mutation. It remains engineering evidence only. Production scheduling must use an external durable trigger and exact-release staging proof; the in-process scheduler is not autonomy proof.

Do not add provider acknowledgement or compensation records until a credentialed adapter implements write, acknowledgement, read-back, retry, reconciliation, and rollback semantics. Do not add Agents SDK execution tools; future agent tools may read sanitized snapshots or submit candidates only.

## Booking Email Parser Rollout And Room Mapping

1. Deploy parser changes with `BOOKING_EMAIL_AUTONOMY_ENABLED=false` and the booking source `autoProcessSafeEvents=false`.
2. Run a bounded near-live sync, then reprocess only `NEEDS_REVIEW`/`ERROR` records. Do not reset processed or ignored history and never run database-mutating E2E against production.
3. Open Channel Manager -> Room mapping. Review `Observed booking-email labels`; these rows are PII-free suggestions derived from the PMS event store, not OTA acknowledgement.
4. Configure the relevant property/provider channel if it is not present. Select `Use in editor`, confirm the exact OTA label, PMS room type, and operational room ids, enter a non-secret operational reason, then save. Do not map by direct SQL, guessed provider ids, or room-name similarity alone.
5. Confirm every active label maps to exactly one PMS room type and at least one operational room. Keep ambiguous or conflicting labels unmapped and resolve them with the manager/provider portal.
6. Reprocess the affected review rows and verify the automation decision resolves the expected provider/mapping ids and finds an assignable room without creating a reservation while the switches are off.
7. After manager/front-desk acceptance, enable `BOOKING_EMAIL_REQUIRE_CORROBORATION=true`, retain the 0.95 hard confidence floor and aligned Gmail authentication requirement, enable the global kill switch, then separately enable the source switch in Booking Inbox. Non-new-booking types remain review-only.
8. Watch Booking Inbox, manager notifications, reservation/guest timelines, and Booking Board placement. Disable the source first, then the global switch, on any extraction, mapping, duplicate, capacity, or assignment anomaly.
