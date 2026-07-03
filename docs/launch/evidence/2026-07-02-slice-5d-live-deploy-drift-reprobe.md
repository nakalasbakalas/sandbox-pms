# Slice 5D - Live Deploy Drift And Setup-Gate Reprobe

Date: 2026-07-02.

Scope: refresh read-only Render deploy metadata and unauthenticated live setup-gate behavior after the local setup-completion hardening. This slice did not deploy, restart, SSH, open a database shell, mutate production data, send credentials, or access secret values.

## Commands

| Command | Result | Notes |
| --- | --- | --- |
| `git rev-parse HEAD; git rev-parse origin/main; git status --short` | Passed | Local `HEAD` and `origin/main` were both `2ba7410e4684697237bf14980544a4084775821c`; the working tree had 8 changed/untracked status lines. |
| `render deploys list srv-d6ns31h4tr6s73c9i8g0 -o json` | Passed | Long-term custom-domain service `sandbox-hotel-pms-v43m` latest deploy is `dep-d8i4q3favr4c73afbrg0`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-06T16:39:42.109323Z`. |
| `render deploys list srv-d8bchr1akrks73disaog -o json` | Passed | Alternate service `sandbox-hotel-pms` latest deploy is `dep-d8ekph4p3tds738mdp6g`, status `live`, commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6`, finished `2026-06-01T09:13:20.6391Z`. |
| `LIVE_EXTRA_URLS=https://sandbox-hotel-pms.onrender.com,https://sandbox-hotel-pms-v43m.onrender.com npm.cmd run live:check` | Passed | Public live readiness check passed for `https://book.sandboxhotel.com`, `https://sandbox-hotel-pms.onrender.com`, and `https://sandbox-hotel-pms-v43m.onrender.com`; all reported `lineWebhookConfigured=false`, which remains optional unless LINE is required. |
| `node` fetch probe for `GET https://book.sandboxhotel.com/api/setup/status` | Passed | Returned `200` with `needsSetup=false`, `hasProperty=true`, `hasUsers=true`, and `propertyName=SANDBOX HOTEL`. |
| `node` fetch probe for unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with body `{}` | Passed as probe; blocker confirmed | Returned `400` with error `Add at least one room type.` This is still payload validation rather than completed-setup rejection, so the current-checkout setup-gate hardening is not proven live. |
| `npm.cmd run launch:evidence` | Passed | Found 9 launch evidence files, no unredacted secret-shaped values in launch evidence docs, and no high-confidence unredacted production secret-shaped values in 438 tracked/unignored text files. |
| `git diff --check` | Passed | Exited 0. Git printed LF-to-CRLF working-copy warnings only; no whitespace errors were reported. |

## Evidence Decision

Live health is green, but both Render services remain on older commit `7adcc01c609f5a6b9789d8de08e48e48651c5ae6` while local `origin/main` is `2ba7410e4684697237bf14980544a4084775821c`.

The live setup-complete probe still returns room-type payload validation even though setup status reports existing users and property. This confirms the live public site does not yet demonstrate the current-checkout completed-setup hardening.

## Remaining P0 Blockers

- Live setup-completion hardening still needs approved deploy/reprobe evidence.
- Production users/auth/RBAC/logout proof remains open.
- Real production room inventory proof remains open.
- Core hotel workflow proof remains open.
- Live provider secret inventory/rotation metadata and recovery ownership proof remain external/account-owner evidence gaps.
- Rollback owner/deputy, database recovery owner, and WAF/rate-limit rule evidence remain unproven.

## Next Recommended Slice

Publish/deploy the current checkout through the approved branch/PR/deploy path, then rerun the unauthenticated setup-complete probe against `https://book.sandboxhotel.com`. Do not mark the setup-gate hardening live until the deployed commit matches the hardening commit or equivalent provider evidence exists.
