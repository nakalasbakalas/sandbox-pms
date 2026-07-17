# Release Evidence Model

Status date: 2026-07-16.

This is the canonical status vocabulary for Sandbox Hotel PMS releases. Evidence at one level never implies a higher level, and accepted risk does not convert missing evidence into proof.

| Level | Meaning | Minimum evidence | Current release-foundation status |
| --- | --- | --- | --- |
| Engineering-ready | The exact candidate passes repository checks and disposable-database lifecycle tests. | Commit SHA, green fast CI, green ephemeral PostgreSQL migration/seed/E2E job, build, and migration status. | **Open for the current branch.** Earlier commits have historical green evidence, but the release-foundation candidate must pass its own CI. |
| Staging-proven | The engineering-ready candidate is deployed to an isolated production-like target and its migration, recovery, RBAC, and staff workflows are exercised. | Staging deploy ID, sanitized restore/migration evidence, workflow results, and rollback result. | **Open.** Local disposable DB proof is engineering evidence, not staging proof. |
| Owner-approved | The owner approves the exact staging-proven candidate and explicitly records any accepted risks with impact, workaround, expiry, and rollback owner. | Candidate SHA/deploy ID, dated approval, acceptance record, and named operational owners. | **Open for the current candidate.** The 2026-07-07 accepted-risk approval remains historical evidence for its exact deploy only. |
| Provider-proven | A named external capability is verified in the live provider/account using redacted evidence. | Provider resource/account identifier, configuration metadata, credentialed non-destructive test or approved safe mutation, date, and owner. | **Partial by capability.** Public Render health and booking Gmail credential-path evidence exist historically; Cloudflare rule proof, current recovery metadata, credentialed role proof, live OTA writes, and payment collection are not proven. |

## Release rules

- “Complete”, a closed issue, or owner-accepted risk may describe a historical decision, but cannot be used as current engineering, staging, or provider proof.
- Every release note and status summary must name the highest level actually achieved for the exact commit.
- Live Gmail, Render, Cloudflare, OTA, payment, and account-owner checks remain separate evidence records.
- A controlled owner pilot may continue under `docs/launch-scope-decisions.md`; it is not full production sign-off.
- `docs/launch/CURRENT_STATUS_INDEX.md` is the current snapshot. The checklist and proof matrix retain detailed and historical evidence.
