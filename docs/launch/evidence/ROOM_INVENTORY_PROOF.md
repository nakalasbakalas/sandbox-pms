# Room Inventory Proof

Date: 2026-07-02T07:20Z.
Latest update: 2026-07-03T11:25+07:00.

Verdict: blocked. Real production room inventory is still not proved for launch sign-off.

This file is the canonical Slice 3 evidence record for production room inventory. It records only non-secret command output and read-only probes. It does not contain room numbers, guest data, user data, database URLs, tokens, passwords, cookies, or raw secret values.

## Required Proof To Close

Production room inventory can be marked complete only when all of these are recorded:

- Real room source approved by the property or operations owner.
- Import/onboarding result count matches the expected real room set.
- Room-type counts and room status distribution are visible, with room numbers redacted if needed.
- Evidence shows the inventory was configured through approved onboarding/import, not fake seed data.
- Setup-required or incomplete inventory cannot be mistaken for production-ready inventory.

## 2026-07-03 Slice 5AX Refresh

Slice 5AX adds `2026-07-03-slice-5ax-room-inventory-query-path-refresh.md` and reconfirms the current read-only evidence boundary:

- The current checkout still has no `ops/rooms.production.json` import artifact.
- Filename search found no production room import JSON.
- Render Postgres `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) is `available`, `primary`, PostgreSQL `17`, region `oregon`, plan `basic_256mb`, database `sandbox_hotel_pms`, 15 GB disk, and `not_suspended`. This proves resource status only, not room rows.
- Local PostgreSQL client `psql (PostgreSQL) 16.13` is available when explicitly referenced, but the Render CLI `psql` path remains untrustworthy: known-good `SELECT 1`, deliberately invalid table SQL, aggregate room count, and room status distribution queries all returned exit code 0 with `{ "output": "" }`.
- Unauthenticated live `GET /api/rooms`, `GET /api/today`, and `GET /api/settings/room-setup` each returned `401 Authentication is required`, so protected public endpoints cannot be used as unauthenticated inventory proof.
- Tool discovery exposed no callable Render database query/list MCP tool in this session.

Evidence decision: no current command output proves real production room inventory. A reliable approved query/export/admin proof path is still required.

## Commands

| Command | Result | Notes |
| --- | --- | --- |
| `render psql --help` | Passed | Slice 5AP confirmed documented non-interactive syntax is `render psql [postgresID\|postgresName] -c "SELECT ..." -o text/json`, with optional raw `psql` args after `--`. |
| `render pgcli --help` | Passed | Slice 5AP confirmed `pgcli` exposes session support but no non-interactive command flag. |
| `render postgres --help` | Failed as unsupported command | Slice 5AP confirmed Render CLI v2.13.0 has no `render postgres` command. |
| Codex tool discovery for Render MCP database/query tools | No callable Render query tool | Slice 5AP did not expose Render MCP database query/list tools in this session. |
| `Test-Path .\ops\rooms.production.json` | Failed/no file | Slice 5AP found no local production-room import artifact at this path. This does not prove production inventory is absent; it only means this checkout cannot use that artifact as import proof. |
| `render services -o json` filtered to `sandbox-hotel-pms-db-v43m` | Passed | Slice 5AP confirmed `sandbox-hotel-pms-db-v43m` is available, primary, PostgreSQL 17, region `oregon`, plan `basic_256mb`, database `sandbox_hotel_pms`, and not suspended. This proves database resource status only, not room rows. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a -c "SELECT 1 AS probe;" -o text` | Inconclusive | Slice 5AP exit code 0, empty output. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql sandbox-hotel-pms-db-v43m -c "SELECT 1 AS probe;" -o text` | Inconclusive | Slice 5AP exit code 0, empty output. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a -c "SELECT * FROM __codex_nonexistent_probe__;" -o text` | Inconclusive | Slice 5AP exit code 0, empty output even for a deliberately invalid table. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a -c "COPY (SELECT 1 AS probe) TO STDOUT WITH CSV HEADER;" -o text` | Inconclusive | Slice 5AP exit code 0, empty output. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a -c "SELECT 1 AS probe;" -o json -- --csv -q` | Inconclusive | Slice 5AP returned `{ "output": "" }`. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a -- --command "SELECT 1 AS probe;" --csv -q` | Failed as unsupported non-interactive shape | Slice 5AP CLI returned `--command flag is required in non-interactive mode`. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a -c '<aggregate total room and room-type count query>' -o json` | Inconclusive | Slice 5AP returned `{ "output": "" }` with exit code 0; no total room or room-type count was returned. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a -c '<aggregate room status distribution query>' -o json` | Inconclusive | Slice 5AP returned `{ "output": "" }` with exit code 0; no room status distribution was returned. |
| `GET https://book.sandboxhotel.com/api/rooms` without credentials | Passed as security probe | Slice 5AP returned `401 Authentication is required`; the room list is protected and cannot be used as unauthenticated inventory evidence. |
| `GET https://book.sandboxhotel.com/api/today` without credentials | Passed as security probe | Slice 5AP returned `401 Authentication is required`; live aggregate room data is protected and cannot be used as unauthenticated inventory evidence. |
| Codex tool discovery for `query_render_postgres` / Render database MCP tools | No callable Render database query tool | Slice 5AL tool discovery exposed no Render MCP database query/list tools in this session. |
| Shell `RENDER_API_KEY`, `DATABASE_URL`, and `E2E_DATABASE_URL` presence checks | Passed | Slice 5AL found each variable absent; no secret values were printed. |
| `Get-Command psql` | Passed | Slice 5AL confirmed `psql` is not on the default process `PATH`. |
| `Get-ChildItem -LiteralPath 'C:\Program Files\PostgreSQL' -Recurse -Filter psql.exe` | Passed | Slice 5AL found local PostgreSQL 16 clients. |
| `& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' --version` | Passed | Slice 5AL confirmed local client `psql (PostgreSQL) 16.13`. |
| `render services -o json` filtered to Sandbox PMS resources | Passed | Slice 5AL confirmed `sandbox-hotel-pms-db-v43m` is available, primary, PostgreSQL 17, region `oregon`, plan `basic_256mb`, database `sandbox_hotel_pms`, and not suspended. This proves database resource status only, not room inventory rows. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a --command 'SELECT 1 AS probe;' --output json` | Inconclusive | Slice 5AL exit code 0, output field empty. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a --command 'SELECT * FROM __codex_nonexistent_probe__;' --output json` | Inconclusive | Slice 5AL exit code 0, output field empty even for a deliberately invalid table. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a --command '<aggregate room-count query>' --output json` | Inconclusive | Slice 5AL exit code 0, output field empty; no room inventory counts were returned. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql sandbox-hotel-pms-db-v43m --command 'SELECT 1 AS probe;' --output text` | Inconclusive | Slice 5AL exit code 0, empty stdout. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a --command 'SELECT 1 AS probe;' --output json -- --csv -q` | Inconclusive | Slice 5AL exit code 0, output field empty. |
| `render pgcli dpg-d6ns2d94tr6s73c9hve0-a -- -c 'SELECT 1 AS probe;'` | Failed as non-interactive path | Slice 5AL CLI returned `render pgcli` can only be used in interactive mode. |
| `GET https://book.sandboxhotel.com/api/rooms` without credentials | Passed as security probe | Slice 5AL returned `401 Authentication is required`; the room list is protected and cannot be used as unauthenticated inventory evidence. |
| `GET https://book.sandboxhotel.com/api/today` without credentials | Passed as security probe | Slice 5AL returned `401 Authentication is required`; live aggregate room counts are protected and cannot be used as unauthenticated inventory evidence. |
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
| `render psql --help` | Passed | Slice 5AF reconfirmed the CLI documents non-interactive `--command` support and pass-through psql args. |
| `render pgcli --help` | Passed | Slice 5AF confirmed this command exposes interactive session support but no non-interactive command flag. |
| Shell `RENDER_API_KEY`, `DATABASE_URL`, and `E2E_DATABASE_URL` presence checks | Passed | Slice 5AF again found each variable absent; no secret values were printed. |
| Codex Render MCP tool discovery | No callable Render query tool | Slice 5AF tool discovery after the Render request did not expose Render MCP database query tools in this session. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a --command "SELECT 1 AS probe;" --output text` | Inconclusive | Slice 5AF exit code 0, output length 0. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a --command "SELECT 1 AS probe;" --output json` | Inconclusive | Slice 5AF exit code 0, JSON output field was empty. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a --command "SELECT 1 AS probe;" --output json -- --csv -q` | Inconclusive | Slice 5AF exit code 0, JSON output field was empty. |
| `render psql sandbox-hotel-pms-db-v43m --command "SELECT 1 AS probe;" --output text` | Inconclusive | Slice 5AF exit code 0, output length 0. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a --command "SELECT * FROM __codex_nonexistent_probe__;" --output text` | Inconclusive | Slice 5AF exit code 0, output length 0 even for a deliberately invalid table. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a --command "SELECT * FROM __codex_nonexistent_probe__;" --output json` | Inconclusive | Slice 5AF exit code 0, JSON output field was empty even for a deliberately invalid table. |
| `render pgcli dpg-d6ns2d94tr6s73c9hve0-a -- -c "SELECT 1 AS probe;"` | Failed as non-interactive path | Slice 5AF exit code 1; Render CLI reported `render pgcli` can only be used in interactive mode. |
| `render pgcli sandbox-hotel-pms-db-v43m -- -c "SELECT 1 AS probe;"` | Failed as non-interactive path | Slice 5AF exit code 1; Render CLI reported `render pgcli` can only be used in interactive mode. |

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

No current command output proves real production room inventory. The Render datastore exists and is healthy, and the live application correctly protects room endpoints without credentials, but neither fact proves room rows or approved room counts. Slices 5R, 5T, 5AF, 5AL, and 5AP confirm the current Render CLI query path is not reliable because supported command forms return empty output for known-good probes, deliberately invalid table queries, CSV/`COPY` probes, and aggregate room-count queries. Slice 5AP also confirmed the current checkout has no local `ops/rooms.production.json` import artifact and no Render MCP database query tool is callable in this session.

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

Use a reliable approved evidence path for production room inventory, preferably Render MCP/API query tooling, Render dashboard connection details used without printing the raw URL, a redacted dashboard/export, or a credentialed PMS admin room-setup view. Do not rely on the current Render CLI `psql` path until it returns trustworthy output and expected errors, and do not use interactive production database shells as launch evidence in this slice. If PR #150 is approved first, deploy the exact reviewed commit and then reprobe the live setup-complete gate.
