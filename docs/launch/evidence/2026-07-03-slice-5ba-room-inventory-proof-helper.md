# 2026-07-03 Slice 5BA - Room Inventory Proof Helper

Status: helper implemented, deployed, and run as a Render one-off job. Production aggregate room counts are now recorded; owner/import source proof remains open.

## Scope

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Scope: add a read-only aggregate room inventory proof helper to replace the unreliable Render CLI `psql` evidence path.
- No production database mutation, credentialed login, room-number export, guest data, user data, payment data, raw database URL, or secret-value access was performed.

## Change

- Added `scripts/prove-room-inventory.mjs`.
- Added `npm run rooms:proof`.
- Updated README/database docs and the launch room-inventory proof docs.

The helper:

- reads only from the configured `DATABASE_URL`,
- emits aggregate room counts only,
- omits room numbers, guests, reservations, users, payments, and raw database URLs,
- redacts room-type labels by default to stable `ROOM_TYPE_XX` keys,
- supports `-- --include-room-type-labels` only when operations-owner approval exists.

## Local Validation

| Command | Result | Notes |
| --- | --- | --- |
| `npm.cmd run rooms:proof` | Passed | Ran against local `localhost:55432/sandbox_hotel_dev`, emitted aggregate counts only, and omitted room numbers/guest/user/payment/reservation data/raw database URL. |
| `npm.cmd run lint` | Passed | ESLint completed. |
| `npm.cmd run launch:evidence` | Passed | Launch evidence inventory passed; no unredacted secret-shaped values were found in launch evidence docs or high-confidence production secret-shaped tracked/unignored text files. |
| `git diff --check` | Passed | Only existing CRLF conversion warnings were reported. |

## Local Output Boundary

The local proof run reported aggregate counts for the local dev database only. It is useful to validate the helper's behavior, but it is not production inventory proof and must not be used as launch sign-off.

## Render Deployment And One-Off Job

| Action | Result | Notes |
| --- | --- | --- |
| GitHub CI for `527e231e3821eda6f70fdf1d3436e81bb098b0d7` | Passed | Run `28656054381`, job `84985283168`, including launch gate. |
| `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit 527e231e3821eda6f70fdf1d3436e81bb098b0d7 --wait` | Passed | Live deploy `dep-d93pe7hkh4rs73dp5bcg`; predeploy ran migrations with no pending migrations and prod-safe seed skipped room inventory. |
| `render jobs create srv-d6ns31h4tr6s73c9i8g0 --start-command "npm run rooms:proof"` | Passed | One-off job `job-d93pfr6q1p3s73a2ufh0` succeeded. |

## Production Aggregate Counts

Source: Render job `job-d93pfr6q1p3s73a2ufh0`, timestamp `2026-07-03T11:07:47Z`.

| Field | Value |
| --- | --- |
| Database target | `sandbox_hotel_pms`, schema `pms_v2`, host id `dpg-d6ns2d94tr6s73c9hve0-a` |
| Property code | `SANDBOX` |
| Room type count | `2` |
| Total room count | `33` |
| Operationally available rooms | `33` |
| Inactive rooms | `0` |
| Current status distribution | `VACANT_CLEAN=32`, `OCCUPIED_CLEAN=1`, all other tracked current statuses `0` |
| Redacted room-type buckets | `ROOM_TYPE_01=17`, `ROOM_TYPE_02=16` |

Redaction boundary confirmed by the helper output: room numbers, guest data, reservation data, user data, payment data, and raw database URL were omitted. Room-type labels were redacted because `--include-room-type-labels` was not used.

## Remaining Proof To Close

Match the production aggregate counts above to owner/import evidence proving the inventory came from the approved real source and not fake seed/demo data. This slice proves production rows and status distribution exist; it does not prove source-of-truth approval by itself.
