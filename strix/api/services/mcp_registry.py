from __future__ import annotations

import json
import secrets
from hashlib import sha256
from pathlib import Path
from typing import Any, cast

from strix.api.services.db import get_pg_pool
from strix.api.settings import get_settings


def _state_file() -> Path:
    path = Path(get_settings().runs_dir) / ".config" / "mcp_registry.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(json.dumps({"custom": [], "tokens": []}), encoding="utf-8")
    return path


def _read_local() -> dict[str, Any]:
    data = json.loads(_state_file().read_text(encoding="utf-8"))
    if isinstance(data, dict):
        return cast("dict[str, Any]", data)
    return {"custom": [], "tokens": []}


def _write_local(state: dict[str, Any]) -> None:
    _state_file().write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


async def list_custom_mcp_servers() -> list[dict[str, Any]]:
    pool = await get_pg_pool()
    if pool is None:
        return list(_read_local().get("custom", []))
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, name, url, transport, enabled, metadata
            FROM strix_mcp_servers
            ORDER BY created_at DESC
            """
        )
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "url": row["url"],
            "transport": row["transport"],
            "enabled": bool(row["enabled"]),
            "metadata": dict(row["metadata"] or {}),
        }
        for row in rows
    ]


async def put_custom_mcp_server(payload: dict[str, Any]) -> dict[str, Any]:
    data = {
        "id": str(payload.get("id") or "custom"),
        "name": str(payload.get("name") or "Custom MCP"),
        "url": str(payload.get("url") or ""),
        "transport": str(payload.get("transport") or "http+sse"),
        "enabled": bool(payload.get("enabled", True)),
        "metadata": payload.get("metadata") or {},
    }
    pool = await get_pg_pool()
    if pool is None:
        state = _read_local()
        custom = [c for c in state.get("custom", []) if c.get("id") != data["id"]]
        custom.append(data)
        state["custom"] = custom
        _write_local(state)
        return data
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO strix_mcp_servers
              (id, name, url, transport, enabled, metadata, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())
            ON CONFLICT (id) DO UPDATE SET
              name=EXCLUDED.name,
              url=EXCLUDED.url,
              transport=EXCLUDED.transport,
              enabled=EXCLUDED.enabled,
              metadata=EXCLUDED.metadata,
              updated_at=NOW()
            """,
            data["id"],
            data["name"],
            data["url"],
            data["transport"],
            data["enabled"],
            data["metadata"],
        )
    return data


async def issue_pat(label: str) -> dict[str, str]:
    raw = f"nh_pat_{secrets.token_urlsafe(24)}"
    digest = sha256(raw.encode("utf-8")).hexdigest()
    pool = await get_pg_pool()
    if pool is None:
        state = _read_local()
        tokens = [t for t in state.get("tokens", []) if t.get("label") != label]
        tokens.append({"label": label, "token_hash": digest})
        state["tokens"] = tokens
        _write_local(state)
        return {"label": label, "token": raw}
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO strix_mcp_tokens (label, token_hash, updated_at)
            VALUES ($1,$2,NOW())
            ON CONFLICT (label) DO UPDATE SET token_hash=EXCLUDED.token_hash, updated_at=NOW()
            """,
            label,
            digest,
        )
    return {"label": label, "token": raw}


async def list_pats() -> list[dict[str, str]]:
    pool = await get_pg_pool()
    if pool is None:
        return [
            {"label": str(t.get("label")), "token_hash": str(t.get("token_hash"))}
            for t in _read_local().get("tokens", [])
        ]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT label, token_hash FROM strix_mcp_tokens ORDER BY created_at DESC"
        )
    return [{"label": row["label"], "token_hash": row["token_hash"]} for row in rows]
