from __future__ import annotations

import asyncio
import logging
import shutil
import time
from dataclasses import dataclass
from pathlib import Path


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RetentionConfig:
    runs_dir: str
    retention_days: int = 90
    sweep_interval_seconds: int = 60 * 60 * 24
    max_evidence_bytes: int = 5 * 1024 * 1024 * 1024


def _iter_evidence_dirs(run_dir: Path) -> list[Path]:
    candidates = []
    for name in ("evidence", "artifacts", "attachments"):
        path = run_dir / name
        if path.is_dir():
            candidates.append(path)
    return candidates


def _dir_size_bytes(path: Path) -> int:
    total = 0
    for child in path.rglob("*"):
        try:
            if child.is_file():
                total += child.stat().st_size
        except OSError:
            continue
    return total


def _trim_oldest_files(path: Path, target_max_bytes: int) -> int:
    files = []
    for child in path.rglob("*"):
        try:
            if child.is_file():
                st = child.stat()
                files.append((st.st_mtime, st.st_size, child))
        except OSError:
            continue
    files.sort(key=lambda item: item[0])
    removed = 0
    current = sum(size for _, size, _ in files)
    for _, size, child in files:
        if current <= target_max_bytes:
            break
        try:
            child.unlink(missing_ok=True)
            current -= size
            removed += 1
        except OSError:
            continue
    return removed


def sweep_once(cfg: RetentionConfig) -> dict[str, int]:
    root = Path(cfg.runs_dir)
    if not root.is_dir():
        return {"deleted_runs": 0, "trimmed_files": 0}
    now = time.time()
    max_age_seconds = max(1, cfg.retention_days) * 24 * 60 * 60
    deleted_runs = 0
    trimmed_files = 0

    for run_dir in root.iterdir():
        if not run_dir.is_dir():
            continue
        try:
            age = now - run_dir.stat().st_mtime
        except OSError:
            continue
        if age > max_age_seconds:
            try:
                shutil.rmtree(run_dir, ignore_errors=True)
                deleted_runs += 1
            except OSError:
                logger.warning("retention: failed to remove run dir %s", run_dir)
            continue
        for evidence_dir in _iter_evidence_dirs(run_dir):
            if _dir_size_bytes(evidence_dir) > cfg.max_evidence_bytes:
                trimmed_files += _trim_oldest_files(evidence_dir, cfg.max_evidence_bytes)

    return {"deleted_runs": deleted_runs, "trimmed_files": trimmed_files}


async def run_retention_loop(cfg: RetentionConfig) -> None:
    while True:
        try:
            summary = sweep_once(cfg)
            if summary["deleted_runs"] or summary["trimmed_files"]:
                logger.info("retention sweep: %s", summary)
        except Exception as exc:
            logger.warning("retention sweep failed: %s", exc)
        await asyncio.sleep(max(60, cfg.sweep_interval_seconds))
