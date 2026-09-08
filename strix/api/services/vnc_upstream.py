"""Resolve the Docker-published noVNC port for a dashboard run."""

from __future__ import annotations

import logging
import os
import socket

from fastapi import HTTPException

from strix.runtime.docker_runtime import CONTAINER_NOVNC_PORT


logger = logging.getLogger(__name__)

_TCP_PROBE_TIMEOUT_SEC = 2.0


def _candidate_hosts() -> list[str]:
    """Hosts to try when reaching host-published sandbox ports from the API container."""

    seen: set[str] = set()
    ordered: list[str] = []

    def add(raw: str) -> None:
        h = raw.strip()
        if not h or h in seen:
            return
        seen.add(h)
        ordered.append(h)

    add(os.getenv("STRIX_SANDBOX_HOST", ""))
    add("host.docker.internal")
    for part in os.getenv("STRIX_SANDBOX_FALLBACK_HOSTS", "").split(","):
        add(part)
    # Typical Docker bridge gateway on Linux when host.docker.internal is missing.
    add("172.17.0.1")
    return ordered


def _tcp_reachable(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=_TCP_PROBE_TIMEOUT_SEC):
            return True
    except OSError:
        return False


def novnc_upstream_host_port(run_id: str) -> tuple[str, int]:
    """Return ``(host, host_port)`` for the sandbox's published noVNC port.

    Containers are named ``strix-scan-{scan_id}`` with ``scan_id == run_id``
    when launched from the dashboard CLI (see ``strix/interface/cli.py``).
    """

    try:
        import docker
    except ImportError as err:  # pragma: no cover
        raise HTTPException(status_code=503, detail="Docker SDK unavailable") from err

    try:
        client = docker.from_env(timeout=15)
    except Exception as exc:
        logger.warning("vnc_upstream: docker.from_env failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Docker daemon not reachable from API (sidechannel proxy disabled)",
        ) from exc

    name = f"strix-scan-{run_id}"
    try:
        container = client.containers.get(name)
    except docker.errors.NotFound:
        matched = client.containers.list(
            all=True,
            filters={"label": f"strix-scan-id={run_id}"},
        )
        if not matched:
            raise HTTPException(
                status_code=404,
                detail="No active sandbox container for this run (noVNC unavailable).",
            ) from None
        container = matched[0]

    ports = (container.attrs.get("NetworkSettings") or {}).get("Ports") or {}
    key = f"{CONTAINER_NOVNC_PORT}/tcp"
    binding = ports.get(key)
    if not binding:
        raise HTTPException(
            status_code=503,
            detail="Sandbox is running but noVNC port is not published on the host.",
        )

    host_port = int(binding[0]["HostPort"])

    candidates = _candidate_hosts()
    for cand in candidates:
        if _tcp_reachable(cand, host_port):
            return cand, host_port

    raise HTTPException(
        status_code=502,
        detail=(
            "Sandbox noVNC is published on the host but unreachable from the API "
            f"container (tried TCP port {host_port} on: {', '.join(candidates)}). "
            "Set STRIX_SANDBOX_HOST (see deploy/docker-compose.yml) or "
            "STRIX_SANDBOX_FALLBACK_HOSTS."
        ),
    )
