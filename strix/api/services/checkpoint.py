"""Durable checkpoint store for resumable sessions.

Writes per-run checkpoints to ``strix_runs/<run_name>/checkpoints/`` as JSON
so a backend restart, tab close, or token exhaustion can reopen the same
dashboard URL and continue from the last saved state.

Checkpoints are idempotent and append-only: the latest by mtime is the
source of truth, older ones are kept for audit.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any, cast


class CheckpointStore:
    def __init__(self, runs_dir: str | Path):
        self.runs_dir = Path(runs_dir)

    def _dir(self, run_id: str) -> Path:
        d = self.runs_dir / run_id / "checkpoints"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def save(self, run_id: str, state: dict[str, Any], reason: str = "periodic") -> str:
        target = self._dir(run_id)
        ts = int(time.time() * 1000)
        payload = {"ts": ts, "reason": reason, "state": state}
        tmp = tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            suffix=".json.tmp",
            dir=str(target),
            delete=False,
        )
        try:
            json.dump(payload, tmp)
            tmp.flush()
            os.fsync(tmp.fileno())
        finally:
            tmp.close()
        final = target / f"ckpt-{ts}.json"
        os.replace(tmp.name, final)
        return str(final)

    def latest(self, run_id: str) -> dict[str, Any] | None:
        target = self._dir(run_id)
        candidates = sorted(
            target.glob("ckpt-*.json"), key=lambda p: p.stat().st_mtime, reverse=True
        )
        for path in candidates:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return cast("dict[str, Any]", data)
            except (OSError, json.JSONDecodeError):
                continue
        return None
