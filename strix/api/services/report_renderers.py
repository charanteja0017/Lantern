"""Backend renderers for exported reports.

Multi-format output: Markdown, plaintext, HTML, PDF (weasyprint), JSON,
SARIF 2.1.0, CSV. Each renderer consumes a :class:`ReportBundle` produced
by the run export pipeline and returns ``(content_bytes, content_type,
suggested_filename)``.

The renderers are pure functions over the bundle - they never touch the
filesystem or the run events directly. That keeps them trivially
testable, and lets callers cache / ETag the outputs by bundle hash.

PDF notes: weasyprint is heavy (Cairo/Pango dependency). We import it
lazily so the rest of the API does not need it on dev machines. If it
is not installed, the renderer returns a clear ``501``-style error
bytes + the ``text/plain`` content type; the route layer translates that
into an HTTP 501.
"""

from __future__ import annotations

import csv
import html as html_escape
import io
import json
import logging
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from strix.api.services.report_schema import FindingReport


logger = logging.getLogger(__name__)

REPORT_BUNDLE_SCHEMA_VERSION = 1


# --- bundle ------------------------------------------------------------------


@dataclass
class ReportBundle:
    """Fully-rendered report input, one per run export."""

    run_id: str
    run_name: str
    targets: list[str]
    scan_mode: str
    started_at: datetime | None
    completed_at: datetime | None
    executive_summary: str
    methodology: str
    technical_analysis: str
    recommendations: str
    findings: list[FindingReport]
    severity_counts: dict[str, int] = field(default_factory=dict)
    generated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    tool: str = "NovaHunter"
    tool_version: str = "0.1.0"

    @classmethod
    def from_legacy(
        cls,
        run_id: str,
        *,
        run_metadata: dict[str, Any] | None,
        report: dict[str, Any] | None,
        findings: list[FindingReport],
    ) -> ReportBundle:
        run_metadata = run_metadata or {}
        report = report or {}
        counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "informational": 0}
        for f in findings:
            counts[f.severity] = counts.get(f.severity, 0) + 1
        return cls(
            run_id=run_id,
            run_name=str(run_metadata.get("run_name") or run_id),
            targets=[str(t) for t in (run_metadata.get("targets") or [])],
            scan_mode=str(run_metadata.get("scan_mode") or "deep"),
            started_at=_parse_iso(run_metadata.get("started_at")),
            completed_at=_parse_iso(run_metadata.get("completed_at")),
            executive_summary=str(report.get("executive_summary") or "").strip(),
            methodology=str(report.get("methodology") or "").strip(),
            technical_analysis=str(report.get("technical_analysis") or "").strip(),
            recommendations=str(report.get("recommendations") or "").strip(),
            findings=list(findings),
            severity_counts=counts,
        )


@dataclass
class RenderResult:
    content: bytes
    content_type: str
    filename: str
    etag_seed: str


RendererFn = Callable[[ReportBundle], RenderResult]


# --- public API --------------------------------------------------------------


SUPPORTED_FORMATS: tuple[str, ...] = ("md", "txt", "html", "pdf", "json", "sarif", "csv")


def render(bundle: ReportBundle, fmt: str) -> RenderResult:
    """Render ``bundle`` into ``fmt``. Raises ValueError on unknown format."""
    fmt_lower = fmt.strip().lower()
    renderer = _RENDERERS.get(fmt_lower)
    if renderer is None:
        raise ValueError(f"unsupported report format {fmt!r}; choose from {SUPPORTED_FORMATS}")
    return renderer(bundle)


# --- renderers ---------------------------------------------------------------


