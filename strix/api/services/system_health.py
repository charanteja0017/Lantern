"""System health probes and in-process request metrics.

This module powers the ``/api/system/health`` endpoint consumed by the
frontend health-monitor page. It intentionally keeps dependencies light:

* **Probes** are small async functions that each answer one yes/no question
  ("can we SELECT 1 from Postgres?", "is the runs dir writable?"). They catch
  their own exceptions so one broken probe never brings the whole report
  down.
* **Metrics** are a tiny per-worker sliding-window counter, keyed by route
  template ("/api/runs/{run_id}") so cardinality stays bounded. Good enough
  for a single/dual-worker VPS deployment; swap in Prometheus later if you
  need multi-node aggregation.

Both probes and metrics are read from the admin ``/api/system/health`` route
(see ``strix.api.routes.system``).
"""

from __future__ import annotations

import asyncio
import os
import shutil
import socket
import time
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from statistics import median
from typing import Any

from strix.api.services.db import get_pg_pool, get_redis
from strix.api.services.rate_limit import get_default_governor
from strix.api.services.run_launcher import RunLauncher
from strix.api.settings import get_settings


# --- Process start time (used for uptime) ------------------------------------
_PROCESS_STARTED_AT: float = time.time()


def process_uptime_seconds() -> float:
    return max(0.0, time.time() - _PROCESS_STARTED_AT)


# --- Probe result shape ------------------------------------------------------


@dataclass(frozen=True)
class ProbeResult:
    name: str
    status: str  # "healthy" | "degraded" | "down" | "disabled"
    latency_ms: float | None
    detail: str = ""
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "status": self.status,
            "latencyMs": round(self.latency_ms, 2) if self.latency_ms is not None else None,
            "detail": self.detail,
            "meta": dict(self.meta),
        }


async def _timed(
    name: str, fn: Callable[[], Awaitable[ProbeResult]], timeout_s: float = 3.0
) -> ProbeResult:
    start = time.perf_counter()
    try:
        res = await asyncio.wait_for(fn(), timeout=timeout_s)
        # Probes may set their own latency when the measurement they take is
        # more meaningful than wall-clock (e.g. TCP connect vs probe total).
        if res.latency_ms is None:
            elapsed = (time.perf_counter() - start) * 1000.0
            return ProbeResult(
                name=res.name,
                status=res.status,
                latency_ms=elapsed,
                detail=res.detail,
                meta=res.meta,
            )
        return res
    except TimeoutError:
        elapsed = (time.perf_counter() - start) * 1000.0
        return ProbeResult(
            name=name,
            status="down",
            latency_ms=elapsed,
            detail=f"probe timed out after {timeout_s:.1f}s",
        )
    except Exception as exc:
        elapsed = (time.perf_counter() - start) * 1000.0
        return ProbeResult(
            name=name,
            status="down",
            latency_ms=elapsed,
            detail=f"{type(exc).__name__}: {exc}",
        )


# --- Individual probes -------------------------------------------------------


async def probe_postgres() -> ProbeResult:
    settings = get_settings()
    if not settings.postgres_enabled:
        return ProbeResult(
            name="postgres", status="disabled", latency_ms=None, detail="STRIX_DATABASE_URL not set"
        )
    # Distinguish "driver missing" from "driver present but connect failed" so
    # the dashboard points the operator at the right fix (rebuild image vs.
    # check DATABASE_URL / Postgres health).
    try:
        import asyncpg  # noqa: F401
    except ImportError:
        return ProbeResult(
            name="postgres",
            status="down",
            latency_ms=None,
            detail="asyncpg driver not installed in the API image",
        )
    pool = await get_pg_pool()
    if pool is None:
        return ProbeResult(
            name="postgres",
            status="down",
            latency_ms=None,
            detail="asyncpg pool creation failed (see API logs for the cause)",
        )
    start = time.perf_counter()
    try:
        async with pool.acquire() as conn:
            version = await conn.fetchval("SELECT version()")
            one = await conn.fetchval("SELECT 1")
    except Exception as exc:
        return ProbeResult(
            name="postgres",
            status="down",
            latency_ms=(time.perf_counter() - start) * 1000.0,
            detail=f"query failed: {type(exc).__name__}: {exc}",
        )
    elapsed = (time.perf_counter() - start) * 1000.0
    if one != 1:
        return ProbeResult(
            name="postgres",
            status="degraded",
            latency_ms=elapsed,
            detail="SELECT 1 returned unexpected value",
        )
    version_str = str(version or "").split(" on ")[0][:80]
    return ProbeResult(
        name="postgres",
        status="healthy",
        latency_ms=elapsed,
        detail="SELECT 1 OK",
        meta={"version": version_str},
    )


