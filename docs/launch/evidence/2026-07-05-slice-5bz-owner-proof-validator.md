# Slice 5BZ - Owner Proof Intake Validator

Status date: 2026-07-05.

Verdict: owner-proof intake is safer and more repeatable. This slice adds a local validator/template generator for the remaining owner/provider evidence, but it does not close any launch blocker by itself.

## Scope

- Add a script that creates a local ignored owner-proof template.
- Validate redacted owner proof before it is copied into docs or GitHub issues.
- Detect obvious secret-shaped values in owner proof input.
- Summarize which P0 proof areas are closed, open, or missing without echoing the raw proof payload.

## Evidence

| Check | Result | Notes |
| --- | --- | --- |
| New command | Added | `npm.cmd run owner-proof:validate` runs `scripts/validate-owner-proof-intake.mjs`. |
| Template path | Local/ignored | `npm.cmd run owner-proof:validate -- --init-template` writes `.codex/owner-proof-intake.local.json` by default. `.codex/` is already ignored. |
| Help output | Passed | `npm.cmd run owner-proof:validate -- --help` prints template, file, stdin, and `--require-complete` usage. |
| Syntax check | Passed | `node --check scripts\validate-owner-proof-intake.mjs` passed. |
| Complete redacted fixture | Passed | Importing `template()` and `validateProof(..., { requireComplete: true })` with all required areas marked accepted returned `complete=true` and zero findings. |
| Secret-shaped fixture | Passed | A fixture containing `password=badsecret` returned a finding at the exact JSON path and did not echo the raw proof object. |

## Remaining Work

- Owner still needs to supply real redacted proof for production auth/RBAC/logout, real room inventory source, workflow acceptance or staging target, secret/recovery/rollback ownership, Cloudflare WAF/rate-limit rules, and staff booking-inbox review.
- The validator only checks structure and obvious secret-shaped text. It does not prove provider truth, owner authority, or production behavior.
