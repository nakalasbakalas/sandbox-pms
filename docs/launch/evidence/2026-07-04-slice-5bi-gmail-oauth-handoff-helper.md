# Slice 5BI - Gmail OAuth Handoff Helper

Date: 2026-07-04

## Verdict

Status: partial/open. This slice adds a secret-safe local handoff helper for creating a booking-mailbox Gmail OAuth refresh token and applying it directly to Render, but it does not configure production Gmail OAuth by itself. Booking Email capture/backfill remains blocked until the owner runs the helper with real OAuth client values, authorizes `booking@sandboxhotel.com`, redeploys the Render service, and a dry-run historical backfill passes.

## What Changed

- Added `npm.cmd run gmail-oauth:render`.
- Default mode generates a Google OAuth consent URL for the booking mailbox with offline access and readonly Gmail scope.
- Exchange mode accepts a locally pasted authorization code through stdin and can apply the resulting refresh-token tuple directly to Render with `--apply-render`.
- Output redacts the authorization code, client secret, access token, refresh token, and Render auth token.
- Gmail send scope remains opt-in through `--include-send-scope`.

## Checks

| Check | Result | Notes |
| --- | --- | --- |
| Fixture consent URL | Passed | `BOOKING_EMAIL_GMAIL_CLIENT_ID=client-id-fixture npm.cmd run gmail-oauth:render` generated a consent URL, redaction metadata, readonly Gmail scope, and no token values. |
| Business tests | Passed | `npm.cmd test` passed and now covers consent URL construction, offline access, readonly default scope, opt-in send scope, authorization-code token exchange, and provider-error redaction. |
| Lint | Passed | `npm.cmd run lint` passed after adding the required Node global declarations for the new helper. |
| Typecheck | Passed | `npm.cmd run typecheck` passed. |
| Launch evidence inventory | Passed | `npm.cmd run launch:evidence` passed and found no unredacted secret-shaped values in launch evidence docs or high-confidence unredacted production secret-shaped values in tracked/unignored text files. |
| Whitespace check | Passed | `git diff --check` passed. |
| Render mutation | Not run | No real OAuth client secret, authorization code, refresh token, or Render env mutation was requested or available in this session. |
| Historical backfill | Not run | Dry-run backfill still requires backend Gmail OAuth to be configured on Render first. |

## Owner Flow

From a secure local shell with the approved Google OAuth client id and client secret in process environment:

```powershell
npm.cmd run gmail-oauth:render
$authCode = Read-Host 'Paste Gmail OAuth authorization code'
$authCode | npm.cmd run gmail-oauth:render -- --exchange-code --code-stdin --apply-render --use-render-cli-token
npm.cmd run render:gmail-oauth:status -- --use-render-cli-token
```

After the Render status reports one supported credential path `ready=true`, redeploy the service and run a dry-run historical scan before any confirmed import:

```powershell
npm.cmd run booking-email:backfill -- --all-past --limit 250
```

Confirmed import remains review-only and must be followed by staff review in `/booking-inbox`.

## Boundary

No mailbox password, Gmail OAuth value, Render auth token, authorization code, message body, sender, recipient, subject, guest data, payment data, or booking details were recorded in this slice.
