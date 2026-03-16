---
name: sandbox-ui-polish
description: Use when the task is to improve UI, UX, visual polish, navigation, hero sections, mobile layout, conversion clarity, component consistency, or premium presentation for Sandbox Hotel surfaces. Do not use for backend-only, database-only, or infrastructure-only tasks.
---

# Sandbox UI Polish

## Owns
- visual hierarchy and spacing discipline
- navigation density and clarity
- CTA prominence and placement
- mobile layout and overflow behavior
- component consistency across pages
- premium but restrained presentation

## Does Not Own
- backend route logic
- business copy claims or translations
- schema or migration changes
- deployment or secrets config

## Trigger When
- a UI surface looks cluttered, inconsistent, or conversion-unfriendly
- mobile layout has overflow or wrapping issues
- a new page or section needs polish after initial build
- visual inconsistencies are reported across pages

## Read First
- the affected template(s) in `sandbox_pms_mvp/templates/`
- `sandbox_pms_mvp/static/styles.css`
- shared base template or layout partials

## Avoid Reading Unless Needed
- backend service modules
- migration files
- unrelated admin templates when working on guest-facing pages (and vice versa)

## Goal

Refine the front end so it feels premium, clean, conversion-focused, and operationally truthful.

## Core UI rules

- Preserve real business facts only.
- Do not invent amenities, offers, policies, or claims.
- Keep Thai-first intent where applicable.
- Keep multilingual content aligned.
- Prefer clarity over ornament.
- Improve mobile experience first.
- Reduce chunkiness and clutter.
- Maintain strong call-to-action visibility.

## Preferred design direction

- lighter, cleaner nav bars
- stronger visual hierarchy
- less busy hero sections
- clearer CTA placement
- tighter spacing discipline
- cleaner cards and sections
- better typography rhythm
- more consistent buttons, forms, and status elements
- premium but restrained presentation

## What to inspect

- navigation density
- hero layout clutter
- CTA prominence
- spacing consistency
- heading hierarchy
- mobile overflow / wrapping issues
- component duplication
- form usability
- empty / error / loading states
- visual noise that hurts conversion

## Working method

1. Inspect the current page structure and shared components.
2. Identify the highest-impact polish opportunities.
3. Prefer targeted improvements over dramatic redesigns.
4. Reuse healthy patterns and consolidate inconsistent ones.
5. Preserve required sections and business-critical actions.

## Output Format

When making changes, optimize for:
- better readability
- better mobile scanability
- stronger trust
- stronger conversion clarity
- cleaner, more modern presentation
- fewer visual distractions

## Guardrails

- Do not overdesign.
- Do not remove key calls to action.
- Do not add new marketing claims.
- Do not introduce flashy motion unless it clearly helps.
- Do not create style drift across pages.

## Success Criteria
- target page renders without overflow or spacing breakage on mobile
- CTA is visually prominent and clearly labeled
- no new marketing claims or invented content introduced
- shared CSS changes do not regress unrelated pages
