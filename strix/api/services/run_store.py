"""Read-side run store backed by the existing ``strix_runs/`` directory.

This avoids duplicating the Tracer's write-path: the Tracer already writes
``events.jsonl`` for every lifecycle event plus vulnerability markdown files
and the final report. We read those artifacts to materialize
``RunSummary`` / ``RunDetail`` responses.

For mutations (create run, send message, stop agent) we emit events into the
same JSONL so the dashboard sees an immediate update while the full
orchestration is attached via background workers.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, cast

from strix.api.schemas import (
    AgentNode,
    ChatMessage,
    Finding,
    Owner,
    RunDetail,
    RunStats,
    RunStatus,
    RunSummary,
    SeverityCounts,
    TimelineEvent,
    ToolExecution,
)
from strix.api.services.events import read_events


_DEFAULT_OWNER = Owner(id="user", name="Operator")

ScanMode = Literal["quick", "standard", "deep"]
ScopeMode = Literal["auto", "diff", "full"]


def _isoformat(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=UTC).isoformat()


def _safe_int(value: Any, default: int = 0) -> int:
    """Best-effort integer coercion for partially-redacted event payloads."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


class RunStore:
    def __init__(self, runs_dir: str | Path):
        self.runs_dir = Path(runs_dir)

    def list_runs(self) -> list[RunSummary]:
        if not self.runs_dir.is_dir():
            return []
        runs: list[RunSummary] = []
        for entry in sorted(
            (p for p in self.runs_dir.iterdir() if p.is_dir()),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        ):
            summary = self._summarize(entry)
            if summary:
                runs.append(summary)
        return runs

    def get(self, run_id: str) -> RunDetail | None:
        run_dir = self._resolve_dir(run_id)
        if run_dir is None:
            return None
        return self._detail(run_dir)

    def _resolve_dir(self, run_id: str) -> Path | None:
        safe = re.sub(r"[^A-Za-z0-9_\-]", "", run_id)
        if not safe:
            return None
        candidate = self.runs_dir / safe
        return candidate if candidate.is_dir() else None

    def _summarize(self, run_dir: Path) -> RunSummary | None:
        events = read_events(run_dir / "events.jsonl")
        metadata = self._read_metadata(run_dir / "events.jsonl")

        if not events:
            # Runs that have been launched but haven't produced events yet
            # (CLI subprocess still booting / pulling the sandbox image) still
            # need to appear in the dashboard so users can see "queued" state.
            if not (run_dir / "run.pid").exists():
                return None
            fallback_ts = _isoformat(run_dir.stat().st_mtime)
            scan_mode = self._scan_mode(metadata.get("scan_mode", "deep"))
            scope_mode = self._scope_mode(metadata.get("scope_mode", "auto"))
            return RunSummary(
                id=run_dir.name,
                name=str(metadata.get("run_name") or run_dir.name),
                targets=list(metadata.get("targets") or []),
                status="queued",
                createdAt=_isoformat(run_dir.stat().st_ctime),
                updatedAt=fallback_ts,
                finishedAt=None,
                scanMode=scan_mode,
                scopeMode=scope_mode,
                owner=self._owner_from_metadata(metadata),
                stats=RunStats(),
                severityCounts=SeverityCounts(),
                lastCheckpointAt=None,
            )

        created = events[0].timestamp
        updated = events[-1].timestamp
        status = self._infer_status(events, metadata)

        stats, counts = self._compute_stats(events, run_dir)

        owner = self._owner_from_metadata(metadata)
        run_name = metadata.get("run_name") or run_dir.name
        targets = metadata.get("targets") or []
        scan_mode = self._scan_mode(metadata.get("scan_mode", "deep"))
        scope_mode = self._scope_mode(metadata.get("scope_mode", "auto"))

        return RunSummary(
            id=run_dir.name,
            name=str(run_name),
            targets=list(targets),
            status=status,
            createdAt=created,
            updatedAt=updated,
            finishedAt=updated if status in ("completed", "failed", "stopped") else None,
            scanMode=scan_mode,
            scopeMode=scope_mode,
            owner=owner,
            stats=stats,
            severityCounts=counts,
            lastCheckpointAt=self._last_checkpoint_at(events),
        )

    def _detail(self, run_dir: Path) -> RunDetail:
        events = read_events(run_dir / "events.jsonl")
        metadata = self._read_metadata(run_dir / "events.jsonl")
        raw = self._load_raw_events(run_dir / "events.jsonl")
        agents = self._agents(raw)
        messages = self._messages(raw)
        tools = self._tools(raw)
        findings = self._findings(run_dir, raw)
        stats, counts = self._compute_stats(events, run_dir, raw=raw)
        status = self._infer_status(events, metadata)

        report_path = run_dir / "penetration_test_report.md"
        report_markdown = report_path.read_text(encoding="utf-8") if report_path.exists() else None

        owner = self._owner_from_metadata(metadata)
        run_name = metadata.get("run_name") or run_dir.name
        targets = metadata.get("targets") or []
        scan_mode = self._scan_mode(metadata.get("scan_mode", "deep"))
        scope_mode = self._scope_mode(metadata.get("scope_mode", "auto"))

        return RunDetail(
            id=run_dir.name,
            name=str(run_name),
            targets=list(targets),
            status=status,
            createdAt=events[0].timestamp if events else _isoformat(run_dir.stat().st_ctime),
            updatedAt=events[-1].timestamp if events else _isoformat(run_dir.stat().st_mtime),
            finishedAt=events[-1].timestamp
            if events and status in ("completed", "failed", "stopped")
            else None,
            scanMode=scan_mode,
            scopeMode=scope_mode,
            owner=owner,
            stats=stats,
            severityCounts=counts,
            lastCheckpointAt=self._last_checkpoint_at(events),
            agents=agents,
            messages=messages,
            toolExecutions=tools,
            findings=findings,
            reportMarkdown=report_markdown,
            events=events,
        )

    @staticmethod
    def _read_metadata(events_path: Path) -> dict[str, Any]:
        if not events_path.exists():
            return {}
        try:
            with events_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    record = json.loads(line)
                    meta = record.get("run_metadata")
                    if isinstance(meta, dict):
                        return meta
        except (OSError, json.JSONDecodeError):
            return {}
        return {}

    @staticmethod
    def _scan_mode(value: object) -> ScanMode:
        v = str(value or "").strip().lower()
        if v in ("quick", "standard", "deep"):
            return cast("ScanMode", v)
        return "deep"

    @staticmethod
    def _scope_mode(value: object) -> ScopeMode:
        v = str(value or "").strip().lower()
        if v in ("auto", "diff", "full"):
            return cast("ScopeMode", v)
        return "auto"

    @staticmethod
    def _load_raw_events(events_path: Path) -> list[dict[str, Any]]:
        if not events_path.exists():
            return []
        out: list[dict[str, Any]] = []
        with events_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return out

    @staticmethod
    def _infer_status(events: list[TimelineEvent], metadata: dict[str, Any]) -> RunStatus:
        saw_configured = False
        for ev in reversed(events):
            if ev.type == "run.completed":
                return "completed"
            if ev.type == "run.failed":
                return "failed"
            if ev.type == "run.stopped":
                return "stopped"
            if ev.type == "run.started":
                return "running"
            if ev.type == "run.control":
                status = str(ev.status or "").lower()
                if status == "paused":
                    return "paused"
                if status in {"running", "resumed"}:
                    return "running"
                if status in {"stopped", "killed"}:
                    return "stopped"
            if ev.type == "llm.throttled":
                return "throttled"
            if ev.type == "llm.resumed":
                return "running"
            if ev.type == "run.configured":
                saw_configured = True
                continue
            # If we observe *any* other event beyond `run.configured`, the run
            # is already active from the operator's point of view.
            return "running"
        if saw_configured:
            return "queued"
        if metadata.get("status") == "completed":
            return "completed"
        return "running"

    @staticmethod
    def _owner_from_metadata(metadata: dict[str, Any]) -> Owner:
        owner = metadata.get("owner")
        if isinstance(owner, dict):
            return Owner(
                id=str(owner.get("id", "user")),
                name=str(owner.get("name", "Operator")),
                avatarUrl=owner.get("avatar_url"),
            )
        return _DEFAULT_OWNER

    @staticmethod
    def _last_checkpoint_at(events: list[TimelineEvent]) -> str | None:
        for ev in reversed(events):
            if ev.type == "run.checkpoint":
                return ev.timestamp
        return None

    def _compute_stats(
        self,
        events: list[TimelineEvent],
        run_dir: Path,
        raw: list[dict[str, Any]] | None = None,
    ) -> tuple[RunStats, SeverityCounts]:
        agents = {
            ev.actor.get("agent_id") for ev in events if ev.type == "agent.created" and ev.actor
        }
        tool_ids = {
            (ev.actor or {}).get("execution_id")
            for ev in events
            if ev.type == "tool.execution.started" and ev.actor
        }
        findings = [ev for ev in events if ev.type == "finding.created"]

        counts = SeverityCounts()
        for ev in findings:
            sev = (ev.severity or "").lower()
            if sev in ("critical", "high", "medium", "low", "info"):
                setattr(counts, sev, getattr(counts, sev) + 1)

        duration_ms = 0
        if events:
            try:
                start = datetime.fromisoformat(events[0].timestamp.replace("Z", "+00:00"))
                end = datetime.fromisoformat(events[-1].timestamp.replace("Z", "+00:00"))
                duration_ms = int((end - start).total_seconds() * 1000)
            except ValueError:
                duration_ms = 0

        # Token / cost aggregation. The LLM layer writes an
        # ``llm.call.completed`` event to ``events.jsonl`` on every
        # completion (see ``strix.llm.llm.LLM._emit_usage_event``) with
        # prompt_tokens + completion_tokens + cost. We sum those here so
        # the dashboard's stat tiles populate live. When the raw records
        # aren't available (summary-only path), we fall back to reading
        # the jsonl again — cheap because it's memory-mapped by the OS.
        if raw is None:
            raw = self._load_raw_events(run_dir / "events.jsonl")

        tokens_total = 0
        cost_total = 0.0
        llm_requests = 0
        for rec in raw:
            if rec.get("event_type") != "llm.call.completed":
                continue
            payload = rec.get("payload") or {}
            input_tokens = _safe_int(payload.get("input_tokens"))
            output_tokens = _safe_int(payload.get("output_tokens"))
            total = _safe_int(payload.get("total_tokens"), input_tokens + output_tokens)
            tokens_total += total
            try:
                cost_total += float(payload.get("cost") or 0.0)
            except (TypeError, ValueError):
                pass
            llm_requests += 1

        stats = RunStats(
            agents=len(agents),
            tools=len(tool_ids),
            vulnerabilities=len(findings),
            tokens=tokens_total,
            cost=round(cost_total, 4),
            iterations=llm_requests,
            durationMs=duration_ms,
        )
        return stats, counts

    def _agents(self, raw: list[dict[str, Any]]) -> list[AgentNode]:
        agents: dict[str, AgentNode] = {}
        for rec in raw:
            etype = rec.get("event_type")
            actor = rec.get("actor") or {}
            payload = rec.get("payload") or {}
            if etype == "agent.created":
                agent_id = actor.get("agent_id")
                if not isinstance(agent_id, str):
                    continue
                agents[agent_id] = AgentNode(
                    id=agent_id,
                    name=str(actor.get("agent_name", agent_id)),
                    task=str(payload.get("task", "")),
                    status="running",
                    parentId=payload.get("parent_id"),
                    createdAt=str(rec.get("timestamp", "")),
                    updatedAt=str(rec.get("timestamp", "")),
                )
            elif etype == "agent.status.updated":
                agent_id = actor.get("agent_id")
                if agent_id in agents:
                    agents[agent_id].status = rec.get("status") or agents[agent_id].status
                    agents[agent_id].updated_at = str(
                        rec.get("timestamp", agents[agent_id].updated_at)
                    )
                    err = (payload or {}).get("error_message") or rec.get("error")
                    if err:
                        agents[agent_id].error_message = str(err)
            elif etype == "tool.execution.started":
                agent_id = actor.get("agent_id")
                if agent_id in agents:
                    agents[agent_id].tool_executions += 1
            elif etype == "finding.created":
                agent_id = actor.get("agent_id")
                if agent_id in agents:
                    agents[agent_id].findings += 1
            elif etype == "llm.call.completed":
                agent_id = actor.get("agent_id")
                if agent_id in agents:
                    # Credit tokens to the agent that requested the LLM call.
                    total = _safe_int(
                        payload.get("total_tokens"),
                        _safe_int(payload.get("input_tokens"))
                        + _safe_int(payload.get("output_tokens")),
                    )
                    agents[agent_id].tokens += total
                    agents[agent_id].updated_at = str(
                        rec.get("timestamp", agents[agent_id].updated_at)
                    )
        return list(agents.values())

    @staticmethod
    def _messages(raw: list[dict[str, Any]]) -> list[ChatMessage]:
        out: list[ChatMessage] = []
        i = 0
        for rec in raw:
            if rec.get("event_type") != "chat.message":
                continue
            i += 1
            actor = rec.get("actor") or {}
            payload = rec.get("payload") or {}
            out.append(
                ChatMessage(
                    id=int(payload.get("message_id", i)),
                    agentId=actor.get("agent_id"),
                    role=actor.get("role", "assistant"),
                    content=str(payload.get("content", "")),
                    timestamp=str(rec.get("timestamp", "")),
                    metadata=payload.get("metadata"),
                )
            )
        return out

    @staticmethod
    def _tools(raw: list[dict[str, Any]]) -> list[ToolExecution]:
        by_id: dict[int, ToolExecution] = {}
        for rec in raw:
            etype = rec.get("event_type")
            actor = rec.get("actor") or {}
            payload = rec.get("payload") or {}
            exec_id = actor.get("execution_id")
            if not isinstance(exec_id, int):
                continue
            if etype == "tool.execution.started":
                by_id[exec_id] = ToolExecution(
                    id=exec_id,
                    agentId=str(actor.get("agent_id", "")),
                    toolName=str(actor.get("tool_name", "unknown")),
                    args=payload.get("args") or {},
                    status="running",
                    startedAt=str(rec.get("timestamp", "")),
                )
            elif etype == "tool.execution.updated" and exec_id in by_id:
                by_id[exec_id].status = rec.get("status") or "completed"
                by_id[exec_id].completed_at = str(rec.get("timestamp", ""))
                result = payload.get("result")
                if isinstance(result, str):
                    by_id[exec_id].output = result[:10000]
                elif isinstance(result, dict):
                    by_id[exec_id].output = json.dumps(result)[:10000]
        return list(by_id.values())

    def _findings(self, run_dir: Path, raw: list[dict[str, Any]]) -> list[Finding]:
        out: list[Finding] = []
        by_fingerprint: dict[str, Finding] = {}
        triage_by_id: dict[str, dict[str, str]] = {}
        for rec in raw:
            if rec.get("event_type") == "finding.triage.updated":
                payload = rec.get("payload") or {}
                fid = str(payload.get("finding_id") or "")
                if fid:
                    triage_by_id[fid] = {
                        "status": str(payload.get("status") or "open"),
                        "note": str(payload.get("note") or ""),
                    }
                continue
            if rec.get("event_type") != "finding.created":
                continue
            report = (rec.get("payload") or {}).get("report") or {}
            if not report:
                continue
            finding = Finding(
                id=str(report.get("id", "")),
                title=str(report.get("title", "Untitled")),
                severity=report.get("severity", "info"),
                target=report.get("target"),
                endpoint=report.get("endpoint"),
                method=report.get("method"),
                cvss=report.get("cvss"),
                cve=report.get("cve"),
                cwe=report.get("cwe"),
                description=str(report.get("description", "")),
                impact=report.get("impact"),
                technicalAnalysis=report.get("technical_analysis"),
                pocDescription=report.get("poc_description"),
                pocScript=report.get("poc_script_code"),
                remediation=report.get("remediation_steps"),
                status="open",
                statusNote=None,
                timestamp=str(report.get("timestamp", rec.get("timestamp", ""))),
            )
            fp = _finding_fingerprint(report)
            # Keep the first-seen instance as the canonical finding row for UI,
            # and drop duplicated rescans with the same normalized fingerprint.
            if fp in by_fingerprint:
                continue
            by_fingerprint[fp] = finding
            out.append(finding)
        for finding in out:
            triage = triage_by_id.get(finding.id)
            if triage:
                finding.status = triage["status"]  # type: ignore[assignment]
                finding.status_note = triage.get("note") or None
        return out


def _finding_fingerprint(report: dict[str, Any]) -> str:
    target = str(report.get("target") or "").strip().lower()
    vuln_class = str(report.get("vuln_class") or report.get("title") or "").strip().lower()
    endpoint = str(report.get("endpoint") or "").strip().lower()
    param_name = str(report.get("param_name") or report.get("parameter") or "").strip().lower()
    payload_shape = (
        str(report.get("payload_shape") or report.get("poc_description") or "").strip().lower()
    )
    material = "|".join([target, vuln_class, endpoint, param_name, payload_shape])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()
