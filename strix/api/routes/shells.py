from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from strix.api.services.auth import Principal, require_analyst, require_any_member
from strix.api.services.run_store import RunStore
from strix.api.settings import get_settings
from strix.tools.terminal.terminal_manager import TerminalManager, get_terminal_manager


router = APIRouter(prefix="/api/runs/{run_id}/shells", tags=["shells"])
listeners_router = APIRouter(prefix="/api/runs/{run_id}/listeners", tags=["listeners"])


def _ensure_run_exists(run_id: str) -> None:
    if RunStore(get_settings().runs_dir).get(run_id) is None:
        raise HTTPException(status_code=404, detail="Run not found")


def _terminal_manager_or_503() -> TerminalManager:
    try:
        return get_terminal_manager()
    except Exception as exc:  # pragma: no cover - runtime dependency guard
        raise HTTPException(
            status_code=503,
            detail=f"Terminal backend unavailable: {exc}",
        ) from exc


@router.get("")
async def list_shells(
    run_id: str,
    _: Principal = Depends(require_any_member),
) -> dict[str, Any]:
    _ensure_run_exists(run_id)
    return _terminal_manager_or_503().list_sessions()


@router.post("")
async def spawn_shell(
    run_id: str,
    body: dict[str, Any] | None = None,
    _: Principal = Depends(require_analyst),
) -> dict[str, Any]:
    _ensure_run_exists(run_id)
    shell_id = str((body or {}).get("name") or "default")
    manager = _terminal_manager_or_503()
    try:
        manager._get_or_create_session(shell_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    snap = manager.list_sessions().get("sessions", {}).get(shell_id, {})
    return {
        "shell_id": shell_id,
        "created": True,
        "working_dir": snap.get("working_dir"),
        "is_running": snap.get("is_running", True),
    }


@router.post("/{shell_id}/write")
async def write_shell(
    run_id: str,
    shell_id: str,
    body: dict[str, Any] | None = None,
    _: Principal = Depends(require_analyst),
) -> dict[str, Any]:
    _ensure_run_exists(run_id)
    data = body or {}
    manager = _terminal_manager_or_503()
    return manager.execute_command(
        command=str(data.get("input") or ""),
        is_input=True,
        timeout=float(data.get("timeout") or 30.0),
        terminal_id=shell_id,
        no_enter=bool(data.get("no_enter", False)),
    )


@router.get("/{shell_id}/read")
async def read_shell(
    run_id: str,
    shell_id: str,
    timeout: float = 0.2,
    _: Principal = Depends(require_any_member),
) -> dict[str, Any]:
    _ensure_run_exists(run_id)
    manager = _terminal_manager_or_503()
    return manager.execute_command(
        command="",
        is_input=False,
        timeout=timeout,
        terminal_id=shell_id,
        no_enter=False,
    )


@router.delete("/{shell_id}")
async def close_shell(
    run_id: str,
    shell_id: str,
    _: Principal = Depends(require_analyst),
) -> dict[str, Any]:
    _ensure_run_exists(run_id)
    return _terminal_manager_or_503().close_session(shell_id)


@listeners_router.get("")
async def list_listeners(
    run_id: str,
    _: Principal = Depends(require_any_member),
) -> dict[str, Any]:
    _ensure_run_exists(run_id)
    from strix.tools.netcat.netcat_actions import netcat_listeners

    return dict(netcat_listeners())


@listeners_router.post("")
async def create_listener(
    run_id: str,
    body: dict[str, Any] | None = None,
    _: Principal = Depends(require_analyst),
) -> dict[str, Any]:
    _ensure_run_exists(run_id)
    from strix.tools.netcat.netcat_actions import netcat_listen

    data = body or {}
    port = data.get("port")
    return dict(netcat_listen(int(port) if port is not None else None))


@listeners_router.get("/{listener_id}/read")
async def read_listener(
    run_id: str,
    listener_id: str,
    timeout: float = 0.2,
    _: Principal = Depends(require_any_member),
) -> dict[str, Any]:
    _ensure_run_exists(run_id)
    from strix.tools.netcat.netcat_actions import netcat_read

    return dict(netcat_read(listener_id=listener_id, timeout=timeout))


@listeners_router.post("/{listener_id}/send")
async def send_listener(
    run_id: str,
    listener_id: str,
    body: dict[str, Any] | None = None,
    _: Principal = Depends(require_analyst),
) -> dict[str, Any]:
    _ensure_run_exists(run_id)
    from strix.tools.netcat.netcat_actions import netcat_send

    data = body or {}
    return dict(netcat_send(listener_id=listener_id, data=str(data.get("data") or "")))


@listeners_router.delete("/{listener_id}")
async def close_listener(
    run_id: str,
    listener_id: str,
    _: Principal = Depends(require_analyst),
) -> dict[str, Any]:
    _ensure_run_exists(run_id)
    from strix.tools.netcat.netcat_actions import netcat_close

    return dict(netcat_close(listener_id=listener_id))


ws_router = APIRouter(tags=["shells-ws"])


@ws_router.websocket("/ws/runs/{run_id}/shells/{shell_id}")
async def shell_ws(run_id: str, shell_id: str, websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        _ensure_run_exists(run_id)
    except HTTPException:
        await websocket.send_json({"type": "error", "error": "run_not_found"})
        await websocket.close(code=4404)
        return
    manager = _terminal_manager_or_503()
    try:
        manager._get_or_create_session(shell_id)
    except RuntimeError as exc:
        await websocket.send_json({"type": "error", "error": str(exc)})
        await websocket.close(code=4503)
        return
    await websocket.send_json({"type": "ready", "shell_id": shell_id})
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                msg = {"type": "input", "input": raw}
            if msg.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            if msg.get("type") == "read":
                out = manager.execute_command(
                    command="",
                    is_input=False,
                    timeout=float(msg.get("timeout") or 0.2),
                    terminal_id=shell_id,
                    no_enter=False,
                )
                await websocket.send_json({"type": "output", "payload": out})
                continue
            out = manager.execute_command(
                command=str(msg.get("input") or ""),
                is_input=bool(msg.get("is_input", True)),
                timeout=float(msg.get("timeout") or 30.0),
                terminal_id=shell_id,
                no_enter=bool(msg.get("no_enter", False)),
            )
            await websocket.send_json({"type": "output", "payload": out})
    except WebSocketDisconnect:
        return
