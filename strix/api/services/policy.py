"""Run-time safety policy model for Strix scans.

A policy is a lightweight, explicit contract that governs what a scan is
allowed to do. It is evaluated:

1. At run creation time (``preflight``) to reject unsafe requests before any
   container is spawned.
2. At tool-execution boundaries (``enforce_tool``) so that out-of-policy
   actions fail fast with a structured, auditable reason.

The policy is intentionally separate from the LLM configuration / sandbox
runtime. It encodes operator intent ("what may this run do?"), not
infrastructure.

Policies are loaded from three sources, in priority order:

1. Per-run override passed via the API (``CreateRunRequest.policy``).
2. Process-wide defaults via environment variables
   (``STRIX_POLICY_*``).
3. Built-in defaults defined on :class:`RunPolicy`.

Environment overrides use the same variable names as the dataclass fields,
upper-cased and prefixed with ``STRIX_POLICY_``.
"""

from __future__ import annotations

import fnmatch
import logging
import os
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse


logger = logging.getLogger(__name__)


# --- Defaults ----------------------------------------------------------------

# Tool names that are considered "destructive" or "active exploitation" rather
# than passive observation. Used to gate ``require_exploit_approval``.
DEFAULT_EXPLOIT_TOOLS: frozenset[str] = frozenset(
    {
        "send_simple_request",
        "send_custom_request",
        "repeat_request",
        "browser_goto",
        "browser_click",
        "browser_fill",
        "browser_execute_js",
        "terminal_execute",
        "python_execute",
    }
)

# Tools that are never allowed under any policy. Operators can still override
# via ``blocked_tools=[]`` but the default is conservative.
DEFAULT_BLOCKED_TOOLS: frozenset[str] = frozenset()

# Tools that accept a freeform command / code string whose contents should be
# scanned for obviously catastrophic operations before dispatch. The value is
# the kwarg name that carries the command string.
COMMAND_KWARG_BY_TOOL: dict[str, str] = {
    "terminal_execute": "command",
    "python_action": "code",
    "python_execute": "code",
    "shell_execute": "command",
    "write_shell": "input",
}

# Regex deny-list for obviously destructive or self-harming commands. Matched
# case-insensitively against the combined command string. This is a safety net
# only - the LLM is already trained to avoid these; this layer catches the
# occasional jailbreak or prompt-injected "helpful" suggestion.
_DANGEROUS_COMMAND_PATTERNS: tuple[re.Pattern[str], ...] = (
    # ``rm -rf /`` and friends (any long-flag / short-flag combo, root or wildcard path)
    re.compile(r"\brm\s+(?:-[a-zA-Z]*[rfRF][a-zA-Z]*\s+)+(?:/|\*|~|--no-preserve-root)"),
    re.compile(r"\brm\s+--recursive\s+--force\s+(?:/|\*)"),
    # ``dd`` targeting a raw device or disk
    re.compile(r"\bdd\b[^|;\n]*\bof\s*=\s*/dev/(?:sd[a-z]|nvme|hd[a-z]|xvd[a-z]|vd[a-z]|disk)"),
    # mkfs against a device
    re.compile(r"\bmkfs(?:\.\w+)?\b[^|;\n]*\s/dev/"),
    # Classic bash fork-bomb
    re.compile(r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:"),
    # chmod 777 on system roots
    re.compile(
        r"\bchmod\s+(?:-R\s+)?(?:777|a\+rwx|ugo\+rwx)\s+(?:/|/etc|/boot|/var|/usr|/bin|/sbin|/lib)"
    ),
    # chown -R root on system roots
    re.compile(r"\bchown\s+-R\s+[^\s]+\s+(?:/|/etc|/boot|/var|/usr|/bin|/sbin|/lib)"),
    # mv /... /dev/null (destructive relocation)
    re.compile(r"\bmv\s+/\S*\s+/dev/null\b"),
    # Writing to /dev/sd[a-z] directly
    re.compile(r">\s*/dev/(?:sd[a-z]|nvme|hd[a-z]|xvd[a-z]|vd[a-z]|disk)"),
    # Shred on a device or root
    re.compile(r"\bshred\b[^|;\n]*(?:/dev/|/\s|--remove)"),
    # Curl | sh pattern targeting root install
    re.compile(r"\bcurl\b[^|;\n]*\|\s*(?:sudo\s+)?(?:bash|sh|zsh)\b"),
    re.compile(r"\bwget\b[^|;\n]*\|\s*(?:sudo\s+)?(?:bash|sh|zsh)\b"),
    # Filesystem wipe via find
    re.compile(r"\bfind\s+/\s+(?:-[a-z]+\s+\S+\s+)*-(?:delete|exec\s+rm)"),
    # Format a Windows drive from WSL / similar
    re.compile(r"\bformat\s+[A-Za-z]:"),
    # Python-inside-shell rm_rf
    re.compile(r"shutil\.rmtree\s*\(\s*['\"]/"),
    re.compile(r"os\.system\s*\(\s*['\"]rm\s+-rf\s+/"),
    # Overwrite /etc/passwd, /etc/shadow
    re.compile(r">\s*/etc/(?:passwd|shadow|sudoers)\b"),
)


def _scan_dangerous_command(command: str) -> re.Pattern[str] | None:
    """Return the first dangerous-command pattern that matched, else None."""
    if not command:
        return None
    for pattern in _DANGEROUS_COMMAND_PATTERNS:
        if pattern.search(command):
            return pattern
    return None


# Targets that are *always* unsafe when ``allow_private_targets`` is False.
# RFC1918 + loopback + link-local + CGNAT.
_PRIVATE_IP_PATTERNS = (
    re.compile(r"^127\."),
    re.compile(r"^10\."),
    re.compile(r"^192\.168\."),
    re.compile(r"^172\.(1[6-9]|2[0-9]|3[0-1])\."),
    re.compile(r"^169\.254\."),
    re.compile(r"^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\."),
    re.compile(r"^::1$"),
    re.compile(r"^fe80:"),
    re.compile(r"^fc00:"),
    re.compile(r"^fd00:"),
)

_LOCALHOST_HOSTS = frozenset({"localhost", "ip6-localhost", "ip6-loopback"})


@dataclass(frozen=True)
class PolicyViolation:
    """A structured reason a policy check rejected an input."""

    code: str
    message: str
    context: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "context": self.context}


