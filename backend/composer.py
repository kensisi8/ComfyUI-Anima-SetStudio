"""Prompt composition (Plan B), LoRA merging, and ComfyUI API workflow generation."""

from __future__ import annotations

import copy
import json
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from .storage import (
    compute_dimensions_for_aspect_ratio,
    normalize_aspect_ratio,
    normalize_category_list,
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
    disabled_common_categories: list[str] | set[str] | None = None,
) -> list[dict[str, Any]]:
    """Compose boxes using Plan B:
    - Common boxes first, excluding any category listed in this set's `disabled_common_categories`.
    - Followed by active set boxes, excluding any category listed in collection-level `excluded_categories`.
    Both exclusions operate strictly independently.
    """
    disabled_common_norm = {
        normalize_category(item)
        for item in (disabled_common_categories or [])
        if normalize_category(item)
    }
    active_common = [
        copy.deepcopy(box)
        for box in normalize_prompt_boxes(common_boxes)
        if not box.get("disabled", False)
        and not (
            normalize_category(box.get("label"))
            and normalize_category(box.get("label")) in disabled_common_norm
        )
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
    width: int | None = None,
    height: int | None = None,
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
            "width": int(width) if width is not None else int(cfg["width"]),
            "height": int(height) if height is not None else int(cfg["height"]),
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


def build_single_workflow_ui_graph(
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
    width: int | None = None,
    height: int | None = None,
) -> dict[str, Any]:
    """Build a ComfyUI UI `workflow` JSON graph for PNG metadata (`extra_pnginfo.workflow`).

    Embedding this alongside the API `prompt` ensures dragging generated PNGs back onto
    ComfyUI calls `onConfigure()` on AnimaMultiLoraLoader and AnimaPromptPlusClipEncode,
    so LoRAs and categorized prompt boxes display cleanly on canvas.
    """
    cfg = normalize_settings(settings)
    job_w = int(width) if width is not None else int(cfg["width"])
    job_h = int(height) if height is not None else int(cfg["height"])
    filename_prefix = resolve_filename_prefix(cfg["filename_prefix"], set_name, now=now)
    sep = separator if separator is not None else ", "

    nodes: list[dict[str, Any]] = []
    nodes_by_id: dict[int, dict[str, Any]] = {}
    links: list[list[Any]] = []
    next_link_id = 1
    next_order = 0

    def _add_node(
        node_id: int,
        node_type: str,
        pos: list[int],
        size: list[int],
        *,
        inputs: list[tuple[str, str]] | None = None,
        outputs: list[tuple[str, str]] | None = None,
        widgets_values: list[Any] | None = None,
        widgets_values_named: dict[str, Any] | None = None,
        title: str | None = None,
    ) -> dict[str, Any]:
        nonlocal next_order
        node: dict[str, Any] = {
            "id": node_id,
            "type": node_type,
            "pos": pos,
            "size": size,
            "flags": {},
            "order": next_order,
            "mode": 0,
            "inputs": [{"name": n, "type": t, "link": None} for (n, t) in (inputs or [])],
            "outputs": [
                {"name": n, "type": t, "links": [], "slot_index": idx}
                for idx, (n, t) in enumerate(outputs or [])
            ],
            "properties": {"Node name for S&R": node_type},
            "widgets_values": list(widgets_values or []),
        }
        if widgets_values_named:
            node["widgets_values_named"] = dict(widgets_values_named)
        if title:
            node["title"] = title
        next_order += 1
        nodes.append(node)
        nodes_by_id[node_id] = node
        return node

    def _connect(origin_id: int, origin_slot: int, target_id: int, target_slot: int, link_type: str) -> None:
        nonlocal next_link_id
        lid = next_link_id
        next_link_id += 1
        links.append([lid, origin_id, origin_slot, target_id, target_slot, link_type])
        nodes_by_id[origin_id]["outputs"][origin_slot]["links"].append(lid)
        nodes_by_id[target_id]["inputs"][target_slot]["link"] = lid

    # Loaders (Column 1)
    _add_node(
        1,
        "UNETLoader",
        [40, 40],
        [320, 82],
        outputs=[("MODEL", "MODEL")],
        widgets_values=[cfg["unet_name"], cfg["weight_dtype"]],
    )
    _add_node(
        2,
        "CLIPLoader",
        [40, 180],
        [320, 106],
        outputs=[("CLIP", "CLIP")],
        widgets_values=[cfg["clip_name"], cfg["clip_type"], cfg["clip_device"]],
    )
    _add_node(
        3,
        "VAELoader",
        [40, 350],
        [320, 58],
        outputs=[("VAE", "VAE")],
        widgets_values=[cfg["vae_name"]],
    )

    # LoRA Loader chain (Column 2 top)
    model_origin_id = 1
    lora_end_x = 420
    if merged_loras:
        if use_anima_tools:
            lora_json = json.dumps(merged_loras, ensure_ascii=False)
            _add_node(
                4,
                "AnimaMultiLoraLoader",
                [420, 40],
                [360, max(160, 100 + len(merged_loras) * 64)],
                inputs=[("model", "MODEL")],
                outputs=[("MODEL", "MODEL")],
                widgets_values=[lora_json],
                widgets_values_named={"lora_list_json": lora_json},
            )
            _connect(model_origin_id, 0, 4, 0, "MODEL")
            model_origin_id = 4
            lora_end_x = 820
        else:
            for idx, entry in enumerate(merged_loras):
                lid = 100 + idx
                _add_node(
                    lid,
                    "LoraLoaderModelOnly",
                    [420 + idx * 300, 40],
                    [270, 82],
                    inputs=[("model", "MODEL")],
                    outputs=[("MODEL", "MODEL")],
                    widgets_values=[entry["name"], float(entry["strength_model"])],
                )
                _connect(model_origin_id, 0, lid, 0, "MODEL")
                model_origin_id = lid
            lora_end_x = 420 + len(merged_loras) * 300

    # ModelSamplingAuraFlow
    _add_node(
        5,
        "ModelSamplingAuraFlow",
        [lora_end_x, 40],
        [270, 58],
        inputs=[("model", "MODEL")],
        outputs=[("MODEL", "MODEL")],
        widgets_values=[float(cfg["shift"])],
    )
    _connect(model_origin_id, 0, 5, 0, "MODEL")

    # Positive Prompt
    if use_anima_tools:
        boxes_for_node = combined_boxes if combined_boxes else [{"id": "empty", "text": "", "disabled": False}]
        boxes_json = json.dumps(boxes_for_node, ensure_ascii=False)
        _add_node(
            6,
            "AnimaPromptPlusClipEncode",
            [420, 260],
            [440, max(240, 120 + len(boxes_for_node) * 86)],
            inputs=[("clip", "CLIP")],
            outputs=[("positive", "CONDITIONING"), ("text", "STRING")],
            widgets_values=[boxes_json, sep],
            widgets_values_named={"prompt_boxes": boxes_json, "separator": sep},
        )
    else:
        _add_node(
            6,
            "CLIPTextEncode",
            [420, 260],
            [420, 160],
            inputs=[("clip", "CLIP")],
            outputs=[("CONDITIONING", "CONDITIONING")],
            widgets_values=[join_prompt_boxes_text(combined_boxes, sep)],
            title="CLIP Text Encode (Positive)",
        )
    _connect(2, 0, 6, 0, "CLIP")

    # Negative Prompt
    _add_node(
        7,
        "CLIPTextEncode",
        [420, 560],
        [420, 130],
        inputs=[("clip", "CLIP")],
        outputs=[("CONDITIONING", "CONDITIONING")],
        widgets_values=[str(negative_prompt or "")],
        title="CLIP Text Encode (Negative)",
    )
    _connect(2, 0, 7, 0, "CLIP")

    # Latent
    _add_node(
        8,
        "EmptySD3LatentImage",
        [420, 730],
        [320, 106],
        outputs=[("LATENT", "LATENT")],
        widgets_values=[job_w, job_h, 1],
    )

    # KSampler / VAEDecode / SaveImage (Right columns)
    sampler_x = max(lora_end_x + 320, 920)
    control_after_gen = cfg.get("seed_mode") if cfg.get("seed_mode") in ("fixed", "increment", "decrement", "randomize") else "fixed"
    _add_node(
        9,
        "KSampler",
        [sampler_x, 180],
        [320, 262],
        inputs=[
            ("model", "MODEL"),
            ("positive", "CONDITIONING"),
            ("negative", "CONDITIONING"),
            ("latent_image", "LATENT"),
        ],
        outputs=[("LATENT", "LATENT")],
        widgets_values=[
            int(seed),
            control_after_gen,
            int(cfg["steps"]),
            float(cfg["cfg"]),
            cfg["sampler_name"],
            cfg["scheduler"],
            float(cfg["denoise"]),
        ],
    )
    _connect(5, 0, 9, 0, "MODEL")
    _connect(6, 0, 9, 1, "CONDITIONING")
    _connect(7, 0, 9, 2, "CONDITIONING")
    _connect(8, 0, 9, 3, "LATENT")

    _add_node(
        10,
        "VAEDecode",
        [sampler_x + 370, 180],
        [210, 46],
        inputs=[("samples", "LATENT"), ("vae", "VAE")],
        outputs=[("IMAGE", "IMAGE")],
    )
    _connect(9, 0, 10, 0, "LATENT")
    _connect(3, 0, 10, 1, "VAE")

    _add_node(
        11,
        "SaveImage",
        [sampler_x + 630, 180],
        [320, 270],
        inputs=[("images", "IMAGE")],
        widgets_values=[filename_prefix],
    )
    _connect(10, 0, 11, 0, "IMAGE")

    max_node_id = max(n["id"] for n in nodes) if nodes else 0
    return {
        "last_node_id": max_node_id,
        "last_link_id": next_link_id - 1,
        "nodes": nodes,
        "links": links,
        "groups": [],
        "config": {},
        "extra": {"ds": {"scale": 0.85, "offset": [40, 40]}},
        "version": 0.4,
    }


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

        disabled_common_categories = normalize_category_list(set_item.get("disabled_common_categories"))
        combined_boxes = compose_prompt_boxes_plan_b(
            common_boxes,
            set_boxes,
            excluded_categories,
            disabled_common_categories=disabled_common_categories,
        )
        merged_loras = merge_loras(common_loras, set_loras)
        positive_preview = join_prompt_boxes_text(combined_boxes, separator)

        raw_settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
        set_aspect_ratio = normalize_aspect_ratio(set_item.get("aspect_ratio"), allow_empty=True)
        effective_ratio = set_aspect_ratio or settings["default_aspect_ratio"]
        use_legacy_wh = (
            not set_aspect_ratio
            and raw_settings.get("base_resolution") in (None, "")
            and raw_settings.get("default_aspect_ratio") in (None, "")
            and (raw_settings.get("width") not in (None, "") or raw_settings.get("height") not in (None, ""))
        )
        if use_legacy_wh:
            job_w, job_h = int(settings["width"]), int(settings["height"])
        else:
            job_w, job_h = compute_dimensions_for_aspect_ratio(
                settings["base_resolution"],
                effective_ratio,
            )
        job_settings = {**settings, "width": job_w, "height": job_h}

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
                settings=job_settings,
                seed=seed,
                separator=separator,
                set_name=set_name,
                use_anima_tools=use_anima_tools,
                now=batch_dt,
                width=job_w,
                height=job_h,
            )
            workflow_ui = build_single_workflow_ui_graph(
                combined_boxes=combined_boxes,
                merged_loras=merged_loras,
                negative_prompt=negative_prompt,
                settings=job_settings,
                seed=seed,
                separator=separator,
                set_name=set_name,
                use_anima_tools=use_anima_tools,
                now=batch_dt,
                width=job_w,
                height=job_h,
            )
            jobs.append(
                {
                    "set_index": set_idx,
                    "image_index": img_idx,
                    "instance_id": str(set_item.get("instance_id") or f"inst_{set_idx}"),
                    "source_set_id": str(set_item.get("source_set_id") or ""),
                    "set_name": set_name,
                    "aspect_ratio": effective_ratio,
                    "width": job_w,
                    "height": job_h,
                    "seed": seed,
                    "positive_preview": positive_preview,
                    "merged_loras_count": len(merged_loras),
                    "prompt": workflow_prompt,
                    "extra_pnginfo": {
                        "workflow": workflow_ui,
                        "anima_set_studio": {
                            "set_name": set_name,
                            "source_set_id": str(set_item.get("source_set_id") or ""),
                            "excluded_categories": excluded_categories,
                            "disabled_common_categories": disabled_common_categories,
                        },
                    },
                }
            )

    if not jobs:
        raise ValueError("実行対象のセットが1つも選択されていません")
    return jobs
