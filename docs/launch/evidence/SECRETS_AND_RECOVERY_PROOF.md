# Secrets And Recovery Proof

Last refreshed: 2026-07-04T06:18+07:00.

Verdict: partial/open. Safe repository, Render resource, deploy, live-health, public-edge, and redacted Gmail OAuth status evidence is current through Slice 5BH, but this is not enough for launch sign-off. Live secret key inventory, rotation metadata, owner confirmations, named rollback/deputy/database recovery owners, latest recovery-point proof, and WAF/rate-limit rule evidence remain account-owner/provider-gated.

## Current Evidence

| Area | Status | Evidence |
| --- | --- | --- |
| Local repository secret hygiene | Green locally | `npm.cmd run launch:evidence` found no high-confidence unredacted production secret-shaped values in tracked/unignored text files in the latest run. |
| Production service resource | Partially proven | [2026-07-04-slice-5bh-live-gmail-refresh.md](2026-07-04-slice-5bh-live-gmail-refresh.md) confirms `sandbox-hotel-pms-v43m` remains live on deploy `dep-d93ud5nlk1mc73a2sbv0` for commit `0de2eb3d612a555dbd6cac92948becd16aa24cae`. |
| Production database resource | Partially proven | [2026-07-03-slice-5av-secrets-recovery-waf-refresh.md](2026-07-03-slice-5av-secrets-recovery-waf-refresh.md) confirms `sandbox-hotel-pms-db-v43m` is available, plan `basic_256mb`, region `oregon`. |
| Render Production environment posture | Open/risk remains | Slice 5AV confirms `Production` reports `protectedStatus=unprotected`, `networkIsolationEnabled=false`, and IP allow list `0.0.0.0/0`. This is not WAF/rate-limit rule proof. |
| Public edge/runtime health | Green as public-edge runtime health | Slice 5BH `npm.cmd run public-edge:proof` returned `200` for `/healthz?deep=1`, database configured/OK, `server=cloudflare`, `cfRayPresent=true`, `renderOriginServer=Render`, and common security-header presence. Selected denied paths returned `404` through Cloudflare/Render headers. This is public-edge routing proof, not WAF/rate-limit rule proof. |
| Disposable restore test | Historical pass | `docs/live-environment-proof.md` records a disposable Render Postgres restore test that passed on 2026-06-07 and deleted the temporary database afterward. |
| Render CLI env-var/secret metadata | Not available through this CLI path | Slice 5AV confirmed `render --help` exposes no top-level env-var/secret-manager command; `render services --help` exposes only `create` and `instances`; `render services env --help` returned services help only; `render ea --help` exposes object storage only. No safe CLI secret inventory or rotation metadata command was exposed in this session. |
| Booking-email Gmail OAuth env-var metadata | Open/missing | Slice 5BH uses `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` and reports all supported booking-specific and fallback Gmail credential paths `ready=false` on `sandbox-hotel-pms-v43m`. No values were requested or printed. |
| Render CLI backup/recovery metadata | Not available through this CLI path | `render backups --help` returned `unknown command "backups" for "render"`; no safe CLI recovery-point or retention metadata command was exposed in this session. |
| Recovery/rollback owners | Open | `docs/disaster-recovery.md` still lists primary rollback owner, rollback deputy, database recovery owner, and WAF/rate-limit owner as `TBD`. |

## Boundaries

- No production secret values were requested or recorded.
- No raw database URLs, tokens, passwords, cookies, private keys, or screenshots were committed.
- No deploy, restart, SSH session, database shell, production mutation, or DB-mutating E2E ran in this slice.
- Runtime health proves the app can reach its configured production database; it does not prove secret rotation, custody, or cleanup.

## Evidence Required To Close

- Redacted Render secret key inventory showing required key names only.
- Rotation dates where available, or owner-confirmed rotation status where the provider does not expose timestamps.
- Cleanup/retention decision for legacy or compatibility env keys, including rollback impact.
- Named rollback owner and deputy with Render dashboard access.
- Named database recovery owner with Render PostgreSQL access.
- Latest recovery point and retention window from Render dashboard or API, values redacted where needed.
- WAF/rate-limit owner, provider/zone, rule IDs, thresholds, protected hostnames, and an owner-approved non-destructive test result.
