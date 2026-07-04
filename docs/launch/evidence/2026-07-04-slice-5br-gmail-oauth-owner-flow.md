# Slice 5BR - Gmail OAuth Owner Flow Helper

Status date: 2026-07-04.

Verdict: partial P0 progress. This slice improves the owner-run backend Gmail OAuth setup path, but it does not configure Render Gmail OAuth by itself and does not import booking emails.

## Scope

- Added support for a local Google OAuth client JSON file in `npm.cmd run gmail-oauth:render`.
- Added optional local callback capture with `--listen` so an owner can authorize `booking@sandboxhotel.com` from a secure shell without pasting the authorization code into chat, docs, or screenshots.
- Preserved the existing two-step `--exchange-code --code-stdin --apply-render` path.
- No real OAuth client id, client secret, authorization code, access token, refresh token, Render token, Gmail body, attachment, message id, guest data, payment data, Render mutation, deploy, backfill import, or production database mutation was used or recorded.

## Evidence

| Check | Result | Notes |
| --- | --- | --- |
| Current blocker reprobe | Still blocked by missing local OAuth inputs | `npm.cmd run gmail-oauth:render` failed before URL generation because no `BOOKING_EMAIL_GMAIL_CLIENT_ID` or `GMAIL_CLIENT_ID` was present. No values were printed. |
| Existing-token dry-run | Still missing required local tuple | `npm.cmd run render:gmail-oauth` reported missing `BOOKING_EMAIL_GMAIL_CLIENT_ID`, `BOOKING_EMAIL_GMAIL_CLIENT_SECRET`, and `BOOKING_EMAIL_GMAIL_REFRESH_TOKEN`; values were omitted. |
| Render status | Still not ready | `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token` at `2026-07-04T09:18:05.189Z` reported mailbox identity keys present but every supported backend credential path `ready=false`; values were omitted. |
| Gmail connector profile | Correct mailbox | `_get_profile` returned `booking@sandboxhotel.com`. This remains discovery access only, not backend OAuth credentials. |
| Business tests | Passed locally | `npm.cmd test` passed; `scripts/run-business-tests.mjs` now covers Google OAuth client JSON parsing, env/argument override behavior, and local callback capture. |

## Owner Command Shape

Manual-code path:

```powershell
npm.cmd run gmail-oauth:render -- --credentials-file .\.codex\google-oauth-client.local.json
$authCode = Read-Host 'Paste Gmail OAuth authorization code'
$authCode | npm.cmd run gmail-oauth:render -- --credentials-file .\.codex\google-oauth-client.local.json --exchange-code --code-stdin --apply-render --use-render-cli-token
```

Local-callback path:

```powershell
npm.cmd run gmail-oauth:render -- --credentials-file .\.codex\google-oauth-client.local.json --listen --apply-render --use-render-cli-token
```

The credentials file must stay local and untracked. The helper output reports only presence, source, redaction, listener, and apply status; it must not print OAuth secrets or token values.

## Boundary

Booking-email capture/backfill remains open until:

1. One supported backend credential option reports `ready=true` in `npm.cmd run render:gmail-oauth:status -- --use-render-cli-token`.
2. The Render runtime is redeployed or restarted as required by env-var changes.
3. A redacted dry-run `npm.cmd run booking-email:backfill -- --all-past --limit 250` passes.
4. A confirmed review-only import is run only after the aggregate dry-run is accepted.
