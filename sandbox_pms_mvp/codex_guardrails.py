from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re


PUBLIC_TEMPLATE_NAMES = {"availability.html", "base.html", "index.html"}
PUBLIC_TEMPLATE_PREFIXES = ("public_",)
STATIC_TEXT_SUFFIXES = {".css", ".html", ".js", ".json", ".svg", ".txt", ".xml"}
CODEX_DOC_REQUIREMENTS: dict[str, tuple[str, ...]] = {
    "docs/release-checklist.md": ("launch gate", "booking", "contact", "rollback", "monitoring"),
    "docs/rollback-checklist.md": ("rollback", "database", "render", "smoke test"),
    "docs/production-secrets-map.md": ("secret_key", "auth_encryption_key", "database_url", "render"),
    "docs/monitoring-playbook.md": ("health", "request_id", "logs", "booking"),
    "docs/measurement-spec.md": ("datalayer", "cta_click", "booking_request_submit", "consent"),
}
STRICT_WARNING_CODES = {
    "analytics-missing",
    "analytics-events-missing",
    "consent-missing",
}


@dataclass(frozen=True)
class GuardrailIssue:
    code: str
    message: str
    severity: str = "error"
    path: Path | None = None
    line: int | None = None

    def display_path(self, root: Path) -> str:
        if self.path is None:
            return ""
        try:
            return str(self.path.resolve().relative_to(root.resolve()))
        except ValueError:
            return str(self.path)

    def format(self, root: Path) -> str:
        location = self.display_path(root)
        if self.line is not None and location:
            location = f"{location}:{self.line}"
        prefix = f"[{self.code}]"
        if location:
            return f"{prefix} {location} - {self.message}"
        return f"{prefix} {self.message}"


def find_project_root(start: Path | None = None) -> Path:
    starting_point = (start or Path.cwd()).resolve()
    search_path = starting_point if starting_point.is_dir() else starting_point.parent
    for candidate in (search_path, *search_path.parents):
        if (candidate / ".git").exists() and (candidate / "sandbox_pms_mvp").is_dir():
            return candidate
    raise FileNotFoundError("Could not determine the Sandbox project root.")


def iter_public_templates(root: Path) -> list[Path]:
    templates_dir = root / "sandbox_pms_mvp" / "templates"
    if not templates_dir.exists():
        return []
    templates: list[Path] = []
    for path in sorted(templates_dir.glob("*.html")):
        if path.name in PUBLIC_TEMPLATE_NAMES or path.name.startswith(PUBLIC_TEMPLATE_PREFIXES):
            templates.append(path)
    return templates


def iter_static_text_files(root: Path) -> list[Path]:
    static_dir = root / "sandbox_pms_mvp" / "static"
    if not static_dir.exists():
        return []
    return sorted(
        path
        for path in static_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in STATIC_TEXT_SUFFIXES
    )


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def find_line_containing(text: str, pattern: str) -> int | None:
    index = text.find(pattern)
    if index == -1:
        return None
    return line_number(text, index)


def scan_for_placeholder_issues(root: Path) -> list[GuardrailIssue]:
    issues: list[GuardrailIssue] = []
    launch_sensitive_files = [
        *iter_public_templates(root),
        *iter_static_text_files(root),
        root / "render.yaml",
    ]
    seen_files: set[Path] = set()
    for path in launch_sensitive_files:
        if not path.exists() or path in seen_files:
            continue
        seen_files.add(path)
        text = read_text(path)
        for match in re.finditer(r"@YOUR_[A-Z0-9_]+", text):
            issues.append(
                GuardrailIssue(
                    code="placeholder-contact",
                    message="Replace placeholder contact or handle values before launch.",
                    path=path,
                    line=line_number(text, match.start()),
                )
            )
        for match in re.finditer(r"replace(?:\s|-)?with\s+your\s+real", text, flags=re.IGNORECASE):
            issues.append(
                GuardrailIssue(
                    code="replace-me-copy",
                    message="Replace launch placeholder copy with the real production value.",
                    path=path,
                    line=line_number(text, match.start()),
                )
            )
        for match in re.finditer(r'href=["\']#["\']', text):
            issues.append(
                GuardrailIssue(
                    code="dead-cta",
                    message="Replace dead guest-facing CTA targets before launch.",
                    path=path,
                    line=line_number(text, match.start()),
                )
            )
        for match in re.finditer(r"mailto:[^\"'\s>]*example\.(com|org|net)", text, flags=re.IGNORECASE):
            issues.append(
                GuardrailIssue(
                    code="placeholder-email",
                    message="Replace example.com contact email targets before launch.",
                    path=path,
                    line=line_number(text, match.start()),
                )
            )
    return issues


