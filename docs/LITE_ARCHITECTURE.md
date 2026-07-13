# Sandbox PMS Lite V1 Architecture

Last reviewed: 2026-07-13

## Status And Release Boundary

Lite V1 is a parallel React client in this repository. It reuses the existing Node/Prisma transaction, authentication, RBAC, reservation, folio, payment, and housekeeping services. PostgreSQL remains the operational source of truth; the Lite browser does not own booking or inventory state.

The current implementation is a staging candidate only. Repository code and local tests do not prove that the Lite migrations are applied, that Gmail Pub/Sub is configured, that a Render cron is scheduled, that a Cloudflare hostname routes to the Lite service, or that any OTA partner application has been approved. Production and domain cutover remain owner-gated.

## Staff Surfaces

The Lite client lives under `src-lite/` and exposes six focused surfaces:

- Front Desk: arrivals, departures, and in-house stays; room assignment; nationality/ID capture; exact-payment or manager pay-later check-in; zero-balance checkout; and housekeeping handoff.
- Bookings: filtered/paginated booking reads, same-day walk-ins, audited edits/cancellation/no-show, and a detailed folio with exact-satang charges and payments. Active/prepaid stays keep an open folio for incidentals; a settled checkout closes it, while an approved unpaid checkout stays open until later settlement.
- Booking Board: a date-ranged room grid with complete reservation segments and a separate unassigned-booking list. Assignment and stay-date edits use a reservation version plus serializable database conflict checks so a stale board cannot overwrite newer work.
- Housekeeping: room readiness and cleaning-state work.
- Channel Desk: Gmail intake health, review-required booking emails, mappings, and manual availability tasks.
- Settings: property, rooms, users, Gmail, channel, and release information according to backend permissions.

Thai and English UI copy exists for the core Lite shell and workflows, but Thai-speaking staff acceptance is still required before production use.

## Near-Live Inbound Booking Email

The intended inbound flow is:

1. Gmail publishes a mailbox history notification to an authenticated Google Pub/Sub push subscription.
2. `POST /api/booking-email/gmail/push` verifies the Google-signed OIDC token, expected audience, service-account email, subscription, mailbox, payload size, and history cursor.
3. The server stores the Pub/Sub message in `BookingEmailPushDelivery` before returning HTTP `202`. Duplicate Pub/Sub message ids are idempotent and do not reset an existing delivery.
4. A bounded worker drains durable deliveries, obtains Gmail history, retrieves candidate messages with backend OAuth, and calls the normal booking-email ingester with `reviewOnly: true`.
5. The resulting `BookingEmailEvent` remains in the staff review workflow. Email receipt alone never creates, edits, cancels, charges, pays, or assigns a reservation.
6. Parser errors remain visible in Channel Desk for retry or reasoned rejection; they are never hidden inside an aggregate count.
7. Only an authorized staff approval may invoke the existing PMS transaction functions. Creating, modifying, cancelling, and paying each recheck their action-specific backend permission. New/modification approvals require one verified age per declared child. Stay totals, payments, and deposits retain separate parser semantics; conflicting same-kind values are ambiguous, currency is never inferred from an unmarked number, and approval cannot replace or relabel persisted money. A verified OTA stay total is inclusive exact satang with persistent reservation provenance. Approved OTA-originated inventory changes then recalculate absolute-availability tasks for every enabled OTA, including the source provider, so stale pending work is superseded instead of left actionable.

`npm.cmd run booking-email:maintenance` is the reconciliation/fallback command. One bounded run renews due Gmail watches, retries or coalesces durable push deliveries, and reconciles every enabled Gmail source. Configure it as a five-minute Render cron in staging. A five-minute cron is a recovery interval, not proof of five-minute delivery and not a zero-lag guarantee. The schedule, watch, OAuth tuple, Pub/Sub topic/subscription, and first successful staging run must all be proven separately.

Required Pub/Sub configuration uses backend environment secrets/metadata only:

```env
BOOKING_EMAIL_GMAIL_PUBSUB_ENABLED=true
BOOKING_EMAIL_GMAIL_PUBSUB_TOPIC=projects/<project>/topics/<topic>
BOOKING_EMAIL_GMAIL_PUBSUB_SUBSCRIPTION=projects/<project>/subscriptions/<subscription>
BOOKING_EMAIL_GMAIL_PUBSUB_AUDIENCE=https://<staging-host>/api/booking-email/gmail/push
BOOKING_EMAIL_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL=<push-service-account>
```

