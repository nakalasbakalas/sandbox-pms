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

Booking email intake uses `BOOKING_EMAIL_PRIMARY_MAILBOX=booking@sandboxhotel.com`. Do not store a Gmail mailbox password in app config. Server sync requires either `BOOKING_EMAIL_GMAIL_ACCESS_TOKEN` or backend OAuth refresh-token credentials: `BOOKING_EMAIL_GMAIL_CLIENT_ID`, `BOOKING_EMAIL_GMAIL_CLIENT_SECRET`, and `BOOKING_EMAIL_GMAIL_REFRESH_TOKEN`. For Render, prefer the durable refresh-token tuple. Use `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` to check current Render key presence without printing values, then use `npm.cmd run render:gmail-oauth` as a dry-run before applying any env-var changes. Operational/security/provider-admin emails from OTA senders are not booking events; keep those rows `UNKNOWN` / review-only unless staff confirm they are actionable reservation communications. When no explicit `--query` is supplied, historical backfill now defaults to the approved provider-query boundary instead of the incomplete direct `to:booking@sandboxhotel.com` filter.

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
4. Use Link / Create Reservation to link matched events by reservation id or create only clearly unmatched new bookings.
5. Enter an operational reason for cancellation email actions.
6. Use Reprocess only for stale `NEEDS_REVIEW` or `ERROR` events after parser changes; reprocess returns the event to the review queue and does not auto-approve it.
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
