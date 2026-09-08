"""Periodic sweep that removes orphaned sandbox containers.

Sandbox lifetimes are bound to a CLI subprocess. When the CLI exits cleanly
both ``cleanup_runtime`` (CLI side) and the run_launcher's ``_reap_sandbox_container``
(API side) tear the container down. But on SIGKILL — or when the API
restarts mid-flight — those hooks don't fire and a 4GB sandbox is leaked.

This janitor runs at API startup and on a slow loop afterward. It lists every
container that matches the sandbox naming/label convention, asks whether the
matching run is still considered active, and force-removes any that aren't.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)

_SWEEP_INTERVAL_SECONDS = 5 * 60  # 5 min — enough to catch leaks without thrashing
_SANDBOX_NAME_PREFIX = "strix-scan-"
_RUN_ACTIVE_GRACE_SECONDS = 90  # don't reap containers that just started


def _is_run_active(runs_dir: Path, run_id: str) -> bool:
    """Cheap activity check that doesn't require importing the launcher.

    A run is considered active if its ``run.pid`` file exists AND the PID is
    still alive. Mirrors :meth:`RunLauncher.is_active` without the in-memory
    handle map (which only knows about runs spawned by this process).
    """

    pid_file = runs_dir / run_id / "run.pid"
    if not pid_file.is_file():
        return False
    try:
        first = pid_file.read_text(encoding="utf-8").splitlines()[0].strip()
        pid = int(first) if first else None
    except (OSError, ValueError, IndexError):
        return False
    if pid is None:
        return False

    import os

    try:
        os.kill(pid, 0)
    except (OSError, ProcessLookupError):
        return False
    return True


def _extract_run_id(container_name: str | None, labels: dict[str, str] | None) -> str | None:
    if labels and "strix-scan-id" in labels:
        return labels["strix-scan-id"]
    if container_name and container_name.startswith(_SANDBOX_NAME_PREFIX):
        return container_name[len(_SANDBOX_NAME_PREFIX) :]
    return None


def _should_reap(
    *,
    runs_dir: Path,
    run_id: str,
    started_at_epoch: float | None,
    now_epoch: float,
) -> bool:
    """Reap iff the run isn't active. Skip very young containers to avoid a
    race where the launcher just spawned the container but the PID file isn't
    written yet (``_create_container`` runs before ``_write_pidfile``)."""

    if started_at_epoch is not None and (now_epoch - started_at_epoch) < _RUN_ACTIVE_GRACE_SECONDS:
        return False
    return not _is_run_active(runs_dir, run_id)


def _container_started_at(container_attrs: dict[str, Any]) -> float | None:
    state = container_attrs.get("State") or {}
    started_at_iso = state.get("StartedAt") or ""
    if not started_at_iso:
        return None
    try:
        from datetime import datetime

        return datetime.fromisoformat(started_at_iso.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return None


def sweep_orphans(runs_dir: Path) -> int:
    """Synchronous sweep. Returns the number of containers reaped."""

    try:
        import docker
        from docker.errors import DockerException, NotFound
    except ImportError:
        logger.debug("sandbox_janitor: docker SDK unavailable; sweep skipped")
        return 0

    try:
        client = docker.from_env(timeout=10)
    except Exception as exc:
        logger.debug("sandbox_janitor: docker.from_env failed: %s", exc)
        return 0

    import time

    now = time.time()
    reaped = 0

    try:
        # ``all=True`` so we also remove exited/dead containers that never got
        # cleaned up — they still hold the name and would block re-creation.
        containers = client.containers.list(all=True)
    except DockerException as exc:
        logger.debug("sandbox_janitor: container list failed: %s", exc)
        return 0

    for container in containers:
        name = container.name or ""
        labels = (container.attrs.get("Config") or {}).get("Labels") or {}
        run_id = _extract_run_id(name, labels)
        if run_id is None:
            continue
        if not (name.startswith(_SANDBOX_NAME_PREFIX) or "strix-scan-id" in labels):
            continue

        started_at = _container_started_at(container.attrs)
        if not _should_reap(
            runs_dir=runs_dir,
            run_id=run_id,
            started_at_epoch=started_at,
            now_epoch=now,
        ):
            continue

        try:
            container.remove(force=True, v=True)
            reaped += 1
            logger.info(
                "sandbox_janitor: reaped orphan sandbox %s (run=%s)",
                name,
                run_id,
            )
        except (DockerException, NotFound) as exc:
            logger.debug(
                "sandbox_janitor: could not remove %s: %s",
                name,
                exc,
            )
            continue

    return reaped


async def run_sandbox_janitor_loop(runs_dir: Path) -> None:
    """Background coroutine: sweep at startup, then every 5 minutes.

    Best-effort and exception-safe: a failed sweep just logs and waits for
    the next interval rather than killing the loop.
    """

    logger.info("sandbox_janitor: starting (interval=%ds)", _SWEEP_INTERVAL_SECONDS)
    while True:
        try:
            await asyncio.to_thread(sweep_orphans, runs_dir)
        except Exception as exc:
            logger.warning("sandbox_janitor: sweep failed: %s", exc)
        await asyncio.sleep(_SWEEP_INTERVAL_SECONDS)
