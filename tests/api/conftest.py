"""Shared test fixtures for the web API suite."""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _isolated_runs_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    runs = tmp_path / "strix_runs"
    runs.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("STRIX_RUNS_DIR", str(runs))
    monkeypatch.setenv("STRIX_ENV", "development")
    monkeypatch.setenv("STRIX_DATABASE_URL", "")
    monkeypatch.setenv("STRIX_REDIS_URL", "")
    # Reset cached settings so the next import picks up the overrides.
    from strix.api import settings as api_settings

    api_settings.get_settings.cache_clear()
    yield runs


@pytest.fixture
def client() -> TestClient:
    # Late import so env vars above apply before app creation.
    from strix.api.app import create_app

    app = create_app()
    return TestClient(app)


@pytest.fixture
def runs_dir() -> Path:
    return Path(os.environ["STRIX_RUNS_DIR"])
