from __future__ import annotations

from fastapi import APIRouter, Depends

from strix.api.schemas import OrgSummary
from strix.api.services.auth import Principal, require_any_member


router = APIRouter(prefix="/api/orgs")


@router.get("", response_model=list[OrgSummary])
async def list_orgs(principal: Principal = Depends(require_any_member)) -> list[OrgSummary]:
    return [
        OrgSummary(
            id=principal.org_id,
            name=principal.org_slug.title(),
            slug=principal.org_slug,
            memberCount=1,
        )
    ]
