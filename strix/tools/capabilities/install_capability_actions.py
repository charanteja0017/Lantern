from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from strix.tools.registry import register_tool


def _registry_path() -> Path:
    return Path(__file__).resolve().parents[2] / "capabilities" / "registry.yaml"


def _load_registry() -> list[dict[str, Any]]:
    data = yaml.safe_load(_registry_path().read_text(encoding="utf-8")) or []
    return data if isinstance(data, list) else []


@register_tool(sandbox_execution=True)
def list_capabilities() -> dict[str, Any]:
    return {"capabilities": _load_registry()}


@register_tool(sandbox_execution=True)
def install_capability(capability_id: str) -> dict[str, Any]:
    caps = _load_registry()
    cap = next((c for c in caps if str(c.get("id")) == capability_id), None)
    if cap is None:
        return {"ok": False, "error": f"Unknown capability: {capability_id}"}
    # Installation is executed by sandbox command toolchain at runtime.
    raw_install = cap.get("install")
    install: dict[str, Any] = raw_install if isinstance(raw_install, dict) else {}
    return {"ok": True, "capability": cap, "command": install.get("command")}
