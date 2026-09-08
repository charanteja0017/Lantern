"""Request-metrics middleware.

Records one sample per HTTP request into the process-local
:class:`~strix.api.services.system_health.RequestMetrics` buffer, keyed by
the matched route template so cardinality is bounded (``/api/runs/{run_id}``
collapses across run ids).

Kept in its own module so the app factory can attach it with a one-liner.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from strix.api.services.system_health import get_request_metrics


class RequestMetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        start = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        except Exception:
            status_code = 500
            raise
        finally:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            # Prefer the matched route template so dynamic segments collapse.
            path = _route_template(request) or request.url.path
            method = request.method or "GET"
            try:
                get_request_metrics().record(method, path, elapsed_ms, status_code)
            except Exception:
                pass


def _route_template(request: Request) -> str:
    # Starlette populates ``request.scope["route"]`` once a match is resolved.
    route: Any = request.scope.get("route")
    if route is None:
        return ""
    return str(getattr(route, "path", "") or "")
