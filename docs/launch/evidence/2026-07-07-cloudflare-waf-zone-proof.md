# 2026-07-07 Cloudflare WAF Zone Proof

Status date: 2026-07-07.

Verdict: complete for no-extra-cost zone-level Cloudflare WAF/rate-limit launch proof. The helper created/verified the named zone-level rules for `sandboxhotel.com`, avoided account-level WAF APIs, and `npm.cmd run cloudflare:waf:proof -- --require-rules` reported `ready=true` at `2026-07-07T08:08:56.333Z`.

## Scope

- Public target: `https://book.sandboxhotel.com`.
- Cloudflare zone name: `sandboxhotel.com`.
- Commands used local-only Cloudflare credentials from the ignored `.codex` environment path or process environment.
- No Cloudflare API token, account ID, zone ID, R2 access key, R2 secret, raw response body, rule expression, action parameter, cookie, password, or database URL is recorded here.
- Cloudflare zone-level rule creation succeeded only for the named Sandbox PMS custom WAF and login rate-limit rules. No Cloudflare rule deletion, load test, account-level WAF add-on, or paid action was performed.

## Commands Run

```powershell
npm.cmd run cloudflare:waf:proof -- --hostname book.sandboxhotel.com --probe-url https://book.sandboxhotel.com/.env --require-rules
npm.cmd run cloudflare:waf:proof -- --hostname book.sandboxhotel.com --probe-url https://book.sandboxhotel.com/.env --probe-count 1 --require-rules
npm.cmd run cloudflare:waf:proof -- --env-file .\.codex\cloudflare-waf.local.env --hostname book.sandboxhotel.com --probe-url https://book.sandboxhotel.com/.env --require-rules
npm.cmd run cloudflare:waf:ensure -- --env-file .\.codex\cloudflare-waf.local.env --dry-run
npm.cmd run cloudflare:waf:ensure -- --env-file .\.codex\cloudflare-waf.local.env
npm.cmd run public-edge:proof
```

## Results

| Check | Result | Notes |
| --- | --- | --- |
| Zone WAF metadata | Passed | `npm.cmd run cloudflare:waf:proof -- --require-rules` succeeded zone-only. The zone name was `sandboxhotel.com`, status `active`, with zone ID present but omitted. |
| Account-level rulesets | Not used | The Free-plan path avoids account-level WAF APIs and does not require the paid account-level WAF add-on. The proof output reported `account.idPresent=false` and `rulesetLevels=["zone"]`. |
| Managed WAF ruleset | Present | Zone ruleset `77454fe2d30c4220b5701f6fdfb893ba`, `Cloudflare Managed Free Ruleset`, phase `http_request_firewall_managed`, kind `managed`, version `67`. |
| Enabled managed WAF rules | Present | `26` enabled rules, all with action `block`. Rule expressions and action parameters were omitted by the helper. |
| Hostname-scoped WAF coverage | Passed | The helper reported `targetHostnameCoveredRules=2` for `book.sandboxhotel.com`: the custom probe block rule and login rate-limit rule both mention the target hostname. |
| Rate-limit rules | Present | The helper reported `rateLimitRulesCount=1` and recorded the login threshold: `10` requests per `10` seconds by `cf.colo.id` and `ip.src`, with `10` second block mitigation timeout. |
| Zone-level rule creation | Passed | `npm.cmd run cloudflare:waf:ensure -- --env-file .\.codex\cloudflare-waf.local.env` completed at `2026-07-07T08:08:05.593Z`. The custom WAF rule was unchanged and the login rate-limit ruleset/rule was created. |
| Free-plan quota | Passed | The final default uses one custom WAF rule and one rate-limit rule. The optional API burst Cloudflare rate-limit rule is disabled by default to avoid paid quota/add-ons. |
| Public edge probe | Passed | `npm.cmd run public-edge:proof` passed again at `2026-07-07T06:47:59.258Z`: `/healthz?deep=1` returned `200`, and `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` returned `404` through Cloudflare/Render headers with response bodies omitted. |
| Explicit helper probe | Passed | The proof helper probe for `https://book.sandboxhotel.com/.env` returned `404` with Cloudflare headers at `2026-07-07T08:08:56.333Z`; response body was omitted. |
| Chrome dashboard creation path | Superseded | Chrome dashboard automation was not needed after the zone-level Rulesets API path succeeded. |

