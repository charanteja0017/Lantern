from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from strix.api.schemas import (
    AdminOrgRow,
    AuditEntry,
    OrgSummary,
    RateLimitSnapshot,
)
from strix.api.services.audit import AuditLog
from strix.api.services.auth import Principal, require_platform_admin
from strix.api.services.llm_routes import (
    delete_route,
    hydrate_router,
    save_route,
    spec_to_dict,
)
from strix.api.services.rate_limit import get_default_governor
from strix.api.services.run_store import RunStore
from strix.api.services.secrets import (
    SecretStoreError,
    delete_secret,
    list_secrets,
    put_secret,
)
from strix.api.services.secrets import (
    is_enabled as secrets_enabled,
)
from strix.api.services.secrets import (
    metadata as secret_metadata,
)
from strix.api.settings import get_settings
from strix.llm.providers import (
    PROVIDERS,
    identify_provider,
)
from strix.llm.providers import (
    as_public_dict as provider_public,
)
from strix.llm.router import ALL_ROLES, ROLE_DESCRIPTIONS, RouteSpec, get_router


router = APIRouter(prefix="/api/admin")


@router.get("/orgs", response_model=list[AdminOrgRow])
async def admin_orgs(
    request: Request, principal: Principal = Depends(require_platform_admin)
) -> list[AdminOrgRow]:
    AuditLog(get_settings().runs_dir).record(
        principal,
        action="admin.orgs.list",
        target="*",
        ip=request.client.host if request.client else None,
    )
    # Without a Postgres user/org table this deployment is single-org; surface
    # the one org plus aggregate run stats so the admin screen is still useful.
    runs = RunStore(get_settings().runs_dir).list_runs()
    return [
        AdminOrgRow(
            org=OrgSummary(
                id=principal.org_id,
                name=principal.org_slug.title(),
                slug=principal.org_slug,
                memberCount=1,
            ),
            runsTotal=len(runs),
            runsActive=sum(1 for r in runs if r.status in ("running", "throttled", "paused")),
            findingsTotal=sum(r.stats.vulnerabilities for r in runs),
            lastActiveAt=runs[0].updated_at if runs else "",
            healthScore=95,
        )
    ]


@router.get("/rate-limits", response_model=list[RateLimitSnapshot])
async def admin_rate_limits(
    _: Principal = Depends(require_platform_admin),
) -> list[RateLimitSnapshot]:
    return [RateLimitSnapshot.model_validate(s) for s in get_default_governor().snapshot()]


@router.get("/audit", response_model=list[AuditEntry])
async def admin_audit(
    _: Principal = Depends(require_platform_admin),
) -> list[AuditEntry]:
    entries = AuditLog(get_settings().runs_dir).recent(limit=500)
    return [AuditEntry.model_validate(e) for e in entries]


# --- LLM role-router admin endpoints ----------------------------------------


class LlmRoutePayload(BaseModel):
    role: str = Field(..., description="One of the known Role values.")
    model: str = Field(
        ..., min_length=1, description="LiteLLM model id, e.g. 'openai/gpt-4.1-mini'."
    )
    api_base: str | None = None
    api_key_ref: str | None = Field(
        default=None,
        description="Reference into the encrypted secret store (Phase 14); the plaintext key is never accepted here.",
    )
    reasoning_effort: str | None = None
    max_tokens: int | None = None
    temperature: float | None = None
    budget_usd: float | None = None
    enabled: bool = True


class LlmRoutesWrite(BaseModel):
    routes: dict[str, LlmRoutePayload] = Field(
        default_factory=dict,
        description="Map of role -> route config. Unset roles are left untouched.",
    )


@router.get("/llm/providers")
async def admin_list_llm_providers(
    _: Principal = Depends(require_platform_admin),
) -> dict[str, Any]:
    """Return the provider catalog used by the Admin LLM UI."""
    return {
        "providers": [provider_public(p) for p in PROVIDERS],
    }


@router.get("/llm/routes")
async def admin_get_llm_routes(
    _: Principal = Depends(require_platform_admin),
) -> dict[str, Any]:
    """Return the currently-resolved global route for every role.

    Resolution reflects env-var fallback, so the UI can show what the
    router will do on the next call even when no DB row exists.
    """
    await hydrate_router()
    router_obj = get_router()
    roles_out: list[dict[str, Any]] = []
    for role in ALL_ROLES:
        spec = router_obj.resolve(role)
        provider = identify_provider(spec.model)
        roles_out.append(
            {
                "role": role,
                "description": ROLE_DESCRIPTIONS.get(role, ""),
                "spec": spec_to_dict(spec),
                "provider": provider.id if provider else None,
            }
        )
    return {"roles": roles_out}


