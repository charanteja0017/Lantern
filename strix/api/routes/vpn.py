from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile

from strix.api.services.auth import Principal, require_any_member
from strix.api.settings import get_settings


router = APIRouter(prefix="/api/runs/{run_id}/vpn", tags=["vpn"])


def _profile_path(run_id: str) -> Path:
    return Path(get_settings().runs_dir) / run_id / "vpn-profile.ovpn"


@router.post("/profile")
async def upload_profile(
    run_id: str, file: UploadFile, _: Principal = Depends(require_any_member)
) -> dict[str, object]:
    data = await file.read()
    path = _profile_path(run_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return {"runId": run_id, "uploaded": True, "size": len(data)}


@router.get("/status")
async def vpn_status(run_id: str, _: Principal = Depends(require_any_member)) -> dict[str, object]:
    path = _profile_path(run_id)
    return {"runId": run_id, "profileUploaded": path.exists(), "state": "disconnected"}
