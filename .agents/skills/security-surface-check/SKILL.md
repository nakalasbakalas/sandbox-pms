---
name: security-surface-check
description: Use when the task involves security review, auth boundaries, form handling, input validation, output escaping, role protection, session handling, or exposed secrets. Also use after major feature changes touching guest, admin, or booking flows.
---

# Security Surface Check

## Goal

Perform a practical security-focused review that reduces obvious application risk without derailing product velocity.

## What to inspect

- auth boundaries
- role checks
- session assumptions
- input validation
- output escaping
- CSRF assumptions
- unsafe redirects
- secret exposure
- admin-only data leaks
- verbose error leakage
- insecure defaults in forms or APIs

## Working method

1. Map the boundary between guest, authenticated user, and admin surfaces.
2. Inspect entry points that accept user input.
3. Check validation and sanitization paths.
4. Look for places where server trust is assumed incorrectly on the client.
5. Review secret and config exposure risk.
6. Report practical fixes in priority order.

## Review checklist

### Input and output
- Are all externally supplied inputs validated?
- Is output escaped where needed?
- Are error messages leaking internal details?

### Auth and access
- Can routes or actions be reached without the right role?
- Are admin APIs protected server-side?
- Are client-only checks being trusted?

### Session and request safety
- Are session assumptions explicit?
- Are risky actions protected appropriately?
- Are retries or duplicate submissions causing unsafe behavior?

### Secrets and configuration
- Are secrets server-only?
- Are environment variables exposed accidentally?
- Are test credentials or debug toggles left behind?

## Output expectations

Report:
- critical issues
- medium-risk issues
- low-risk hygiene issues
- recommended fixes
- fixes applied
- remaining follow-up items

## Guardrails

- Prioritize exploitable or user-impacting issues first.
- Do not create security theater.
- Preserve working product behavior while hardening it.
