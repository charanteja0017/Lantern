"""Preflight validation for Strix scans.

Preflight runs *before* any container is spawned. It turns "bad runs" into
fast, structured 400-level errors instead of silently-queued runs that fail
minutes later inside the sandbox.

Checks fall into three buckets:

1. **Configuration**: LLM model + API key are resolvable.
2. **Policy**: targets, instruction, and scan mode pass the active
   :class:`strix.api.services.policy.RunPolicy`.
3. **Infrastructure** (optional): Docker socket reachable, sandbox image
   present locally.

Preflight is intentionally cheap: it never makes a network request to the
target, never pulls an image, and never spawns a container. The heavier
verification (target reachability, credentials against live providers)
belongs in a separate background verification step — we reserve the right
to add it here once it can be implemented without blocking the request.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from strix.api.services.policy import PolicyViolation, RunPolicy, load_default_policy


logger = logging.getLogger(__name__)


@dataclass
class PreflightResult:
    """Outcome of a preflight evaluation.

    ``ok`` means the run is safe to launch. ``violations`` lists structured
    reasons why it isn't; ``warnings`` lists soft issues the UI should
    surface but which do not block launch.
    """

    ok: bool
    policy: RunPolicy
    violations: list[PolicyViolation] = field(default_factory=list)
    warnings: list[PolicyViolation] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "violations": [v.as_dict() for v in self.violations],
            "warnings": [v.as_dict() for v in self.warnings],
            "policy": {
                "dry_run_only": self.policy.dry_run_only,
                "require_exploit_approval": self.policy.require_exploit_approval,
                "allow_private_targets": self.policy.allow_private_targets,
                "allowed_target_patterns": list(self.policy.allowed_target_patterns),
                "blocked_target_patterns": list(self.policy.blocked_target_patterns),
                "blocked_tools": list(self.policy.blocked_tools),
                "max_targets": self.policy.max_targets,
            },
        }

    def reason(self) -> str:
        """Human-readable summary for API error bodies."""
        if self.ok:
            return "ok"
        head = self.violations[0]
        extra = (
            f" (+{len(self.violations) - 1} more violations)" if len(self.violations) > 1 else ""
        )
        return f"{head.code}: {head.message}{extra}"


def run_preflight(
    *,
    targets: list[str],
    instruction: str | None,
    scan_mode: str,
    scope_mode: str,
    runs_dir: str | Path,
    policy_override: dict[str, Any] | None = None,
) -> PreflightResult:
    """Evaluate all preflight rules for a proposed run.

    This function is pure: it never mutates state. The caller decides how
    to surface the result (HTTP 400, run.failed event, etc.).
    """
    policy = RunPolicy.merge(load_default_policy(), policy_override)
    violations: list[PolicyViolation] = []
    warnings: list[PolicyViolation] = []

    violations.extend(policy.check_targets(targets))
    violations.extend(policy.check_instruction(instruction))
    violations.extend(_check_scan_mode(scan_mode, scope_mode))
    violations.extend(_check_llm_config(runs_dir))

    warnings.extend(_check_sandbox_image())
    warnings.extend(_check_docker_socket())

    return PreflightResult(
        ok=not violations,
        policy=policy,
        violations=violations,
        warnings=warnings,
    )


# --- Individual checks -------------------------------------------------------


def _check_scan_mode(scan_mode: str, scope_mode: str) -> list[PolicyViolation]:
    violations: list[PolicyViolation] = []
    valid_scan = {"quick", "standard", "deep"}
    valid_scope = {"auto", "diff", "full"}
    if scan_mode not in valid_scan:
        violations.append(
            PolicyViolation(
                code="preflight.scan_mode.invalid",
                message=(f"scan_mode='{scan_mode}' is not one of {sorted(valid_scan)}."),
                context={"got": scan_mode},
            )
        )
    if scope_mode not in valid_scope:
        violations.append(
            PolicyViolation(
                code="preflight.scope_mode.invalid",
                message=(f"scope_mode='{scope_mode}' is not one of {sorted(valid_scope)}."),
                context={"got": scope_mode},
            )
        )
    return violations


def _check_llm_config(runs_dir: str | Path) -> list[PolicyViolation]:
    """Ensure STRIX_LLM (or equivalent) is resolvable before launch."""
    try:
        from strix.api.services.llm_config import get_store

        cfg = get_store(runs_dir).effective()
    except Exception as exc:
        logger.warning("preflight: llm_config lookup failed: %s", exc)
        cfg = None

    model = ""
    api_key = ""
    api_base = ""
    if cfg is not None:
        model = getattr(cfg, "model", "") or ""
        api_key = getattr(cfg, "api_key", "") or ""
        api_base = getattr(cfg, "api_base", "") or ""

    model = model or os.getenv("STRIX_LLM", "") or os.getenv("LLM_MODEL", "")
    api_key = api_key or os.getenv("LLM_API_KEY", "")

    if not model:
        return [
            PolicyViolation(
                code="preflight.llm.model_missing",
                message=(
                    "LLM is not configured. Open Settings → LLM provider to "
                    "choose a model (or set STRIX_LLM / LLM_MODEL in "
                    "deploy/.env)."
                ),
            )
        ]

    # ``strix/*`` hosted models ship their own credentials; Ollama local
    # instances don't need a key either. Only API providers do.
    if model.startswith("strix/"):
        return []
    if model.startswith("ollama/") and not api_base.startswith("https://ollama.com"):
        return []

    if not api_key:
        return [
            PolicyViolation(
                code="preflight.llm.api_key_missing",
                message=(
                    "LLM_API_KEY is not set for provider "
                    f"'{model.split('/')[0]}'. Configure it in Settings → LLM "
                    "provider or deploy/.env."
                ),
                context={"model": model},
            )
        ]
    return []


def _check_sandbox_image() -> list[PolicyViolation]:
    """Warn (don't block) when the sandbox image isn't available locally.

    We prefer a warning here because ``docker pull`` at run start is a
    supported workflow — failing preflight would break first-time installs.
    """
    try:
        import docker
    except ImportError:
        return []

    image_name = os.getenv("STRIX_IMAGE", "")
    if not image_name:
        return []
    try:
        client = docker.from_env(timeout=5)
        client.images.get(image_name)
    except Exception as exc:
        return [
            PolicyViolation(
                code="preflight.sandbox.image_not_local",
                message=(
                    f"Sandbox image '{image_name}' is not cached locally "
                    "and will be pulled on first use. This may add minutes "
                    "to the first scan."
                ),
                context={"image": image_name, "error": str(exc)[:200]},
            )
        ]
    return []


def _check_docker_socket() -> list[PolicyViolation]:
    sock = os.getenv("DOCKER_HOST", "").removeprefix("unix://") or "/var/run/docker.sock"
    path = Path(sock)
    if path.exists():
        return []
    return [
        PolicyViolation(
            code="preflight.docker.socket_missing",
            message=(
                f"Docker socket not found at '{sock}'. Scans require the "
                "API container to reach the host Docker daemon."
            ),
            context={"socket": sock},
        )
    ]
