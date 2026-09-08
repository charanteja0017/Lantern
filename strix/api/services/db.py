"""Postgres + Redis integration.

The API can run in three modes:

* **File-only** (default): no Postgres, no Redis. Run state and checkpoints
  live in ``strix_runs/``. Great for single-node VPS and for demo.
* **Redis-only**: distributed rate-limit counters, pub/sub for event streaming
  across multiple API workers. Checkpoints still on disk.
* **Postgres + Redis**: production multi-tenant deployment. Postgres stores
  orgs/users/runs/findings/audit metadata; Redis provides ephemeral streams
  and rate-limit counters; ``strix_runs/`` remains the artifact source of
  truth.

This module exposes lazy async clients so the API boots cleanly regardless of
configuration.
"""

from __future__ import annotations

import logging
from typing import Any

from strix.api.settings import get_settings


logger = logging.getLogger(__name__)

_redis_client: Any | None = None
_pg_pool: Any | None = None


async def get_redis() -> Any | None:
    """Return a shared Redis client, or ``None`` if Redis is not configured."""
    global _redis_client
    settings = get_settings()
    if not settings.redis_enabled:
        return None
    if _redis_client is not None:
        return _redis_client
    try:
        import redis.asyncio as aioredis
    except ImportError:
        logger.warning("redis package not installed; skipping Redis integration")
        return None
    _redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


async def get_pg_pool() -> Any | None:
    """Return a shared asyncpg pool, or ``None`` if Postgres is not configured.

    The pool is created lazily on first use and cached for the life of the
    worker. If the driver is missing or the first connection attempt fails
    (Postgres still booting, network hiccup, bad credentials), we log and
    return ``None`` so callers can degrade gracefully instead of raising.
    Subsequent calls will re-attempt creation, which matters when Postgres
    becomes available *after* the API worker has already started.
    """
    global _pg_pool
    settings = get_settings()
    if not settings.postgres_enabled:
        return None
    if _pg_pool is not None:
        return _pg_pool
    try:
        import asyncpg
    except ImportError:
        logger.warning("asyncpg not installed; skipping Postgres integration")
        return None
    try:
        _pg_pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=10)
    except Exception as exc:
        logger.warning("asyncpg pool creation failed: %s", exc)
        _pg_pool = None
        return None
    return _pg_pool


