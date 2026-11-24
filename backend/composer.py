"""Prompt composition (Plan B), LoRA merging, and ComfyUI API workflow generation."""

from __future__ import annotations

import copy
import json
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from .storage import (
    normalize_lora_list,
    normalize_prompt_boxes,
    normalize_settings,
)

MAX_SEED = 2**53 - 1
DATE_TIME_PLACEHOLDER_RE = re.compile(r"%(date|time)(?::([^%]+))?%")
DATE_TOKEN_RE = re.compile(r"yyyy|yy|MM|M|dd|d|HH|hh|H|h|mm|m|ss|s")


def normalize_category(label: Any) -> str:
    return str(label or "").strip().casefold()


def is_category_excluded(label: Any, excluded_categories: list[str] | set[str]) -> bool:
    norm = normalize_category(label)
    if not norm:
        return False
    excluded_norm = {normalize_category(item) for item in excluded_categories if normalize_category(item)}
    return norm in excluded_norm


def filter_set_boxes(
    set_boxes: list[dict[str, Any]],
    excluded_categories: list[str] | set[str],
) -> list[dict[str, Any]]:
    """Return enabled prompt boxes from a set excluding specified categories."""
    excluded_norm = {normalize_category(item) for item in excluded_categories if normalize_category(item)}
    kept: list[dict[str, Any]] = []
    for box in normalize_prompt_boxes(set_boxes):
        if box.get("disabled", False):
            continue
        label_norm = normalize_category(box.get("label"))
        if label_norm and label_norm in excluded_norm:
            continue
        kept.append(copy.deepcopy(box))
    return kept


def compose_prompt_boxes_plan_b(
    common_boxes: list[dict[str, Any]],
    set_boxes: list[dict[str, Any]],
    excluded_categories: list[str] | set[str],
) -> list[dict[str, Any]]:
    """Compose boxes using Plan B: common boxes first, followed by active non-excluded set boxes."""
    active_common = [
        copy.deepcopy(box)
        for box in normalize_prompt_boxes(common_boxes)
        if not box.get("disabled", False)
    ]
    active_set = filter_set_boxes(set_boxes, excluded_categories)

    combined: list[dict[str, Any]] = []
    for idx, box in enumerate(active_common + active_set):
        box["id"] = f"merged_{idx}"
        combined.append(box)
    return combined


def _split_prompt_tokens(value: Any) -> list[str]:
    normalized = str(value or "").replace("\r", ",").replace("\n", ",")
    tokens: list[str] = []
    for part in normalized.split(","):
        cleaned = part.replace("_raw_:", "", 1).strip()
        if cleaned:
            tokens.append(cleaned)
    return tokens


def join_prompt_boxes_text(boxes: list[dict[str, Any]], separator: str = ", ") -> str:
    """Format prompt boxes identically to Comfyui-Anima-Tools AnimaPromptPlus."""
    parts: list[str] = []
    for box in boxes:
        if not isinstance(box, dict) or box.get("disabled", False):
            continue
        parts.extend(_split_prompt_tokens(box.get("text")))
    if not parts:
        return ""
    sep = separator if separator is not None else ", "
    if sep.strip() == "" or sep.strip() == ",":
        return f"{', '.join(parts)}, "
    return sep.join(parts)


def _same_lora(a: dict[str, Any], b: dict[str, Any]) -> bool:
    if str(a.get("name") or "").casefold() != str(b.get("name") or "").casefold():
        return False
    root_a = str(a.get("storage_root_id") or "")
    root_b = str(b.get("storage_root_id") or "")
    return (not root_a) or (not root_b) or (root_a == root_b)