def check_public_surface(root: Path) -> list[GuardrailIssue]:
    issues: list[GuardrailIssue] = []
    base_template = root / "sandbox_pms_mvp" / "templates" / "base.html"
    if not base_template.exists():
        return [
            GuardrailIssue(
                code="missing-base-template",
                message="Expected sandbox_pms_mvp/templates/base.html to exist.",
                path=base_template,
            )
        ]
    base_text = read_text(base_template)
    required_snippets = (
        ("meta-description", '<meta name="description"', "Public base template should expose a meta description."),
        ("meta-robots", '<meta name="robots"', "Public base template should declare robots directives."),
        ("canonical-link", '<link rel="canonical"', "Public base template should expose a canonical URL."),
        ("hreflang-link", 'hreflang="{{ code }}"', "Public base template should expose language alternate links."),
        ("og-title", 'property="og:title"', "Public base template should expose Open Graph metadata."),
        ("twitter-card", 'name="twitter:card"', "Public base template should expose Twitter card metadata."),
        ("hotel-schema", 'type="application/ld+json"', "Public base template should include structured data."),
        ("skip-link", 'href="#main-content"', "Public base template should include a skip link."),
        ("booking-cta", "url_for('public.booking_entry'", "Public templates should keep a reachable booking CTA."),
    )
    for code, snippet, message in required_snippets:
        if snippet not in base_text:
            issues.append(GuardrailIssue(code=code, message=message, path=base_template))

    robots_file = root / "sandbox_pms_mvp" / "static" / "robots.txt"
    if not robots_file.exists():
        issues.append(
            GuardrailIssue(
                code="missing-robots",
                message="Expected sandbox_pms_mvp/static/robots.txt to exist.",
                path=robots_file,
            )
        )
    else:
        robots_text = read_text(robots_file)
        for code, snippet, message in (
            ("robots-staff", "Disallow: /staff/", "Robots file should block staff URLs."),
            ("robots-booking-hold", "Disallow: /booking/hold", "Robots file should block booking hold URLs."),
        ):
            if snippet not in robots_text:
                issues.append(GuardrailIssue(code=code, message=message, path=robots_file))

    for template_path in iter_public_templates(root):
        text = read_text(template_path)
        for match in re.finditer(r"<img\b(?![^>]*\balt=)", text, flags=re.IGNORECASE | re.DOTALL):
            issues.append(
                GuardrailIssue(
                    code="image-alt-missing",
                    message="Public image tags should include alt text.",
                    path=template_path,
                    line=line_number(text, match.start()),
                )
            )
    return issues


def check_required_docs(root: Path) -> list[GuardrailIssue]:
    issues: list[GuardrailIssue] = []
    for relative_path, required_terms in CODEX_DOC_REQUIREMENTS.items():
        path = root / relative_path
        if not path.exists():
            issues.append(
                GuardrailIssue(
                    code="doc-missing",
                    message=f"Required operational doc is missing: {relative_path}.",
                    path=path,
                )
            )
            continue
        text = read_text(path).lower()
        missing_terms = [term for term in required_terms if term not in text]
        if missing_terms:
            issues.append(
                GuardrailIssue(
                    code="doc-incomplete",
                    message=f"{relative_path} is missing expected launch-gate terms: {', '.join(missing_terms)}.",
                    path=path,
                )
            )
    return issues


def check_analytics_readiness(root: Path) -> list[GuardrailIssue]:
    search_paths = [*iter_public_templates(root), *iter_static_text_files(root)]
    combined_text = "\n".join(read_text(path) for path in search_paths if path.exists())
    lowered = combined_text.lower()
    issues: list[GuardrailIssue] = []
    base_template = root / "sandbox_pms_mvp" / "templates" / "base.html"
    if "datalayer" not in lowered:
        issues.append(
            GuardrailIssue(
                code="analytics-missing",
                message="Public front-end analytics wiring is missing a dataLayer surface.",
                severity="warning",
                path=base_template,
            )
        )
    if "cta_click" not in lowered or "booking_request_submit" not in lowered:
        issues.append(
            GuardrailIssue(
                code="analytics-events-missing",
                message="Public analytics wiring is missing the expected CTA and booking event taxonomy.",
                severity="warning",
                path=base_template,
            )
        )
    if "consent" not in lowered:
        issues.append(
            GuardrailIssue(
                code="consent-missing",
                message="Public front-end consent-aware analytics support is not present.",
                severity="warning",
                path=base_template,
            )
        )
    return issues


def build_launch_gate(root: Path, *, strict_launch: bool) -> tuple[list[GuardrailIssue], list[GuardrailIssue]]:
    blockers = [
        *scan_for_placeholder_issues(root),
        *check_public_surface(root),
        *check_required_docs(root),
    ]
    warnings = check_analytics_readiness(root)
    if strict_launch:
        blockers.extend(warnings)
        warnings = []
    return blockers, warnings

