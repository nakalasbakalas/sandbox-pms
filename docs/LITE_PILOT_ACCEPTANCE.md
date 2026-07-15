# Lite V1 Pilot Acceptance Record

Use this record for one exact reviewed commit. Repository tests, synthetic fixtures, provider application preparation, and historical recovery evidence do not complete the live gates below.

## Release Identity

- Reviewed commit: `0583c6abb88deb3f02585cc08a13f50bd55c7789` (PR #173 exact head; CI #202 passed)
- Render staging service/deploy: `srv-d9asptjeo5us73dh0270` / `dep-d9b5qphkh4rs73chqd10` (`live`)
- Disposable/staging database: `sandbox-hotel-pms-lite-staging-db` / `dpg-d9asp1jeo5us73dgus40-a` (`available`; no production database used)
- `/healthz?deep=1` result and timestamp: HTTP 200, `ok=true`, Lite UI, active write mode, database configured/healthy at 2026-07-15 11:34 Asia/Bangkok; Gmail Pub/Sub disabled/unconfigured
- `/api/version` commit, UI variant, build time, service, and asset identifier: exact head above, `lite`, `2026-07-14T16:02:15.845Z`, `sandbox-hotel-pms-lite-staging`, `assets/index-CTgbifAg.js`
- Browser asset identifier matches `/api/version`: verified at 2026-07-15 11:34 Asia/Bangkok; root HTML referenced `assets/index-CTgbifAg.js`
- Cloudflare hostname, DNS/proxy path, WAF configuration, and traffic-enforcement evidence: pending

## Data And Recovery Gate

- Fresh pre-migration Render recovery point and retention window: pending
- Disposable restore target and validation result: pending
- All Lite migrations applied to the disposable/staging target: pending
- `npm.cmd run money:reconcile` reports `PASS` with zero unexplained differences: pending
- Representative booking, folio, tax, void, partial/multiple payment, and exact-zero workflows pass: pending
- Legacy Float parity remains available for the 30-day rollback period: pending

Never record database URLs, passwords, guest rows, or raw provider payloads here.

## Gmail Shadow Gate — Seven Consecutive Days

Record daily redacted aggregate evidence for the authenticated Gmail API source. The accepted business mailbox remains `booking@sandboxhotel.com`; the authorized Google account/alias must be recorded privately by the owner without publishing credentials.

For each day record: watch expiry health, push deliveries, five-minute reconciliation runs, create/modify/cancel counts per Booking.com/Agoda/Trip.com, duplicates, parser errors, review decisions, missed-push recovery, and any mismatch against authoritative OTA evidence.

| Day | Date | Watch/push | Five-minute recovery | Create/modify/cancel corpus | Mismatches/unresolved | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | pending | pending | pending | pending | pending | pending |
| 2 | pending | pending | pending | pending | pending | pending |
| 3 | pending | pending | pending | pending | pending | pending |
| 4 | pending | pending | pending | pending | pending | pending |
| 5 | pending | pending | pending | pending | pending | pending |
| 6 | pending | pending | pending | pending | pending | pending |
| 7 | pending | pending | pending | pending | pending | pending |

The corpus must include at least one owner-approved, heavily redacted real create, modification, and cancellation example for each provider. Raw message ids, subjects, guest/payment details, and bodies must not enter tracked evidence. Every event must remain review-only until authorized approval. A stale modification or cancellation must be proven unable to overwrite a same-time/newer processed lifecycle event.

## Staff Pilot — Fourteen Consecutive Days

- Pilot start/end: pending
- Named pilot owner and rollback deputy: pending
- Admin, Manager, Front Desk, Housekeeping, Cashier role checks: pending
- Desktop and tablet acceptance on all six Lite surfaces: pending
- English and Thai workflow/error acceptance by Thai-speaking staff: pending
- Bookings, Front Desk, Board, Housekeeping, Channel Desk, and Settings acceptance: pending
- Concurrent edit, stale data, SSE reconnect, and read-only-mode behavior: pending
- Daily queue-age, failed-task, inventory-drift, duplicate-risk, and unresolved-item review: pending
- Final staff sign-off and accepted risks: pending

No pilot day passes while a material booking, cancellation, payment, room assignment, or OTA inventory discrepancy is unresolved.

## OTA And Cutover Gate

- Booking.com remains manual unless an independently approved connection exists.
- Agoda direct API application: owner facts/consent, submission reference, provider response, sandbox/certification, and production approval are separate pending gates.
- Trip.com direct API application: owner facts/consent, submission reference, provider response, sandbox/certification, and production approval are separate pending gates.
- Channex remains disabled unless the certified channel-only integration gate passes.
- Every active/future booking, room/rate mapping, opening inventory, duplicate risk, and Channel Desk task is reconciled before cutover.
- Disconnect/cut over only one OTA at a time in an owner-controlled maintenance window.
- After each provider change, prove one booking, one modification, and one cancellation, then observe for 48 hours before changing the next provider.

## Go/No-Go And Rollback

- Exact production commit/deploy approved: pending
- Fresh production recovery evidence approved: pending
- Seven-day shadow passed: pending
- Fourteen-day staff pilot passed: pending
- Provider and Cloudflare gates passed: pending
- Owner go/no-go decision, timestamp, and accepted risks: pending
- Legacy access and current exports retained: pending
- 30-day rollback window start/end: pending
- Final post-window reconciliation before removing Float/legacy authority: pending

Any failed gate is a no-go. Keep the legacy system available and Lite staging/read-only until the failure is corrected and re-proven.
