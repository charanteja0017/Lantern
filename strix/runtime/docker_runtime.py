import contextlib
import os
import secrets
import socket
import time
from pathlib import Path
from typing import cast

import docker
import httpx
from docker.errors import DockerException, ImageNotFound, NotFound
from docker.models.containers import Container
from requests.exceptions import ConnectionError as RequestsConnectionError
from requests.exceptions import Timeout as RequestsTimeout

from strix.config import Config

from . import SandboxInitializationError
from .runtime import AbstractRuntime, SandboxInfo


HOST_GATEWAY_HOSTNAME = "host.docker.internal"
DOCKER_TIMEOUT = 60
CONTAINER_TOOL_SERVER_PORT = 48081
CONTAINER_CAIDO_PORT = 48080
CONTAINER_NOVNC_PORT = 6901
CONTAINER_SHELLINABOX_PORT = 4200
CONTAINER_BURP_PROXY_PORT = 8080
CONTAINER_BURP_API_PORT = 9090
CONTAINER_OVPN_MGMT_PORT = 7505
CONTAINER_NETCAT_MGR_PORT = 48082


class DockerRuntime(AbstractRuntime):
    def __init__(self) -> None:
        try:
            self.client = docker.from_env(timeout=DOCKER_TIMEOUT)
        except (DockerException, RequestsConnectionError, RequestsTimeout) as e:
            raise SandboxInitializationError(
                "Docker is not available",
                "Please ensure Docker Desktop is installed and running.",
            ) from e

        self._scan_container: Container | None = None
        self._tool_server_port: int | None = None
        self._tool_server_token: str | None = None
        self._caido_port: int | None = None
        self._novnc_port: int | None = None
        self._shellinabox_port: int | None = None
        self._burp_proxy_port: int | None = None
        self._burp_api_port: int | None = None
        self._ovpn_mgmt_port: int | None = None
        self._netcat_mgr_port: int | None = None

    def _find_available_port(self) -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("", 0))
            return cast("int", s.getsockname()[1])

    def _get_scan_id(self, agent_id: str) -> str:
        try:
            from strix.telemetry.tracer import get_global_tracer

            tracer = get_global_tracer()
            if tracer and tracer.scan_config:
                return str(tracer.scan_config.get("scan_id", "default-scan"))
        except (ImportError, AttributeError):
            pass
        return f"scan-{agent_id.split('-', maxsplit=1)[0]}"

    def _verify_image_available(self, image_name: str, max_retries: int = 3) -> None:
        for attempt in range(max_retries):
            try:
                image = self.client.images.get(image_name)
                if not image.id or not image.attrs:
                    raise ImageNotFound(f"Image {image_name} metadata incomplete")  # noqa: TRY301
            except (ImageNotFound, DockerException):
                if attempt == max_retries - 1:
                    raise
                time.sleep(2**attempt)
            else:
                return

    def _recover_container_state(self, container: Container) -> None:
        for env_var in container.attrs["Config"]["Env"]:
            if env_var.startswith("TOOL_SERVER_TOKEN="):
                self._tool_server_token = env_var.split("=", 1)[1]
                break

        port_bindings = container.attrs.get("NetworkSettings", {}).get("Ports", {})
        port_key = f"{CONTAINER_TOOL_SERVER_PORT}/tcp"
        if port_bindings.get(port_key):
            self._tool_server_port = int(port_bindings[port_key][0]["HostPort"])

        caido_port_key = f"{CONTAINER_CAIDO_PORT}/tcp"
        if port_bindings.get(caido_port_key):
            self._caido_port = int(port_bindings[caido_port_key][0]["HostPort"])
        for cport, attr in (
            (CONTAINER_NOVNC_PORT, "_novnc_port"),
            (CONTAINER_SHELLINABOX_PORT, "_shellinabox_port"),
            (CONTAINER_BURP_PROXY_PORT, "_burp_proxy_port"),
            (CONTAINER_BURP_API_PORT, "_burp_api_port"),
            (CONTAINER_OVPN_MGMT_PORT, "_ovpn_mgmt_port"),
            (CONTAINER_NETCAT_MGR_PORT, "_netcat_mgr_port"),
        ):
            key = f"{cport}/tcp"
            if port_bindings.get(key):
                setattr(self, attr, int(port_bindings[key][0]["HostPort"]))

    def _wait_for_tool_server(self, max_retries: int = 30, timeout: int = 5) -> None:
        host = self._resolve_docker_host()
        health_url = f"http://{host}:{self._tool_server_port}/health"

        time.sleep(5)

        for attempt in range(max_retries):
            try:
                with httpx.Client(trust_env=False, timeout=timeout) as client:
                    response = client.get(health_url)
                    if response.status_code == 200:
                        data = response.json()
                        if data.get("status") == "healthy":
                            return
            except (httpx.ConnectError, httpx.TimeoutException, httpx.RequestError):
                pass

            time.sleep(min(2**attempt * 0.5, 5))

        raise SandboxInitializationError(
            "Tool server failed to start",
            "Container initialization timed out. Please try again.",
        )

    def _create_container(self, scan_id: str, max_retries: int = 2) -> Container:
        container_name = f"strix-scan-{scan_id}"
        image_name = Config.get("strix_image")
        if not image_name:
            raise ValueError("STRIX_IMAGE must be configured")

        self._verify_image_available(image_name)

        last_error: Exception | None = None
        for attempt in range(max_retries + 1):
            try:
                with contextlib.suppress(NotFound):
                    existing = self.client.containers.get(container_name)
                    with contextlib.suppress(Exception):
                        existing.stop(timeout=5)
                    existing.remove(force=True)
                    time.sleep(1)

                self._tool_server_port = self._find_available_port()
                self._caido_port = self._find_available_port()
                self._novnc_port = self._find_available_port()
                self._shellinabox_port = self._find_available_port()
                self._burp_proxy_port = self._find_available_port()
                self._burp_api_port = self._find_available_port()
                self._ovpn_mgmt_port = self._find_available_port()
                self._netcat_mgr_port = self._find_available_port()
                self._tool_server_token = secrets.token_urlsafe(32)
                execution_timeout = Config.get("strix_sandbox_execution_timeout") or "120"

                container = self.client.containers.run(
                    image_name,
                    command="sleep infinity",
                    detach=True,
                    name=container_name,
                    hostname=container_name,
                    ports={
                        f"{CONTAINER_TOOL_SERVER_PORT}/tcp": self._tool_server_port,
                        f"{CONTAINER_CAIDO_PORT}/tcp": self._caido_port,
                        f"{CONTAINER_NOVNC_PORT}/tcp": self._novnc_port,
                        f"{CONTAINER_SHELLINABOX_PORT}/tcp": self._shellinabox_port,
                        f"{CONTAINER_BURP_PROXY_PORT}/tcp": self._burp_proxy_port,
                        f"{CONTAINER_BURP_API_PORT}/tcp": self._burp_api_port,
                        f"{CONTAINER_OVPN_MGMT_PORT}/tcp": self._ovpn_mgmt_port,
                        f"{CONTAINER_NETCAT_MGR_PORT}/tcp": self._netcat_mgr_port,
                    },
                    cap_add=["NET_ADMIN", "NET_RAW"],
                    labels={"strix-scan-id": scan_id},
                    environment={
                        "PYTHONUNBUFFERED": "1",
                        "TOOL_SERVER_PORT": str(CONTAINER_TOOL_SERVER_PORT),
                        "TOOL_SERVER_TOKEN": self._tool_server_token,
                        "STRIX_SANDBOX_EXECUTION_TIMEOUT": str(execution_timeout),
                        "HOST_GATEWAY": HOST_GATEWAY_HOSTNAME,
                    },
                    extra_hosts={HOST_GATEWAY_HOSTNAME: "host-gateway"},
                    mem_limit="4g",
                    cpu_quota=200_000,
                    pids_limit=1024,
                    tty=True,
                )

                self._scan_container = container
                self._wait_for_tool_server()

            except (DockerException, RequestsConnectionError, RequestsTimeout) as e:
                last_error = e
                if attempt < max_retries:
                    self._tool_server_port = None
                    self._tool_server_token = None
                    self._caido_port = None
                    self._novnc_port = None
                    self._shellinabox_port = None
                    self._burp_proxy_port = None
                    self._burp_api_port = None
                    self._ovpn_mgmt_port = None
                    self._netcat_mgr_port = None
                    time.sleep(2**attempt)
            else:
                return container

        raise SandboxInitializationError(
            "Failed to create container",
            f"Container creation failed after {max_retries + 1} attempts: {last_error}",
        ) from last_error

    def _get_or_create_container(self, scan_id: str) -> Container:
        container_name = f"strix-scan-{scan_id}"

        if self._scan_container:
            try:
                self._scan_container.reload()
                if self._scan_container.status == "running":
                    return self._scan_container
            except NotFound:
                self._scan_container = None
                self._tool_server_port = None
                self._tool_server_token = None
                self._caido_port = None
                self._novnc_port = None
                self._shellinabox_port = None
                self._burp_proxy_port = None
                self._burp_api_port = None
                self._ovpn_mgmt_port = None
                self._netcat_mgr_port = None

        try:
            container = self.client.containers.get(container_name)
            container.reload()

            if container.status != "running":
                container.start()
                time.sleep(2)

            self._scan_container = container
            self._recover_container_state(container)
        except NotFound:
            pass
        else:
            return container

        try:
            containers = self.client.containers.list(
                all=True, filters={"label": f"strix-scan-id={scan_id}"}
            )
            if containers:
                container = containers[0]
                if container.status != "running":
                    container.start()
                    time.sleep(2)

                self._scan_container = container
                self._recover_container_state(container)
                return container
        except DockerException:
            pass

        return self._create_container(scan_id)

    def _copy_local_directory_to_container(
        self, container: Container, local_path: str, target_name: str | None = None
    ) -> None:
        import tarfile
        from io import BytesIO

        try:
            local_path_obj = Path(local_path).resolve()
            if not local_path_obj.exists() or not local_path_obj.is_dir():
                return

            tar_buffer = BytesIO()
            with tarfile.open(fileobj=tar_buffer, mode="w") as tar:
                for item in local_path_obj.rglob("*"):
                    if item.is_file():
                        rel_path = item.relative_to(local_path_obj)
                        arcname = Path(target_name) / rel_path if target_name else rel_path
                        tar.add(item, arcname=arcname)

            tar_buffer.seek(0)
            container.put_archive("/workspace", tar_buffer.getvalue())
            container.exec_run(
                "chown -R pentester:pentester /workspace && chmod -R 755 /workspace",
                user="root",
            )
        except (OSError, DockerException):
            pass

    async def create_sandbox(
        self,
        agent_id: str,
        existing_token: str | None = None,
        local_sources: list[dict[str, str]] | None = None,
    ) -> SandboxInfo:
        scan_id = self._get_scan_id(agent_id)
        container = self._get_or_create_container(scan_id)

        source_copied_key = f"_source_copied_{scan_id}"
        if local_sources and not hasattr(self, source_copied_key):
            for index, source in enumerate(local_sources, start=1):
                source_path = source.get("source_path")
                if not source_path:
                    continue
                target_name = (
                    source.get("workspace_subdir") or Path(source_path).name or f"target_{index}"
                )
                self._copy_local_directory_to_container(container, source_path, target_name)
            setattr(self, source_copied_key, True)

        if container.id is None:
            raise RuntimeError("Docker container ID is unexpectedly None")

        token = existing_token or self._tool_server_token
        if self._tool_server_port is None or self._caido_port is None or token is None:
            raise RuntimeError("Tool server not initialized")

        host = self._resolve_docker_host()
        api_url = f"http://{host}:{self._tool_server_port}"

        await self._register_agent(api_url, agent_id, token)

        return {
            "workspace_id": container.id,
            "api_url": api_url,
            "auth_token": token,
            "tool_server_port": self._tool_server_port,
            "caido_port": self._caido_port,
            "novnc_port": int(self._novnc_port or 0),
            "shellinabox_port": int(self._shellinabox_port or 0),
            "burp_proxy_port": int(self._burp_proxy_port or 0),
            "burp_api_port": int(self._burp_api_port or 0),
            "ovpn_mgmt_port": int(self._ovpn_mgmt_port or 0),
            "netcat_mgr_port": int(self._netcat_mgr_port or 0),
            "agent_id": agent_id,
        }

    async def _register_agent(self, api_url: str, agent_id: str, token: str) -> None:
        try:
            async with httpx.AsyncClient(trust_env=False) as client:
                response = await client.post(
                    f"{api_url}/register_agent",
                    params={"agent_id": agent_id},
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=30,
                )
                response.raise_for_status()
        except httpx.RequestError:
            pass

    async def get_sandbox_url(self, container_id: str, port: int) -> str:
        try:
            self.client.containers.get(container_id)
            return f"http://{self._resolve_docker_host()}:{port}"
        except NotFound:
            raise ValueError(f"Container {container_id} not found.") from None

    def _resolve_docker_host(self) -> str:
        # Highest priority: an explicit override for the address the host's
        # loopback port mappings are reachable at. This is what the web
        # dashboard sets (``STRIX_SANDBOX_HOST=host.docker.internal``) so the
        # API container can reach the sandbox's tool server even though the
        # port is bound on the *host* 127.0.0.1, not the API container's.
        sandbox_host = os.getenv("STRIX_SANDBOX_HOST", "").strip()
        if sandbox_host:
            return sandbox_host

        docker_host = os.getenv("DOCKER_HOST", "")
        if docker_host:
            from urllib.parse import urlparse

            parsed = urlparse(docker_host)
            if parsed.scheme in ("tcp", "http", "https") and parsed.hostname:
                return parsed.hostname
        return "127.0.0.1"

    async def destroy_sandbox(self, container_id: str) -> None:
        try:
            container = self.client.containers.get(container_id)
            container.stop()
            container.remove()
            self._scan_container = None
            self._tool_server_port = None
            self._tool_server_token = None
            self._caido_port = None
            self._novnc_port = None
            self._shellinabox_port = None
            self._burp_proxy_port = None
            self._burp_api_port = None
            self._ovpn_mgmt_port = None
            self._netcat_mgr_port = None
        except (NotFound, DockerException):
            pass

    def cleanup(self) -> None:
        if self._scan_container is None:
            return
        container = self._scan_container
        container_name = container.name
        self._scan_container = None
        self._tool_server_port = None
        self._tool_server_token = None
        self._caido_port = None
        self._novnc_port = None
        self._shellinabox_port = None
        self._burp_proxy_port = None
        self._burp_api_port = None
        self._ovpn_mgmt_port = None
        self._netcat_mgr_port = None

        # Remove synchronously via the Docker SDK so we don't leak the 4GB
        # sandbox if the parent process dies before a fire-and-forget
        # ``docker rm`` subprocess gets a chance to start. Best-effort: any
        # error here just means the API-side janitor will sweep it later.
        try:
            container.remove(force=True, v=True)
        except (DockerException, NotFound):
            # Fall back to looking up by name — handle stale Container objects.
            if container_name:
                try:
                    fresh = self.client.containers.get(container_name)
                    fresh.remove(force=True, v=True)
                except (DockerException, NotFound):
                    pass
