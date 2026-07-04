# Slice 5BL - Auth/RBAC Proof Helper

Date: 2026-07-04

## Verdict

Status: partial/open. This slice adds a repeatable owner-run helper for collecting credentialed production login/logout and underprivileged denial proof without committing passwords, cookies, tokens, full login identifiers, or raw response bodies. It does not close the production users/auth/RBAC/logout P0 until the owner runs it with approved production users and records the redacted output.

## Changes

- Added `npm.cmd run auth-rbac:proof`.
- Added `scripts/prove-auth-rbac-production.mjs`.
- Added business-test coverage for identifier masking, proof-host validation, public-user summarization, safe denial probes, and default blocking of mutating denial probes.
- Documented the helper in the runbook, security model, implementation spec, acceptance tests, current system audit, and launch proof packet.

## Helper Behavior

- Reads proof users from `--users-file <local-untracked-json>` or `--users-stdin`.
- Logs in through `POST /api/auth/login`.
- Confirms authenticated session through `GET /api/auth/me`.
- Runs an explicit first authenticated check, defaulting to `GET /api/auth/me`.
- Runs optional owner-approved denial probes. By default only `GET` and `HEAD` denial probes are allowed.
- Logs out through `POST /api/auth/logout`.
- Confirms post-logout `GET /api/auth/me` returns `401`.

## Redaction And Safety

- Passwords are read from local proof input only and never printed.
- Session cookies are kept in memory only and never printed.
- Login identifiers are masked.
- Display names are reduced to initials.
- Response bodies are omitted except bounded role/status fields and probe statuses.
- Mutating denial probes require `--allow-mutating-denial-probes` and should be used only with owner-approved no-op or invalid payloads.

## Validation

| Check | Result | Notes |
| --- | --- | --- |
| `npm.cmd test` | Passed | Business tests cover the helper's redaction and denial-probe guards. |

## Boundary

No production credentialed login, owner user list, password, cookie, session token, screenshot, guest data, payment data, production data mutation, or secret value was used or recorded in this slice.

Production auth/RBAC/logout remains open until the owner supplies approved users and runs the helper or provides equivalent redacted proof.