async def probe_redis() -> ProbeResult:
    settings = get_settings()
    if not settings.redis_enabled:
        return ProbeResult(
            name="redis", status="disabled", latency_ms=None, detail="STRIX_REDIS_URL not set"
        )
    try:
        import redis.asyncio  # noqa: F401
    except ImportError:
        return ProbeResult(
            name="redis",
            status="down",
            latency_ms=None,
            detail="redis driver not installed in the API image",
        )
    client = await get_redis()
    if client is None:
        return ProbeResult(
            name="redis",
            status="down",
            latency_ms=None,
            detail="redis client construction failed (see API logs)",
        )
    start = time.perf_counter()
    try:
        pong = await client.ping()
    except Exception as exc:
        return ProbeResult(
            name="redis",
            status="down",
            latency_ms=(time.perf_counter() - start) * 1000.0,
            detail=f"PING failed: {type(exc).__name__}: {exc}",
        )
    info: dict[str, Any] = {}
    try:
        # `info` can be heavy on large instances; ask only for the section we
        # care about.
        raw_info = await client.info("server")
        if isinstance(raw_info, dict):
            info = {
                "version": str(raw_info.get("redis_version", "")),
                "mode": str(raw_info.get("redis_mode", "")),
            }
    except Exception:
        pass
    elapsed = (time.perf_counter() - start) * 1000.0
    if not pong:
        return ProbeResult(
            name="redis",
            status="degraded",
            latency_ms=elapsed,
            detail="PING returned falsy",
        )
    return ProbeResult(
        name="redis",
        status="healthy",
        latency_ms=elapsed,
        detail="PING OK",
        meta=info,
    )


async def probe_runs_dir() -> ProbeResult:
    settings = get_settings()
    path = settings.runs_dir
    start = time.perf_counter()
    exists = os.path.isdir(path)
    if not exists:
        return ProbeResult(
            name="runs_dir",
            status="down",
            latency_ms=(time.perf_counter() - start) * 1000.0,
            detail=f"{path} does not exist",
            meta={"path": path},
        )
    # Count active runs quickly (pid files) without a directory walk blowing
    # up when the dir is large.
    try:
        entries = list(os.scandir(path))
    except OSError as exc:
        return ProbeResult(
            name="runs_dir",
            status="degraded",
            latency_ms=(time.perf_counter() - start) * 1000.0,
            detail=f"{type(exc).__name__}: {exc}",
            meta={"path": path},
        )
    run_count = sum(1 for e in entries if e.is_dir() and not e.name.startswith("_"))
    writable = os.access(path, os.W_OK)
    try:
        usage = shutil.disk_usage(path)
        disk = {
            "totalBytes": int(usage.total),
            "usedBytes": int(usage.used),
            "freeBytes": int(usage.free),
            "usedPercent": round((usage.used / usage.total) * 100.0, 2) if usage.total else 0.0,
        }
    except OSError:
        disk = {}
    elapsed = (time.perf_counter() - start) * 1000.0
    status = "healthy" if writable else "degraded"
    # Flag low-disk early so the UI can show an orange chip before an actual
    # outage: <10% free is the common production wake-up line.
    if disk and disk.get("usedPercent", 0) >= 90:
        status = "degraded"
    return ProbeResult(
        name="runs_dir",
        status=status,
        latency_ms=elapsed,
        detail="writable" if writable else "read-only",
        meta={"path": path, "runCount": run_count, "disk": disk},
    )