@router.put("/llm/routes")
async def admin_put_llm_routes(
    payload: LlmRoutesWrite,
    request: Request,
    principal: Principal = Depends(require_platform_admin),
) -> dict[str, Any]:
    """Upsert one or more global LLM role routes."""
    invalid_roles = [r for r in payload.routes if r not in ALL_ROLES]
    if invalid_roles:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown role(s): {', '.join(sorted(invalid_roles))}",
        )

    AuditLog(get_settings().runs_dir).record(
        principal,
        action="admin.llm.routes.upsert",
        target=",".join(sorted(payload.routes)) or "<empty>",
        ip=request.client.host if request.client else None,
        metadata={"roles": sorted(payload.routes)},
    )

    for role, route in payload.routes.items():
        spec = RouteSpec(
            role=role,  # type: ignore[arg-type]
            model=route.model,
            api_key=None,
            api_base=route.api_base,
            reasoning_effort=route.reasoning_effort,
            max_tokens=route.max_tokens,
            temperature=route.temperature,
            budget_usd=route.budget_usd,
            enabled=route.enabled,
            scope="global",
        )
        await save_route(
            scope="global", scope_id="global", spec=spec, api_key_ref=route.api_key_ref
        )

    await hydrate_router()
    return dict(await admin_get_llm_routes(_=principal))


class SecretWrite(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    value: str = Field(..., min_length=1, description="Raw secret value; encrypted server-side.")


@router.get("/secrets")
async def admin_list_secrets(
    _: Principal = Depends(require_platform_admin),
) -> dict[str, Any]:
    return {
        "enabled": secrets_enabled(),
        "secrets": [
            {
                "name": s.name,
                "preview": s.preview,
                "created_at": s.created_at,
                "updated_at": s.updated_at,
            }
            for s in await list_secrets()
        ],
    }


@router.put("/secrets")
async def admin_put_secret(
    body: SecretWrite,
    request: Request,
    principal: Principal = Depends(require_platform_admin),
) -> dict[str, Any]:
    try:
        md = await put_secret(body.name, body.value)
    except SecretStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    AuditLog(get_settings().runs_dir).record(
        principal,
        action="admin.secrets.put",
        target=body.name,
        ip=request.client.host if request.client else None,
    )
    return {
        "name": md.name,
        "preview": md.preview,
        "created_at": md.created_at,
        "updated_at": md.updated_at,
    }


@router.delete("/secrets/{name}")
async def admin_delete_secret(
    name: str,
    request: Request,
    principal: Principal = Depends(require_platform_admin),
) -> dict[str, Any]:
    deleted = await delete_secret(name)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"secret '{name}' not found")
    AuditLog(get_settings().runs_dir).record(
        principal,
        action="admin.secrets.delete",
        target=name,
        ip=request.client.host if request.client else None,
    )
    md = await secret_metadata(name)
    return {"deleted": True, "name": name, "remaining": md is not None}


@router.post("/llm/routes/{role}/test")
async def admin_test_llm_route(
    role: str,
    request: Request,
    principal: Principal = Depends(require_platform_admin),
) -> dict[str, Any]:
    """Send a tiny canary prompt to the resolved route and report health."""
    if role not in ALL_ROLES:
        raise HTTPException(status_code=400, detail=f"Unknown role: {role}")
    await hydrate_router()
    router_obj = get_router()
    spec = router_obj.resolve(role)
    if not spec.model:
        return {
            "role": role,
            "ok": False,
            "error": "No model configured (global fallback is also empty).",
            "latency_ms": None,
        }

    AuditLog(get_settings().runs_dir).record(
        principal,
        action="admin.llm.routes.test",
        target=role,
        ip=request.client.host if request.client else None,
    )

    import time

    args: dict[str, Any] = {
        "model": spec.model,
        "messages": [
            {"role": "user", "content": "Reply with the single word OK."},
        ],
        "max_tokens": 8,
        "temperature": 0.0,
    }
    args = router_obj.prepare_completion_args(role, args)

    try:
        import litellm
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=f"litellm missing: {exc}") from exc
    started = time.perf_counter()
    try:
        response = await litellm.acompletion(**args)
        latency_ms = int((time.perf_counter() - started) * 1000)
        preview = ""
        try:
            preview = str(response.choices[0].message.content)[:120]
        except Exception:
            preview = ""
        return {
            "role": role,
            "model": spec.model,
            "ok": True,
            "latency_ms": latency_ms,
            "response_preview": preview,
            "context_window": router_obj.context_window(role),
        }
    except Exception as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {
            "role": role,
            "model": spec.model,
            "ok": False,
            "latency_ms": latency_ms,
            "error": str(exc)[:400],
            "context_window": router_obj.context_window(role),
        }


@router.delete("/llm/routes/{role}")
async def admin_delete_llm_route(
    role: str,
    request: Request,
    principal: Principal = Depends(require_platform_admin),
) -> dict[str, Any]:
    if role not in ALL_ROLES:
        raise HTTPException(status_code=400, detail=f"Unknown role: {role}")
    AuditLog(get_settings().runs_dir).record(
        principal,
        action="admin.llm.routes.delete",
        target=role,
        ip=request.client.host if request.client else None,
    )
    await delete_route(scope="global", scope_id="global", role=role)
    return dict(await admin_get_llm_routes(_=principal))
