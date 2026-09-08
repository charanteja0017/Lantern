"""Deterministic pipeline stage contracts for Strix scans.

A Strix run moves through a small fixed set of stages:

    configured → pre_recon → recon → vuln_analysis → exploit_validation
                 → reporting → completed

Each stage declares:

* the stages it may legally transition from,
* the run-directory artifacts it must produce before moving on,
* a short description surfaced to the UI.

This module is the single source of truth for that state machine. The
orchestrator (or any caller) can use :class:`PipelineController` to record
transitions and validate artifacts deterministically. Transitions are
persisted both in the run's ``events.jsonl`` (for the UI/timeline) and in a
dedicated ``stages.json`` manifest (for resume/replay).

Design goals:

* Pure Python, no external deps — safe to import from any subsystem.
* Idempotent: re-recording the same transition is a no-op, not a crash.
* Fail-loud: trying to enter a stage from a non-predecessor raises
  :class:`InvalidStageTransitionError` with a descriptive message.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast


logger = logging.getLogger(__name__)


# --- Stage model -------------------------------------------------------------

STAGE_CONFIGURED = "configured"
STAGE_PRE_RECON = "pre_recon"
STAGE_RECON = "recon"
STAGE_VULN_ANALYSIS = "vuln_analysis"
STAGE_EXPLOIT_VALIDATION = "exploit_validation"
STAGE_REPORTING = "reporting"
STAGE_COMPLETED = "completed"
STAGE_FAILED = "failed"

ALL_STAGES: tuple[str, ...] = (
    STAGE_CONFIGURED,
    STAGE_PRE_RECON,
    STAGE_RECON,
    STAGE_VULN_ANALYSIS,
    STAGE_EXPLOIT_VALIDATION,
    STAGE_REPORTING,
    STAGE_COMPLETED,
    STAGE_FAILED,
)


@dataclass(frozen=True)
class StageSpec:
    name: str
    predecessors: tuple[str, ...]
    description: str
    # Artifacts (relative to the run directory) that must exist before this
    # stage is considered complete. Missing artifacts will cause
    # :meth:`PipelineController.complete` to raise.
    required_artifacts: tuple[str, ...] = ()

    def may_enter_from(self, prev: str | None) -> bool:
        if prev is None:
            return self.name == STAGE_CONFIGURED
        return prev in self.predecessors


STAGE_SPECS: dict[str, StageSpec] = {
    STAGE_CONFIGURED: StageSpec(
        name=STAGE_CONFIGURED,
        predecessors=(),
        description="Run accepted and queued; preflight passed.",
    ),
    STAGE_PRE_RECON: StageSpec(
        name=STAGE_PRE_RECON,
        predecessors=(STAGE_CONFIGURED,),
        description="Source-aware analysis and attack-surface hypothesis.",
    ),
    STAGE_RECON: StageSpec(
        name=STAGE_RECON,
        predecessors=(STAGE_PRE_RECON,),
        description="Live reconnaissance and endpoint mapping.",
    ),
    STAGE_VULN_ANALYSIS: StageSpec(
        name=STAGE_VULN_ANALYSIS,
        predecessors=(STAGE_RECON,),
        description="Per-category vulnerability hypothesis generation.",
    ),
    STAGE_EXPLOIT_VALIDATION: StageSpec(
        name=STAGE_EXPLOIT_VALIDATION,
        predecessors=(STAGE_VULN_ANALYSIS,),
        description="Attempt exploitation; reject hypotheses without PoC.",
    ),
    STAGE_REPORTING: StageSpec(
        name=STAGE_REPORTING,
        predecessors=(STAGE_EXPLOIT_VALIDATION,),
        description="Assemble the canonical report artifact.",
        required_artifacts=("penetration_test_report.md",),
    ),
    STAGE_COMPLETED: StageSpec(
        name=STAGE_COMPLETED,
        predecessors=(STAGE_REPORTING,),
        description="Run complete; final report persisted.",
    ),
    STAGE_FAILED: StageSpec(
        name=STAGE_FAILED,
        predecessors=tuple(s for s in ALL_STAGES if s not in (STAGE_COMPLETED, STAGE_FAILED)),
        description="Run aborted; check the reason in the last failed event.",
    ),
}


# --- Errors ------------------------------------------------------------------


class PipelineError(RuntimeError):
    """Base class for pipeline-contract errors."""


class InvalidStageTransitionError(PipelineError):
    """Raised when a caller tries to enter a stage from an illegal predecessor."""

    def __init__(self, *, from_stage: str | None, to_stage: str) -> None:
        super().__init__(
            f"Illegal stage transition: {from_stage!r} -> {to_stage!r}. "
            f"Allowed predecessors of {to_stage!r}: "
            f"{STAGE_SPECS.get(to_stage, StageSpec(to_stage, (), '')).predecessors}"
        )
        self.from_stage = from_stage
        self.to_stage = to_stage


class StageArtifactMissingError(PipelineError):
    """Raised when a stage completes without its declared artifacts present."""

    def __init__(self, stage: str, missing: Iterable[str]) -> None:
        missing_list = list(missing)
        super().__init__(f"Stage {stage!r} is missing required artifacts: {missing_list}")
        self.stage = stage
        self.missing = missing_list


# --- State persistence -------------------------------------------------------


@dataclass
class StageTransition:
    from_stage: str | None
    to_stage: str
    timestamp: str
    reason: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "from": self.from_stage,
            "to": self.to_stage,
            "timestamp": self.timestamp,
            "reason": self.reason,
            "metadata": self.metadata,
        }


@dataclass
class PipelineState:
    run_id: str
    current: str | None
    history: list[StageTransition] = field(default_factory=list)
    completed_stages: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "current": self.current,
            "history": [t.to_dict() for t in self.history],
            "completed_stages": list(self.completed_stages),
        }


# --- Controller --------------------------------------------------------------


class PipelineController:
    """Records stage transitions for a single run and enforces contracts.

    The controller keeps state in two places:

    * ``<run_dir>/stages.json`` — canonical state used for resume/replay.
    * ``<run_dir>/events.jsonl`` — one event per transition so the
      existing UI timeline picks them up for free.

    Instances are cheap; callers typically construct one per API
    interaction and discard it.
    """

    _STAGES_FILENAME = "stages.json"

    def __init__(self, run_dir: str | Path):
        self.run_dir = Path(run_dir)
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    # ----- public API --------------------------------------------------------

    def state(self) -> PipelineState:
        """Return the on-disk pipeline state, or a fresh empty state."""
        data = self._read()
        if data is None:
            return PipelineState(run_id=self.run_dir.name, current=None)
        return PipelineState(
            run_id=str(data.get("run_id", self.run_dir.name)),
            current=data.get("current"),
            history=[
                StageTransition(
                    from_stage=h.get("from"),
                    to_stage=str(h.get("to")),
                    timestamp=str(h.get("timestamp", "")),
                    reason=h.get("reason"),
                    metadata=h.get("metadata") or {},
                )
                for h in (data.get("history") or [])
            ],
            completed_stages=list(data.get("completed_stages") or []),
        )

    def enter(
        self,
        to_stage: str,
        *,
        reason: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> StageTransition:
        """Record a transition into ``to_stage`` if legal."""
        if to_stage not in STAGE_SPECS:
            raise PipelineError(f"Unknown stage: {to_stage!r}")
        spec = STAGE_SPECS[to_stage]

        with self._lock:
            state = self.state()
            if state.current == to_stage:
                # Idempotent re-entry — return the last transition.
                for t in reversed(state.history):
                    if t.to_stage == to_stage:
                        return t

            if not spec.may_enter_from(state.current):
                raise InvalidStageTransitionError(from_stage=state.current, to_stage=to_stage)

            transition = StageTransition(
                from_stage=state.current,
                to_stage=to_stage,
                timestamp=_iso_now(),
                reason=reason,
                metadata=metadata or {},
            )
            state.current = to_stage
            state.history.append(transition)
            self._write(state)

        self._emit_event(
            "run.stage.transition",
            status=to_stage,
            payload={
                "from": transition.from_stage,
                "to": transition.to_stage,
                "reason": transition.reason,
                "metadata": transition.metadata,
            },
        )
        return transition

    def complete(
        self,
        stage: str,
        *,
        extra_artifacts: Iterable[str] = (),
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Mark ``stage`` complete after verifying its declared artifacts.

        This does *not* transition into the next stage; the caller should
        invoke :meth:`enter` with the next stage after a successful
        complete. Separating the two lets orchestration layers express
        "stage is done but we're not ready to advance yet" (e.g. waiting
        on a human approval).
        """
        if stage not in STAGE_SPECS:
            raise PipelineError(f"Unknown stage: {stage!r}")
        spec = STAGE_SPECS[stage]
        required = list(spec.required_artifacts) + list(extra_artifacts)
        missing = [p for p in required if not (self.run_dir / p).exists()]
        if missing:
            self._emit_event(
                "run.stage.failed",
                status="failed",
                payload={
                    "stage": stage,
                    "reason": "missing_artifacts",
                    "missing": missing,
                },
            )
            raise StageArtifactMissingError(stage, missing)

        with self._lock:
            state = self.state()
            if stage not in state.completed_stages:
                state.completed_stages.append(stage)
                self._write(state)

        self._emit_event(
            "run.stage.completed",
            status=stage,
            payload={
                "stage": stage,
                "artifacts": required,
                "metadata": metadata or {},
            },
        )

    def fail(self, reason: str, *, metadata: dict[str, Any] | None = None) -> None:
        """Record an explicit failure transition."""
        with self._lock:
            state = self.state()
            prev = state.current
            transition = StageTransition(
                from_stage=prev,
                to_stage=STAGE_FAILED,
                timestamp=_iso_now(),
                reason=reason,
                metadata=metadata or {},
            )
            state.current = STAGE_FAILED
            state.history.append(transition)
            self._write(state)
        self._emit_event(
            "run.stage.transition",
            status=STAGE_FAILED,
            payload={
                "from": transition.from_stage,
                "to": STAGE_FAILED,
                "reason": reason,
                "metadata": metadata or {},
            },
        )

    # ----- persistence --------------------------------------------------------

    def _read(self) -> dict[str, Any] | None:
        path = self.run_dir / self._STAGES_FILENAME
        if not path.is_file():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return cast("dict[str, Any]", data)
            return None
        except (OSError, json.JSONDecodeError):
            return None

    def _write(self, state: PipelineState) -> None:
        path = self.run_dir / self._STAGES_FILENAME
        try:
            tmp = tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                suffix=".json.tmp",
                dir=str(self.run_dir),
                delete=False,
            )
            try:
                json.dump(state.to_dict(), tmp, indent=2)
                tmp.flush()
                os.fsync(tmp.fileno())
            finally:
                tmp.close()
            os.replace(tmp.name, path)
        except OSError as exc:  # pragma: no cover - disk failures only
            logger.warning("pipeline: failed to persist stages.json: %s", exc)

    def _emit_event(self, event_type: str, *, status: str, payload: dict[str, Any]) -> None:
        events_path = self.run_dir / "events.jsonl"
        record = {
            "event_type": event_type,
            "timestamp": _iso_now(),
            "actor": None,
            "payload": payload,
            "status": status,
        }
        try:
            with events_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\n")
        except OSError as exc:  # pragma: no cover - best effort
            logger.warning("pipeline: failed to append stage event: %s", exc)


def _iso_now() -> str:
    # Using ISO-8601 in UTC keeps parsing cheap on both the backend and the
    # UI; avoid ``datetime.utcnow()`` because it produces naive datetimes.
    import datetime as _dt

    return _dt.datetime.now(_dt.UTC).isoformat()


# --- Public helpers ----------------------------------------------------------


def spec_for(stage: str) -> StageSpec:
    return STAGE_SPECS[stage]


def allowed_next(current: str | None) -> tuple[str, ...]:
    """Return the stages we may legally transition into from ``current``."""
    allowed: list[str] = []
    for name, spec in STAGE_SPECS.items():
        if name in (STAGE_FAILED,):
            continue
        if spec.may_enter_from(current):
            allowed.append(name)
    # Failure is always allowed from any non-terminal state.
    if current not in (STAGE_COMPLETED, STAGE_FAILED, None):
        allowed.append(STAGE_FAILED)
    return tuple(allowed)
