# Slice 5AL - Room Inventory Query Path Reprobe

Date: 2026-07-03T08:57+07:00

Verdict: real production room inventory remains blocked. This slice refreshed the available read-only evidence paths and did not produce trustworthy production room counts.

Scope boundary:

- No deploy, restart, SSH session, interactive production database shell, production database mutation, DB-mutating E2E, credentialed production login, screenshots, or secret-value access was performed.
- SQL attempts were read-only aggregate probes only and intentionally excluded guest, reservation, payment, user, room-number, note, token, cookie, password, and raw connection-string fields.
- No raw database URLs, tokens, passwords, cookies, or production secrets were printed or recorded.

## Commands

| Command | Result | Evidence |
| --- | --- | --- |
| Codex tool discovery for `query_render_postgres` / Render database MCP tools | No callable Render database query tool | Tool discovery exposed no Render MCP database query/list tools in this session. |
| `render psql --help` | Passed | CLI documents non-interactive `render psql [postgresID|postgresName] -c "SELECT ..."` and pass-through psql args. |
| Shell env presence check for `RENDER_API_KEY`, `DATABASE_URL`, and `E2E_DATABASE_URL` | Passed | All three were absent in the shell; no values were printed. |
| `Get-Command psql` | Passed | `psql` is not on the default `PATH`. |
| `Get-ChildItem 'C:\Program Files\PostgreSQL' -Recurse -Filter psql.exe` | Passed | Found local PostgreSQL 16 clients. |
| `& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' --version` | Passed | Local client is `psql (PostgreSQL) 16.13`. |
| `render services -o json` filtered to Sandbox PMS resources | Passed | `sandbox-hotel-pms-db-v43m` is available, primary, PostgreSQL 17, region `oregon`, plan `basic_256mb`, database `sandbox_hotel_pms`, not suspended. `sandbox-hotel-pms-v43m` is not suspended and points at `main` with auto deploy off. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a --command 'SELECT 1 AS probe;' --output json` | Inconclusive | Exit code 0 with `{ "output": "" }`. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a --command 'SELECT * FROM __codex_nonexistent_probe__;' --output json` | Inconclusive | Exit code 0 with `{ "output": "" }` even for a deliberately invalid table. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a --command '<aggregate room-count query>' --output json` | Inconclusive | Exit code 0 with `{ "output": "" }`; no inventory counts were returned. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql sandbox-hotel-pms-db-v43m --command 'SELECT 1 AS probe;' --output text` | Inconclusive | Exit code 0 with empty stdout. |
| `$env:PATH = 'C:\Program Files\PostgreSQL\16\bin;' + $env:PATH; render psql dpg-d6ns2d94tr6s73c9hve0-a --command 'SELECT 1 AS probe;' --output json -- --csv -q` | Inconclusive | Exit code 0 with `{ "output": "" }`. |
| `render pgcli --help` | Passed | CLI exposes interactive `pgcli` only; no non-interactive command flag. |
| `render pgcli dpg-d6ns2d94tr6s73c9hve0-a -- -c 'SELECT 1 AS probe;'` | Failed as non-interactive path | CLI returned `render pgcli can only be used in interactive mode`. |
| Unauthenticated `GET https://book.sandboxhotel.com/api/rooms` | Passed as security probe | Returned `401 Authentication is required`; not usable as inventory proof. |
| Unauthenticated `GET https://book.sandboxhotel.com/api/today` | Passed as security probe | Returned `401 Authentication is required`; not usable as inventory proof. |

## Attempted Aggregate Query Boundary

The attempted production database aggregate query requested only:

- room type count
- total room count
- available room count
- non-available room count
- occupied room count

No room numbers, guest records, reservation records, payment records, user records, notes, cookies, tokens, passwords, or raw connection strings were queried or recorded.

## Evidence Decision

The Render PostgreSQL resource is healthy and the public app correctly protects room endpoints, but neither proves real production room inventory. The current Render CLI non-interactive query path cannot be trusted as evidence because known-good `SELECT 1`, the aggregate inventory query, and a deliberately invalid table query all returned empty output with exit code 0.

Production room inventory remains a P0 blocker until a reliable approved evidence path returns aggregate room counts and expected query errors, or an account owner provides a redacted dashboard/export or credentialed PMS admin proof.

## Remaining P0 Blockers After This Slice

- Real production room inventory proof remains open.
- PR #150 setup-gate hardening needs review approval, deployment to `sandbox-hotel-pms-v43m`, and public reprobe.
- Production users/auth/RBAC/logout/unauthorized-access proof remains open for approved users and credentialed role testing.
- Core hotel workflow acceptance remains open for staging, controlled production-like, or account-owner manual proof.
- Live secret key inventory/rotation metadata, rollback/deputy/database recovery owners, and WAF/rate-limit rule IDs remain open.
