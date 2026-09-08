from __future__ import annotations

from typing import Any

import httpx

from strix.tools.registry import register_tool


def _burp_base() -> str:
    return "http://127.0.0.1:9090"


async def _call(
    path: str, method: str = "GET", payload: dict[str, Any] | None = None
) -> dict[str, Any]:
    url = f"{_burp_base().rstrip('/')}/{path.lstrip('/')}"
    async with httpx.AsyncClient(timeout=20.0, trust_env=False) as client:
        try:
            if method == "POST":
                r = await client.post(url, json=payload or {})
            else:
                r = await client.get(url)
            return {
                "ok": 200 <= r.status_code < 300,
                "status": r.status_code,
                "data": r.text[:5000],
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}


@register_tool(sandbox_execution=True)
async def burp_proxy_history(filter: str | None = None) -> dict[str, Any]:
    return await _call("burp/history", method="POST", payload={"filter": filter})


@register_tool(sandbox_execution=True)
async def burp_send_to_repeater(request: str) -> dict[str, Any]:
    return await _call("burp/repeater", method="POST", payload={"request": request})


@register_tool(sandbox_execution=True)
async def burp_intruder_run(
    template: str, payload_set: list[str], mode: str = "sniper"
) -> dict[str, Any]:
    return await _call(
        "burp/intruder",
        method="POST",
        payload={"template": template, "payload_set": payload_set, "mode": mode},
    )


@register_tool(sandbox_execution=True)
async def burp_collaborator_generate() -> dict[str, Any]:
    return await _call("burp/collaborator/generate")


@register_tool(sandbox_execution=True)
async def burp_collaborator_poll(token: str) -> dict[str, Any]:
    return await _call("burp/collaborator/poll", method="POST", payload={"token": token})


@register_tool(sandbox_execution=True)
async def burp_scope(action: str, value: str | None = None) -> dict[str, Any]:
    return await _call("burp/scope", method="POST", payload={"action": action, "value": value})
