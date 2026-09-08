from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from strix.api.services.auth import Principal, require_any_member
from strix.api.services.db import get_pg_pool


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/runs", tags=["nova-blackboard"])


class BlackboardFindingRow(BaseModel):
    id: str
    run_id: str
    kind: str
    payload: dict[str, Any]
    evidence: dict[str, Any]
    confidence: float
    severity: float
    pheromone: float
    effective_pheromone: float
    created_at: str
    updated_at: str


class BlackboardListResponse(BaseModel):
    runId: str
    items: list[BlackboardFindingRow]
    limit: int
    offset: int


@router.get("/{run_id}/blackboard", response_model=BlackboardListResponse)
async def list_blackboard(
    run_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=100000),
    kind: list[str] | None = Query(default=None),
    _: Principal = Depends(require_any_member),
) -> BlackboardListResponse:
    pool = await get_pg_pool()
    if pool is None:
        raise HTTPException(status_code=503, detail="Postgres not configured")
    kinds = [k.strip() for k in (kind or []) if k and k.strip()]

    async with pool.acquire() as conn:
        if kinds:
            rows = await conn.fetch(
                """
                SELECT
                  id::text,
                  run_id,
                  kind,
                  payload,
                  evidence,
                  confidence,
                  severity,
                  pheromone,
                  effective_pheromone,
                  created_at::text,
                  updated_at::text
                FROM nova_findings_scored
                WHERE run_id=$1 AND kind = ANY($2::text[])
                ORDER BY effective_pheromone DESC, created_at DESC
                LIMIT $3 OFFSET $4
                """,
                run_id,
                kinds,
                limit,
                offset,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT
                  id::text,
                  run_id,
                  kind,
                  payload,
                  evidence,
                  confidence,
                  severity,
                  pheromone,
                  effective_pheromone,
                  created_at::text,
                  updated_at::text
                FROM nova_findings_scored
                WHERE run_id=$1
                ORDER BY effective_pheromone DESC, created_at DESC
                LIMIT $2 OFFSET $3
                """,
                run_id,
                limit,
                offset,
            )

    items: list[BlackboardFindingRow] = []
    for r in rows:
        items.append(
            BlackboardFindingRow(
                id=str(r["id"]),
                run_id=str(r["run_id"]),
                kind=str(r["kind"]),
                payload=dict(r["payload"] or {}),
                evidence=dict(r["evidence"] or {}),
                confidence=float(r["confidence"] or 0.0),
                severity=float(r["severity"] or 0.0),
                pheromone=float(r["pheromone"] or 0.0),
                effective_pheromone=float(r["effective_pheromone"] or 0.0),
                created_at=str(r["created_at"]),
                updated_at=str(r["updated_at"]),
            )
        )

    return BlackboardListResponse(runId=run_id, items=items, limit=limit, offset=offset)
