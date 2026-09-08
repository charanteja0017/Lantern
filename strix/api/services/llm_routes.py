"""Persistence + Redis budget counters for the LLM role router.

The router core (:mod:`strix.llm.router`) holds route specs in memory so the
LLM call path stays fast. This module owns three responsibilities:

1. Load all ``global`` / ``org`` / ``run`` :class:`RouteSpec` rows from the
   ``strix_llm_routes`` table into the in-memory router at boot (and on
   write).
2. Serialize the router back to the DB when an admin or run-creation flow
   updates it.
3. Track **budget counters** in Redis so we can surface ``$X / $budget
   used`` in the UI and short-circuit calls once a role's per-run budget is
   exhausted. When Redis is unavailable we degrade to a no-op so file-only
   installs continue to work.

The schema matches the columns created in ``strix/api/services/db.py``.
``api_key_ref`` is intentionally a reference to a secret name rather than
the raw API key - the encrypted secret store added in Phase 14 resolves
the reference at router-apply time.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict
from typing import Any

from strix.api.services.db import get_pg_pool, get_redis
from strix.llm.router import ALL_ROLES, Role, RouteSpec, Scope, get_router


logger = logging.getLogger(__name__)

GLOBAL_SCOPE_ID = "global"


# --- serialization helpers --------------------------------------------------


def _row_to_spec(row: Any, *, resolved_api_key: str | None = None) -> RouteSpec:
    return RouteSpec(
        role=row["role"],
        model=row["model"],
        api_key=resolved_api_key,
        api_base=row["api_base"],
        reasoning_effort=row["reasoning_effort"],
        max_tokens=row["max_tokens"],
        temperature=row["temperature"],
        budget_usd=row["budget_usd"],
        enabled=bool(row["enabled"]),
        scope=row["scope"],
    )


def spec_to_dict(spec: RouteSpec) -> dict[str, Any]:
    """Return a JSON-safe snapshot of ``spec`` (API response shape)."""
    data = asdict(spec)
    data.pop("api_key", None)  # never leak keys through the API
    return data


# --- DB I/O -----------------------------------------------------------------


async def load_routes_from_db() -> dict[Scope, dict[str, list[RouteSpec]]]:
    """Load all saved routes, grouped by scope + scope_id.

    Returns ``{"global": {"global": [...]}, "org": {<org_id>: [...]}, "run": {<run_id>: [...]}}``.
    Empty dict when Postgres is not configured. Each row's ``api_key_ref``
    is resolved via the encrypted secret store so specs carry plaintext
    keys ready for LiteLLM.
    """
    from strix.api.services.secrets import resolve_reference

    pool = await get_pg_pool()
    out: dict[Scope, dict[str, list[RouteSpec]]] = {
        "global": {},
        "org": {},
        "run": {},
    }
    if pool is None:
        return out
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT scope, scope_id, role, model, api_key_ref, api_base, "
            "reasoning_effort, max_tokens, temperature, budget_usd, enabled "
            "FROM strix_llm_routes"
        )
    for row in rows:
        resolved = await resolve_reference(row["api_key_ref"])
        scope_map = out[row["scope"]]
        scope_map.setdefault(row["scope_id"], []).append(
            _row_to_spec(row, resolved_api_key=resolved)
        )
    return out


async def save_route(
    *,
    scope: Scope,
    scope_id: str,
    spec: RouteSpec,
    api_key_ref: str | None = None,
) -> None:
    """Upsert one route row."""
    pool = await get_pg_pool()
    if pool is None:
        logger.warning("save_route called but Postgres is not configured; keeping in-memory only")
        get_router()  # ensure singleton initialized
        _apply_in_memory(scope, scope_id, spec)
        return
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO strix_llm_routes (
                scope, scope_id, role, model, api_key_ref, api_base,
                reasoning_effort, max_tokens, temperature, budget_usd, enabled, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
            ON CONFLICT (scope, scope_id, role) DO UPDATE SET
                model            = EXCLUDED.model,
                api_key_ref      = EXCLUDED.api_key_ref,
                api_base         = EXCLUDED.api_base,
                reasoning_effort = EXCLUDED.reasoning_effort,
                max_tokens       = EXCLUDED.max_tokens,
                temperature      = EXCLUDED.temperature,
                budget_usd       = EXCLUDED.budget_usd,
                enabled          = EXCLUDED.enabled,
                updated_at       = NOW()
            """,
            scope,
            scope_id,
            spec.role,
            spec.model,
            api_key_ref,
            spec.api_base,
            spec.reasoning_effort,
            spec.max_tokens,
            spec.temperature,
            spec.budget_usd,
            spec.enabled,
        )
    _apply_in_memory(scope, scope_id, spec)


async def delete_route(*, scope: Scope, scope_id: str, role: Role) -> None:
    pool = await get_pg_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM strix_llm_routes WHERE scope=$1 AND scope_id=$2 AND role=$3",
            scope,
            scope_id,
            role,
        )
    # No router un-set primitive; simplest: reload scope fresh.
    await hydrate_router()


async def hydrate_router() -> None:
    """Reload all routes from Postgres into the in-memory router."""
    router = get_router()
    snapshot = await load_routes_from_db()

    globals_ = snapshot.get("global", {}).get(GLOBAL_SCOPE_ID, [])
    router.bulk_load_global(globals_)

    for org_id, specs in snapshot.get("org", {}).items():
        for spec in specs:
            router.set_org(org_id, spec)
    for run_id, specs in snapshot.get("run", {}).items():
        for spec in specs:
            router.set_run(run_id, spec)


