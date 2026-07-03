# Slice 5C - Render Room Inventory Proof Attempt

Date: 2026-07-02.

Scope: attempt to gather read-only production room-inventory evidence from the Render PostgreSQL service without printing secrets, connection strings, guest/user/payment data, room numbers, or personal data. This slice did not mutate production data and did not open an interactive database shell.

## Commands

| Command | Result | Notes |
| --- | --- | --- |
| `render psql --help` | Passed | Confirmed the Render CLI supports non-interactive `render psql <postgres> -c "..."` usage. |
| `render pgcli --help` | Passed | Confirmed `pgcli` is interactive-only in this CLI surface. |
| `render psql sandbox-hotel-pms-db-v43m -c "<room inventory aggregate>" -o text -- --csv -q` | Failed | Initially failed because `psql` was not in `%PATH%`: `exec: "psql": executable file not found in %PATH%`. |
| `Get-ChildItem ... -Filter psql.exe` | Passed | Found local clients at `C:\Program Files\PostgreSQL\16\bin\psql.exe` and `C:\Program Files\PostgreSQL\16\pgAdmin 4\runtime\psql.exe`. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql sandbox-hotel-pms-db-v43m -c "<room inventory aggregate>" -o text -- --csv -q` | Inconclusive | Exit code was 0, but stdout was empty, so no room inventory counts were available to record. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql sandbox-hotel-pms-db-v43m -c "select count(*) as property_count from \"Property\";" -o text -- --csv` | Inconclusive | Exit code was 0, but stdout was empty. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql sandbox-hotel-pms-db-v43m -c "select 1 as probe;" -o json -- --csv` | Inconclusive | Exit code was 0 and returned JSON with `"output": ""`, so even a basic probe did not produce query evidence. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql sandbox-hotel-pms-db-v43m -c "select * from __codex_nonexistent_probe__;" -o text` | Inconclusive | Exit code was 0 and stdout was empty even for a deliberately invalid read query, so this CLI path cannot be trusted as database-query evidence in this environment. |

## Query Boundary

The intended inventory query was limited to aggregate counts from `Property`, `RoomType`, and `Room`:

- property code
- room type count
- total room count
- count of `AVAILABLE` rooms
- count of non-available rooms
- count of rooms whose current status is occupied

It intentionally excluded guest, reservation, payment, user, room-number, notes, cookie, token, and raw connection-string fields.

## Evidence Decision

This slice does not prove real production room inventory. The Render CLI database-query path is currently not reliable evidence because it suppresses output for successful, simple, aggregate, and deliberately invalid queries alike.

## Remaining P0 Blockers

- Real production room inventory proof remains open.
- Live setup-completion hardening still needs approved deploy/reprobe evidence.
- Production users/auth/RBAC/logout proof remains open.
- Core hotel workflow proof remains open.
- Live provider secret inventory/rotation metadata and recovery ownership proof remain external/account-owner evidence gaps.
- Rollback owner/deputy, database recovery owner, and WAF/rate-limit rule evidence remain unproven.

## Next Recommended Slice

Use a reliable approved evidence path for production room inventory: Render MCP `query_render_postgres`, a trusted dashboard/export with values redacted, a non-interactive `psql` path that returns stdout, or a credentialed PMS admin room-setup view with screenshots/logs redacted. If deployment is approved first, publish the current checkout through branch/PR/deploy and rerun setup-complete unauthenticated probes.
