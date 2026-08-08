# Cloudflare WAF / Rate-Limit Proof V2

Status: current read-only provider proof complete; broader API/setup rate-limit coverage remains unproven.

## Environment

- Commit SHA: candidate `d5631a1`; proof helper unchanged from the tested parent
- Protected hostnames: `book.sandboxhotel.com`
- Cloudflare zone/account label: zone `sandboxhotel.com` (`active`); account label was not requested or inspected
- Test date/time: `2026-08-08T09:40:13.865Z`
- Owner: Nick (provider owner recorded in the launch decision log)

## Rule inventory

| Rule ID | Rule name | Hostname/path scope | Action | Threshold | Enabled? | Last verified |
| --- | --- | --- | --- | --- | --- | --- |
| `77454fe2d30c4220b5701f6fdfb893ba` | Cloudflare Managed Free Ruleset | Zone managed ruleset; hostname expression not inspected | block | 31 enabled managed rules | Yes | 2026-08-08 |
| `87dcf41c98fe479b9530a917d2a590cc` | Sandbox PMS common probe block | `book.sandboxhotel.com`; expression omitted | block | n/a | Yes | 2026-08-08 |
| `d9eb5af02d664b8c9764b4d815848a36` | Sandbox PMS login rate limit | `book.sandboxhotel.com` login endpoint; expression omitted | block | 10 requests / 10 seconds; 10-second mitigation | Yes | 2026-08-08 |

## Required coverage

- [x] Login endpoint protected by the configured Cloudflare rate-limit rule.
- [ ] Setup endpoint protected/blocked unless token-approved.
- [ ] API mutation paths protected from high-rate abuse.
- [x] Public deep health remains reachable through Cloudflare.
- [x] Known scanner paths return safe 404 behavior.

The current provider inventory proves a login rate limit and common-probe block. It does not establish a distinct Cloudflare setup-endpoint rule or general API-mutation rate-limit rule; application-layer controls are outside this provider proof.

## Probe results

| Probe | Expected | Actual | Pass? | Notes |
| --- | --- | --- | --- | --- |
| Public health `/healthz?deep=1` | 200 | 200 | Yes | Cloudflare and Render headers present; bounded health fields report production/database healthy. |
| `/.env` | 404/403 | 404 | Yes | Cloudflare response; body omitted. |
| `/wp-login.php` | 404/403 | 404 | Yes | Cloudflare response; body omitted. |
| `/phpmyadmin/` | 404/403 | 404 | Yes | Cloudflare response; body omitted. |
| repeated login attempts | throttled/challenged | not run | Not tested | Deliberate lockout/load testing requires a dedicated account and owner approval. Provider rule metadata is present. |

## Result

- [x] Passed with privileged provider proof, bounded to the rule inventory and non-destructive probes above
- [ ] Failed
- [ ] Accepted risk with owner/date/expiry:
