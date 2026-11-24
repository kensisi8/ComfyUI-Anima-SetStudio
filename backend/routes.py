"""HTTP API routes registered on ComfyUI's PromptServer."""

from __future__ import annotations

import base64
import os
from typing import Any

from .composer import build_batch_jobs
from .image_importer import import_set_from_image_bytes
from .storage import DEFAULT_GENERATION_SETTINGS, SetStorage

API_PREFIX = "/anima-set-studio/api"
MAX_IMAGE_UPLOAD_BYTES = 30 * 1024 * 1024  # 30 MB

FALLBACK_SAMPLERS = [
    "er_sde",
    "res_multistep",
    "euler",
    "euler_ancestral",
    "dpmpp_2m",
    "dpmpp_2m_sde",
    "dpmpp_3m_sde",
    "uni_pc",
]

FALLBACK_SCHEDULERS = [
    "simple",
    "beta",
    "normal",
    "karras",
    "exponential",
    "sgm_uniform",
    "ddim_uniform",
]

FALLBACK_CLIP_TYPES = [
    "lumina2",
    "stable_diffusion",
    "sdxl",
    "flux",
    "sd3",
    "qwen_image",
]

FALLBACK_WEIGHT_DTYPES = [
    "default",
    "fp8_e4m3fn",
    "fp8_e4m3fn_fast",
    "fp8_e5m2",
]


def _safe_filename_list(*folder_names: str) -> list[str]:
    try:
        import folder_paths  # type: ignore
    except Exception:
        return []
    seen: set[str] = set()
    items: list[str] = []
    for folder in folder_names:
        try:
            names = folder_paths.get_filename_list(folder) or []
        except Exception:
            names = []
        for raw in names:
            clean = str(raw).replace("\\", "/")
            if clean and clean not in seen:
                seen.add(clean)
                items.append(clean)
    return items


def _detect_anima_tools() -> tuple[bool, str]:
    """Detect whether Comfyui-Anima-Tools is loaded and locate its web extension folder name."""
    has_nodes = False
    try:
        import nodes  # type: ignore

        mappings = getattr(nodes, "NODE_CLASS_MAPPINGS", {}) or {}
        has_nodes = (
            "AnimaMultiLoraLoader" in mappings
            and "AnimaPromptPlusClipEncode" in mappings
        )
    except Exception:
        has_nodes = False

    ext_name = "Comfyui-Anima-Tools"
    try:
        custom_nodes_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        if os.path.isdir(custom_nodes_dir):
            for entry in os.listdir(custom_nodes_dir):
                candidate = os.path.join(custom_nodes_dir, entry, "js", "anima_gallery_selector.js")
                if os.path.isfile(candidate):
                    ext_name = entry
                    break
    except Exception:
        pass
    return has_nodes, ext_name


