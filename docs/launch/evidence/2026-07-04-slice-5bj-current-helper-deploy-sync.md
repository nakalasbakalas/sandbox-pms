# Slice 5BJ - Current Helper Deploy Sync

Date: 2026-07-04

## Verdict

Status: partial/open. The current green `main` helper commit is now deployed and publicly healthy on the custom-domain Render service. Booking Email capture/backfill remains blocked because Render still has no supported backend Gmail OAuth credential path.

## Target

- Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`)
- Public host: `https://book.sandboxhotel.com`
- Deployed commit: `04d06d3351fa02154e258a35b84a379dd219db22` (`Add Gmail OAuth Render handoff helper`)
- Deploy ID: `dep-d944ml4vikkc73bido10`

## Checks

| Check | Result | Notes |
| --- | --- | --- |
| GitHub CI | Passed | Run `28688152726` passed for `04d06d3351fa02154e258a35b84a379dd219db22`, including lint, typecheck, business tests, E2E smoke, build, and launch gate. |
| Render deploy | Live | `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit 04d06d3351fa02154e258a35b84a379dd219db22 --wait --confirm --output json` returned live deploy `dep-d944ml4vikkc73bido10`, finished `2026-07-03T23:55:30Z`. |
| Public edge proof | Passed | `npm.cmd run public-edge:proof` at `2026-07-03T23:55:52.008Z` returned `200` for `/healthz?deep=1`, production environment, database configured/OK, Cloudflare headers, Render origin header, common security headers, and `404` for selected common unwanted paths. Response bodies were omitted except bounded health fields. |
| Live readiness | Passed | `npm.cmd run live:check` passed; DNS lookup resolved `book.sandboxhotel.com` to `216.24.57.8`; LINE remains optional/unconfigured. |
| Production preflight | Passed with expected warning | `npm.cmd run prod:preflight` passed with LINE credentials not configured. |
| Setup-complete reprobe | Passed expected denial | Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and `Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.` |
| Render Gmail OAuth status | Missing | `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` at `2026-07-03T23:55:49.692Z` reported all supported booking-specific and fallback Gmail credential paths `ready=false`; values and Render auth token were omitted. |
| Local OAuth input presence | Missing | No local process values were present for supported booking-specific/fallback Gmail OAuth keys or `RENDER_API_KEY`. Values were not printed. |
| Gmail OAuth handoff helper without client id | Guarded failure | `npm.cmd run gmail-oauth:render` exited before URL generation because no `BOOKING_EMAIL_GMAIL_CLIENT_ID` or `GMAIL_CLIENT_ID` was present. No values were printed or applied. |
| Booking Email proof job | Succeeded | Render one-off job `job-d944o5ojs32c73dk9gog` ran `npm run booking-email:proof` on the current service and succeeded at `2026-07-03T23:56:37Z`. |
| Historical backfill | Not run | Dry-run historical backfill still requires backend Gmail OAuth to be configured first. The latest prior dry-run backfill job remains `job-d9446csvikkc73bh3ba0`, which failed while OAuth was missing. |

## Boundary

No mailbox password, Gmail OAuth value, Render auth token, authorization code, message body, sender, recipient, subject, guest data, payment data, booking detail, production database shell, confirmed import, credentialed PMS login, WAF mutation, or provider setting change was recorded in this slice.

This slice closes live deploy drift for the current helper commit. It does not close launch sign-off or Booking Email capture/backfill.
