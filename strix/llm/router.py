"""LLM role router.

Routes LLM calls by **role** (planner, executor, reasoner, reporter, vision,
memory, dedupe) to potentially different models / providers / reasoning
settings. This lets operators put an expensive, large-context model on
reasoning / reporting while a cheap model handles bulk tool-call execution
- which is where most tokens are spent.

Design goals
------------

1. **Single resolution point.** Every LLM call site that respects roles goes
   through :func:`ModelRouter.resolve` or its helper
   :func:`ModelRouter.prepare_completion_args`. No call site should touch
   per-role env vars directly.

2. **Pure fallback.** If a route is unset, the router falls back to the
   ``default`` route (which itself falls back to ``STRIX_LLM`` +
   ``LLM_API_KEY`` env, i.e. the historical single-model behaviour). This
   means the router is additive and does not break existing installs.

3. **Persistence-agnostic.** The core here holds routes in memory; later
   Phase 11 tasks back the routes by a DB table (``strix_llm_routes``) and
   reload on write. The only contract downstream code should rely on is
   ``get_router().resolve(role)``.

4. **Scope resolution.** Routes can be defined at three scopes: ``global``,
   ``org``, ``run``. ``resolve`` picks the most specific scope that defines
   the role, then falls back up the chain. The DB integration (Phase 14)
   reuses this logic.
"""

from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass, field, replace
from typing import Any, Literal

from strix.llm.providers import normalize_model_for_endpoint


logger = logging.getLogger(__name__)


Role = Literal[
    "default",
    "planner",
    "executor",
    "reasoner",
    "reporter",
    "vision",
    "memory",
    "dedupe",
]


ALL_ROLES: tuple[Role, ...] = (
    "default",
    "planner",
    "executor",
    "reasoner",
    "reporter",
    "vision",
    "memory",
    "dedupe",
)


# Human-readable descriptions surfaced in the Admin UI.
ROLE_DESCRIPTIONS: dict[Role, str] = {
    "default": "Fallback route used when a role-specific route is missing.",
    "planner": "Top-of-run planning, task decomposition, agent-graph spawning.",
    "executor": "Per-turn tool-call emission. Usually the highest-volume role.",
    "reasoner": "Heavy reasoning steps: exploit design, source-aware analysis.",
    "reporter": "Writing finding and scan reports. Quality > speed.",
    "vision": "Multimodal steps: screenshots, view_image payloads.",
    "memory": "Conversation compression and retrieval.",
    "dedupe": "LLM-based finding deduplication checks.",
}


Scope = Literal["global", "org", "run"]


@dataclass(frozen=True)
class RouteSpec:
    """Declarative description of how calls for a given role should run."""

    role: Role
    model: str
    api_key: str | None = None
    api_base: str | None = None
    reasoning_effort: str | None = None
    max_tokens: int | None = None
    temperature: float | None = None
    enabled: bool = True
    scope: Scope = "global"
    # A soft USD cap surfaced by the Redis budget counter. ``None`` = no cap.
    budget_usd: float | None = None

    def merge_over(self, other: RouteSpec | None) -> RouteSpec:
        """Return a copy of ``self`` with any missing fields pulled from ``other``."""
        if other is None:
            return self
        return replace(
            self,
            api_key=self.api_key or other.api_key,
            api_base=self.api_base or other.api_base,
            reasoning_effort=self.reasoning_effort or other.reasoning_effort,
            max_tokens=self.max_tokens if self.max_tokens is not None else other.max_tokens,
            temperature=(self.temperature if self.temperature is not None else other.temperature),
            budget_usd=self.budget_usd if self.budget_usd is not None else other.budget_usd,
        )


@dataclass
class RouteTable:
    """A single scope's view of per-role routes."""

    scope: Scope
    routes: dict[Role, RouteSpec] = field(default_factory=dict)

    def set(self, spec: RouteSpec) -> None:
        self.routes[spec.role] = replace(spec, scope=self.scope)

    def get(self, role: Role) -> RouteSpec | None:
        return self.routes.get(role)


# --- ModelRouter -------------------------------------------------------------


