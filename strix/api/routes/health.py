"""Liveness and readiness endpoints.

* ``/healthz`` — liveness. Always cheap; used by Docker's HEALTHCHECK to
  tell if the process is answering at all.
* ``/readyz`` — readiness. Actually probes the configured downstream
  services (Postgres, Redis, filesystem) so load balancers can pull the pod
  out of rotation when any of them is down. Deliberately does **not** probe
  optional services like Clerk's JWKS — that's covered by the richer
  ``/api/system/health`` report consumed by the dashboard.
"""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from strix.api.services.system_health import (
    probe_postgres,
    probe_redis,
    probe_runs_dir,
)
from strix.api.settings import get_settings


router = APIRouter()


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(response: Response) -> dict[str, object]:
    s = get_settings()
    pg, rd, runs = await probe_postgres(), await probe_redis(), await probe_runs_dir()

    def _probe_state(probe_status: str, required: bool) -> str:
        if probe_status == "disabled":
            return "skipped"
        if probe_status == "healthy":
            return "up"
        # degraded/down on a required dependency makes the pod not-ready.
        return "down" if required else "degraded"

    pg_state = _probe_state(pg.status, required=s.postgres_enabled)
    rd_state = _probe_state(rd.status, required=s.redis_enabled)
    runs_state = _probe_state(runs.status, required=True)

    ready = all(state in {"up", "skipped"} for state in (pg_state, rd_state, runs_state))
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "ready" if ready else "not-ready",
        "environment": s.environment,
        "auth": s.auth_enabled,
        "checks": {
            "postgres": {
                "state": pg_state,
                "latencyMs": pg.latency_ms,
                "detail": pg.detail,
            },
            "redis": {
                "state": rd_state,
                "latencyMs": rd.latency_ms,
                "detail": rd.detail,
            },
            "runsDir": {
                "state": runs_state,
                "latencyMs": runs.latency_ms,
                "detail": runs.detail,
            },
        },
    }
