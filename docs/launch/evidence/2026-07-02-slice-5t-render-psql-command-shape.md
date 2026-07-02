# Slice 5T - Render PSQL Command-Shape Reprobe

Date: 2026-07-02T15:06+07:00.

Verdict: completed, but real production room inventory proof remains blocked. This slice confirmed the production datastore is discoverable, local `psql` exists, and the Render CLI documents non-interactive SQL support, but every supported `render psql --command` variant still returns no stdout for both valid and invalid read-only probes.

No production deploy, restart, SSH session, production database mutation, DB-mutating E2E, secret-value access, raw database URL access, credentialed PMS login, guest data access, room-number access, or payment data access was performed.

## Scope

- Target datastore: `sandbox-hotel-pms-db-v43m`
- Target datastore id: `dpg-d6ns2d94tr6s73c9hve0-a`
- Query intent: prove whether the current Render CLI path can return trustworthy read-only output before attempting aggregate room counts.
- Sensitive data boundary: do not print connection strings, passwords, tokens, cookies, guest records, room numbers, user records, payment data, reservation details, or notes.

## Commands And Results

| Command | Result | Evidence boundary |
| --- | --- | --- |
| `psql --version` after prepending `C:\Program Files\PostgreSQL\16\bin` to `PATH` | Passed | Local client is `psql (PostgreSQL) 16.13`. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a -c "SELECT 1 AS probe" -o text` | Inconclusive | Exit code 0, no stdout. |
| `render -o text psql dpg-d6ns2d94tr6s73c9hve0-a -c "SELECT 1 AS probe"` | Inconclusive | Exit code 0, no stdout. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a -c "SELECT 1 AS probe" -o text -- --no-align --tuples-only` | Inconclusive | Exit code 0, no stdout. |
| `render psql sandbox-hotel-pms-db-v43m -c "SELECT 1 AS probe" -o text -- --no-align --tuples-only` | Inconclusive | Exit code 0, no stdout. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a -c "SELECT * FROM __codex_nonexistent_probe__" -o text` | Inconclusive | Exit code 0, no stdout even for an invalid table. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a -o text -- -c "SELECT 1 AS probe" -A -t` | Failed as unsupported command shape | CLI returned `--command flag is required in non-interactive mode`. |
| `render psql sandbox-hotel-pms-db-v43m -o text -- -c "SELECT 1 AS probe" -A -t` | Failed as unsupported command shape | CLI returned `--command flag is required in non-interactive mode`. |
| `render psql dpg-d6ns2d94tr6s73c9hve0-a --command "SELECT 1 AS probe" --output yaml` | Inconclusive | Exit code 0, output field was empty. |
| `Test-Path Env:RENDER_API_KEY` | Passed | `RENDER_API_KEY` is absent; no Render MCP/API bearer-token path is available from the shell. |
| Shell env check for `DATABASE_URL` and `E2E_DATABASE_URL` | Passed | Both are absent from the shell; no direct database URL was available for a safe read-only aggregate query. |
| `codex mcp list` | Failed | `codex.exe` returned access denied, so this session cannot self-confirm or add a Render MCP server from the CLI. |

## Reference Boundary

Official Render documentation confirms that PostgreSQL internal and external connection URLs are available from the database page in the Render Dashboard, and that external connections require normal database connection details. This slice did not retrieve or print those URLs. See: `https://render.com/docs/postgresql-creating-connecting`.

## Decision

The current CLI path is not reliable launch evidence because:

- a known-good `SELECT 1` probe produces no stdout,
- a deliberately invalid table query also produces no stdout and exit code 0,
- passing SQL directly through to `psql` is rejected by the CLI in non-interactive mode,
- there is no shell `RENDER_API_KEY` for Render MCP/API query tooling,
- there is no shell `DATABASE_URL` for a direct read-only aggregate query,
- and this Codex session cannot list/add MCP servers through the local `codex` executable.

Real production room inventory remains open until an approved evidence path is available.

## Next Required Evidence

Use one of these approved paths:

- Render MCP/API query tooling that returns aggregate counts and expected errors.
- Render dashboard connection details used locally without printing the raw URL, with output limited to aggregate counts.
- Redacted PMS admin room-setup proof.
- Redacted owner/export/import evidence showing real production room types, total room count, status distribution, source owner, and no fake seed inventory.