## Recorded Rule IDs

Managed WAF ruleset:

| Ruleset ID | Name | Phase | Enabled rules | Rate-limit rules |
| --- | --- | --- | ---: | ---: |
| `77454fe2d30c4220b5701f6fdfb893ba` | Cloudflare Managed Free Ruleset | `http_request_firewall_managed` | 26 | 0 |

Enabled managed WAF rule IDs:

```text
b453c8ace3a54e0ab7c791510b51dc4d
7dfd111a6bad4b86bf3522cce6c5792f
9f7e454e4cad45abbcc40696037f70df
9aa65152dfd2409b916aa6c6ae0bfb8c
39c91a0a9dfb49a98b9446ab23728616
16165bcc426743198ca9846da7377369
8211fe3405ca4f1382443e73b6c97bb0
d379921792144f699029a3b759e1ad94
756cd04ee0434ec68da3eb5744a423e8
aec3bff788004085a54e63e835909138
9ce4e284ff2a486aaa37d642bff5a079
52cc923af3b4484696f6c8ecb9073f5c
8399c1b1b32e45fb9674094a5472b59b
1478cd46ee7e4979a7f0be58f3e87b31
a24d55f20dc94f0ebd69f3a1f982e575
c1d0ed46741e44f19e9b75ecd8b2a9d6
cdbc99bfeaad43cf9000257c317a7b41
93f26552f936415baf994cd877d4ba58
b0928a3200fe43bda32999c3edc6475c
c806c77afd784455a5d0b5091702f7a0
4c6b0411c4f34d7b8a28ca03c803ba82
0cc7e2df1d614c74a8e4b1bc91935fcb
9e01df73001040289aa0449cf2f153c7
2b5d06e34a814a889bee9a0699702280
3114709a3c3b4e3685052c7b251e86aa
cbdd3f48396e4b7389d6efd174746aff
```

Sandbox PMS zone-level WAF/rate-limit rules:

| Ruleset ID | Rule ID | Rule ref | Description | Phase | Action | Protected hostnames | Threshold |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `b510ac934aa84f37b7ea399d66f2530c` | `87dcf41c98fe479b9530a917d2a590cc` | `sandbox_pms_common_probe_block` | Sandbox PMS common probe block | `http_request_firewall_custom` | `block` | `book.sandboxhotel.com`, `staff.sandboxhotel.com` | N/A |
| `8e6c77f729974d35ad589329bca15a77` | `d9eb5af02d664b8c9764b4d815848a36` | `sandbox_pms_login_rate_limit` | Sandbox PMS login rate limit | `http_ratelimit` | `block` | `book.sandboxhotel.com`, `staff.sandboxhotel.com` | `10` requests per `10` seconds by `cf.colo.id` and `ip.src`; mitigation timeout `10` seconds |

## No-Extra-Cost Boundary

The account-level WAF dashboard path showed a paid add-on prompt, so this proof intentionally uses zone-level WAF only. The default repo helper fits the no-extra-cost Cloudflare Free-plan path by managing one custom WAF rule and one rate-limit rule. The broader API burst rule remains an optional helper flag for plans/quotas that allow another rate-limit rule; Free-plan launch proof relies on the app/backend controls for broader API abuse protection.

## Remaining WAF/Rate-Limit Gap

None for the no-extra-cost launch proof scope. Future paid or higher-quota hardening can add the optional API burst Cloudflare rate-limit rule, but it is not required for this Free-plan proof.

## Boundary

This is real Cloudflare zone metadata proof, not just public edge proof. It records rule IDs, protected hostnames, actions, and the Free-plan-compatible login rate-limit threshold without recording Cloudflare secrets.
