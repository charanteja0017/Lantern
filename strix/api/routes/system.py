"""System-health admin route.

Exposes a full picture of the running API for the frontend
``/health`` dashboard: process info, service probes (Postgres, Redis,
filesystem, Docker, Clerk, frontend), a redacted env-var audit, the
live LLM governor snapshot, the set of registered routes, and rolling
per-route request metrics.

Protected by ``require_platform_admin`` — this report contains operational
detail (redacted but still sensitive) and should not be publicly reachable.
"""

from __future__ import annotations

import datetime as _dt
import platform
import sys
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _pkg_version
from typing import Any, cast

from fastapi import APIRouter, Depends, Request

from strix.api.schemas import (
    ApiProcessInfo,
    AuthConfigInfo,
    EndpointDescriptor,
    EndpointMetric,
    EnvVarRow,
    RateLimitSnapshot,
    RuntimeTotals,
    ServiceCheck,
    SystemHealthSnapshot,
    SystemStatus,
    iso_now,
)
from strix.api.services.auth import Principal, require_platform_admin
from strix.api.services.system_health import (
    collect_probes,
    env_summary,
    get_request_metrics,
    get_run_launcher,
    hostname,
    list_routes,
    llm_governor_snapshot,
    overall_status,
    process_uptime_seconds,
)
from strix.api.settings import get_settings


router = APIRouter(prefix="/api/system")


def _package_version() -> str:
    # Resolve lazily so this module is importable even before ``strix.api`` has
    # finished initializing (previously a ``from strix.api import __version__``
    # at module scope caused a circular import that killed uvicorn workers).
    # The installed distribution is named "strix-agent" in pyproject.toml; the
    # fallback covers editable/non-installed runs (e.g. `python -m ...`).
    for dist_name in ("strix-agent", "strix"):
        try:
            return _pkg_version(dist_name)
        except PackageNotFoundError:
            continue
    return "0.0.0-dev"


def _process_info() -> ApiProcessInfo:
    settings = get_settings()
    started_at = _dt.datetime.fromtimestamp(
        _dt.datetime.utcnow().timestamp() - process_uptime_seconds(),
        tz=_dt.UTC,
    ).isoformat()
    return ApiProcessInfo(
        version=_package_version(),
        environment=settings.environment,
        hostname=hostname(),
        python=f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro} "
        f"({platform.python_implementation()})",
        uptimeSeconds=round(process_uptime_seconds(), 2),
        startedAt=started_at,
    )


def _auth_info() -> AuthConfigInfo:
    s = get_settings()
    return AuthConfigInfo(
        enabled=s.auth_enabled,
        issuer=s.clerk_issuer,
        jwksUrl=s.clerk_jwks_url,
        audience=s.clerk_audience,
        adminEmailCount=len(s.admin_emails),
        apiKeyCount=len(s.api_keys) + (1 if s.api_keys_file else 0),
    )


def _totals() -> RuntimeTotals:
    t = get_request_metrics().totals()
    return RuntimeTotals(
        total=t["total"],
        errors5xx=t["errors5xx"],
        errors4xx=t["errors4xx"],
        errorRate=t["errorRate"],
        lastSeenAt=t["lastSeenAt"],
    )


@router.get("/health", response_model=SystemHealthSnapshot)
async def system_health(
    request: Request,
    _: Principal = Depends(require_platform_admin),
) -> SystemHealthSnapshot:
    probes = await collect_probes()
    services = [ServiceCheck.model_validate(p.to_dict()) for p in probes]
    endpoints = [EndpointDescriptor(**r) for r in list_routes(request.app)]
    metrics = [EndpointMetric.model_validate(m) for m in get_request_metrics().snapshot()]
    rate_limits = [RateLimitSnapshot.model_validate(s) for s in llm_governor_snapshot()]
    env = [EnvVarRow.model_validate(e) for e in env_summary()]
    active_runs: list[dict[str, Any]] = get_run_launcher().active_snapshot()
    return SystemHealthSnapshot(
        status=cast("SystemStatus", overall_status(probes)),
        generatedAt=iso_now(),
        process=_process_info(),
        auth=_auth_info(),
        services=services,
        endpoints=endpoints,
        metrics=metrics,
        totals=_totals(),
        rateLimits=rate_limits,
        activeRuns=active_runs,
        env=env,
    )


@router.get("/endpoints", response_model=list[EndpointDescriptor])
async def system_endpoints(
    request: Request,
    _: Principal = Depends(require_platform_admin),
) -> list[EndpointDescriptor]:
    return [EndpointDescriptor(**r) for r in list_routes(request.app)]