def merge_loras(
    common_loras: list[dict[str, Any]],
    set_loras: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge enabled common LoRAs and enabled set LoRAs; set overrides duplicate entries."""
    merged: list[dict[str, Any]] = [
        copy.deepcopy(item)
        for item in normalize_lora_list(common_loras)
        if item.get("enabled") is not False
    ]
    for set_entry in normalize_lora_list(set_loras):
        if set_entry.get("enabled") is False:
            continue
        replaced = False
        for idx, existing in enumerate(merged):
            if _same_lora(existing, set_entry):
                merged[idx] = copy.deepcopy(set_entry)
                replaced = True
                break
        if not replaced:
            merged.append(copy.deepcopy(set_entry))
    return merged


def sanitize_filename_segment(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", str(name or "").strip())
    cleaned = cleaned.replace("..", "_").strip(" .")
    return cleaned[:64] or "set"


def resolve_batch_datetime(tz_offset_minutes: Any = None, now: datetime | None = None) -> datetime:
    """Resolve current datetime in caller's timezone (handles Colab UTC vs browser JST)."""
    if now is not None:
        return now
    if tz_offset_minutes is not None:
        try:
            offset = max(-840, min(840, int(tz_offset_minutes)))
            return datetime.now(timezone(timedelta(minutes=offset)))
        except (TypeError, ValueError):
            pass
    return datetime.now().astimezone()


def format_comfy_date_token(kind: str, fmt: str | None, dt: datetime) -> str:
    """Expand ComfyUI frontend %date:...% / %time:...% placeholders."""
    default_fmt = "HH-mm-ss" if kind == "time" else "yyyy-MM-dd"
    pattern = (fmt or default_fmt).strip() or default_fmt

    def _replace(match: re.Match[str]) -> str:
        tok = match.group(0)
        if tok == "yyyy":
            return f"{dt.year:04d}"
        if tok == "yy":
            return f"{dt.year % 100:02d}"
        if tok == "MM":
            return f"{dt.month:02d}"
        if tok == "M":
            return str(dt.month)
        if tok == "dd":
            return f"{dt.day:02d}"
        if tok == "d":
            return str(dt.day)
        if tok in ("HH", "hh"):
            return f"{dt.hour:02d}"
        if tok in ("H", "h"):
            return str(dt.hour)
        if tok == "mm":
            return f"{dt.minute:02d}"
        if tok == "m":
            return str(dt.minute)
        if tok == "ss":
            return f"{dt.second:02d}"
        if tok == "s":
            return str(dt.second)
        return tok

    formatted = DATE_TOKEN_RE.sub(_replace, pattern)
    return re.sub(r'[<>:"\\|?*\x00-\x1f]+', "_", formatted)


def resolve_filename_prefix(template: str, set_name: str, *, now: datetime | None = None) -> str:
    prefix = str(template or "%date:yyyyMMdd%/%date:yyyyMMdd%").strip() or "%date:yyyyMMdd%/%date:yyyyMMdd%"
    dt = resolve_batch_datetime(now=now)
    prefix = DATE_TIME_PLACEHOLDER_RE.sub(
        lambda m: format_comfy_date_token(m.group(1), m.group(2), dt),
        prefix,
    )
    if "{set_name}" in prefix:
        prefix = prefix.replace("{set_name}", sanitize_filename_segment(set_name))
    return prefix.lstrip("/\\") or "anima"


def default_seed() -> int:
    return secrets.randbelow(MAX_SEED) + 1


def resolve_job_seed(
    *,
    seed_mode: str,
    base_seed: int,
    job_index: int,
    seed_fn: Callable[[], int] | None = None,
) -> int:
    """Resolve the seed for a single queued image according to seed_mode."""
    mode = str(seed_mode or "randomize").strip().lower()
    if mode == "fixed":
        return max(0, min(MAX_SEED, int(base_seed)))
    if mode == "increment":
        return (max(0, int(base_seed)) + int(job_index)) % (MAX_SEED + 1)
    if mode == "decrement":
        return (max(0, int(base_seed)) - int(job_index)) % (MAX_SEED + 1)
    return int((seed_fn or default_seed)())


def build_single_workflow_prompt(
    *,
    combined_boxes: list[dict[str, Any]],
    merged_loras: list[dict[str, Any]],
    negative_prompt: str,
    settings: dict[str, Any],
    seed: int,
    separator: str = ", ",
    set_name: str = "",
    use_anima_tools: bool = True,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Build a ComfyUI /prompt API workflow dictionary for a single generation."""
    cfg = normalize_settings(settings)
    prompt: dict[str, Any] = {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": cfg["unet_name"],
                "weight_dtype": cfg["weight_dtype"],
            },
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": cfg["clip_name"],
                "type": cfg["clip_type"],
                "device": cfg["clip_device"],
            },
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": cfg["vae_name"],
            },
        },
    }

    model_ref: list[Any] = ["1", 0]
    if merged_loras:
        if use_anima_tools:
            prompt["4"] = {
                "class_type": "AnimaMultiLoraLoader",
                "inputs": {
                    "model": model_ref,
                    "lora_list_json": json.dumps(merged_loras, ensure_ascii=False),
                },
            }
            model_ref = ["4", 0]
        else:
            for idx, entry in enumerate(merged_loras):
                node_id = f"4_{idx}"
                prompt[node_id] = {
                    "class_type": "LoraLoaderModelOnly",
                    "inputs": {
                        "model": model_ref,
                        "lora_name": entry["name"],
                        "strength_model": float(entry["strength_model"]),
                    },
                }
                model_ref = [node_id, 0]

    prompt["5"] = {
        "class_type": "ModelSamplingAuraFlow",
        "inputs": {
            "model": model_ref,
            "shift": float(cfg["shift"]),
        },
    }

    if use_anima_tools:
        boxes_for_node = combined_boxes if combined_boxes else [{"id": "empty", "text": "", "disabled": False}]
        prompt["6"] = {
            "class_type": "AnimaPromptPlusClipEncode",
            "inputs": {
                "clip": ["2", 0],
                "prompt_boxes": json.dumps(boxes_for_node, ensure_ascii=False),
                "separator": separator if separator is not None else ", ",
            },
        }
    else:
        prompt["6"] = {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["2", 0],
                "text": join_prompt_boxes_text(combined_boxes, separator),
            },
        }

    prompt["7"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {
            "clip": ["2", 0],
            "text": str(negative_prompt or ""),
        },
    }

    prompt["8"] = {
        "class_type": "EmptySD3LatentImage",
        "inputs": {
            "width": int(cfg["width"]),
            "height": int(cfg["height"]),
            "batch_size": 1,
        },
    }

    prompt["9"] = {
        "class_type": "KSampler",
        "inputs": {
            "model": ["5", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["8", 0],
            "seed": int(seed),
            "steps": int(cfg["steps"]),
            "cfg": float(cfg["cfg"]),
            "sampler_name": cfg["sampler_name"],
            "scheduler": cfg["scheduler"],
            "denoise": float(cfg["denoise"]),
        },
    }

    prompt["10"] = {
        "class_type": "VAEDecode",
        "inputs": {
            "samples": ["9", 0],
            "vae": ["3", 0],
        },
    }

    prompt["11"] = {
        "class_type": "SaveImage",
        "inputs": {
            "images": ["10", 0],
            "filename_prefix": resolve_filename_prefix(cfg["filename_prefix"], set_name, now=now),
        },
    }

    return prompt


def build_batch_jobs(
    payload: dict[str, Any],
    *,
    use_anima_tools: bool = True,
    seed_fn: Callable[[], int] | None = None,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Build ordered ComfyUI queue jobs for all enabled selected sets."""
    if not isinstance(payload, dict):
        raise ValueError("Payload must be a JSON object")

    common_boxes = normalize_prompt_boxes(payload.get("common_prompt_boxes"))
    common_loras = normalize_lora_list(payload.get("common_loras"))
    common_separator = str(payload.get("common_separator") if payload.get("common_separator") is not None else ", ")
    negative_prompt = str(payload.get("negative_prompt") or "")
    excluded_categories = [
        str(c).strip()
        for c in (payload.get("excluded_categories") or [])
        if str(c or "").strip()
    ]
    settings = normalize_settings(payload.get("settings"))
    selected_sets = payload.get("selected_sets") or []
    if not isinstance(selected_sets, list):
        raise ValueError("selected_sets must be a list")

    batch_dt = resolve_batch_datetime(payload.get("tz_offset_minutes"), now=now)
    next_seed = seed_fn or default_seed
    jobs: list[dict[str, Any]] = []

    for set_idx, set_item in enumerate(selected_sets):
        if not isinstance(set_item, dict):
            continue
        if set_item.get("enabled") is False:
            continue

        set_name = str(set_item.get("name") or f"Set {set_idx + 1}").strip() or f"Set {set_idx + 1}"
        set_boxes = normalize_prompt_boxes(set_item.get("prompt_boxes"))
        set_loras = normalize_lora_list(set_item.get("loras"))
        separator = str(set_item.get("separator")) if set_item.get("separator") is not None else common_separator

        raw_count = set_item.get("images_count")
        if raw_count in (None, ""):
            images_count = int(settings["images_per_set"])
        else:
            try:
                images_count = max(1, min(100, int(raw_count)))
            except (TypeError, ValueError):
                images_count = int(settings["images_per_set"])

        combined_boxes = compose_prompt_boxes_plan_b(common_boxes, set_boxes, excluded_categories)
        merged_loras = merge_loras(common_loras, set_loras)
        positive_preview = join_prompt_boxes_text(combined_boxes, separator)

        for img_idx in range(images_count):
            seed = resolve_job_seed(
                seed_mode=settings["seed_mode"],
                base_seed=settings["seed"],
                job_index=len(jobs),
                seed_fn=next_seed,
            )
            workflow_prompt = build_single_workflow_prompt(
                combined_boxes=combined_boxes,
                merged_loras=merged_loras,
                negative_prompt=negative_prompt,
                settings=settings,
                seed=seed,
                separator=separator,
                set_name=set_name,
                use_anima_tools=use_anima_tools,
                now=batch_dt,
            )
            jobs.append(
                {
                    "set_index": set_idx,
                    "image_index": img_idx,
                    "instance_id": str(set_item.get("instance_id") or f"inst_{set_idx}"),
                    "source_set_id": str(set_item.get("source_set_id") or ""),
                    "set_name": set_name,
                    "seed": seed,
                    "positive_preview": positive_preview,
                    "merged_loras_count": len(merged_loras),
                    "prompt": workflow_prompt,
                    "extra_pnginfo": {
                        "anima_set_studio": {
                            "set_name": set_name,
                            "source_set_id": str(set_item.get("source_set_id") or ""),
                            "excluded_categories": excluded_categories,
                        }
                    },
                }
            )

    if not jobs:
        raise ValueError("実行対象のセットが1つも選択されていません")
    return jobs
