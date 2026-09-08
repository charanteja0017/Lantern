"""Smoke test for report_renderers.py covering all 7 export formats."""

from __future__ import annotations

import importlib.util
import json
import sys
import types
from datetime import datetime, timezone
from pathlib import Path


def _stub_package(name: str) -> types.ModuleType:
    if name in sys.modules:
        return sys.modules[name]
    mod = types.ModuleType(name)
    mod.__path__ = []  # mark as package so submodule loads work
    sys.modules[name] = mod
    return mod


def _load(fqn: str, rel_path: str):
    mod_path = Path(__file__).resolve().parent.parent / rel_path
    spec = importlib.util.spec_from_file_location(fqn, mod_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[fqn] = mod
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    for pkg in ("strix", "strix.api", "strix.api.services"):
        _stub_package(pkg)
    schema_mod = _load(
        "strix.api.services.report_schema", "strix/api/services/report_schema.py"
    )
    sys.modules["strix.api.services"].report_schema = schema_mod  # type: ignore[attr-defined]
    renderers = _load(
        "strix.api.services.report_renderers",
        "strix/api/services/report_renderers.py",
    )

    high_finding = schema_mod.FindingReport(
        id="fn-1",
        title="Reflected XSS on /search",
        severity="high",
        cvss_vector="CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
        cvss_score=6.1,
        cwe=["CWE-79"],
        owasp_top10=["A03:2021 - Injection"],
        affected_asset="https://target.example.com/search",
        summary="The q parameter reflects user input without HTML-encoding.",
        steps_to_reproduce=[
            "Visit https://target.example.com/search?q=<svg onload=alert(1)>",
            "Observe the alert fires in the rendered page",
        ],
        proof_of_concept="curl 'https://target.example.com/search?q=%3Csvg%20onload=alert(1)%3E'",
        impact="Arbitrary JavaScript in the victim's browser context.",
        remediation="HTML-encode the q parameter on render and add a strict CSP.",
        references=["https://owasp.org/Top10/A03_2021-Injection/"],
        evidence_artifacts=["evidence/search-xss.png"],
    )
    medium_finding = schema_mod.FindingReport(
        id="fn-2",
        title="Missing Content-Security-Policy header",
        severity="medium",
        cvss_vector="CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N",
        cvss_score=5.3,
        cwe=[],
        owasp_top10=[],
        affected_asset="https://target.example.com",
        summary="All responses lack a CSP header, reducing XSS defence-in-depth.",
        steps_to_reproduce=[
            "curl -I https://target.example.com | grep -i content-security-policy",
            "Observe no CSP header is returned",
        ],
        proof_of_concept="curl -I https://target.example.com",
        impact="Weakens mitigation of other injection issues.",
        remediation="Set a default-src 'self' CSP with a per-request nonce.",
        references=[],
    )

    bundle = renderers.ReportBundle(
        run_id="run_test_1",
        run_name="Acme customer portal test",
        targets=["https://target.example.com"],
        scan_mode="deep",
        started_at=datetime(2026, 4, 1, 10, 0, tzinfo=timezone.utc),
        completed_at=datetime(2026, 4, 1, 11, 30, tzinfo=timezone.utc),
        executive_summary="Two findings: one high (stored XSS), one medium (CSP).",
        methodology="OWASP WSTG, black-box, authenticated as member.",
        technical_analysis="Findings below capture the consolidated issues.",
        recommendations="Patch XSS, add CSP, retest.",
        findings=[high_finding, medium_finding],
        severity_counts={"critical": 0, "high": 1, "medium": 1, "low": 0, "informational": 0},
    )

    outputs: dict[str, bytes] = {}
    for fmt in ("md", "txt", "html", "json", "sarif", "csv", "pdf"):
        result = renderers.render(bundle, fmt)
        assert isinstance(result.content, (bytes, bytearray)) and len(result.content) > 0, fmt
        assert result.content_type, fmt
        assert result.filename.endswith(
            {
                "md": ".md",
                "txt": ".txt",
                "html": ".html",
                "json": ".json",
                "sarif": ".sarif",
                "csv": ".csv",
                "pdf": (".pdf", ".pdf.unavailable.txt"),
            }[fmt] if isinstance(
                {
                    "md": ".md", "txt": ".txt", "html": ".html", "json": ".json",
                    "sarif": ".sarif", "csv": ".csv", "pdf": (".pdf", ".pdf.unavailable.txt"),
                }[fmt],
                str,
            ) else tuple(),
        ) or any(result.filename.endswith(suf) for suf in (".pdf", ".pdf.unavailable.txt"))
        outputs[fmt] = bytes(result.content)

    md = outputs["md"].decode("utf-8")
    assert "# Acme customer portal test" in md
    assert "Reflected XSS on /search" in md
    assert "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N" in md
    assert "CWE-79" in md

    txt = outputs["txt"].decode("utf-8")
    assert "Acme customer portal test" in txt
    assert "Reflected XSS on /search" in txt
    assert "#" not in txt

    html = outputs["html"].decode("utf-8")
    assert "<h1>Acme customer portal test" in html
    assert 'class="finding sev-high"' in html

    data = json.loads(outputs["json"])
    assert data["tool"]["name"] == "NovaHunter"
    assert len(data["findings"]) == 2
    assert data["summary"]["severityCounts"]["high"] == 1

    sarif = json.loads(outputs["sarif"])
    assert sarif["version"] == "2.1.0"
    assert len(sarif["runs"][0]["results"]) == 2
    assert sarif["runs"][0]["tool"]["driver"]["name"] == "NovaHunter"

    csv_txt = outputs["csv"].decode("utf-8")
    assert "finding_id" in csv_txt.splitlines()[0]
    assert "Reflected XSS on /search" in csv_txt

    pdf = outputs["pdf"]
    assert pdf.startswith(b"%PDF") or pdf.startswith(b"PDF export requires weasyprint")

    try:
        renderers.render(bundle, "xml")
    except ValueError as exc:
        assert "unsupported" in str(exc)
    else:
        raise AssertionError("unknown format must raise")

    print("OK: all 7 renderers (md, txt, html, pdf, json, sarif, csv) work")
    return 0


if __name__ == "__main__":
    sys.exit(main())
