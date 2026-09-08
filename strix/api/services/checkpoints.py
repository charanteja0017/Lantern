"""Idempotent run checkpoints with full state manifests.

The legacy :class:`strix.api.services.checkpoint.CheckpointStore` is a thin
wrapper around timestamped JSON blobs. That is enough to resume the *UI*
on the current run page, but not enough to drive a full-orchestrator
resume:

* it doesn't capture the pipeline stage;
* it doesn't enumerate per-stage artifacts;
* it doesn't record pending agent actions that should be replayed.

This module layers a ``ResumableCheckpoint`` data model on top of that
store. It is intentionally additive: the old ``latest()`` payload remains
legal, and any new checkpoint is also a valid ``latest()`` payload — just
with richer ``state``.

The :class:`CheckpointController` exposes three operations:

* :meth:`capture` — build a full manifest from the run directory now.
* :meth:`restore` — return the most recent full manifest for resume.
* :meth:`plan_resume` — compute the list of stages still to execute,
  which the launcher uses to prime the CLI subprocess via env vars.
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

from strix.api.services.checkpoint import CheckpointStore
from strix.core.pipeline_contracts import (
    ALL_STAGES,
    STAGE_COMPLETED,
    STAGE_CONFIGURED,
    STAGE_FAILED,
    PipelineController,
)


logger = logging.getLogger(__name__)


# --- Manifest model ----------------------------------------------------------


@dataclass
class ArtifactManifest:
    path: str
    size: int
    sha256: str

    def to_dict(self) -> dict[str, Any]:
        return {"path": self.path, "size": self.size, "sha256": self.sha256}


@dataclass
class ResumableCheckpoint:
    run_id: str
    captured_at: str
    pipeline: dict[str, Any]
    artifacts: list[ArtifactManifest] = field(default_factory=list)
    pending_agents: list[dict[str, Any]] = field(default_factory=list)
    reason: str = "periodic"
    # Bumped whenever we add a non-back-compat field so restorers can
    # refuse mismatched payloads rather than silently mis-parsing them.
    schema_version: int = 1

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "run_id": self.run_id,
            "captured_at": self.captured_at,
            "pipeline": self.pipeline,
            "artifacts": [a.to_dict() for a in self.artifacts],
            "pending_agents": list(self.pending_agents),
            "reason": self.reason,
        }


# --- Controller --------------------------------------------------------------


class CheckpointController:
    """Capture/restore resume manifests for a single run.

    The controller delegates durable writes to the legacy
    :class:`CheckpointStore` so we keep one on-disk format and retention
    policy. New consumers should prefer the ``capture`` / ``restore``
    APIs; the legacy ``save`` / ``latest`` continue to work unchanged.
    """

    # Files we always include in the manifest when present — the UI and
    # the orchestrator both key off of these.
    _TRACKED_FILENAMES: tuple[str, ...] = (
        "run.meta.json",
        "stages.json",
        "events.jsonl",
        "penetration_test_report.md",
    )

    def __init__(self, runs_dir: str | Path):
        self.runs_dir = Path(runs_dir)
        self._store = CheckpointStore(self.runs_dir)

    # ----- capture -----------------------------------------------------------

    def capture(self, run_id: str, *, reason: str = "periodic") -> ResumableCheckpoint:
        run_dir = self.runs_dir / run_id
        pipeline_state = PipelineController(run_dir).state()
        manifest = ResumableCheckpoint(
            run_id=run_id,
            captured_at=_iso_now(),
            pipeline=pipeline_state.to_dict(),
            artifacts=list(self._enumerate_artifacts(run_dir)),
            pending_agents=list(self._pending_agents(run_dir)),
            reason=reason,
        )
        self._store.save(run_id, manifest.to_dict(), reason=reason)
        return manifest

    # ----- restore -----------------------------------------------------------

    def restore(self, run_id: str) -> ResumableCheckpoint | None:
        raw = self._store.latest(run_id)
        if raw is None:
            return None

        state = raw.get("state") or raw
        if not isinstance(state, dict):
            return None

        # Only accept payloads we know how to parse. Legacy payloads lack a
        # schema_version; treat those as v0 (pipeline-less).
        if state.get("schema_version") not in (1, None):
            logger.warning(
                "checkpoint: unknown schema_version=%s for run=%s; ignoring",
                state.get("schema_version"),
                run_id,
            )
            return None

        artifacts_raw = state.get("artifacts") or []
        pipeline = state.get("pipeline")
        if not pipeline:
            pipeline = PipelineController(self.runs_dir / run_id).state().to_dict()

        return ResumableCheckpoint(
            run_id=str(state.get("run_id", run_id)),
            captured_at=str(state.get("captured_at", _iso_now())),
            pipeline=pipeline,
            artifacts=[
                ArtifactManifest(
                    path=str(a.get("path", "")),
                    size=int(a.get("size", 0) or 0),
                    sha256=str(a.get("sha256", "")),
                )
                for a in artifacts_raw
                if isinstance(a, dict) and a.get("path")
            ],
            pending_agents=list(state.get("pending_agents") or []),
            reason=str(state.get("reason", "periodic")),
            schema_version=int(state.get("schema_version", 1) or 1),
        )

    # ----- resume planning ---------------------------------------------------

    def plan_resume(self, run_id: str) -> dict[str, Any]:
        """Compute a concrete resume plan for ``run_id``.

        Returns a dict with:
            * ``resumable`` — whether we have enough state to resume;
            * ``stages_done`` — stages we can safely skip;
            * ``stages_remaining`` — stages still to execute, in order;
            * ``next_stage`` — the next stage the orchestrator should enter;
            * ``checkpoint_id`` — a short hash identifying the manifest.
        """
        manifest = self.restore(run_id)
        if manifest is None:
            return {"resumable": False, "reason": "no_checkpoint"}

        pipeline = manifest.pipeline or {}
        current = pipeline.get("current")
        completed = list(pipeline.get("completed_stages") or [])

        if current in (STAGE_COMPLETED, STAGE_FAILED):
            return {
                "resumable": False,
                "reason": f"terminal_state:{current}",
                "checkpoint_id": self._hash(manifest),
            }

        stages_done = [s for s in ALL_STAGES if s in completed]
        remaining: list[str] = []
        seen_current = False
        for stage in ALL_STAGES:
            if stage in (STAGE_COMPLETED, STAGE_FAILED):
                continue
            if stage in completed:
                continue
            if stage == STAGE_CONFIGURED and completed:
                continue
            if stage == current:
                seen_current = True
                remaining.append(stage)
                continue
            if current is None or seen_current or stage == current:
                remaining.append(stage)

        # When `current` is not yet completed, re-enter it first so partial
        # progress on that stage doesn't get double-executed.
        next_stage = current if current else (remaining[0] if remaining else None)

        return {
            "resumable": next_stage is not None,
            "runId": run_id,
            "checkpointId": self._hash(manifest),
            "capturedAt": manifest.captured_at,
            "stagesDone": stages_done,
            "stagesRemaining": remaining,
            "nextStage": next_stage,
            "artifacts": [a.to_dict() for a in manifest.artifacts],
        }

    # ----- helpers -----------------------------------------------------------

    @staticmethod
    def _hash(manifest: ResumableCheckpoint) -> str:
        body = json.dumps(manifest.to_dict(), sort_keys=True).encode("utf-8")
        return hashlib.sha256(body).hexdigest()[:16]

    def _enumerate_artifacts(self, run_dir: Path) -> Iterable[ArtifactManifest]:
        if not run_dir.is_dir():
            return
        for name in self._TRACKED_FILENAMES:
            path = run_dir / name
            if not path.is_file():
                continue
            try:
                data = path.read_bytes()
            except OSError:
                continue
            yield ArtifactManifest(
                path=name,
                size=len(data),
                sha256=hashlib.sha256(data).hexdigest(),
            )

    @staticmethod
    def _pending_agents(run_dir: Path) -> Iterable[dict[str, Any]]:
        """Infer still-running agents from ``events.jsonl``.

        We treat an agent as pending when the most recent event for it is
        ``agent.created`` or ``agent.status.updated`` with a non-terminal
        status. Terminal statuses are completed / failed / stopped.
        """
        events_path = run_dir / "events.jsonl"
        if not events_path.is_file():
            return []
        latest: dict[str, dict[str, Any]] = {}
        try:
            with events_path.open("r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if rec.get("event_type") not in (
                        "agent.created",
                        "agent.status.updated",
                    ):
                        continue
                    actor = rec.get("actor") or {}
                    agent_id = actor.get("agent_id")
                    if not isinstance(agent_id, str):
                        continue
                    latest[agent_id] = rec
        except OSError:
            return []
        pending: list[dict[str, Any]] = []
        for agent_id, rec in latest.items():
            status = rec.get("status") or "running"
            if status in ("completed", "failed", "stopped"):
                continue
            actor = rec.get("actor") or {}
            pending.append(
                {
                    "agent_id": agent_id,
                    "agent_name": actor.get("agent_name"),
                    "status": status,
                    "last_event": rec.get("event_type"),
                    "timestamp": rec.get("timestamp"),
                }
            )
        return pending


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


# --- Module-level accessor ---------------------------------------------------


def get_checkpoint_controller(runs_dir: str | Path) -> CheckpointController:
    return CheckpointController(runs_dir)
