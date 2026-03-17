---
name: guest-messaging-workflows
description: Use when the task touches the guest messaging hub, conversation threads, message templates, delivery attempts, automation rules, inbound webhooks, follow-up states, or reservation-linked communication workflows. Do not use for unrelated public-site SEO or generic admin cleanup.
---

# Guest Messaging Workflows

## Owns
- unified guest messaging inbox and thread-state integrity
- message template and placeholder behavior
- automation-rule and delayed-event workflow review
- inbound and outbound delivery tracking
- reservation and guest context reflection inside communication flows

## Does Not Own
- generic translation cleanup without messaging changes
- payment provider implementation unrelated to guest communication
- broad deployment configuration
- non-communication UI polish

## Trigger When
- inbox, thread detail, or messaging filters change
- message templates or automation rules change
- inbound provider webhook handling changes
- delivery statuses, follow-up flags, or reservation-linked messaging states change

## Read First
- `MESSAGING.md`
- `sandbox_pms_mvp/pms/services/messaging_service.py`
- `sandbox_pms_mvp/pms/services/communication_service.py`
- `sandbox_pms_mvp/pms/app.py` messaging routes
- `sandbox_pms_mvp/tests/test_phase18_messaging.py`
- related notification templates and docs if guest-facing copy is involved

## Avoid Reading Unless Needed
- unrelated dashboards
- migration files outside the messaging chain
- guest-facing marketing pages unrelated to messaging

## Goal

Keep guest communication workflows unified, explicit, and safe under automation and delivery failures.

## What to inspect

### Conversation integrity
- thread reuse and thread ownership
- unread counts, follow-up markers, assignment, and close/reopen behavior
- reservation and guest linkage

### Message lifecycle
- draft, queued, sent, delivered, failed, and read states
- delivery attempt logging
- provider error visibility
- internal notes vs external messages

### Automation and inbound handling
- rule triggers and delay behavior
- idempotency and duplicate-message risk
- webhook payload validation and guest matching
- template placeholder safety and channel suitability

## Working method

1. Trace the message flow from trigger to persistence to delivery state.
2. Check whether thread, reservation, and guest context stay aligned.
3. Validate automation behavior under delay, failure, and retry conditions.
4. Preserve operator visibility into follow-up and delivery outcomes.
5. Pair with `thai-first-content-guard` if guest-facing copy changes across languages.

## Output Format
- workflow states reviewed
- automation or delivery gaps found
- template or context-linking issues found
- exact fixes applied
- follow-up items for provider or content work

## Guardrails

- do not silently drop failed deliveries or delayed events
- do not break reservation or guest linkage for convenience
- do not trust inbound provider payloads without validation
- do not mix internal-note behavior with guest-visible delivery states

## Success Criteria
- thread and message state remain explicit and auditable
- automation rules stay predictable under retries and delays
- delivery failures remain visible to staff
- guest communication context stays linked to the right reservation or guest
