# Security Model - Hotel Ops AI Command Center

## Trust Boundaries

Manager commands are untrusted input. They must be parsed, validated, permission-checked, persisted, and audited before any execution.

The parser is not an execution authority. The backend owns policy, approvals, emergency stop, queueing, worker signing, secrets, audit records, and notifications.

The OTA worker accepts only signed, typed tasks. It rejects unknown task types, unknown platforms, unsigned requests, replayed nonces, and credential-shaped payload fields.

OTA websites remain external systems. The worker must not bypass CAPTCHA, 2FA, locked accounts, password-expired flows, rate limits, or platform terms.

When a task reaches `NEEDS_HUMAN`, automated execution stops. Requeueing requires an authorized actor, a non-empty operational reason, and the same run-permission and emergency-stop checks used before worker execution.

## Credential Handling

- No OTA credentials, OpenAI keys, session tokens, or mailbox passwords belong in frontend code.
- No credentials belong in model prompts, task raw messages, task logs, notifications, proof URLs, screenshots, or final summaries.
- Booking.com credentials, when used, must come from backend environment secrets.
- Booking email sync must use server-side Gmail API credentials or a future refresh-token flow, not a raw mailbox password.
- Remote worker calls use `OTA_WORKER_BASE_URL` and `OTA_WORKER_SHARED_SECRET`.
- Scheduled scans must not log credentials on failure.

## Approval Controls

High-risk or write-like task types require approval:

- `SEND_GUEST_REPLY`
- `UPDATE_RATE`
- `UPDATE_AVAILABILITY`
- `CLOSE_ROOM`
- `OPEN_ROOM`
- `UPDATE_DESCRIPTION`
- `UPDATE_PHOTOS`

`UPDATE_PHOTOS` is critical and disabled in the MVP.

Approvals require an operational reason. Denials, cancellations, alert recommendation approvals, alert resolution, and emergency-stop changes also require a reason.

## Emergency Stop

Emergency stop blocks write tasks at these points:

1. command intake decision
2. approval
3. queueing
4. worker execution

Read-only scan and monitoring tasks may continue so staff can still assess the situation.

## Audit Events

Hotel Ops code records audit and task-log evidence for:

- command receipt
- parser output
- validation result
- permission decision
- approval requested, granted, rejected, or denied
- task queued
- worker started
- worker success, failure, or human challenge
- human-action completion and rejected human-action resolution attempts
- alert recommendation approval
- alert acknowledgement or resolution
- scheduler scan run
- emergency stop changes

## Proof Handling

Worker proof artifacts are untrusted until sanitized.

The PMS normalizes proof kinds, caps persisted proof count, redacts credential-like values, blocks raw proof links when redaction is unknown or failed, and shows only safe proof references in the UI.

## Explicit Non-Goals Until Proven

- No CAPTCHA or 2FA bypass.
- No real OTA write execution without dry-run removal, selector verification, and account-owner approval.
- No production claim for email delivery unless a real provider is configured and tested.
- No launch-ready claim from local tests alone.
