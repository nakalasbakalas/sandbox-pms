# Slice 5AF Launch Evidence - Room Inventory Query Path Reprobe - 2026-07-03

Scope: re-test whether the current Render CLI session can produce trustworthy read-only production database output for room-inventory proof.

Verdict: completed, but real production room inventory proof remains blocked. The current Render CLI `psql` path still returns empty output for both valid `SELECT 1` probes and a deliberately invalid table query. The alternate `render pgcli` path is interactive-only and cannot be used as non-interactive launch evidence here.

This slice did not deploy, restart, SSH, open an interactive production database shell, mutate production data, run DB-mutating E2E, perform credentialed PMS login, access guest/payment/user data, or access secret values.

## Scope And Boundary

- Target datastore: `sandbox-hotel-pms-db-v43m`.
- Target datastore id: `dpg-d6ns2d94tr6s73c9hve0-a`.
- Query intent: prove whether the CLI path can return trustworthy read-only output before attempting aggregate room counts.
- No room-number, guest, reservation, payment, user, note, raw database URL, token, password, cookie, or private-key fields were requested or printed.

## Command Results

| Command | Result | Evidence summary |
| --- | --- | --- |
| `render psql --help` | Passed | CLI still documents non-interactive `render psql [postgresID|postgresName] -c "SELECT ..."` support and pass-through psql args after `--`. |
| `render pgcli --help` | Passed | CLI documents `pgcli` session support but no non-interactive command flag. |
| `Get-ChildItem -LiteralPath 'C:\Program Files\PostgreSQL' -Recurse -Filter psql.exe` | Passed | Found local PostgreSQL 16 `psql.exe`. |
| `psql --version` after prepending PostgreSQL 16 to `PATH` | Passed | Local client is `psql (PostgreSQL) 16.13`. |
| Shell env check for `RENDER_API_KEY`, `DATABASE_URL`, and `E2E_DATABASE_URL` | Passed | All three variables are absent from the shell; no direct API or database URL path is available. |
| Codex Render MCP tool discovery | No callable Render query tool | Tool discovery after the Render request did not expose Render MCP database query tools in this session. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a --command "SELECT 1 AS probe;" --output text` | Inconclusive | Exit code 0, output length 0. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a --command "SELECT 1 AS probe;" --output json` | Inconclusive | Exit code 0, JSON output field was empty. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a --command "SELECT 1 AS probe;" --output json -- --csv -q` | Inconclusive | Exit code 0, JSON output field was empty. |
| `render psql sandbox-hotel-pms-db-v43m --command "SELECT 1 AS probe;" --output text` | Inconclusive | Exit code 0, output length 0. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a --command "SELECT * FROM __codex_nonexistent_probe__;" --output text` | Inconclusive | Exit code 0, output length 0 even for a deliberately invalid table. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a --command "SELECT * FROM __codex_nonexistent_probe__;" --output json` | Inconclusive | Exit code 0, JSON output field was empty even for a deliberately invalid table. |
| `render pgcli dpg-d6ns2d94tr6s73c9hve0-a -- -c "SELECT 1 AS probe;"` | Failed as non-interactive path | Exit code 1; Render CLI reported `render pgcli` can only be used in interactive mode. |
| `render pgcli sandbox-hotel-pms-db-v43m -- -c "SELECT 1 AS probe;"` | Failed as non-interactive path | Exit code 1; Render CLI reported `render pgcli` can only be used in interactive mode. |

## Evidence Decision

No production room inventory counts were recorded. A query path that returns empty output for both a known-good `SELECT 1` and a deliberately invalid table query cannot be used as launch proof. Running an interactive production database shell is outside this slice's safe boundary.

## Still Required To Close

- Render MCP/API query tooling that returns aggregate counts and expected errors, or
- Render dashboard connection details used locally without printing the raw URL, with output limited to aggregate counts, or
- Redacted PMS admin room-setup proof, or
- Redacted owner/export/import evidence showing real production room types, total room count, status distribution, source owner, and no fake seed inventory.