def _render_markdown(bundle: ReportBundle) -> RenderResult:
    lines: list[str] = []
    lines.append(f"# {bundle.run_name} — Penetration Test Report")
    lines.append("")
    lines.append(f"- **Run ID**: `{bundle.run_id}`")
    lines.append(f"- **Tool**: {bundle.tool} {bundle.tool_version}")
    lines.append(f"- **Scan mode**: `{bundle.scan_mode}`")
    lines.append(f"- **Targets**: {', '.join(bundle.targets) or '(none)'}")
    if bundle.started_at:
        lines.append(f"- **Started**: {_fmt_dt(bundle.started_at)}")
    if bundle.completed_at:
        lines.append(f"- **Completed**: {_fmt_dt(bundle.completed_at)}")
    lines.append(f"- **Generated**: {_fmt_dt(bundle.generated_at)}")
    lines.append("")
    lines.append("## Executive summary")
    lines.append("")
    lines.append(bundle.executive_summary or "_No executive summary provided._")
    lines.append("")
    lines.append("## Risk at a glance")
    lines.append("")
    lines.append("| Severity | Count |")
    lines.append("|-----------|-------|")
    for sev in ("critical", "high", "medium", "low", "informational"):
        lines.append(f"| {sev.capitalize()} | {bundle.severity_counts.get(sev, 0)} |")
    lines.append("")
    if bundle.methodology:
        lines.append("## Methodology")
        lines.append("")
        lines.append(bundle.methodology)
        lines.append("")
    if bundle.technical_analysis:
        lines.append("## Technical analysis")
        lines.append("")
        lines.append(bundle.technical_analysis)
        lines.append("")
    if bundle.recommendations:
        lines.append("## Recommendations")
        lines.append("")
        lines.append(bundle.recommendations)
        lines.append("")

    lines.append("## Findings")
    lines.append("")
    if not bundle.findings:
        lines.append("_No findings were reported for this run._")
        lines.append("")
    else:
        for idx, f in enumerate(sorted(bundle.findings, key=_severity_sort_key), start=1):
            lines.extend(_render_finding_markdown(idx, f))
            lines.append("")

    body = "\n".join(lines).rstrip() + "\n"
    return RenderResult(
        content=body.encode("utf-8"),
        content_type="text/markdown; charset=utf-8",
        filename=f"{_slug(bundle.run_name)}-report.md",
        etag_seed=body,
    )


def _render_finding_markdown(idx: int, f: FindingReport) -> list[str]:
    out: list[str] = []
    out.append(f"### {idx}. {f.title}  `[{f.severity.upper()}]`")
    out.append("")
    out.append(f"- **Finding ID**: `{f.id}`")
    out.append(f"- **CVSS**: {f.cvss_score} (`{f.cvss_vector}`)")
    if f.cwe:
        out.append(f"- **CWE**: {', '.join(f.cwe)}")
    if f.owasp_top10:
        out.append(f"- **OWASP Top 10**: {', '.join(f.owasp_top10)}")
    out.append(f"- **Affected asset**: `{f.affected_asset}`")
    out.append(f"- **Discovered by**: {f.discovered_by_agent}")
    out.append(f"- **Discovered at**: {_fmt_dt(f.discovered_at)}")
    out.append("")
    out.append("**Summary**")
    out.append("")
    out.append(f.summary)
    out.append("")
    out.append("**Steps to reproduce**")
    out.append("")
    for step_idx, step in enumerate(f.steps_to_reproduce, start=1):
        out.append(f"{step_idx}. {step}")
    out.append("")
    out.append("**Proof of concept**")
    out.append("")
    out.append("```")
    out.append(f.proof_of_concept)
    out.append("```")
    out.append("")
    out.append("**Impact**")
    out.append("")
    out.append(f.impact)
    out.append("")
    out.append("**Remediation**")
    out.append("")
    out.append(f.remediation)
    out.append("")
    if f.references:
        out.append("**References**")
        out.append("")
        for ref in f.references:
            out.append(f"- {ref}")
        out.append("")
    if f.evidence_artifacts:
        out.append("**Evidence artifacts**")
        out.append("")
        for art in f.evidence_artifacts:
            out.append(f"- `{art}`")
        out.append("")
    return out


