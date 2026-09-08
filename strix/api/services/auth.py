"""Authentication & RBAC helpers.

When Clerk is configured (``CLERK_JWKS_URL`` + ``CLERK_ISSUER``), JWTs are
verified against the Clerk JWKS and the claims are mapped to an internal
principal with role and organization.

When Clerk is not configured (local development / demo), a permissive
principal is returned so the API can be exercised without external auth.
Production deployments must set ``STRIX_ENV=production`` and configure
Clerk — the app will refuse to start otherwise (see ``app.py``).

Authorization model (RBAC):
- ``viewer``   — read-only access to own org
- ``analyst``  — create/stop runs, send messages; own org
- ``admin``    — full org-scoped access
- ``platform-admin`` — cross-tenant read + support actions, fully audited
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import Depends, HTTPException, Request, status

from strix.api.settings import ApiSettings, get_settings


logger = logging.getLogger(__name__)

# --- Clerk email lookup cache ------------------------------------------------
# Clerk session JWTs don't carry ``email`` by default, so we optionally call
# the Clerk Backend API to resolve ``sub -> email`` when CLERK_SECRET_KEY is
# configured. The lookup is slow (a synchronous HTTP hop) and emails rarely
# change, so results are cached per-process for an hour.
_EMAIL_CACHE: dict[str, tuple[float, str]] = {}
_EMAIL_CACHE_LOCK = threading.Lock()
_EMAIL_CACHE_TTL_SEC = 3600.0


async def _lookup_email_from_clerk(sub: str, settings: ApiSettings) -> str:
    if not sub or not settings.clerk_secret_key:
        return ""
    now = time.time()
    with _EMAIL_CACHE_LOCK:
        cached = _EMAIL_CACHE.get(sub)
        if cached and now - cached[0] < _EMAIL_CACHE_TTL_SEC:
            return cached[1]

    try:
        import httpx
    except ImportError:  # pragma: no cover - httpx ships as an API dependency
        return ""

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"https://api.clerk.com/v1/users/{sub}",
                headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("Clerk user lookup failed for %s: %s", sub, exc)
        return ""

    email = ""
    primary_id = data.get("primary_email_address_id")
    for entry in data.get("email_addresses") or []:
        if entry.get("id") == primary_id:
            email = str(entry.get("email_address") or "")
            break
    if not email and data.get("email_addresses"):
        email = str(data["email_addresses"][0].get("email_address") or "")

    with _EMAIL_CACHE_LOCK:
        _EMAIL_CACHE[sub] = (now, email)
    return email


API_KEY_PREFIXES = ("strx_", "nh_pat_")
API_KEY_HEADER = "x-api-key"

Role = Literal["viewer", "analyst", "admin", "platform-admin"]


@dataclass(frozen=True)
class Principal:
    user_id: str
    email: str
    org_id: str
    org_slug: str
    role: Role


DEMO_PRINCIPAL = Principal(
    user_id="user_demo",
    email="demo@strix.local",
    org_id="org_demo",
    org_slug="demo",
    role="platform-admin",
)


async def _verify_clerk_token(token: str, settings: ApiSettings) -> dict[str, Any]:
    try:
        import httpx
        from jose import jwt
        from jose.exceptions import JWTError
    except ImportError as err:  # pragma: no cover - optional dependency
        raise HTTPException(status_code=500, detail="Clerk JWT dependencies not installed") from err

    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(settings.clerk_jwks_url)
        resp.raise_for_status()
        jwks = resp.json()

    try:
        decoded = jwt.decode(
            token,
            json.dumps(jwks),
            algorithms=["RS256"],
            issuer=settings.clerk_issuer,
            options={"verify_aud": bool(settings.clerk_audience)},
            audience=settings.clerk_audience or None,
        )
        return decoded if isinstance(decoded, dict) else {}
    except JWTError as err:
        raise HTTPException(status_code=401, detail="Invalid auth token") from err


def _extract_bearer(request: Request) -> str:
    raw = str(request.headers.get("authorization", "") or "")
    if raw.lower().startswith("bearer "):
        return raw.split(" ", 1)[1].strip()
    return ""


def _extract_api_key(request: Request) -> str:
    header = str(request.headers.get(API_KEY_HEADER, "") or "").strip()
    if header:
        return header
    bearer = _extract_bearer(request)
    if bearer.startswith(API_KEY_PREFIXES):
        return bearer
    return ""


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _load_key_registry(settings: ApiSettings) -> dict[str, dict[str, str]]:
    """Build a lookup table: {sha256 -> {role, email, org_id, org_slug, label}}.

    Accepts two input formats:
    - ``STRIX_API_KEYS``: comma-separated ``key`` or ``key:role`` or
      ``key:role:email`` tuples.
    - ``STRIX_API_KEYS_FILE``: path to a JSON file with a list of
      ``{"key": "...", "role": "...", "email": "...", "org_id": "...",
      "org_slug": "...", "label": "..."}`` records.
    Keys may be supplied raw or pre-hashed (64 hex chars). Pre-hashed entries
    must use the ``sha256:<hex>`` form.
    """
    registry: dict[str, dict[str, str]] = {}
    for entry in settings.api_keys:
        parts = entry.split(":")
        key = parts[0].strip()
        role = (parts[1].strip() if len(parts) > 1 else "analyst") or "analyst"
        email = parts[2].strip() if len(parts) > 2 else "apikey@strix.local"
        if not key:
            continue
        digest = key[len("sha256:") :] if key.startswith("sha256:") else _hash_key(key)
        registry[digest] = {
            "role": role,
            "email": email,
            "org_id": "org_default",
            "org_slug": "default",
            "label": "env",
        }
    path = settings.api_keys_file
    if path and os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as fh:
                records = json.load(fh)
            for rec in records:
                key = str(rec.get("key", "")).strip()
                if not key:
                    continue
                digest = key[len("sha256:") :] if key.startswith("sha256:") else _hash_key(key)
                registry[digest] = {
                    "role": str(rec.get("role", "analyst")) or "analyst",
                    "email": str(rec.get("email", "apikey@strix.local")),
                    "org_id": str(rec.get("org_id", "org_default")),
                    "org_slug": str(rec.get("org_slug", "default")),
                    "label": str(rec.get("label", "file")),
                }
        except Exception:
            pass
    return registry


async def _principal_from_api_key(key: str, settings: ApiSettings) -> Principal | None:
    if not key or not key.startswith(API_KEY_PREFIXES):
        return None
    if not settings.auth_enabled and not settings.api_keys and not settings.api_keys_file:
        # Demo mode: any well-formed strx_ key binds to the demo principal so
        # keys generated in the profile UI actually exercise the API.
        return DEMO_PRINCIPAL
    registry = _load_key_registry(settings)
    digest = _hash_key(key)
    record = registry.get(digest)
    if not record:
        # Also trust persisted PAT hashes from the MCP registry. Those tokens
        # are server-issued and survive page reloads, unlike local-only keys.
        try:
            from strix.api.services.mcp_registry import list_pats

            pats = await list_pats()
            for item in pats:
                token_hash = str(item.get("token_hash") or "").strip()
                if token_hash == digest:
                    record = {
                        "role": "analyst",
                        "email": "apikey@strix.local",
                        "org_id": "org_default",
                        "org_slug": "default",
                        "label": str(item.get("label") or "mcp"),
                    }
                    break
        except Exception:
            record = None
    if not record:
        return None
    role_raw = record["role"]
    role: Role = "viewer"
    if role_raw in {"viewer", "analyst", "admin", "platform-admin"}:
        role = role_raw  # type: ignore[assignment]
    return Principal(
        user_id=f"apikey_{_hash_key(key)[:12]}",
        email=record["email"],
        org_id=record["org_id"],
        org_slug=record["org_slug"],
        role=role,
    )


async def get_principal(request: Request) -> Principal:
    settings = get_settings()

    api_key = _extract_api_key(request)
    if api_key:
        principal = await _principal_from_api_key(api_key, settings)
        if principal:
            return principal
        raise HTTPException(status_code=401, detail="Invalid or revoked API key")

    if not settings.auth_enabled:
        return DEMO_PRINCIPAL

    token = _extract_bearer(request)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token or X-API-Key")
    claims = await _verify_clerk_token(token, settings)

    sub = str(claims.get("sub", ""))
    # Clerk session JWTs typically omit ``email``; accept every reasonable
    # spelling a custom JWT template might emit before falling back to the
    # Backend API lookup below.
    email = str(
        claims.get("email")
        or claims.get("primary_email")
        or claims.get("primary_email_address")
        or claims.get("email_address")
        or ""
    )
    if not email and sub:
        email = await _lookup_email_from_clerk(sub, settings)

    # Clerk's default organization roles look like ``org:admin`` / ``org:member``;
    # strip the prefix and map ``member`` to our internal ``viewer`` so a
    # real Clerk membership produces a usable role (instead of silently
    # falling back to ``viewer`` with no signal).
    role_raw = str(claims.get("org_role") or claims.get("role") or "").strip()
    if role_raw.startswith("org:"):
        role_raw = role_raw[4:]
    role_aliases = {"member": "viewer", "owner": "admin"}
    role_raw = role_aliases.get(role_raw, role_raw) or "viewer"

    role: Role = "viewer"
    if role_raw in {"viewer", "analyst", "admin", "platform-admin"}:
        role = role_raw  # type: ignore[assignment]

    # Two ways to become platform admin: by email (needs a JWT template or
    # CLERK_SECRET_KEY) or by Clerk user ID (works out-of-the-box).
    if email and email.lower() in {e.lower() for e in settings.admin_emails}:
        role = "platform-admin"
    if sub and sub in set(settings.admin_user_ids):
        role = "platform-admin"

    return Principal(
        user_id=sub,
        email=email,
        org_id=str(claims.get("org_id") or claims.get("organization_id") or "org_default"),
        org_slug=str(claims.get("org_slug") or "default"),
        role=role,
    )


def require_role(
    *allowed: Role,
) -> Callable[[Principal], Awaitable[Principal]]:
    async def dep(principal: Principal = Depends(get_principal)) -> Principal:
        if principal.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return principal

    return dep


require_any_member = require_role("viewer", "analyst", "admin", "platform-admin")
require_analyst = require_role("analyst", "admin", "platform-admin")
require_admin = require_role("admin", "platform-admin")
require_platform_admin = require_role("platform-admin")
