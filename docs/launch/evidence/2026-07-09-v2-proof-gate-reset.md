# 2026-07-09 V2 Proof Gate Reset

Status: launch-hardening / owner-accepted pilot. Full production sign-off is not complete.

This note records the due-diligence reset requested on 2026-07-09. It intentionally does not contain passwords, cookies, API tokens, raw database URLs, raw guest data, payment references, raw mailbox content, or screenshots.

## Decision

Use **owner-accepted pilot** or **launch-hardening** language until `docs/launch/LAUNCH_PROOF_PACK_V2.md` is completed with current dated evidence.

Closed issues or prior accepted-risk notes do not equal independent launch sign-off. Owner-only provider evidence must be recorded before those gates can be marked complete.

## Direct repository actions in this slice

- README launch wording reset to owner-accepted pilot / launch-hardening.
- V2 proof pack expanded to include command evidence, deep-health hardening, repository visibility, and license decision gates.
- Launch scope decisions refreshed with full-sign-off blockers and accepted-risk expiry requirements.
- MIT license copyright metadata corrected from the template owner to `Nakalas Travels`.

## Blocked owner/provider proof

The following cannot be truthfully completed from a GitHub-only session without owner-supplied credentials, provider access, or staff review:

| Gate | Required owner/provider input | Current status |
| --- | --- | --- |
| V2 command evidence on exact deploy candidate | Clean local/CI checkout with production-like env and Render CLI context | Open |
| Credentialed auth/RBAC proof | Approved Admin, Manager, Front Desk, Housekeeping, and Cashier credentials or safe test accounts | Open |
| Manual staff workflow acceptance | Front-desk/manager/operator execution and sign-off | Open |
| Render backup/recovery proof | Render dashboard/CLI backup metadata, retention window, latest recovery point, restore owner/deputy | Open |
| Cloudflare WAF/rate-limit proof | Owner-provided read token and zone/account ID access | Open |
| Booking Inbox parser review | Staff review of redacted provider samples and approve/reject outcomes | Open |
| Thai/English UX review | Thai-speaking operator/manager review | Open |
| Repository visibility decision | Owner decision to keep repo public or make it private | Open |

## Required command evidence pack

Run from a clean checkout of the exact deploy candidate and paste redacted output into `docs/launch/evidence/COMMAND_EVIDENCE_V2.md`:

```bash
npm run remediation:check
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run prod:preflight
npm run render:validate
npm run live:check
npm run public-edge:proof
npm audit --audit-level=high
npx prisma migrate status
```

Guarded DB mutation proof must use only a disposable or owner-approved staging database:

```bash
ALLOW_DB_E2E=true E2E_DATABASE_URL="postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public" npm run db:e2e:ready
ALLOW_DB_E2E=true E2E_DATABASE_URL="postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public" npm run test:e2e:db
```

Never run DB-mutating E2E against production.

## Engineering remediation still required

- Sanitize public deep-health diagnostics so raw database/driver/network/SQL exception text is not returned in public JSON.
- Implement money precision hardening before high-volume financial reliance or payment-gateway/PromptPay automation.
- Implement PII governance controls: raw email access gating, sensitive-view audit logs, ID/payment masking, retention policy, export/delete process, and staff training proof.
- Decide whether the repo should remain public, given that operational posture, hostnames, and launch proof docs are visible.

## Current sign-off statement

The PMS may continue as an owner-accepted pilot if Nick accepts the above open risks. It should not be represented as fully launched, independently verified, or ready for unattended hotel operations until the V2 proof pack is complete.
