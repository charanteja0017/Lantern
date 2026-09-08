"""AES-GCM encrypted secret store.

The LLM role router references API keys by **name** (e.g. ``openai-primary``)
rather than carrying plaintext through the UI or DB. This module owns the
ciphertext + the envelope we use to encrypt it.

Design:

* One master key (``STRIX_MASTER_KEY``) is loaded once from the environment
  at process start. The key is 32 bytes encoded as base64url or hex.
* Each secret is encrypted with AES-256-GCM using a fresh 12-byte nonce.
* The ciphertext, nonce, and auth tag are stored together in Postgres
  (``strix_secrets`` table). We never leak the master key to the DB.
* Reads return plaintext only in the API worker - the web UI receives
  metadata (name, created_at, masked preview) via a separate schema.

If ``STRIX_MASTER_KEY`` is unset, the store operates in **disabled** mode:
``put`` raises, ``get`` returns ``None``. This lets the rest of the
application (the router in particular) degrade to environment-variable
fallback instead of crashing on a fresh deployment.
"""

from __future__ import annotations

import base64
import binascii
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, cast

from strix.api.services.db import get_pg_pool


logger = logging.getLogger(__name__)

_MASTER_KEY_ENV = "STRIX_MASTER_KEY"
_SECRET_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")


@dataclass
class SecretMetadata:
    name: str
    preview: str
    created_at: str | None
    updated_at: str | None


class SecretStoreError(RuntimeError):
    pass


# --- master key handling ----------------------------------------------------


def _decode_master_key(raw: str) -> bytes | None:
    """Accept either 64-char hex or base64-(url)-encoded 32 bytes."""
    raw = raw.strip()
    if not raw:
        return None
    # Hex form.
    if len(raw) == 64 and all(c in "0123456789abcdefABCDEF" for c in raw):
        try:
            return bytes.fromhex(raw)
        except ValueError:
            return None
    # Base64 / base64url form. Allow both urlsafe and standard alphabets.
    for decoder in (base64.urlsafe_b64decode, base64.b64decode):
        try:
            padding = "=" * (-len(raw) % 4)
            decoded = decoder(raw + padding)
        except (binascii.Error, ValueError):
            continue
        if len(decoded) == 32:
            return decoded
    return None


def get_master_key() -> bytes | None:
    raw = os.environ.get(_MASTER_KEY_ENV)
    if not raw:
        return None
    key = _decode_master_key(raw)
    if key is None:
        logger.error(
            "%s is set but not a valid 32-byte key (use 64-char hex or base64).",
            _MASTER_KEY_ENV,
        )
        return None
    return key


def is_enabled() -> bool:
    return get_master_key() is not None


# --- crypto primitives ------------------------------------------------------


def _aesgcm() -> Any:
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError as exc:  # pragma: no cover - resolved at deploy
        raise SecretStoreError(
            "cryptography is not installed; add 'cryptography>=42' to the API image"
        ) from exc
    return AESGCM


def _encrypt(plaintext: str, *, key: bytes, aad: bytes) -> tuple[bytes, bytes]:
    aesgcm_cls = cast("Any", _aesgcm())
    aesgcm = aesgcm_cls(key)
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), aad)
    return nonce, cast("bytes", ct)


def _decrypt(nonce: bytes, ciphertext: bytes, *, key: bytes, aad: bytes) -> str:
    aesgcm_cls = cast("Any", _aesgcm())
    aesgcm = aesgcm_cls(key)
    pt = cast("bytes", aesgcm.decrypt(nonce, ciphertext, aad))
    return pt.decode("utf-8")


def _preview(plaintext: str) -> str:
    if not plaintext:
        return ""
    if len(plaintext) <= 6:
        return "•" * len(plaintext)
    return f"{plaintext[:3]}…{plaintext[-3:]}"


# --- public API -------------------------------------------------------------


def validate_name(name: str) -> None:
    if not _SECRET_NAME_RE.fullmatch(name or ""):
        raise SecretStoreError(
            "Secret names must be 1-64 chars (a-z, A-Z, 0-9, '.', '_', '-') and start with an alphanumeric."
        )


