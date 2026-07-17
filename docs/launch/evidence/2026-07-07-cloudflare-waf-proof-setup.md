# 2026-07-07 Cloudflare WAF Proof Setup

Verdict: setup improved; WAF/rate-limit proof remains provider-gated.

## What Changed

- Added `--init-env-template` to `npm.cmd run cloudflare:waf:proof` so the owner can create `.codex/cloudflare-waf.local.env` without committing secrets.
- Added `--env-file <path>` support for local-only Cloudflare proof inputs. The helper only accepts Cloudflare proof keys and omits values from output.
- Added zone auto-discovery from `--hostname` when `CLOUDFLARE_ZONE_ID`/`CF_ZONE_ID` is not supplied and the token can read Cloudflare zones.
- Kept the command read-only. It reads Cloudflare Rulesets API metadata and optionally performs a bounded unauthenticated GET probe with response bodies omitted.
- Added `npm.cmd run cloudflare:waf:ensure`, a separate owner-run mutating command that idempotently creates or updates the named Sandbox PMS Cloudflare custom WAF and rate-limit rules when the token has zone WAF/rulesets write permission.

## Commands Run

```powershell
npm.cmd run cloudflare:waf:proof -- --help
npm.cmd run cloudflare:waf:proof -- --init-env-template
npm.cmd run cloudflare:waf:proof -- --env-file .\.codex\cloudflare-waf.local.env --hostname book.sandboxhotel.com
npm.cmd run cloudflare:waf:ensure -- --env-file .\.codex\cloudflare-waf.local.env --dry-run
npm.cmd run cloudflare:waf:ensure -- --env-file .\.codex\cloudflare-waf.local.env
npm.cmd test
```

## Results

- Help output passed and now documents the env-template, env-file, and hostname-discovery path.
- The env template was created at `D:\sandbox-pms\.codex\cloudflare-waf.local.env`. It contains blank placeholders only and is covered by ignored `.codex/` local state.
- The env-file proof command failed as expected with `ready=false` because no Cloudflare token value is present. The output omitted token values, rule expressions, and response bodies, and reported no loaded keys from the blank template.
- A later owner-local env proof command completed with `ready=false`: managed WAF metadata is readable, but no rate-limit rules or hostname-scoped custom WAF coverage are present.
- The ensure command dry-run reported the planned common-probe block rule plus login/API rate-limit thresholds, but the real ensure attempt returned Cloudflare `403 Authentication error` on zone ruleset creation. No rule was created, updated, or deleted.
- `npm.cmd test` passed, including coverage for Cloudflare ruleset summarization, hostname zone-candidate discovery, and local env-file parsing.

## Owner-Run Proof Command

After adding a Cloudflare API token locally:

```powershell
npm.cmd run cloudflare:waf:proof -- --env-file .\.codex\cloudflare-waf.local.env --hostname book.sandboxhotel.com --probe-url https://book.sandboxhotel.com/.env --require-rules
```

Minimum proof capability: token access to read Cloudflare zone/rulesets/WAF metadata for the zone that owns `book.sandboxhotel.com`. If the zone ID is omitted, the token also needs zone read access so the helper can discover the zone.

## Owner-Run Ensure Command

After adding a token with zone WAF/rulesets write permission locally:

```powershell
npm.cmd run cloudflare:waf:ensure -- --env-file .\.codex\cloudflare-waf.local.env
```

The ensure command records rule IDs, refs, actions, protected hostnames, and rate-limit thresholds with token, zone ID, expressions, action parameters, and response bodies omitted.

## Boundary

The available local token can read zone WAF metadata but cannot write zone rulesets. Connector/tool discovery did not expose callable Cloudflare WAF/ruleset tooling. This setup does not prove created custom WAF/rate-limit rule IDs, protected-hostname coverage, or rate-limit behavior until the owner-run ensure command succeeds with account-owned Cloudflare write access and the proof command reports `ready=true`.