async def probe_docker_socket() -> ProbeResult:
    candidates = [
        os.environ.get("DOCKER_HOST", "").removeprefix("unix://"),
        "/var/run/docker.sock",
    ]
    for path in candidates:
        if path and os.path.exists(path):
            ok = os.access(path, os.R_OK | os.W_OK)
            return ProbeResult(
                name="docker_socket",
                status="healthy" if ok else "degraded",
                latency_ms=None,
                detail=path if ok else f"{path} (no rw)",
                meta={"path": path},
            )
    return ProbeResult(
        name="docker_socket",
        status="disabled",
        latency_ms=None,
        detail="socket not mounted (only required for agent sandboxes)",
    )


async def probe_clerk() -> ProbeResult:
    settings = get_settings()
    if not settings.auth_enabled:
        return ProbeResult(
            name="clerk",
            status="disabled",
            latency_ms=None,
            detail="Clerk not configured (CLERK_ISSUER / CLERK_JWKS_URL empty)",
        )
    try:
        import httpx
    except ImportError:
        return ProbeResult(
            name="clerk",
            status="down",
            latency_ms=None,
            detail="httpx not installed — JWT verification will fail",
        )
    start = time.perf_counter()
    async with httpx.AsyncClient(timeout=3.0) as client:
        resp = await client.get(settings.clerk_jwks_url)
    elapsed = (time.perf_counter() - start) * 1000.0
    if resp.status_code != 200:
        return ProbeResult(
            name="clerk",
            status="degraded",
            latency_ms=elapsed,
            detail=f"JWKS returned {resp.status_code}",
        )
    try:
        keys = len(resp.json().get("keys", []))
    except Exception:
        keys = 0
    return ProbeResult(
        name="clerk",
        status="healthy",
        latency_ms=elapsed,
        detail="JWKS reachable",
        meta={"keyCount": keys, "issuer": settings.clerk_issuer},
    )


async def probe_frontend() -> ProbeResult:
    """Best-effort internal check of the Next.js container from the API pod.

    We hit ``http://frontend:3000/api/health`` (the docker-compose service
    name). If we're running outside compose, this will fail with a DNS error
    and be reported as ``disabled`` — the UI still shows it, just greyed out.
    """
    url = os.environ.get("STRIX_FRONTEND_HEALTH_URL", "http://frontend:3000/api/health")
    try:
        import httpx
    except ImportError:
        return ProbeResult(
            name="frontend",
            status="disabled",
            latency_ms=None,
            detail="httpx not installed",
        )
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(url)
    except Exception as exc:
        return ProbeResult(
            name="frontend",
            status="disabled",
            latency_ms=(time.perf_counter() - start) * 1000.0,
            detail=f"{type(exc).__name__} — probably running outside docker-compose",
            meta={"url": url},
        )
    elapsed = (time.perf_counter() - start) * 1000.0
    if resp.status_code != 200:
        return ProbeResult(
            name="frontend",
            status="degraded",
            latency_ms=elapsed,
            detail=f"status {resp.status_code}",
            meta={"url": url},
        )
    return ProbeResult(
        name="frontend",
        status="healthy",
        latency_ms=elapsed,
        detail="/api/health OK",
        meta={"url": url},
    )


async def probe_llm() -> ProbeResult:
    """Surface the persisted LLM provider configuration in the health report.

    We intentionally don't make a live completion call here — that would hit
    the provider on every dashboard refresh and cost tokens. Operators can
    verify the provider really works from Settings → Test connection. The
    probe instead reports whether a model and key are on file, so "my scans
    hang in queued" is obvious from the dashboard.
    """
    from strix.api.services.llm_config import get_store

    try:
        cfg = get_store(get_settings().runs_dir).effective()
    except Exception as exc:
        return ProbeResult(
            name="llm_config",
            status="degraded",
            latency_ms=None,
            detail=f"config store error: {exc}",
        )

    if not cfg.model:
        return ProbeResult(
            name="llm_config",
            status="down",
            latency_ms=None,
            detail=(
                "No model configured. Open Settings → LLM provider to pick a "
                "model, or set STRIX_LLM in deploy/.env."
            ),
        )

    needs_key = not (cfg.model.startswith("strix/") or cfg.model.startswith("ollama/"))
    if needs_key and not cfg.api_key:
        return ProbeResult(
            name="llm_config",
            status="degraded",
            latency_ms=None,
            detail=f"{cfg.model} configured but no API key on file",
            meta={"model": cfg.model, "api_base": cfg.api_base or ""},
        )

    return ProbeResult(
        name="llm_config",
        status="healthy",
        latency_ms=None,
        detail=f"{cfg.model}{' via ' + cfg.api_base if cfg.api_base else ''}",
        meta={
            "model": cfg.model,
            "api_base": cfg.api_base or "",
            "api_key_set": bool(cfg.api_key),
            "updated_by": cfg.updated_by or "",
        },
    )


