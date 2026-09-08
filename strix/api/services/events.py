"""Reading and streaming of Strix ``events.jsonl`` files.

The existing :class:`strix.telemetry.tracer.Tracer` writes every lifecycle
event to ``strix_runs/<run_name>/events.jsonl``. This module reads those
artifacts and exposes them as Pydantic models for the API, and provides a
``follow`` async generator for live SSE streams.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from strix.api.schemas import TimelineEvent


def _format_event(record: dict[str, Any]) -> TimelineEvent | None:
    try:
        event_type = record.get("event_type") or record.get("type")
        if not isinstance(event_type, str):
            return None
        timestamp = record.get("timestamp") or record.get("time") or ""
        actor = record.get("actor") or None
        payload = record.get("payload") or {}
        status = record.get("status")

        message = _build_message(event_type, actor, payload, status)
        severity = None
        if event_type == "finding.created":
            report = (payload or {}).get("report") or {}
            severity = report.get("severity")

        return TimelineEvent(
            id=str(
                record.get("span_id")
                or f"{event_type}-{timestamp}-{hash(json.dumps(record, sort_keys=True)) & 0xFFFFFFFF}"
            ),
            timestamp=str(timestamp),
            type=event_type,
            actor=actor,
            message=message,
            severity=severity,
            status=status,
        )
    except Exception:  # pragma: no cover - defensive
        return None


def _build_message(
    event_type: str, actor: dict[str, Any] | None, payload: dict[str, Any], status: str | None
) -> str:
    if event_type == "run.started":
        return "Run started"
    if event_type == "run.completed":
        return "Run completed"
    if event_type == "run.configured":
        return "Run configured"
    if event_type == "run.failed":
        reason = (payload or {}).get("reason") or "Run failed"
        first_line = str(reason).splitlines()[0] if reason else "Run failed"
        return f"Run failed: {first_line[:200]}"
    if event_type == "run.stopped":
        return "Run stopped"
    if event_type == "run.checkpoint":
        return f"Checkpoint saved ({payload.get('reason', 'periodic')})"
    if event_type == "run.preflight":
        violations = (payload or {}).get("violations") or []
        warnings = (payload or {}).get("warnings") or []
        if status == "rejected":
            head = violations[0] if violations else {"message": "rejected"}
            return f"Preflight rejected: {head.get('message', 'policy violation')}"
        if warnings:
            return f"Preflight passed with {len(warnings)} warning(s)"
        return "Preflight passed"
    if event_type == "run.stage.transition":
        stage = (payload or {}).get("to") or "unknown"
        return f"Stage → {stage}"
    if event_type == "run.stage.completed":
        stage = (payload or {}).get("stage") or "unknown"
        return f"Stage completed: {stage}"
    if event_type == "run.stage.failed":
        stage = (payload or {}).get("stage") or "unknown"
        reason = (payload or {}).get("reason") or "unknown"
        return f"Stage failed: {stage} ({reason})"
    if event_type == "browser.session.lifecycle":
        action = (payload or {}).get("action") or status or "updated"
        session = (payload or {}).get("session") or (actor or {}).get("session_id") or "?"
        return f"Browser session {session}: {action}"
    if event_type == "report.artifact.created":
        version = (payload or {}).get("version") or "?"
        return f"Report artifact v{version} persisted"
    if event_type == "agent.created":
        name = (actor or {}).get("agent_name") or (actor or {}).get("agent_id") or "Agent"
        return f"{name} spawned"
    if event_type == "agent.status.updated":
        name = (actor or {}).get("agent_name") or (actor or {}).get("agent_id") or "Agent"
        return f"{name}: {status or 'updated'}"
    if event_type == "tool.execution.started":
        tool = (actor or {}).get("tool_name") or "tool"
        return f"Running {tool}"
    if event_type == "tool.execution.updated":
        tool = (actor or {}).get("tool_name") or "tool"
        return f"{tool} → {status or 'updated'}"
    if event_type == "chat.message":
        role = (actor or {}).get("role") or "message"
        content = (payload or {}).get("content", "")
        return f"{role}: {content[:120]}{'…' if len(content) > 120 else ''}"
    if event_type == "finding.created":
        report = (payload or {}).get("report") or {}
        return f"{report.get('severity', 'info').title()}: {report.get('title', 'Finding')}"
    if event_type == "finding.reviewed":
        return "Finding reviewed"
    if event_type == "llm.throttled":
        return f"LLM throttled: {payload.get('reason', 'rate limit')}"
    if event_type == "llm.resumed":
        return "LLM resumed"
    return event_type


def read_events(path: Path) -> list[TimelineEvent]:
    if not path.is_file():
        return []
    out: list[TimelineEvent] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            ev = _format_event(record)
            if ev:
                out.append(ev)
    return out


async def follow(path: Path, poll_seconds: float = 0.5) -> AsyncIterator[TimelineEvent]:
    """Tail an events.jsonl, yielding new TimelineEvents as they appear."""
    pos = path.stat().st_size if path.exists() else 0
    while True:
        if not path.exists():
            await asyncio.sleep(poll_seconds)
            continue
        size = path.stat().st_size
        if size > pos:
            with path.open("r", encoding="utf-8") as f:
                f.seek(pos)
                chunk = f.read()
                pos = f.tell()
            for line in chunk.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ev = _format_event(record)
                if ev:
                    yield ev
        await asyncio.sleep(poll_seconds)
