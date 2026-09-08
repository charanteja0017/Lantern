"""Deterministic browser-session mapping and lifecycle telemetry.

Strix already isolates browser state per-agent inside
:class:`strix.tools.browser.tab_manager.BrowserTabManager`. This module adds
a *policy layer* on top:

* a **stable session ID** is derived from the agent's role/phase so that
  two agents that are supposed to share a browser context do so
  deterministically across runs;
* every lifecycle transition (``created``, ``attached``, ``recycled``,
  ``failed``) is emitted as a ``browser.session.lifecycle`` event into the
  active run so the timeline can render it.

The registry is intentionally independent of the underlying Playwright
instance. It does not own pages or contexts; it only tracks metadata about
which logical session an agent belongs to. The tab manager continues to
own resource lifetimes.

The mapping mirrors NovaHunter's ``PLAYWRIGHT_SESSION_MAPPING``: each
vuln/exploit pair shares a single session, pre-recon/recon each own their
own, and the report agent reuses a prior session instead of spawning a new
one.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)


# --- Session naming ----------------------------------------------------------

# Phase -> stable session id. The vuln/exploit pairs share an id to match
# NovaHunter's behavior: the exploit agent reuses the browser state the vuln
# agent established. Reporting re-uses session 3 (auth) because it commonly
# needs an authenticated view.
PHASE_SESSION_MAPPING: dict[str, str] = {
    "pre_recon": "agent1",
    "recon": "agent2",
    "vuln_injection": "agent1",
    "vuln_xss": "agent2",
    "vuln_auth": "agent3",
    "vuln_ssrf": "agent4",
    "vuln_authz": "agent5",
    "exploit_injection": "agent1",
    "exploit_xss": "agent2",
    "exploit_auth": "agent3",
    "exploit_ssrf": "agent4",
    "exploit_authz": "agent5",
    "reporting": "agent3",
}


@dataclass
class SessionRecord:
    """Lightweight metadata about a logical browser session."""

    session_id: str
    created_at: str
    last_event: str = "created"
    last_event_at: str = ""
    attached_agents: list[str] = field(default_factory=list)
    failures: int = 0
    recycled_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "created_at": self.created_at,
            "last_event": self.last_event,
            "last_event_at": self.last_event_at,
            "attached_agents": list(self.attached_agents),
            "failures": self.failures,
            "recycled_count": self.recycled_count,
        }


class BrowserSessionRegistry:
    """Tracks logical browser sessions and emits lifecycle events.

    The registry is process-scoped; each API/CLI process owns one registry
    instance. It is safe to use from multiple agent threads — all mutations
    are serialized through an internal lock.
    """

    def __init__(self, runs_dir: str | Path | None = None):
        self._runs_dir = Path(runs_dir) if runs_dir else None
        self._lock = threading.Lock()
        self._sessions: dict[str, SessionRecord] = {}

    # ----- session resolution ------------------------------------------------

    def resolve_session(self, *, phase: str | None, agent_id: str) -> str:
        """Return the logical session ID an agent should use for ``phase``.

        Unknown phases fall back to an agent-scoped session to preserve
        the existing per-agent isolation behavior.
        """
        mapped = PHASE_SESSION_MAPPING.get((phase or "").strip().lower())
        if mapped:
            return mapped
        # Fall-through: isolate by agent (preserves today's behavior).
        return f"agent:{agent_id}"

    # ----- lifecycle events --------------------------------------------------

    def record_created(
        self,
        session_id: str,
        *,
        run_id: str | None = None,
        agent_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> SessionRecord:
        now = _iso_now()
        with self._lock:
            rec = self._sessions.get(session_id)
            if rec is None:
                rec = SessionRecord(session_id=session_id, created_at=now)
                self._sessions[session_id] = rec
            rec.last_event = "created"
            rec.last_event_at = now
            if agent_id and agent_id not in rec.attached_agents:
                rec.attached_agents.append(agent_id)
        self._emit_event(
            "created",
            session_id=session_id,
            run_id=run_id,
            agent_id=agent_id,
            metadata=metadata,
        )
        return rec

    def record_attached(
        self,
        session_id: str,
        *,
        agent_id: str,
        run_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> SessionRecord:
        now = _iso_now()
        with self._lock:
            rec = self._sessions.setdefault(
                session_id, SessionRecord(session_id=session_id, created_at=now)
            )
            rec.last_event = "attached"
            rec.last_event_at = now
            if agent_id not in rec.attached_agents:
                rec.attached_agents.append(agent_id)
        self._emit_event(
            "attached",
            session_id=session_id,
            run_id=run_id,
            agent_id=agent_id,
            metadata=metadata,
        )
        return rec

    def record_recycled(
        self,
        session_id: str,
        *,
        run_id: str | None = None,
        agent_id: str | None = None,
        reason: str | None = None,
    ) -> SessionRecord | None:
        now = _iso_now()
        with self._lock:
            rec = self._sessions.get(session_id)
            if rec is None:
                return None
            rec.last_event = "recycled"
            rec.last_event_at = now
            rec.recycled_count += 1
        self._emit_event(
            "recycled",
            session_id=session_id,
            run_id=run_id,
            agent_id=agent_id,
            metadata={"reason": reason} if reason else None,
        )
        return rec

    def record_failed(
        self,
        session_id: str,
        *,
        run_id: str | None = None,
        agent_id: str | None = None,
        reason: str | None = None,
    ) -> SessionRecord | None:
        now = _iso_now()
        with self._lock:
            rec = self._sessions.get(session_id)
            if rec is None:
                return None
            rec.last_event = "failed"
            rec.last_event_at = now
            rec.failures += 1
        self._emit_event(
            "failed",
            session_id=session_id,
            run_id=run_id,
            agent_id=agent_id,
            metadata={"reason": reason} if reason else None,
        )
        return rec

    # ----- introspection -----------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "sessions": [rec.to_dict() for rec in self._sessions.values()],
                "mapping": dict(PHASE_SESSION_MAPPING),
            }

    # ----- internals ---------------------------------------------------------

    def _emit_event(
        self,
        action: str,
        *,
        session_id: str,
        run_id: str | None,
        agent_id: str | None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        # Resolve a run dir either from the caller or from the ambient
        # tracer (already used throughout the tools layer).
        run_dir = self._resolve_run_dir(run_id)
        if run_dir is None:
            logger.debug(
                "browser session event '%s' for %s dropped (no run dir)",
                action,
                session_id,
            )
            return

        record = {
            "event_type": "browser.session.lifecycle",
            "timestamp": _iso_now(),
            "actor": {
                "session_id": session_id,
                "agent_id": agent_id,
            },
            "payload": {
                "action": action,
                "session": session_id,
                "metadata": metadata or {},
            },
            "status": action,
        }
        try:
            (run_dir / "events.jsonl").parent.mkdir(parents=True, exist_ok=True)
            with (run_dir / "events.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\n")
        except OSError as exc:  # pragma: no cover - best effort
            logger.warning(
                "browser session event '%s' for %s failed to persist: %s",
                action,
                session_id,
                exc,
            )

    def _resolve_run_dir(self, run_id: str | None) -> Path | None:
        candidate = self._runs_dir
        if candidate is None:
            candidate = Path(os.getenv("STRIX_RUNS_DIR", "strix_runs"))

        if run_id:
            run_dir = candidate / run_id
            return run_dir if run_dir.is_dir() else None

        # Fall back to the currently-active tracer run directory.
        try:
            from strix.telemetry.tracer import get_global_tracer

            tracer = get_global_tracer()
            run_name = (
                (getattr(tracer, "scan_config", None) or {}).get("run_name") if tracer else None
            )
        except Exception:
            run_name = None

        if not run_name:
            return None
        run_dir = candidate / str(run_name)
        return run_dir if run_dir.is_dir() else None


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


# --- Module-level singleton --------------------------------------------------

_REGISTRY: BrowserSessionRegistry | None = None
_REGISTRY_LOCK = threading.Lock()


def get_session_registry() -> BrowserSessionRegistry:
    """Return the process-wide browser session registry."""
    global _REGISTRY
    with _REGISTRY_LOCK:
        if _REGISTRY is None:
            _REGISTRY = BrowserSessionRegistry()
        return _REGISTRY
