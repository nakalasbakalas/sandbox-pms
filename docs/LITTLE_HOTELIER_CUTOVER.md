# Little Hotelier Sequential Cutover

## Current status boundary

This document and `scripts/little-hotelier-cutover.mjs` are a cutover control and evidence tracker. They do **not** prove that a live cutover, provider connection, booking sync, cancellation sync, or rollback has occurred. The script performs no provider login, credential exchange, API call, OTA write, DNS change, or production database mutation.

The state file must keep `mode` set to `TRACKING_ONLY`. A passing local report means only that the supplied metadata satisfies this runbook's gate. Every report includes `schemaVersion` and a deterministic `stateSha256`; retain the report with the exact private state file whose hash it records. Live provider behavior still requires account-owner execution and separately retained evidence.

## Required sequence

1. Run Little Hotelier and PMS Lite in shadow mode for at least seven complete days (168 hours). Little Hotelier remains the live OTA authority during this window.
2. Reconcile the shadow period and resolve every difference.
3. Cut over **one OTA at a time** in this default order:
   1. Booking.com (`booking_com`)
   2. Agoda (`agoda`)
   3. Trip.com (`trip_com`)
4. Observe and reconcile each OTA for at least 48 complete hours before starting the next OTA.
5. Declare the sequence complete only after all three 48-hour observations pass with zero unresolved differences.

The order may change only when the state records all three of these fields in `sequenceOverride`: an approval timestamp, an opaque owner-approval evidence reference, and an operational reason. The order must still contain each supported OTA exactly once.

## Safety and data rules

- Store the tracker JSON outside the repository, for example under an owner-only operations folder.
- Store source exports in private, access-controlled storage. Never commit exports to Git because they may contain personal data.
- Put only timestamps, SHA-256 checksums, aggregate difference counts, and opaque evidence references in tracker state.
- Never put guest names, emails, phone numbers, reservation identifiers, card data, cookies, passwords, tokens, signed URLs, API keys, or provider credentials in tracker state.
- Evidence references must be opaque handles without query strings, such as `evidence://cutover/booking-com/pre-export`. They are pointers, not inline evidence.
- Use real ISO-8601 timestamps with `Z` or an explicit offset, for example `2026-07-08T14:00:00+07:00`. The validator rejects timezone-less and impossible calendar timestamps, then compares absolute elapsed hours.
- Keep owner approval, provider-portal actions, and rollback execution outside this script. No CAPTCHA or 2FA bypass is permitted.

The schema rejects unknown fields and credential- or guest-shaped field names. The validator checks that evidence references and checksums are recorded; it cannot authenticate an external evidence system or prove that a referenced export is genuine.

## Tracker commands

Create a blank tracker in a private location outside the repo:

```powershell
$cutoverState = Join-Path $env:USERPROFILE 'SandboxHotel-private\little-hotelier-cutover-v1.json'
New-Item -ItemType Directory -Force (Split-Path $cutoverState) | Out-Null
node .\scripts\little-hotelier-cutover.mjs --template | Set-Content -Encoding utf8 $cutoverState
```

Generate a SHA-256 checksum for each private export, then copy only the checksum and an opaque evidence reference into the tracker:

```powershell
Get-FileHash -Algorithm SHA256 'C:\private-export-location\export-file.zip'
```

Run a gate:

```powershell
node .\scripts\little-hotelier-cutover.mjs --state $cutoverState --gate shadow
node .\scripts\little-hotelier-cutover.mjs --state $cutoverState --gate ready:booking_com
node .\scripts\little-hotelier-cutover.mjs --state $cutoverState --gate observe:booking_com
node .\scripts\little-hotelier-cutover.mjs --state $cutoverState --gate ready:agoda
node .\scripts\little-hotelier-cutover.mjs --state $cutoverState --gate observe:agoda
node .\scripts\little-hotelier-cutover.mjs --state $cutoverState --gate ready:trip_com
node .\scripts\little-hotelier-cutover.mjs --state $cutoverState --gate observe:trip_com
node .\scripts\little-hotelier-cutover.mjs --state $cutoverState --gate complete
```

Provider codes are exact and lowercase. The process exits `0` on a passing gate, `1` on a failed gate, and `2` for invalid command usage or an unreadable/invalid JSON state file. Capture the JSON report in the private change-ticket evidence, retain the exact tracker state beside it, and verify that the report's `stateSha256` matches before relying on it. The optional `--at` flag exists for deterministic tests and rehearsals; do not use a backdated validation time as live sign-off evidence.

## Evidence contract

| Gate | Required recorded evidence |
| --- | --- |
| All gates | Owner approval, change ticket, rollback runbook, staff briefing, baseline Little Hotelier export, baseline PMS export, and SHA-256 for both exports |
| `shadow` | Start and end timestamps at least 168 hours apart; end exports and checksums from both systems; reconciliation report; `PASS`; zero unresolved differences; sign-off |
| `ready:<provider>` | Passing shadow gate; every prior provider observed; target pre-cutover export and checksum; rollback snapshot and checksum; provider-specific rollback procedure; rollback rehearsal evidence; no active OTA observation |
| `observe:<provider>` | Recorded cutover timestamp and evidence; at least 48 elapsed hours; observation evidence; reconciliation evidence; `PASS`; zero unresolved differences; sign-off; no overlap with another OTA |
| `rollback:<provider>` | Recorded cutover; rollback execution evidence; post-rollback reconciliation evidence; `PASS`; zero unresolved differences; no later OTA already cut over |
| `complete` | Passing observation evidence for Booking.com, Agoda, and Trip.com in the recorded order, with no rollback in the sequence |

