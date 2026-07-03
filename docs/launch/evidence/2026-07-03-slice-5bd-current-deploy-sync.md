# Slice 5BD - Current Deploy Sync After Gmail OAuth Helper

Date: 2026-07-03

## Verdict

Current green application/helper commit `163d49c2ff58eef5447e93f07d42babbf3b59d58` is deployed and publicly healthy on the custom-domain Render service. The setup-complete production gate still returns the intended `403`. Booking-email capture remains blocked because backend Gmail OAuth env vars are still missing.

## Target

- Render service: `sandbox-hotel-pms-v43m` (`srv-d6ns31h4tr6s73c9i8g0`)
- Public host: `https://book.sandboxhotel.com`
- Commit: `163d49c2ff58eef5447e93f07d42babbf3b59d58` (`Add safe Render Gmail OAuth helper`)
- Render deploy: `dep-d93t86hkh4rs73e0io4g`

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| GitHub CI | Passed | Run `28669196029` completed successfully for commit `163d49c2ff58eef5447e93f07d42babbf3b59d58`. |
| Exact Render deploy | Passed | `render deploys create srv-d6ns31h4tr6s73c9i8g0 --commit 163d49c2ff58eef5447e93f07d42babbf3b59d58 --wait --confirm --output json` returned live deploy `dep-d93t86hkh4rs73e0io4g`, finished `2026-07-03T15:26:55Z`. |
| Deploy list | Passed | `render deploys list srv-d6ns31h4tr6s73c9i8g0 --output json` reported `dep-d93t86hkh4rs73e0io4g` as latest `live`; prior helper deploy `dep-d93sdvl7vvec73dlfdn0` is deactivated. |
| Public deep health | Passed | `GET https://book.sandboxhotel.com/healthz?deep=1` returned `200`, `ok=true`, `environment=production`, database configured/OK, Cloudflare server header, `CF-RAY`, and `X-Render-Origin-Server=Render` at `2026-07-03T15:27:45.025Z`. |
| Setup-complete public reprobe | Passed | Unauthenticated `POST https://book.sandboxhotel.com/api/setup/complete` with empty JSON returned `403` and the production-disabled setup message. |
| Production preflight | Passed with expected warning | `npm.cmd run prod:preflight` passed; LINE credentials remain unconfigured and live LINE messaging remains disabled. |
| Live readiness check | Passed | `npm.cmd run live:check` passed for `https://book.sandboxhotel.com`; LINE remains optional unless `LIVE_REQUIRE_LINE=true`. |
| Local evidence validation | Passed | `git diff --check` and `npm.cmd run launch:evidence` passed after the Slice 5BD status updates; secret hygiene scan found no unredacted secret-shaped values in launch evidence docs and no high-confidence unredacted production secret-shaped values in tracked/unignored text files. |
| Render Gmail OAuth env-var lookup | Missing | Render API returned `404` for `BOOKING_EMAIL_GMAIL_USER_ID`, `BOOKING_EMAIL_GMAIL_ACCESS_TOKEN`, `BOOKING_EMAIL_GMAIL_CLIENT_ID`, `BOOKING_EMAIL_GMAIL_CLIENT_SECRET`, `BOOKING_EMAIL_GMAIL_REFRESH_TOKEN`, and fallback `GMAIL_*` credential names. Values were not printed. |
| Local Gmail OAuth helper dry-run | Passed as missing-input guard | `npm.cmd run render:gmail-oauth` reported missing required `BOOKING_EMAIL_GMAIL_CLIENT_ID`, `BOOKING_EMAIL_GMAIL_CLIENT_SECRET`, and `BOOKING_EMAIL_GMAIL_REFRESH_TOKEN`; values were omitted. |
| Booking-email proof job | Succeeded | Render one-off job `job-d93t9me7r5hc73dohjag` ran `npm run booking-email:proof` and succeeded. Render logs did not return job stdout in this session. |
| Booking-email dry-run backfill job | Failed as expected while credentials are missing | Render one-off job `job-d93t9mdaeets73ehrus0` ran `npm run booking-email:backfill -- --all-past --limit 250` and failed before usable Gmail capture because backend OAuth remains unconfigured. Render logs did not return job stdout in this session. |

## Current Decision

The app runtime and Render deploy are synced to the current green application/helper commit. Later evidence-only commits may advance `origin/main` without changing runtime behavior; verify the exact current deployed commit with Render before owner sign-off. Engineering deployment drift is closed for the application/helper changes covered by this slice.

The booking-email capture blocker remains open until the owner adds the durable backend Gmail OAuth refresh-token tuple securely to Render:

- `BOOKING_EMAIL_GMAIL_CLIENT_ID`
- `BOOKING_EMAIL_GMAIL_CLIENT_SECRET`
- `BOOKING_EMAIL_GMAIL_REFRESH_TOKEN`
- Optional: `BOOKING_EMAIL_GMAIL_USER_ID`

After that, redeploy, rerun the dry-run backfill, review aggregate counts, and only then run confirmed review-only import if the preview is accepted.

## Still Not Proven

- Approved production users, credentialed login/logout proof, production role matrix, underprivileged role denial, and bootstrap/setup-token cleanup.
- Owner/import source proof that production room counts are the approved real room inventory and not fake seed/demo data.
- Staging or controlled production-like workflow acceptance, or explicit owner acceptance that local disposable proof is sufficient.
- Redacted live secret inventory, rotation metadata, rollback owner/deputy, database recovery owner, latest recovery-point/retention proof, and WAF/rate-limit rule IDs and thresholds.
