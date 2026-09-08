"""Vision tool: load an image from the sandbox FS into the multimodal channel."""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

from strix.tools.registry import register_tool


_DEFAULT_MAX_BYTES = 10 * 1024 * 1024
_HARD_MAX_BYTES = 20 * 1024 * 1024

_EXT_TO_MIME: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def _detect_mime(path: Path, raw: bytes) -> str | None:
    """Prefer magic-number detection; fall back to extension mapping."""
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if raw.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if raw.startswith(b"RIFF") and len(raw) > 11 and raw[8:12] == b"WEBP":
        return "image/webp"
    return _EXT_TO_MIME.get(path.suffix.lower())


@register_tool(sandbox_execution=True)
def view_image(
    path: str,
    note: str | None = None,
    max_bytes: int | None = None,
) -> dict[str, Any]:
    """Load an image file from the sandbox and return a multimodal payload.

    The executor recognises ``image_base64`` + ``mime_type`` in the result and
    forwards the image on the next agent turn as a proper ``image_url`` block,
    so vision-capable models see the raw pixels rather than a summary.
    """
    if not path or not isinstance(path, str) or not path.strip():
        return {"error": "'path' must be a non-empty string"}

    cap = _DEFAULT_MAX_BYTES if not max_bytes or max_bytes <= 0 else min(max_bytes, _HARD_MAX_BYTES)

    file_path = Path(path).expanduser()
    if not file_path.is_absolute():
        return {"error": f"'path' must be absolute (got: {path!r})"}

    try:
        resolved = file_path.resolve(strict=True)
    except (FileNotFoundError, OSError) as exc:
        return {"error": f"Cannot read {path!r}: {exc}"}

    if not resolved.is_file():
        return {"error": f"{path!r} is not a regular file"}

    try:
        size = resolved.stat().st_size
    except OSError as exc:
        return {"error": f"stat failed for {path!r}: {exc}"}

    if size <= 0:
        return {"error": f"{path!r} is empty"}
    if size > cap:
        return {
            "error": (
                f"{path!r} is {size} bytes, exceeds cap of {cap} bytes. "
                "Resize the image (e.g. `convert in.png -resize 1280x out.png`) "
                "and retry, or pass a larger max_bytes up to 20 MiB."
            )
        }

    try:
        raw = resolved.read_bytes()
    except OSError as exc:
        return {"error": f"read failed for {path!r}: {exc}"}

    mime = _detect_mime(resolved, raw)
    if mime is None:
        return {
            "error": (f"Unsupported image format for {path!r}. Supported: PNG, JPEG, GIF, WebP.")
        }

    encoded = base64.b64encode(raw).decode("ascii")

    result: dict[str, Any] = {
        "image_base64": encoded,
        "mime_type": mime,
        "path": str(resolved),
        "bytes": size,
    }
    if note:
        result["note"] = note
    return result