INIT_SQL = """
-- pgvector (required for nova blackboard embeddings).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS organizations (
    id          TEXT PRIMARY KEY,
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    email       TEXT UNIQUE NOT NULL,
    role        TEXT NOT NULL DEFAULT 'viewer',
    org_id      TEXT NOT NULL REFERENCES organizations(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS runs (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL REFERENCES organizations(id),
    created_by    TEXT NOT NULL REFERENCES users(id),
    status        TEXT NOT NULL,
    targets       JSONB NOT NULL,
    scan_mode     TEXT NOT NULL,
    scope_mode    TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMPTZ,
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS runs_org_status_idx ON runs (org_id, status);

CREATE TABLE IF NOT EXISTS findings_index (
    id          TEXT PRIMARY KEY,
    run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    severity    TEXT NOT NULL,
    title       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS findings_run_sev_idx ON findings_index (run_id, severity);

CREATE TABLE IF NOT EXISTS audit_log (
    id          TEXT PRIMARY KEY,
    actor_id    TEXT NOT NULL,
    actor_email TEXT,
    role        TEXT NOT NULL,
    org_id      TEXT,
    action      TEXT NOT NULL,
    target      TEXT NOT NULL,
    ip          TEXT,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log (created_at DESC);

-- Per-scope LLM role routes. ``scope`` is ``global``, ``org``, or ``run``.
-- For ``global`` rows ``scope_id`` is the literal string ``global``; for
-- ``org`` it is the organization id; for ``run`` it is the run id. The
-- composite primary key keeps each (scope, scope_id, role) pair unique
-- while allowing multiple orgs / runs to have their own overrides.
CREATE TABLE IF NOT EXISTS strix_llm_routes (
    scope            TEXT NOT NULL,
    scope_id         TEXT NOT NULL,
    role             TEXT NOT NULL,
    model            TEXT NOT NULL,
    api_key_ref      TEXT,
    api_base         TEXT,
    reasoning_effort TEXT,
    max_tokens       INTEGER,
    temperature      DOUBLE PRECISION,
    budget_usd       DOUBLE PRECISION,
    enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (scope, scope_id, role)
);

CREATE INDEX IF NOT EXISTS strix_llm_routes_role_idx ON strix_llm_routes (role);

CREATE TABLE IF NOT EXISTS strix_secrets (
    name        TEXT PRIMARY KEY,
    nonce       BYTEA NOT NULL,
    ciphertext  BYTEA NOT NULL,
    preview     TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strix_scan_schedules (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    targets       JSONB NOT NULL,
    cron_expr     TEXT NOT NULL,
    scan_mode     TEXT NOT NULL DEFAULT 'standard',
    scope_mode    TEXT NOT NULL DEFAULT 'auto',
    instruction   TEXT,
    policy        JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at   TIMESTAMPTZ,
    next_run_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS strix_scan_schedules_enabled_idx
ON strix_scan_schedules (enabled, next_run_at);

CREATE TABLE IF NOT EXISTS strix_finding_fingerprints (
    fingerprint_sha256 TEXT PRIMARY KEY,
    finding_id         TEXT NOT NULL,
    run_id             TEXT NOT NULL,
    target             TEXT NOT NULL DEFAULT '',
    vuln_class         TEXT NOT NULL DEFAULT '',
    endpoint           TEXT NOT NULL DEFAULT '',
    param_name         TEXT NOT NULL DEFAULT '',
    payload_shape      TEXT NOT NULL DEFAULT '',
    occurrences        INTEGER NOT NULL DEFAULT 1,
    first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS strix_finding_fingerprints_run_idx
ON strix_finding_fingerprints (run_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS strix_integrations (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    name            TEXT NOT NULL,
    endpoint_url    TEXT NOT NULL,
    secret_ref      TEXT,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS strix_integrations_enabled_idx
ON strix_integrations (enabled, kind);

CREATE TABLE IF NOT EXISTS strix_mcp_servers (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    url           TEXT NOT NULL,
    transport     TEXT NOT NULL DEFAULT 'http+sse',
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS strix_mcp_servers_enabled_idx
ON strix_mcp_servers (enabled, transport);

CREATE TABLE IF NOT EXISTS strix_mcp_tokens (
    label         TEXT PRIMARY KEY,
    token_hash    TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --- Swarm blackboard (run-scoped) -----------------------------------------
CREATE TABLE IF NOT EXISTS nova_findings (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id             TEXT NOT NULL,
    kind              TEXT NOT NULL,
    payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence          JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence        DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    severity          DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    pheromone         DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    half_life_seconds INTEGER NOT NULL DEFAULT 3600,
    last_boosted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    embedding         vector(1536),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nova_findings_run_idx ON nova_findings (run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS nova_findings_kind_idx ON nova_findings (run_id, kind);

CREATE TABLE IF NOT EXISTS nova_agent_cursors (
    run_id       TEXT NOT NULL,
    agent_key    TEXT NOT NULL,
    cursor_ts    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (run_id, agent_key)
);

-- Best-effort effective pheromone view (decays without rewriting rows).
CREATE OR REPLACE VIEW nova_findings_scored AS
SELECT
    f.*,
    (
      f.pheromone
      * EXP(
          -LN(2)
          * (EXTRACT(EPOCH FROM (NOW() - f.last_boosted_at)) / GREATEST(f.half_life_seconds, 1))
        )
    ) AS effective_pheromone
FROM nova_findings f;
"""


async def ensure_schema() -> None:
    pool = await get_pg_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        await conn.execute(INIT_SQL)
