# 2026-07-03 Slice 5AZ - Owner Response Intake And Setup-Gate Reprobe

Status: partial. The setup-gate deployment approval/proof item is closed for the current public deploy. The remaining production users, real room inventory, workflow acceptance, secrets/recovery, rollback, and WAF/rate-limit items are still evidence requests and are not closed by this intake.

## Scope

- Tester: Codex in local checkout `D:\sandbox-pms`.
- Owner input source: current Codex chat on 2026-07-03.
- Scope: record owner approval for PR #150 / exact reviewed commit deployment, verify the current Render deploy ID, reprobe public setup-complete behavior, and classify the rest of the supplied launch questions as open evidence requirements.
- No production credentialed login, database shell, production database mutation, secret-value access, screenshot capture, WAF change, or provider setting mutation was performed.

## Owner Response Intake

| Area | Supplied response | Evidence decision |
| --- | --- | --- |
| Setup-gate deployment approval | Owner approved PR #150 or exact commit `fbc303136253a9785446d601d5532b6efc523b8f` for deployment to `sandbox-hotel-pms-v43m`. | Closed after live deploy and public reprobe below. |
| Setup-gate deploy ID and reprobe | Codex supplied current deploy ID and observed public result after reprobe. | Closed for the current public deploy. |
| Production users/auth/RBAC/logout | The intake restates required redacted proof: approved user table, credentialed login/logout per role, underprivileged denial role/test, and bootstrap/setup-token retention or rotation decision. No actual redacted user table or credentialed role proof was supplied. | Open. |
| Real room inventory | The intake restates required redacted proof: approved source of truth, aggregate room counts/status, and confirmation data is not fake seed/demo data. No aggregate production room counts or owner-approved source proof was supplied. | Open. |
| Core workflow acceptance and DB-mutating E2E | The intake asks for the decision between accepting local disposable proof or requiring staging. No explicit accept-local or require-staging decision was supplied. | Open. |
| Secrets, recovery, rollback, WAF | The intake restates required redacted proof: secret key inventory/status, rollback and recovery owners, latest recovery point/retention, WAF/rate-limit rule metadata, and legacy key decisions. No provider inventory, owner assignments, recovery metadata, or rule IDs were supplied. | Open. |

## Current Deploy Proof

- `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` initially hit a transient DNS lookup failure for `api.render.com`; `Resolve-DnsName api.render.com` then resolved through Cloudflare and a retry succeeded.
- Current live Render deploy: `dep-d93ordnaqgkc73cd2ke0`.
- Current live commit: `1c493116b7eb84ab010097903ff641cd526d8cb6` (`Clarify current deploy sync status`).
- Previous deploy `dep-d93oli7aqgkc73ccodv0` is deactivated.
- PR #150 merge deploy `dep-d93nr7nlk1mc739ldujg` is deactivated, but the setup-gate hardening remains included in the current live commit.

## Public Reprobe

Timestamp: 2026-07-03T10:34Z.

| Probe | Result | Notes |
| --- | --- | --- |
| `GET https://book.sandboxhotel.com/healthz?deep=1` | `200` | `ok=true`, `environment=production`, database configured and OK, `Server: cloudflare`, `CF-RAY` present, `x-render-origin-server: Render`. |
| `GET https://book.sandboxhotel.com/api/setup/status` | `200` | `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, `propertyName=SANDBOX HOTEL`, `setupTokenRequired=false`. |
| `POST https://book.sandboxhotel.com/api/setup/complete` with `{}` | `403` | `Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.` |

The public setup-complete route rejects completed production setup before setup-payload validation. This confirms the setup-gate deployment blocker is closed for the current public deploy.

## Remaining Open Evidence

- Production users/auth/RBAC/logout: still needs a redacted approved user table, credentialed login/logout proof per role, underprivileged denial proof, and bootstrap/setup-token rotation/retention decision.
- Real room inventory: still needs owner-approved source proof and aggregate room type/status counts proving the data is not fake seed/demo inventory.
- Core workflows and DB-mutating E2E: local disposable DB proof exists, but the owner still needs to explicitly accept local-only proof or require staging/controlled production-like evidence.
- Secrets/recovery/rollback/WAF: still needs redacted provider key inventory/status, rollback owner/deputy, database recovery owner, latest recovery point/retention evidence, WAF/rate-limit rule IDs/thresholds/actions, non-destructive test result, and legacy key cleanup decisions.

## Issue Closure Decision

Do not close launch issues #136, #137, #138, #140, or #142 from this intake. Only the setup-gate deployment/reprobe sub-blocker is closed. The remaining P0 launch blockers require the redacted proof listed above or explicit accepted-risk sign-off.
