from __future__ import annotations

from pathlib import Path
import sys


PROJECT_PACKAGE = Path(__file__).resolve().parents[1] / "sandbox_pms_mvp"
if str(PROJECT_PACKAGE) not in sys.path:
    sys.path.insert(0, str(PROJECT_PACKAGE))

from codex_guardrails import find_project_root, scan_for_placeholder_issues  # noqa: E402


def main() -> int:
    root = find_project_root(Path(__file__))
    issues = scan_for_placeholder_issues(root)
    if not issues:
        print("Placeholder check passed.")
        return 0

    print("Placeholder check failed:")
    for issue in issues:
        print(f"- {issue.format(root)}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
