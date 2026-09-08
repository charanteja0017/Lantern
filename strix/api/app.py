"""Strix dashboard FastAPI application factory."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from strix.api.middleware import RequestMetricsMiddleware
from strix.api.routes import (
    admin,
    auth,
    blackboard,
    burp,
    dashboard,
    findings,
    health,
    integrations,
    llm,
    mcp,
    orgs,
    run_sidechannel_proxy,
    runs,
    schedules,
    shells,
    sidechannels,
    system,
    vpn,
)
from strix.api.services.db import ensure_schema
from strix.api.services.retention import RetentionConfig, run_retention_loop
from strix.api.services.sandbox_janitor import run_sandbox_janitor_loop
from strix.api.services.schedules import run_scheduler_loop
from strix.api.settings import get_settings


logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)

    if settings.environment == "production" and not settings.auth_enabled:
        raise RuntimeError(
            "Clerk auth must be configured in production (set CLERK_ISSUER and "
            "CLERK_JWKS_URL). Refusing to start without authentication."
        )

    app = FastAPI(
        title="Strix Dashboard API",
        version="0.1.0",
        # Mount Swagger UI under /api/* so the frontend (which owns "/docs") is
        # not shadowed by the reverse proxy's @api matcher.
        docs_url="/api/docs" if settings.environment != "production" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.environment != "production" else None,
    )

    # Order matters: request metrics must be the *outermost* middleware we own
    # so its timing includes the real work of every handler (CORS/TrustedHost
    # that Starlette wraps are fine to count in the same sample).
    app.add_middleware(RequestMetricsMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["authorization", "content-type", "x-api-key"],
        max_age=86400,
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(llm.router)
    app.include_router(runs.router)
    app.include_router(blackboard.router)
    app.include_router(vpn.router)
    app.include_router(burp.router)
    app.include_router(sidechannels.router)
    app.include_router(run_sidechannel_proxy.router)
    app.include_router(run_sidechannel_proxy.legacy_vnc_router)
    app.include_router(shells.router)
    app.include_router(shells.listeners_router)
    app.include_router(shells.ws_router)
    app.include_router(schedules.router)
    app.include_router(findings.router)
    # Canonical backend report artifacts (build/list/verify). Mounted next
    # to the findings router because they share the same data surface.
    app.include_router(findings.reports_router)
    app.include_router(dashboard.router)
    app.include_router(orgs.router)
    app.include_router(admin.router)
    app.include_router(integrations.router)
    app.include_router(mcp.router)
    app.include_router(system.router)

    @app.on_event("startup")
    async def _on_startup() -> None:
        logger.info(
            "Strix API starting (env=%s, auth=%s, postgres=%s, redis=%s)",
            settings.environment,
            settings.auth_enabled,
            settings.postgres_enabled,
            settings.redis_enabled,
        )
        # Run schema bootstrap in the background so the startup event returns
        # immediately — uvicorn won't accept requests (and /healthz won't
        # answer) until startup hooks complete. On a fresh boot Postgres may
        # still be finishing its own init, so keeping this off the critical
        # path prevents the Docker healthcheck from flapping.
        asyncio.create_task(_bootstrap_schema())
        asyncio.create_task(run_scheduler_loop())
        asyncio.create_task(
            run_retention_loop(
                RetentionConfig(
                    runs_dir=settings.runs_dir,
                    retention_days=settings.retention_days,
                    sweep_interval_seconds=settings.retention_sweep_seconds,
                    max_evidence_bytes=settings.run_max_evidence_bytes,
                )
            )
        )
        # Reap orphaned sandbox containers from runs that died without
        # cleanup (SIGKILL'd CLIs, API restarts mid-flight). Without this
        # sweep, leaked 4GB sandboxes pile up and starve future runs of RAM.
        asyncio.create_task(run_sandbox_janitor_loop(Path(settings.runs_dir)))

    return app


async def _bootstrap_schema() -> None:
    try:
        await ensure_schema()
        logger.info("Postgres schema ready")
    except Exception as exc:
        logger.warning("Postgres schema init skipped: %s", exc)
        return
    try:
        from strix.api.services.llm_routes import hydrate_router

        await hydrate_router()
        logger.info("LLM router hydrated from Postgres")
    except Exception as exc:
        logger.warning("LLM router hydration skipped: %s", exc)


app = create_app()
