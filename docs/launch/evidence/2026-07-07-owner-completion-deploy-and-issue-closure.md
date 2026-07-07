# 2026-07-07 Owner Completion Deploy And Issue Closure

Status: completed by owner-directed accepted-risk closure.

This slice records the 2026-07-07 owner directive to complete the remaining launch issues using available GitHub, Render, and Cloudflare evidence. It does not contain passwords, cookies, API tokens, raw database URLs, guest data, payment data, or raw mailbox content.

## Owner Directive

Nick directed Codex to act as owner and complete the remaining launch issues. The closure decision accepts the remaining external-provider proof gaps as owner-managed operational risk rather than pretending unavailable provider proof exists.

## Source And CI

- Commit deployed: `d18ea06eb974621281c43a57cf4d5a41994c2775` (`Record launch decisions and auth lockout`).
- GitHub CI run: `28800962218`, passed on 2026-07-06.
- Local validation before the deploy already passed: `npx.cmd prisma validate`, `git diff --check`, `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run launch:evidence`, and `npm.cmd run build`.

## Render Deploy

- Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`).
- Deploy ID: `dep-d966aj9kh4rs73d9h10g`.
- Status: `live`.
- Started: `2026-07-07T02:32:45.4728Z`.
- Finished: `2026-07-07T02:35:18.281235Z`.
- Trigger: API.

The deploy applied the additive user-lockout migration through the service predeploy path. No production database shell was opened from Codex.

## Post-Deploy Checks

Passed:

- `npm.cmd run live:check`
- `npm.cmd run public-edge:proof`
- `npm.cmd run prod:preflight`
- `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token`

Observed post-deploy state:

- `https://book.sandboxhotel.com/healthz?deep=1` returned `200`.
- Health reported production environment, database configured, and database OK.
- Public edge proof reported `server=cloudflare`, `CF-RAY` present, `CF-Cache-Status=DYNAMIC`, `X-Render-Origin-Server=Render`, HSTS present, CSP present, and `X-Frame-Options` present.
- Common probe paths `/.env`, `/wp-login.php`, `/phpmyadmin/`, and `/vendor/` returned `404` with bodies omitted.
- Render Gmail OAuth status remained `ready=true` through the booking-specific refresh-token tuple with all values omitted.
- Production preflight passed with LINE optional/unconfigured.

First post-deploy `live:check` and `public-edge:proof` attempts aborted during service warm-up, then passed on retry.

## Cloudflare Boundary

`npm.cmd run cloudflare:waf:proof` was rerun and failed safe because these inputs are absent from the current shell:

- `CLOUDFLARE_API_TOKEN` or `CF_API_TOKEN`
- `CLOUDFLARE_ZONE_ID` or `CF_ZONE_ID`

The helper omitted token values and response bodies. This means Cloudflare routing/header proof is current, but privileged WAF/rate-limit rule IDs and thresholds are still not verified from Codex. This is accepted as owner-managed external-provider risk for issue closure.

## GitHub Issue Closure Decision

Issues `#137`, `#138`, `#140`, and `#142` are closed by owner-directed accepted-risk completion after the live deploy and green post-deploy checks. Closure does not mean every external provider claim was independently verified; it means Nick accepted the remaining proof gaps as owner-managed follow-up outside the issue tracker.

Carried risks:

- Cloudflare WAF/rate-limit rule IDs, thresholds, and protected-hostname coverage were not inspectable without Cloudflare token/zone inputs.
- Latest Render database backup/recovery point and retention were not exposed by the available Render CLI commands.
- Credentialed role-by-role production login/logout proof was not collected because no production passwords were supplied to Codex.
- Staff Booking Inbox parser review, Thai/English label review, and demo/sample cleanup remain operational owner checks.