class ModelRouter:
    """Main router: resolves ``Role`` -> :class:`RouteSpec`.

    Three scopes are stacked: run > org > global, with env-var fallback for
    the default route so first-time installs continue to work with just
    ``STRIX_LLM`` / ``LLM_API_KEY`` set.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._global = RouteTable(scope="global")
        self._org: dict[str, RouteTable] = {}
        self._run: dict[str, RouteTable] = {}
        self._ambient_run: str | None = None
        self._ambient_org: str | None = None

    # -- setters used by the persistence layer & test harness ---------------

    def set_global(self, spec: RouteSpec) -> None:
        with self._lock:
            self._global.set(spec)

    def set_org(self, org_id: str, spec: RouteSpec) -> None:
        with self._lock:
            self._org.setdefault(org_id, RouteTable(scope="org")).set(spec)

    def set_run(self, run_id: str, spec: RouteSpec) -> None:
        with self._lock:
            self._run.setdefault(run_id, RouteTable(scope="run")).set(spec)

    def clear_run(self, run_id: str) -> None:
        with self._lock:
            self._run.pop(run_id, None)

    def bulk_load_global(self, specs: list[RouteSpec]) -> None:
        with self._lock:
            self._global = RouteTable(scope="global")
            for spec in specs:
                self._global.set(spec)

    # -- ambient context (so agent code need not plumb run_id everywhere) ----

    def set_ambient_scope(self, *, run_id: str | None = None, org_id: str | None = None) -> None:
        with self._lock:
            self._ambient_run = run_id
            self._ambient_org = org_id

    # -- resolution ---------------------------------------------------------

    def resolve(
        self,
        role: Role,
        *,
        run_id: str | None = None,
        org_id: str | None = None,
    ) -> RouteSpec:
        with self._lock:
            run_id = run_id or self._ambient_run
            org_id = org_id or self._ambient_org
            candidates: list[RouteSpec | None] = []
            if run_id and run_id in self._run:
                candidates.append(self._run[run_id].get(role))
            if org_id and org_id in self._org:
                candidates.append(self._org[org_id].get(role))
            candidates.append(self._global.get(role))

            for cand in candidates:
                if cand is not None and cand.enabled:
                    merged = cand
                    for fallback in candidates:
                        merged = merged.merge_over(fallback)
                    return self._apply_default_fallback(merged)

            default_spec = self._global.get("default")
            if default_spec is not None and role != "default" and default_spec.enabled:
                return self._apply_default_fallback(replace(default_spec, role=role))

            return self._apply_default_fallback(self._env_fallback(role))

    def resolved_roles(
        self,
        *,
        run_id: str | None = None,
        org_id: str | None = None,
    ) -> dict[Role, RouteSpec]:
        return {role: self.resolve(role, run_id=run_id, org_id=org_id) for role in ALL_ROLES}

    # -- completion wiring --------------------------------------------------

    def prepare_completion_args(
        self,
        role: Role,
        args: dict[str, Any],
        *,
        run_id: str | None = None,
        org_id: str | None = None,
    ) -> dict[str, Any]:
        """Mutate-safe: returns a new args dict with the route applied."""
        spec = self.resolve(role, run_id=run_id, org_id=org_id)
        patched = dict(args)
        patched["model"] = normalize_model_for_endpoint(spec.model, spec.api_base)
        if spec.api_key:
            patched["api_key"] = spec.api_key
        if spec.api_base:
            patched["api_base"] = spec.api_base
        if spec.reasoning_effort and "reasoning_effort" not in patched:
            patched["reasoning_effort"] = spec.reasoning_effort
        if spec.max_tokens is not None and "max_tokens" not in patched:
            patched["max_tokens"] = spec.max_tokens
        if spec.temperature is not None and "temperature" not in patched:
            patched["temperature"] = spec.temperature
        patched.setdefault("metadata", {})
        if isinstance(patched["metadata"], dict):
            patched["metadata"] = {
                **patched["metadata"],
                "novahunter_role": role,
                "novahunter_model": spec.model,
            }
        return patched

    def context_window(self, role: Role) -> int | None:
        """Best-effort max-input-tokens lookup for the resolved model.

        Returns ``None`` when LiteLLM has no info for the model; callers
        should then skip the guardrail rather than fail closed.
        """
        spec = self.resolve(role)
        if not spec.model:
            return None
        try:
            import litellm

            info = litellm.get_model_info(spec.model)
        except Exception:
            return None
        if not isinstance(info, dict):
            return None
        value = info.get("max_input_tokens") or info.get("max_tokens")
        try:
            return int(value) if value else None
        except (TypeError, ValueError):
            return None

    # -- internals ----------------------------------------------------------

    def _env_fallback(self, role: Role) -> RouteSpec:
        # First try a role-specific env override (``STRIX_LLM_<ROLE>``),
        # then the generic ``STRIX_LLM``.
        env_role = os.environ.get(f"STRIX_LLM_{role.upper()}")
        env_default = os.environ.get("STRIX_LLM")
        model = env_role or env_default or ""
        api_key = (
            os.environ.get(f"LLM_API_KEY_{role.upper()}") or os.environ.get("LLM_API_KEY") or None
        )
        api_base = (
            os.environ.get(f"LLM_API_BASE_{role.upper()}") or os.environ.get("LLM_API_BASE") or None
        )
        return RouteSpec(
            role=role,
            model=model,
            api_key=api_key,
            api_base=api_base,
            enabled=bool(model),
        )

    @staticmethod
    def _apply_default_fallback(spec: RouteSpec) -> RouteSpec:
        # If a spec carries no api_key but the env has one, fall back.
        api_key = spec.api_key or os.environ.get("LLM_API_KEY") or None
        api_base = spec.api_base or os.environ.get("LLM_API_BASE") or None
        return replace(spec, api_key=api_key, api_base=api_base)


# --- module singleton --------------------------------------------------------

_router: ModelRouter | None = None
_router_lock = threading.Lock()


def get_router() -> ModelRouter:
    global _router
    if _router is None:
        with _router_lock:
            if _router is None:
                _router = ModelRouter()
    return _router


def set_router(router: ModelRouter) -> None:
    """Replace the process-wide router (used by tests and the DB loader)."""
    global _router
    with _router_lock:
        _router = router


def reset_router() -> None:
    """Drop the singleton so the next ``get_router`` call builds a fresh one."""
    global _router
    with _router_lock:
        _router = None


__all__ = [
    "ALL_ROLES",
    "ROLE_DESCRIPTIONS",
    "ModelRouter",
    "Role",
    "RouteSpec",
    "RouteTable",
    "Scope",
    "get_router",
    "reset_router",
    "set_router",
]