def _render_plaintext(bundle: ReportBundle) -> RenderResult:
    md = _render_markdown(bundle).content.decode("utf-8")
    # Flatten markdown into plaintext: strip headers/formatting, keep structure.
    text = re.sub(r"^#+\s*", "", md, flags=re.MULTILINE)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"^\|.*\|$", _table_row_to_plain, text, flags=re.MULTILINE)
    text = re.sub(r"^[-|]+$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"
    return RenderResult(
        content=text.encode("utf-8"),
        content_type="text/plain; charset=utf-8",
        filename=f"{_slug(bundle.run_name)}-report.txt",
        etag_seed=text,
    )


def _table_row_to_plain(match: re.Match[str]) -> str:
    row = match.group(0)
    cells = [c.strip() for c in row.strip("|").split("|")]
    return " - ".join(c for c in cells if c)


def _render_html(bundle: ReportBundle) -> RenderResult:
    parts: list[str] = []
    parts.append("<!doctype html>")
    parts.append('<html lang="en"><head><meta charset="utf-8" />')
    parts.append(f"<title>{html_escape.escape(bundle.run_name)} — Penetration Test Report</title>")
    parts.append("<style>")
    parts.append(
        """
        :root { color-scheme: light dark; }
        body { font-family: 'Inter', -apple-system, sans-serif; max-width: 780px;
               margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
        h1, h2, h3 { font-weight: 600; }
        h1 { border-bottom: 1px solid #888; padding-bottom: .5rem; }
        h3.finding { border-left: 4px solid currentColor; padding-left: .5rem; }
        .sev-critical { color: #b10000; }
        .sev-high { color: #c03b00; }
        .sev-medium { color: #b07600; }
        .sev-low { color: #0b6fba; }
        .sev-informational { color: #555; }
        table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
        th, td { border: 1px solid #ccc; padding: .4rem .6rem; text-align: left; }
        th { background: #f3f4f6; }
        pre, code { font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
                    font-size: 0.9em; }
        pre { background: #111; color: #eee; padding: 1rem; overflow-x: auto;
              border-radius: 6px; }
        dl { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; }
        dt { font-weight: 600; }
        ul { padding-left: 1.5rem; }
        """
    )
    parts.append("</style></head><body>")
    parts.append(f"<h1>{html_escape.escape(bundle.run_name)} — Penetration Test Report</h1>")
    parts.append("<dl>")
    parts.append(f"<dt>Run ID</dt><dd><code>{html_escape.escape(bundle.run_id)}</code></dd>")
    parts.append(
        f"<dt>Tool</dt><dd>{html_escape.escape(bundle.tool)} {html_escape.escape(bundle.tool_version)}</dd>"
    )
    parts.append(f"<dt>Scan mode</dt><dd><code>{html_escape.escape(bundle.scan_mode)}</code></dd>")
    parts.append(
        "<dt>Targets</dt><dd>"
        + (", ".join(html_escape.escape(t) for t in bundle.targets) or "(none)")
        + "</dd>"
    )
    if bundle.started_at:
        parts.append(f"<dt>Started</dt><dd>{_fmt_dt(bundle.started_at)}</dd>")
    if bundle.completed_at:
        parts.append(f"<dt>Completed</dt><dd>{_fmt_dt(bundle.completed_at)}</dd>")
    parts.append(f"<dt>Generated</dt><dd>{_fmt_dt(bundle.generated_at)}</dd>")
    parts.append("</dl>")

    parts.append("<h2>Executive summary</h2>")
    parts.append(
        _markdownish_to_html(bundle.executive_summary or "_No executive summary provided._")
    )

    parts.append("<h2>Risk at a glance</h2>")
    parts.append("<table><thead><tr><th>Severity</th><th>Count</th></tr></thead><tbody>")
    for sev in ("critical", "high", "medium", "low", "informational"):
        parts.append(
            f'<tr class="sev-{sev}"><td>{sev.capitalize()}</td>'
            f"<td>{bundle.severity_counts.get(sev, 0)}</td></tr>"
        )
    parts.append("</tbody></table>")

    for title, body in (
        ("Methodology", bundle.methodology),
        ("Technical analysis", bundle.technical_analysis),
        ("Recommendations", bundle.recommendations),
    ):
        if body:
            parts.append(f"<h2>{title}</h2>")
            parts.append(_markdownish_to_html(body))

    parts.append("<h2>Findings</h2>")
    if not bundle.findings:
        parts.append("<p><em>No findings were reported for this run.</em></p>")
    else:
        for idx, f in enumerate(sorted(bundle.findings, key=_severity_sort_key), start=1):
            parts.extend(_render_finding_html(idx, f))

    parts.append("</body></html>")
    html_str = "\n".join(parts)
    return RenderResult(
        content=html_str.encode("utf-8"),
        content_type="text/html; charset=utf-8",
        filename=f"{_slug(bundle.run_name)}-report.html",
        etag_seed=html_str,
    )


def _render_finding_html(idx: int, f: FindingReport) -> list[str]:
    out: list[str] = []
    out.append(
        f'<h3 class="finding sev-{f.severity}">{idx}. {html_escape.escape(f.title)} '
        f"[{html_escape.escape(f.severity.upper())}]</h3>"
    )
    out.append("<dl>")
    out.append(f"<dt>Finding ID</dt><dd><code>{html_escape.escape(f.id)}</code></dd>")
    out.append(
        f"<dt>CVSS</dt><dd>{f.cvss_score} (<code>{html_escape.escape(f.cvss_vector)}</code>)</dd>"
    )
    if f.cwe:
        out.append("<dt>CWE</dt><dd>" + ", ".join(html_escape.escape(c) for c in f.cwe) + "</dd>")
    if f.owasp_top10:
        out.append(
            "<dt>OWASP Top 10</dt><dd>"
            + ", ".join(html_escape.escape(o) for o in f.owasp_top10)
            + "</dd>"
        )
    out.append(
        f"<dt>Affected asset</dt><dd><code>{html_escape.escape(f.affected_asset)}</code></dd>"
    )
    out.append(f"<dt>Discovered by</dt><dd>{html_escape.escape(f.discovered_by_agent)}</dd>")
    out.append(f"<dt>Discovered at</dt><dd>{_fmt_dt(f.discovered_at)}</dd>")
    out.append("</dl>")
    out.append("<h4>Summary</h4>")
    out.append(_markdownish_to_html(f.summary))
    out.append("<h4>Steps to reproduce</h4><ol>")
    for step in f.steps_to_reproduce:
        out.append(f"<li>{html_escape.escape(step)}</li>")
    out.append("</ol>")
    out.append("<h4>Proof of concept</h4>")
    out.append(f"<pre><code>{html_escape.escape(f.proof_of_concept)}</code></pre>")
    out.append("<h4>Impact</h4>")
    out.append(_markdownish_to_html(f.impact))
    out.append("<h4>Remediation</h4>")
    out.append(_markdownish_to_html(f.remediation))
    if f.references:
        out.append("<h4>References</h4><ul>")
        for ref in f.references:
            url = html_escape.escape(str(ref))
            out.append(f'<li><a href="{url}">{url}</a></li>')
        out.append("</ul>")
    if f.evidence_artifacts:
        out.append("<h4>Evidence artifacts</h4><ul>")
        for art in f.evidence_artifacts:
            out.append(f"<li><code>{html_escape.escape(art)}</code></li>")
        out.append("</ul>")
    return out


def _render_pdf(bundle: ReportBundle) -> RenderResult:
    html_result = _render_html(bundle)
    try:
        from weasyprint import HTML
    except Exception as exc:
        logger.warning("weasyprint unavailable (%s); returning install-required stub", exc)
        stub = (
            b"PDF export requires weasyprint. Install Cairo/Pango + "
            b"`pip install weasyprint` on the API container and retry. "
            b"Falling back to HTML export at the same URL but with .html suffix."
        )
        return RenderResult(
            content=stub,
            content_type="text/plain; charset=utf-8",
            filename=f"{_slug(bundle.run_name)}-report.pdf.unavailable.txt",
            etag_seed=stub.decode("utf-8"),
        )

    pdf_bytes = HTML(string=html_result.content.decode("utf-8")).write_pdf()
    assert pdf_bytes is not None
    return RenderResult(
        content=pdf_bytes,
        content_type="application/pdf",
        filename=f"{_slug(bundle.run_name)}-report.pdf",
        etag_seed=html_result.etag_seed,
    )


def _render_json(bundle: ReportBundle) -> RenderResult:
    payload = _bundle_to_jsonable(bundle)
    blob = json.dumps(payload, indent=2, sort_keys=True, default=str).encode("utf-8")
    return RenderResult(
        content=blob,
        content_type="application/json",
        filename=f"{_slug(bundle.run_name)}-report.json",
        etag_seed=blob.decode("utf-8"),
    )


def _render_sarif(bundle: ReportBundle) -> RenderResult:
    results: list[dict[str, Any]] = []
    rules: dict[str, dict[str, Any]] = {}
    severity_to_level = {
        "critical": "error",
        "high": "error",
        "medium": "warning",
        "low": "note",
        "informational": "none",
    }

    for f in bundle.findings:
        rule_id = f.cwe[0] if f.cwe else _slug(f.title)[:32] or "novahunter.finding"
        rules.setdefault(
            rule_id,
            {
                "id": rule_id,
                "name": rule_id,
                "shortDescription": {"text": f.title[:140]},
                "fullDescription": {"text": f.summary[:1000]},
                "helpUri": (str(f.references[0]) if f.references else None),
                "properties": {
                    "tags": sorted({*(f.cwe or []), *(f.owasp_top10 or [])}),
                },
            },
        )
        result: dict[str, Any] = {
            "ruleId": rule_id,
            "level": severity_to_level.get(f.severity, "warning"),
            "message": {"text": f"{f.title} — {f.summary[:300]}"},
            "properties": {
                "findingId": f.id,
                "cvss": {"vector": f.cvss_vector, "score": f.cvss_score},
                "severity": f.severity,
                "cwe": list(f.cwe),
                "owaspTop10": list(f.owasp_top10),
                "stepsToReproduce": list(f.steps_to_reproduce),
                "proofOfConcept": f.proof_of_concept,
                "impact": f.impact,
                "remediation": f.remediation,
                "discoveredByAgent": f.discovered_by_agent,
                "discoveredAt": f.discovered_at.isoformat(),
            },
            "locations": [{"physicalLocation": {"artifactLocation": {"uri": f.affected_asset}}}],
        }
        if f.references:
            result["relatedLocations"] = [
                {
                    "physicalLocation": {
                        "artifactLocation": {"uri": str(ref)},
                    },
                    "message": {"text": "reference"},
                }
                for ref in f.references
            ]
        results.append(result)

    sarif = {
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "version": "2.1.0",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": bundle.tool,
                        "version": bundle.tool_version,
                        "informationUri": "https://novahunter.dev",
                        "rules": [v for _, v in sorted(rules.items())],
                    }
                },
                "invocations": [
                    {
                        "executionSuccessful": True,
                        "endTimeUtc": (bundle.completed_at or bundle.generated_at)
                        .astimezone(UTC)
                        .isoformat(),
                        "startTimeUtc": (bundle.started_at or bundle.generated_at)
                        .astimezone(UTC)
                        .isoformat(),
                        "workingDirectory": {"uri": "file:///workspace"},
                    }
                ],
                "results": results,
                "properties": {
                    "runId": bundle.run_id,
                    "runName": bundle.run_name,
                    "targets": list(bundle.targets),
                    "scanMode": bundle.scan_mode,
                    "severityCounts": dict(bundle.severity_counts),
                },
            }
        ],
    }
    blob = json.dumps(sarif, indent=2, sort_keys=True, default=str).encode("utf-8")
    return RenderResult(
        content=blob,
        content_type="application/sarif+json",
        filename=f"{_slug(bundle.run_name)}-report.sarif",
        etag_seed=blob.decode("utf-8"),
    )


