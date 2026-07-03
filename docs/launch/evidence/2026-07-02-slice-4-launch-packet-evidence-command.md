# Slice 4 - Launch Packet And Evidence Command

Date: 2026-07-02.

Scope: restore the missing launch packet files and add a non-mutating `launch:evidence` command so future launch slices can start with a repeatable local evidence inventory. This slice does not deploy, restart services, read production secrets, or access production data.

## Changes

- Added `docs/launch/CODEX_LAUNCH_FINISH_PACKET.md`.
- Added `docs/launch/LAUNCH_PROOF_MATRIX.md`.
- Added `scripts/launch-evidence.mjs`.
- Added the `launch:evidence` npm script in `package.json`.
- Updated `docs/launch/CURRENT_STATUS_INDEX.md` for Slice 4.

## Validation

| Command | Result | Notes |
| --- | --- | --- |
| `npm.cmd run launch:evidence` | Passed | Confirmed all required launch docs are present, listed five evidence files, and found no selected unredacted secret-shaped values in launch evidence docs. Command ran on branch `main`, commit `2ba7410e4684697237bf14980544a4084775821c`, with eight dirty worktree entries. |
| `npm.cmd run lint` | Passed | ESLint completed with no reported violations. |
| `git diff --check` | Passed | Passed with existing LF-to-CRLF worktree warnings only. |

## Evidence Boundaries

- The new command checks required launch docs, lists launch evidence files, prints branch/commit/dirty-entry counts, and scans launch evidence docs for selected unredacted secret-shaped values.
- The command is an inventory/evidence hygiene check. It is not a replacement for `npm.cmd run launch:check`, live probes, provider dashboard proof, or account-owner acceptance.
- No production secrets, raw database URLs, cookies, tokens, passwords, or screenshots were added by this slice.

## Remaining P0 Blockers

- Live setup-completion hardening still needs approved deploy/reprobe evidence.
- Production users/auth/RBAC/logout proof remains open.
- Real production room inventory proof remains open.
- Core hotel workflow proof remains open.
- Secret key inventory/rotation metadata and recovery ownership proof remain external/account-owner evidence gaps.

## Next Recommended Slice

Use the approved branch/PR/deploy path for the current checkout, then rerun the setup-complete unauthenticated probe against `https://book.sandboxhotel.com` and record the deployed commit/deploy ID.
