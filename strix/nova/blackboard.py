from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from strix.telemetry.tracer import get_global_tracer


logger = logging.getLogger(__name__)

FindingKind = Literal[
    "Target",
    "Subdomain",
    "PortOpen",
    "HttpEndpoint",
    "Technology",
    "CveMatch",
    "Misconfiguration",
    "ExploitAttempt",
    "ExploitResult",
    "Note",
    "CampaignComplete",
    "ToolResult",
]


@dataclass(frozen=True)
class BlackboardFinding:
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


class Blackboard:
    """Run-scoped nova blackboard backed by Postgres.

    Best-effort: if Postgres/asyncpg is unavailable, methods no-op or return [].
    """

    def __init__(self, database_url: str | None):
        self.database_url = (database_url or "").strip()
        self._pool: Any | None = None

    async def _pool_acquire(self) -> Any | None:
        if not self.database_url:
            return None
        if self._pool is not None:
            return self._pool
        try:
            import asyncpg

            self._pool = await asyncpg.create_pool(self.database_url, min_size=1, max_size=5)
            return self._pool
        except Exception as exc:
            logger.debug("nova blackboard pool init failed: %s", exc)
            self._pool = None
            return None

    async def write_finding(
        self,
        *,
        run_id: str,
        kind: FindingKind,
        payload: dict[str, Any] | None = None,
        evidence: dict[str, Any] | None = None,
        confidence: float = 0.5,
        severity: float = 0.0,
        pheromone: float = 0.1,
        half_life_seconds: int = 3600,
    ) -> str | None:
        pool = await self._pool_acquire()
        if pool is None:
            return None
        payload = payload or {}
        evidence = evidence or {}
        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    """
                    INSERT INTO nova_findings (
                        run_id, kind, payload, evidence,
                        confidence, severity, pheromone, half_life_seconds,
                        last_boosted_at, created_at, updated_at
                    )
                    VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, NOW(), NOW(), NOW())
                    RETURNING id::text
                    """,
                    run_id,
                    str(kind),
                    payload,
                    evidence,
                    float(confidence),
                    float(severity),
                    float(pheromone),
                    int(max(1, half_life_seconds)),
                )
            finding_id = str(row["id"]) if row and row.get("id") else None
        except Exception as exc:
            logger.debug("nova blackboard write failed: %s", exc)
            return None

        tracer = get_global_tracer()
        if tracer and finding_id:
            actor_agent_id = None
            try:
                keys = list((tracer.agents or {}).keys())
                actor_agent_id = keys[0] if keys else None
            except Exception:
                actor_agent_id = None
            tracer._emit_event(
                "nova.finding.created",
                actor={"agent_id": actor_agent_id},
                payload={
                    "id": finding_id,
                    "run_id": run_id,
                    "kind": kind,
                    "payload": payload,
                    "evidence": evidence,
                    "confidence": confidence,
                    "severity": severity,
                    "pheromone": pheromone,
                    "half_life_seconds": half_life_seconds,
                    "created_at": iso_now(),
                },
                status="created",
                source="strix.nova.blackboard",
            )
        return finding_id

    async def list_findings(
        self,
        *,
        run_id: str,
        kinds: list[str] | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[BlackboardFinding]:
        pool = await self._pool_acquire()
        if pool is None:
            return []
        kinds = [k for k in (kinds or []) if k]
        limit = max(1, min(int(limit), 500))
        offset = max(0, int(offset))
        try:
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
        except Exception as exc:
            logger.debug("nova blackboard list failed: %s", exc)
            return []

        out: list[BlackboardFinding] = []
        for r in rows:
            out.append(
                BlackboardFinding(
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
        return out


_GLOBAL_BLACKBOARD: Blackboard | None = None


def get_blackboard() -> Blackboard:
    global _GLOBAL_BLACKBOARD
    if _GLOBAL_BLACKBOARD is not None:
        return _GLOBAL_BLACKBOARD
    import os

    url = os.getenv("STRIX_DATABASE_URL") or os.getenv("DATABASE_URL") or ""
    _GLOBAL_BLACKBOARD = Blackboard(url)
    return _GLOBAL_BLACKBOARD


def iso_now() -> str:
    return datetime.now(UTC).isoformat()
