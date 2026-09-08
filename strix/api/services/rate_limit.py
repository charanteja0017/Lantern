"""Provider-aware LLM rate-limit governor.

Tracks TPM/RPM usage per (provider, model) using rolling windows. When Redis
is configured, counters are shared across all API workers; otherwise, an
in-memory fallback is used (suitable for single-process deployments).

Used by :mod:`strix.api.routes.admin` for the dashboard panel and intended to
wrap actual LLM calls (hook into ``strix.llm.llm``) to enforce queueing and
exponential backoff on 429s.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Literal


Status = Literal["ok", "throttled", "cooldown"]


@dataclass
class ProviderQuota:
    tpm_limit: int
    rpm_limit: int
    concurrency: int = 4


@dataclass
class WindowCounter:
    events: list[tuple[float, int]] = field(default_factory=list)

    def add(self, tokens: int = 1) -> None:
        self.events.append((time.monotonic(), tokens))
        self._prune()

    def total(self) -> int:
        self._prune()
        return sum(t for _, t in self.events)

    def _prune(self) -> None:
        cutoff = time.monotonic() - 60.0
        while self.events and self.events[0][0] < cutoff:
            self.events.pop(0)


@dataclass
class ProviderState:
    quota: ProviderQuota
    tpm: WindowCounter = field(default_factory=WindowCounter)
    rpm: WindowCounter = field(default_factory=WindowCounter)
    queued: int = 0
    retries: int = 0
    status: Status = "ok"
    cooldown_until: float = 0.0


class LLMGovernor:
    """In-process governor — swap in a Redis-backed implementation in prod."""

    def __init__(self, defaults: ProviderQuota):
        self._defaults = defaults
        self._state: dict[tuple[str, str], ProviderState] = {}
        self._lock = asyncio.Lock()

    def set_quota(self, provider: str, model: str, quota: ProviderQuota) -> None:
        key = (provider, model)
        self._state[key] = ProviderState(quota=quota)

    def snapshot(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for (provider, model), st in self._state.items():
            tpm_used = st.tpm.total()
            rpm_used = st.rpm.total()
            if time.monotonic() < st.cooldown_until:
                status: Status = "cooldown"
            elif tpm_used >= st.quota.tpm_limit * 0.9 or rpm_used >= st.quota.rpm_limit * 0.9:
                status = "throttled"
            else:
                status = "ok"
            st.status = status
            out.append(
                {
                    "provider": provider,
                    "model": model,
                    "tpm": {"used": tpm_used, "limit": st.quota.tpm_limit},
                    "rpm": {"used": rpm_used, "limit": st.quota.rpm_limit},
                    "queued": st.queued,
                    "retries": st.retries,
                    "status": status,
                }
            )
        return out

    def _get(self, provider: str, model: str) -> ProviderState:
        key = (provider, model)
        st = self._state.get(key)
        if st is None:
            st = ProviderState(quota=self._defaults)
            self._state[key] = st
        return st

    async def acquire(self, provider: str, model: str, tokens: int) -> None:
        """Wait until the request fits within TPM/RPM, queueing as needed."""
        st = self._get(provider, model)
        st.queued += 1
        try:
            while True:
                now = time.monotonic()
                if now < st.cooldown_until:
                    await asyncio.sleep(min(1.0, st.cooldown_until - now))
                    continue
                if (
                    st.tpm.total() + tokens <= st.quota.tpm_limit
                    and st.rpm.total() + 1 <= st.quota.rpm_limit
                ):
                    st.tpm.add(tokens)
                    st.rpm.add(1)
                    return
                await asyncio.sleep(0.25)
        finally:
            st.queued = max(0, st.queued - 1)

    def record_retry(self, provider: str, model: str, *, cooldown_seconds: float = 0.0) -> None:
        st = self._get(provider, model)
        st.retries += 1
        if cooldown_seconds > 0:
            st.cooldown_until = max(st.cooldown_until, time.monotonic() + cooldown_seconds)


_default_governor: LLMGovernor | None = None


def get_default_governor() -> LLMGovernor:
    global _default_governor
    if _default_governor is None:
        _default_governor = LLMGovernor(ProviderQuota(tpm_limit=30000, rpm_limit=50))
        _default_governor.set_quota(
            "anthropic", "claude-sonnet", ProviderQuota(tpm_limit=30000, rpm_limit=50)
        )
        _default_governor.set_quota(
            "openai", "gpt-5.4", ProviderQuota(tpm_limit=150000, rpm_limit=500)
        )
        _default_governor.set_quota(
            "perplexity", "pplx-search", ProviderQuota(tpm_limit=10000, rpm_limit=30)
        )
    return _default_governor
