from __future__ import annotations

import argparse
import json
from collections.abc import Iterator

from fastapi import FastAPI
from fastapi.responses import StreamingResponse


def _stdio_loop() -> None:
    while True:
        try:
            line = input()
        except EOFError:
            return
        if not line.strip():
            continue
        try:
            req = json.loads(line)
        except Exception:
            print(json.dumps({"error": "invalid_json"}))
            continue
        print(json.dumps({"id": req.get("id"), "result": {"server": "novahunter-mcp", "ok": True}}))


def _sse_events() -> Iterator[str]:
    yield 'event: ready\ndata: {"server":"novahunter-mcp"}\n\n'


def build_app() -> FastAPI:
    app = FastAPI(title="NovaHunter MCP")

    @app.get("/mcp/sse")
    async def mcp_sse() -> StreamingResponse:
        return StreamingResponse(_sse_events(), media_type="text/event-stream")

    return app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--transport", choices=["stdio", "sse"], default="stdio")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.transport == "stdio":
        _stdio_loop()
        return
    import uvicorn

    uvicorn.run(build_app(), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
