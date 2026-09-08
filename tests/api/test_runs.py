"""Smoke tests for the runs API using a synthesized events.jsonl."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient


def _seed_run(runs_dir: Path, run_id: str = "run_test_1") -> Path:
    run_dir = runs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    events = run_dir / "events.jsonl"
    now = datetime.now(tz=timezone.utc).isoformat()
    lines = [
        {
            "event_type": "run.started",
            "timestamp": now,
            "run_metadata": {
                "run_name": run_id,
                "targets": ["https://example.com"],
                "scan_mode": "standard",
                "scope_mode": "strict",
            },
        },
        {
            "event_type": "agent.created",
            "timestamp": now,
            "actor": {"agent_id": "root", "agent_name": "Root"},
            "payload": {"task": "scan"},
        },
        {
            "event_type": "chat.message",
            "timestamp": now,
            "actor": {"agent_id": "root", "role": "assistant"},
            "payload": {"message_id": 1, "content": "hello"},
        },
    ]
    with events.open("w", encoding="utf-8") as fh:
        for line in lines:
            fh.write(json.dumps(line) + "\n")
    return run_dir


def test_list_runs_reads_events(client: TestClient, runs_dir: Path) -> None:
    _seed_run(runs_dir)
    resp = client.get("/api/runs")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    assert any(r["id"] == "run_test_1" for r in body)


def test_get_run_detail(client: TestClient, runs_dir: Path) -> None:
    _seed_run(runs_dir, "run_test_2")
    resp = client.get("/api/runs/run_test_2")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == "run_test_2"
    assert body["targets"] == ["https://example.com"]
    assert any(a["id"] == "root" for a in body["agents"])


def test_get_unknown_run_returns_404(client: TestClient) -> None:
    resp = client.get("/api/runs/does-not-exist")
    assert resp.status_code == 404


def test_create_run_requires_target(client: TestClient) -> None:
    resp = client.post("/api/runs", json={"targets": [], "instruction": "x"})
    assert resp.status_code == 400
