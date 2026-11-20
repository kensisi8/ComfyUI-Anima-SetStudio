"""Persistent storage for ComfyUI-Anima-SetStudio sets and workspace state."""

from __future__ import annotations

import copy
import json
import os
import re
import secrets
import tempfile
from datetime import datetime, timezone
from typing import Any

SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")

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
    "width": 832,
    "height": 1216,
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
            num = int(round(float(val)))
            return max(min_v, min(max_v, num))
        except (TypeError, ValueError):
            return default

    merged["shift"] = _to_float(data.get("shift"), DEFAULT_GENERATION_SETTINGS["shift"], 0.0, 100.0)
    merged["steps"] = _to_int(data.get("steps"), DEFAULT_GENERATION_SETTINGS["steps"], 1, 200)
    merged["cfg"] = _to_float(data.get("cfg"), DEFAULT_GENERATION_SETTINGS["cfg"], 0.0, 30.0)
    merged["denoise"] = _to_float(data.get("denoise"), DEFAULT_GENERATION_SETTINGS["denoise"], 0.0, 1.0)
    merged["width"] = _to_int(data.get("width"), DEFAULT_GENERATION_SETTINGS["width"], 64, 4096)
    merged["height"] = _to_int(data.get("height"), DEFAULT_GENERATION_SETTINGS["height"], 64, 4096)
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
        self.state_path = os.path.join(self.base_dir, "state.json")
        os.makedirs(self.sets_dir, exist_ok=True)

    def _set_file_path(self, set_id: str) -> str:
        safe_id = validate_id(set_id)
        sets_real = os.path.realpath(self.sets_dir)
        target = os.path.realpath(os.path.join(sets_real, f"{safe_id}.json"))
        if os.path.commonpath([sets_real, target]) != sets_real:
            raise ValueError("Path traversal detected")
        return target

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
        _atomic_write_json(self._set_file_path(set_id), record)
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
        os.remove(path)
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
