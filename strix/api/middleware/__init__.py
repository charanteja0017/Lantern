"""Cross-cutting ASGI middleware for the Strix Dashboard API."""

from strix.api.middleware.metrics import RequestMetricsMiddleware


__all__ = ["RequestMetricsMiddleware"]
