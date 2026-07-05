# Slice 5BY - Current Main Render Sync

Status date: 2026-07-05.

Verdict: the green `main` commit current at deploy time is synced to the long-term Render custom-domain service. This is deployment/probe evidence only; it does not close owner/provider launch-signoff blockers.

## Scope

- Deploy exact green `main` commit `bf37942ad77223e47f8fea41dc88e9921d7ddfec` to `sandbox-hotel-pms-v43m`.
- Reprobe public setup gate, deep health, public edge posture, live readiness, production preflight, redacted Gmail OAuth status, and Cloudflare WAF proof readiness.
- Omit secrets, cookies, raw response bodies, Gmail values, provider tokens, and production data.

## Evidence

| Check | Result | Notes |
| --- | --- | --- |
| GitHub CI | Passed | GitHub CI run `28726972988` passed for commit `bf37942ad77223e47f8fea41dc88e9921d7ddfec`. |
| Render deploy | Live | `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit bf37942ad77223e47f8fea41dc88e9921d7ddfec --wait --confirm --output json` returned deploy `dep-d94s6oa8qa3s73d6bum0`, status `live`, finished `2026-07-05T02:40:03.878047Z`. |
| Public setup-complete gate | Green | Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and `Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.` through Cloudflare/Render headers. |
| Public deep health | Green | `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, database configured/OK, Cloudflare server header, and Render origin header. |
| Public edge proof | Passed | `npm.cmd run public-edge:proof` at `2026-07-05T02:40:22.968Z` returned deep health `200`, selected denied paths `404`, common security headers present, Cloudflare header evidence, Render origin header evidence, and response bodies omitted except bounded health fields. This is not WAF/rate-limit rule proof. |
| Live readiness | Passed | `npm.cmd run live:check` passed for `https://book.sandboxhotel.com`; LINE remains optional/unconfigured unless `LIVE_REQUIRE_LINE=true`. |
| Production preflight | Passed with expected warning | `npm.cmd run prod:preflight` passed and warned that LINE credentials are not configured, so live LINE messaging remains disabled. |
| Render Gmail OAuth status | Ready | `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` at `2026-07-05T02:40:20.166Z` reported `ready=true` for the booking-specific refresh-token tuple; values and Render auth token were omitted. |
| Cloudflare WAF proof status | Still owner-gated | `npm.cmd run cloudflare:waf:proof` at `2026-07-05T02:40:20.157Z` reported `ready=false` because `CLOUDFLARE_API_TOKEN`/`CF_API_TOKEN` and `CLOUDFLARE_ZONE_ID`/`CF_ZONE_ID` were missing. No Cloudflare token or rule values were printed. |

## Remaining Work

- Collect credentialed production auth/RBAC/logout proof using approved users.
- Collect owner/source proof for real room inventory.
- Record owner acceptance of local disposable DB workflow proof or provide staging DB-mutating E2E proof.
- Collect provider secret inventory/rotation decisions, rollback/deputy/database recovery owners, latest recovery-point evidence, and Cloudflare WAF/rate-limit rule IDs/test evidence.
- Complete staff/admin review of imported `/booking-inbox` events before applying them.
