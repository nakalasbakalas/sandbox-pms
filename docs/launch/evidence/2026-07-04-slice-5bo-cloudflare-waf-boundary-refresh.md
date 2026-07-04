# Slice 5BO - Cloudflare WAF Boundary Refresh

Status date: 2026-07-04.

Verdict: partial P0 progress. The public Cloudflare-fronted runtime proof is freshly green, and the available Cloudflare inspection paths were checked without exposing secrets. This does not close the WAF/rate-limit P0 because privileged Cloudflare zone/rule metadata is still not available in this environment.

## Scope

- Public target: `https://book.sandboxhotel.com`.
- Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`).
- No production secrets, raw database URLs, tokens, passwords, cookies, screenshots, request bodies, guest data, or payment data were requested or recorded.
- No production mutation, restart, deploy, SSH, database shell, DB-mutating E2E, or rate-limit stress test was performed.

## Evidence

| Check | Result | Notes |
| --- | --- | --- |
| GitHub CI baseline | Passed | Run `28695722234` completed successfully for commit `e75960716c4f6c0e1fbeeec7e626f2fd6e787ca6`. |
| Render live deploy | Unchanged/live | `render deploys list srv-d6ns31h4tr6s73c9i8g0 --output json` reported live deploy `dep-d945rdpkh4rs73ei9asg` for commit `c8acc1df271711d0b1c8e81419fbd76d5b6e2c4a`, finished `2026-07-04T01:13:46.233348Z`. |
| Cloudflare MCP/tool discovery | Not available | Tool discovery did not expose a callable Cloudflare WAF/rate-limit inspection action in this session. |
| Local Cloudflare CLIs | Not available | `wrangler` and `cloudflared` were not found on PATH. |
| Local Cloudflare env key presence | Not configured | `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CF_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, and `CF_ZONE_ID` were all absent from the local process environment. Values were not printed. |
| DNS chain | Resolved | `Resolve-DnsName book.sandboxhotel.com` showed the host CNAMEs to `sandbox-hotel-pms-v43m.onrender.com`, then Render/Cloudflare-backed targets with A records `216.24.57.8` and `216.24.57.9`. |
| Public-edge health probe | Passed | `node scripts/prove-public-edge-posture.mjs --paths /healthz?deep=1` returned `200`, `server=cloudflare`, `cfRayPresent=true`, `cfCacheStatus=DYNAMIC`, `renderOriginServer=Render`, production environment, database configured, and database OK. |
| Default public-edge proof | Passed after retry | The first full `npm.cmd run public-edge:proof` attempt aborted. Individual probes for `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` each passed with `404`; a retry of the full default command completed at `2026-07-04T08:35:09.546Z` with `/healthz?deep=1` returning `200` and all selected denied paths returning `404`. |

## Boundary

This proves only current public-edge routing and runtime health through Cloudflare/Render:

- `/healthz?deep=1` is reachable over HTTPS, reports production, and confirms configured database connectivity.
- Selected common sensitive paths return `404` through Cloudflare/Render with response bodies omitted.
- Common security headers are present on the observed responses.

It does not prove:

- Cloudflare zone ownership or account owner.
- WAF or rate-limit rule IDs.
- Rule thresholds, actions, host/path matchers, or managed ruleset configuration.
- Owner-approved non-destructive WAF or rate-limit test results.
- Secret rotation, recovery ownership, or Render backup/retention posture.

The WAF/rate-limit P0 remains open until the edge owner provides redacted provider/zone, rule IDs, thresholds/actions, protected hostnames, and an approved non-destructive test result.
