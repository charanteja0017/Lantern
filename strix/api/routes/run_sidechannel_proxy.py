"""HTTP + WebSocket proxy for sandbox noVNC under ``/api/runs/{run_id}/vnc/``.

Dashboard iframes load this path so reverse proxies that send only ``/api/*`` to
FastAPI (``deploy/Caddyfile`` ``@api``) always reach the handler. Older minted
URLs under ``/runs/{run_id}/vnc/*`` redirect here with the query string intact.

Errors (sandbox not running, token expired, run not found) are rendered as
iframe-friendly HTML pages with ``X-Frame-Options`` removed so the dashboard
shows a useful message instead of a blocked blank frame.
"""

from __future__ import annotations

import asyncio
import html
import logging
from typing import TYPE_CHECKING
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx
from fastapi import APIRouter, HTTPException, Request, WebSocket
from starlette.responses import HTMLResponse, RedirectResponse, Response, StreamingResponse
from starlette.websockets import WebSocketDisconnect

from strix.api.services.sidechannel_tokens import (
    SidechannelTokenError,
    http_error_from_token_error,
    verify_sidechannel_token,
)
from strix.api.services.vnc_upstream import novnc_upstream_host_port


if TYPE_CHECKING:
    from collections.abc import AsyncIterator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/runs/{run_id}", tags=["sidechannel-proxy"])
legacy_vnc_router = APIRouter(tags=["sidechannel-proxy"])

_VNC_COOKIE_TTL = 60 * 15
_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}

# Headers we ALWAYS set on responses so the iframe renders. The reverse proxy
# (Caddy) is supposed to strip ``X-Frame-Options`` for VNC paths, but we set
# explicit allow-embed headers here as defense-in-depth — otherwise a plain
# 4xx/5xx leaks the global DENY and Chrome blocks the frame.
_IFRAME_ALLOW_HEADERS = {
    # ``ALLOWALL`` is non-standard but ignored by browsers, leaving the frame
    # allowed by default. We rely on Content-Security-Policy below for the
    # actual ancestor restriction.
    "X-Frame-Options": "ALLOWALL",
    "Content-Security-Policy": "frame-ancestors *",
}


def _apply_iframe_headers[ResponseT: Response](response: ResponseT) -> ResponseT:
    """Attach allow-embed headers and drop any inherited DENY."""

    for key, value in _IFRAME_ALLOW_HEADERS.items():
        response.headers[key] = value
    return response


