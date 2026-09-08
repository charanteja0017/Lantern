"""Append-only audit log for admin-sensitive actions.

When Postgres is enabled the log lives in the ``audit_log`` table. Without
Postgres, entries are written to ``strix_runs/_audit/audit.jsonl`` as a
tamper-evident append-only stream. Either way, every admin action on
customer data is recorded so support sessions are auditable.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from strix.api.services.auth import Principal


_lock = threading.Lock()


class AuditLog:
    def __init__(self, base_dir: str | Path):
        self.dir = Path(base_dir) / "_audit"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path = self.dir / "audit.jsonl"

    def record(
        self,
        principal: Principal,
        action: str,
        target: str,
        *,
        ip: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        entry = {
            "id": f"audit_{uuid4().hex}",
            "actor": {
                "id": principal.user_id,
                "name": principal.email,
                "role": principal.role,
                "org_id": principal.org_id,
            },
            "action": action,
            "target": target,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "ip": ip,
            "metadata": metadata or {},
        }
        line = json.dumps(entry, ensure_ascii=False)
        with _lock, self.path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
            f.flush()
            os.fsync(f.fileno())
        return entry

    def recent(self, limit: int = 200) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        out: list[dict[str, Any]] = []
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return out[-limit:][::-1]
