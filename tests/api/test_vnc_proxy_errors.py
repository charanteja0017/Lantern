"""Iframe-friendly error rendering for the VNC sidechannel proxy.

These tests pin the regression that motivated the rewrite: when the sandbox
container is gone (run finished, never started, or just unreachable) the
dashboard iframe must show a useful HTML page — not a JSON 404 blocked by
``X-Frame-Options: DENY``.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from fastapi.testclient import TestClient

from strix.api.services.sidechannel_tokens import sign_sidechannel_token


def _seed_run(runs_dir: Path, run_id: str) -> None:
    run_dir = runs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    events = run_dir / "events.jsonl"
    events.write_text(
        json.dumps(
            {
                "id": "evt-1",
                "type": "run.started",
                "timestamp": "2026-01-01T00:00:00Z",
                "metadata": {"target": "https://example.com"},
            }
        )
        + "\n",
        encoding="utf-8",
    )


def _signed_token(run_id: str) -> str:
    return sign_sidechannel_token(
        {
            "iss": "strix",
            "aud": "vnc",
            "run_id": run_id,
            "user_id": "u_test",
            "org_id": "org_test",
            "iat": int(time.time()),
            "exp": int(time.time()) + 600,
        }
    )


def test_vnc_unknown_run_returns_iframe_friendly_html(client: TestClient) -> None:
    resp = client.get("/api/runs/does-not-exist/vnc/", follow_redirects=False)
    assert resp.status_code == 404
    assert "text/html" in resp.headers.get("content-type", "").lower()
    # The global Caddy DENY must NOT leak through; the proxy itself sets ALLOWALL
    # so the iframe always renders the error page.
    assert resp.headers.get("X-Frame-Options", "").upper() != "DENY"
    assert "frame-ancestors" in resp.headers.get("Content-Security-Policy", "").lower()
    assert "Live browser not available" in resp.text


def test_vnc_missing_token_renders_iframe_friendly_session_expired(
    client: TestClient, runs_dir: Path
) -> None:
    _seed_run(runs_dir, "run-tokenless")
    resp = client.get("/api/runs/run-tokenless/vnc/foo", follow_redirects=False)
    assert resp.status_code == 401
    assert "text/html" in resp.headers.get("content-type", "").lower()
    assert resp.headers.get("X-Frame-Options", "").upper() != "DENY"
    assert "session expired" in resp.text.lower()


def test_vnc_invalid_token_renders_iframe_friendly_403(
    client: TestClient, runs_dir: Path
) -> None:
    _seed_run(runs_dir, "run-badtoken")
    resp = client.get(
        "/api/runs/run-badtoken/vnc/foo?token=not-a-real-token",
        follow_redirects=False,
    )
    assert resp.status_code == 403
    assert "text/html" in resp.headers.get("content-type", "").lower()
    assert resp.headers.get("X-Frame-Options", "").upper() != "DENY"


def test_vnc_no_sandbox_container_renders_friendly_404(
    client: TestClient, runs_dir: Path, monkeypatch
) -> None:
    """When the run exists and the token verifies but no sandbox is running,
    the upstream-port lookup returns 404. The iframe must still get HTML."""

    _seed_run(runs_dir, "run-nosandbox")

    # Stub out the Docker introspection to simulate a missing container.
    from fastapi import HTTPException

    from strix.api.routes import run_sidechannel_proxy

    def _no_container(_run_id: str) -> tuple[str, int]:
        raise HTTPException(
            status_code=404,
            detail="No active sandbox container for this run (noVNC unavailable).",
        )

    monkeypatch.setattr(run_sidechannel_proxy, "novnc_upstream_host_port", _no_container)

    token = _signed_token("run-nosandbox")
    resp = client.get(
        f"/api/runs/run-nosandbox/vnc/?token={token}", follow_redirects=False
    )
    assert resp.status_code == 404
    assert "text/html" in resp.headers.get("content-type", "").lower()
    assert resp.headers.get("X-Frame-Options", "").upper() != "DENY"
    # Run is "running" (only run.started seeded) so the diagnostic should
    # explain the agent hasn't spawned the sandbox yet.
    assert "Sandbox not yet attached" in resp.text


def _seed_failed_run(runs_dir: Path, run_id: str, reason: str) -> None:
    run_dir = runs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    events = run_dir / "events.jsonl"
    # Mirror the on-disk shape ``RunLauncher._write_synthetic_failure`` produces:
    # ``event_type`` plus ``payload.reason`` — that's what the events reader
    # uses to build the ``run.failed`` message the dashboard surfaces.
    lines = [
        json.dumps(
            {"event_type": "run.started", "timestamp": "2026-01-01T00:00:00Z", "payload": {}}
        ),
        json.dumps(
            {
                "event_type": "run.failed",
                "timestamp": "2026-01-01T00:01:00Z",
                "payload": {"reason": reason},
                "status": "failed",
            }
        ),
    ]
    events.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_vnc_failed_run_surfaces_failure_reason(
    client: TestClient, runs_dir: Path, monkeypatch
) -> None:
    _seed_failed_run(
        runs_dir,
        "run-failed",
        "STRIX_LLM is not configured — refusing to start scan.",
    )

    from fastapi import HTTPException

    from strix.api.routes import run_sidechannel_proxy

    def _no_container(_run_id: str) -> tuple[str, int]:
        raise HTTPException(status_code=404, detail="no container")

    monkeypatch.setattr(run_sidechannel_proxy, "novnc_upstream_host_port", _no_container)

    token = _signed_token("run-failed")
    resp = client.get(
        f"/api/runs/run-failed/vnc/?token={token}", follow_redirects=False
    )
    assert resp.status_code == 404
    assert "Run failed" in resp.text
    assert "STRIX_LLM is not configured" in resp.text


def _seed_completed_run(runs_dir: Path, run_id: str) -> None:
    run_dir = runs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    events = run_dir / "events.jsonl"
    lines = [
        json.dumps(
            {"event_type": "run.started", "timestamp": "2026-01-01T00:00:00Z", "payload": {}}
        ),
        json.dumps(
            {"event_type": "run.completed", "timestamp": "2026-01-01T00:30:00Z", "payload": {}}
        ),
    ]
    events.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_vnc_completed_run_says_scan_finished(
    client: TestClient, runs_dir: Path, monkeypatch
) -> None:
    _seed_completed_run(runs_dir, "run-done")

    from fastapi import HTTPException

    from strix.api.routes import run_sidechannel_proxy

    def _no_container(_run_id: str) -> tuple[str, int]:
        raise HTTPException(status_code=404, detail="no container")

    monkeypatch.setattr(run_sidechannel_proxy, "novnc_upstream_host_port", _no_container)

    token = _signed_token("run-done")
    resp = client.get(f"/api/runs/run-done/vnc/?token={token}", follow_redirects=False)
    assert resp.status_code == 404
    assert "Scan finished" in resp.text or "torn down" in resp.text


def test_legacy_vnc_path_redirects_with_iframe_headers(
    client: TestClient, runs_dir: Path
) -> None:
    """Legacy ``/runs/{id}/vnc/...`` paths redirect to ``/api/runs/...`` and
    still need iframe-friendly headers — otherwise the redirect itself can be
    blocked by Chrome on the global DENY policy."""

    _seed_run(runs_dir, "run-legacy")
    resp = client.get("/runs/run-legacy/vnc/?token=foo", follow_redirects=False)
    assert resp.status_code == 307
    assert resp.headers["location"].startswith("/api/runs/run-legacy/vnc/")
    assert resp.headers.get("X-Frame-Options", "").upper() != "DENY"
