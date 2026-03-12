from __future__ import annotations

import argparse
from pathlib import Path
import sys


PROJECT_PACKAGE = Path(__file__).resolve().parents[1] / "sandbox_pms_mvp"
if str(PROJECT_PACKAGE) not in sys.path:
    sys.path.insert(0, str(PROJECT_PACKAGE))

from codex_guardrails import build_launch_gate, find_project_root  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the Sandbox Codex launch gate."
    )
    parser.add_argument(
        "--strict-launch",
        action="store_true",
        help="Promote analytics and consent readiness warnings into blockers.",
    )
    args = parser.parse_args()

    root = find_project_root(Path(__file__))
    blockers, warnings = build_launch_gate(root, strict_launch=args.strict_launch)

    print("Sandbox Codex launch gate")
    print(f"Blockers: {len(blockers)}")
    print(f"Warnings: {len(warnings)}")

    if blockers:
        print("\nBlockers:")
        for issue in blockers:
            print(f"- {issue.format(root)}")

    if warnings:
        print("\nWarnings:")
        for issue in warnings:
            print(f"- {issue.format(root)}")

    if not blockers and not warnings:
        print("\nLaunch gate passed.")

    return 1 if blockers else 0


if __name__ == "__main__":
    raise SystemExit(main())
