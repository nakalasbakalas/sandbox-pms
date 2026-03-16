---
name: performance-seo-accessibility
description: Use when the task is to improve page speed, mobile performance, accessibility, semantic structure, metadata, indexing readiness, or general front-end quality after UI changes. Do not use for unrelated backend-only or database-only work.
---

# Performance SEO Accessibility

## Owns
- page load and rendering performance
- semantic HTML structure and heading hierarchy
- metadata quality and crawlability
- accessibility basics (keyboard, screen reader, contrast, labels)
- mobile rendering correctness

## Does Not Own
- business logic or route handling
- schema migrations
- deployment config
- copy and translation content

## Trigger When
- UI or template changes are landing and performance/a11y impact is unknown
- mobile layout issues are reported
- SEO or metadata quality is questioned
- accessibility gaps are reported or suspected

## Read First
- the affected page template(s) in `sandbox_pms_mvp/templates/`
- `sandbox_pms_mvp/static/styles.css` for shared layout patterns
- shared base template or layout partials

## Avoid Reading Unless Needed
- backend service logic
- migration files
- unrelated admin-only templates

## Goal

Improve the front end so it loads cleanly, ranks sensibly, and works better for all users.

## Performance checks

- oversized images
- unnecessary client-side work
- duplicated assets
- render-blocking patterns
- layout shift risks
- needless animation / heavy effects
- repeated large dependencies
- poor mobile rendering behavior

## SEO checks

- page title quality
- meta description quality
- canonical consistency
- heading hierarchy
- semantic HTML structure
- meaningful internal labels
- crawl-friendly content structure
- duplicate or thin metadata

## Accessibility checks

- heading order
- alt text where relevant
- link clarity
- button clarity
- focus visibility
- keyboard access
- form labels
- error feedback
- color contrast
- touch target quality
- screen-reader-friendly structure

## Working method

1. Inspect the page and shared layout/components.
2. Identify highest-impact issues first.
3. Prefer improvements with measurable practical benefit.
4. Avoid performance regressions from decorative additions.
5. Preserve brand quality while simplifying heavy patterns.

## Output Format

When editing, prioritize:
- faster perceived load
- better mobile clarity
- stronger semantic structure
- better accessibility basics
- cleaner metadata and headings
- lower UI friction

## Guardrails

- Do not keyword-stuff.
- Do not add fake SEO content.
- Do not sacrifice usability for micro-optimizations.
- Do not break visual hierarchy while chasing scores.

## Success Criteria
- page has correct heading hierarchy and meaningful metadata
- key interactive elements are keyboard-accessible and labeled
- mobile layout renders without overflow or misaligned elements
- no performance regressions introduced by decorative additions
