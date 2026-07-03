# Slice 5AC Launch Evidence - Secrets And Recovery Proof Refresh - 2026-07-03

Scope: refresh secret, recovery, and rollback evidence using only safe local and Render CLI metadata. This slice consolidates what is proven and what remains account-owner/provider-gated.

Verdict: partial/open. The live service, production database resource, current live deploy, and public deep health are safely reverified. Local repository secret scanning remains green through `launch:evidence`. Render CLI v2.13.0 does not expose a safe env-var inventory or rotation metadata command in this session, so live secret key inventory, rotation dates, named rollback/deputy/database recovery owners, and WAF/rate-limit ownership remain open.

This slice did not deploy, restart, SSH, open a production database shell, mutate production data, run DB-mutating E2E, perform credentialed login, or access secret values.

## Command Results

| Command | Result | Evidence summary |
| --- | --- | --- |
| `render ea --help` | Passed | Early-access Render CLI commands available here only include object storage management; no secret-manager or recovery metadata command was exposed. |
| `render env --help` | Failed as capability probe | Render CLI returned `unknown command "env"` and suggested `ea`/`environments`. This confirms the CLI path used here cannot safely list env-var key inventory or rotation metadata. |
| `render services -o json` with sanitized field selection | Passed | Confirmed production datastore `sandbox-hotel-pms-db-v43m` (`dpg-d6ns2d94tr6s73c9hve0-a`) is PostgreSQL 17, primary, `available`, `basic_256mb`, 15 GB, region `oregon`, and `not_suspended`; confirmed target service `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`) is Node, starter plan, region `oregon`, branch `main`, repo `nakalasbakalas/sandbox-pms`, auto deploy `no`, and `not_suspended`. No env values were printed. |
| `render environments prj-d6nm1vdm5p6s7398qg70 -o json` with sanitized field selection | Passed | Production environment `evm-d6nm1vdm5p6s7398qg7g` reports `protectedStatus=unprotected`, `networkIsolationEnabled=false`, and IP allow list `0.0.0.0/0`. |
| `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` with sanitized field selection | Passed | Latest long-term custom-domain service deploy remains `dep-d8i4q3favr4c73afbrg0`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`. |
| Public `GET https://book.sandboxhotel.com/healthz?deep=1` | Passed | Returned `200`, `ok=true`, production environment, database configured, database OK, and `lineWebhookConfigured=false` at `2026-07-03T00:43:45.079Z`. |

## Proven Current State

- The production database resource is available and not suspended according to Render CLI metadata.
- The target custom-domain service is not suspended and still points at the known older live deploy.
- The public deep-health endpoint reports production database connectivity OK.
- No production secret values, raw database URLs, passwords, tokens, cookies, or screenshots were recorded.
- The local repository/evidence secret scan is covered by the slice validation command `npm.cmd run launch:evidence`.

## Still Not Proven

- Redacted Render secret key inventory.
- Secret creation/update/rotation dates or owner-confirmed rotation status.
- Cleanup decision for legacy/compatibility env keys, with rollback impact reviewed.
- Primary rollback owner with Render dashboard access.
- Rollback deputy with Render dashboard access.
- Database recovery owner with Render PostgreSQL access.
- Latest recovery point/retention evidence refreshed from Render dashboard or API.
- WAF/rate-limit owner, rule IDs, thresholds, protected hostnames, and owner-approved non-destructive test result.

## Next Closure Path

Collect owner/provider evidence without values: Render secret-manager export or screenshot with values redacted, named recovery/rollback owners, latest recovery-point metadata, and Cloudflare/upstream WAF/rate-limit rule metadata. Do not paste raw secret values, raw database URLs, tokens, passwords, cookies, or screenshots containing secrets into the repo.
