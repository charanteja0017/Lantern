"""LLM provider configuration + live connectivity test.

These endpoints let an authorised operator:

* persist the active model / API key / base URL on the server so the run
  launcher can actually spawn ``strix`` with the right environment (``PUT``);
* inspect what the server currently has on file with secrets masked (``GET``);
* verify that the saved config really talks to the provider (``POST /test``) —
  a tiny litellm round-trip that returns latency + a short preview of the
  model's response.

Without this, settings saved in the browser's ``localStorage`` never reached
the API container, which meant the CLI subprocess kept aborting with
"STRIX_LLM missing" and scans got stuck in *queued*.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from strix.api.services.auth import Principal, require_admin, require_any_member
from strix.api.services.llm_config import (
    LlmConfig,
    call_completion,
    get_store,
)
from strix.api.settings import get_settings


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/llm", tags=["llm"])


# --- Schemas -----------------------------------------------------------------


class LlmConfigRead(BaseModel):
    provider: str
    model: str
    api_base: str
    reasoning_effort: str
    api_key_set: bool
    api_key_preview: str
    perplexity_key_set: bool
    updated_at: float
    updated_by: str
    nim_plan: str | None = None
    nim_rpm_cap: int | None = None
    auto_pool: str | None = None
    auto_strategy: str | None = None
    auto_router_model: str | None = None


class LlmConfigWrite(BaseModel):
    provider: str = Field(default="", max_length=64)
    model: str = Field(default="", max_length=256)
    api_key: str | None = Field(default=None, max_length=4096)
    api_base: str = Field(default="", max_length=2048)
    perplexity_key: str | None = Field(default=None, max_length=4096)
    reasoning_effort: str = Field(default="high", max_length=16)
    nim_plan: str | None = Field(default=None, max_length=16)
    nim_rpm_cap: int | None = Field(default=None, ge=1, le=1000000)
    auto_pool: str | None = Field(default=None, max_length=8192)
    auto_strategy: str | None = Field(default=None, max_length=16)
    auto_router_model: str | None = Field(default=None, max_length=256)


class LlmTestResponse(BaseModel):
    ok: bool
    model: str
    latency_ms: float
    response_preview: str = ""
    error: str | None = None
    provider_hint: str | None = None


# --- Helpers -----------------------------------------------------------------


def _runs_dir() -> str:
    return get_settings().runs_dir


# --- Routes ------------------------------------------------------------------


@router.get("/config", response_model=LlmConfigRead)
async def read_config(_: Principal = Depends(require_any_member)) -> LlmConfigRead:
    """Return the persisted LLM configuration (API key is never returned)."""
    store = get_store(_runs_dir())
    cfg = store.effective()
    return LlmConfigRead(**cfg.as_public_dict())


@router.put("/config", response_model=LlmConfigRead)
async def write_config(
    body: LlmConfigWrite,
    principal: Principal = Depends(require_admin),
) -> LlmConfigRead:
    """Persist a new LLM configuration on the server.

    ``api_key`` and ``perplexity_key`` are treated as "set only" — passing
    ``null`` leaves the stored value untouched, and passing an empty string
    clears it. This lets the UI save non-secret fields (model, api_base,
    reasoning_effort) without forcing the user to re-enter their API key.
    """
    store = get_store(_runs_dir())
    current = store.load()

    merged = LlmConfig(
        provider=body.provider or current.provider,
        model=body.model or current.model,
        api_base=body.api_base if body.api_base is not None else current.api_base,
        reasoning_effort=body.reasoning_effort or current.reasoning_effort or "high",
        perplexity_key=(
            current.perplexity_key if body.perplexity_key is None else body.perplexity_key
        ),
        api_key=current.api_key if body.api_key is None else body.api_key,
        updated_by=principal.email or principal.user_id or "unknown",
        extra={
            **(current.extra or {}),
            **{
                k: str(v)
                for k, v in {
                    "nim_plan": body.nim_plan,
                    "nim_rpm_cap": body.nim_rpm_cap,
                    "auto_pool": body.auto_pool,
                    "auto_strategy": body.auto_strategy,
                    "auto_router_model": body.auto_router_model,
                }.items()
                if v is not None
            },
        },
    )

    try:
        saved = store.save(merged)
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Unable to persist LLM config on disk: {exc}",
        ) from exc
    logger.info(
        "llm.config updated by %s (model=%s, api_base=%s, key_set=%s)",
        merged.updated_by,
        saved.model,
        saved.api_base or "—",
        bool(saved.api_key),
    )
    return LlmConfigRead(**saved.as_public_dict())


@router.post("/test", response_model=LlmTestResponse)
async def test_config(
    body: LlmConfigWrite | None = None,
    _: Principal = Depends(require_admin),
) -> LlmTestResponse:
    """Send a tiny prompt to the configured model and report the outcome.

    If ``body`` is provided, the supplied values override the saved config
    for the purpose of this one call (useful for "test before saving" flows).
    Otherwise the persisted config is used as-is.
    """
    store = get_store(_runs_dir())
    cfg = store.effective()
    if body is not None:
        cfg = LlmConfig(
            provider=body.provider or cfg.provider,
            model=body.model or cfg.model,
            api_base=body.api_base if body.api_base is not None else cfg.api_base,
            reasoning_effort=body.reasoning_effort or cfg.reasoning_effort,
            perplexity_key=(
                cfg.perplexity_key if body.perplexity_key is None else body.perplexity_key
            ),
            api_key=cfg.api_key if body.api_key is None else body.api_key,
            extra={
                **(cfg.extra or {}),
                **{
                    k: str(v)
                    for k, v in {
                        "nim_plan": body.nim_plan,
                        "nim_rpm_cap": body.nim_rpm_cap,
                        "auto_pool": body.auto_pool,
                        "auto_strategy": body.auto_strategy,
                        "auto_router_model": body.auto_router_model,
                    }.items()
                    if v is not None
                },
            },
        )

    result = await call_completion(cfg)
    return LlmTestResponse(
        ok=result.ok,
        model=result.model,
        latency_ms=result.latency_ms,
        response_preview=result.response_preview,
        error=result.error,
        provider_hint=result.provider_hint,
    )
