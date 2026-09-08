"""Sweep logic for orphaned sandbox containers.

Pins the regression where SIGKILL'd CLIs leaked 4GB sandboxes — three of
those containers piled up on the user's host (run IDs 1777656437,
1777659887, 1777663083) and starved the next run of RAM. The janitor
reaps any ``strix-scan-*`` container whose run is no longer active.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest


class FakeContainer:
    def __init__(
        self,
        *,
        name: str,
        labels: dict[str, str] | None = None,
        started_at: str = "",
    ) -> None:
        self.name = name
        self.attrs: dict[str, Any] = {
            "Config": {"Labels": labels or {}},
            "State": {"StartedAt": started_at},
        }
        self.removed = False

    def remove(self, *, force: bool = False, v: bool = False) -> None:
        if self.removed:
            from docker.errors import NotFound

            raise NotFound("already removed")
        self.removed = True


class FakeContainersAPI:
    def __init__(self, containers: list[FakeContainer]) -> None:
        self._containers = containers

    def list(self, *, all: bool = False) -> list[FakeContainer]:  # noqa: A002
        return list(self._containers)


class FakeDockerClient:
    def __init__(self, containers: list[FakeContainer]) -> None:
        self.containers = FakeContainersAPI(containers)


@pytest.fixture
def patch_docker(monkeypatch):
    def _patch(containers: list[FakeContainer]) -> None:
        import docker

        client = FakeDockerClient(containers)
        monkeypatch.setattr(docker, "from_env", lambda timeout=None: client)

    return _patch


def _seed_active_run(runs_dir: Path, run_id: str) -> None:
    """Create a ``run.pid`` file pointing at an alive PID (this test's PID)."""

    import os

    run_dir = runs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "run.pid").write_text(f"{os.getpid()}\nstrix --run-name {run_id}\n", encoding="utf-8")


def test_janitor_reaps_orphan_named_containers(tmp_path: Path, patch_docker) -> None:
    """A ``strix-scan-*`` container with no run.pid is an orphan — reap it."""

    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()

    # Old container (started long ago) with no matching active run on disk.
    orphan = FakeContainer(
        name="strix-scan-run-old-1",
        started_at="2026-01-01T00:00:00.000000Z",
    )
    patch_docker([orphan])

    from strix.api.services.sandbox_janitor import sweep_orphans

    reaped = sweep_orphans(runs_dir)
    assert reaped == 1
    assert orphan.removed is True


def test_janitor_skips_running_active_runs(tmp_path: Path, patch_docker) -> None:
    """If the run.pid points at a live process, leave the container alone."""

    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()
    _seed_active_run(runs_dir, "run-active-1")

    container = FakeContainer(
        name="strix-scan-run-active-1",
        started_at="2026-01-01T00:00:00.000000Z",
    )
    patch_docker([container])

    from strix.api.services.sandbox_janitor import sweep_orphans

    reaped = sweep_orphans(runs_dir)
    assert reaped == 0
    assert container.removed is False


def test_janitor_ignores_unrelated_containers(tmp_path: Path, patch_docker) -> None:
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()

    other = FakeContainer(name="postgres-foo", started_at="2026-01-01T00:00:00.000000Z")
    patch_docker([other])

    from strix.api.services.sandbox_janitor import sweep_orphans

    assert sweep_orphans(runs_dir) == 0
    assert other.removed is False


def test_janitor_picks_up_label_only_containers(tmp_path: Path, patch_docker) -> None:
    """A container without our naming convention but with the label still
    counts. This catches sandboxes spawned with custom names."""

    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()

    labelled = FakeContainer(
        name="custom-name",
        labels={"strix-scan-id": "run-labelled-1"},
        started_at="2026-01-01T00:00:00.000000Z",
    )
    patch_docker([labelled])

    from strix.api.services.sandbox_janitor import sweep_orphans

    assert sweep_orphans(runs_dir) == 1
    assert labelled.removed is True


def test_janitor_is_grace_safe_for_just_started_containers(
    tmp_path: Path, patch_docker, monkeypatch
) -> None:
    """A container started <90s ago must not be reaped — the launcher writes
    the run.pid AFTER docker create, so we'd otherwise race-kill brand new
    sandboxes."""

    import time
    from datetime import UTC, datetime

    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()

    just_now = datetime.fromtimestamp(time.time() - 5, tz=UTC).isoformat().replace("+00:00", "Z")
    fresh = FakeContainer(name="strix-scan-run-fresh", started_at=just_now)
    patch_docker([fresh])

    from strix.api.services.sandbox_janitor import sweep_orphans

    assert sweep_orphans(runs_dir) == 0
    assert fresh.removed is False


def test_janitor_no_op_when_docker_unreachable(tmp_path: Path, monkeypatch) -> None:
    """If docker.from_env raises (no socket / wrong perms), don't crash."""

    import docker

    def _explode(timeout=None):  # noqa: ARG001
        raise RuntimeError("no socket")

    monkeypatch.setattr(docker, "from_env", _explode)

    from strix.api.services.sandbox_janitor import sweep_orphans

    assert sweep_orphans(tmp_path) == 0
