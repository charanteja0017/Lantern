"""RBAC smoke tests for admin routes."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_admin_routes_reachable_in_dev(client: TestClient) -> None:
    # In dev (auth disabled) the demo principal has platform-admin role.
    for path in ("/api/admin/orgs", "/api/admin/rate-limits", "/api/admin/audit"):
        resp = client.get(path)
        assert resp.status_code in (200, 204)
