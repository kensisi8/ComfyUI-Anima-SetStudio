"""Persistent storage for ComfyUI-Anima-SetStudio sets and workspace state."""

from __future__ import annotations

import copy
import io
import json
import math
import os
import re
import secrets
import tempfile
from datetime import datetime, timezone
from typing import Any

SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
SAFE_THUMB_FILENAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}\.(?:webp|jpg|jpeg)$")
ASPECT_RATIO_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)\s*$")
MAX_THUMB_DIMENSION = 320
DEFAULT_THUMB_WEBP_QUALITY = 75
DEFAULT_THUMB_JPEG_QUALITY = 78
MAX_THUMB_UPLOAD_BYTES = 20 * 1024 * 1024  # Raw upload ceiling before downscale
MAX_SEED_VALUE = 2**53 - 1
VALID_SEED_MODES = ("randomize", "fixed", "increment", "decrement")
DEFAULT_BASE_RESOLUTION = 1024
DEFAULT_ASPECT_RATIO = "2:3"
MIN_BASE_RESOLUTION = 512
MAX_BASE_RESOLUTION = 2048
ASPECT_RATIO_PRESETS: tuple[tuple[str, float], ...] = (
    ("2:3", 2 / 3),
    ("3:4", 3 / 4),
    ("4:5", 4 / 5),
    ("9:16", 9 / 16),
    ("1:1", 1.0),
    ("4:3", 4 / 3),
    ("3:2", 3 / 2),
    ("16:9", 16 / 9),
)

LORA_OPTIONAL_STR_KEYS = (
    "display_name",
    "storage_root_id",
    "model_id",
    "version_id",
    "version_name",
    "preview_url",
    "civitai_url",
    "base_model",
)

