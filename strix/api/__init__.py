"""Strix web-dashboard API.

FastAPI application that exposes the existing Strix runtime over HTTP so the
Next.js dashboard (``frontend/``) can replicate full CLI parity. Existing CLI
workflow (``strix/interface/main.py``) remains untouched; this package is a
new, additive surface.
"""

# NOTE — ``__version__`` MUST be defined *before* ``from .app import create_app``.
# The app factory transitively imports ``strix.api.routes.system``, which does
# ``from strix.api import __version__``. If that attribute isn't bound yet,
# Python raises ``ImportError: cannot import name '__version__' from partially
# initialized module`` and uvicorn's workers die before they can bind :8000.
__version__ = "0.1.0"

from .app import create_app


__all__ = ["__version__", "create_app"]
