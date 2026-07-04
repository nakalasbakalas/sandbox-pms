# Slice 5BS - Current Main Render Deploy Sync

Status date: 2026-07-04.

Verdict: partial P0 progress. Current green `main` is now deployed to the long-term Render service and the public setup gate still denies unauthenticated first-run setup. This does not close launch sign-off because owner/provider evidence and backend Gmail OAuth remain open.

## Scope

- Deployed exact commit `e348fd6d076b2bf094dca1c77c372a2bbed612c4` to `sandbox-hotel-pms-v43m`.
- Reprobed public setup completion, deep health, public-edge posture, and redacted Render Gmail OAuth key presence.
- No OAuth client secret, authorization code, access token, refresh token, Render token, Gmail body, attachment, message id, guest data, payment data, confirmed booking-email import, WAF mutation, production database shell, or DB-mutating E2E was used or recorded.

## Evidence

| Check | Result | Notes |
| --- | --- | --- |
| Source commit CI | Passed | GitHub CI run `28701971403` passed for `e348fd6d076b2bf094dca1c77c372a2bbed612c4`: lint, typecheck, business tests, E2E smoke, build, and launch gate. |
| Render deploy | Live | `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit e348fd6d076b2bf094dca1c77c372a2bbed612c4 --wait --confirm -o json` returned deploy `dep-d94daaflk1mc73b1m6m0`, status `live`, finished `2026-07-04T09:43:28.291471Z`. |
| Public setup-complete reprobe | Closed | `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and the expected production-disabled setup message. |
| Deep health | Green | `GET https://book.sandboxhotel.com/healthz?deep=1` returned `ok=true`, `environment=production`, and database configured/OK at `2026-07-04T09:43:42.591Z`. |
| Public edge proof | Green with WAF boundary | `npm.cmd run public-edge:proof` completed at `2026-07-04T09:43:55.241Z`; `/healthz?deep=1` returned `200`, Cloudflare and Render origin headers were present, selected common unwanted paths returned `404`, and response bodies were omitted except bounded health fields. This is not WAF/rate-limit rule proof. |
| Render Gmail OAuth status | Still not ready | `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` at `2026-07-04T09:43:42.829Z` reported `BOOKING_EMAIL_PRIMARY_MAILBOX` and `BOOKING_EMAIL_GMAIL_USER_ID` present, but every supported access-token and refresh-token credential path still missing; overall `ready=false`; values were omitted. |
| Launch evidence inventory | Passed | `npm.cmd run launch:evidence` passed at commit `e348fd6d076b2bf094dca1c77c372a2bbed612c4` with dirty entries `0` before this docs update and no high-confidence production secret findings in `514` tracked/unignored text files. |

## Boundary

This slice closes the current repo/runtime drift for the public Render service. It does not prove:

- Owner-configured backend Gmail OAuth or historical booking-email backfill.
- Credentialed production user login/logout, role matrix, or underprivileged denial.
- Owner-approved real room inventory source and not-fake-seed confirmation.
- Owner acceptance of local disposable DB workflow proof or staging proof.
- Provider secret inventory/rotation, named recovery/rollback owners, latest recovery point, or WAF/rate-limit rule IDs.
