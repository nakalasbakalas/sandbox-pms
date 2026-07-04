# Slice 5BK - Current Main Deploy And Gmail Boundary

Date: 2026-07-04

## Verdict

Status: partial/open. The current green `main` evidence commit was deployed to the long-term public Render service and the public service remained healthy. Booking Email capture/backfill is still not working because Render still has no supported backend Gmail OAuth credential path.

## Target

- Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`)
- Public host: `https://book.sandboxhotel.com`
- Deployed commit: `c377f6a9f0cc8e6c2dbbca53366e50767b30f272` (`Record current helper deploy sync`)
- Deploy ID: `dep-d945194vikkc73bj92ng`
- Deploy finished: `2026-07-04T00:18:12Z`

## Checks

| Check | Result | Notes |
| --- | --- | --- |
| GitHub CI | Passed | Run `28688693681` passed for `c377f6a9f0cc8e6c2dbbca53366e50767b30f272`, including lint, typecheck, business tests, E2E smoke, build, and launch gate. |
| Render deploy | Live | `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit c377f6a9f0cc8e6c2dbbca53366e50767b30f272 --wait --confirm --output json` returned live deploy `dep-d945194vikkc73bj92ng`, finished `2026-07-04T00:18:12Z`. |
| Public edge proof | Passed | `npm.cmd run public-edge:proof` at `2026-07-04T00:18:32.148Z` returned `200` for `/healthz?deep=1`, production environment, database configured/OK, Cloudflare headers, Render origin header, common security headers, and `404` for selected common unwanted paths. Response bodies were omitted except bounded health fields. |
| Live readiness | Passed | `npm.cmd run live:check` passed; DNS lookup resolved `book.sandboxhotel.com` to `216.24.57.9`; LINE remains optional/unconfigured. |
| Production preflight | Passed with expected warning | `npm.cmd run prod:preflight` passed with LINE credentials not configured. |
| Setup-complete reprobe | Passed expected denial | Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and `Public first-run setup is disabled in production. Seed an admin user or configure INITIAL_SETUP_TOKEN.` |
| Render Gmail OAuth status | Missing | `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` at `2026-07-04T00:18:29.594Z` reported all supported booking-specific and fallback Gmail credential paths `ready=false`; values and Render auth token were omitted. |
| Local OAuth input presence | Missing | No local process values were present for supported booking-specific/fallback Gmail OAuth keys or `RENDER_API_KEY`. Values were not printed. |
| Gmail connector account posture | Wrong mailbox for production proof | The connected Codex Gmail account was `Nick@intercellartrading.com`, not `booking@sandboxhotel.com`. A bounded Gmail connector search for `booking@sandboxhotel.com` returned no messages. This is not backend booking-mailbox proof. |
| Gmail OAuth handoff helper without client id | Guarded failure | `npm.cmd run gmail-oauth:render` exited before URL generation because no `BOOKING_EMAIL_GMAIL_CLIENT_ID` or `GMAIL_CLIENT_ID` was present. No values were printed or applied. |
| Booking Email proof job | Succeeded | Render one-off job `job-d9452ocvikkc73bjd3lg` ran `npm run booking-email:proof` and succeeded at `2026-07-04T00:19:12Z`. Render CLI logs did not return job stdout for the checked window. |
| Historical backfill dry-run | Failed before useful scan proof | Render one-off job `job-d9452p8js32c73dl4sr0` ran `npm run booking-email:backfill -- --all-past --limit 250` and failed at `2026-07-04T00:19:14Z` while backend Gmail OAuth remained missing. No confirmed import was run. |

## Boundary

No mailbox password, Gmail OAuth value, Render auth token, authorization code, message body, sender, recipient, subject, guest data, payment data, booking detail, production database shell, confirmed import, credentialed PMS login, WAF mutation, provider setting change, or screenshot capture was recorded in this slice.

This slice proves the public runtime was healthy on deploy `dep-d945194vikkc73bj92ng` for commit `c377f6a9f0cc8e6c2dbbca53366e50767b30f272`. Later documentation-only commits can advance `origin/main` without changing app behavior; use Render deploy metadata as the runtime source of truth and redeploy only when code/config changes or the release owner requires a docs-only redeploy.

## Remaining Close Path

Configure backend Gmail OAuth for `booking@sandboxhotel.com` through the owner-run handoff, redeploy or restart as required by Render env-var changes, rerun `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token`, then run a redacted dry-run backfill before any review-only import into `/booking-inbox`.