# --- Aggregation -------------------------------------------------------------


async def collect_probes() -> list[ProbeResult]:
    """Run every probe in parallel and return the results in a stable order."""
    probes: list[tuple[str, Callable[[], Awaitable[ProbeResult]]]] = [
        ("postgres", probe_postgres),
        ("redis", probe_redis),
        ("runs_dir", probe_runs_dir),
        ("docker_socket", probe_docker_socket),
        ("clerk", probe_clerk),
        ("frontend", probe_frontend),
        ("llm_config", probe_llm),
    ]
    results = await asyncio.gather(*[_timed(name, fn) for name, fn in probes])
    return list(results)


def overall_status(probes: list[ProbeResult]) -> str:
    """Roll individual probes into a single ``healthy|degraded|down`` label.

    Rules:
    * Any critical-path probe ``down`` (postgres when enabled, redis when
      enabled, runs_dir always) -> ``down``.
    * Any probe ``degraded`` -> ``degraded``.
    * Otherwise ``healthy`` (``disabled`` is not counted).
    """
    critical = {"postgres", "redis", "runs_dir"}
    worst = "healthy"
    for p in probes:
        if p.status == "disabled":
            continue
        if p.status == "down" and p.name in critical:
            return "down"
        if p.status in {"down", "degraded"}:
            worst = "degraded"
    return worst


# --- Secret-aware env var summary -------------------------------------------

_SECRET_PATTERNS = (
    "PASSWORD",
    "SECRET",
    "API_KEY",
    "TOKEN",
    "PRIVATE",
)


def _is_secret(key: str) -> bool:
    upper = key.upper()
    if any(p in upper for p in _SECRET_PATTERNS):
        return True
    if upper in {"STRIX_DATABASE_URL", "STRIX_REDIS_URL"}:
        # These URLs embed credentials in standard usage.
        return True
    return False


