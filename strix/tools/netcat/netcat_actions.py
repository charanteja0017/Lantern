from __future__ import annotations

import queue
import socket
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any

from strix.tools.registry import register_tool


@dataclass
class _Listener:
    id: str
    host: str
    port: int
    server: socket.socket
    inbox: queue.Queue[bytes] = field(default_factory=queue.Queue)
    clients: list[socket.socket] = field(default_factory=list)
    alive: bool = True


class _NetcatManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._listeners: dict[str, _Listener] = {}

    def listen(self, port: int | None = None) -> dict[str, Any]:
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(("0.0.0.0", port or 0))
        server.listen(20)
        host, chosen_port = server.getsockname()
        listener_id = f"nc_{uuid.uuid4().hex[:8]}"
        listener = _Listener(
            id=listener_id,
            host=str(host),
            port=int(chosen_port),
            server=server,
        )
        with self._lock:
            self._listeners[listener_id] = listener
        threading.Thread(target=self._accept_loop, args=(listener,), daemon=True).start()
        return {
            "listener_id": listener_id,
            "host": host,
            "port": chosen_port,
            "url": f"tcp://{host}:{chosen_port}",
            "status": "listening",
        }

    def _accept_loop(self, listener: _Listener) -> None:
        while listener.alive:
            try:
                client, _addr = listener.server.accept()
                listener.clients.append(client)
                threading.Thread(
                    target=self._client_loop,
                    args=(listener, client),
                    daemon=True,
                ).start()
            except OSError:
                break

    def _client_loop(self, listener: _Listener, client: socket.socket) -> None:
        while listener.alive:
            try:
                data = client.recv(4096)
            except OSError:
                break
            if not data:
                break
            listener.inbox.put(data)
        with self._lock:
            if client in listener.clients:
                listener.clients.remove(client)
        try:
            client.close()
        except OSError:
            pass

    def read(self, listener_id: str, timeout: float = 0.2) -> dict[str, Any]:
        listener = self._listeners.get(listener_id)
        if not listener:
            return {"error": f"listener '{listener_id}' not found", "status": "not_found"}
        chunks: list[bytes] = []
        try:
            first = listener.inbox.get(timeout=max(0.0, timeout))
            chunks.append(first)
            while True:
                chunks.append(listener.inbox.get_nowait())
        except queue.Empty:
            pass
        payload = b"".join(chunks)
        return {
            "listener_id": listener_id,
            "bytes": len(payload),
            "content": payload.decode("utf-8", errors="replace"),
            "status": "ok",
        }

    def send(self, listener_id: str, data: str) -> dict[str, Any]:
        listener = self._listeners.get(listener_id)
        if not listener:
            return {"error": f"listener '{listener_id}' not found", "status": "not_found"}
        wire = data.encode("utf-8")
        sent = 0
        for client in list(listener.clients):
            try:
                client.sendall(wire)
                sent += 1
            except OSError:
                continue
        return {"listener_id": listener_id, "sent_clients": sent, "status": "ok"}

    def close(self, listener_id: str) -> dict[str, Any]:
        listener = self._listeners.pop(listener_id, None)
        if not listener:
            return {"listener_id": listener_id, "status": "not_found"}
        listener.alive = False
        try:
            listener.server.close()
        except OSError:
            pass
        for client in list(listener.clients):
            try:
                client.close()
            except OSError:
                pass
        return {"listener_id": listener_id, "status": "closed"}

    def list(self) -> dict[str, Any]:
        return {
            "listeners": [
                {
                    "listener_id": item.id,
                    "host": item.host,
                    "port": item.port,
                    "clients": len(item.clients),
                    "status": "listening" if item.alive else "closed",
                }
                for item in self._listeners.values()
            ]
        }


_MGR = _NetcatManager()


@register_tool(sandbox_execution=True)
def netcat_listen(port: int | None = None) -> dict[str, Any]:
    return _MGR.listen(port=port)


@register_tool(sandbox_execution=True)
def netcat_read(listener_id: str, timeout: float = 0.2) -> dict[str, Any]:
    return _MGR.read(listener_id, timeout=timeout)


@register_tool(sandbox_execution=True)
def netcat_send(listener_id: str, data: str) -> dict[str, Any]:
    return _MGR.send(listener_id, data=data)


@register_tool(sandbox_execution=True)
def netcat_close(listener_id: str) -> dict[str, Any]:
    return _MGR.close(listener_id)


@register_tool(sandbox_execution=True)
def netcat_listeners() -> dict[str, Any]:
    return _MGR.list()
