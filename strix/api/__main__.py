"""Run the Strix API via ``python -m strix.api``.

Equivalent to ``uvicorn strix.api.app:app``.
"""

from __future__ import annotations

import os

import uvicorn


def main() -> None:
    host = os.getenv("STRIX_API_HOST", "0.0.0.0")
    port = int(os.getenv("STRIX_API_PORT", "8000"))
    reload_flag = os.getenv("STRIX_API_RELOAD", "false").lower() == "true"
    uvicorn.run(
        "strix.api.app:app",
        host=host,
        port=port,
        reload=reload_flag,
        log_level=os.getenv("STRIX_LOG_LEVEL", "info").lower(),
    )


if __name__ == "__main__":  # pragma: no cover
    main()
