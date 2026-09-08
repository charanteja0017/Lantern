from typing import Any

from strix.config import Config
from strix.config.config import resolve_llm_config
from strix.llm.utils import resolve_strix_model


DEFAULT_PER_TURN_ITERATIONS = 25


def _resolve_per_turn_iterations(override: int | None) -> int:
    """Resolve the per-turn tool cap from an explicit override, Config, or default.

    Negative or zero values are coerced to ``DEFAULT_PER_TURN_ITERATIONS`` so
    callers cannot accidentally disable the cap. Operators who truly want to
    raise the ceiling should set ``strix_per_turn_iterations`` to an explicit
    positive value.
    """
    if override is not None and override > 0:
        return override
    raw = Config.get("strix_per_turn_iterations")
    try:
        parsed = int(raw) if raw is not None else DEFAULT_PER_TURN_ITERATIONS
    except (TypeError, ValueError):
        parsed = DEFAULT_PER_TURN_ITERATIONS
    return parsed if parsed > 0 else DEFAULT_PER_TURN_ITERATIONS


class LLMConfig:
    def __init__(
        self,
        model_name: str | None = None,
        enable_prompt_caching: bool = True,
        skills: list[str] | None = None,
        timeout: int | None = None,
        scan_mode: str = "deep",
        is_whitebox: bool = False,
        interactive: bool = False,
        reasoning_effort: str | None = None,
        system_prompt_context: dict[str, Any] | None = None,
        per_turn_iterations: int | None = None,
    ):
        resolved_model, self.api_key, self.api_base = resolve_llm_config()
        self.model_name = model_name or resolved_model

        if not self.model_name:
            raise ValueError("STRIX_LLM environment variable must be set and not empty")

        api_model, canonical = resolve_strix_model(self.model_name)
        self.litellm_model: str = api_model or self.model_name
        self.canonical_model: str = canonical or self.model_name

        self.enable_prompt_caching = enable_prompt_caching
        self.skills = skills or []

        self.timeout = timeout or int(Config.get("llm_timeout") or "300")

        self.scan_mode = scan_mode if scan_mode in ["quick", "standard", "deep"] else "deep"
        self.is_whitebox = is_whitebox
        self.interactive = interactive
        self.reasoning_effort = reasoning_effort
        self.system_prompt_context = system_prompt_context or {}

        self.per_turn_iterations: int = _resolve_per_turn_iterations(per_turn_iterations)
