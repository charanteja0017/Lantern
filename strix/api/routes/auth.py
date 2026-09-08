"""Authentication introspection endpoints.

``/api/auth/whoami`` returns the server-side view of the caller — the same
``Principal`` that RBAC middleware uses for authorization decisions. It is
intentionally accessible to any authenticated member so users (and the
frontend UI) can reconcile what Clerk *claims* about them with what the
backend *decides* they are (e.g. whether ``STRIX_ADMIN_EMAILS`` /
``STRIX_ADMIN_USER_IDS`` elevated them to ``platform-admin``).

This is the fastest way to debug "why am I still seeing member?" issues
without giving unprivileged users access to the full operational health
report at ``/api/system/health``.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from strix.api.services.auth import Principal, require_any_member


router = APIRouter(prefix="/api/auth")


class WhoAmI(BaseModel):
    userId: str
    email: str
    orgId: str
    orgSlug: str
    role: str
    # ``source`` helps the UI explain *why* a role was assigned ("your email
    # is in STRIX_ADMIN_EMAILS", "Clerk org membership", etc.). We keep it
    # coarse so we don't leak admin-list contents to non-admins.
    elevated: bool


@router.get("/whoami", response_model=WhoAmI)
async def whoami(principal: Principal = Depends(require_any_member)) -> WhoAmI:
    return WhoAmI(
        userId=principal.user_id,
        email=principal.email,
        orgId=principal.org_id,
        orgSlug=principal.org_slug,
        role=principal.role,
        elevated=principal.role == "platform-admin",
    )
