"""Server-side persistence for the active LLM provider configuration.

The dashboard settings page lets users pick a model + API key from the
browser, but until now the payload lived in ``localStorage`` only — the API
container (which is what actually spawns the ``strix`` CLI) never saw it, so
scans kept failing with "STRIX_LLM missing".

This module provides a single JSON file on the server
(``<runs_dir>/.config/llm.json``) that is read by:

* :func:`env_dict` — merged into the subprocess environment by
  :class:`~strix.api.services.run_launcher.RunLauncher` when spawning the CLI.
* :func:`snapshot` — returned to the UI (with the API key masked) so operators
  can verify what the server actually has on file.
* :func:`call_completion` — used by the ``/api/llm/test`` endpoint to verify
  the config really works against the live provider.

Everything is best-effort and safe to import on an API worker that has no
write permission to ``runs_dir`` (the helpers log-and-continue instead of
raising, so a read-only deploy still serves the dashboard).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from strix.llm.providers import normalize_model_for_endpoint


logger = logging.getLogger(__name__)


# --- Dataclasses ------------------------------------------------------------


@dataclass
class LlmConfig:
    """Runtime LLM configuration persisted on the server."""

    provider: str = ""  # label chosen in the UI (e.g. "ollama/cloud")
    model: str = ""  # canonical ``STRIX_LLM`` value (litellm-style id)
    api_key: str = ""
    api_base: str = ""  # optional override — needed for Ollama / custom
    perplexity_key: str = ""
    reasoning_effort: str = "high"
    updated_at: float = 0.0
    updated_by: str = ""
    extra: dict[str, str] = field(default_factory=dict)

    def as_public_dict(self) -> dict[str, Any]:
        """Frontend-visible payload — secrets are masked."""
        nim_plan = str(self.extra.get("nim_plan", "") or "").strip() or "free"
        if nim_plan not in ("free", "paid"):
            nim_plan = "free"
        nim_rpm_raw = str(self.extra.get("nim_rpm_cap", "") or "").strip()
        nim_rpm_cap: int | None
        try:
            nim_rpm_cap = int(nim_rpm_raw) if nim_rpm_raw else None
        except (TypeError, ValueError):
            nim_rpm_cap = None
        if nim_rpm_cap is not None and nim_rpm_cap <= 0:
            nim_rpm_cap = None

        auto_strategy = str(self.extra.get("auto_strategy", "") or "").strip() or "hybrid"
        if auto_strategy not in ("rules", "hybrid"):
            auto_strategy = "hybrid"
        auto_pool = str(self.extra.get("auto_pool", "") or "")
        auto_router_model = str(self.extra.get("auto_router_model", "") or "")

        return {
            "provider": self.provider,
            "model": self.model,
            "api_base": self.api_base,
            "reasoning_effort": self.reasoning_effort,
            "api_key_set": bool(self.api_key),
            "api_key_preview": _mask_secret(self.api_key),
            "perplexity_key_set": bool(self.perplexity_key),
            "updated_at": self.updated_at,
            "updated_by": self.updated_by,
            # Non-secret provider extras (used by Settings UI)
            "nim_plan": nim_plan,
            "nim_rpm_cap": nim_rpm_cap,
            "auto_pool": auto_pool,
            "auto_strategy": auto_strategy,
            "auto_router_model": auto_router_model,
        }


# --- File-backed store ------------------------------------------------------


class LlmConfigStore:
    """Persists :class:`LlmConfig` to ``<runs_dir>/.config/llm.json``."""

    def __init__(self, runs_dir: str | Path):
        self.runs_dir = Path(runs_dir)
        self.config_path = self.runs_dir / ".config" / "llm.json"
        self._lock = threading.Lock()
        self._cache: LlmConfig | None = None
        self._cache_mtime: float | None = None

    # Read -----------------------------------------------------------------

    def load(self) -> LlmConfig:
        """Return the persisted config (or an empty one).

        Always reads from disk if the file's mtime changed so a fresh
        ``PUT /api/llm/config`` on one worker is picked up by sibling
        workers on the very next request.
        """
        with self._lock:
            mtime = self._file_mtime()
            if self._cache is not None and mtime == self._cache_mtime:
                return self._cache

            raw = self._read_file()
            cfg = LlmConfig(
                provider=str(raw.get("provider", "") or ""),
                model=str(raw.get("model", "") or ""),
                api_key=str(raw.get("api_key", "") or ""),
                api_base=str(raw.get("api_base", "") or ""),
                perplexity_key=str(raw.get("perplexity_key", "") or ""),
                reasoning_effort=str(raw.get("reasoning_effort", "") or "high"),
                updated_at=float(raw.get("updated_at", 0.0) or 0.0),
                updated_by=str(raw.get("updated_by", "") or ""),
                extra={k: str(v) for k, v in (raw.get("extra") or {}).items()},
            )
            self._cache = cfg
            self._cache_mtime = mtime
            return cfg

    def _file_mtime(self) -> float | None:
        try:
            return self.config_path.stat().st_mtime
        except FileNotFoundError:
            return None
        except OSError as exc:
            logger.warning("llm_config: stat failed: %s", exc)
            return None

    def _read_file(self) -> dict[str, Any]:
        if not self.config_path.is_file():
            return {}
        try:
            data = json.loads(self.config_path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("llm_config: read failed: %s", exc)
            return {}

    # Write ----------------------------------------------------------------

    def save(self, cfg: LlmConfig) -> LlmConfig:
        cfg.updated_at = time.time()
        with self._lock:
            try:
                self.config_path.parent.mkdir(parents=True, exist_ok=True)
                self.config_path.write_text(
                    json.dumps(
                        {
                            "provider": cfg.provider,
                            "model": cfg.model,
                            "api_key": cfg.api_key,
                            "api_base": cfg.api_base,
                            "perplexity_key": cfg.perplexity_key,
                            "reasoning_effort": cfg.reasoning_effort,
                            "updated_at": cfg.updated_at,
                            "updated_by": cfg.updated_by,
                            "extra": cfg.extra,
                        },
                        indent=2,
                    ),
                    encoding="utf-8",
                )
                try:  # Best-effort mode 0600 — Windows no-op
                    self.config_path.chmod(0o600)
                except OSError:
                    pass
            except OSError as exc:
                logger.warning("llm_config: save failed: %s", exc)
                raise
            self._cache = cfg
            self._cache_mtime = self._file_mtime()
            return cfg

    # Compose --------------------------------------------------------------

    def effective(self) -> LlmConfig:
        """Config for the subprocess: file overlays env, env fills blanks.

        Operators can still set everything via ``deploy/.env`` and skip the
        UI entirely. If both are set, the on-disk value wins because it's the
        one the user edited most recently through the admin UI.
        """
        cfg = self.load()
        if not cfg.model:
            cfg.model = os.getenv("STRIX_LLM", "") or os.getenv("LLM_MODEL", "")
        if not cfg.api_key:
            cfg.api_key = os.getenv("LLM_API_KEY", "")
        if not cfg.api_base:
            cfg.api_base = os.getenv("LLM_API_BASE", "")
        if not cfg.perplexity_key:
            cfg.perplexity_key = os.getenv("PERPLEXITY_API_KEY", "")
        if not cfg.reasoning_effort:
            cfg.reasoning_effort = os.getenv("STRIX_REASONING_EFFORT", "high")
        return cfg


# --- Subprocess environment helpers ----------------------------------------


def env_dict(cfg: LlmConfig) -> dict[str, str]:
    """Translate :class:`LlmConfig` into the env vars the Strix CLI expects."""
    out: dict[str, str] = {}
    if cfg.model:
        out["STRIX_LLM"] = cfg.model
        # Mirror the legacy name so anything still reading ``LLM_MODEL`` works.
        out["LLM_MODEL"] = cfg.model
    if cfg.api_key:
        out["LLM_API_KEY"] = cfg.api_key
        if (cfg.model or "").startswith("deepseek/"):
            out["DEEPSEEK_API_KEY"] = cfg.api_key
    if cfg.api_base:
        out["LLM_API_BASE"] = cfg.api_base
        # litellm honours OpenAI-compatible base URLs via OPENAI_API_BASE, and
        # Ollama's native client via OLLAMA_API_BASE. We set both so self-hosted
        # and hosted Ollama both work without user intervention.
        if cfg.model.startswith("ollama/"):
            out["OLLAMA_API_BASE"] = cfg.api_base
        else:
            out["OPENAI_API_BASE"] = cfg.api_base
    if cfg.perplexity_key:
        out["PERPLEXITY_API_KEY"] = cfg.perplexity_key
    if cfg.reasoning_effort:
        out["STRIX_REASONING_EFFORT"] = cfg.reasoning_effort

    # --- Provider extras -------------------------------------------------
    # These are intentionally namespaced and optional; the CLI/runtime reads them
    # directly from the environment when present.
    nim_plan = str(cfg.extra.get("nim_plan", "") or "").strip()
    if nim_plan:
        out["STRIX_NIM_PLAN"] = nim_plan
    nim_rpm = str(cfg.extra.get("nim_rpm_cap", "") or "").strip()
    if nim_rpm:
        out["STRIX_NIM_RPM_CAP"] = nim_rpm
    auto_pool = str(cfg.extra.get("auto_pool", "") or "").strip()
    if auto_pool:
        out["STRIX_LLM_AUTO_POOL"] = auto_pool
    auto_strategy = str(cfg.extra.get("auto_strategy", "") or "").strip()
    if auto_strategy:
        out["STRIX_LLM_AUTO_STRATEGY"] = auto_strategy
    auto_router_model = str(cfg.extra.get("auto_router_model", "") or "").strip()
    if auto_router_model:
        out["STRIX_LLM_AUTO_ROUTER_MODEL"] = auto_router_model
    return out


# --- Live provider probe ----------------------------------------------------


@dataclass
class LlmTestResult:
    ok: bool
    model: str
    latency_ms: float
    response_preview: str = ""
    error: str | None = None
    provider_hint: str | None = None


def _first_auto_pool_model(cfg: LlmConfig) -> str | None:
    raw = str(cfg.extra.get("auto_pool", "") or "")
    for part in raw.split(","):
        m = part.strip()
        if m:
            return m
    return None


async def call_completion(cfg: LlmConfig, *, timeout: float = 25.0) -> LlmTestResult:
    """Send a tiny prompt to the configured model and return the outcome.

    We deliberately use :mod:`litellm` (already a hard dependency of Strix)
    so this reflects the exact code path the agent runtime will take. A
    success here means the launcher subprocess will reach the same provider
    with the same credentials.
    """
    if not cfg.model:
        return LlmTestResult(
            ok=False,
            model="",
            latency_ms=0.0,
            error="No model configured. Set it in Settings or deploy/.env (STRIX_LLM).",
        )

    try:
        import litellm
    except ImportError:
        return LlmTestResult(
            ok=False,
            model=cfg.model,
            latency_ms=0.0,
            error="litellm is not installed in the API image. Rebuild with pip install '.[api]'.",
        )

    probe_model = (cfg.model or "").strip()
    if probe_model == "auto":
        first = _first_auto_pool_model(cfg)
        if not first:
            return LlmTestResult(
                ok=False,
                model="auto",
                latency_ms=0.0,
                error=(
                    "Model is `auto` but the auto pool is empty. Add at least one "
                    "comma-separated model id in the Auto pool field, then save."
                ),
            )
        probe_model = first

    resolved_model = normalize_model_for_endpoint(probe_model, cfg.api_base)
    kwargs: dict[str, Any] = {
        "model": resolved_model,
        "messages": [
            {"role": "system", "content": "You are a health probe. Answer briefly."},
            {"role": "user", "content": "Reply with OK and nothing else."},
        ],
        "max_tokens": 16,
        "temperature": 0,
        "timeout": timeout,
    }
    if cfg.api_key:
        kwargs["api_key"] = cfg.api_key
    if cfg.api_base:
        kwargs["api_base"] = cfg.api_base

    start = time.perf_counter()
    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(litellm.completion, **kwargs),
            timeout=timeout + 2.0,
        )
    except TimeoutError:
        return LlmTestResult(
            ok=False,
            model=resolved_model,
            latency_ms=(time.perf_counter() - start) * 1000.0,
            error=f"Timed out after {timeout:.0f}s waiting for the model to respond.",
            provider_hint=_provider_hint(resolved_model, cfg.api_base),
        )
    except Exception as exc:
        raw = f"{type(exc).__name__}: {exc}"
        return LlmTestResult(
            ok=False,
            model=resolved_model,
            latency_ms=(time.perf_counter() - start) * 1000.0,
            error=raw,
            provider_hint=_hint_for_error(resolved_model, cfg.api_base, raw)
            or _provider_hint(resolved_model, cfg.api_base),
        )

    elapsed = (time.perf_counter() - start) * 1000.0
    preview = _extract_preview(response)
    return LlmTestResult(
        ok=True,
        model=resolved_model,
        latency_ms=elapsed,
        response_preview=preview[:200],
        provider_hint=_provider_hint(resolved_model, cfg.api_base),
    )


def _extract_preview(resp: Any) -> str:
    try:
        choices = getattr(resp, "choices", None) or (
            resp.get("choices") if isinstance(resp, dict) else None
        )
        if not choices:
            return ""
        first = choices[0]
        msg = getattr(first, "message", None) or (
            first.get("message") if isinstance(first, dict) else None
        )
        if not msg:
            return ""
        content = getattr(msg, "content", None) or (
            msg.get("content") if isinstance(msg, dict) else None
        )
        return str(content or "").strip()
    except Exception:
        return ""


def _provider_hint(model: str, api_base: str | None = None) -> str | None:
    base = (api_base or "").lower()
    if model.startswith("deepseek/"):
        return (
            "DeepSeek official API: use LiteLLM ids like deepseek/deepseek-v4-flash. "
            "Keys are created at https://platform.deepseek.com/api_keys — see "
            "https://api-docs.deepseek.com/"
        )
    if "integrate.api.nvidia.com" in base:
        return (
            "NVIDIA NIM uses an OpenAI-compatible endpoint. If your model was "
            "entered as 'mistralai/...', NovaHunter now auto-normalizes it to "
            "'openai/mistralai/...'."
        )
    if model.startswith("ollama/"):
        return (
            "Ollama: make sure LLM_API_BASE points to your Ollama server "
            "(https://ollama.com for cloud, http://<host>:11434 for self-hosted) "
            "and the model is pre-pulled."
        )
    if model.startswith("anthropic/"):
        return "Anthropic: LLM_API_KEY must start with sk-ant-…"
    if model.startswith("openai/") and "openrouter" not in model:
        return "OpenAI: LLM_API_KEY must start with sk-…"
    if model.startswith("openrouter/"):
        return "OpenRouter: LLM_API_KEY must start with sk-or-…"
    return None


def _hint_for_error(model: str, api_base: str | None, raw_error: str) -> str | None:
    """Translate provider error strings into actionable guidance.

    The raw Ollama / OpenAI / Anthropic error text is noisy (stack traces,
    refs, HTML fragments). We match on substrings so the UI can show a one-
    liner that tells the operator *exactly* what to change.
    """
    lowered = raw_error.lower()
    base = (api_base or "").lower()

    # --- DeepSeek official API -------------------------------------------
    if model.startswith("deepseek/") or "api.deepseek.com" in base:
        if (
            "401" in lowered
            or "unauthorized" in lowered
            or ("invalid" in lowered and "key" in lowered)
        ):
            return (
                "DeepSeek rejected the API key. Create or rotate a key at "
                "https://platform.deepseek.com/api_keys and save it in LLM settings."
            )

    # --- NVIDIA NIM ------------------------------------------------------
    if "integrate.api.nvidia.com" in base:
        if "provider not provided" in lowered:
            return (
                "NVIDIA NIM requires a provider-prefixed model id for LiteLLM. "
                "Use an OpenAI-compatible prefix (for example "
                "'openai/mistralai/mistral-medium-3.5-128b')."
            )
        if "401" in lowered or "unauthorized" in lowered:
            return (
                "NVIDIA NIM rejected the API key. Regenerate the key in NVIDIA "
                "Build and paste it into LLM settings."
            )
        if "429" in lowered or "rate limit" in lowered:
            return (
                "NVIDIA NIM rate-limited this request. Free plans are capped "
                "(commonly ~40 RPM). Lower concurrency or retry after cooldown."
            )

    # --- Ollama Cloud ----------------------------------------------------
    if model.startswith("ollama/"):
        if "requires a subscription" in lowered or "upgrade for access" in lowered:
            return (
                "This Ollama Cloud model is on a paid tier. Either pick a free "
                "model (e.g. ollama/gpt-oss:20b-cloud, ollama/gpt-oss:120b-cloud, "
                "ollama/qwen3:32b-cloud) or upgrade at https://ollama.com/upgrade."
            )
        if (
            "model not found" in lowered
            or "unknown model" in lowered
            or ("model '" in lowered and "not found" in lowered)
        ):
            return (
                "Ollama doesn't recognise this model id. Browse "
                "https://ollama.com/library for the exact tag — cloud models "
                "end with ':cloud', local models with their parameter size "
                "(e.g. 'llama3.1:70b')."
            )
        if "401" in lowered or "unauthorized" in lowered or "invalid api key" in lowered:
            return (
                "Ollama Cloud rejected the API key. Regenerate one at "
                "https://ollama.com → Settings → API keys and paste it in the "
                "API key field, then Save."
            )
        if "429" in lowered or "rate limit" in lowered or "quota" in lowered:
            return (
                "Ollama Cloud rate-limited us. Free-tier accounts have tight "
                "concurrency limits; upgrade at https://ollama.com/upgrade or "
                "wait a minute and retry."
            )
        if "connection" in lowered and "refused" in lowered:
            return (
                "Ollama endpoint refused the connection. For self-hosted "
                "Ollama, make sure the host is running with "
                "OLLAMA_HOST=0.0.0.0 and the URL is reachable from the api "
                "container (host.docker.internal / public IP, not localhost)."
            )

    # --- OpenAI / Anthropic / generic -----------------------------------
    if "401" in lowered or "invalid api key" in lowered:
        return "The provider rejected the API key. Double-check the value you pasted, or regenerate it."
    if "404" in lowered and "model" in lowered:
        return "The model id isn't recognised by this provider. Check the exact spelling in the provider's docs."
    if "billing" in lowered or "payment" in lowered:
        return "The provider reports a billing issue. Top up your account or check the subscription status."
    if "quota" in lowered or "insufficient_quota" in lowered:
        return "You've exhausted your quota for this billing period on the provider."
    return None


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 6:
        return "*" * len(value)
    return f"{value[:3]}…{value[-3:]}"


# --- Module-level singleton -------------------------------------------------

_STORE: LlmConfigStore | None = None
_STORE_LOCK = threading.Lock()


def get_store(runs_dir: str | Path) -> LlmConfigStore:
    global _STORE
    with _STORE_LOCK:
        if _STORE is None or Path(_STORE.runs_dir) != Path(runs_dir):
            _STORE = LlmConfigStore(runs_dir)
        return _STORE