DEFAULT_GENERATION_SETTINGS: dict[str, Any] = {
    "unet_name": "oneObsessionAnima_v50.safetensors",
    "weight_dtype": "default",
    "clip_name": "qwen_3_06b_base.safetensors",
    "clip_type": "lumina2",
    "clip_device": "default",
    "vae_name": "qwen_image_vae.safetensors",
    "shift": 3.0,
    "steps": 30,
    "cfg": 4.0,
    "sampler_name": "er_sde",
    "scheduler": "simple",
    "denoise": 1.0,
    "seed_mode": "randomize",
    "seed": 0,
    "base_resolution": DEFAULT_BASE_RESOLUTION,
    "default_aspect_ratio": DEFAULT_ASPECT_RATIO,
    "width": 832,
    "height": 1248,
    "images_per_set": 1,
    "filename_prefix": "%date:yyyyMMdd%/%date:yyyyMMdd%",
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def generate_id(prefix: str = "set") -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    token = secrets.token_hex(3)
    return f"{prefix}_{stamp}_{token}"


def validate_id(raw_id: Any) -> str:
    value = str(raw_id or "").strip()
    if not SAFE_ID_RE.match(value):
        raise ValueError(f"Invalid set ID: {raw_id!r}")
    return value


def _format_ratio_part(val: float) -> str:
    rounded = round(val, 2)
    if abs(rounded - round(rounded)) < 1e-6:
        return str(int(round(rounded)))
    return f"{rounded:.2f}".rstrip("0").rstrip(".")


def normalize_aspect_ratio(raw_ratio: Any, *, allow_empty: bool = True) -> str:
    """Normalize an aspect ratio string like '2:3', '16:9', or '' (inherit common)."""
    text = str(raw_ratio or "").strip()
    if not text or text.lower() in ("common", "default", "auto", "inherit"):
        return "" if allow_empty else DEFAULT_ASPECT_RATIO
    match = ASPECT_RATIO_RE.match(text)
    if not match:
        return "" if allow_empty else DEFAULT_ASPECT_RATIO
    try:
        w = float(match.group(1))
        h = float(match.group(2))
    except ValueError:
        return "" if allow_empty else DEFAULT_ASPECT_RATIO
    if not (math.isfinite(w) and math.isfinite(h)) or w <= 0 or h <= 0:
        return "" if allow_empty else DEFAULT_ASPECT_RATIO
    ratio = w / h
    if ratio < 0.2 or ratio > 5.0:
        return "" if allow_empty else DEFAULT_ASPECT_RATIO
    return f"{_format_ratio_part(w)}:{_format_ratio_part(h)}"


def parse_aspect_ratio_pair(raw_ratio: Any, *, fallback: str = DEFAULT_ASPECT_RATIO) -> tuple[float, float]:
    norm = normalize_aspect_ratio(raw_ratio, allow_empty=False) or fallback
    match = ASPECT_RATIO_RE.match(norm)
    if not match:
        return (2.0, 3.0)
    return (float(match.group(1)), float(match.group(2)))


def _round_to_step(val: float, step: int = 16, min_v: int = 64, max_v: int = 4096) -> int:
    snapped = int(round(val / step)) * step
    return max(min_v, min(max_v, snapped))


def compute_dimensions_for_aspect_ratio(
    base_resolution: Any,
    aspect_ratio: Any,
    *,
    fallback_ratio: str = DEFAULT_ASPECT_RATIO,
    step: int = 16,
) -> tuple[int, int]:
    """Compute (width, height) keeping pixel area ~= base_resolution^2 for the given aspect ratio."""
    try:
        base = int(round(float(base_resolution)))
    except (TypeError, ValueError):
        base = DEFAULT_BASE_RESOLUTION
    base = max(MIN_BASE_RESOLUTION, min(MAX_BASE_RESOLUTION, base))

    rw, rh = parse_aspect_ratio_pair(aspect_ratio or fallback_ratio, fallback=fallback_ratio)
    area = float(base) * float(base)
    raw_w = math.sqrt(area * (rw / rh))
    raw_h = math.sqrt(area * (rh / rw))
    return (_round_to_step(raw_w, step=step), _round_to_step(raw_h, step=step))


def detect_aspect_ratio_from_size(width: int, height: int) -> str:
    """Map concrete image dimensions (e.g. 832x1216) to a preset or simplified W:H ratio."""
    if width <= 0 or height <= 0:
        return ""
    target = width / height
    best_preset = ""
    best_rel_err = 1.0
    for label, preset_val in ASPECT_RATIO_PRESETS:
        rel_err = abs(target - preset_val) / preset_val
        if rel_err < best_rel_err:
            best_rel_err = rel_err
            best_preset = label
    if best_preset and best_rel_err <= 0.04:
        return best_preset

    divisor = math.gcd(int(width), int(height)) or 1
    sw = int(width) // divisor
    sh = int(height) // divisor
    if sw <= 32 and sh <= 32:
        return normalize_aspect_ratio(f"{sw}:{sh}", allow_empty=True)
    # Approximate with clean small integers when GCD leaves large numbers
    scale = 10.0 / min(width, height)
    aw = max(1, int(round(width * scale)))
    ah = max(1, int(round(height * scale)))
    g2 = math.gcd(aw, ah) or 1
    return normalize_aspect_ratio(f"{aw // g2}:{ah // g2}", allow_empty=True)


def sanitize_thumbnail_name(raw_name: Any) -> str:
    value = str(raw_name or "").strip()
    if not value:
        return ""
    if not SAFE_THUMB_FILENAME_RE.match(value):
        return ""
    return value


def validate_thumbnail_name(raw_name: Any) -> str:
    value = sanitize_thumbnail_name(raw_name)
    if not value:
        raise ValueError(f"Invalid thumbnail filename: {raw_name!r}")
    return value


def _detect_lightweight_image_ext(raw_bytes: bytes) -> str | None:
    if len(raw_bytes) >= 12 and raw_bytes[:4] == b"RIFF" and raw_bytes[8:12] == b"WEBP":
        return "webp"
    if raw_bytes.startswith(b"\xff\xd8\xff"):
        return "jpg"
    return None


def optimize_thumbnail_bytes(
    raw_bytes: bytes,
    *,
    max_dimension: int = MAX_THUMB_DIMENSION,
    webp_quality: int = DEFAULT_THUMB_WEBP_QUALITY,
) -> tuple[bytes, str, int, int]:
    """Downscale and compress thumbnail bytes into lightweight WebP (or JPEG fallback).

    Uses Pillow when available (always installed in ComfyUI) to guarantee
    server-side resizing & WebP conversion, and falls back gracefully to
    validating client-optimized WebP/JPEG bytes when Pillow is absent.
    Returns (encoded_bytes, ext, width, height).
    """
    if not raw_bytes:
        raise ValueError("サムネイル画像データが空です")
    if len(raw_bytes) > MAX_THUMB_UPLOAD_BYTES:
        raise ValueError("画像サイズが大きすぎます（上限 20MB）")

    try:
        from PIL import Image, ImageOps  # type: ignore
    except Exception:
        ext = _detect_lightweight_image_ext(raw_bytes)
        if ext is None:
            raise ValueError("WebP または JPEG 形式の軽量サムネイル画像をアップロードしてください")
        return raw_bytes, ext, 0, 0

    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            img = ImageOps.exif_transpose(img)
            src_w, src_h = img.size
            if src_w <= 0 or src_h <= 0:
                raise ValueError("画像の解像度が不正です")

            # Keep aspect ratio while bounding longest edge to max_dimension
            if max(src_w, src_h) > max_dimension:
                resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.BICUBIC)
                img.thumbnail((max_dimension, max_dimension), resampling)
            out_w, out_h = img.size

            # Flatten transparency onto a dark neutral backdrop so lossy WebP/JPEG stays tiny
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                rgba = img.convert("RGBA")
                bg = Image.new("RGB", rgba.size, (26, 29, 36))
                bg.paste(rgba, mask=rgba.split()[-1])
                img = bg
            elif img.mode != "RGB":
                img = img.convert("RGB")

            # Prefer WebP (smallest file size); fallback to JPEG if Pillow lacks WebP codec
            try:
                buf = io.BytesIO()
                img.save(buf, format="WEBP", quality=webp_quality, method=6)
                out_bytes = buf.getvalue()
                # If still relatively heavy, tighten quality slightly
                if len(out_bytes) > 45 * 1024 and webp_quality > 60:
                    buf2 = io.BytesIO()
                    img.save(buf2, format="WEBP", quality=60, method=6)
                    if len(buf2.getvalue()) < len(out_bytes):
                        out_bytes = buf2.getvalue()
                return out_bytes, "webp", out_w, out_h
            except Exception:
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=DEFAULT_THUMB_JPEG_QUALITY, optimize=True)
                return buf.getvalue(), "jpg", out_w, out_h
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("サムネイル画像を読み込めませんでした（PNG / WebP / JPEG を指定してください）") from exc


