# Current Launch Status Index

Last updated: 2026-07-02

This index is the current launch-readiness pointer for `nakalasbakalas/sandbox-pms`. It exists to prevent older launch-hardening, completion, or proof documents from overstating production readiness. If another document says a gate passed on an older date, prefer this file until fresh evidence is captured under `docs/launch/evidence/`.

## Current summary

- Reported checklist progress from operator context: 38 of 71 items complete.
- Current readiness: not ready for final launch sign-off.
- Latest operator report: current-checkout `npm.cmd run launch:check` is not green because `db:doctor` reported configured DB migrate-status failures/unavailability, and DB-mutating E2E is blocked without `ALLOW_DB_E2E=true`.
- Existing repo docs contain useful June 2026 evidence, but they still list production users, room inventory, role-by-role access, current secrets/rotation metadata, rollback ownership, WAF/rate-limit proof, and live provider evidence as not proven.

## Source of truth files

| File | Purpose |
| --- | --- |
| `LAUNCH_CHECKLIST.md` | Repo launch checklist and final sign-off source of truth |
| `README.md` | Public current-launch-status summary and command list |
| `docs/launch-scope-decisions.md` | Provider, user, room inventory, DB E2E, rollback, and WAF go/no-go boundaries |
| `docs/live-environment-proof.md` | Existing live environment proof register and still-not-proven list |
| `docs/launch/CODEX_LAUNCH_FINISH_PACKET.md` | Bounded Codex execution packet with one-slice-at-a-time instructions |
| `docs/launch/LAUNCH_PROOF_MATRIX.md` | P0/P1/P2 proof matrix and artifact map |
| `docs/launch/evidence/` | Fresh redacted launch evidence outputs and manual proof artifacts |

## Required proof artifacts

| Artifact | Required before sign-off? | Current status |
| --- | --- | --- |
| `docs/launch/evidence/LAUNCH_GATE_RESULTS.md` | Yes | missing |
| `docs/launch/evidence/DB_DOCTOR_RESULTS.md` | Yes | missing |
| `docs/launch/evidence/AUTH_RBAC_PROOF.md` | Yes | missing |
| `docs/launch/evidence/ROOM_INVENTORY_PROOF.md` | Yes | missing |
| `docs/launch/evidence/HOTEL_WORKFLOW_PROOF.md` | Yes | missing |
| `docs/launch/evidence/DB_E2E_POSTURE.md` | Yes | missing |
| `docs/launch/evidence/SECRETS_AND_RECOVERY_PROOF.md` | Yes | missing |
| `docs/launch/evidence/WAF_PROVIDER_POSTURE.md` | Before guest-facing launch or formal defer | missing |
| `docs/launch/evidence/BROWSER_E2E_STABILITY.md` | Before guest-facing launch or formal defer | missing |
| `docs/launch/evidence/LOCALIZATION_TABLET_ACCEPTANCE.md` | Before guest-facing launch or formal defer | missing |

## Open P0 blockers

- Production users and secure access path proof.
- Production room inventory proof.
- Core hotel workflow acceptance proof.
- DB-mutating E2E posture decision and proof.
- Secret hygiene, rotation metadata, ownership, rollback/deputy/database recovery proof.
- Current-checkout `npm run launch:check` repair/rerun.
- Live production secret and recovery evidence refresh.

## Open P1 blockers

- Upstream WAF/rate-limit rule IDs, thresholds, protected hostnames, and non-destructive test result.
- Provider posture decisions for LINE, OTA automation, and payments are not launch-ready unless explicitly accepted as manual/disabled/deferred.
- Browser cold-start/page.goto instability must be fixed or documented if it reproduces.
- Thai/English localization and tablet/manual operations acceptance proof.

## Recommended next Codex slice

Start with Slice 0 from `docs/launch/CODEX_LAUNCH_FINISH_PACKET.md`:

1. Run `npm run launch:evidence`.
2. Run non-destructive checks.
3. Create/update `docs/launch/evidence/LAUNCH_GATE_RESULTS.md` and `docs/launch/evidence/DB_DOCTOR_RESULTS.md`.
4. Update this index with proved/blocked/deferred status.

## Do not mark ready until

- All P0 proof artifacts exist and are current.
- `npm run launch:check` passes in the intended environment.
- DB-mutating E2E posture is recorded and safe.
- Real room inventory is proved.
- Live secret/recovery evidence is verified with redacted outputs.
- P1 items are complete or formally deferred with owner/date.
