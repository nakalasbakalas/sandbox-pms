# Cloudflare WAF / Rate-Limit Proof V2

Status: open.

## Environment

- Commit SHA:
- Protected hostnames:
- Cloudflare zone/account label:
- Test date/time:
- Owner:

## Rule inventory

| Rule ID | Rule name | Hostname/path scope | Action | Threshold | Enabled? | Last verified |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  | challenge/block/log |  |  |  |

## Required coverage

- [ ] Login endpoint protected against brute-force traffic.
- [ ] Setup endpoint protected/blocked unless token-approved.
- [ ] API mutation paths protected from high-rate abuse.
- [ ] Static/public site is not accidentally blocked.
- [ ] Known scanner paths return safe 404/403 behavior.

## Probe results

| Probe | Expected | Actual | Pass? | Notes |
| --- | --- | --- | --- | --- |
| Public health `/healthz?deep=1` | 200 |  |  |  |
| `/.env` | 404/403 |  |  |  |
| `/wp-login.php` | 404/403 |  |  |  |
| `/phpmyadmin/` | 404/403 |  |  |  |
| repeated login attempts | throttled/challenged |  |  |  |

## Result

- [ ] Passed with privileged provider proof
- [ ] Failed
- [ ] Accepted risk with owner/date/expiry:
