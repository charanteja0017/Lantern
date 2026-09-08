from __future__ import annotations

from strix.tools.capabilities.install_capability_actions import install_capability, list_capabilities


def test_list_capabilities_contains_seeded_entries() -> None:
    result = list_capabilities()
    assert "capabilities" in result
    assert any(c.get("id") == "ffuf" for c in result["capabilities"])


def test_install_capability_unknown() -> None:
    result = install_capability("does-not-exist")
    assert result["ok"] is False

