"""Standalone smoke test for view_image tool logic (stdlib only)."""

from __future__ import annotations

import base64
import importlib.util
import struct
import sys
import tempfile
import zlib
from pathlib import Path


class _NoopRegister:
    """Stand in for @register_tool during smoke testing (no side effects)."""

    def __call__(self, *args, **kwargs):
        if args and callable(args[0]) and not kwargs:
            return args[0]

        def _wrap(fn):
            return fn

        return _wrap


def _fake_module_tree() -> None:
    fake_strix = type(sys)("strix")
    fake_tools = type(sys)("strix.tools")
    fake_registry = type(sys)("strix.tools.registry")
    fake_registry.register_tool = _NoopRegister()
    sys.modules["strix"] = fake_strix
    sys.modules["strix.tools"] = fake_tools
    sys.modules["strix.tools.registry"] = fake_registry


def _write_minimal_png(dst: Path) -> None:
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    ihdr_chunk = (
        struct.pack(">I", len(ihdr))
        + b"IHDR"
        + ihdr
        + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr))
    )
    raw = b"\x00\x00\x00\x00"
    compressed = zlib.compress(raw)
    idat_chunk = (
        struct.pack(">I", len(compressed))
        + b"IDAT"
        + compressed
        + struct.pack(">I", zlib.crc32(b"IDAT" + compressed))
    )
    iend_chunk = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", zlib.crc32(b"IEND"))
    dst.write_bytes(sig + ihdr_chunk + idat_chunk + iend_chunk)


def main() -> int:
    _fake_module_tree()

    mod_path = Path(__file__).resolve().parent.parent / "strix" / "tools" / "vision" / "view_image_actions.py"
    spec = importlib.util.spec_from_file_location("view_image_actions", mod_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["view_image_actions"] = mod
    spec.loader.exec_module(mod)

    view_image = mod.view_image

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        png = tmp_path / "x.png"
        _write_minimal_png(png)

        happy = view_image(str(png))
        assert "error" not in happy, happy
        assert happy["mime_type"] == "image/png"
        assert happy["bytes"] == png.stat().st_size
        assert base64.b64decode(happy["image_base64"]) == png.read_bytes()

        rel = view_image("relative/path.png")
        assert rel.get("error", "").startswith("'path' must be absolute"), rel

        missing = view_image(str(tmp_path / "does-not-exist.png"))
        assert "error" in missing and "Cannot read" in missing["error"], missing

        blank = view_image("")
        assert blank.get("error", "").startswith("'path' must be a non-empty"), blank

        too_big = tmp_path / "big.png"
        too_big.write_bytes(b"\x89PNG\r\n\x1a\n" + b"A" * 20_000_000)
        capped = view_image(str(too_big))
        assert "error" in capped and "exceeds cap" in capped["error"], capped

        txt = tmp_path / "note.txt"
        txt.write_bytes(b"hello")
        bad_fmt = view_image(str(txt))
        assert "error" in bad_fmt and "Unsupported image format" in bad_fmt["error"], bad_fmt

        jpg_bytes = b"\xff\xd8\xff" + b"junk" * 10
        jpg = tmp_path / "y.jpg"
        jpg.write_bytes(jpg_bytes)
        jpg_res = view_image(str(jpg), note="login form")
        assert jpg_res.get("mime_type") == "image/jpeg"
        assert jpg_res.get("note") == "login form"

        gif_bytes = b"GIF89a" + b"\x00" * 20
        gif = tmp_path / "z.gif"
        gif.write_bytes(gif_bytes)
        gif_res = view_image(str(gif))
        assert gif_res.get("mime_type") == "image/gif"

        webp_bytes = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 12
        webp = tmp_path / "w.webp"
        webp.write_bytes(webp_bytes)
        webp_res = view_image(str(webp))
        assert webp_res.get("mime_type") == "image/webp"

    print("OK: view_image handles all cases (png, jpg, gif, webp, errors, cap)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
