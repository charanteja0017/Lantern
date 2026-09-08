from __future__ import annotations

import json

from fastapi import APIRouter, Depends

from strix.api.services.auth import Principal, require_any_member
from strix.tools.burp.burp_actions import (
    burp_collaborator_generate,
    burp_intruder_run,
    burp_proxy_history,
    burp_send_to_repeater,
)


router = APIRouter(prefix="/api/runs/{run_id}/burp", tags=["burp"])


@router.get("/history")
async def burp_history(
    run_id: str, _: Principal = Depends(require_any_member)
) -> dict[str, object]:
    result = await burp_proxy_history()
    raw_data = result.get("data")
    parsed_items: list[object]
    if isinstance(raw_data, str):
        try:
            decoded = json.loads(raw_data)
            parsed_items = decoded if isinstance(decoded, list) else [decoded]
        except Exception:
            parsed_items = [raw_data] if raw_data else []
    else:
        parsed_items = raw_data if isinstance(raw_data, list) else []
    return {"runId": run_id, "items": parsed_items, "raw": result}


@router.post("/repeater")
async def burp_repeater(
    run_id: str, body: dict[str, object], _: Principal = Depends(require_any_member)
) -> dict[str, object]:
    request = str(body.get("request") or "")
    result = await burp_send_to_repeater(request=request)
    return {"runId": run_id, "queued": bool(result.get("ok")), "raw": result}


@router.post("/intruder")
async def burp_intruder(
    run_id: str, body: dict[str, object], _: Principal = Depends(require_any_member)
) -> dict[str, object]:
    raw_payload_set = body.get("payload_set")
    payload_items = raw_payload_set if isinstance(raw_payload_set, list) else []
    result = await burp_intruder_run(
        template=str(body.get("template") or ""),
        payload_set=[str(v) for v in payload_items if v is not None],
        mode=str(body.get("mode") or "sniper"),
    )
    return {"runId": run_id, "queued": bool(result.get("ok")), "raw": result}


@router.post("/collaborator")
async def burp_collaborator(
    run_id: str, _: Principal = Depends(require_any_member)
) -> dict[str, object]:
    result = await burp_collaborator_generate()
    return {"runId": run_id, "token": result.get("data"), "raw": result}
