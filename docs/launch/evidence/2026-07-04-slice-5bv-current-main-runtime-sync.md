# Slice 5BV - Current Main Runtime Sync

Status date: 2026-07-04.

Verdict: partial P0 progress. Current green `main` commit `d8884884faba8b50cb73c7f827aa4f9871744d4a` is now deployed to the long-term Render service and the public setup gate still denies unauthenticated first-run setup. This keeps source, CI, and runtime synced, but it does not close launch sign-off because backend Gmail OAuth and owner/provider proof remain open.

## Scope

- Deployed exact commit `d8884884faba8b50cb73c7f827aa4f9871744d4a` to `sandbox-hotel-pms-v43m`.
- Reprobed public setup completion, deep health, public-edge posture, live readiness, production preflight, and redacted Render Gmail OAuth key presence.
- No OAuth client secret, authorization code, access token, refresh token, Render token, Gmail body, attachment, message id, guest data, payment data, confirmed booking-email import, WAF mutation, production database shell, or DB-mutating E2E was used or recorded.

## Evidence

| Check | Result | Notes |
| --- | --- | --- |
| Source commit CI | Passed | GitHub CI run `28703308473` passed for `d8884884faba8b50cb73c7f827aa4f9871744d4a`: lint, typecheck, business tests, E2E smoke, build, and launch gate. |
| Launch evidence inventory | Passed | `npm.cmd run launch:evidence` passed on a clean tree at commit `d8884884faba8b50cb73c7f827aa4f9871744d4a` with dirty entries `0` and no high-confidence production secret findings in `518` tracked/unignored text files. |
| Render deploy | Live | `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit d8884884faba8b50cb73c7f827aa4f9871744d4a --wait --confirm -o json` returned deploy `dep-d94e5e7lk1mc73b3oh2g`, status `live`, finished `2026-07-04T10:41:18.349146Z`. |
| Public setup-complete reprobe | Closed | `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and the expected production-disabled setup message at `2026-07-04T10:42:02.831930Z`. |
| Deep health | Green | `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, `environment=production`, and database configured/OK at `2026-07-04T10:42:21.866Z`. |
| Public edge proof | Green with WAF boundary | The first `npm.cmd run public-edge:proof` attempt aborted right after deploy, then a retry completed at `2026-07-04T10:42:23.971Z`; `/healthz?deep=1` returned `200`, Cloudflare and Render origin headers were present, selected common unwanted paths returned `404`, and response bodies were omitted except bounded health fields. This is not WAF/rate-limit rule proof. |
| Live readiness check | Passed | `npm.cmd run live:check` passed against `https://book.sandboxhotel.com`; DNS resolved to a Render edge address and LINE remains optional/unconfigured unless explicitly required. |
| Production preflight | Passed with warning | `npm.cmd run prod:preflight` passed with the expected warning that LINE credentials are not configured and live LINE messaging remains disabled. |
| Render Gmail OAuth status | Still not ready | `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` at `2026-07-04T10:41:40.483Z` reported `BOOKING_EMAIL_PRIMARY_MAILBOX` and `BOOKING_EMAIL_GMAIL_USER_ID` present, but every supported access-token and refresh-token credential path still missing; overall `ready=false`; values were omitted. |

## Boundary

This slice closes the current repo/runtime drift for the public Render service. It does not prove:

- Owner-configured backend Gmail OAuth or historical booking-email backfill.
- Credentialed production user login/logout, role matrix, or underprivileged denial.
- Owner-approved real room inventory source and not-fake-seed confirmation.
- Owner acceptance of local disposable DB workflow proof or staging proof.
- Provider secret inventory/rotation, named recovery/rollback owners, latest recovery point, or WAF/rate-limit rule IDs.
