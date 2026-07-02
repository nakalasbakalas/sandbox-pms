# Slice 5J - Read-Only Render And Live Refresh

Date: 2026-07-02T07:14Z.

Scope: refresh Render service metadata and live public setup behavior after PR #150 reached green CI. This slice did not deploy, restart, SSH, open a database shell, mutate production data, run DB-mutating E2E against production, or access secret values.

## Commands

| Command | Result | Notes |
| --- | --- | --- |
| `render --version` | Passed | Render CLI v2.13.0. |
| `render whoami -o json` | Passed | Authenticated as the expected Render account. No secret values were printed. |
| `render services -o json` | Passed | Confirmed Sandbox PMS services are present and not suspended. |
| `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Long-term custom-domain service latest deploy remains `dep-d8i4q3favr4c73afbrg0`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`. |
| `render deploys list srv-d8bchr1akrks73disaog -o json` | Passed | Alternate service latest deploy remains `dep-d8ekph4p3tds738mdp6g`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-01T09:13:20.6391Z`. |
| `render deploys list srv-d8clkqho3t8c73a1eldg -o json` | Passed | Launch service latest deploy remains `dep-d8oh74m47okc739vhq2g`, status `live`, commit `5f5b54162156a658bd37ec4c2d00941feea8d037`, finished `2026-06-16T09:13:59.052325Z`. This is not the custom-domain production target. |
| `npm.cmd run render:validate` | Passed | Render Blueprint validation returned `valid: true`. |
| `npm.cmd run live:check` | Passed | `https://book.sandboxhotel.com` live readiness check passed; LINE remains optional and unconfigured. |
| `GET https://book.sandboxhotel.com/api/setup/status` | Passed | Returned `200` with `needsSetup=false`, `hasProperty=true`, and `hasUsers=true`. |
| `POST https://book.sandboxhotel.com/api/setup/complete` with `{}` | Passed as blocker reprobe | Returned `400` with `Add at least one room type.`, proving the public site still reaches setup payload validation instead of the PR #150 completed-setup rejection. |
| `gh pr view 150 --json ...` | Passed | Draft PR #150 remains open, mergeable, and green for head `75810c3fbcf73d6f8a790a607beb3bb3b0bf69a0`. |

## Evidence Decision

The Render/live state still does not include the setup-completion hardening from PR #150. The deploy drift is unchanged:

- PR #150 head: `75810c3fbcf73d6f8a790a607beb3bb3b0bf69a0`.
- Current `origin/main`: `f5b0849037a55e2c99a3d781d742ba85d2384d8c`.
- Long-term custom-domain service `sandbox-hotel-pms-v43m`: live on `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`.
- Alternate service `sandbox-hotel-pms`: live on `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`.

`render:validate` and `live:check` are green, but they do not prove the setup gate hardening is live. The unauthenticated setup-complete reprobe confirms the blocker remains open until the reviewed PR head is deployed and reprobed.

## Remaining P0 Blockers

- Live setup-completion hardening still needs review/approval, deployment of the exact reviewed commit, and public unauthenticated setup-complete reprobe.
- Production users/auth/RBAC/logout proof remains open.
- Real production room inventory proof remains open.
- Core hotel workflow proof remains open.
- Live provider secret inventory/rotation metadata and recovery ownership proof remain external/account-owner evidence gaps.
- Rollback owner/deputy, database recovery owner, and WAF/rate-limit rule evidence remain unproven.

## Next Recommended Slice

Review/approve PR #150 or explicitly decide whether to keep it draft. After approval, deploy the exact reviewed commit to `sandbox-hotel-pms-v43m` and rerun the unauthenticated setup-complete probe against `https://book.sandboxhotel.com`.
