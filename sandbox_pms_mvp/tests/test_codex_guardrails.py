from __future__ import annotations

from pathlib import Path

from codex_guardrails import check_analytics_readiness, check_public_surface, check_required_docs, scan_for_placeholder_issues


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def build_repo_fixture(tmp_path: Path) -> Path:
    (tmp_path / ".git").mkdir(parents=True, exist_ok=True)
    write_file(
        tmp_path / "sandbox_pms_mvp" / "templates" / "base.html",
        """<!doctype html>
<html lang="{{ current_language }}">
<head>
  <meta name="description" content="Sandbox Hotel">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="{{ canonical_url }}">
  <link rel="alternate" hreflang="{{ code }}" href="{{ href }}">
  <link rel="alternate" hreflang="x-default" href="{{ site_base_url }}">
  <meta property="og:title" content="{{ hotel_name }}">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">{{ hotel_structured_data | tojson }}</script>
</head>
<body>
  <a href="#main-content">Skip</a>
  <a href="{{ url_for('public.booking_entry', lang=current_language) }}">Book</a>
</body>
</html>
""",
    )
    write_file(
        tmp_path / "sandbox_pms_mvp" / "templates" / "index.html",
        """{% extends 'base.html' %}
{% block content %}
<a href="{{ url_for('public.booking_entry', lang=current_language) }}">Book now</a>
{% endblock %}
""",
    )
    write_file(
        tmp_path / "sandbox_pms_mvp" / "static" / "robots.txt",
        "User-agent: *\nDisallow: /staff/\nDisallow: /booking/hold\n",
    )
    return tmp_path


def test_placeholder_scan_flags_guest_facing_placeholders(tmp_path):
    repo_root = build_repo_fixture(tmp_path)
    write_file(
        repo_root / "sandbox_pms_mvp" / "templates" / "public_confirmation.html",
        '<a href="#">Contact us</a>\n<p>LINE: @YOUR_LINE_ID</p>\n',
    )

    issues = scan_for_placeholder_issues(repo_root)

    codes = {issue.code for issue in issues}
    assert "dead-cta" in codes
    assert "placeholder-contact" in codes


def test_public_surface_flags_missing_metadata(tmp_path):
    repo_root = build_repo_fixture(tmp_path)
    write_file(
        repo_root / "sandbox_pms_mvp" / "templates" / "base.html",
        "<html><head></head><body></body></html>",
    )

    issues = check_public_surface(repo_root)

    codes = {issue.code for issue in issues}
    assert "meta-description" in codes
    assert "canonical-link" in codes
    assert "skip-link" in codes


def test_required_docs_and_analytics_checks_report_missing_layers(tmp_path):
    repo_root = build_repo_fixture(tmp_path)
    docs_root = repo_root / "docs"
    docs_root.mkdir(parents=True, exist_ok=True)
    write_file(
        docs_root / "release-checklist.md",
        "Launch gate booking contact rollback monitoring\n",
    )
    write_file(
        docs_root / "rollback-checklist.md",
        "Rollback database Render smoke test\n",
    )
    write_file(
        docs_root / "production-secrets-map.md",
        "SECRET_KEY AUTH_ENCRYPTION_KEY DATABASE_URL Render\n",
    )
    write_file(
        docs_root / "monitoring-playbook.md",
        "health request_id logs booking\n",
    )
    write_file(
        docs_root / "measurement-spec.md",
        "dataLayer cta_click booking_request_submit consent\n",
    )

    doc_issues = check_required_docs(repo_root)
    analytics_issues = check_analytics_readiness(repo_root)

    assert doc_issues == []
    assert {issue.code for issue in analytics_issues} == {
        "analytics-missing",
        "analytics-events-missing",
        "consent-missing",
    }
