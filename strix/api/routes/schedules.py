from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from strix.api.services.auth import Principal, require_analyst, require_any_member
from strix.api.services.schedules import create_schedule, delete_schedule, list_schedules


router = APIRouter(prefix="/api/runs/schedules", tags=["schedules"])


@router.get("")
async def get_schedules(_: Principal = Depends(require_any_member)) -> dict[str, object]:
    rows = await list_schedules()
    return {"items": [row.__dict__ for row in rows]}


@router.post("")
async def post_schedule(
    payload: dict[str, object],
    _: Principal = Depends(require_analyst),
) -> dict[str, object]:
    targets = payload.get("targets")
    if not isinstance(targets, list) or not targets:
        raise HTTPException(status_code=400, detail="targets[] required")
    row = await create_schedule(payload)
    return {"item": row.__dict__}


@router.delete("/{schedule_id}")
async def remove_schedule(
    schedule_id: str,
    _: Principal = Depends(require_analyst),
) -> dict[str, bool]:
    return {"deleted": await delete_schedule(schedule_id)}