@dataclass
class RunPolicy:
    """Declarative safety policy for a single run.

    All flags default to safe production behavior. Operators can relax them
    per-run (e.g. lab testing against ``localhost``).
    """

    dry_run_only: bool = False
    require_exploit_approval: bool = False
    allow_private_targets: bool = True
    allow_dangerous_commands: bool = False
    allowed_target_patterns: tuple[str, ...] = ()
    blocked_target_patterns: tuple[str, ...] = ()
    blocked_tools: tuple[str, ...] = tuple(sorted(DEFAULT_BLOCKED_TOOLS))
    exploit_tools: tuple[str, ...] = tuple(sorted(DEFAULT_EXPLOIT_TOOLS))
    max_targets: int = 50
    max_instruction_chars: int = 20_000
    max_rps_per_host: float = 10.0
    max_concurrency_per_host: int = 4

    @classmethod
    def from_env(cls) -> RunPolicy:
        """Build the process-wide default policy from environment variables."""
        return cls(
            dry_run_only=_env_bool("STRIX_POLICY_DRY_RUN_ONLY", False),
            require_exploit_approval=_env_bool("STRIX_POLICY_REQUIRE_EXPLOIT_APPROVAL", False),
            allow_private_targets=_env_bool("STRIX_POLICY_ALLOW_PRIVATE_TARGETS", True),
            allow_dangerous_commands=_env_bool("STRIX_POLICY_ALLOW_DANGEROUS_COMMANDS", False),
            allowed_target_patterns=_env_tuple("STRIX_POLICY_ALLOWED_TARGETS"),
            blocked_target_patterns=_env_tuple("STRIX_POLICY_BLOCKED_TARGETS"),
            blocked_tools=_env_tuple(
                "STRIX_POLICY_BLOCKED_TOOLS",
                default=tuple(sorted(DEFAULT_BLOCKED_TOOLS)),
            ),
            max_targets=int(os.getenv("STRIX_POLICY_MAX_TARGETS", "50") or "50"),
            max_instruction_chars=int(
                os.getenv("STRIX_POLICY_MAX_INSTRUCTION_CHARS", "20000") or "20000"
            ),
            max_rps_per_host=float(os.getenv("STRIX_POLICY_MAX_RPS_PER_HOST", "10") or "10"),
            max_concurrency_per_host=int(
                os.getenv("STRIX_POLICY_MAX_CONCURRENCY_PER_HOST", "4") or "4"
            ),
        )

    @classmethod
    def merge(cls, base: RunPolicy, override: dict[str, Any] | None) -> RunPolicy:
        """Return a new policy where ``override`` keys replace ``base`` fields."""
        if not override:
            return base
        data = {
            "dry_run_only": base.dry_run_only,
            "require_exploit_approval": base.require_exploit_approval,
            "allow_private_targets": base.allow_private_targets,
            "allow_dangerous_commands": base.allow_dangerous_commands,
            "allowed_target_patterns": base.allowed_target_patterns,
            "blocked_target_patterns": base.blocked_target_patterns,
            "blocked_tools": base.blocked_tools,
            "exploit_tools": base.exploit_tools,
            "max_targets": base.max_targets,
            "max_instruction_chars": base.max_instruction_chars,
            "max_rps_per_host": base.max_rps_per_host,
            "max_concurrency_per_host": base.max_concurrency_per_host,
        }
        for key, value in override.items():
            if key not in data:
                continue
            if isinstance(data[key], tuple) and isinstance(value, (list, tuple)):
                data[key] = tuple(value)
            else:
                data[key] = value
        return cls(**data)  # type: ignore[arg-type]

    # ------------------------------------------------------------------ checks

    def check_targets(self, targets: Iterable[str]) -> list[PolicyViolation]:
        """Return a list of violations for the given targets. Empty == OK."""
        targets = list(targets)
        violations: list[PolicyViolation] = []

        if not targets:
            violations.append(
                PolicyViolation(
                    code="policy.targets.empty",
                    message="At least one target is required.",
                )
            )
            return violations

        if len(targets) > self.max_targets:
            violations.append(
                PolicyViolation(
                    code="policy.targets.too_many",
                    message=(
                        f"Too many targets ({len(targets)} > max {self.max_targets}). "
                        "Split into multiple runs or raise STRIX_POLICY_MAX_TARGETS."
                    ),
                    context={"max": self.max_targets, "got": len(targets)},
                )
            )

        for target in targets:
            violations.extend(self._check_single_target(target))
        return violations

    def _check_single_target(self, target: str) -> list[PolicyViolation]:
        violations: list[PolicyViolation] = []
        raw = (target or "").strip()
        if not raw:
            violations.append(
                PolicyViolation(
                    code="policy.target.blank",
                    message="Target must not be blank.",
                )
            )
            return violations

        host = _extract_host(raw)

        if not self.allow_private_targets and _is_private_or_local(host):
            violations.append(
                PolicyViolation(
                    code="policy.target.private_forbidden",
                    message=(
                        f"Target '{raw}' resolves to a private/loopback host "
                        "but allow_private_targets is disabled for this run."
                    ),
                    context={"target": raw, "host": host},
                )
            )

        if self.blocked_target_patterns and _matches_any(raw, self.blocked_target_patterns):
            violations.append(
                PolicyViolation(
                    code="policy.target.blocked",
                    message=(
                        f"Target '{raw}' matches a blocked pattern in "
                        "policy.blocked_target_patterns."
                    ),
                    context={"target": raw},
                )
            )

        if self.allowed_target_patterns and not _matches_any(raw, self.allowed_target_patterns):
            violations.append(
                PolicyViolation(
                    code="policy.target.not_allowed",
                    message=(
                        f"Target '{raw}' does not match any allowed pattern "
                        "in policy.allowed_target_patterns."
                    ),
                    context={"target": raw},
                )
            )
        return violations

    def check_instruction(self, instruction: str | None) -> list[PolicyViolation]:
        if instruction is None:
            return []
        if len(instruction) > self.max_instruction_chars:
            return [
                PolicyViolation(
                    code="policy.instruction.too_long",
                    message=(
                        f"Instruction is {len(instruction)} chars, exceeds "
                        f"max {self.max_instruction_chars}."
                    ),
                )
            ]
        return []

    def check_command(
        self, tool_name: str, kwargs: dict[str, Any] | None
    ) -> PolicyViolation | None:
        """Scan the command / code kwarg of ``tool_name`` for destructive ops.

        Returns ``None`` when the tool does not carry a command string, when
        the kwargs are empty, when ``allow_dangerous_commands`` is set, or
        when no regex matched.
        """
        if self.allow_dangerous_commands:
            return None
        kwarg_name = COMMAND_KWARG_BY_TOOL.get(tool_name)
        if kwarg_name is None or not kwargs:
            return None
        raw = kwargs.get(kwarg_name)
        if not isinstance(raw, str) or not raw.strip():
            return None
        matched = _scan_dangerous_command(raw)
        if matched is None:
            return None
        return PolicyViolation(
            code="policy.command.dangerous",
            message=(
                f"Tool '{tool_name}' was asked to run a destructive command "
                "that matches the built-in dangerous-command deny-list. "
                "Set policy.allow_dangerous_commands=true to override."
            ),
            context={
                "tool": tool_name,
                "pattern": matched.pattern,
                "command_preview": raw[:200],
            },
        )

    def check_tool(self, tool_name: str) -> PolicyViolation | None:
        """Return a violation if the tool is disallowed by this policy."""
        if tool_name in self.blocked_tools:
            return PolicyViolation(
                code="policy.tool.blocked",
                message=f"Tool '{tool_name}' is blocked by run policy.",
                context={"tool": tool_name},
            )
        if self.dry_run_only and tool_name in self.exploit_tools:
            return PolicyViolation(
                code="policy.tool.dry_run_only",
                message=(
                    f"Tool '{tool_name}' would execute an exploit action, "
                    "but this run is marked dry_run_only."
                ),
                context={"tool": tool_name},
            )
        if self.require_exploit_approval and tool_name in self.exploit_tools:
            # Approval is a separate workflow; for now we surface a
            # structured warning via violation and let the caller decide
            # whether to block. This is intentionally *not* a hard block so
            # the existing autonomous flow keeps working; approval wiring
            # is a follow-up piece.
            return PolicyViolation(
                code="policy.tool.approval_required",
                message=(
                    f"Tool '{tool_name}' requires exploit approval under this "
                    "policy. Approve the run or disable require_exploit_approval."
                ),
                context={"tool": tool_name},
            )
        return None


