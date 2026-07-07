# Upstream WAF And Rate-Limit Plan

The app already enforces login throttling in `server/login-throttle.mjs`. Upstream controls add a second protection layer and must be configured in the account that owns the public edge for `book.sandboxhotel.com`.

## Current Confirmed State

- `https://book.sandboxhotel.com` returns Cloudflare and Render edge headers, and DNS resolves through `sandbox-hotel-pms-v43m.onrender.com`.
- No `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN`, `CF_ACCOUNT_ID`, or `CF_ZONE_ID` is present in the local shell.
- Wrangler is not installed locally.
- 2026-07-06 and 2026-07-07 connector/tool discovery did not expose callable Cloudflare action tools in this Codex session, so live WAF/rate-limit proof still requires the repo helper from an owner shell with a Cloudflare token. The helper can now discover the zone ID from `--hostname` when the token has zone read access.
- Non-destructive probes for `/.env`, `/wp-login.php`, and `/phpmyadmin/` returned `404` through Cloudflare on 2026-06-02.
- Therefore, customer-owned Cloudflare WAF/rate-limit rules were not created or verified from this repo session. The probe results confirm those paths are not exposed; they do not prove rule IDs, thresholds, or rate-limit behavior. Nick owns Cloudflare launch proof.

## Owner-Run Proof Setup

Use the repo helper from an owner shell. It is read-only against Cloudflare and omits token values, rule action parameters, response bodies, and rule expressions by default.

```powershell
npm.cmd run cloudflare:waf:proof -- --init-env-template
```

Then edit the ignored local file `.codex/cloudflare-waf.local.env` and provide `CLOUDFLARE_API_TOKEN`. Add `CLOUDFLARE_ZONE_ID` only if the token cannot discover the zone from `book.sandboxhotel.com`.

Run proof:

```powershell
npm.cmd run cloudflare:waf:proof -- --env-file .\.codex\cloudflare-waf.local.env --hostname book.sandboxhotel.com --probe-url https://book.sandboxhotel.com/.env --require-rules
```

Minimum token capability for proof: Cloudflare zone/rulesets/WAF read access for the zone that owns `book.sandboxhotel.com`; zone read access is needed if `CLOUDFLARE_ZONE_ID` is omitted and the helper must discover the zone ID. Write access is only needed if the owner chooses to create or change rules in Cloudflare outside this read-only proof command.

## Required Rules

Configure equivalent upstream rules in Cloudflare or the active edge provider:

| Rule | Scope | Suggested action |
| --- | --- | --- |
| Login rate limit | `POST /api/auth/login` | Challenge or block excessive requests per IP over a short window. |
| API abuse limit | `/api/*` except `/api/health` | Challenge or throttle excessive request bursts. |
| Common probe block | `/.env`, `/wp-*`, `/phpmyadmin*`, `/vendor/*` | Block. |
| Managed WAF | `book.sandboxhotel.com` | Enable managed rules appropriate for a Node/React application. |

Exact thresholds should be set by the edge account owner based on expected staff concurrency. Do not set thresholds so low that normal front-desk use is blocked during check-in/check-out peaks.

## Required Evidence

Record in [live-environment-proof.md](live-environment-proof.md):

- Edge provider.
- Zone/account.
- Rule IDs.
- Protected hostnames.
- Thresholds and actions.
- Date/time of a non-destructive test.
- Tester.

Do not store API tokens or provider secrets in this repo.
