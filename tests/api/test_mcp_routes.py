from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def test_custom_mcp_round_trip(client: TestClient, runs_dir: Path) -> None:
    put_resp = client.post(
        "/api/mcp/custom",
        json={
            "id": "acme",
            "name": "Acme MCP",
            "url": "https://mcp.acme.test/sse",
            "transport": "http+sse",
        },
    )
    assert put_resp.status_code == 200
    assert put_resp.json()["ok"] is True

    list_resp = client.get("/api/mcp/custom")
    assert list_resp.status_code == 200
    items = list_resp.json()["items"]
    assert any(i["id"] == "acme" for i in items)

    state_file = runs_dir / ".config" / "mcp_registry.json"
    assert state_file.exists()
    assert "acme" in state_file.read_text(encoding="utf-8")


def test_create_pat_returns_token_and_hash(client: TestClient) -> None:
    token_resp = client.post("/api/mcp/tokens", json={"label": "ops"})
    assert token_resp.status_code == 200
    body = token_resp.json()
    assert body["label"] == "ops"
    assert body["token"].startswith("nh_pat_")

    list_resp = client.get("/api/mcp/tokens")
    assert list_resp.status_code == 200
    items = list_resp.json()["items"]
    assert any(i["label"] == "ops" and len(i["token_hash"]) == 64 for i in items)

