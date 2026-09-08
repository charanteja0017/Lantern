from __future__ import annotations

import asyncio
import datetime as dt
import logging
import uuid
from dataclasses import dataclass
from typing import Any

from strix.api.services.db import get_pg_pool
from strix.api.services.run_launcher import get_run_launcher
from strix.api.settings import get_settings


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ScheduleRow:
    id: str
    name: str
    targets: list[str]
    cron_expr: str
    scan_mode: str
    scope_mode: str
    instruction: str | None
    policy: dict[str, Any]
    enabled: bool
    last_run_at: str | None
    next_run_at: str | None


def _parse_interval_minutes(cron_expr: str) -> int:
    # Minimal parser: supports "*/N * * * *" and plain integer minutes ("15").
    text = (cron_expr or "").strip()
    if text.isdigit():
        return max(1, int(text))
    if text.startswith("*/") and " " in text:
        first = text.split()[0][2:]
        if first.isdigit():
            return max(1, int(first))
    return 60


def _next_run_iso(now: dt.datetime, cron_expr: str) -> str:
    delta = dt.timedelta(minutes=_parse_interval_minutes(cron_expr))
    return (now + delta).isoformat()


async def list_schedules() -> list[ScheduleRow]:
    pool = await get_pg_pool()
    if pool is None:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, name, targets, cron_expr, scan_mode, scope_mode, instruction,
                   policy, enabled, last_run_at, next_run_at
            FROM strix_scan_schedules
            ORDER BY created_at DESC
            """
        )
    out: list[ScheduleRow] = []
    for row in rows:
        out.append(
            ScheduleRow(
                id=row["id"],
                name=row["name"],
                targets=list(row["targets"] or []),
                cron_expr=row["cron_expr"],
                scan_mode=row["scan_mode"],
                scope_mode=row["scope_mode"],
                instruction=row["instruction"],
                policy=dict(row["policy"] or {}),
                enabled=bool(row["enabled"]),
                last_run_at=row["last_run_at"].isoformat() if row["last_run_at"] else None,
                next_run_at=row["next_run_at"].isoformat() if row["next_run_at"] else None,
            )
        )
    return out


async def create_schedule(payload: dict[str, Any]) -> ScheduleRow:
    pool = await get_pg_pool()
    if pool is None:
        raise RuntimeError("Postgres is required for schedules")
    now = dt.datetime.now(dt.UTC)
    sched_id = str(uuid.uuid4())
    next_run = _next_run_iso(now, str(payload.get("cron_expr") or "60"))
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO strix_scan_schedules (
                id, name, targets, cron_expr, scan_mode, scope_mode,
                instruction, policy, enabled, next_run_at, created_at, updated_at
            ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8::jsonb,$9,$10,NOW(),NOW())
            """,
            sched_id,
            str(payload.get("name") or "Scheduled scan"),
            payload.get("targets") or [],
            str(payload.get("cron_expr") or "60"),
            str(payload.get("scan_mode") or "standard"),
            str(payload.get("scope_mode") or "auto"),
            payload.get("instruction"),
            payload.get("policy") or {},
            bool(payload.get("enabled", True)),
            next_run,
        )
    rows = await list_schedules()
    return next(row for row in rows if row.id == sched_id)


async def delete_schedule(schedule_id: str) -> bool:
    pool = await get_pg_pool()
    if pool is None:
        return False
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM strix_scan_schedules WHERE id=$1",
            schedule_id,
        )
    return str(result).endswith("1")


async def run_scheduler_loop() -> None:
    while True:
        try:
            await _tick_once()
        except Exception as exc:
            logger.warning("schedule tick failed: %s", exc)
        await asyncio.sleep(30)


async def _tick_once() -> None:
    pool = await get_pg_pool()
    if pool is None:
        return
    now = dt.datetime.now(dt.UTC)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, targets, instruction, scan_mode, scope_mode, cron_expr
            FROM strix_scan_schedules
            WHERE enabled=TRUE AND (next_run_at IS NULL OR next_run_at <= NOW())
            ORDER BY next_run_at NULLS FIRST
            LIMIT 8
            """
        )
    if not rows:
        return

    launcher = get_run_launcher(get_settings().runs_dir)
    for row in rows:
        try:
            launcher.start(
                targets=list(row["targets"] or []),
                instruction=row["instruction"],
                scan_mode=row["scan_mode"],
                scope_mode=row["scope_mode"],
            )
        except Exception as exc:
            logger.warning("schedule %s launch failed: %s", row["id"], exc)
        next_run = _next_run_iso(now, row["cron_expr"])
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE strix_scan_schedules
                SET last_run_at=NOW(), next_run_at=$2::timestamptz, updated_at=NOW()
                WHERE id=$1
                """,
                row["id"],
                next_run,
            )
