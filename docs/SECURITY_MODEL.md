# Security Model - Hotel Ops AI Command Center

## Trust Boundaries

Manager commands are untrusted input. They must be parsed, strict-schema validated, permission-checked, persisted, and audited before any execution.

LINE-originated manager commands are also untrusted input. The webhook must verify the LINE signature first; the Hotel Ops bridge remains disabled unless explicitly configured, requires the command prefix, requires a LINE user allowlist mapped to an active PMS user, and still checks `create:ops-task` before calling the shared command service.

The parser is not an execution authority. The backend owns parsed-task schema validation, policy, approvals, emergency stop, queueing, worker signing, secrets, audit records, and notifications.

OpenAI Responses parsing is optional and backend-only. Prompt input is redacted before submission, model output is strict-schema validated and backend-policy normalized, and provider failures fall back to deterministic parsing with a redacted reason.

The OTA worker accepts only signed, typed tasks. It rejects unknown task types, unknown platforms, unsigned requests, replayed nonces, and credential-shaped payload fields.

OTA websites remain external systems. The worker must not bypass CAPTCHA, 2FA, locked accounts, password-expired flows, rate limits, or platform terms.

When a task reaches `NEEDS_HUMAN`, automated execution stops. Requeueing requires an authorized actor, a non-empty operational reason, and the same run-permission and emergency-stop checks used before worker execution.

## Credential Handling

- No OTA credentials, OpenAI keys, session tokens, or mailbox passwords belong in frontend code.
- No credentials belong in model prompts, task raw messages, task logs, notifications, proof URLs, screenshots, or final summaries.
- `OPENAI_API_KEY`, when used for the optional parser, must be a backend environment secret only.
- Booking.com credentials, when used, must come from backend environment secrets.
- Booking email sync must use server-side Gmail API credentials, either an OAuth access token or backend OAuth refresh-token credentials, not a raw mailbox password.
- Hotel Ops Gmail email delivery is backend-only and opt-in; it must use backend Gmail OAuth credentials and must redact provider failures before persistence.
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
