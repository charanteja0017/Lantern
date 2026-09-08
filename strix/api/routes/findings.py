from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import Response as FastApiResponse

from strix.api.schemas import Finding, RunDetail
from strix.api.services.auth import Principal, require_analyst, require_any_member
from strix.api.services.report_artifacts import ReportArtifactStore
from strix.api.services.report_renderers import (
    SUPPORTED_FORMATS,
    ReportBundle,
)
from strix.api.services.report_renderers import (
    render as render_report,
)
from strix.api.services.report_schema import FindingReport, normalize_many
from strix.api.services.run_store import RunStore
from strix.api.settings import get_settings


router = APIRouter(prefix="/api/findings")


def _all_findings() -> list[Finding]:
    store = RunStore(get_settings().runs_dir)
    out: list[Finding] = []
    for summary in store.list_runs():
        detail = store.get(summary.id)
        if detail:
            out.extend(detail.findings)
    return out


def _all_findings_with_run() -> list[tuple[str, Finding]]:
    store = RunStore(get_settings().runs_dir)
    out: list[tuple[str, Finding]] = []
    for summary in store.list_runs():
        detail = store.get(summary.id)
        if detail:
            out.extend((summary.id, f) for f in detail.findings)
    return out


@router.get("", response_model=list[Finding])
async def list_findings(
    run_id: str | None = None,
    severity: str | None = None,
    _: Principal = Depends(require_any_member),
) -> list[Finding]:
    items: list[Finding]
    if run_id:
        store = RunStore(get_settings().runs_dir)
        detail = store.get(run_id)
        items = detail.findings if detail else []
    else:
        items = _all_findings()
    if severity:
        items = [f for f in items if f.severity == severity]
    return items


@router.get("/{finding_id}", response_model=Finding)
async def get_finding(finding_id: str, _: Principal = Depends(require_any_member)) -> Finding:
    for f in _all_findings():
        if f.id == finding_id:
            return f
    raise HTTPException(status_code=404, detail="Finding not found")


@router.post("/{finding_id}/triage")
async def triage_finding(
    finding_id: str,
    request: Request,
    principal: Principal = Depends(require_analyst),
) -> dict[str, object]:
    body = await request.json()
    status = str(body.get("status") or "").strip()
    note = str(body.get("note") or "").strip()
    allowed = {
        "open",
        "confirmed",
        "false_positive",
        "accepted_risk",
        "remediated",
        "retested_closed",
    }
    if status not in allowed:
        raise HTTPException(status_code=400, detail="invalid status transition target")
    matched = next((item for item in _all_findings_with_run() if item[1].id == finding_id), None)
    if matched is None:
        raise HTTPException(status_code=404, detail="Finding not found")
    run_id, _ = matched
    import datetime as _dt
    import json as _json
    from pathlib import Path

    events_path = Path(get_settings().runs_dir) / run_id / "events.jsonl"
    rec = {
        "event_type": "finding.triage.updated",
        "timestamp": _dt.datetime.now(_dt.UTC).isoformat(),
        "actor": {"user_id": principal.user_id, "email": principal.email},
        "payload": {"finding_id": finding_id, "status": status, "note": note},
        "status": status,
    }
    with events_path.open("a", encoding="utf-8") as fh:
        fh.write(_json.dumps(rec) + "\n")
    try:
        from strix.api.services.integrations import dispatch_event

        await dispatch_event(
            "finding.triage.updated",
            {
                "finding_id": finding_id,
                "run_id": run_id,
                "status": status,
                "note": note,
                "summary": f"Finding {finding_id} triaged to {status}",
            },
        )
    except Exception:
        pass
    return {"findingId": finding_id, "runId": run_id, "status": status, "note": note}


