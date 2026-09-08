"""Signed URLs for embedded sidechannels (VNC, shell WS, …).

Tokens are opaque ``body_b64.sig_b64`` blobs produced with HMAC-SHA256 over the
canonical JSON payload (sorted keys). Verification mirrors minting so both
paths stay aligned.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

from fastapi import HTTPException


class SidechannelTokenError(Exception):
    """Non-HTTP-friendly validation failure (usable from WebSocket handlers)."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def _secret() -> str:
    return os.getenv("STRIX_SIDECHANNEL_SECRET", os.getenv("STRIX_MASTER_KEY", "dev-secret"))


def sign_sidechannel_token(payload: dict[str, Any]) -> str:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    sig = hmac.new(_secret().encode("utf-8"), body, hashlib.sha256).digest()
    return (
        base64.urlsafe_b64encode(body).decode("ascii").rstrip("=")
        + "."
        + base64.urlsafe_b64encode(sig).decode("ascii").rstrip("=")
    )


def _b64decode_padded(raw: str) -> bytes:
    pad = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode(raw + pad)


def verify_sidechannel_token(token: str | None, *, run_id: str, aud: str) -> dict[str, Any]:
    """Validate a sidechannel token; raise :class:`SidechannelTokenError` on failure."""

    if not token or not token.strip():
        raise SidechannelTokenError("missing sidechannel token")
    try:
        body_b64, sig_b64 = token.split(".", 1)
    except ValueError as err:
        raise SidechannelTokenError("malformed token") from err

    body = _b64decode_padded(body_b64)
    try:
        sig = _b64decode_padded(sig_b64)
    except (ValueError, OSError) as err:
        raise SidechannelTokenError("invalid signature encoding") from err

    expected = hmac.new(_secret().encode("utf-8"), body, hashlib.sha256).digest()
    if not hmac.compare_digest(sig, expected):
        raise SidechannelTokenError("invalid token signature")

    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as err:
        raise SidechannelTokenError("invalid token payload") from err

    if not isinstance(payload, dict):
        raise SidechannelTokenError("invalid token payload shape")

    now = int(time.time())
    exp = int(payload.get("exp") or 0)
    if exp < now:
        raise SidechannelTokenError("token expired")

    if str(payload.get("aud") or "") != aud:
        raise SidechannelTokenError("token is for a different channel")

    if str(payload.get("run_id") or "") != run_id:
        raise SidechannelTokenError("token is for a different run")

    return payload


def http_error_from_token_error(exc: SidechannelTokenError) -> HTTPException:
    status = 401 if exc.detail == "missing sidechannel token" else 403
    return HTTPException(status_code=status, detail=exc.detail)