def _render_vnc_error(
    *,
    status_code: int,
    title: str,
    message: str,
    hint: str | None = None,
) -> HTMLResponse:
    """Render an iframe-friendly status page for VNC failures.

    The dashboard iframe loads this path directly. Returning JSON would either
    show as raw text or be blocked by ``X-Frame-Options``. An HTML page with
    an explicit overlay tells the operator what's wrong (sandbox down, token
    expired, run finished) and works inside the embed.
    """

    safe_title = html.escape(title)
    safe_message = html.escape(message)
    safe_hint = html.escape(hint) if hint else ""
    body = f"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />
  <title>{safe_title} — Live browser</title>
  <style>
    html,body {{ height:100%; margin:0; }}
    body {{
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: #0b0f14; color: #e2e8f0;
      display:flex; align-items:center; justify-content:center;
    }}
    .card {{
      max-width: 560px; padding: 24px 28px;
      background: rgba(30,41,59,0.6);
      border: 1px solid rgba(148,163,184,0.18);
      border-radius: 10px;
    }}
    h1 {{ margin: 0 0 8px; font-size: 16px; color: #f59e0b; }}
    p  {{ margin: 0 0 12px; line-height: 1.5; font-size: 13px; color: #cbd5e1; }}
    .hint {{ color: #94a3b8; font-size: 12px; }}
    button {{
      margin-top: 8px; padding: 6px 12px; cursor:pointer;
      background:#1e293b; color:#e2e8f0;
      border:1px solid rgba(148,163,184,0.3); border-radius:6px;
      font-size: 12px;
    }}
    button:hover {{ background:#334155; }}
  </style>
</head>
<body>
  <div class=\"card\">
    <h1>{safe_title}</h1>
    <p>{safe_message}</p>
    {f'<p class="hint">{safe_hint}</p>' if safe_hint else ""}
    <button onclick=\"location.reload()\">Retry</button>
  </div>
</body>
</html>"""
    response = HTMLResponse(content=body, status_code=status_code)
    return _apply_iframe_headers(response)


def _diagnose_no_sandbox(run_id: str) -> tuple[str, str]:
    """Read the run's events to explain why the sandbox container is missing.

    Returns ``(title, message)`` tailored to the run's actual state — terminal
    runs say "scan finished, sandbox torn down", in-flight runs say "starting
    up", failed runs surface the underlying error from runner.log.
    """

    try:
        from strix.api.services.run_store import RunStore
        from strix.api.settings import get_settings

        run = RunStore(get_settings().runs_dir).get(run_id)
    except Exception:
        run = None

    if run is None:
        return (
            "Live browser not available",
            "Run metadata is not on disk yet. The scan may still be initializing.",
        )

    status = (getattr(run, "status", "") or "").lower()
    if status == "failed":
        # Surface the operator-facing failure reason if the launcher captured one.
        failure_msg = ""
        for ev in getattr(run, "events", []) or []:
            if getattr(ev, "type", "") == "run.failed" and getattr(ev, "message", None):
                failure_msg = str(ev.message)
                break
        body = (
            "The scan failed before — or while — the sandbox came up, so there "
            "is no live browser to attach to."
        )
        if failure_msg:
            body += f"\n\nFailure reason: {failure_msg.strip().splitlines()[0][:300]}"
        return ("Run failed — no sandbox to view", body)

    if status in {"completed", "stopped"}:
        return (
            "Scan finished — sandbox torn down",
            "The agent's sandbox container is destroyed when the run ends. "
            "Restart the run to spawn a fresh sandbox with a new live browser session.",
        )

    if status == "queued":
        return (
            "Sandbox starting up",
            "The run is queued but the sandbox container hasn't been launched yet. "
            "This usually takes a few seconds — try Refresh.",
        )

    if status in {"running", "throttled", "paused"}:
        return (
            "Sandbox not yet attached",
            "The scan is running but the API can't see a sandbox container for it. "
            "Common causes: the sandbox image is still pulling on first run, the "
            "Docker socket isn't reachable from the API container, or the agent "
            "hasn't reached a step that needs the browser yet. Check "
            "`docker ps | grep strix-scan-` on the host.",
        )

    return (
        "Live browser not available",
        f"Run status is '{status or 'unknown'}' and no sandbox container is bound to it.",
    )


def _error_for_status(status_code: int, detail: str, *, run_id: str | None = None) -> HTMLResponse:
    """Map a backend status/detail to a friendly iframe page."""

    if status_code == 401:
        return _render_vnc_error(
            status_code=401,
            title="Live browser session expired",
            message="The signed link for this run is no longer valid.",
            hint="Reload the run page to mint a fresh token.",
        )
    if status_code == 403:
        return _render_vnc_error(
            status_code=403,
            title="Live browser access denied",
            message="Your session does not have permission to view this run's browser.",
            hint=detail,
        )
    if status_code == 404:
        if run_id:
            title, message = _diagnose_no_sandbox(run_id)
            return _render_vnc_error(
                status_code=404,
                title=title,
                message=message,
                hint=detail,
            )
        return _render_vnc_error(
            status_code=404,
            title="Live browser not available",
            message=(
                "The sandbox container for this run is not running. The live "
                "browser is only available while the agent is actively scanning."
            ),
            hint=detail,
        )
    if status_code == 502:
        return _render_vnc_error(
            status_code=502,
            title="Sandbox unreachable",
            message=(
                "The API container could not reach the sandbox's noVNC port. "
                "On Linux hosts this is usually fixed by setting "
                "STRIX_SANDBOX_HOST to the Docker bridge gateway "
                "(e.g. 172.17.0.1) in deploy/.env, then `docker compose restart api`."
            ),
            hint=detail,
        )
    if status_code == 503:
        return _render_vnc_error(
            status_code=503,
            title="Live browser warming up",
            message=(
                "The sandbox is starting but noVNC isn't ready yet. If this "
                "persists, the sandbox image may be missing — check that "
                "STRIX_IMAGE in deploy/.env points at a pulled image."
            ),
            hint=detail or "Retry in a few seconds.",
        )
    return _render_vnc_error(
        status_code=status_code or 500,
        title="Live browser error",
        message=detail or "Unexpected error rendering the live browser.",
    )


def _public_vnc_prefix(run_id: str) -> str:
    return f"/api/runs/{run_id}/vnc"


def _vnc_cookie_path(run_id: str) -> str:
    return _public_vnc_prefix(run_id)


def _vnc_cookie_name(run_id: str) -> str:
    import hashlib

    return "strix_sc_" + hashlib.sha256(run_id.encode("utf-8")).hexdigest()[:18]


def _auth_token(request: Request, *, run_id: str) -> str | None:
    qp = request.query_params.get("token")
    if qp:
        return qp
    return request.cookies.get(_vnc_cookie_name(run_id))


def _strip_token_query(query: str) -> str:
    if not query:
        return ""
    pairs = [(k, v) for k, v in parse_qsl(query, keep_blank_values=True) if k != "token"]
    return urlencode(pairs)


async def _ensure_run_exists(run_id: str) -> None:
    from strix.api.services.run_store import RunStore
    from strix.api.settings import get_settings

    if RunStore(get_settings().runs_dir).get(run_id) is None:
        raise HTTPException(status_code=404, detail="Run not found")


def _filter_client_headers(request: Request) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in request.headers.items():
        lk = key.lower()
        if lk in _HOP_BY_HOP | {"host", "content-length", "cookie"}:
            continue
        out[key] = value
    return out


def _rewrite_redirect_location(
    location: str | None,
    *,
    run_id: str,
    upstream_host: str,
    upstream_port: int,
) -> str:
    """Maps websockify/noVNC redirects onto our proxied mount path."""

    prefix = _public_vnc_prefix(run_id)
    loc = (location or "").strip()
    if not loc:
        return f"{prefix}/"

    parsed = urlparse(loc)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        phost = (parsed.hostname or "").lower()
        default = 443 if parsed.scheme == "https" else 80
        pport = parsed.port or default
        uh = upstream_host.lower()
        upstream_match = phost == uh and pport == upstream_port
        loopback_match = (
            phost in {"127.0.0.1", "localhost", "::1", "0.0.0.0"} and pport == upstream_port
        )
        if upstream_match or loopback_match:
            path = parsed.path or "/"
            query = ("?" + parsed.query) if parsed.query else ""
            fragment = ("#" + parsed.fragment) if parsed.fragment else ""
            return f"{prefix}{path}{query}{fragment}"
        return loc

    if loc.startswith("/"):
        return f"{prefix}{loc}"
    return f"{prefix}/{loc}"


def _filter_upstream_response_headers(
    headers: httpx.Headers,
    *,
    drop_location: bool = False,
) -> dict[str, str]:
    blocked = _HOP_BY_HOP | {"content-length"}
    out: dict[str, str] = {}
    for key, value in headers.multi_items():
        lk = key.lower()
        if lk in blocked:
            continue
        if lk == "x-frame-options":
            continue
        if drop_location and lk == "location":
            continue
        out[key] = value
    return out


@router.api_route("/vnc", methods=["GET", "HEAD", "POST", "OPTIONS"])
async def vnc_redirect_slash(run_id: str, request: Request) -> Response:
    try:
        await _ensure_run_exists(run_id)
    except HTTPException as exc:
        return _error_for_status(exc.status_code, str(exc.detail), run_id=run_id)
    dest_q = request.url.query
    location = f"{_public_vnc_prefix(run_id)}/"
    if dest_q:
        location = f"{location}?{dest_q}"
    return _apply_iframe_headers(RedirectResponse(url=location, status_code=307))


@router.api_route("/vnc/{path:path}", methods=["GET", "HEAD", "POST", "OPTIONS"])
async def http_proxy_vnc(run_id: str, request: Request, path: str = "") -> Response:
    try:
        await _ensure_run_exists(run_id)
    except HTTPException as exc:
        return _error_for_status(exc.status_code, str(exc.detail), run_id=run_id)

    raw_token = _auth_token(request, run_id=run_id)
    try:
        verify_sidechannel_token(raw_token, run_id=run_id, aud="vnc")
    except SidechannelTokenError as exc:
        http_exc = http_error_from_token_error(exc)
        return _error_for_status(http_exc.status_code, str(http_exc.detail))

    try:
        host, port = await asyncio.to_thread(novnc_upstream_host_port, run_id)
    except HTTPException as exc:
        return _error_for_status(exc.status_code, str(exc.detail), run_id=run_id)

    upstream_path = path.lstrip("/") if path else ""
    cleaned_query = _strip_token_query(request.url.query)
    parts = ("http", f"{host}:{port}", "/" + upstream_path, "", cleaned_query, "")
    upstream_url = urlunparse(parts)

    fwd_headers = _filter_client_headers(request)
    fwd_headers["Host"] = f"{host}:{port}"

    body = await request.body() if request.method == "POST" else None

    token_qp = request.query_params.get("token")

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0), trust_env=False) as client:
            req = client.build_request(
                request.method,
                upstream_url,
                headers=fwd_headers,
                content=body if body else None,
            )
            resp = await client.send(req, stream=True, follow_redirects=False)
    except httpx.RequestError as exc:
        logger.warning("vnc proxy upstream error run=%s url=%s err=%s", run_id, upstream_url, exc)
        return _error_for_status(
            502,
            "Could not reach sandbox noVNC (upstream connection failed).",
        )

    if resp.status_code in _REDIRECT_STATUSES:
        raw_loc = resp.headers.get("location")
        await resp.aclose()
        hop_headers = _filter_upstream_response_headers(resp.headers, drop_location=True)
        hop_headers["Location"] = _rewrite_redirect_location(
            raw_loc,
            run_id=run_id,
            upstream_host=host,
            upstream_port=port,
        )
        redir = Response(status_code=resp.status_code, headers=hop_headers)
        _apply_iframe_headers(redir)
        if token_qp:
            redir.set_cookie(
                key=_vnc_cookie_name(run_id),
                value=token_qp,
                max_age=_VNC_COOKIE_TTL,
                httponly=True,
                samesite="lax",
                path=_vnc_cookie_path(run_id),
                secure=False,
            )
        return redir

    hop_headers = _filter_upstream_response_headers(resp.headers)

    async def stream_body() -> AsyncIterator[bytes]:
        try:
            async for chunk in resp.aiter_bytes():
                yield chunk
        finally:
            await resp.aclose()

    out = StreamingResponse(stream_body(), status_code=resp.status_code, headers=hop_headers)
    _apply_iframe_headers(out)
    if token_qp:
        out.set_cookie(
            key=_vnc_cookie_name(run_id),
            value=token_qp,
            max_age=_VNC_COOKIE_TTL,
            httponly=True,
            samesite="lax",
            path=_vnc_cookie_path(run_id),
            secure=False,
        )
    return out


async def _websocket_proxy_vnc_impl(websocket: WebSocket, run_id: str, path: str) -> None:
    await _ensure_run_exists(run_id)
    tok = websocket.query_params.get("token") or websocket.cookies.get(_vnc_cookie_name(run_id))
    try:
        verify_sidechannel_token(tok, run_id=run_id, aud="vnc")
    except SidechannelTokenError:
        await websocket.close(code=4401)
        return

    host, port = await asyncio.to_thread(novnc_upstream_host_port, run_id)
    rel = path.lstrip("/") if path else ""
    qp_pairs = [(k, v) for k, v in websocket.query_params.multi_items() if k != "token"]
    qs = urlencode(qp_pairs)
    upstream_http = urlunparse(("http", f"{host}:{port}", "/" + rel, "", qs, ""))
    upstream_ws = upstream_http.replace("http://", "ws://", 1)

    try:
        import websockets
    except ImportError:
        logger.exception("websockets package missing — cannot proxy VNC websocket")
        await websocket.close(code=4500)
        return

    await websocket.accept()

    try:
        async with websockets.connect(upstream_ws, max_size=None, ping_interval=None) as upstream:

            async def client_to_upstream() -> None:
                try:
                    while True:
                        msg = await websocket.receive()
                        mtype = msg.get("type")
                        if mtype == "websocket.disconnect":
                            break
                        if mtype != "websocket.receive":
                            continue
                        data = msg.get("bytes")
                        if data is not None:
                            await upstream.send(data)
                            continue
                        text = msg.get("text")
                        if text is not None:
                            await upstream.send(text)
                except WebSocketDisconnect:
                    return
                except Exception:
                    return

            async def upstream_to_client() -> None:
                try:
                    async for message in upstream:
                        if isinstance(message, bytes):
                            await websocket.send_bytes(message)
                        else:
                            await websocket.send_text(message)
                except Exception:
                    return

            client_task = asyncio.create_task(client_to_upstream())
            upstream_task = asyncio.create_task(upstream_to_client())
            _, pending = await asyncio.wait(
                {client_task, upstream_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for p in pending:
                p.cancel()
    except Exception as exc:
        logger.warning("vnc websocket proxy failed run=%s err=%s", run_id, exc)
        await websocket.close(code=4500)


@router.websocket("/vnc/{path:path}")
async def websocket_proxy_vnc(run_id: str, path: str, websocket: WebSocket) -> None:
    await _websocket_proxy_vnc_impl(websocket, run_id, path)


@legacy_vnc_router.api_route("/runs/{run_id}/vnc", methods=["GET", "HEAD", "POST", "OPTIONS"])
async def legacy_vnc_redirect_slash(run_id: str, request: Request) -> Response:
    """307 → canonical ``/api/runs/{run_id}/vnc/`` (preserves ``token`` query)."""

    try:
        await _ensure_run_exists(run_id)
    except HTTPException as exc:
        return _error_for_status(exc.status_code, str(exc.detail), run_id=run_id)
    dest_q = request.url.query
    location = f"{_public_vnc_prefix(run_id)}/"
    if dest_q:
        location = f"{location}?{dest_q}"
    return _apply_iframe_headers(RedirectResponse(url=location, status_code=307))


@legacy_vnc_router.api_route(
    "/runs/{run_id}/vnc/{path:path}", methods=["GET", "HEAD", "POST", "OPTIONS"]
)
async def legacy_vnc_redirect_deep(run_id: str, path: str, request: Request) -> Response:
    try:
        await _ensure_run_exists(run_id)
    except HTTPException as exc:
        return _error_for_status(exc.status_code, str(exc.detail), run_id=run_id)
    dest_q = request.url.query
    tail = path.lstrip("/")
    location = f"{_public_vnc_prefix(run_id)}/"
    if tail:
        location = f"{_public_vnc_prefix(run_id)}/{tail}"
    if dest_q:
        location = f"{location}?{dest_q}"
    return _apply_iframe_headers(RedirectResponse(url=location, status_code=307))


@legacy_vnc_router.websocket("/runs/{run_id}/vnc/{path:path}")
async def legacy_websocket_proxy_vnc(run_id: str, path: str, websocket: WebSocket) -> None:
    await _websocket_proxy_vnc_impl(websocket, run_id, path)