The existing Gmail OAuth refresh-token tuple is still required. Do not record any token, client secret, authorization code, raw email, or guest/payment detail in deployment evidence.

## Live UI Refresh Boundary

`GET /api/realtime/events` is an authenticated Server-Sent Events signal channel protected by the narrow `view:realtime` permission. Housekeeping receives safe room-state invalidations without receiving booking-board access. Events contain only an allowlisted event type, timestamp, optional opaque entity id, and optional reason code. They contain no guest, email, payment, room, or credential data. Clients refetch only their authorized APIs after a signal and also poll as a fallback.

The hub is in-process and does not replay events. A reconnect starts with `sync-required`, so correctness comes from PostgreSQL and API refetch, not from SSE delivery. Multi-instance deployment would require a shared event bus or equivalent invalidation mechanism before SSE could be treated as cross-instance realtime delivery.

## Manual Outbound Availability Queue

Lite V1 does not automate OTA writes. `ManualChannelConnection`, `ManualChannelRoomMapping`, and `ManualChannelTask` provide a durable provider-neutral workflow for `booking_com`, `agoda`, and `trip_com`:

- non-secret property, room, and rate-plan mapping metadata;
- activation only after every room type with a physical room has a unique active external room/rate-plan target (temporarily out-of-service rooms still count);
- official HTTPS Extranet links restricted to the provider's domain;
- desired availability calculated from PMS rooms, active reservations, holds, and out-of-service inventory;
- a current task per provider, room type, and stay date;
- an immutable external room/rate-plan target snapshot on every task revision, so a later mapping edit cannot silently retarget work already shown to staff;
- coalescing when the desired value is unchanged;
- supersession and revision checks when a newer value replaces pending work;
- source-provider reconciliation after an approved OTA email using current absolute PMS availability, including supersession of stale pending work;
- exact availability confirmation, operator, timestamp, notes, and audit evidence when staff complete a task.
- audited task suppression when an enabled provider/room cell has no active mapping, so staff never receive a task with an unknown external target.

Front Desk, Manager, and Admin may complete a current manual task. Only Manager/Admin may use the disabled-first connection/mapping setup, run a bounded reconciliation, or retry/reopen work. A disabled-to-enabled transition transactionally stages an initial absolute-availability baseline for that connection across the manager-selected 1–90-day horizon (90 days by default); activation rolls back if staging fails. A retry recalculates current absolute PMS availability and snapshots the current mapping before creating its audited revision. Channel Desk reports database totals separately from its bounded returned lists. Passwords, cookies, tokens, 2FA material, and credential-shaped configuration fields are rejected.

This is the only operator-facing queue when `PMS_UI_VARIANT=lite`. Set `CHANNEL_SYNC_QUEUE_BACKEND=lite_manual` and keep `BOOKING_EMAIL_NEAR_LIVE_ENABLED=false`. The repository also retains a Hotel Ops task-based availability CLI for legacy compatibility; that CLI refuses to mutate when the Lite backend is selected and must never be run as a parallel queue.

Manual processing has an unavoidable exposure window between a PMS change and staff updating every affected Extranet. It cannot promise zero-lag inventory, guaranteed two-way sync, or elimination of overbooking. Pending tasks, task age, failures, and completion evidence must remain visible to staff.

## Provider Access Decision