def collect_runtime_options() -> dict[str, Any]:
    """Gather live model/sampler/scheduler lists and Anima-Tools capability flags."""
    diffusion_models = _safe_filename_list("diffusion_models", "unet")
    clips = _safe_filename_list("text_encoders", "clip")
    vaes = _safe_filename_list("vae")
    loras = _safe_filename_list("loras")

    samplers = list(FALLBACK_SAMPLERS)
    schedulers = list(FALLBACK_SCHEDULERS)
    try:
        import comfy.samplers  # type: ignore

        if hasattr(comfy.samplers, "KSampler"):
            live_samplers = list(getattr(comfy.samplers.KSampler, "SAMPLERS", []) or [])
            live_schedulers = list(getattr(comfy.samplers.KSampler, "SCHEDULERS", []) or [])
            if live_samplers:
                samplers = live_samplers
            if live_schedulers:
                schedulers = live_schedulers
    except Exception:
        pass

    clip_types = list(FALLBACK_CLIP_TYPES)
    weight_dtypes = list(FALLBACK_WEIGHT_DTYPES)
    try:
        import nodes  # type: ignore

        mappings = getattr(nodes, "NODE_CLASS_MAPPINGS", {}) or {}
        clip_loader = mappings.get("CLIPLoader")
        if clip_loader and hasattr(clip_loader, "INPUT_TYPES"):
            req = clip_loader.INPUT_TYPES().get("required", {})
            type_spec = req.get("type")
            if isinstance(type_spec, tuple) and type_spec and isinstance(type_spec[0], list):
                clip_types = [str(x) for x in type_spec[0]]
        unet_loader = mappings.get("UNETLoader")
        if unet_loader and hasattr(unet_loader, "INPUT_TYPES"):
            req = unet_loader.INPUT_TYPES().get("required", {})
            dtype_spec = req.get("weight_dtype")
            if isinstance(dtype_spec, tuple) and dtype_spec and isinstance(dtype_spec[0], list):
                weight_dtypes = [str(x) for x in dtype_spec[0]]
    except Exception:
        pass

    has_anima_tools, anima_tools_ext_name = _detect_anima_tools()
    return {
        "diffusion_models": diffusion_models,
        "clips": clips,
        "vaes": vaes,
        "loras": loras,
        "samplers": samplers,
        "schedulers": schedulers,
        "clip_types": clip_types,
        "weight_dtypes": weight_dtypes,
        "has_anima_tools": has_anima_tools,
        "anima_tools_ext_name": anima_tools_ext_name,
        "defaults": dict(DEFAULT_GENERATION_SETTINGS),
    }


def handle_api_action(
    storage: SetStorage,
    action: str,
    *,
    set_id: str = "",
    payload: dict[str, Any] | None = None,
    options_provider=collect_runtime_options,
) -> tuple[int, dict[str, Any]]:
    """Framework-independent API dispatcher for clean unit testing and aiohttp routing."""
    try:
        if action == "list_sets":
            return 200, {"success": True, "sets": storage.list_sets()}

        if action == "get_set":
            item = storage.get_set(set_id)
            if item is None:
                return 404, {"success": False, "error": "セットが見つかりません"}
            return 200, {"success": True, "set": item}

        if action == "save_set":
            saved = storage.save_set(payload or {})
            return 200, {"success": True, "set": saved}

        if action == "duplicate_set":
            new_name = (payload or {}).get("name") if isinstance(payload, dict) else None
            duplicated = storage.duplicate_set(set_id, new_name=new_name)
            return 200, {"success": True, "set": duplicated}

        if action == "delete_set":
            deleted = storage.delete_set(set_id)
            if not deleted:
                return 404, {"success": False, "error": "セットが見つかりません"}
            return 200, {"success": True, "deleted": True, "id": set_id}

        if action == "get_state":
            return 200, {"success": True, "state": storage.get_state()}

        if action == "save_state":
            state = storage.save_state(payload or {})
            return 200, {"success": True, "state": state}

        if action == "get_options":
            return 200, {"success": True, "options": options_provider()}

        if action == "build_jobs":
            opts = options_provider()
            req = payload or {}
            use_anima = bool(opts.get("has_anima_tools", False))
            if "use_anima_tools" in req and req["use_anima_tools"] is not None:
                use_anima = bool(req["use_anima_tools"])
            jobs = build_batch_jobs(req, use_anima_tools=use_anima)
            return 200, {
                "success": True,
                "jobs": jobs,
                "total": len(jobs),
                "use_anima_tools": use_anima,
            }

        if action == "import_image":
            req = payload or {}
            raw_bytes = req.get("image_bytes")
            if raw_bytes is None:
                b64_val = str(req.get("image_base64") or "").strip()
                if b64_val.startswith("data:") and "," in b64_val:
                    b64_val = b64_val.split(",", 1)[1]
                if not b64_val:
                    raise ValueError("画像ファイルが指定されていません")
                try:
                    raw_bytes = base64.b64decode(b64_val)
                except Exception as exc:
                    raise ValueError("画像データのBase64デコードに失敗しました") from exc
            if not isinstance(raw_bytes, (bytes, bytearray)):
                raise ValueError("画像データの形式が不正です")
            if len(raw_bytes) > MAX_IMAGE_UPLOAD_BYTES:
                raise ValueError("画像サイズが大きすぎます（上限 30MB）")

            opts = options_provider()
            available_loras = opts.get("loras") if isinstance(opts, dict) else None
            imported = import_set_from_image_bytes(
                bytes(raw_bytes),
                filename=str(req.get("filename") or ""),
                available_loras=available_loras,
            )
            return 200, {"success": True, "imported": imported}

        if action == "upload_thumbnail":
            req = payload or {}
            raw_bytes = req.get("image_bytes")
            if raw_bytes is None:
                b64_val = str(req.get("image_base64") or "").strip()
                if b64_val.startswith("data:") and "," in b64_val:
                    b64_val = b64_val.split(",", 1)[1]
                if not b64_val:
                    raise ValueError("サムネイル画像が指定されていません")
                try:
                    raw_bytes = base64.b64decode(b64_val)
                except Exception as exc:
                    raise ValueError("サムネイル画像のBase64デコードに失敗しました") from exc
            if not isinstance(raw_bytes, (bytes, bytearray)):
                raise ValueError("サムネイル画像の形式が不正です")
            saved_thumb = storage.save_thumbnail(bytes(raw_bytes))
            saved_thumb["url"] = f"{API_PREFIX}/thumbnails/{saved_thumb['thumbnail']}"
            return 200, {"success": True, **saved_thumb}

        return 404, {"success": False, "error": f"Unknown action: {action}"}
    except FileNotFoundError as exc:
        return 404, {"success": False, "error": str(exc)}
    except ValueError as exc:
        return 400, {"success": False, "error": str(exc)}
    except Exception as exc:
        return 500, {"success": False, "error": str(exc)}


