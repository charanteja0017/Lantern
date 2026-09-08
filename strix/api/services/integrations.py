from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from dataclasses import dataclass
from typing import Any

import httpx

from strix.api.services.db import get_pg_pool
from strix.api.services.secrets import resolve_reference


INTEGRATION_KINDS = {"webhook", "slack", "discord", "jira", "github_issues"}


@dataclass(frozen=True)
class IntegrationConfig:
    id: str
    kind: str
    name: str
    endpoint_url: str
    secret_ref: str | None
    enabled: bool
    metadata: dict[str, Any]


async def list_integrations() -> list[IntegrationConfig]:
    pool = await get_pg_pool()
    if pool is None:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, kind, name, endpoint_url, secret_ref, enabled, metadata
            FROM strix_integrations
            ORDER BY created_at DESC
            """
        )
    return [
        IntegrationConfig(
            id=row["id"],
            kind=row["kind"],
            name=row["name"],
            endpoint_url=row["endpoint_url"],
            secret_ref=row["secret_ref"],
            enabled=bool(row["enabled"]),
            metadata=dict(row["metadata"] or {}),
        )
        for row in rows
    ]


async def put_integration(payload: dict[str, Any]) -> IntegrationConfig:
    pool = await get_pg_pool()
    if pool is None:
        raise RuntimeError("Postgres is required for integration storage")
    kind = str(payload.get("kind") or "").strip()
    if kind not in INTEGRATION_KINDS:
        raise ValueError(f"Unsupported integration kind: {kind}")
    integ_id = str(payload.get("id") or f"int_{uuid.uuid4().hex}")
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO strix_integrations
              (id, kind, name, endpoint_url, secret_ref, enabled, metadata, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
            ON CONFLICT (id) DO UPDATE SET
              kind=EXCLUDED.kind,
              name=EXCLUDED.name,
              endpoint_url=EXCLUDED.endpoint_url,
              secret_ref=EXCLUDED.secret_ref,
              enabled=EXCLUDED.enabled,
              metadata=EXCLUDED.metadata,
              updated_at=NOW()
            """,
            integ_id,
            kind,
            str(payload.get("name") or kind),
            str(payload.get("endpoint_url") or ""),
            payload.get("secret_ref"),
            bool(payload.get("enabled", True)),
            payload.get("metadata") or {},
        )
    rows = await list_integrations()
    return next(row for row in rows if row.id == integ_id)


async def delete_integration(integration_id: str) -> bool:
    pool = await get_pg_pool()
    if pool is None:
        return False
    async with pool.acquire() as conn:
        res = await conn.execute(
            "DELETE FROM strix_integrations WHERE id=$1",
            integration_id,
        )
    return str(res).endswith("1")


def _sign_payload(secret: str, body: bytes, ts: str, nonce: str) -> str:
    material = ts.encode("utf-8") + b"." + nonce.encode("utf-8") + b"." + body
    return hmac.new(secret.encode("utf-8"), material, hashlib.sha256).hexdigest()


async def dispatch_event(event_name: str, payload: dict[str, Any]) -> dict[str, int]:
    configs = [c for c in await list_integrations() if c.enabled and c.endpoint_url]
    sent = 0
    failed = 0
    if not configs:
        return {"sent": 0, "failed": 0}
    timeout = httpx.Timeout(15.0, connect=5.0)
    async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
        for cfg in configs:
            body_payload = {
                "event": event_name,
                "integration": cfg.kind,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "payload": payload,
            }
            body = json.dumps(body_payload).encode("utf-8")
            ts = str(int(time.time()))
            nonce = uuid.uuid4().hex
            headers = {
                "Content-Type": "application/json",
                "X-Strix-Event": event_name,
                "X-Strix-Timestamp": ts,
                "X-Strix-Nonce": nonce,
            }
            secret = await resolve_reference(cfg.secret_ref)
            if secret:
                headers["X-Strix-Signature"] = _sign_payload(secret, body, ts, nonce)
            try:
                if cfg.kind == "slack":
                    text = (
                        payload.get("summary")
                        or f"{event_name}: {payload.get('title') or ''}".strip()
                    )
                    response = await client.post(
                        cfg.endpoint_url,
                        json={"text": text, "blocks": payload.get("slack_blocks")},
                        headers=headers,
                    )
                elif cfg.kind == "discord":
                    text = payload.get("summary") or f"**{event_name}**"
                    response = await client.post(
                        cfg.endpoint_url,
                        json={"content": text, "embeds": payload.get("discord_embeds") or []},
                        headers=headers,
                    )
                else:
                    response = await client.post(cfg.endpoint_url, content=body, headers=headers)
                if 200 <= response.status_code < 300:
                    sent += 1
                else:
                    failed += 1
            except Exception:
                failed += 1
    return {"sent": sent, "failed": failed}
