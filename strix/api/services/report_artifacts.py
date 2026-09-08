"""Canonical, versioned report artifacts for a run.

Today the PDF/markdown report is assembled on the fly by the frontend from
the run's findings. That is fine for preview, but it means two things we
don't want:

* different viewers can render subtly different "same" reports;
* there is no tamper-evident record of what was delivered.

This service builds a canonical report artifact on the backend, content
addresses it by SHA-256, and persists it under
``<run_dir>/reports/v<N>/``. Each artifact carries a schema version, the
hash, the creation timestamp, and the fully-rendered markdown + JSON
payload. New artifacts are *appended*; older versions are kept so we can
show a history timeline and verify integrity.

The service is idempotent: calling :meth:`build` twice with the same set
of findings + report markdown produces the same hash and reuses the
existing artifact directory rather than creating ``v2``.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from strix.api.services.report_renderers import (
    REPORT_BUNDLE_SCHEMA_VERSION,
    SUPPORTED_FORMATS,
    RenderResult,
    ReportBundle,
)
from strix.api.services.report_renderers import (
    render as render_report,
)


logger = logging.getLogger(__name__)


REPORT_SCHEMA_VERSION = 1


__all__ = [
    "REPORT_BUNDLE_SCHEMA_VERSION",
    "REPORT_SCHEMA_VERSION",
    "SUPPORTED_FORMATS",
    "RenderResult",
    "ReportArtifact",
    "ReportArtifactStore",
    "ReportBundle",
    "render_report",
]


@dataclass
class ReportArtifact:
    run_id: str
    version: int
    created_at: str
    sha256: str
    schema_version: int
    artifact_dir: Path
    markdown_path: Path
    payload_path: Path
    findings_count: int
    severity_counts: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "runId": self.run_id,
            "version": self.version,
            "createdAt": self.created_at,
            "sha256": self.sha256,
            "schemaVersion": self.schema_version,
            "markdownPath": str(self.markdown_path.relative_to(self.artifact_dir.parent.parent)),
            "payloadPath": str(self.payload_path.relative_to(self.artifact_dir.parent.parent)),
            "findingsCount": self.findings_count,
            "severityCounts": dict(self.severity_counts),
        }


class ReportArtifactStore:
    """Build and persist immutable report artifacts per run."""

    _REPORTS_SUBDIR = "reports"
    _INDEX_FILENAME = "index.json"

    def __init__(self, runs_dir: str | Path):
        self.runs_dir = Path(runs_dir)

    # ----- public API --------------------------------------------------------

    def build(
        self,
        run_id: str,
        *,
        findings: Iterable[dict[str, Any]],
        report_markdown: str,
    ) -> ReportArtifact:
        run_dir = self._run_dir(run_id)
        findings_list = list(findings)

        severity_counts = _count_severities(findings_list)
        payload = {
            "schemaVersion": REPORT_SCHEMA_VERSION,
            "runId": run_id,
            "findings": findings_list,
            "severityCounts": severity_counts,
        }
        payload_bytes = json.dumps(payload, sort_keys=True, indent=2).encode("utf-8")
        markdown_bytes = report_markdown.encode("utf-8")
        digest = hashlib.sha256(payload_bytes + markdown_bytes).hexdigest()

        existing = self._find_by_hash(run_id, digest)
        if existing is not None:
            return existing

        version = self._next_version(run_id)
        artifact_dir = run_dir / self._REPORTS_SUBDIR / f"v{version}"
        artifact_dir.mkdir(parents=True, exist_ok=True)

        markdown_path = artifact_dir / "report.md"
        payload_path = artifact_dir / "report.json"
        meta_path = artifact_dir / "meta.json"

        markdown_path.write_bytes(markdown_bytes)
        payload_path.write_bytes(payload_bytes)

        artifact = ReportArtifact(
            run_id=run_id,
            version=version,
            created_at=_iso_now(),
            sha256=digest,
            schema_version=REPORT_SCHEMA_VERSION,
            artifact_dir=artifact_dir,
            markdown_path=markdown_path,
            payload_path=payload_path,
            findings_count=len(findings_list),
            severity_counts=severity_counts,
        )
        meta_path.write_text(json.dumps(artifact.to_dict(), indent=2), encoding="utf-8")
        self._append_index(run_id, artifact)
        self._emit_event(run_id, artifact)
        return artifact

    def list_versions(self, run_id: str) -> list[ReportArtifact]:
        run_dir = self._run_dir(run_id)
        reports_dir = run_dir / self._REPORTS_SUBDIR
        if not reports_dir.is_dir():
            return []
        out: list[ReportArtifact] = []
        for entry in sorted(reports_dir.iterdir(), key=lambda p: p.name):
            if not entry.is_dir() or not entry.name.startswith("v"):
                continue
            meta_path = entry / "meta.json"
            if not meta_path.is_file():
                continue
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            out.append(_artifact_from_meta(run_dir, entry, meta))
        return out

    def get_version(self, run_id: str, version: int) -> ReportArtifact | None:
        for artifact in self.list_versions(run_id):
            if artifact.version == version:
                return artifact
        return None

    def latest(self, run_id: str) -> ReportArtifact | None:
        versions = self.list_versions(run_id)
        return versions[-1] if versions else None

    def verify(self, run_id: str, version: int) -> dict[str, Any]:
        artifact = self.get_version(run_id, version)
        if artifact is None:
            return {"ok": False, "reason": "artifact_not_found"}
        try:
            payload_bytes = artifact.payload_path.read_bytes()
            markdown_bytes = artifact.markdown_path.read_bytes()
        except OSError as exc:
            return {"ok": False, "reason": f"io_error:{exc}"}
        recomputed = hashlib.sha256(payload_bytes + markdown_bytes).hexdigest()
        return {
            "ok": recomputed == artifact.sha256,
            "expected": artifact.sha256,
            "actual": recomputed,
            "version": artifact.version,
        }

    # ----- helpers -----------------------------------------------------------

    def _run_dir(self, run_id: str) -> Path:
        return self.runs_dir / run_id

    def _next_version(self, run_id: str) -> int:
        existing = self.list_versions(run_id)
        return (existing[-1].version + 1) if existing else 1

    def _find_by_hash(self, run_id: str, digest: str) -> ReportArtifact | None:
        for artifact in self.list_versions(run_id):
            if artifact.sha256 == digest:
                return artifact
        return None

    def _append_index(self, run_id: str, artifact: ReportArtifact) -> None:
        run_dir = self._run_dir(run_id)
        index_path = run_dir / self._REPORTS_SUBDIR / self._INDEX_FILENAME
        index: list[dict[str, Any]] = []
        if index_path.is_file():
            try:
                loaded = json.loads(index_path.read_text(encoding="utf-8"))
                if isinstance(loaded, list):
                    index = [d for d in loaded if isinstance(d, dict)]
            except (OSError, json.JSONDecodeError):
                index = []
        index.append(artifact.to_dict())
        try:
            index_path.write_text(json.dumps(index, indent=2), encoding="utf-8")
        except OSError as exc:  # pragma: no cover - disk failure
            logger.warning("report_artifacts: failed to update index for %s: %s", run_id, exc)

    def _emit_event(self, run_id: str, artifact: ReportArtifact) -> None:
        run_dir = self._run_dir(run_id)
        events_path = run_dir / "events.jsonl"
        record = {
            "event_type": "report.artifact.created",
            "timestamp": artifact.created_at,
            "actor": None,
            "payload": {
                "version": artifact.version,
                "sha256": artifact.sha256,
                "findings": artifact.findings_count,
                "severityCounts": artifact.severity_counts,
            },
            "status": "created",
        }
        try:
            with events_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\n")
        except OSError as exc:  # pragma: no cover
            logger.warning(
                "report_artifacts: failed to emit event for %s v%d: %s",
                run_id,
                artifact.version,
                exc,
            )


# --- Helpers -----------------------------------------------------------------


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


def _count_severities(findings: list[dict[str, Any]]) -> dict[str, int]:
    out: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    for f in findings:
        sev = str(f.get("severity") or "info").lower()
        if sev in out:
            out[sev] += 1
    return out


def _artifact_from_meta(run_dir: Path, artifact_dir: Path, meta: dict[str, Any]) -> ReportArtifact:
    return ReportArtifact(
        run_id=str(meta.get("runId", run_dir.name)),
        version=int(meta.get("version", 0) or 0),
        created_at=str(meta.get("createdAt", "")),
        sha256=str(meta.get("sha256", "")),
        schema_version=int(
            meta.get("schemaVersion", REPORT_SCHEMA_VERSION) or REPORT_SCHEMA_VERSION
        ),
        artifact_dir=artifact_dir,
        markdown_path=artifact_dir / "report.md",
        payload_path=artifact_dir / "report.json",
        findings_count=int(meta.get("findingsCount", 0) or 0),
        severity_counts=dict(meta.get("severityCounts") or {}),
    )
