# 2026-07-06 Owner, Provider, And Manual Decisions

Status: partial progress; not launch sign-off.

This evidence note records owner answers received on 2026-07-06 and the engineering decisions made from them. It contains no passwords, cookies, API tokens, database URLs, guest data, payment data, or raw mailbox content.

## Owner Answers Recorded

Approved production launch users:

| User label | Launch role | Active status | Email posture |
| --- | --- | --- | --- |
| Nick | `ADMIN` | To be verified in production | Email may be null if intentionally configured that way. |
| Hui | `ADMIN` | To be verified in production | Email may be null if intentionally configured that way. |
| Hotel Manager | `MANAGER` | To be verified in production | Email may be null if intentionally configured that way. |
| Front Desk | `FRONT_DESK` | To be verified in production | Email may be null if intentionally configured that way. |

Required launch roles now: `ADMIN`, `MANAGER`, and `FRONT_DESK`. `HOUSEKEEPING`, `CASHIER`, and `CAFE_STAFF` remain non-launch-required roles unless Nick later expands launch scope.

First-run setup posture: setup should be available only after the app is manually restored to default by the owner. After setup completion, it must not relaunch until the owner manually restores the app to default again.

Staff password policy: three failed login attempts lock the account; an admin password reset clears the lock.

Provider ownership: Nick owns Cloudflare, Render, Gmail/OAuth, database backups, and emergency recovery during launch.

Database backup posture: latest confirmed backup/recovery point is unknown and must be set up or freshly verified before final sign-off.

Room inventory posture: Nick confirms the current production room inventory is real. The app still needs future in-app room mapping/customization improvements so admins can maintain inventory directly.

Manual acceptance owner: Nick will test dashboard routes on desktop and tablet.

Language review: Thai and English labels require both owner and hotel-staff review.

Demo/sample cleanup: all demo/test/sample labels, rooms, guests, prices, and messages must be removed before sign-off.

Final authority: Nick has go/no-go authority and may accept known risks in writing.

## Expert Decisions Applied

- Production denial probes: run only non-mutating `GET`/`HEAD` denial probes in production. Mutating underprivileged denial probes stay local/staging unless Nick explicitly approves a no-op or invalid payload and records the approval.
- DB E2E proof: local disposable DB-mutating E2E is acceptable for launch engineering proof. Staging DB-mutating E2E is optional unless Nick later requires it. Production DB-mutating E2E remains forbidden.
- Booking Inbox: imported Booking Email Events remain review-only until Nick and hotel staff review parser output and accept quality. No booking, cancellation, payment, or guest-message change should auto-apply from imported email without staff approval.
- Required launch workflows: reservations, Booking Inbox, guest replies, staff/users, rooms/rates, payments/folios, housekeeping status, reports, and Hotel Ops read/draft/approval-gated paths.
- Issue closure: close launch issues only after redacted proof is posted and Nick records final owner approval or accepted-risk sign-off on the issue. Do not close from local-only proof or docs alone.

## Implementation Progress

- Added persistent user lockout fields in Prisma migration `20260706153000_user_login_lockout`.
- Implemented three-failure account lockout in `authenticateUser`.
- Admin password reset through `updateUser` clears `failedLoginAttempts` and `lockedAt`.
- API user payloads and User Management UI now surface a locked status without exposing password or hash data.

## Tool And Provider Boundaries

- Chrome connector proof was attempted for credentialed browser testing, but the connector setup call timed out twice before a usable browser session was exposed. No credentialed Chrome production proof was collected in this slice.
- Cloudflare connector/tool discovery did not expose callable Cloudflare action tools in this session. The repo helper `npm.cmd run cloudflare:waf:proof` remains the approved proof path when Nick supplies a Cloudflare token and zone ID in an owner shell.
- No production secret values were requested, printed, or committed.

## Remaining Launch Gaps

- Create or verify the approved production users, including role, active status, and whether email is intentionally null.
- Run credentialed production login/logout proof for each required role.
- Record non-mutating underprivileged production denial proof, and only run mutating denial probes in staging/local unless separately owner-approved.
- Freshly verify Render database backup/recovery point and retention, then record recovery proof.
- Record Cloudflare WAF/rate-limit rule IDs, thresholds, protected hostnames, and non-destructive test result.
- Complete Nick's manual desktop/tablet workflow pass and staff plus owner Thai/English label review.
- Remove or prove absence of demo/test/sample labels, rooms, guests, prices, and messages before sign-off.
