# 2026-07-07 Final Production Review

## Scope

Final production review and hardening pass for the current local checkout on `main`.

- Local HEAD before this review patch: `a992a764abc6f574015e5aadc85244698ff66b47`
- GitHub repository: `nakalasbakalas/sandbox-pms`
- Production public host checked: `https://book.sandboxhotel.com`
- Review boundary: no live production mutations were performed. Database mutations were limited to local `localhost` dev/E2E databases.

## Changes Made

- Added a root npm override for `js-yaml@4.2.0`, replacing the transitive `js-yaml@4.1.1` audit finding pulled through ESLint tooling.
- Refreshed launch/readiness documentation so README, launch checklist, live-environment proof, and dependency plan match the July 7 owner-directed completion state.
- Applied pending local migration `20260706153000_user_login_lockout` to the local dev and guarded local E2E databases so local database validation reflects the current schema.

## Validation Results

Local checks passed:

- `npm.cmd install`
- `npm.cmd audit --audit-level=high`
- `npm.cmd ls js-yaml`
- `npm.cmd run db:generate`
- `npx.cmd prisma validate`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd test`
- `npm.cmd run test:e2e`
- `npm.cmd run db:migrate`
- `ALLOW_DB_E2E=true npm.cmd run db:e2e:ready`
- `ALLOW_DB_E2E=true npm.cmd run test:e2e:db`
- `npm.cmd run db:doctor`
- `npm.cmd run launch:check`
- `npm.cmd run prod:preflight`
- `npm.cmd run render:validate`
- `npm.cmd run launch:evidence`
- `git diff --check`

Live/read-only checks passed:

- `npm.cmd run live:check`
- `npm.cmd run public-edge:proof`
- `https://book.sandboxhotel.com/healthz`
- `https://book.sandboxhotel.com/healthz?deep=1`

Provider/repository checks:

- GitHub Actions CI for `a992a764abc6f574015e5aadc85244698ff66b47`: success, run `28839158990`.
- GitHub open issues: none returned by `gh issue list --state open`.
- Render Gmail OAuth status: `ready: true` using the booking-specific refresh-token tuple; values were omitted by the proof helper.
- Cloudflare WAF proof: not complete. The read-only helper failed safe because no local `CLOUDFLARE_API_TOKEN` or `CF_API_TOKEN` was available.

## Residual Risks

- Cloudflare WAF/rate-limit rule metadata remains provider-gated until the owner supplies a local token for `npm.cmd run cloudflare:waf:proof`.
- Latest Render backup/recovery metadata and role-by-role credentialed production auth proof remain owner/provider proof items, not locally verifiable facts.
- Staff Booking Inbox parser review and Thai/English operational label review remain human acceptance items.
- LINE and WhatsApp live messaging are disabled in production preflight; this is acceptable only if they are intentionally out of current launch scope.
- The live health endpoint does not expose deployed commit metadata, so this review verifies live health and GitHub CI separately rather than proving the exact live commit from `/healthz`.

## Verdict

Engineering checks are green after the dependency override and local migration refresh. The system is production-deployable under the already documented owner-accepted external-provider risk boundary, but it is not independently launch-perfect until Cloudflare WAF proof, backup/recovery metadata, credentialed production auth proof, and staff acceptance items are completed.
