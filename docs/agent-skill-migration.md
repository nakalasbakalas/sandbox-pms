# Agent and Skill Migration Notes

This note explains how to move from the current repo guidance to the upgraded, more modular, more token-efficient setup.

## Current system

- Repo instructions live in `AGENTS.md`.
- App-specific instructions live in `sandbox_pms_mvp/AGENTS.md` and `sandbox_pms_mvp/pms/services/AGENTS.md`.
- Skills live under `.agents/skills/` and are invoked ad hoc.
- There was no registry tying together agent roles, skill priorities, and prompt templates.

## Target system

- Keep the instruction files.
- Add a stable **agent registry** in `docs/agent-registry.md`.
- Add a stable **skill registry** in `docs/skill-registry.md`.
- Add domain-specific skills for operations, housekeeping/readiness, messaging, and analytics/reporting.
- Keep agent prompts lean by routing work through one domain skill first, then only the needed cross-cutting skills.

## Migration map

| Current behavior | New behavior |
| --- | --- |
| Generic PMS operational tasks often start with broad repo/app context | Start with `front-desk-cashier-ops`, `housekeeping-readiness-board`, `guest-messaging-workflows`, or `analytics-reporting-integrity` as the narrowest domain skill |
| Public-site work may overuse generic UI prompts | Use `web-conversion-guardian` agent composition: UI + SEO/a11y + analytics + Thai-first only when needed |
| Front-desk and housekeeping work can blur together | Keep desk workflow and readiness workflow distinct skills, then compose them only for handoff work |
| Messaging automations require repeated re-explanation | Use `guest-messaging-workflows` as the standard automation/template/thread packet |
| Repo audits lack a reusable output format | Use `repo-systems-auditor` plus the registries and audit template below |

## Agent prompt template

```text
Agent: <agent-name>
Mission: <single-sentence mission>
Primary repo surfaces:
- <file or directory>
- <file or directory>

Load first:
- <one domain skill>

Add only if needed:
- <cross-cutting skill 1>
- <cross-cutting skill 2>

Task:
- <requested change>

Success checks:
- <targeted validation command>
- <manual verification requirement if UI changes>
- <security/release check if applicable>
```

## Skill template format

Each skill should keep the same structure already used in `.agents/skills/`:

```markdown
---
name: skill-name
description: One-line trigger and non-goal summary.
---

# Skill Title

## Owns
- domain responsibility

## Does Not Own
- explicit boundaries

## Trigger When
- concrete triggers

## Read First
- exact repo paths

## Avoid Reading Unless Needed
- paths that waste tokens

## Goal

One paragraph describing the intended outcome.

## What to inspect
- reusable checklist

## Working method
1. read
2. trace
3. fix
4. validate

## Output Format
- structured outputs

## Guardrails
- domain-specific warnings

## Success Criteria
- completion bar
```

And each skill should keep a minimal `agents/openai.yaml`:

```yaml
interface:
  display_name: "Human Readable Name"
  short_description: "Short mission."
  brand_color: "#HEX"
  default_prompt: "One sentence telling the agent what to protect."

policy:
  allow_implicit_invocation: true
```

## Rollout order

1. Update `AGENTS.md` skill routing and token-efficiency guidance.
2. Add the missing domain skills under `.agents/skills/`.
3. Publish the registries in `docs/`.
4. Add tests that keep skill directories, AGENTS routing, and docs in sync.
5. Use the registries as the source of truth for future prompt or skill changes.

## Remove / standardize

- Do **not** add a separate agent for every skill.
- Do **not** duplicate skill descriptions between registry docs and AGENTS files beyond short routing summaries.
- Do standardize on one naming pattern: kebab-case skill names, action-oriented agent names, and stable checklist-style outputs.