# --- Helpers -----------------------------------------------------------------


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_tuple(name: str, default: tuple[str, ...] = ()) -> tuple[str, ...]:
    raw = os.getenv(name, "")
    if not raw.strip():
        return default
    return tuple(x.strip() for x in raw.split(",") if x.strip())


def _extract_host(target: str) -> str:
    """Pull the hostname out of a target that might be a URL, host, or IP."""
    candidate = target.strip()
    if "://" not in candidate:
        # Might be ``host:port`` or a bare host/IP — urlparse needs a scheme
        # to populate ``hostname``, so tack one on.
        candidate = f"http://{candidate}"
    try:
        parsed = urlparse(candidate)
    except ValueError:
        return target.strip()
    return (parsed.hostname or target).strip().lower()


def _is_private_or_local(host: str) -> bool:
    if not host:
        return False
    lowered = host.lower()
    if lowered in _LOCALHOST_HOSTS:
        return True
    return any(pat.match(lowered) for pat in _PRIVATE_IP_PATTERNS)


def _matches_any(target: str, patterns: Iterable[str]) -> bool:
    lowered = target.lower()
    host = _extract_host(target)
    for pat in patterns:
        pat_l = pat.lower()
        if fnmatch.fnmatch(lowered, pat_l) or fnmatch.fnmatch(host, pat_l):
            return True
    return False


# --- Public API --------------------------------------------------------------


def load_default_policy() -> RunPolicy:
    """Return the process-wide default policy (env-driven, cached per call)."""
    return RunPolicy.from_env()


def enforce_tool(policy: RunPolicy, tool_name: str) -> PolicyViolation | None:
    """Hook point for :mod:`strix.tools.executor` before running a tool."""
    return policy.check_tool(tool_name)


def enforce_command(
    policy: RunPolicy, tool_name: str, kwargs: dict[str, Any] | None
) -> PolicyViolation | None:
    """Hook point for :mod:`strix.tools.executor` to screen command payloads."""
    return policy.check_command(tool_name, kwargs)
