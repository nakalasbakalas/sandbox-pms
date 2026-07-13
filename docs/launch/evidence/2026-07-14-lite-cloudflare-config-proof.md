# Lite Cloudflare configuration proof — 2026-07-14

Verdict: the Sandbox PMS zone-level custom WAF and login rate-limit rules now
name `lite.sandboxhotel.com`, while preserving the existing `book` and `staff`
hostnames. This is configuration proof only. Traffic enforcement remains open
because the Lite hostname has no DNS record yet and the existing PMS hostnames
are DNS-only rather than Cloudflare-proxied.

## Bounded change

The owner-held local Cloudflare token and zone ID were loaded from an ignored
local file. Values were omitted from output. A dry run first showed exactly two
updates and no creates or deletes. The apply then updated only these stable rule
references:

| Phase | Rule reference | Rule ID | Result |
| --- | --- | --- | --- |
| Custom WAF | `sandbox_pms_common_probe_block` | `87dcf41c98fe479b9530a917d2a590cc` | Updated to cover `book.sandboxhotel.com`, `staff.sandboxhotel.com`, and `lite.sandboxhotel.com` |
| Rate limit | `sandbox_pms_login_rate_limit` | `d9eb5af02d664b8c9764b4d815848a36` | Updated to cover the same three hostnames |

The login rule remains an enabled block rule for `POST /api/auth/login`, keyed
by Cloudflare colo and source IP, with 10 requests per 10 seconds and a 10-second
mitigation window. Rule expressions and action parameters were omitted from the
proof output.

## Independent read-only proof

The final fail-closed `cloudflare:waf:proof --require-rules` gate passed
separately for all three hostnames. Readiness now requires the stable expected
rule references, enabled `block` actions, a positive target-host match, the
canonical probe-path boolean shape, and the exact `POST /api/auth/login` rate
contract (10 requests per 10 seconds, 10-second mitigation, colo plus source-IP
characteristics). It rejects `skip`/`log`, negative or negated host clauses,
unrelated paths, and impossible all-AND probe expressions. Each live read-only
result reported:

- one verified expected WAF block contract;
- one verified expected login rate-limit block contract;
- `requireOwnerReview=false`;
- no account-level inspection unless explicitly requested.

The helper previously returned `ready=true` when unrelated or ineffective zone
rules merely mentioned the hostname. The Lite branch now fails closed unless
both exact mitigating rule contracts protect the requested hostname.

## Open enforcement boundary

- `lite.sandboxhotel.com` had no DNS record at the time of this proof.
- `book.sandboxhotel.com` and `staff.sandboxhotel.com` resolved directly to
  Render and were DNS-only.
- A single bounded request to the existing book hostname reached the origin,
  so it did not prove a Cloudflare block.

After the isolated Lite Render service and custom domain exist, add the Lite DNS
record as proxied only after Render TLS/origin-host compatibility is confirmed.
Then verify DNS, TLS, `/healthz`, one non-destructive blocked-path request, and a
separately owner-approved bounded login-rate test. Do not load-test production.