def _apply_in_memory(scope: Scope, scope_id: str, spec: RouteSpec) -> None:
    router = get_router()
    if scope == "global":
        router.set_global(spec)
    elif scope == "org":
        router.set_org(scope_id, spec)
    elif scope == "run":
        router.set_run(scope_id, spec)


# --- Redis budget counters --------------------------------------------------


def _budget_key(run_id: str, role: Role) -> str:
    return f"strix:llm:budget:{run_id}:{role}"


async def record_usage(
    *,
    run_id: str | None,
    role: Role,
    cost_usd: float,
    tokens: int,
) -> dict[str, float]:
    """Increment role-scoped spend counters in Redis.

    Returns a dict with the updated totals (``cost_usd`` and ``tokens``). If
    Redis is unavailable, returns an empty dict - callers must treat an
    empty result as "no budget enforcement available".
    """
    if not run_id:
        return {}
    client = await get_redis()
    if client is None:
        return {}
    key = _budget_key(run_id, role)
    try:
        pipeline = client.pipeline()
        pipeline.hincrbyfloat(key, "cost_usd", float(cost_usd))
        pipeline.hincrby(key, "tokens", int(tokens))
        pipeline.expire(key, 60 * 60 * 24 * 7)  # 7-day TTL keeps stale runs tidy
        cost, token_total, _ = await pipeline.execute()
        return {"cost_usd": float(cost), "tokens": float(token_total)}
    except Exception as exc:
        logger.debug("budget counter update failed: %s", exc)
        return {}


async def read_budget(*, run_id: str, role: Role) -> dict[str, float]:
    client = await get_redis()
    if client is None:
        return {}
    try:
        raw = await client.hgetall(_budget_key(run_id, role))
    except Exception:
        return {}
    return {
        "cost_usd": float(raw.get("cost_usd", 0.0)),
        "tokens": float(raw.get("tokens", 0)),
    }


async def read_run_budget(run_id: str) -> dict[Role, dict[str, float]]:
    out: dict[Role, dict[str, float]] = {}
    for role in ALL_ROLES:
        out[role] = await read_budget(run_id=run_id, role=role)
    return out


async def is_budget_exhausted(*, run_id: str, role: Role, cap_usd: float) -> bool:
    if cap_usd <= 0:
        return False
    snapshot = await read_budget(run_id=run_id, role=role)
    spent = snapshot.get("cost_usd", 0.0)
    return spent >= cap_usd


def _run_cap_key(run_id: str) -> str:
    return f"strix:llm:runcap:{run_id}"


async def set_run_budget_cap(run_id: str, cap_usd: float | None) -> None:
    """Set (or clear with ``None``/``0``) the global USD cap for a run.

    The cap covers every role combined - routers call :func:`run_cap_exceeded`
    before each dispatch. Stored in Redis so it survives worker restarts and
    can be read from any API replica.
    """
    client = await get_redis()
    if client is None:
        return
    key = _run_cap_key(run_id)
    try:
        if cap_usd is None or cap_usd <= 0:
            await client.delete(key)
        else:
            await client.set(key, float(cap_usd), ex=60 * 60 * 24 * 30)
    except Exception as exc:
        logger.debug("set_run_budget_cap failed: %s", exc)


async def get_run_budget_cap(run_id: str) -> float | None:
    client = await get_redis()
    if client is None:
        return None
    try:
        raw = await client.get(_run_cap_key(run_id))
    except Exception:
        return None
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


async def run_cap_exceeded(run_id: str) -> bool:
    """Return True when the run's total spend has already blown its cap."""
    cap = await get_run_budget_cap(run_id)
    if cap is None or cap <= 0:
        return False
    snap = await read_run_budget(run_id)
    total = sum(data.get("cost_usd", 0.0) for data in snap.values())
    return total >= cap


# --- convenience for route-import/export ------------------------------------


def serialize_router_snapshot() -> dict[str, Any]:
    """Return a JSON-safe dump of the current router state (admin export)."""
    router = get_router()
    return {
        "global": {role: spec_to_dict(router.resolve(role)) for role in ALL_ROLES},
    }


def deserialize_router_snapshot(payload: dict[str, Any]) -> list[RouteSpec]:
    out: list[RouteSpec] = []
    globals_payload = payload.get("global") or {}
    for role, data in globals_payload.items():
        if not isinstance(data, dict):
            continue
        out.append(
            RouteSpec(
                role=role,
                model=str(data.get("model") or ""),
                api_key=None,
                api_base=data.get("api_base"),
                reasoning_effort=data.get("reasoning_effort"),
                max_tokens=data.get("max_tokens"),
                temperature=data.get("temperature"),
                budget_usd=data.get("budget_usd"),
                enabled=bool(data.get("enabled", True)),
                scope="global",
            )
        )
    return out


__all__ = [
    "GLOBAL_SCOPE_ID",
    "delete_route",
    "deserialize_router_snapshot",
    "get_run_budget_cap",
    "hydrate_router",
    "is_budget_exhausted",
    "load_routes_from_db",
    "read_budget",
    "read_run_budget",
    "record_usage",
    "run_cap_exceeded",
    "save_route",
    "serialize_router_snapshot",
    "set_run_budget_cap",
    "spec_to_dict",
]


# ``json`` import guard: keeps import hygiene tidy when mypy inspects unused.
assert json is not None
