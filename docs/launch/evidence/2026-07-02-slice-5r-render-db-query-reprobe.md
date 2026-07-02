# Slice 5R - Render DB Query Path Reprobe

Date: 2026-07-02T14:57+07:00.

Verdict: completed, but production room inventory proof remains blocked. The Render CLI exposes the production PostgreSQL datastore and documents a non-interactive `render psql -c` path, but the path still returns empty output even for `SELECT 1` and a deliberately invalid table query.

This is read-only tooling proof. It does not contain production database URLs, tokens, passwords, cookies, guest data, room numbers, or secret values.

## Target

- Render workspace: active CLI workspace verified.
- Production datastore: `sandbox-hotel-pms-db-v43m`
- Datastore id: `dpg-d6ns2d94tr6s73c9hve0-a`
- Database metadata visible from Render CLI: PostgreSQL 17, primary, `available`, region `oregon`, plan `basic_256mb`.

## Commands And Results

| Command | Result | Evidence boundary |
| --- | --- | --- |
| Codex tool discovery for Render MCP database/query tools | No Render MCP query/list tools exposed in this session | A Render MCP `query_render_postgres` path is not currently callable from Codex. |
| `render --version` | Passed | Render CLI v2.13.0 is installed; CLI reports v2.21.0 is available. |
| `render whoami -o json` | Passed | Active Render authentication is present. Email was not copied into this evidence file. |
| `render workspace current -o json` | Passed | Active workspace is visible without exposing secrets. |
| `render --help` | Passed | CLI supports `services`, `psql`, `pgcli`, `logs`, `projects`, and `environments`; no MCP query tool is exposed by this command. |
| `render services -o json` | Passed | Production datastore and PMS services are visible. This proves provider metadata only, not room rows. |
| `render psql --help` | Passed | CLI documents `render psql [postgresID|postgresName] -c "SELECT ..."` for non-interactive use. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a -c 'SELECT 1 AS probe;' -o text -- --csv -q` | Failed | `psql` was not on `PATH`: `exec: "psql": executable file not found in %PATH%`. |
| `Test-Path 'C:\Program Files\PostgreSQL\16\bin\psql.exe'` | Passed | A local PostgreSQL 16 client exists, but it is not on the default process `PATH`. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a -c 'SELECT 1 AS probe;' -o json` | Inconclusive | Exit code 0, output was `{ "output": "" }`. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a -c '<aggregate room-count query>' -o json` | Inconclusive | Exit code 0, output was `{ "output": "" }`; no inventory counts were returned. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a -c 'SELECT * FROM __codex_nonexistent_probe__;' -o json` | Inconclusive | Exit code 0, output was `{ "output": "" }` even for an invalid table, so the path cannot be trusted as database proof. |

## Attempted Read-Only Query Scope

The aggregate query intentionally avoided guest, reservation detail, payment, user, credential, room-number, and note fields. It targeted only:

- table row counts for `Property`, `RoomType`, and `Room`;
- room-type aggregate counts;
- room operational/current status aggregate counts.

Because the CLI returned empty output, none of those counts are recorded as proof.

## Decision

Do not use this Render CLI `psql` path as launch evidence until it returns trustworthy output for both a known-good probe and an expected error path. A reliable proof path still needs one of:

- Render MCP `query_render_postgres` or equivalent provider query tooling;
- a working non-interactive `psql` path that returns visible output and errors;
- a redacted Render/dashboard/export artifact with aggregate room counts;
- credentialed PMS admin room-setup evidence with secrets, cookies, guest data, and room numbers redacted where needed;
- owner-approved import/onboarding evidence showing production inventory is not fake seed/demo data.

## P0 Impact

Real production room inventory remains open. This slice narrows the blocker to tooling/access reliability rather than database resource discovery: the datastore is visible and available, but current query tooling still does not produce usable aggregate inventory output.
