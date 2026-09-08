from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from strix.api.services.audit import AuditLog
from strix.api.services.auth import Principal, require_platform_admin
from strix.api.services.integrations import (
    delete_integration,
    dispatch_event,
    list_integrations,
    put_integration,
)
from strix.api.settings import get_settings


router = APIRouter(prefix="/api/admin/integrations", tags=["integrations"])


@router.get("")
async def admin_list_integrations(
    _: Principal = Depends(require_platform_admin),
) -> dict[str, object]:
    items = await list_integrations()
    return {"items": [i.__dict__ for i in items]}


@router.put("")
async def admin_put_integration(
    payload: dict[str, object],
    request: Request,
    principal: Principal = Depends(require_platform_admin),
) -> dict[str, object]:
    try:
        item = await put_integration(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    AuditLog(get_settings().runs_dir).record(
        principal,
        action="admin.integrations.upsert",
        target=item.id,
        ip=request.client.host if request.client else None,
        metadata={"kind": item.kind, "name": item.name},
    )
    return {"item": item.__dict__}


@router.delete("/{integration_id}")
async def admin_delete_integration(
    integration_id: str,
    request: Request,
    principal: Principal = Depends(require_platform_admin),
) -> dict[str, bool]:
    deleted = await delete_integration(integration_id)
    AuditLog(get_settings().runs_dir).record(
        principal,
        action="admin.integrations.delete",
        target=integration_id,
        ip=request.client.host if request.client else None,
        metadata={"deleted": deleted},
    )
    return {"deleted": deleted}


@router.post("/{integration_id}/test")
async def admin_test_integration(
    integration_id: str,
    _: Principal = Depends(require_platform_admin),
) -> dict[str, int | str]:
    result = await dispatch_event(
        "integration.test",
        {
            "integration_id": integration_id,
            "summary": "NovaHunter integration test event",
            "title": "Integration test",
        },
    )
    return {"integration_id": integration_id, **result}
