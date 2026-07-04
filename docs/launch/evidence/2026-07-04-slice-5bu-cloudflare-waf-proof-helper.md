# Slice 5BU - Cloudflare WAF Proof Helper

Status date: 2026-07-04.

Verdict: partial P0 progress. This slice adds a read-only owner-run Cloudflare WAF/rate-limit proof helper and refreshes public-edge evidence. It does not close the WAF/rate-limit blocker because this environment still has no Cloudflare API token or zone ID.

## Scope

- Public target: `https://book.sandboxhotel.com`.
- Current live Render deploy remains `dep-d94daaflk1mc73b1m6m0`, serving commit `e348fd6d076b2bf094dca1c77c372a2bbed612c4`.
- Added `npm.cmd run cloudflare:waf:proof`, backed by `scripts/prove-cloudflare-waf-rules.mjs`.
- No Cloudflare rule create/update/delete, no load test, no Render mutation, no production database access, no secret value access, and no DB-mutating E2E was performed.
- No Cloudflare API token, rule expressions, action parameters, cookies, passwords, raw response bodies, or raw database URLs are recorded here.

## Evidence

| Check | Result | Notes |
| --- | --- | --- |
| Cloudflare MCP tool discovery | Not available | Tool discovery still did not expose callable Cloudflare zone/WAF/rate-limit inspection tools in this session. |
| Local Cloudflare CLI path | Not available | `wrangler` and `cloudflared` were not found on PATH. |
| Local env key presence | Missing | `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CF_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, and `CF_ZONE_ID` were absent. Values were not printed. |
| WAF helper smoke | Passed | `npm.cmd run cloudflare:waf:proof -- --help` printed the owner-run usage path without requiring or printing secrets. |
| WAF helper missing-input guard | Passed as blocked | `npm.cmd run cloudflare:waf:proof` emitted redacted JSON with `ready=false`, `zoneIdPresent=false`, `accountIdPresent=false`, and missing `CLOUDFLARE_API_TOKEN or CF_API_TOKEN` plus `CLOUDFLARE_ZONE_ID or CF_ZONE_ID`. |
| Business tests | Passed | `npm.cmd test` passed. Coverage includes redacted WAF/rate-limit ruleset summarization, expression omission by default, rate-limit threshold summaries, and action-parameter omission. |
| Public edge proof | Green | First retry aborted, then `npm.cmd run public-edge:proof` passed at `2026-07-04T10:22:28.812Z`: `/healthz?deep=1` returned `200`, production environment, database configured/OK, `server=cloudflare`, `CF-RAY` present, `CF-Cache-Status=DYNAMIC`, `X-Render-Origin-Server=Render`, common security headers present, and selected unwanted paths returned `404` with bodies omitted. |

## Owner-Run Command

The owner can collect redacted WAF/rate-limit rule proof from a secure shell with a Cloudflare token that has read access to the relevant zone rulesets:

```powershell
$env:CLOUDFLARE_API_TOKEN = '<redacted owner token>'
$env:CLOUDFLARE_ZONE_ID = '<redacted zone id>'
npm.cmd run cloudflare:waf:proof -- --hostname book.sandboxhotel.com --probe-url https://book.sandboxhotel.com/.env
```

If account-level WAF/rate-limit rulesets are used, also set `CLOUDFLARE_ACCOUNT_ID` or pass `--account-id`.

The helper uses the Cloudflare Rulesets API read path for zone/account rulesets and summarizes WAF phases:

- `http_request_firewall_custom`
- `http_ratelimit`
- `http_request_firewall_managed`

By default, rule expressions and action parameters are omitted. Use `--include-expressions` only if the owner approves storing expressions in redacted evidence.

## Boundary

This slice makes the WAF proof easier to collect but does not prove:

- Cloudflare zone ownership or access.
- Any actual WAF/rate-limit rule ID, threshold, action, or protected-hostname rule.
- Owner-approved non-destructive WAF/rate-limit behavior test.
- Launch sign-off.