def _render_csv(bundle: ReportBundle) -> RenderResult:
    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_ALL)
    writer.writerow(
        [
            "finding_id",
            "title",
            "severity",
            "cvss_score",
            "cvss_vector",
            "cwe",
            "owasp_top10",
            "affected_asset",
            "summary",
            "impact",
            "remediation",
            "references",
            "discovered_by_agent",
            "discovered_at",
        ]
    )
    for f in sorted(bundle.findings, key=_severity_sort_key):
        writer.writerow(
            [
                f.id,
                f.title,
                f.severity,
                f.cvss_score,
                f.cvss_vector,
                ";".join(f.cwe),
                ";".join(f.owasp_top10),
                f.affected_asset,
                f.summary,
                f.impact,
                f.remediation,
                ";".join(str(r) for r in f.references),
                f.discovered_by_agent,
                f.discovered_at.isoformat(),
            ]
        )
    blob = buf.getvalue().encode("utf-8")
    return RenderResult(
        content=blob,
        content_type="text/csv; charset=utf-8",
        filename=f"{_slug(bundle.run_name)}-findings.csv",
        etag_seed=blob.decode("utf-8"),
    )


_RENDERERS: dict[str, RendererFn] = {
    "md": _render_markdown,
    "markdown": _render_markdown,
    "txt": _render_plaintext,
    "plain": _render_plaintext,
    "html": _render_html,
    "pdf": _render_pdf,
    "json": _render_json,
    "sarif": _render_sarif,
    "csv": _render_csv,
}


