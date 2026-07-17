# Upstream WAF And Rate-Limit Plan

The app already enforces login throttling in `server/login-throttle.mjs`. Upstream controls add a second protection layer and must be configured at the zone level for the Cloudflare zone that owns `book.sandboxhotel.com`.

## Current Confirmed State

- `https://book.sandboxhotel.com` returns Cloudflare and Render edge headers, and DNS resolves through `sandbox-hotel-pms-v43m.onrender.com`.
- Local ignored Cloudflare env values are present for owner-run proof. The helper now uses zone-level WAF only by default; it does not call account-level WAF APIs unless `--account-id` or `--use-env-account-id` is explicitly provided.
- The current token successfully created/verified the Free-plan-compatible zone-level rules at `2026-07-07T08:08Z`: custom WAF rule `87dcf41c98fe479b9530a917d2a590cc` and login rate-limit rule `d9eb5af02d664b8c9764b4d815848a36`.
- Wrangler is not installed locally.
- 2026-07-06 and 2026-07-07 connector/tool discovery did not expose callable Cloudflare action tools in this Codex session, and Chrome dashboard automation reached the custom-rule creation URL but could not control the form. Live WAF/rate-limit proof still requires the repo helpers from an owner shell with a write-capable Cloudflare token or a manually completed dashboard save. The proof helper can now discover the zone ID from `--hostname` when the token has zone read access.
- Non-destructive probes for `/.env`, `/wp-login.php`, and `/phpmyadmin/` returned `404` through Cloudflare on 2026-06-02.
- Therefore, customer-owned Cloudflare zone-level WAF/rate-limit rules are now configured for the no-extra-cost launch scope. The probe results confirm common denied paths are not exposed; the proof helper records rule IDs, thresholds, and protected hostnames without storing Cloudflare secrets.

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

Minimum token capability for proof: Cloudflare zone/rulesets/WAF read access for the zone that owns `book.sandboxhotel.com`; zone read access is needed if `CLOUDFLARE_ZONE_ID` is omitted and the helper must discover the zone ID. Write access is only needed if the owner chooses to create or change zone-level rules in Cloudflare outside this read-only proof command. Do not use account-level WAF for the Free-plan path.

## Owner-Run Rule Ensure

After adding a token with zone WAF/rulesets write permission, apply the repo-standard upstream rules:

```powershell
npm.cmd run cloudflare:waf:ensure -- --env-file .\.codex\cloudflare-waf.local.env
```

Dry-run first if desired:

```powershell
npm.cmd run cloudflare:waf:ensure -- --env-file .\.codex\cloudflare-waf.local.env --dry-run
```

The command is idempotent and only creates or updates these named zone-level rules for `book.sandboxhotel.com` and `staff.sandboxhotel.com`: common probe block and login limit `10` requests per `10` seconds with a `10` second block mitigation timeout. This default is Free-plan-compatible because it uses one custom WAF rule, one rate-limit rule, the Free-plan-compatible `10` second rate-limit period, and a block action rather than paid challenge behavior. The optional API burst limit `300` requests per `60` seconds is available with `--include-api-burst-rate-limit` only when the Cloudflare plan/quota allows another rate-limit rule and longer periods.

## Required Rules

Configure equivalent upstream rules in Cloudflare or the active edge provider:

| Rule | Scope | Suggested action |
| --- | --- | --- |
| Login rate limit | `POST /api/auth/login` | Block excessive requests per IP over a short window. |
| API abuse limit | `/api/*` except `/api/health` | Keep in app/backend controls on Free-plan Cloudflare. Add a second Cloudflare rate-limit rule only if quota allows it without paid add-ons. |
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
