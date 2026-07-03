# Slice 5AP - Room Inventory CLI Query-Path Reprobe

Date: 2026-07-03T09:21:55.6894174+07:00.

Verdict: blocked. Real production room inventory is still not proved for launch sign-off. The corrected Render CLI non-interactive syntax still returned empty output for known-good, invalid, and aggregate room-count SQL, so this path cannot be trusted as production inventory evidence.

## Scope Boundary

- No deploy, restart, SSH session, interactive production database shell, production database mutation, DB-mutating E2E, credentialed login, screenshot capture, or secret-value access was performed.
- SQL probes were read-only and limited to `SELECT`/`COPY (SELECT ...)` aggregate statements that avoided room numbers, guest data, reservations, payments, users, notes, cookies, tokens, passwords, and raw connection strings.
- No production database URL, token, password, cookie, or raw secret value was requested or recorded.

## Commands And Results

| Command | Result | Evidence Summary |
| --- | --- | --- |
| `render psql --help` | Passed | Confirmed documented non-interactive syntax is `render psql [postgresID|postgresName] -c "SELECT ..." -o text/json`, with optional raw `psql` args after `--`. |
| `render pgcli --help` | Passed | Confirmed `pgcli` exposes session support but no non-interactive `-c`/`--command` flag. |
| `render postgres --help` | Failed as unsupported command | Render CLI returned `unknown command "postgres"` for this version. |
| `Get-Command psql` | Failed/no default command | Default process `PATH` still does not expose `psql`; PostgreSQL 16 was prepended to `PATH` for Render CLI `psql` reprobes. |
| Codex tool discovery for Render MCP database/query tools | No callable Render database query tool | Tool discovery did not expose Render MCP database query/list tools in this session. |
| `Test-Path .\ops\rooms.production.json` | Failed/no file | The current checkout does not contain a local `ops/rooms.production.json` import artifact. This does not prove production inventory is absent; it only means this repo path cannot serve as import proof in this checkout. |
| `render services -o json` filtered to `sandbox-hotel-pms-db-v43m` | Passed | Confirmed Render PostgreSQL `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) is `available`, primary, PostgreSQL 17, region `oregon`, plan `basic_256mb`, database `sandbox_hotel_pms`, and not suspended. This proves resource status only, not room rows. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a -c "SELECT 1 AS probe;" -o text` | Inconclusive | Exit code 0 with empty output. |
| `render psql sandbox-hotel-pms-db-v43m -c "SELECT 1 AS probe;" -o text` | Inconclusive | Exit code 0 with empty output. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a -c "SELECT * FROM __codex_nonexistent_probe__;" -o text` | Inconclusive | Exit code 0 with empty output even for a deliberately invalid table. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a -c "COPY (SELECT 1 AS probe) TO STDOUT WITH CSV HEADER;" -o text` | Inconclusive | Exit code 0 with empty output. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a -c "SELECT 1 AS probe;" -o json -- --csv -q` | Inconclusive | Returned `{ "output": "" }`. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a -- --command "SELECT 1 AS probe;" --csv -q` | Failed as unsupported non-interactive shape | Render CLI returned `--command flag is required in non-interactive mode`. |
| Aggregate `Room` count query through `render psql ... -o json` | Inconclusive | Returned `{ "output": "" }` with exit code 0; no total room or room-type count was returned. |
| Aggregate room status distribution query through `render psql ... -o json` | Inconclusive | Returned `{ "output": "" }` with exit code 0; no room status distribution was returned. |
| `GET https://book.sandboxhotel.com/api/rooms` without credentials | Passed as security probe | Returned HTTP `401` with `Authentication is required`; the room list is protected and cannot be used as unauthenticated inventory proof. |
| `GET https://book.sandboxhotel.com/api/today` without credentials | Passed as security probe | Returned HTTP `401` with `Authentication is required`; live aggregate room data is protected and cannot be used as unauthenticated inventory proof. |

## Evidence Decision

The Render PostgreSQL resource is available, and the public room endpoints are protected, but neither fact proves real production inventory. The corrected `render psql -c ...` path remains unreliable because it returns empty output for known-good SQL, invalid SQL, CSV/`COPY` probes, and aggregate inventory SQL. No production inventory counts, room-type counts, or room status distribution were recorded.

This P0 remains open until a reliable approved evidence path returns redacted aggregate counts and owner/source proof, such as Render MCP/API query tooling, Render dashboard connection details used without printing the raw URL, a redacted dashboard/export, or credentialed PMS admin room-setup proof.

## Next Recommended Slice

Use a reliable approved evidence path for production room inventory. Do not rely on the current Render CLI `psql` path until it returns trustworthy output and expected errors. If owner-gated proof is unavailable, get PR #150 reviewed/deployed and rerun the public setup-complete reprobe.
