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

OTA credentials must be platform secrets only. Do not commit or log them. Booking.com adapter secrets are read from `BOOKING_COM_USERNAME` and `BOOKING_COM_PASSWORD`, with `BOOKING_USERNAME` and `BOOKING_PASSWORD` kept as compatibility aliases.

Booking email intake uses `BOOKING_EMAIL_PRIMARY_MAILBOX=booking@sandboxhotel.com`. Do not store a Gmail mailbox password in app config. Server sync requires `BOOKING_EMAIL_GMAIL_ACCESS_TOKEN` or a future refresh-token flow owned by the app server.

Booking Inbox operators:

1. Use `/booking-inbox` to review imported booking email events.
2. Use Approve & Apply only when the extracted guest, dates, room type, amount, and reservation match are clear.
3. Use Edit Parsed Details Then Apply when the parser is close but needs corrected stay, payment, or guest fields.
4. Use Link / Create Reservation to link matched events by reservation id or create only clearly unmatched new bookings.
5. Enter an operational reason for cancellation email actions.
6. Treat missing mailbox sync credentials as a provider setup issue; existing imported events can still be reviewed if backend routes are available.

Hotel Ops notification center:

1. In server mode, the shared header notification bell shows backend Hotel Ops notifications for users with Ops permission.
2. Provider-pending email intents mean the PMS recorded the notification but no mail provider has delivered it yet.
3. Read/dismiss controls persist server-side acknowledgment records and audit entries; provider delivery status stays unchanged.

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
4. Monitor `/ops/intelligence` for alerts.
5. Treat recommendations as separate approval-gated tasks.

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