async def put_secret(name: str, plaintext: str) -> SecretMetadata:
    """Upsert a secret under ``name``. Idempotent."""
    validate_name(name)
    key = get_master_key()
    if key is None:
        raise SecretStoreError(f"{_MASTER_KEY_ENV} is not configured; cannot store secrets.")
    pool = await get_pg_pool()
    if pool is None:
        raise SecretStoreError("Postgres is not configured; secrets require persistence.")
    nonce, ct = _encrypt(plaintext, key=key, aad=name.encode("utf-8"))
    preview = _preview(plaintext)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO strix_secrets (name, nonce, ciphertext, preview, created_at, updated_at)
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            ON CONFLICT (name) DO UPDATE SET
                nonce = EXCLUDED.nonce,
                ciphertext = EXCLUDED.ciphertext,
                preview = EXCLUDED.preview,
                updated_at = NOW()
            RETURNING name, preview, created_at, updated_at
            """,
            name,
            nonce,
            ct,
            preview,
        )
    return SecretMetadata(
        name=row["name"],
        preview=row["preview"] or "",
        created_at=row["created_at"].isoformat() if row["created_at"] else None,
        updated_at=row["updated_at"].isoformat() if row["updated_at"] else None,
    )


async def get_secret(name: str) -> str | None:
    """Return the plaintext secret or ``None`` when unavailable."""
    if not name:
        return None
    try:
        validate_name(name)
    except SecretStoreError:
        return None
    key = get_master_key()
    if key is None:
        return None
    pool = await get_pg_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT nonce, ciphertext FROM strix_secrets WHERE name=$1", name)
    if row is None:
        return None
    try:
        return _decrypt(
            bytes(row["nonce"]), bytes(row["ciphertext"]), key=key, aad=name.encode("utf-8")
        )
    except Exception as exc:
        logger.warning("Failed to decrypt secret %s: %s", name, exc)
        return None


async def delete_secret(name: str) -> bool:
    validate_name(name)
    pool = await get_pg_pool()
    if pool is None:
        return False
    async with pool.acquire() as conn:
        result = await conn.execute("DELETE FROM strix_secrets WHERE name=$1", name)
    return str(result).endswith("1")


async def list_secrets() -> list[SecretMetadata]:
    pool = await get_pg_pool()
    if pool is None:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT name, preview, created_at, updated_at FROM strix_secrets ORDER BY name"
        )
    return [
        SecretMetadata(
            name=row["name"],
            preview=row["preview"] or "",
            created_at=row["created_at"].isoformat() if row["created_at"] else None,
            updated_at=row["updated_at"].isoformat() if row["updated_at"] else None,
        )
        for row in rows
    ]


async def resolve_reference(ref: str | None) -> str | None:
    """Accept a value that *may* be a secret reference and return plaintext.

    Supported forms:

    * ``None`` / empty -> ``None``
    * ``secret://NAME`` / ``ref://NAME`` -> decrypt ``NAME`` from the store
    * plain string      -> return unchanged (lets legacy plaintext flow work)
    """
    if not ref:
        return None
    if ref.startswith(("secret://", "ref://")):
        _, _, name = ref.partition("://")
        return await get_secret(name)
    return ref


async def metadata(name: str) -> SecretMetadata | None:
    pool = await get_pg_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT name, preview, created_at, updated_at FROM strix_secrets WHERE name=$1",
            name,
        )
    if row is None:
        return None
    return SecretMetadata(
        name=row["name"],
        preview=row["preview"] or "",
        created_at=row["created_at"].isoformat() if row["created_at"] else None,
        updated_at=row["updated_at"].isoformat() if row["updated_at"] else None,
    )


async def as_public_dict(md: SecretMetadata) -> dict[str, Any]:
    return {
        "name": md.name,
        "preview": md.preview,
        "created_at": md.created_at,
        "updated_at": md.updated_at,
    }


__all__ = [
    "SecretMetadata",
    "SecretStoreError",
    "as_public_dict",
    "delete_secret",
    "get_master_key",
    "get_secret",
    "is_enabled",
    "list_secrets",
    "metadata",
    "put_secret",
    "resolve_reference",
    "validate_name",
]
