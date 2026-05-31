# Upstream WAF And Rate-Limit Plan

The app already enforces login throttling in `server/login-throttle.mjs`. Upstream controls add a second protection layer and must be configured in the account that owns the public edge for `book.sandboxhotel.com`.

## Current Confirmed State

- `https://book.sandboxhotel.com` returns Cloudflare and Render edge headers.
- No `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN`, `CF_ACCOUNT_ID`, or `CF_ZONE_ID` is present in the local shell.
- Wrangler is not installed locally.
- Therefore, customer-owned Cloudflare WAF/rate-limit rules were not created or verified from this repo session.

## Required Rules

Configure equivalent upstream rules in Cloudflare or the active edge provider:

| Rule | Scope | Suggested action |
| --- | --- | --- |
| Login rate limit | `POST /api/auth/login` | Challenge or block excessive requests per IP over a short window. |
| API abuse limit | `/api/*` except `/api/health` | Challenge or throttle excessive request bursts. |
| Common probe block | `/.env`, `/wp-*`, `/phpmyadmin*`, `/vendor/*` | Block. |
| Managed WAF | `book.sandboxhotel.com` | Enable managed rules appropriate for a Node/React application. |

Exact thresholds should be set by the edge account owner based on expected staff concurrency. Do not set thresholds so low that normal front-desk use is blocked during check-in/check-out peaks.

## Required Evidence

Record in [live-environment-proof.md](live-environment-proof.md):

- Edge provider.
- Zone/account.
- Rule IDs.
- Protected hostnames.
- Thresholds and actions.
- Date/time of a non-destructive test.
- Tester.

Do not store API tokens or provider secrets in this repo.
