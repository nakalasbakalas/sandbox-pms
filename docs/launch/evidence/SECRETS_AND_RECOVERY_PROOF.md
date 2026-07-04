# Secrets And Recovery Proof

Last refreshed: 2026-07-04T15:51+07:00.

Verdict: partial/open. Safe repository, Render resource, deploy, live-health, public-edge, and redacted Gmail OAuth status evidence is current through Slice 5BP. Slice 5BP confirms the repository/evidence secret-hygiene scan passes at commit `72592dacc1d6b3189fe7061aad6fd6ac932df72e`, refreshes redacted Render Gmail OAuth key presence, and confirms booking-email OAuth still reports `ready=false`. Slice 5BO refreshes Cloudflare-fronted public-edge proof and records that privileged Cloudflare WAF/rate-limit inspection is not available from the current tools/env. Slice 5BM configures the non-secret booking mailbox identity keys on Render, and Slice 5BI adds a tested owner-run Gmail OAuth handoff helper. This is not enough for launch sign-off. Live provider secret key inventory, rotation metadata, owner confirmations, named rollback/deputy/database recovery owners, latest recovery-point proof, WAF/rate-limit rule evidence, and completed booking Gmail OAuth credentials remain account-owner/provider-gated.

## Current Evidence

| Area | Status | Evidence |
| --- | --- | --- |
| Local repository secret hygiene | Green locally | Slice 5BP `npm.cmd run launch:evidence` found no high-confidence unredacted production secret-shaped values in `511` tracked/unignored text files and no unredacted secret-shaped values in launch evidence docs at commit `72592dacc1d6b3189fe7061aad6fd6ac932df72e`. |
| Production service resource | Partially proven | [2026-07-04-slice-5bm-render-gmail-mailbox-config.md](2026-07-04-slice-5bm-render-gmail-mailbox-config.md) confirms `sandbox-hotel-pms-v43m` is live on deploy `dep-d945rdpkh4rs73ei9asg` for commit `c8acc1df271711d0b1c8e81419fbd76d5b6e2c4a`. |
| Production database resource | Partially proven | [2026-07-03-slice-5av-secrets-recovery-waf-refresh.md](2026-07-03-slice-5av-secrets-recovery-waf-refresh.md) confirms `sandbox-hotel-pms-db-v43m` is available, plan `basic_256mb`, region `oregon`. |
| Render Production environment posture | Open/risk remains | Slice 5AV confirms `Production` reports `protectedStatus=unprotected`, `networkIsolationEnabled=false`, and IP allow list `0.0.0.0/0`. This is not WAF/rate-limit rule proof. |
| Public edge/runtime health | Green as public-edge runtime health | Slice 5BO `npm.cmd run public-edge:proof` completed at `2026-07-04T08:35:09.546Z`; `/healthz?deep=1` returned `200`, database configured/OK, `server=cloudflare`, `cfRayPresent=true`, `renderOriginServer=Render`, and common security-header presence. Selected denied paths returned `404` through Cloudflare/Render headers. This is public-edge routing proof, not WAF/rate-limit rule proof. |
| Disposable restore test | Historical pass | `docs/live-environment-proof.md` records a disposable Render Postgres restore test that passed on 2026-06-07 and deleted the temporary database afterward. |
| Render CLI env-var/secret metadata | Not available through this CLI path | Slice 5AV confirmed `render --help` exposes no top-level env-var/secret-manager command; `render services --help` exposes only `create` and `instances`; `render services env --help` returned services help only; `render ea --help` exposes object storage only. No safe CLI secret inventory or rotation metadata command was exposed in this session. |
| Booking-email Gmail OAuth env-var metadata | Partial/open | Slice 5BM configures non-secret `BOOKING_EMAIL_PRIMARY_MAILBOX` and `BOOKING_EMAIL_GMAIL_USER_ID` on `sandbox-hotel-pms-v43m`. Slice 5BP redacted status at `2026-07-04T08:51:08.531Z` still reports every supported booking-specific and fallback credential path `ready=false`. Slice 5BI adds `npm.cmd run gmail-oauth:render` so an owner can create/apply the refresh-token tuple without printing values. No real credential values were requested, printed, or applied. |
| Render CLI backup/recovery metadata | Not available through this CLI path | `render backups --help` returned `unknown command "backups" for "render"`; no safe CLI recovery-point or retention metadata command was exposed in this session. |
| Recovery/rollback owners | Open | `docs/disaster-recovery.md` still lists primary rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner as `TBD`. |

## Boundaries

- No production secret values were requested or recorded.
- No raw database URLs, tokens, passwords, cookies, private keys, or screenshots were committed.
- Slice 5BP is repository-scoped proof only; it does not inspect Render dashboard secret values or rotation metadata.
- Slice 5BM performed a Render deploy of green commit `c8acc1df271711d0b1c8e81419fbd76d5b6e2c4a` and applied only non-secret mailbox identity env vars; no restart, SSH session, database shell, production data mutation, confirmed booking-email import, or DB-mutating E2E ran in this slice.
- Runtime health proves the app can reach its configured production database; it does not prove secret rotation, custody, or cleanup.

## Evidence Required To Close

- Redacted Render secret key inventory showing required key names only.
- Rotation dates where available, or owner-confirmed rotation status where the provider does not expose timestamps.
- Cleanup/retention decision for legacy or compatibility env keys, including rollback impact.
- Named rollback owner and deputy with Render dashboard access.
- Named database recovery owner with Render PostgreSQL access.
- Latest recovery point and retention window from Render dashboard or API, values redacted where needed.
- WAF/rate-limit owner, provider/zone, rule IDs, thresholds, protected hostnames, and an owner-approved non-destructive test result.
