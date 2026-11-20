"""ComfyUI-Anima-SetStudio extension entrypoint."""

from __future__ import annotations

NODE_CLASS_MAPPINGS: dict = {}
NODE_DISPLAY_NAME_MAPPINGS: dict = {}
WEB_DIRECTORY = "./js"

try:
    from .backend.routes import register_routes

    register_routes()
except Exception as exc:
    print(f"[Anima SetStudio] Route registration skipped/failed: {exc}")

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]