# --- helpers -----------------------------------------------------------------


def _bundle_to_jsonable(bundle: ReportBundle) -> dict[str, Any]:
    return {
        "schemaVersion": REPORT_BUNDLE_SCHEMA_VERSION,
        "tool": {"name": bundle.tool, "version": bundle.tool_version},
        "run": {
            "id": bundle.run_id,
            "name": bundle.run_name,
            "targets": list(bundle.targets),
            "scanMode": bundle.scan_mode,
            "startedAt": bundle.started_at.isoformat() if bundle.started_at else None,
            "completedAt": bundle.completed_at.isoformat() if bundle.completed_at else None,
            "generatedAt": bundle.generated_at.isoformat(),
        },
        "summary": {
            "executive_summary": bundle.executive_summary,
            "methodology": bundle.methodology,
            "technical_analysis": bundle.technical_analysis,
            "recommendations": bundle.recommendations,
            "severityCounts": dict(bundle.severity_counts),
        },
        "findings": [json.loads(f.model_dump_json()) for f in bundle.findings],
    }


_SEV_ORDER: dict[str, int] = {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 3,
    "informational": 4,
}


def _severity_sort_key(f: FindingReport) -> tuple[int, str]:
    return _SEV_ORDER.get(f.severity, 5), f.title.lower()