def _redact(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 4:
        return "****"
    return value[:2] + "…" + value[-2:]


def env_summary() -> list[dict[str, Any]]:
    """Return a stable, redacted view of the settings-relevant env vars.

    Only the variables we know the app reads are included; everything else
    (HOME, PATH, arbitrary host env) is deliberately excluded so this never
    leaks secrets by accident.
    """
    tracked = [
        "STRIX_ENV",
        "STRIX_LOG_LEVEL",
        "STRIX_ALLOWED_ORIGINS",
        "STRIX_TRUSTED_HOSTS",
        "STRIX_RUNS_DIR",
        "STRIX_DATABASE_URL",
        "STRIX_REDIS_URL",
        "CLERK_ISSUER",
        "CLERK_AUDIENCE",
        "CLERK_JWKS_URL",
        "STRIX_ADMIN_EMAILS",
        "STRIX_API_KEYS",
        "STRIX_API_KEYS_FILE",
        "STRIX_LLM_RPM_DEFAULT",
        "STRIX_LLM_TPM_DEFAULT",
        "STRIX_LLM_CONCURRENCY_DEFAULT",
        "STRIX_API_RPM",
        "STRIX_CHECKPOINT_INTERVAL",
        "LLM_MODEL",
        "LLM_API_KEY",
        "PERPLEXITY_API_KEY",
    ]
    out: list[dict[str, Any]] = []
    for k in tracked:
        raw = os.environ.get(k, "")
        secret = _is_secret(k)
        out.append(
            {
                "key": k,
                "set": bool(raw),
                "secret": secret,
                "value": "" if secret else raw,
                "preview": _redact(raw) if secret and raw else "",
            }
        )
    return out


# --- In-process request metrics ---------------------------------------------


class RequestMetrics:
    """Bounded per-route latency / error counters.

    Each route keeps at most ``window_size`` recent samples. Route keys use
    FastAPI's route template (``request.scope["route"].path``) so
    ``/api/runs/{run_id}`` collapses across run ids and cardinality stays
    bounded.
    """

    def __init__(self, window_size: int = 200) -> None:
        self._window = window_size
        self._samples: dict[tuple[str, str], deque[tuple[float, float, int]]] = {}
        # {(method, path): deque of (timestamp, latency_ms, status)}

    def record(self, method: str, path: str, latency_ms: float, status: int) -> None:
        key = (method.upper(), path)
        dq = self._samples.get(key)
        if dq is None:
            dq = deque(maxlen=self._window)
            self._samples[key] = dq
        dq.append((time.time(), latency_ms, status))

    def snapshot(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for (method, path), dq in self._samples.items():
            if not dq:
                continue
            latencies = [s[1] for s in dq]
            statuses = [s[2] for s in dq]
            count = len(dq)
            errors = sum(1 for s in statuses if s >= 500)
            client_errors = sum(1 for s in statuses if 400 <= s < 500)
            last_ts = dq[-1][0]
            sorted_lat = sorted(latencies)
            p95_index = max(0, int(round(0.95 * (count - 1))))
            out.append(
                {
                    "method": method,
                    "path": path,
                    "count": count,
                    "errors5xx": errors,
                    "errors4xx": client_errors,
                    "errorRate": round((errors / count) if count else 0.0, 4),
                    "latencyMsP50": round(median(latencies), 2),
                    "latencyMsP95": round(sorted_lat[p95_index], 2),
                    "latencyMsAvg": round(sum(latencies) / count, 2),
                    "lastSeenAt": last_ts,
                }
            )
        out.sort(key=lambda r: r["lastSeenAt"], reverse=True)
        return out

    def totals(self) -> dict[str, Any]:
        total = 0
        errors = 0
        client_errors = 0
        last_seen = 0.0
        for dq in self._samples.values():
            for ts, _lat, status in dq:
                total += 1
                if status >= 500:
                    errors += 1
                elif 400 <= status < 500:
                    client_errors += 1
                last_seen = max(last_seen, ts)
        return {
            "total": total,
            "errors5xx": errors,
            "errors4xx": client_errors,
            "errorRate": round((errors / total) if total else 0.0, 4),
            "lastSeenAt": last_seen or None,
        }


_metrics: RequestMetrics | None = None


def get_request_metrics() -> RequestMetrics:
    global _metrics
    if _metrics is None:
        _metrics = RequestMetrics()
    return _metrics


# --- Active subprocess runs --------------------------------------------------


_run_launcher: RunLauncher | None = None


def get_run_launcher() -> RunLauncher:
    """Return a shared ``RunLauncher`` so the dashboard sees live process counts.

    The concrete instance in ``routes/runs.py`` uses its own launcher today;
    we expose this here so the health page can still report launcher status
    even if it hasn't been wired into the run-create path yet.
    """
    global _run_launcher
    if _run_launcher is None:
        _run_launcher = RunLauncher(get_settings().runs_dir)
    return _run_launcher


# --- Endpoint catalogue ------------------------------------------------------


def list_routes(app: Any) -> list[dict[str, str]]:
    """Enumerate all FastAPI routes (method + path + name) for the UI."""
    out: list[dict[str, str]] = []
    for route in getattr(app, "routes", []):
        methods = sorted(getattr(route, "methods", set()) or [])
        path = getattr(route, "path", "")
        name = getattr(route, "name", "")
        if not methods or not path:
            continue
        for m in methods:
            if m in {"HEAD", "OPTIONS"}:
                continue
            out.append({"method": m, "path": path, "name": name})
    out.sort(key=lambda r: (r["path"], r["method"]))
    return out


# --- LLM governor snapshot (re-export for route convenience) ----------------


def llm_governor_snapshot() -> list[dict[str, Any]]:
    return get_default_governor().snapshot()


# --- Hostname (for multi-worker identification) ------------------------------


def hostname() -> str:
    try:
        return socket.gethostname()
    except Exception:
        return ""
