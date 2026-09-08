from typing import Any

from strix.tools.registry import register_tool


@register_tool(sandbox_execution=True)
def spawn_shell(
    name: str = "default",
    cwd: str | None = None,
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Create (or reuse) a persistent shell session and return its metadata."""
    from strix.tools.terminal.terminal_manager import get_terminal_manager

    manager = get_terminal_manager()
    shell_id = (name or "default").strip() or "default"
    # Current terminal backend does not support per-shell cwd/env overrides yet;
    # keep them in the response so call sites can degrade gracefully.
    manager._get_or_create_session(shell_id)
    snap = manager.list_sessions().get("sessions", {}).get(shell_id, {})
    return {
        "shell_id": shell_id,
        "created": True,
        "requested_cwd": cwd,
        "requested_env": env or {},
        "working_dir": snap.get("working_dir"),
        "is_running": snap.get("is_running", True),
    }


@register_tool(sandbox_execution=True)
def write_shell(shell_id: str, input: str, no_enter: bool = False) -> dict[str, Any]:
    """Send text/input to an existing shell."""
    from strix.tools.terminal.terminal_manager import get_terminal_manager

    manager = get_terminal_manager()
    return manager.execute_command(
        command=input,
        is_input=True,
        timeout=30.0,
        terminal_id=shell_id,
        no_enter=no_enter,
    )


@register_tool(sandbox_execution=True)
def read_shell(shell_id: str, timeout: float = 0.2) -> dict[str, Any]:
    """Read the current shell output (non-destructive)."""
    from strix.tools.terminal.terminal_manager import get_terminal_manager

    manager = get_terminal_manager()
    return manager.execute_command(
        command="",
        is_input=False,
        timeout=timeout,
        terminal_id=shell_id,
        no_enter=False,
    )


@register_tool(sandbox_execution=True)
def list_shells() -> dict[str, Any]:
    """List persistent shell sessions for the current agent context."""
    from strix.tools.terminal.terminal_manager import get_terminal_manager

    return get_terminal_manager().list_sessions()


@register_tool(sandbox_execution=True)
def close_shell(shell_id: str) -> dict[str, Any]:
    """Close and dispose a shell session."""
    from strix.tools.terminal.terminal_manager import get_terminal_manager

    return get_terminal_manager().close_session(shell_id)