At minimum, the external reconciliation evidence should cover aggregate new-booking, modification, and cancellation counts plus inventory/allotment differences for the observed interval. Guest-level records stay in the private evidence system and must not be copied into tracker state or this repository.

## Operating procedure

### 1. Prepare and freeze the plan

1. Record owner approval, the change ticket, staff briefing, and the approved rollback procedure as opaque references.
2. Confirm monitoring ownership and an owner-approved cutover window in the referenced change ticket.
3. Export Little Hotelier and PMS baselines into private storage.
4. Record each export timestamp, opaque reference, and SHA-256 checksum before shadow starts.
5. Leave all live OTA routing on Little Hotelier.

Missing prerequisites are a hard stop. Do not begin shadow operation on an incomplete tracker.

### 2. Run the seven-day shadow

1. Record `shadow.startedAt` when comparable shadow capture begins.
2. Keep Little Hotelier authoritative and operate PMS Lite as the parallel comparison surface for at least 168 uninterrupted hours.
3. At the end, export both systems again and record their timestamps, references, and checksums.
4. Reconcile the period, resolve every discrepancy, record `reconciliationStatus: "PASS"` and `unresolvedDifferences: 0`, and retain operator sign-off.
5. Run the `shadow` gate. A non-zero exit is a hard stop.

If the shadow window is interrupted or its evidence is incomplete, start a new full seven-day window rather than editing timestamps to make the gate pass.

### 3. Cut over one OTA

For the current provider in `providerOrder`:

1. Capture a provider-specific pre-cutover export and a rollback snapshot in private storage. Record both SHA-256 checksums.
2. Retain the provider-specific rollback procedure and evidence that the procedure was rehearsed safely.
3. Run `ready:<provider>`. Do not perform the live portal/API change unless it exits `0` and the account owner authorizes execution.
4. The account owner performs the approved provider-side cutover through the provider's supported controls. The tracker does not perform this action.
5. Immediately record the real cutover timestamp and an opaque evidence reference. Never record a credential or signed session URL.
6. Begin the 48-hour observation. Do not start another OTA during this period.

### 4. Observe and reconcile for 48 hours

1. Monitor booking creation, modification, cancellation, and inventory behavior for 48 complete hours.
2. Reconcile aggregate provider and PMS results. Resolve every difference before sign-off.
3. After the full window, record the end timestamp, observation and reconciliation references, `reconciliationStatus: "PASS"`, `unresolvedDifferences: 0`, and sign-off.
4. Run `observe:<provider>`. A non-zero exit prevents the next provider from starting.
5. Repeat the preparation, cutover, and observation steps for the next provider in the recorded order.

The validator rejects a later provider cutover that begins before the prior provider's observation end. It also rejects more than one active observation.

### 5. Complete the sequence

After Trip.com, or the last provider in an owner-approved override order, passes its observation gate, run the `complete` gate. Retain the JSON report and its exact hash-bound private tracker state with the external change-ticket evidence. A passing report is engineering process evidence, not independent proof of live OTA sync.

## Rollback

Rollback does not wait for the 48-hour observation window. Use the owner-approved provider procedure when the change ticket's rollback condition is met, when reconciliation cannot reach zero unresolved differences, when monitoring evidence is unavailable, or when an authorized owner directs rollback.

1. Stop further OTA cutovers. Do not start or continue the next provider.
2. Execute the recorded provider-specific rollback procedure through supported provider controls.
3. Restore and verify the prior routing/inventory state using the recorded rollback snapshot.
4. Record the actual rollback timestamp and an opaque execution evidence reference.
5. Perform a post-rollback reconciliation, resolve every difference, and record its evidence reference, `postRollbackStatus: "PASS"`, and `postRollbackUnresolvedDifferences: 0`.
6. Run `rollback:<provider>`. A non-zero exit means the rollback record is incomplete.
7. Preserve the failed tracker as immutable evidence. After remediation and fresh owner approval, begin a new versioned tracker; do not continue to a later OTA in the rolled-back tracker.

The validator intentionally rejects `complete` when any provider in the sequence has a recorded rollback.

## Hard-fail conditions

The validator returns a failed report when any required prerequisite, timestamp, export, checksum, evidence reference, reconciliation result, sign-off, or rollback record is missing or invalid. It also fails for:

- a shadow duration below 168 hours;
- a provider observation below 48 hours;
- future-dated completion evidence;
- an OTA cutover before shadow completion;
- overlapping or out-of-order OTA cutovers;
- a changed provider order without recorded owner approval and reason;
- any reconciliation not marked `PASS` or with unresolved differences other than zero;
- continuing the sequence after a rollback;
- unknown schema fields; or
- credential- or guest-data-shaped fields.

Do not override a hard failure by editing evidence timestamps, checksums, or results. Correct the underlying operational condition and rerun the relevant gate.