@router.post("/{finding_id}/retest")
async def retest_finding(
    finding_id: str,
    principal: Principal = Depends(require_analyst),
) -> dict[str, object]:
    matched = next((item for item in _all_findings_with_run() if item[1].id == finding_id), None)
    if matched is None:
        raise HTTPException(status_code=404, detail="Finding not found")
    run_id, finding = matched
    import datetime as _dt
    import json as _json
    from pathlib import Path

    events_path = Path(get_settings().runs_dir) / run_id / "events.jsonl"
    rec = {
        "event_type": "finding.retest.requested",
        "timestamp": _dt.datetime.now(_dt.UTC).isoformat(),
        "actor": {"user_id": principal.user_id, "email": principal.email},
        "payload": {
            "finding_id": finding_id,
            "target": finding.target or finding.endpoint or "",
            "endpoint": finding.endpoint or "",
            "method": finding.method or "GET",
            "poc_script": finding.poc_script or "",
        },
        "status": "queued",
    }
    with events_path.open("a", encoding="utf-8") as fh:
        fh.write(_json.dumps(rec) + "\n")
    try:
        from strix.api.services.integrations import dispatch_event

        await dispatch_event(
            "finding.retest.requested",
            {
                "finding_id": finding_id,
                "run_id": run_id,
                "title": finding.title,
                "target": finding.target,
                "endpoint": finding.endpoint,
                "summary": f"Retest requested for {finding.title}",
            },
        )
    except Exception:
        pass
    return {"findingId": finding_id, "runId": run_id, "queued": True}


# --- Report artifact endpoints ----------------------------------------------

# These endpoints live on the findings router because they are intrinsically
# tied to the run's findings list. They expose the canonical, versioned
# report artifact built on the backend. The frontend should prefer these
# over rebuilding the report locally so the downloaded PDF and the API's
# view agree byte-for-byte.

reports_router = APIRouter(prefix="/api/runs")


def _artifact_store() -> ReportArtifactStore:
    return ReportArtifactStore(get_settings().runs_dir)


@reports_router.get("/{run_id}/report/versions")
async def list_report_versions(
    run_id: str, _: Principal = Depends(require_any_member)
) -> dict[str, object]:
    versions = _artifact_store().list_versions(run_id)
    return {"runId": run_id, "versions": [v.to_dict() for v in versions]}


