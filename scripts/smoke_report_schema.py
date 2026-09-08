"""Smoke test for FindingReport schema + legacy normalization."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def main() -> int:
    mod_path = Path(__file__).resolve().parent.parent / "strix" / "api" / "services" / "report_schema.py"
    spec = importlib.util.spec_from_file_location("report_schema", mod_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["report_schema"] = mod
    spec.loader.exec_module(mod)

    legacy_high = {
        "id": "vuln-abc",
        "title": "Reflected XSS on /search",
        "severity": "high",
        "target": "https://example.com/search",
        "description": "The q parameter reflects user input without encoding.",
        "technical_analysis": "GET /search?q=<svg onload=alert(1)> reflects into the page body.",
        "poc_description": "1. Visit /search?q=<svg onload=alert(1)>\n2. Observe alert() fires",
        "poc_script_code": "GET /search?q=%3Csvg%20onload=alert(1)%3E HTTP/1.1",
        "remediation_steps": "HTML-encode all user input server-side and set CSP.",
        "impact": "Arbitrary script execution in the victim's session.",
        "cvss": 6.1,
        "cvss_breakdown": {
            "attack_vector": "N", "attack_complexity": "L", "privileges_required": "N",
            "user_interaction": "R", "scope": "C", "confidentiality": "L",
            "integrity": "L", "availability": "N",
        },
        "cwe": "CWE-79",
        "references": ["https://owasp.org/Top10/A03_2021-Injection/"],
    }
    rep = mod.normalize_to_finding_report(legacy_high)
    assert rep.severity == "high"
    assert rep.cvss_vector.startswith("CVSS:3.1/")
    assert rep.cwe == ["CWE-79"]
    assert len(rep.steps_to_reproduce) >= 2
    assert str(rep.references[0]).startswith("https://owasp.org")

    legacy_critical_no_refs = dict(legacy_high)
    legacy_critical_no_refs["severity"] = "critical"
    legacy_critical_no_refs.pop("references")
    legacy_critical_no_refs["cwe"] = "CWE-89"
    rep2 = mod.normalize_to_finding_report(legacy_critical_no_refs)
    assert rep2.severity == "critical"
    assert len(rep2.references) >= 1, "critical must auto-fill a reference"

    try:
        mod.FindingReport(
            id="x", title="Test finding", severity="critical",
            cvss_vector="NOT-A-VECTOR", cvss_score=9.0,
            affected_asset="t", summary="some summary long enough",
            steps_to_reproduce=["s"], proof_of_concept="p",
            impact="impact text long enough",
            remediation="remediate long enough",
            references=["https://ex.com/"],
        )
    except Exception as exc:
        assert "cvss_vector" in str(exc).lower() or "CVSS" in str(exc), exc
    else:
        raise AssertionError("invalid CVSS must fail")

    try:
        mod.FindingReport(
            id="x", title="Needs refs", severity="critical",
            cvss_vector="CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
            cvss_score=9.8, affected_asset="t",
            summary="summary long enough text",
            steps_to_reproduce=["s"], proof_of_concept="p",
            impact="impact long enough",
            remediation="remediate long enough",
            references=[],
        )
    except Exception as exc:
        assert "reference" in str(exc).lower(), exc
    else:
        raise AssertionError("critical without refs must fail")

    legacy_info = {"title": "Server header leaks version", "severity": "info",
                   "target": "https://example.com/",
                   "description": "Response headers advertise exact server version",
                   "impact": "minor fingerprinting",
                   "remediation_steps": "Suppress Server header"}
    rep3 = mod.normalize_to_finding_report(legacy_info)
    assert rep3.severity == "informational"
    assert rep3.cvss_score == 0.0

    print("OK: FindingReport schema + normalization pass all cases")
    return 0


if __name__ == "__main__":
    sys.exit(main())
