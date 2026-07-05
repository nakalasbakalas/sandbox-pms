# Secrets And Recovery Proof

Last refreshed: 2026-07-05T08:54+07:00.

Verdict: partial/open. Safe repository, Render resource, deploy, live-health, public-edge, and redacted Gmail OAuth status evidence is current through Slice 5BW. Slice 5BW configures the booking-specific Gmail OAuth refresh-token tuple on Render and confirms the supported credential path is `ready=true` with values omitted; it also imports booking-email history as review-only PMS events. Slice 5BU adds the owner-run Cloudflare WAF/rate-limit proof helper, but privileged Cloudflare WAF/rate-limit inspection is still unavailable from the current tools/env. This is not enough for launch sign-off. Live provider secret key inventory, rotation metadata, owner confirmations, named rollback/deputy/database recovery owners, latest recovery-point proof, and WAF/rate-limit rule evidence remain account-owner/provider-gated.

## Current Evidence

| Area | Status | Evidence |
| --- | --- | --- |
| Local repository secret hygiene | Green locally | Slice 5BV `npm.cmd run launch:evidence` found no high-confidence unredacted production secret-shaped values in `518` tracked/unignored text files and no unredacted secret-shaped values in launch evidence docs at commit `d8884884faba8b50cb73c7f827aa4f9871744d4a`. |
| Production service resource | Partially proven | [2026-07-05-slice-5bw-gmail-oauth-backfill.md](2026-07-05-slice-5bw-gmail-oauth-backfill.md) confirms `sandbox-hotel-pms-v43m` is live on deploy `dep-d94reknlk1mc73bqndq0` for commit `c0ecc6b92bea14e4a9e8871979049a3f8f887a1a`. |
| Production database resource | Partially proven | [2026-07-03-slice-5av-secrets-recovery-waf-refresh.md](2026-07-03-slice-5av-secrets-recovery-waf-refresh.md) confirms `sandbox-hotel-pms-db-v43m` is available, plan `basic_256mb`, region `oregon`. |
| Render Production environment posture | Open/risk remains | Slice 5AV confirms `Production` reports `protectedStatus=unprotected`, `networkIsolationEnabled=false`, and IP allow list `0.0.0.0/0`. This is not WAF/rate-limit rule proof. |
| Public edge/runtime health | Green as public-edge runtime health | Slice 5BV `npm.cmd run public-edge:proof` completed at `2026-07-04T10:42:23.971Z`; `/healthz?deep=1` returned `200`, database configured/OK, `server=cloudflare`, `cfRayPresent=true`, `renderOriginServer=Render`, and common security-header presence. Selected denied paths returned `404` through Cloudflare/Render headers. This is public-edge routing proof, not WAF/rate-limit rule proof. |
| Disposable restore test | Historical pass | `docs/live-environment-proof.md` records a disposable Render Postgres restore test that passed on 2026-06-07 and deleted the temporary database afterward. |
| Render CLI env-var/secret metadata | Not available through this CLI path | Slice 5AV confirmed `render --help` exposes no top-level env-var/secret-manager command; `render services --help` exposes only `create` and `instances`; `render services env --help` returned services help only; `render ea --help` exposes object storage only. No safe CLI secret inventory or rotation metadata command was exposed in this session. |
| Booking-email Gmail OAuth env-var metadata | Ready for booking sync | Slice 5BW configures `BOOKING_EMAIL_GMAIL_CLIENT_ID`, `BOOKING_EMAIL_GMAIL_CLIENT_SECRET`, and `BOOKING_EMAIL_GMAIL_REFRESH_TOKEN` on `sandbox-hotel-pms-v43m` using the redacted `gmail-oauth:render` helper. `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` at `2026-07-05T01:48:28.733Z` reported the booking-specific refresh-token tuple `ready=true`. Values and Render auth tokens were omitted. This is credential-path readiness, not full provider secret inventory or rotation proof. |
| Render CLI backup/recovery metadata | Not available through this CLI path | `render backups --help` returned `unknown command "backups" for "render"`; no safe CLI recovery-point or retention metadata command was exposed in this session. |
| Recovery/rollback owners | Open | `docs/disaster-recovery.md` still lists primary rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner as `TBD`. |

## Boundaries

- No production secret values were requested or recorded.
- No raw database URLs, tokens, passwords, cookies, private keys, or screenshots were committed.
- Slice 5BW evidence is repository-scoped plus redacted provider/API proof only; it does not inspect Render dashboard secret values or rotation metadata.
- Slice 5BW performed a Render deploy of commit `c0ecc6b92bea14e4a9e8871979049a3f8f887a1a`, updated booking Gmail OAuth env vars through a redacted helper, and imported review-only booking-email events. It did not run DB-mutating E2E against production or expose secret values.
- Runtime health proves the app can reach its configured production database; it does not prove secret rotation, custody, or cleanup.

## Evidence Required To Close

- Redacted Render secret key inventory showing required key names only.
- Rotation dates where available, or owner-confirmed rotation status where the provider does not expose timestamps.
- Cleanup/retention decision for legacy or compatibility env keys, including rollback impact.
- Named rollback owner and deputy with Render dashboard access.
- Named database recovery owner with Render PostgreSQL access.
- Latest recovery point and retention window from Render dashboard or API, values redacted where needed.
- WAF/rate-limit owner, provider/zone, rule IDs, thresholds, protected hostnames, and an owner-approved non-destructive test result.