def _slug(text: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "-", (text or "").strip()).strip("-").lower()
    return cleaned or "report"


def _fmt_dt(dt: datetime | None) -> str:
    if dt is None:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")


def _parse_iso(raw: Any) -> datetime | None:
    if not raw:
        return None
    if isinstance(raw, datetime):
        return raw
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _markdownish_to_html(text: str) -> str:
    """Very light markdown -> HTML conversion (paragraphs, bullets, bold, code)."""
    if not text:
        return ""
    escaped = html_escape.escape(text).replace("\r\n", "\n")
    escaped = re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)
    paragraphs: list[str] = []
    for block in re.split(r"\n\n+", escaped):
        stripped = block.strip()
        if not stripped:
            continue
        lines = stripped.split("\n")
        if all(ln.lstrip().startswith(("- ", "* ")) for ln in lines):
            items = "".join(f"<li>{ln.lstrip()[2:].strip()}</li>" for ln in lines)
            paragraphs.append(f"<ul>{items}</ul>")
        elif all(re.match(r"^\d+\.\s", ln) for ln in lines):
            items = "".join(f"<li>{re.sub(r'^\d+\.\s', '', ln).strip()}</li>" for ln in lines)
            paragraphs.append(f"<ol>{items}</ol>")
        else:
            paragraphs.append("<p>" + "<br/>".join(lines) + "</p>")
    return "\n".join(paragraphs)


# --- compat re-exports -------------------------------------------------------
# The plan targets ``strix/api/services/report_artifacts.py`` as the home for
# renderers. We keep the actual implementation here for clarity and surface it
# through ``report_artifacts`` via explicit re-export (see that module).

__all__ = [
    "REPORT_BUNDLE_SCHEMA_VERSION",
    "SUPPORTED_FORMATS",
    "RenderResult",
    "RendererFn",
    "ReportBundle",
    "render",
]


def iter_renderers() -> Iterable[tuple[str, RendererFn]]:
    return _RENDERERS.items()
