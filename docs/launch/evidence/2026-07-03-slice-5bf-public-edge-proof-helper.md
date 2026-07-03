# Slice 5BF - Public Edge Proof Helper

Date: 2026-07-03

## Verdict

Public edge posture proof is now repeatable through a no-secret repo command. The current public edge check is green for Cloudflare-fronted routing, Render origin headers, health, selected denied paths, and common browser security headers. This still does not close the WAF/rate-limit P0 because Cloudflare zone ownership, WAF/rate-limit rule IDs, thresholds, and an owner-approved non-destructive rule test are not available in this session.

## Target

- Public host: `https://book.sandboxhotel.com`
- Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`)
- Current live deploy at check time: `dep-d93ud5nlk1mc73a2sbv0`

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| GitHub CI | Passed | Run `28672978563` completed `Install, test, build, and launch-check` successfully for commit `0de2eb3d612a555dbd6cac92948becd16aa24cae`. |
| Exact Render deploy | Passed | `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit 0de2eb3d612a555dbd6cac92948becd16aa24cae --wait --confirm --output json` returned live deploy `dep-d93ud5nlk1mc73a2sbv0`, finished `2026-07-03T16:45:40Z`. |
| Public health and setup reprobe | Passed | `GET /healthz?deep=1` returned `200`, `ok=true`, production environment, database configured/OK, Cloudflare header, and Render origin header at `2026-07-03T16:45:55Z`. Unauthenticated `POST /api/setup/complete` returned the intended production-disabled `403`. |
| Public edge proof command | Passed | `npm.cmd run public-edge:proof` completed at `2026-07-03T16:45:57.468Z`. |
| Health through edge | Passed | `/healthz?deep=1` returned `200`, `ok=true`, `environment=production`, database configured/OK, `server=cloudflare`, `cfRayPresent=true`, and `renderOriginServer=Render`. |
| Selected denied paths | Passed | `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` each returned `404` through Cloudflare with Render origin headers. |
| Security headers | Present | The probed responses reported `strictTransportSecurityPresent=true`, `contentSecurityPolicyPresent=true`, and `xFrameOptionsPresent=true`. |
| DNS lookup | Partial | CNAME resolution was unavailable from the resolver; fallback lookup confirmed an address was present. |
| Redaction and request safety | Passed | The command sent no cookies or authorization headers, requested no secrets, and omitted response bodies except bounded health fields. |
| Cloudflare privileged tooling | Not available | Tool discovery exposed no callable Cloudflare actions; local `wrangler` was not found; no `CLOUDFLARE*` or `CF_*` process env credentials were present. |
| Gmail connector state | Blocked | The Gmail connector profile call still returns `token_expired`; it cannot scan booking mailbox state in this session and cannot supply backend Render OAuth credentials. |

## Added Operator Command

```powershell
npm.cmd run public-edge:proof
```

Optional overrides:

```powershell
$env:LIVE_APP_URL='https://book.sandboxhotel.com'
$env:PUBLIC_EDGE_PROOF_PATHS='/healthz?deep=1,/.env,/wp-login.php,/phpmyadmin/,/vendor/'
npm.cmd run public-edge:proof
```

## Current Decision

This slice improves repeatability for public-edge evidence. It does not prove customer-owned Cloudflare WAF or rate-limit configuration. The WAF/rate-limit blocker remains open until the owner provides provider/zone/account, rule IDs, protected hostnames, thresholds/actions, and an approved non-destructive test result.
