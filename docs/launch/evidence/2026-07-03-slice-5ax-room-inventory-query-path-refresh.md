# Slice 5AX - Production Room Inventory Query-Path Refresh

Date: 2026-07-03T04:25Z.

Verdict: completed as a read-only refresh; real production room inventory remains unproved for launch sign-off. The Render Postgres resource is available, and unauthenticated live room endpoints are correctly protected, but the current Render CLI `psql` path still cannot be trusted because known-good, invalid-table, and aggregate inventory queries all return exit code 0 with an empty `output` field.

## Scope

- Target public host: `https://book.sandboxhotel.com`.
- Target Render Postgres: `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`).
- Commands were read-only. No import, onboarding, deploy, restart, SSH session, interactive production database shell, production database mutation, DB-mutating E2E, credentialed production login, screenshots, or secret-value access was performed.
- Queries were limited to `SELECT 1`, a deliberately invalid table probe, and aggregate room counts/status distribution. No guest, reservation, payment, user, token, cookie, room-number, note, password, or raw database URL fields were requested.

## Commands And Results

| Command | Result | Evidence Summary |
| --- | --- | --- |
| Read `ROOM_INVENTORY_PROOF.md` | Passed | Current canonical proof still marked room inventory blocked. |
| `Test-Path .\ops\rooms.production.json` | Failed/no file | Current checkout still has no `ops/rooms.production.json` production-room import artifact. |
| `rg --files \| rg '(^\|/)(rooms\.production\.json\|.*room.*\.json)$'` | Failed/no matching file | No production room import JSON was found through this filename search. |
| `render psql --help` | Passed | CLI still documents non-interactive `--command` support. |
| `where.exe psql` | Failed on default `PATH` | `psql` is not on the default process `PATH`. |
| `C:\Program Files\PostgreSQL\16\bin\psql.exe --version` | Passed | Local PostgreSQL client `psql (PostgreSQL) 16.13` is available when explicitly referenced. |
| Tool discovery for Render database query tools | No usable Render DB query tool exposed | The session exposed no callable Render database query/list MCP tool; returned tools were unrelated to Render DB querying. |
| Filtered `render services get dpg-d6ns2d94tr6s73c9hve0-a -o json` | Passed | Target Postgres resource is `available`, `primary`, PostgreSQL `17`, region `oregon`, plan `basic_256mb`, database `sandbox_hotel_pms`, 15 GB disk, and `not_suspended`. This proves resource status only, not room rows. |
| `render psql ... --command 'SELECT 1 AS probe;' --output json` with PostgreSQL 16 on `PATH` | Inconclusive | Exit code 0, output `{ "output": "" }`. |
| `render psql ... --command 'SELECT * FROM __codex_nonexistent_probe__;' --output json` with PostgreSQL 16 on `PATH` | Inconclusive/untrusted | Exit code 0, output `{ "output": "" }` even for a deliberately invalid table. |
| `render psql ... --command '<aggregate room type and room count query>' --output json` with PostgreSQL 16 on `PATH` | Inconclusive | Exit code 0, output `{ "output": "" }`; no room counts were returned. |
| `render psql ... --command '<room status distribution query>' --output json` with PostgreSQL 16 on `PATH` | Inconclusive | Exit code 0, output `{ "output": "" }`; no status distribution was returned. |
| Unauthenticated `GET /api/rooms`, `/api/today`, `/api/settings/room-setup` | Passed as security behavior | Each returned `401 Authentication is required`; public endpoints cannot be used as unauthenticated inventory proof. |

## Evidence Decision

No current command output proves real production room inventory. The database resource exists and is available, and protected live endpoints correctly deny unauthenticated access, but neither proves room rows, real room source ownership, or status distribution.

The current Render CLI `psql` path remains rejected as launch evidence because it returns the same empty output for a known-good query, a deliberately invalid query, and aggregate room inventory queries. A reliable proof path must return actual aggregate counts and expected errors before it can be used for launch sign-off.

## Evidence Still Required To Close

- Property/operations owner-approved real room source.
- Import/onboarding evidence or credentialed PMS admin room-setup evidence.
- Aggregate room-type count, total room count, and status distribution.
- Evidence that configured rooms are real production inventory and not fake seed data.
- Evidence that setup-required or incomplete inventory cannot pass launch-ready checks.

## Next Recommended Slice

Use a reliable approved inventory proof path: Render MCP/API query tooling, Render dashboard connection details used locally without printing the raw URL, a redacted dashboard/export, or credentialed PMS admin room-setup proof. Do not rely on the current Render CLI `psql` path until it returns trustworthy output and expected errors.
