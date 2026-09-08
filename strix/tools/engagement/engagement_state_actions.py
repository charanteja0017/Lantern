from __future__ import annotations

from typing import Any

from strix.tools.registry import register_tool


_ENGAGEMENT_STATE: dict[str, dict[str, Any]] = {}


@register_tool(sandbox_execution=False)
def set_engagement_state(run_id: str, key: str, value: Any) -> dict[str, Any]:
    bucket = _ENGAGEMENT_STATE.setdefault(run_id, {})
    bucket[key] = value
    return {"ok": True, "run_id": run_id, "state": bucket}


@register_tool(sandbox_execution=False)
def get_engagement_state(run_id: str) -> dict[str, Any]:
    return {"ok": True, "run_id": run_id, "state": _ENGAGEMENT_STATE.get(run_id, {})}
