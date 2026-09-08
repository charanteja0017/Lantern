from __future__ import annotations

from fastapi import APIRouter, Depends

from strix.api.services.auth import Principal, require_any_member
from strix.api.services.mcp_registry import (
    issue_pat,
    list_custom_mcp_servers,
    list_pats,
    put_custom_mcp_server,
)


router = APIRouter(prefix="/api/mcp", tags=["mcp"])


@router.get("/gallery")
async def mcp_gallery(_: Principal = Depends(require_any_member)) -> dict[str, object]:
    return {
        "items": [
            {"id": "filesystem", "name": "Filesystem", "transport": "stdio"},
            {"id": "github", "name": "GitHub", "transport": "http+sse"},
            {"id": "pinecone", "name": "Pinecone", "transport": "http+sse"},
        ]
    }


@router.get("/custom")
async def list_custom(_: Principal = Depends(require_any_member)) -> dict[str, object]:
    return {"items": await list_custom_mcp_servers()}


@router.post("/custom")
async def put_custom(
    body: dict[str, str], _: Principal = Depends(require_any_member)
) -> dict[str, object]:
    row = await put_custom_mcp_server(body)
    return {"ok": True, "item": row}


@router.get("/tokens")
async def tokens(_: Principal = Depends(require_any_member)) -> dict[str, object]:
    return {"items": await list_pats()}


@router.post("/tokens")
async def create_token(
    body: dict[str, str], _: Principal = Depends(require_any_member)
) -> dict[str, object]:
    return dict(await issue_pat(body.get("label", "default")))