_ROUTES_REGISTERED = False


def register_routes(storage: SetStorage | None = None) -> bool:
    """Register routes onto ComfyUI PromptServer when running inside ComfyUI."""
    global _ROUTES_REGISTERED
    if _ROUTES_REGISTERED:
        return True
    try:
        from aiohttp import web  # type: ignore
        from server import PromptServer  # type: ignore
    except Exception:
        return False

    server_instance = getattr(PromptServer, "instance", None)
    if server_instance is None or getattr(server_instance, "routes", None) is None:
        return False

    store = storage or SetStorage()
    routes = server_instance.routes

    async def _read_json(request) -> dict[str, Any]:
        try:
            data = await request.json()
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    @routes.get(f"{API_PREFIX}/sets")
    async def api_list_sets(request):
        status, body = handle_api_action(store, "list_sets")
        return web.json_response(body, status=status)

    @routes.get(f"{API_PREFIX}/sets/{{set_id}}")
    async def api_get_set(request):
        status, body = handle_api_action(store, "get_set", set_id=request.match_info.get("set_id", ""))
        return web.json_response(body, status=status)

    @routes.post(f"{API_PREFIX}/sets")
    async def api_save_set(request):
        data = await _read_json(request)
        status, body = handle_api_action(store, "save_set", payload=data)
        return web.json_response(body, status=status)

    @routes.post(f"{API_PREFIX}/sets/{{set_id}}/duplicate")
    async def api_duplicate_set(request):
        data = await _read_json(request)
        status, body = handle_api_action(
            store,
            "duplicate_set",
            set_id=request.match_info.get("set_id", ""),
            payload=data,
        )
        return web.json_response(body, status=status)

    @routes.delete(f"{API_PREFIX}/sets/{{set_id}}")
    async def api_delete_set(request):
        status, body = handle_api_action(store, "delete_set", set_id=request.match_info.get("set_id", ""))
        return web.json_response(body, status=status)

    @routes.get(f"{API_PREFIX}/state")
    async def api_get_state(request):
        status, body = handle_api_action(store, "get_state")
        return web.json_response(body, status=status)

    @routes.post(f"{API_PREFIX}/state")
    async def api_save_state(request):
        data = await _read_json(request)
        status, body = handle_api_action(store, "save_state", payload=data)
        return web.json_response(body, status=status)

    @routes.get(f"{API_PREFIX}/options")
    async def api_get_options(request):
        status, body = handle_api_action(store, "get_options")
        return web.json_response(body, status=status)

    @routes.post(f"{API_PREFIX}/build-jobs")
    async def api_build_jobs(request):
        data = await _read_json(request)
        status, body = handle_api_action(store, "build_jobs", payload=data)
        return web.json_response(body, status=status)

    @routes.post(f"{API_PREFIX}/import-image")
    async def api_import_image(request):
        content_type = (request.content_type or "").lower()
        if content_type.startswith("multipart/"):
            reader = await request.multipart()
            image_bytes = b""
            filename = ""
            while True:
                field = await reader.next()
                if field is None:
                    break
                if field.name == "image":
                    filename = field.filename or ""
                    chunks: list[bytes] = []
                    total_len = 0
                    while True:
                        chunk = await field.read_chunk(65536)
                        if not chunk:
                            break
                        total_len += len(chunk)
                        if total_len > MAX_IMAGE_UPLOAD_BYTES:
                            return web.json_response(
                                {"success": False, "error": "画像サイズが大きすぎます（上限 30MB）"},
                                status=400,
                            )
                        chunks.append(chunk)
                    image_bytes = b"".join(chunks)
                    break
            status, body = handle_api_action(
                store,
                "import_image",
                payload={"image_bytes": image_bytes, "filename": filename},
            )
            return web.json_response(body, status=status)

        data = await _read_json(request)
        status, body = handle_api_action(store, "import_image", payload=data)
        return web.json_response(body, status=status)

    @routes.post(f"{API_PREFIX}/thumbnails")
    async def api_upload_thumbnail(request):
        content_type = (request.content_type or "").lower()
        if content_type.startswith("multipart/"):
            reader = await request.multipart()
            image_bytes = b""
            while True:
                field = await reader.next()
                if field is None:
                    break
                if field.name == "image":
                    chunks: list[bytes] = []
                    total_len = 0
                    while True:
                        chunk = await field.read_chunk(65536)
                        if not chunk:
                            break
                        total_len += len(chunk)
                        if total_len > MAX_IMAGE_UPLOAD_BYTES:
                            return web.json_response(
                                {"success": False, "error": "画像サイズが大きすぎます（上限 30MB）"},
                                status=400,
                            )
                        chunks.append(chunk)
                    image_bytes = b"".join(chunks)
                    break
            status, body = handle_api_action(
                store,
                "upload_thumbnail",
                payload={"image_bytes": image_bytes},
            )
            return web.json_response(body, status=status)

        data = await _read_json(request)
        status, body = handle_api_action(store, "upload_thumbnail", payload=data)
        return web.json_response(body, status=status)

    @routes.get(f"{API_PREFIX}/thumbnails/{{filename}}")
    async def api_get_thumbnail(request):
        filename = request.match_info.get("filename", "")
        try:
            path = store.get_thumbnail_path(filename)
        except ValueError as exc:
            return web.json_response({"success": False, "error": str(exc)}, status=400)
        if not path:
            return web.json_response({"success": False, "error": "サムネイルが見つかりません"}, status=404)
        ext = os.path.splitext(path)[1].lower()
        mime = "image/webp" if ext == ".webp" else "image/jpeg"
        with open(path, "rb") as f:
            raw = f.read()
        return web.Response(
            body=raw,
            content_type=mime,
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )

    _ROUTES_REGISTERED = True
    print("[Anima SetStudio] Registered API routes under /anima-set-studio/api")
    return True
