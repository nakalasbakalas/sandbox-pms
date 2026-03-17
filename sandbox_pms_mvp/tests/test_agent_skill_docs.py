from __future__ import annotations

from pathlib import Path
import re


REPO_ROOT = Path(__file__).resolve().parents[2]
SKILLS_DIR = REPO_ROOT / ".agents" / "skills"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _skill_names() -> list[str]:
    return sorted(path.name for path in SKILLS_DIR.iterdir() if path.is_dir())


def test_root_agents_skill_list_matches_skill_directories() -> None:
    text = _read(REPO_ROOT / "AGENTS.md")
    skills_section = text.split("## Skills", 1)[1].split("## Change strategy", 1)[0]
    listed = set(re.findall(r"- `([^`]+)` —", skills_section))
    assert listed == set(_skill_names())


def test_each_skill_has_front_matter_and_openai_agent_config() -> None:
    for skill in _skill_names():
        skill_text = _read(SKILLS_DIR / skill / "SKILL.md")
        assert skill_text.startswith("---\nname: ")
        assert f"name: {skill}" in skill_text

        openai_yaml = _read(SKILLS_DIR / skill / "agents" / "openai.yaml")
        assert "display_name:" in openai_yaml
        assert "short_description:" in openai_yaml
        assert "default_prompt:" in openai_yaml
        assert "allow_implicit_invocation:" in openai_yaml


def test_registry_docs_cover_skills_and_agents() -> None:
    skill_registry = _read(REPO_ROOT / "docs" / "skill-registry.md")
    agent_registry = _read(REPO_ROOT / "docs" / "agent-registry.md")
    migration_notes = _read(REPO_ROOT / "docs" / "agent-skill-migration.md")

    for skill in _skill_names():
        assert f"`{skill}`" in skill_registry

    for agent in (
        "repo-systems-auditor",
        "booking-revenue-guard",
        "ops-console-orchestrator",
        "web-conversion-guardian",
        "release-safety-steward",
        "guest-communications-operator",
    ):
        assert f"`{agent}`" in agent_registry

    assert "## Agent prompt template" in migration_notes
    assert "## Skill template format" in migration_notes