@reports_router.post("/{run_id}/report/build")
async def build_report(run_id: str, _: Principal = Depends(require_analyst)) -> dict[str, object]:
    store = RunStore(get_settings().runs_dir)
    detail = store.get(run_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Run not found")
    findings_payload = [f.model_dump(by_alias=False) for f in detail.findings]
    markdown = detail.report_markdown or ""
    artifact = _artifact_store().build(run_id, findings=findings_payload, report_markdown=markdown)
    return {"runId": run_id, "artifact": artifact.to_dict()}


@reports_router.get("/{run_id}/report/latest")
async def get_latest_report(
    run_id: str, _: Principal = Depends(require_any_member)
) -> dict[str, object]:
    artifact = _artifact_store().latest(run_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="No report artifact for run")
    return {"runId": run_id, "artifact": artifact.to_dict()}


@reports_router.get("/{run_id}/report/{version}/verify")
async def verify_report(
    run_id: str, version: int, _: Principal = Depends(require_any_member)
) -> dict[str, object]:
    result = _artifact_store().verify(run_id, version)
    if not result.get("ok") and result.get("reason") == "artifact_not_found":
        raise HTTPException(status_code=404, detail="Report version not found")
    return {"runId": run_id, "version": version, **result}


# --- Multi-format export endpoints ------------------------------------------
#
# The agent + Tracer write a run's findings and report to ``strix_runs/``.
# These endpoints render that content into the format the operator asks for
# at download time (Markdown, plaintext, HTML, PDF, JSON, SARIF, CSV).
#
# ETag: we hash the bundle's stable seed so browsers/CLIs can cache, and the
# endpoint replies 304 Not Modified when If-None-Match matches.

_FORMAT_ALIASES: dict[str, str] = {
    "markdown": "md",
    "plain": "txt",
    "text": "txt",
}


@reports_router.get("/{run_id}/report.{fmt}")
async def export_report(
    run_id: str,
    fmt: str,
    request: Request,
    _: Principal = Depends(require_any_member),
) -> Response:
    """Render and stream the run report in ``fmt`` (md/txt/html/pdf/json/sarif/csv)."""
    fmt_norm = _FORMAT_ALIASES.get(fmt.lower(), fmt.lower())
    if fmt_norm not in SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format. Choose one of: {', '.join(SUPPORTED_FORMATS)}",
        )

    store = RunStore(get_settings().runs_dir)
    detail = store.get(run_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Run not found")

    bundle = _build_bundle(detail)
    result = render_report(bundle, fmt_norm)

    etag = (
        '"'
        + hashlib.sha256(
            (result.etag_seed + "|" + result.content_type).encode("utf-8")
        ).hexdigest()[:32]
        + '"'
    )

    if_none_match = request.headers.get("if-none-match")
    if if_none_match and etag in {t.strip() for t in if_none_match.split(",")}:
        return FastApiResponse(status_code=304, headers={"ETag": etag})

    headers = {
        "ETag": etag,
        "Cache-Control": "private, max-age=0, must-revalidate",
        "Content-Disposition": f'attachment; filename="{result.filename}"',
        "X-NovaHunter-Report-Format": fmt_norm,
    }
    if fmt_norm == "pdf" and not result.content.startswith(b"%PDF"):
        # weasyprint unavailable stub; surface 501 so the client can fall back.
        headers["Content-Disposition"] = f'inline; filename="{result.filename}"'
        return FastApiResponse(
            content=result.content,
            media_type=result.content_type,
            status_code=501,
            headers=headers,
        )

    return FastApiResponse(content=result.content, media_type=result.content_type, headers=headers)


# --- bundle builder ---------------------------------------------------------


_SECTION_MAP = {
    "executive summary": "executive_summary",
    "methodology": "methodology",
    "technical analysis": "technical_analysis",
    "recommendations": "recommendations",
}


def _build_bundle(detail: RunDetail) -> ReportBundle:
    """Fold a ``RunDetail`` into a :class:`ReportBundle` for the renderers."""
    sections = _split_report_sections(detail.report_markdown or "")
    findings = _normalize_findings(detail.findings)
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "informational": 0}
    for f in findings:
        counts[f.severity] = counts.get(f.severity, 0) + 1
    return ReportBundle(
        run_id=detail.id,
        run_name=detail.name or detail.id,
        targets=list(detail.targets or []),
        scan_mode=str(detail.scan_mode),
        started_at=_parse_iso(detail.created_at),
        completed_at=_parse_iso(detail.finished_at or detail.updated_at),
        executive_summary=sections.get("executive_summary", ""),
        methodology=sections.get("methodology", ""),
        technical_analysis=sections.get("technical_analysis", ""),
        recommendations=sections.get("recommendations", ""),
        findings=findings,
        severity_counts=counts,
    )


def _split_report_sections(markdown: str) -> dict[str, str]:
    """Split a ``# <Section>`` top-level Markdown report into section bodies.

    Matches the format written by :meth:`Tracer.update_scan_final_fields`.
    """
    out: dict[str, str] = {}
    if not markdown:
        return out
    lines = markdown.splitlines()
    current_key: str | None = None
    buffer: list[str] = []
    header_re = re.compile(r"^#\s+(.+?)\s*$")
    for line in lines:
        match = header_re.match(line)
        if match:
            if current_key is not None:
                out[current_key] = "\n".join(buffer).strip()
            title = match.group(1).strip().lower()
            current_key = _SECTION_MAP.get(title)
            buffer = []
        elif current_key is not None:
            buffer.append(line)
    if current_key is not None:
        out[current_key] = "\n".join(buffer).strip()
    return out


def _normalize_findings(findings: list[Finding]) -> list[FindingReport]:
    raw: list[dict[str, Any]] = []
    for f in findings:
        raw.append(
            {
                "id": f.id,
                "title": f.title,
                "severity": f.severity,
                "target": f.target or f.endpoint or "unknown",
                "description": f.description or "",
                "impact": f.impact,
                "technical_analysis": f.technical_analysis,
                "poc_description": f.poc_description,
                "poc_script_code": f.poc_script,
                "remediation": f.remediation,
                "cvss": f.cvss,
                "cwe": [f.cwe] if f.cwe else [],
                "discovered_at": f.timestamp,
            }
        )
    return normalize_many(raw)


def _parse_iso(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
