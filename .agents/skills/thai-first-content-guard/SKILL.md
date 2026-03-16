---
name: thai-first-content-guard
description: Use when the task involves guest-facing copy, translations, Thai-first multilingual content, CTA wording, contact details, maps links, addresses, or alignment across Thai, English, and Chinese. Do not use for backend-only or schema-only work.
---

# Thai-First Content Guard

## Owns
- Thai-first copy quality and consistency
- cross-language alignment (Thai, English, Chinese)
- contact details, addresses, and map links accuracy
- CTA wording coherence across languages
- removal of translation artifacts and bloated copy

## Does Not Own
- backend logic
- schema changes
- visual layout or CSS
- booking flow logic

## Trigger When
- guest-facing copy is added or modified in any language
- CTA wording or contact details change
- translation inconsistencies are reported
- new template sections are added with multilingual content

## Read First
- affected templates in `sandbox_pms_mvp/templates/`
- shared content blocks or i18n helpers if present
- `BRANDING-MANIFEST.md` and `MESSAGING.md` for canonical claims (if present)

## Avoid Reading Unless Needed
- backend service modules
- migration files
- admin-only templates

## Goal

Protect copy quality and consistency across Thai-first multilingual guest-facing content.

## What to inspect

- Thai primary copy
- English and Chinese alignment
- CTA wording
- phone numbers
- addresses
- map links
- policy wording
- booking-related text
- section headings
- repeated content blocks

## Working method

1. Treat Thai as the primary truth source when that is the repo strategy.
2. Compare cross-language variants for consistency of meaning.
3. Check for missing or stale contact details.
4. Remove awkward, bloated, or mixed-language copy.
5. Keep copy concise, clear, and trustworthy.

## Review checklist

### Consistency
- Do all languages express the same actual meaning?
- Are CTAs aligned?
- Are names, addresses, and phone numbers identical where they should be?

### Quality
- Is the copy concise?
- Is the tone premium but natural?
- Are there obvious machine-translation artifacts?
- Is mixed-language formatting hurting readability?

### Conversion
- Are key guest actions clear?
- Does the copy support trust and booking intent?
- Are important details easy to find?

## Output Format
- Inconsistencies found
- Copy blocks cleaned
- Details normalized
- Translation risks
- Follow-up content gaps

## Guardrails

- Do not invent translated claims.
- Do not add marketing fluff.
- Preserve exact business facts while improving wording.

## Success Criteria
- Thai and secondary languages convey the same meaning for all key sections
- contact details, addresses, and CTAs are consistent across languages
- no machine-translation artifacts remain in reviewed sections
- no invented claims or policy details introduced
