# Codex MCP Setup

These MCP connections are recommended for Sandbox, but they still require real credentials and endpoint details before they can be activated safely.

## Highest-Value Connections

1. GitHub MCP for richer PR, issue, and review context.
2. Docs or knowledge MCP for hotel policies, SOPs, room data, and brand rules.
3. Figma MCP if design review happens before implementation.
4. Analytics or logs MCP later, once telemetry access and permission boundaries are clear.

## Setup Notes

1. Keep MCP configuration out of this repo unless the values are safe to commit.
2. Prefer read-only or narrowly scoped credentials first.
3. Pair MCP with the `sandbox-launch-gate` skill and repo launch gate scripts so external context supplements local enforcement instead of replacing it.