- Booking.com: an ordinary individual-property Extranet account is not a direct Connectivity API route. The official path is the connectivity-provider program: [Booking.com Connectivity](https://connect.booking.com/?lang=en). Lite therefore treats Booking.com as manual unless a certified provider connection is later obtained.
- Agoda: direct connectivity requires partner onboarding and testing through [Agoda Connectivity](https://www.agodaconnectivity.com/become-a-partner). Preparing an application is not approval; submission requires owner-controlled legal, business, and technical details.
- Trip.com: direct connectivity requires partner onboarding against the [Trip.com Open Platform](https://connect.trip.com/opendoc/3024822.html). Preparing an application is not approval; submission requires owner-controlled legal, business, and technical details.
- Channex: a provider-neutral boundary exists, but `DISABLED_CHANNEX_ADAPTER` deliberately rejects automatic delivery. No Channex account, certification, secret path, mapping acceptance, or live push is claimed. If zero-lag distribution becomes essential, a channel-only certified rail such as [Channex](https://docs.channex.io/about-channex-and-faq) is the preferred next integration rather than another full PMS.

## Money Precision Gate

Lite monetary DTOs read the nullable integer-satang columns as authoritative and fail closed when a required satang value is missing. Active PMS writers derive both the satang value and the legacy Float value from one validated integer amount. Reservation pricing, deposits, folios, payments, charges, booking-email amounts, property fees, tax basis points, and room-type rates therefore use exact satang arithmetic; Float remains only for rollback parity during the pilot. `providerTotalSatang` and `providerTotalCurrency` persist a verified inclusive OTA total; non-pricing edits leave it untouched, and provider-linked date/room/occupancy/rate changes require a new parser-verified total. `npm.cmd run money:reconcile` is a read-only parity report.

Production money authority remains blocked until all of the following are complete and evidenced:

1. A fresh Render recovery point and successful disposable restore test.
2. Apply the nullable satang-column and integer-basis-point migration to the disposable restore.
3. Prove the audited backfill with a zero-difference reconciliation report.
4. Prove dual-write parity while the legacy UI remains available.
5. Prove Lite authoritative satang reads/writes through database-backed workflows.
6. Zero unexplained folio/payment discrepancies.
7. A 30-day rollback period before Float authority is removed.

The repository implements these storage and runtime contracts, but production folio/payment acceptance remains open until the migration, restore, reconciliation, and rollback-period evidence exists on the target environment. Float must not be removed during that rollback period.

## Deployment And Cutover

The safe sequence is:

1. Validate locally and in CI, including Prisma migration validation and non-production tests.
2. Deploy a separate `sandbox-hotel-pms-lite-staging` service and sanitized disposable/staging database.
3. Configure Gmail OAuth, Pub/Sub push, and a five-minute maintenance cron on staging; capture redacted health and review-only event evidence.
4. Run DB-mutating E2E only with `ALLOW_DB_E2E=true` and a disposable/staging `E2E_DATABASE_URL`; never use production-like data.
5. Complete money reconciliation, Thai/English staff acceptance, role testing, manual-channel mapping, provider application decisions, recovery proof, WAF/routing proof, and a seven-day shadow comparison.
6. Only after owner approval, create a manual-release production Lite service and pilot it on a separate hostname while the existing service remains available.
7. Move public domains one at a time after exact `/api/version`, asset, health, auth, and workflow proof. Keep the legacy service restricted and read-only during rollback.

No repository change alone proves any Render deployment, Cloudflare routing/WAF path, production database migration, Gmail watch, provider approval, or staff acceptance.

## Main Implementation Files

- Lite client: `src-lite/`, `vite.lite.config.ts`, `tsconfig.lite.json`
- Lite read models: `server/lite-service.mjs`
- PMS transactions and reviewed email actions: `server/pms-service.mjs`
- Gmail push/history/maintenance: `server/booking-email-gmail-sync.mjs`, `scripts/booking-email-maintenance.mjs`
- Manual channel queue: `server/manual-channel-service.mjs`
- PII-safe invalidation: `server/realtime-events.mjs`
- API and RBAC wiring: `server/index.mjs`, `server/api-routes.mjs`, `server/rbac.mjs`
- Data model/migrations: `prisma/schema.prisma`, `prisma/migrations/20260710120000_lite_manual_channel_queue/`, `prisma/migrations/20260710123000_lite_gmail_push/`, `prisma/migrations/20260713100000_money_satang_expand/`, `prisma/migrations/20260713110000_manual_channel_mapping_target_uniqueness/`, `prisma/migrations/20260713120000_manual_channel_task_target_snapshot/`, `prisma/migrations/20260713130000_provider_total_provenance/`

## Proof Still Required

- Current branch validation and CI results for Lite, Gmail, manual-channel, legacy, and launch gates.
- Disposable/staging migration apply and rollback/restore evidence.
- Exact-money migration, restore, and zero-difference reconciliation evidence on disposable/staging PostgreSQL; repository implementation alone is insufficient.
- Render staging deploy, health, release metadata, five-minute cron, Gmail watch, push, retry, and reconciliation proof.
- Review-gate evidence for Booking.com, Agoda, and Trip.com new/modification/cancellation samples without guest PII in artifacts.
- Manual-channel task age, coalescing, supersession, absolute source-provider reconciliation, completion, and audit evidence.
- Owner-controlled Agoda and Trip.com application submission/approval evidence; no approval is assumed.
- Cloudflare DNS/proxy/WAF evidence for the eventual Lite hostname and exact domain-to-commit mapping.
- Thai-speaking staff acceptance, recovery proof, 14-day pilot, 30-day rollback, and owner go/no-go.
