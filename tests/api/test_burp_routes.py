from __future__ import annotations

from fastapi.testclient import TestClient


def test_burp_history_route(client: TestClient) -> None:
    resp = client.get("/api/runs/run_123/burp/history")
    assert resp.status_code == 200
    body = resp.json()
    assert body["runId"] == "run_123"
    assert isinstance(body["items"], list)


def test_burp_repeater_route(client: TestClient) -> None:
    resp = client.post(
        "/api/runs/run_123/burp/repeater",
        json={"request": "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["runId"] == "run_123"
    assert "queued" in body

