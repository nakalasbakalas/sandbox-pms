# Room Inventory Proof

Date: 2026-07-02T07:20Z.
Latest update: 2026-07-02T15:06+07:00.

Verdict: blocked. Real production room inventory is still not proved for launch sign-off.

This file is the canonical Slice 3 evidence record for production room inventory. It records only non-secret command output and read-only probes. It does not contain room numbers, guest data, user data, database URLs, tokens, passwords, cookies, or raw secret values.

## Required Proof To Close

Production room inventory can be marked complete only when all of these are recorded:

- Real room source approved by the property or operations owner.
- Import/onboarding result count matches the expected real room set.
- Room-type counts and room status distribution are visible, with room numbers redacted if needed.
- Evidence shows the inventory was configured through approved onboarding/import, not fake seed data.
- Setup-required or incomplete inventory cannot be mistaken for production-ready inventory.

## Commands

| Command | Result | Notes |
| --- | --- | --- |
| `render psql --help` | Passed | Confirmed the CLI supports non-interactive `render psql [postgresID|postgresName] -c "..." -o text`. |
| `render --version` | Passed | Slice 5R confirmed Render CLI v2.13.0 is installed; CLI reports v2.21.0 is available. |
| Codex tool discovery for Render MCP database/query tools | No callable Render query tool | Slice 5R did not expose Render MCP `query_render_postgres` or equivalent query/list tools in this Codex session. |
| `Get-ChildItem -LiteralPath 'C:\Program Files\PostgreSQL' -Recurse -Filter psql.exe` | Passed | Found local `psql.exe` clients under PostgreSQL 16. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a -c 'SELECT 1 AS probe;' -o text -- --csv -q` | Failed | Slice 5R confirmed the default process `PATH` does not include `psql`: `exec: "psql": executable file not found in %PATH%`. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql sandbox-hotel-pms-db-v43m -c "select 1 as probe;" -o text` | Inconclusive | Exit code 0, but stdout was empty. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a -c "select 1 as probe;" -o text` | Inconclusive | Exit code 0, but stdout was empty when using the datastore id. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql sandbox-hotel-pms-db-v43m -c "select 1 as probe;" -o json` | Inconclusive | Returned `{ "output": "" }`. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a -c "SELECT 1 AS probe;" -o json` | Inconclusive | Slice 5R returned `{ "output": "" }`. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a -c "<aggregate room-count query>" -o json` | Inconclusive | Slice 5R returned `{ "output": "" }`; no inventory counts were returned. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql sandbox-hotel-pms-db-v43m -c "select * from __codex_nonexistent_probe__;" -o json` | Inconclusive | Returned `{ "output": "" }` even for a deliberately invalid table, so this CLI query path cannot be trusted as production database evidence. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a -c "SELECT * FROM __codex_nonexistent_probe__;" -o json` | Inconclusive | Slice 5R again returned `{ "output": "" }` even for a deliberately invalid table, so the path still cannot be trusted. |
| `psql --version` after prepending PostgreSQL 16 to `PATH` | Passed | Slice 5T confirmed local client `psql (PostgreSQL) 16.13`. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a -c "SELECT 1 AS probe" -o text` | Inconclusive | Slice 5T exit code 0, no stdout. |
| `render -o text psql dpg-d6ns2d94tr6s73c9hve0-a -c "SELECT 1 AS probe"` | Inconclusive | Slice 5T exit code 0, no stdout. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a -c "SELECT 1 AS probe" -o text -- --no-align --tuples-only` | Inconclusive | Slice 5T exit code 0, no stdout. |
| `render psql sandbox-hotel-pms-db-v43m -c "SELECT 1 AS probe" -o text -- --no-align --tuples-only` | Inconclusive | Slice 5T exit code 0, no stdout. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a -c "SELECT * FROM __codex_nonexistent_probe__" -o text` | Inconclusive | Slice 5T exit code 0, no stdout even for an invalid table. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a -o text -- -c "SELECT 1 AS probe" -A -t` | Failed as unsupported command shape | Slice 5T CLI returned `--command flag is required in non-interactive mode`. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a --command "SELECT 1 AS probe" --output yaml` | Inconclusive | Slice 5T exit code 0, output field was empty. |
| Shell `RENDER_API_KEY`, `DATABASE_URL`, and `E2E_DATABASE_URL` presence checks | Passed | Slice 5T found each variable absent; no secret values were printed. |
| `codex mcp list` | Failed | Slice 5T local `codex.exe` returned access denied, so this session cannot self-confirm or add Render MCP through the local CLI. |
| `render services get dpg-d6ns2d94tr6s73c9hve0-a -o json` | Passed | Confirmed Render PostgreSQL `sandbox-hotel-pms-db-v43m` is available, primary, PostgreSQL 17, region `oregon`, plan `basic_256mb`, database name `sandbox_hotel_pms`, and not suspended. This proves database resource status only, not room inventory rows. |
| `GET https://book.sandboxhotel.com/api/rooms` without credentials | Passed as security probe | Returned `401 Authentication is required`; the room list is protected and cannot be used as unauthenticated inventory evidence. |
| `GET https://book.sandboxhotel.com/api/today` without credentials | Passed as security probe | Returned `401 Authentication is required`; live aggregate room counts are protected and cannot be used as unauthenticated inventory evidence. |

## Query Boundary

The attempted production database proof was limited to read-only aggregate room data:

- property code
- room type count
- total room count
- available room count
- non-available room count
- occupied room count

The attempted proof intentionally excluded guest, reservation, payment, user, room-number, notes, cookie, token, password, and raw connection-string fields.

## Evidence Decision

No current command output proves real production room inventory. The Render datastore exists and is healthy, and the live application correctly protects room endpoints without credentials, but neither fact proves room rows or approved room counts. Slices 5R and 5T confirm the current Render CLI query path is not reliable because supported command forms return empty output for known-good probes and deliberately invalid table queries.

This P0 remains blocked until one of these approved evidence paths is available:

- Render MCP `query_render_postgres`, Render API query tooling, or another reliable non-interactive query path that returns redacted aggregate room counts and expected errors.
- Render dashboard connection details used locally without printing the raw URL, with output limited to aggregate counts.
- A redacted Render/dashboard/export proof of room types, room counts, and status distribution.
- A credentialed PMS admin room-setup proof captured without secrets, cookies, guest data, or raw room numbers if room numbers need redaction.
- A reviewed production room import/onboarding artifact with owner approval and post-import aggregate counts.

## Remaining P0 Blockers

- Real production room inventory proof remains open.
- Live setup-completion hardening still needs review/approval, deployment of the exact reviewed commit, and public unauthenticated setup-complete reprobe.
- Production users/auth/RBAC/logout proof remains open.
- Core hotel workflow proof remains open.
- Live provider secret inventory/rotation metadata and recovery ownership proof remain external/account-owner evidence gaps.
- Rollback owner/deputy, database recovery owner, and WAF/rate-limit rule evidence remain unproven.

## Next Recommended Slice

Use a reliable approved evidence path for production room inventory, preferably Render MCP/API query tooling, Render dashboard connection details used without printing the raw URL, a redacted dashboard/export, or a credentialed PMS admin room-setup view. Do not rely on the current Render CLI `psql` path until it returns trustworthy output and expected errors. If PR #150 is approved first, deploy the exact reviewed commit and then reprobe the live setup-complete gate.
