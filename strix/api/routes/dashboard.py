from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends

from strix.api.schemas import DashboardOverview
from strix.api.services.auth import Principal, require_any_member
from strix.api.services.rate_limit import get_default_governor
from strix.api.services.run_store import RunStore
from strix.api.settings import get_settings


router = APIRouter(prefix="/api/dashboard")


@router.get("/overview", response_model=DashboardOverview)
async def overview(_: Principal = Depends(require_any_member)) -> DashboardOverview:
    runs = RunStore(get_settings().runs_dir).list_runs()
    now = datetime.now(UTC)

    active = sum(1 for r in runs if r.status in ("running", "throttled", "paused"))
    last_24h = 0
    for r in runs:
        try:
            created = datetime.fromisoformat(r.created_at.replace("Z", "+00:00"))
            if now - created < timedelta(hours=24):
                last_24h += 1
        except ValueError:
            continue

    weekly_runs: Counter[str] = Counter()
    weekly_findings: Counter[str] = Counter()
    for i in range(7):
        day = (now - timedelta(days=i)).strftime("%a")
        weekly_runs[day] = 0
        weekly_findings[day] = 0
    for r in runs:
        try:
            created = datetime.fromisoformat(r.created_at.replace("Z", "+00:00"))
            day = created.strftime("%a")
            if day in weekly_runs:
                weekly_runs[day] += 1
                weekly_findings[day] += r.stats.vulnerabilities
        except ValueError:
            continue

    findings_by_sev: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    total_findings = 0
    for r in runs:
        for k in findings_by_sev:
            findings_by_sev[k] += getattr(r.severity_counts, k, 0)
            total_findings += getattr(r.severity_counts, k, 0)

    snapshots = get_default_governor().snapshot()
    throttled = [s for s in snapshots if s["status"] != "ok"]
    throttle = {
        "active": bool(throttled),
        "providers": [s["provider"] for s in throttled] if throttled else [],
        "tpmUsage": max((s["tpm"]["used"] / max(1, s["tpm"]["limit"])) for s in snapshots)
        if snapshots
        else 0,
        "rpmUsage": max((s["rpm"]["used"] / max(1, s["rpm"]["limit"])) for s in snapshots)
        if snapshots
        else 0,
    }

    hourly = []
    for i in range(24):
        label = (now - timedelta(hours=23 - i)).strftime("%H:00")
        hourly.append({"hour": label, "tokens": 0})

    return DashboardOverview(
        runs={
            "active": active,
            "last24h": last_24h,
            "weekly": [
                {"day": d, "count": weekly_runs[d]} for d in reversed(list(weekly_runs.keys()))
            ],
        },
        findings={
            "total": total_findings,
            "bySeverity": findings_by_sev,
            "weekly": [
                {"day": d, "count": weekly_findings[d]}
                for d in reversed(list(weekly_findings.keys()))
            ],
        },
        tokens={"used24h": 0, "cost24h": 0.0, "hourly": hourly},
        throttle=throttle,
    )