def normalize_lora_entry(value: Any) -> dict[str, Any] | None:
    """Normalize a LoRA entry compatible with Comfyui-Anima-Tools AnimaMultiLoraLoader."""
    if not isinstance(value, dict):
        return None
    name = str(value.get("name") or "").strip().replace("\\", "/")
    if not name:
        return None
    try:
        strength = float(value.get("strength_model", 1.0))
    except (TypeError, ValueError):
        strength = 1.0
    if not (strength == strength):  # NaN guard
        strength = 1.0
    normalized: dict[str, Any] = {
        "name": name,
        "strength_model": strength,
        "enabled": value.get("enabled") is not False,
    }
    for key in LORA_OPTIONAL_STR_KEYS:
        val = value.get(key)
        if val is not None and str(val) != "":
            normalized[key] = val
    trained_words = value.get("trained_words")
    if isinstance(trained_words, list):
        cleaned = [str(w).strip() for w in trained_words if str(w or "").strip()]
        if cleaned:
            normalized["trained_words"] = cleaned
    return normalized


def normalize_lora_list(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            return []
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    for item in value:
        normalized = normalize_lora_entry(item)
        if normalized is not None:
            result.append(normalized)
    return result


def normalize_prompt_box(value: Any, fallback_index: int = 0) -> dict[str, Any] | None:
    """Normalize a prompt box compatible with Comfyui-Anima-Tools AnimaPromptPlus."""
    if not isinstance(value, dict):
        return None
    raw_id = str(value.get("id") or "").strip()
    box_id = raw_id if raw_id else f"b{fallback_index}_{secrets.token_hex(2)}"
    label = str(value.get("label") or "").strip()
    text = str(value.get("text") or "")
    disabled = bool(value.get("disabled", False))
    raw_random = value.get("random")
    if isinstance(raw_random, list):
        random_list = [str(x).strip() for x in raw_random if str(x or "").strip()]
    else:
        random_list = []
    raw_picks = value.get("picks")
    picks = copy.deepcopy(raw_picks) if isinstance(raw_picks, dict) else {}
    return {
        "id": box_id,
        "label": label,
        "text": text,
        "disabled": disabled,
        "random": random_list,
        "picks": picks,
    }


def normalize_prompt_boxes(value: Any, ensure_non_empty: bool = False) -> list[dict[str, Any]]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            value = []
    if not isinstance(value, list):
        value = []
    result: list[dict[str, Any]] = []
    for idx, item in enumerate(value):
        normalized = normalize_prompt_box(item, fallback_index=idx)
        if normalized is not None:
            result.append(normalized)
    if ensure_non_empty and not result:
        result.append(
            {
                "id": f"b0_{secrets.token_hex(2)}",
                "label": "",
                "text": "",
                "disabled": False,
                "random": [],
                "picks": {},
            }
        )
    return result


def normalize_settings(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    merged = dict(DEFAULT_GENERATION_SETTINGS)
    for key in (
        "unet_name",
        "weight_dtype",
        "clip_name",
        "clip_type",
        "clip_device",
        "vae_name",
        "sampler_name",
        "scheduler",
        "filename_prefix",
    ):
        val = data.get(key)
        if val is not None and str(val).strip() != "":
            merged[key] = str(val).strip()

    def _to_float(val: Any, default: float, min_v: float, max_v: float) -> float:
        try:
            num = float(val)
            if num != num:
                return default
            return max(min_v, min(max_v, num))
        except (TypeError, ValueError):
            return default

    def _to_int(val: Any, default: int, min_v: int, max_v: int) -> int:
        try:
            if isinstance(val, bool):
                return default
            if isinstance(val, int):
                num = val
            else:
                s = str(val).strip()
                num = int(s) if re.fullmatch(r"[+-]?\d+", s) else int(round(float(s)))
            return max(min_v, min(max_v, num))
        except (TypeError, ValueError):
            return default

    raw_seed_mode = str(data.get("seed_mode") or "").strip().lower()
    if raw_seed_mode in VALID_SEED_MODES:
        merged["seed_mode"] = raw_seed_mode
    merged["seed"] = _to_int(data.get("seed"), DEFAULT_GENERATION_SETTINGS["seed"], 0, MAX_SEED_VALUE)

    merged["shift"] = _to_float(data.get("shift"), DEFAULT_GENERATION_SETTINGS["shift"], 0.0, 100.0)
    merged["steps"] = _to_int(data.get("steps"), DEFAULT_GENERATION_SETTINGS["steps"], 1, 200)
    merged["cfg"] = _to_float(data.get("cfg"), DEFAULT_GENERATION_SETTINGS["cfg"], 0.0, 30.0)
    merged["denoise"] = _to_float(data.get("denoise"), DEFAULT_GENERATION_SETTINGS["denoise"], 0.0, 1.0)

    has_explicit_base = data.get("base_resolution") not in (None, "")
    has_explicit_ratio = data.get("default_aspect_ratio") not in (None, "")
    has_explicit_wh = data.get("width") not in (None, "") or data.get("height") not in (None, "")

    merged["default_aspect_ratio"] = normalize_aspect_ratio(
        data.get("default_aspect_ratio"),
        allow_empty=False,
    )

    if has_explicit_base:
        merged["base_resolution"] = _to_int(
            data.get("base_resolution"),
            DEFAULT_BASE_RESOLUTION,
            MIN_BASE_RESOLUTION,
            MAX_BASE_RESOLUTION,
        )
        comp_w, comp_h = compute_dimensions_for_aspect_ratio(
            merged["base_resolution"],
            merged["default_aspect_ratio"],
        )
        merged["width"] = comp_w
        merged["height"] = comp_h
    elif has_explicit_wh:
        merged["width"] = _to_int(data.get("width"), DEFAULT_GENERATION_SETTINGS["width"], 64, 4096)
        merged["height"] = _to_int(data.get("height"), DEFAULT_GENERATION_SETTINGS["height"], 64, 4096)
        derived_base = _round_to_step(
            math.sqrt(merged["width"] * merged["height"]),
            step=16,
            min_v=MIN_BASE_RESOLUTION,
            max_v=MAX_BASE_RESOLUTION,
        )
        merged["base_resolution"] = derived_base
        if not has_explicit_ratio:
            detected = detect_aspect_ratio_from_size(merged["width"], merged["height"])
            if detected:
                merged["default_aspect_ratio"] = detected
    else:
        merged["base_resolution"] = DEFAULT_BASE_RESOLUTION
        comp_w, comp_h = compute_dimensions_for_aspect_ratio(
            merged["base_resolution"],
            merged["default_aspect_ratio"],
        )
        merged["width"] = comp_w
        merged["height"] = comp_h

    merged["images_per_set"] = _to_int(
        data.get("images_per_set"), DEFAULT_GENERATION_SETTINGS["images_per_set"], 1, 100
    )
    return merged


def default_workspace_state() -> dict[str, Any]:
    return {
        "common_prompt_boxes": [
            {
                "id": "common_1",
                "label": "共通プロンプト",
                "text": "",
                "disabled": False,
                "random": [],
                "picks": {},
            }
        ],
        "common_separator": ", ",
        "common_loras": [],
        "negative_prompt": "low quality, bad anatomy, extra digits, missing digits, extra limbs, missing limbs",
        "excluded_categories": [],
        "settings": dict(DEFAULT_GENERATION_SETTINGS),
        "selected_sets": [],
        "updated_at": utc_now_iso(),
    }


def resolve_default_base_dir() -> str:
    """Resolve ComfyUI/user/anima_set_studio without requiring ComfyUI during tests."""
    env_dir = os.environ.get("ANIMA_SET_STUDIO_DATA_DIR")
    if env_dir:
        return os.path.abspath(env_dir)
    try:
        import folder_paths  # type: ignore

        user_dir = folder_paths.get_user_directory()
        if user_dir:
            return os.path.join(user_dir, "anima_set_studio")
    except Exception:
        pass
    package_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(package_root, "user_data")


def _atomic_write_json(path: str, data: dict[str, Any]) -> None:
    parent = os.path.dirname(path)
    os.makedirs(parent, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".tmp_", suffix=".json", dir=parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except Exception:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
        raise


class SetStorage:
    """File-backed JSON storage for LoRA/Prompt sets and workspace state."""

    def __init__(self, base_dir: str | None = None) -> None:
        self.base_dir = os.path.abspath(base_dir or resolve_default_base_dir())
        self.sets_dir = os.path.join(self.base_dir, "sets")
        self.thumbs_dir = os.path.join(self.base_dir, "thumbnails")
        self.state_path = os.path.join(self.base_dir, "state.json")
        os.makedirs(self.sets_dir, exist_ok=True)
        os.makedirs(self.thumbs_dir, exist_ok=True)

    def _set_file_path(self, set_id: str) -> str:
        safe_id = validate_id(set_id)
        sets_real = os.path.realpath(self.sets_dir)
        target = os.path.realpath(os.path.join(sets_real, f"{safe_id}.json"))
        if os.path.commonpath([sets_real, target]) != sets_real:
            raise ValueError("Path traversal detected")
        return target

    def _thumbnail_file_path(self, filename: str) -> str:
        safe_name = validate_thumbnail_name(filename)
        thumbs_real = os.path.realpath(self.thumbs_dir)
        target = os.path.realpath(os.path.join(thumbs_real, safe_name))
        if os.path.commonpath([thumbs_real, target]) != thumbs_real:
            raise ValueError("Path traversal detected")
        return target

    def save_thumbnail(self, raw_bytes: bytes) -> dict[str, Any]:
        """Optimize and atomically store a lightweight set thumbnail."""
        os.makedirs(self.thumbs_dir, exist_ok=True)
        encoded, ext, width, height = optimize_thumbnail_bytes(raw_bytes)
        filename = f"{generate_id('thumb')}.{ext}"
        target = self._thumbnail_file_path(filename)
        fd, tmp_path = tempfile.mkstemp(prefix=".tmp_", suffix=f".{ext}", dir=self.thumbs_dir)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(encoded)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, target)
        except Exception:
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except OSError:
                pass
            raise
        return {
            "thumbnail": filename,
            "format": ext,
            "size_bytes": len(encoded),
            "width": width,
            "height": height,
        }

    def get_thumbnail_path(self, filename: str) -> str | None:
        path = self._thumbnail_file_path(filename)
        return path if os.path.isfile(path) else None

    def _is_thumbnail_referenced(self, filename: str, *, ignore_set_id: str = "") -> bool:
        if not filename:
            return False
        for item in self.list_sets():
            if ignore_set_id and item.get("id") == ignore_set_id:
                continue
            if item.get("thumbnail") == filename:
                return True
        return False

    def _cleanup_unused_thumbnail(self, filename: str, *, ignore_set_id: str = "") -> None:
        safe = sanitize_thumbnail_name(filename)
        if not safe:
            return
        if self._is_thumbnail_referenced(safe, ignore_set_id=ignore_set_id):
            return
        try:
            path = self._thumbnail_file_path(safe)
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass

    def list_sets(self) -> list[dict[str, Any]]:
        os.makedirs(self.sets_dir, exist_ok=True)
        items: list[dict[str, Any]] = []
        for entry in os.listdir(self.sets_dir):
            if not entry.endswith(".json") or entry.startswith(".tmp_"):
                continue
            full_path = os.path.join(self.sets_dir, entry)
            if not os.path.isfile(full_path):
                continue
            try:
                with open(full_path, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                if not isinstance(raw, dict):
                    continue
                set_id = str(raw.get("id") or os.path.splitext(entry)[0])
                validate_id(set_id)
                items.append(self._normalize_set_record(raw, forced_id=set_id))
            except Exception:
                continue
        items.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
        return items

    def get_set(self, set_id: str) -> dict[str, Any] | None:
        path = self._set_file_path(set_id)
        if not os.path.isfile(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            return None
        return self._normalize_set_record(raw, forced_id=validate_id(set_id))

    def save_set(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("Payload must be a JSON object")
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValueError("セット名を入力してください")

        raw_id = payload.get("id")
        if raw_id is not None and str(raw_id).strip() != "":
            set_id = validate_id(raw_id)
            existing = self.get_set(set_id)
        else:
            set_id = generate_id("set")
            existing = None

        now = utc_now_iso()
        created_at = existing["created_at"] if existing else str(payload.get("created_at") or now)
        record = self._normalize_set_record(
            {
                **payload,
                "id": set_id,
                "name": name,
                "created_at": created_at,
                "updated_at": now,
            },
            forced_id=set_id,
        )
        old_thumb = existing.get("thumbnail", "") if existing else ""
        _atomic_write_json(self._set_file_path(set_id), record)
        if old_thumb and old_thumb != record.get("thumbnail", ""):
            self._cleanup_unused_thumbnail(old_thumb, ignore_set_id=set_id)
        return record

    def duplicate_set(self, set_id: str, new_name: str | None = None) -> dict[str, Any]:
        source = self.get_set(set_id)
        if source is None:
            raise FileNotFoundError(f"Set not found: {set_id}")
        copied = copy.deepcopy(source)
        copied["id"] = generate_id("set")
        copied["name"] = (str(new_name).strip() if new_name else "") or f"{source['name']} (コピー)"
        now = utc_now_iso()
        copied["created_at"] = now
        copied["updated_at"] = now
        return self.save_set(copied)

    def delete_set(self, set_id: str) -> bool:
        path = self._set_file_path(set_id)
        if not os.path.isfile(path):
            return False
        existing = self.get_set(set_id)
        old_thumb = existing.get("thumbnail", "") if existing else ""
        os.remove(path)
        if old_thumb:
            self._cleanup_unused_thumbnail(old_thumb, ignore_set_id=set_id)
        return True

    def get_state(self) -> dict[str, Any]:
        if not os.path.isfile(self.state_path):
            return default_workspace_state()
        try:
            with open(self.state_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            if not isinstance(raw, dict):
                return default_workspace_state()
            return self._normalize_state(raw)
        except Exception:
            return default_workspace_state()

    def save_state(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("State must be a JSON object")
        normalized = self._normalize_state(payload)
        normalized["updated_at"] = utc_now_iso()
        _atomic_write_json(self.state_path, normalized)
        return normalized

    def _normalize_set_record(self, raw: dict[str, Any], forced_id: str) -> dict[str, Any]:
        now = utc_now_iso()
        separator = raw.get("separator")
        if separator is None:
            separator = ", "
        return {
            "id": forced_id,
            "name": str(raw.get("name") or "名称未設定セット").strip() or "名称未設定セット",
            "thumbnail": sanitize_thumbnail_name(raw.get("thumbnail")),
            "aspect_ratio": normalize_aspect_ratio(raw.get("aspect_ratio"), allow_empty=True),
            "separator": str(separator),
            "loras": normalize_lora_list(raw.get("loras")),
            "prompt_boxes": normalize_prompt_boxes(raw.get("prompt_boxes"), ensure_non_empty=True),
            "created_at": str(raw.get("created_at") or now),
            "updated_at": str(raw.get("updated_at") or now),
        }

    def _normalize_state(self, raw: dict[str, Any]) -> dict[str, Any]:
        base = default_workspace_state()
        base["common_prompt_boxes"] = normalize_prompt_boxes(
            raw.get("common_prompt_boxes", base["common_prompt_boxes"]),
            ensure_non_empty=True,
        )
        sep = raw.get("common_separator")
        base["common_separator"] = str(sep) if sep is not None else ", "
        base["common_loras"] = normalize_lora_list(raw.get("common_loras"))
        if "negative_prompt" in raw and raw["negative_prompt"] is not None:
            base["negative_prompt"] = str(raw["negative_prompt"])
        raw_excluded = raw.get("excluded_categories")
        if isinstance(raw_excluded, list):
            seen: set[str] = set()
            cleaned_ex: list[str] = []
            for item in raw_excluded:
                label = str(item or "").strip()
                key = label.casefold()
                if label and key not in seen:
                    seen.add(key)
                    cleaned_ex.append(label)
            base["excluded_categories"] = cleaned_ex
        base["settings"] = normalize_settings(raw.get("settings"))

        raw_selected = raw.get("selected_sets")
        selected: list[dict[str, Any]] = []
        if isinstance(raw_selected, list):
            for idx, entry in enumerate(raw_selected):
                if not isinstance(entry, dict):
                    continue
                inst_id = str(entry.get("instance_id") or f"inst_{idx}_{secrets.token_hex(2)}")
                source_id = str(entry.get("source_set_id") or "").strip()
                name = str(entry.get("name") or "無題セット").strip() or "無題セット"
                images_override = entry.get("images_count")
                parsed_override: int | None = None
                if images_override not in (None, ""):
                    try:
                        parsed_override = max(1, min(100, int(images_override)))
                    except (TypeError, ValueError):
                        parsed_override = None
                selected.append(
                    {
                        "instance_id": inst_id,
                        "source_set_id": source_id,
                        "name": name,
                        "thumbnail": sanitize_thumbnail_name(entry.get("thumbnail")),
                        "aspect_ratio": normalize_aspect_ratio(entry.get("aspect_ratio"), allow_empty=True),
                        "enabled": entry.get("enabled") is not False,
                        "images_count": parsed_override,
                        "separator": str(entry.get("separator")) if entry.get("separator") is not None else ", ",
                        "loras": normalize_lora_list(entry.get("loras")),
                        "prompt_boxes": normalize_prompt_boxes(entry.get("prompt_boxes"), ensure_non_empty=True),
                    }
                )
        base["selected_sets"] = selected
        base["updated_at"] = str(raw.get("updated_at") or utc_now_iso())
        return base
