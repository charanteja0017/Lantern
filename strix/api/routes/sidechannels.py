from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from strix.api.services.auth import Principal, require_any_member
from strix.api.services.run_store import RunStore
from strix.api.services.sidechannel_tokens import sign_sidechannel_token as _sign_channel_token
from strix.api.settings import get_settings


router = APIRouter(prefix="/api/runs", tags=["sidechannels"])


@router.get("/{run_id}/sidechannels")
async def get_sidechannels(
    run_id: str,
    principal: Principal = Depends(require_any_member),
) -> dict[str, Any]:
    if RunStore(get_settings().runs_dir).get(run_id) is None:
        raise HTTPException(status_code=404, detail="Run not found")
    now = int(time.time())
    exp = now + 60 * 15

    def minted(channel: str, path: str) -> dict[str, Any]:
        token = _sign_channel_token(
            {
                "iss": "strix",
                "aud": channel,
                "run_id": run_id,
                "user_id": principal.user_id,
                "org_id": principal.org_id,
                "iat": now,
                "exp": exp,
            }
        )
        return {"channel": channel, "url": f"{path}?token={token}", "expires_at": exp}

    return {
        "runId": run_id,
        "channels": [
            minted("shell", f"/ws/runs/{run_id}/shells/default"),
            minted("vnc", f"/api/runs/{run_id}/vnc/"),
            minted("burp", f"/runs/{run_id}/burp/"),
            minted("ovpn", f"/runs/{run_id}/ovpn/"),
            minted("netcat", f"/runs/{run_id}/listeners/"),
        ],
    }
