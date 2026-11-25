"""Extract categorized prompt boxes and LoRA lists from generated image metadata.

Zero external dependencies: uses only Python's standard library so it works
out-of-the-box in ComfyUI and Google Colab without extra pip installs.
"""

from __future__ import annotations

import json
import os
import re
import struct
import zlib
from typing import Any

from .storage import (
    detect_aspect_ratio_from_size,
    normalize_lora_entry,
    normalize_lora_list,
    normalize_prompt_boxes,
)

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

PRIMARY_SAMPLER_TYPES = {
    "KSampler",
    "KSamplerAdvanced",
    "SamplerCustom",
    "SamplerCustomAdvanced",
    "KSampler (Efficient)",
    "KSampler Adv. (Efficient)",
}

SECONDARY_SAMPLER_TYPES = {
    "FaceDetailer",
    "DetailerForEach",
    "DetailerForEachDebug",
    "UltimateSDUpscale",
    "UltimateSDUpscaleNoUpscale",
}

OUTPUT_IMAGE_TYPES = {
    "SaveImage",
    "PreviewImage",
    "SaveImageWebsocket",
    "SaveAnimatedWEBP",
    "SaveAnimatedPNG",
    "Image Save",
}

ANIMA_PROMPT_PLUS_TYPES = {
    "AnimaPromptPlus",
    "AnimaPromptPlusClipEncode",
}

ANIMA_SELECTOR_CONFIG: dict[str, tuple[str, str]] = {
    "AnimaArtistSelector": ("画師", "artist_tags"),
    "AnimaCharacterSelector": ("キャラ", "character_tags"),
    "AnimaClothingSelector": ("衣装", "clothing_tags"),
    "AnimaBackgroundSelector": ("背景", "background_tags"),
    "AnimaPoseSelector": ("ポーズ", "pose_tags"),
}

LORA_TAG_RE = re.compile(
    r"<(?:lora|lyco):([^:>]+?)(?::([+-]?\d+(?:\.\d+)?))?(?::([+-]?\d+(?:\.\d+)?))?>",
    re.IGNORECASE,
)

# Rule-based auto-categorization patterns (checked in priority order)
_QUALITY_PATTERNS = (
    r"^(?:masterpiece|best quality|high quality|great quality|amazing quality|very aesthetic|aesthetic)$",
    r"^(?:absurdres|highres|incredibly absurdres|ultra[- ]?detailed|extremely detailed|highly detailed|intricate details?)$",
    r"^(?:newest|recent|mid|early|old|latest|year\s*\d{4}|20\d{2}s?)$",
    r"^(?:score_\d+(?:_up)?|source_\w+|rating:\w+|general|safe|sensitive|questionable|explicit|nsfw)$",
    r"^(?:anime(?: style| coloring)?|illustration|digital (?:art|illustration)|cel shading|official art|key visual|4k|8k)$",
)

_ARTIST_PATTERNS = (
    r"^@",
    r"^artist:",
    r"^by\s+\S+",
    r"\(artist\)$",
)

_BODY_PATTERNS = (
    r"\b(?:breasts?|chest|cleavage|flat chest|small breasts|medium breasts|large breasts|huge breasts|gigantic breasts)\b",
    r"\b(?:petite|curvy|plump|slim|slender|skinny|muscular|toned|abs|thick thighs|wide hips|narrow waist|hips|thighs|midriff|navel|collarbone|belly|stomach)\b",
    r"\b(?:barefoot|bare legs|bare shoulders|bare arms|bare back|long legs|tan(?:ned)? skin|dark skin|pale skin|fair skin|sweat|sweaty|glossy skin|wet skin)\b",
)

_CLOTHING_PATTERNS = (
    r"\b(?:uniform|school uniform|serafuku|sailor|dress|sundress|skirt|miniskirt|pleated skirt|shirt|t-?shirt|blouse|jacket|coat|hoodie|sweater|cardigan|vest|blazer)\b",
    r"\b(?:bikini|swimsuit|one-piece swimsuit|lingerie|underwear|panties|bra|stockings|thighhighs|socks|kneehighs|pantyhose|tights|fishnets|garter)\b",
    r"\b(?:shoes|boots|sneakers|heels|high heels|sandals|loafers|slippers|hat|cap|beret|beanie|bonnet|veil|crown|tiara)\b",
    r"\b(?:ribbon|neck ribbon|bow|bowtie|necktie|tie|scarf|gloves|fingerless gloves|mittens|apron|maid|kimono|yukata|hanfu|qipao|china dress|miko)\b",
    r"\b(?:armor|cape|cloak|robe|jeans|shorts|short shorts|denim|pants|trousers|leggings|choker|necklace|earrings|bracelet|wristband|belt|bag|backpack|handbag)\b",
    r"\b(?:tank top|crop top|camisole|bodysuit|leotard|cosplay|outfit|clothes|clothing|pajamas|nightgown|towel|bathrobe|tracksuit|gym uniform|bloomers|cheongsam)\b",
    r"\b(?:sleeves|long sleeves|short sleeves|sleeveless|off shoulder|collared|frills|frilled|lace|plaid|striped|polka dot|zipper|buttons?|pockets?|nude|naked|topless|bottomless|undressing)\b",
)

_POSE_PATTERNS = (
    r"\b(?:standing|sitting|seated|lying|laying|kneeling|squatting|crouching|jumping|leaping|running|walking|leaning|stretching|reaching|floating|flying)\b",
    r"\b(?:holding|hugging|embracing|carrying|waving|pointing|crossed arms|crossed legs|arms up|arms behind|hand on hip|hands on hips|hands up|hands together|hand to mouth|v|peace sign|double peace)\b",
    r"\b(?:from behind|from above|from below|from side|dutch angle|pov|first-person view|portrait|upper body|lower body|full body|cowboy shot|close-up|extreme close-up|wide shot|medium shot)\b",
    r"\b(?:looking back|looking up|looking down|looking away|looking to the side|looking over shoulder|head tilt|profile|back|wariza|seiza|on back|on stomach|on side|all fours|pose|dynamic|foreshortening|contrapposto)\b",
)

_BACKGROUND_PATTERNS = (
    r"\b(?:background|simple background|white background|black background|gradient background|transparent background|outdoors|indoors|scenery|landscape|horizon)\b",
    r"\b(?:sky|blue sky|cloudy sky|clouds?|sunset|sunrise|twilight|dusk|dawn|night|starry sky|stars|moon|full moon|crescent moon|day|evening|morning)\b",
    r"\b(?:sunlight|sunbeams?|backlight|backlighting|rim light|lighting|dramatic lighting|cinematic lighting|soft lighting|shadow|shadows|bokeh|depth of field|blurry|lens flare|light particles?|glowing|sparkles?)\b",
    r"\b(?:classroom|school|hallway|corridor|bedroom|living room|room|bed|window|curtains|desk|table|chair|sofa|couch|cafe|coffee shop|restaurant|shop|store|mall|supermarket)\b",
    r"\b(?:street|city|cityscape|town|alley|building|buildings|skyscraper|rooftop|balcony|veranda|park|forest|woods|trees?|foliage|grass|meadow|field|garden|flowers?|flower field|cherry blossoms?|sakura|petals?)\b",
    r"\b(?:beach|ocean|sea|shore|water|pool|swimming pool|river|lake|waterfall|mountain|mountains|hill|snow|snowing|rain|raining|umbrella|shrine|torii|temple|church|castle|ruins|dungeon|library|kitchen|bathroom|onsen|hot spring)\b",
    r"\b(?:train|train interior|station|bus|car|bridge|path|road|fence|railing|wall|brick wall|wooden floor|floor|ceiling|lamp|streetlight|lantern|candle|fire|flames?|smoke|fog|mist)\b",
)

_CHARACTER_PATTERNS = (
    r"^(?:\d+\+?girls?|\d+\+?boys?|solo|solo focus|multiple girls|multiple boys|couple|group|chibi)$",
    r"\([^)]+\)$",  # character (series) format
    r"\b(?:hair|twintails|ponytail|braid|braids|bun|hair bun|bob cut|pixie cut|bangs|sidelocks|ahoge|hair over|messy hair|wavy hair|curly hair|straight hair|short hair|medium hair|long hair|very long hair)\b",
    r"\b(?:eyes?|pupils?|eyelashes|eyebrows|heterochromia|closed eyes|half-closed eyes|wink|one eye closed|looking at viewer|eye contact)\b",
    r"\b(?:smile|smiling|grin|smirk|blush|blushing|open mouth|closed mouth|parted lips|frown|pout|surprised|embarrassed|shy|happy|sad|angry|serious|expressionless|tears|crying|laughing|tongue|fang|freckles)\b",
    r"\b(?:ears?|cat ears|fox ears|wolf ears|rabbit ears|bunny ears|dog ears|animal ears|pointy ears|elf ears|tail|cat tail|fox tail|wings?|angel wings|demon wings|halo|horns?|glasses|sunglasses|eyepatch|hair ornament|hairpin|hairclip|hairband|headband)\b",
)

_CATEGORY_RULES: list[tuple[str, tuple[re.Pattern[str], ...]]] = [
    ("品質", tuple(re.compile(p, re.IGNORECASE) for p in _QUALITY_PATTERNS)),
    ("画師", tuple(re.compile(p, re.IGNORECASE) for p in _ARTIST_PATTERNS)),
    ("衣装", tuple(re.compile(p, re.IGNORECASE) for p in _CLOTHING_PATTERNS)),
    ("体格", tuple(re.compile(p, re.IGNORECASE) for p in _BODY_PATTERNS)),
    ("ポーズ", tuple(re.compile(p, re.IGNORECASE) for p in _POSE_PATTERNS)),
    ("背景", tuple(re.compile(p, re.IGNORECASE) for p in _BACKGROUND_PATTERNS)),
    ("キャラ", tuple(re.compile(p, re.IGNORECASE) for p in _CHARACTER_PATTERNS)),
]

CATEGORY_DISPLAY_ORDER = ["品質", "画師", "キャラ", "体格", "衣装", "ポーズ", "背景", "その他"]


def _decode_bytes(raw: bytes) -> str:
    for enc in ("utf-8", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def extract_png_text_chunks(raw_bytes: bytes) -> dict[str, str]:
    """Extract tEXt, zTXt, and iTXt metadata chunks from a PNG byte stream."""
    if len(raw_bytes) < 8 or raw_bytes[:8] != PNG_SIGNATURE:
        return {}

    chunks: dict[str, str] = {}
    pos = 8
    total = len(raw_bytes)

    while pos + 12 <= total:
        length = struct.unpack(">I", raw_bytes[pos : pos + 4])[0]
        chunk_type = raw_bytes[pos + 4 : pos + 8]
        data_start = pos + 8
        data_end = data_start + length
        if data_end + 4 > total:
            break
        data = raw_bytes[data_start:data_end]
        pos = data_end + 4

        if chunk_type == b"IEND":
            break

        if chunk_type == b"tEXt":
            sep = data.find(b"\x00")
            if sep > 0:
                key = data[:sep].decode("latin-1", errors="replace")
                val = _decode_bytes(data[sep + 1 :])
                chunks[key] = val

        elif chunk_type == b"zTXt":
            sep = data.find(b"\x00")
            if sep > 0 and sep + 2 <= len(data):
                key = data[:sep].decode("latin-1", errors="replace")
                comp_method = data[sep + 1]
                if comp_method == 0:
                    try:
                        val = _decode_bytes(zlib.decompress(data[sep + 2 :]))
                        chunks[key] = val
                    except zlib.error:
                        pass

        elif chunk_type == b"iTXt":
            sep1 = data.find(b"\x00")
            if sep1 <= 0 or sep1 + 3 > len(data):
                continue
            key = data[:sep1].decode("latin-1", errors="replace")
            comp_flag = data[sep1 + 1]
            comp_method = data[sep1 + 2]
            cursor = sep1 + 3
            sep2 = data.find(b"\x00", cursor)
            if sep2 < 0:
                continue
            sep3 = data.find(b"\x00", sep2 + 1)
            if sep3 < 0:
                continue
            text_bytes = data[sep3 + 1 :]
            if comp_flag == 1:
                if comp_method != 0:
                    continue
                try:
                    text_bytes = zlib.decompress(text_bytes)
                except zlib.error:
                    continue
            chunks[key] = _decode_bytes(text_bytes)

    return chunks


def _decode_user_comment(raw: bytes) -> str:
    if len(raw) >= 8:
        prefix = raw[:8]
        body = raw[8:]
        if prefix.startswith(b"ASCII"):
            return body.decode("utf-8", errors="ignore").strip("\x00 ")
        if prefix.startswith(b"UNICODE"):
            if not body:
                return ""
            # Detect UTF-16BE vs UTF-16LE by checking null byte distribution
            even_nulls = sum(1 for i in range(0, min(len(body), 64), 2) if body[i] == 0)
            odd_nulls = sum(1 for i in range(1, min(len(body), 64), 2) if body[i] == 0)
            enc = "utf-16-be" if even_nulls > odd_nulls else "utf-16-le"
            try:
                return body.decode(enc, errors="ignore").strip("\x00 ")
            except Exception:
                return body.decode("utf-8", errors="ignore").strip("\x00 ")
    return _decode_bytes(raw).strip("\x00 ")


def _extract_exif_strings(exif_payload: bytes) -> list[str]:
    """Parse minimal TIFF/EXIF IFD0 + ExifIFD to pull ASCII/UserComment strings."""
    data = exif_payload
    if data.startswith(b"Exif\x00\x00"):
        data = data[6:]
    if len(data) < 8:
        return []

    byte_order = data[:2]
    if byte_order == b"II":
        endian = "<"
    elif byte_order == b"MM":
        endian = ">"
    else:
        return []

    magic = struct.unpack(endian + "H", data[2:4])[0]
    if magic != 42:
        return []
    first_ifd = struct.unpack(endian + "I", data[4:8])[0]

    strings: list[str] = []
    visited: set[int] = set()
    to_visit = [first_ifd]

    def _read_value(typ: int, count: int, value_offset_bytes: bytes) -> bytes:
        type_sizes = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1}
        unit = type_sizes.get(typ, 1)
        total_len = count * unit
        if total_len <= 4:
            return value_offset_bytes[:total_len]
        offset = struct.unpack(endian + "I", value_offset_bytes)[0]
        if offset + total_len <= len(data):
            return data[offset : offset + total_len]
        return b""

    while to_visit:
        ifd_off = to_visit.pop(0)
        if ifd_off in visited or ifd_off < 8 or ifd_off + 2 > len(data):
            continue
        visited.add(ifd_off)
        num_entries = struct.unpack(endian + "H", data[ifd_off : ifd_off + 2])[0]
        pos = ifd_off + 2
        for _ in range(num_entries):
            if pos + 12 > len(data):
                break
            tag, typ, count = struct.unpack(endian + "HHI", data[pos : pos + 8])
            val_field = data[pos + 8 : pos + 12]
            pos += 12

            if tag == 0x8769 and typ == 4 and count == 1:  # ExifIFD pointer
                sub_off = struct.unpack(endian + "I", val_field)[0]
                to_visit.append(sub_off)
                continue

            if tag == 0x9286:  # UserComment
                raw = _read_value(typ, count, val_field)
                text = _decode_user_comment(raw)
                if text:
                    strings.append(text)
            elif tag == 0x9C9C and typ in (1, 7):  # XPComment (UTF-16LE)
                raw = _read_value(typ, count, val_field)
                text = raw.decode("utf-16-le", errors="ignore").strip("\x00 ")
                if text:
                    strings.append(text)
            elif typ == 2 and count > 1:  # ASCII string
                raw = _read_value(typ, count, val_field)
                text = _decode_bytes(raw).strip("\x00 ")
                if text:
                    strings.append(text)

    return strings


def _classify_metadata_strings(texts: list[str], out: dict[str, str]) -> None:
    """Classify extracted EXIF/XMP/COM text snippets into prompt/workflow/parameters."""
    for raw in texts:
        text = raw.strip()
        if not text:
            continue

        # ComfyUI WebP/JPEG EXIF often prefixes with "Prompt:" or "Workflow:"
        lower = text.lower()
        if lower.startswith("prompt:"):
            candidate = text[len("prompt:") :].strip()
            if candidate.startswith("{"):
                out.setdefault("prompt", candidate)
                continue
        if lower.startswith("workflow:"):
            candidate = text[len("workflow:") :].strip()
            if candidate.startswith("{"):
                out.setdefault("workflow", candidate)
                continue

        if text.startswith("{") and text.endswith("}"):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, dict):
                    if "nodes" in parsed and isinstance(parsed.get("nodes"), list):
                        out.setdefault("workflow", text)
                        continue
                    if any(isinstance(v, dict) and "class_type" in v for v in parsed.values()):
                        out.setdefault("prompt", text)
                        continue
            except Exception:
                pass

        if "Negative prompt:" in text or ("Steps:" in text and "Sampler:" in text):
            out.setdefault("parameters", text)
            continue

        # XMP embedded Prompt/Workflow XML elements
        for key in ("prompt", "workflow", "parameters"):
            match = re.search(rf"<{key}[^>]*>(.*?)</{key}>", text, re.IGNORECASE | re.DOTALL)
            if match:
                val = match.group(1).strip()
                if val:
                    val = (
                        val.replace("&quot;", '"')
                        .replace("&amp;", "&")
                        .replace("&lt;", "<")
                        .replace("&gt;", ">")
                    )
                    out.setdefault(key, val)


def extract_webp_metadata_chunks(raw_bytes: bytes) -> dict[str, str]:
    """Extract EXIF/XMP metadata from a WebP byte stream."""
    if len(raw_bytes) < 12 or raw_bytes[:4] != b"RIFF" or raw_bytes[8:12] != b"WEBP":
        return {}
    texts: list[str] = []
    pos = 12
    total = len(raw_bytes)
    while pos + 8 <= total:
        fourcc = raw_bytes[pos : pos + 4]
        size = struct.unpack("<I", raw_bytes[pos + 4 : pos + 8])[0]
        data_start = pos + 8
        data_end = data_start + size
        if data_end > total:
            break
        data = raw_bytes[data_start:data_end]
        pos = data_end + (size & 1)

        if fourcc == b"EXIF":
            texts.extend(_extract_exif_strings(data))
        elif fourcc == b"XMP ":
            texts.append(_decode_bytes(data))

    out: dict[str, str] = {}
    _classify_metadata_strings(texts, out)
    return out


def extract_jpeg_metadata_chunks(raw_bytes: bytes) -> dict[str, str]:
    """Extract EXIF/XMP/COM metadata from a JPEG byte stream."""
    if len(raw_bytes) < 4 or raw_bytes[:2] != b"\xff\xd8":
        return {}
    texts: list[str] = []
    pos = 2
    total = len(raw_bytes)

    while pos + 2 <= total:
        if raw_bytes[pos] != 0xFF:
            pos += 1
            continue
        while pos < total and raw_bytes[pos] == 0xFF:
            pos += 1
        if pos >= total:
            break
        marker = raw_bytes[pos]
        pos += 1

        if marker in (0xD8, 0xD9, 0x01) or (0xD0 <= marker <= 0xD7):
            if marker == 0xD9:
                break
            continue
        if marker == 0xDA:  # Start of Scan (compressed image data)
            break
        if pos + 2 > total:
            break
        seg_len = struct.unpack(">H", raw_bytes[pos : pos + 2])[0]
        if seg_len < 2 or pos + seg_len > total:
            break
        seg_data = raw_bytes[pos + 2 : pos + seg_len]
        pos += seg_len

        if marker == 0xE1:  # APP1 (EXIF or XMP)
            if seg_data.startswith(b"Exif\x00\x00"):
                texts.extend(_extract_exif_strings(seg_data))
            elif seg_data.startswith(b"http://ns.adobe.com/xap/1.0/\x00"):
                texts.append(_decode_bytes(seg_data[len(b"http://ns.adobe.com/xap/1.0/\x00") :]))
        elif marker == 0xFE:  # COM comment
            texts.append(_decode_bytes(seg_data))

    out: dict[str, str] = {}
    _classify_metadata_strings(texts, out)
    return out


def extract_image_metadata_chunks(raw_bytes: bytes) -> dict[str, str]:
    """Dispatch metadata extraction by image file signature (PNG / WebP / JPEG)."""
    if not raw_bytes:
        return {}
    if raw_bytes.startswith(PNG_SIGNATURE):
        return extract_png_text_chunks(raw_bytes)
    if len(raw_bytes) >= 12 and raw_bytes[:4] == b"RIFF" and raw_bytes[8:12] == b"WEBP":
        return extract_webp_metadata_chunks(raw_bytes)
    if raw_bytes.startswith(b"\xff\xd8"):
        return extract_jpeg_metadata_chunks(raw_bytes)
    return {}


def _split_tags_preserving_brackets(text: str) -> list[str]:
    """Split comma/newline-separated tags without breaking weight parens or wildcards."""
    tags: list[str] = []
    buf: list[str] = []
    depth_paren = 0
    depth_bracket = 0
    depth_brace = 0

    for ch in str(text or ""):
        if ch == "(":
            depth_paren += 1
            buf.append(ch)
        elif ch == ")":
            depth_paren = max(0, depth_paren - 1)
            buf.append(ch)
        elif ch == "[":
            depth_bracket += 1
            buf.append(ch)
        elif ch == "]":
            depth_bracket = max(0, depth_bracket - 1)
            buf.append(ch)
        elif ch == "{":
            depth_brace += 1
            buf.append(ch)
        elif ch == "}":
            depth_brace = max(0, depth_brace - 1)
            buf.append(ch)
        elif ch in (",", "\n", "\r") and depth_paren == 0 and depth_bracket == 0 and depth_brace == 0:
            item = "".join(buf).strip()
            if item:
                tags.append(item)
            buf = []
        else:
            buf.append(ch)

    tail = "".join(buf).strip()
    if tail:
        tags.append(tail)
    return tags


def _strip_tag_weight(tag: str) -> str:
    """Strip outer weight parens like (blue eyes:1.2) for cleaner category matching."""
    cleaned = tag.strip()
    while len(cleaned) >= 2 and cleaned[0] in "([{" and cleaned[-1] in ")]}":
        cleaned = cleaned[1:-1].strip()
    cleaned = re.sub(r":\s*[+-]?\d+(?:\.\d+)?$", "", cleaned).strip()
    cleaned = cleaned.replace("\\(", "(").replace("\\)", ")").replace("_", " ")
    return cleaned


def _classify_single_tag(tag: str) -> str:
    probe = _strip_tag_weight(tag)
    if not probe:
        return "その他"
    for category, patterns in _CATEGORY_RULES:
        for pat in patterns:
            if pat.search(probe):
                return category
    return "その他"


def auto_categorize_prompt(text: str) -> list[dict[str, Any]]:
    """Split a flat positive prompt into categorized Anima Prompt Plus boxes."""
    tags = _split_tags_preserving_brackets(text)
    if not tags:
        return []

    buckets: dict[str, list[str]] = {cat: [] for cat in CATEGORY_DISPLAY_ORDER}
    for tag in tags:
        cat = _classify_single_tag(tag)
        buckets[cat].append(tag)

    raw_boxes: list[dict[str, Any]] = []
    idx = 0
    for cat in CATEGORY_DISPLAY_ORDER:
        items = buckets[cat]
        if not items:
            continue
        raw_boxes.append(
            {
                "id": f"imp_{idx}",
                "label": cat,
                "text": ", ".join(items) + ",",
                "disabled": False,
                "random": [],
                "picks": {},
            }
        )
        idx += 1
    return normalize_prompt_boxes(raw_boxes)


def _extract_inline_loras(text: str) -> tuple[str, list[dict[str, Any]]]:
    """Extract <lora:name:strength> tags from prompt text and return (cleaned_text, loras)."""
    loras: list[dict[str, Any]] = []

    def _repl(match: re.Match[str]) -> str:
        name = (match.group(1) or "").strip()
        strength_raw = match.group(2)
        try:
            strength = float(strength_raw) if strength_raw is not None else 1.0
        except ValueError:
            strength = 1.0
        if name:
            entry = normalize_lora_entry(
                {
                    "name": name,
                    "display_name": os.path.splitext(os.path.basename(name))[0],
                    "strength_model": strength,
                    "enabled": True,
                }
            )
            if entry:
                loras.append(entry)
        return ""

    cleaned = LORA_TAG_RE.sub(_repl, str(text or ""))
    # Clean up extra commas left behind after removing <lora:...> tags
    cleaned = re.sub(r"\s*,\s*(?:,\s*)+", ", ", cleaned)
    cleaned = re.sub(r"^\s*,\s*", "", cleaned).strip()
    return cleaned, loras


def _dedupe_loras(loras: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deduplicate LoRAs by normalized name/stem while keeping order."""
    result: list[dict[str, Any]] = []
    index_by_key: dict[str, int] = {}
    for entry in loras:
        norm = normalize_lora_entry(entry)
        if not norm:
            continue
        key = norm["name"].replace("\\", "/").lower()
        if key in index_by_key:
            result[index_by_key[key]] = norm
        else:
            index_by_key[key] = len(result)
            result.append(norm)
    return result


def _resolve_loras_against_available(
    loras: list[dict[str, Any]],
    available_loras: list[str] | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Match extracted LoRA names against locally installed ComfyUI LoRA filenames."""
    warnings: list[str] = []
    if not available_loras:
        return loras, warnings

    exact_map: dict[str, str] = {}
    base_map: dict[str, str] = {}
    stem_map: dict[str, str] = {}
    for raw in available_loras:
        clean = str(raw).replace("\\", "/").strip()
        if not clean:
            continue
        low = clean.lower()
        exact_map[low] = clean
        base = os.path.basename(clean).lower()
        base_map.setdefault(base, clean)
        stem = os.path.splitext(base)[0]
        stem_map.setdefault(stem, clean)

    resolved: list[dict[str, Any]] = []
    missing: list[str] = []
    for item in loras:
        copy_item = dict(item)
        raw_name = str(copy_item.get("name") or "").replace("\\", "/").strip()
        low = raw_name.lower()
        base = os.path.basename(raw_name).lower()
        stem = os.path.splitext(base)[0]

        matched = exact_map.get(low) or base_map.get(base) or stem_map.get(stem)
        if matched:
            copy_item["name"] = matched
            if not copy_item.get("display_name"):
                copy_item["display_name"] = os.path.splitext(os.path.basename(matched))[0]
        else:
            missing.append(raw_name)
        resolved.append(copy_item)

    if missing:
        shown = ", ".join(missing[:3])
        extra = f" ほか{len(missing) - 3}件" if len(missing) > 3 else ""
        warnings.append(f"ローカルの LoRA フォルダに見つからない項目があります: {shown}{extra}")

    return resolved, warnings


# ---------------------------------------------------------------------------
# ComfyUI API `prompt` graph parser
# ---------------------------------------------------------------------------


def _link_target(val: Any, graph: dict[str, Any]) -> str | None:
    if isinstance(val, list) and len(val) >= 2:
        nid = str(val[0])
        if nid in graph and isinstance(graph[nid], dict):
            return nid
    return None


def _collect_upstream_nodes(graph: dict[str, Any], start_ids: list[str]) -> set[str]:
    visited: set[str] = set()
    stack = [str(nid) for nid in start_ids if str(nid) in graph]
    while stack:
        nid = stack.pop()
        if nid in visited:
            continue
        visited.add(nid)
        node = graph.get(nid)
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs") or {}
        if not isinstance(inputs, dict):
            continue
        for val in inputs.values():
            target = _link_target(val, graph)
            if target and target not in visited:
                stack.append(target)
    return visited


def _find_anchor_samplers(graph: dict[str, Any]) -> list[str]:
    """Find active sampler node IDs, preferring samplers feeding SaveImage/PreviewImage."""
    output_ids = [
        nid
        for nid, node in graph.items()
        if isinstance(node, dict) and str(node.get("class_type") or "") in OUTPUT_IMAGE_TYPES
    ]
    reachable = _collect_upstream_nodes(graph, output_ids) if output_ids else set(graph.keys())

    primary = [
        nid
        for nid, node in graph.items()
        if isinstance(node, dict)
        and str(node.get("class_type") or "") in PRIMARY_SAMPLER_TYPES
        and nid in reachable
    ]
    if primary:
        return primary

    primary_any = [
        nid
        for nid, node in graph.items()
        if isinstance(node, dict) and str(node.get("class_type") or "") in PRIMARY_SAMPLER_TYPES
    ]
    if primary_any:
        return primary_any

    secondary = [
        nid
        for nid, node in graph.items()
        if isinstance(node, dict)
        and str(node.get("class_type") or "") in SECONDARY_SAMPLER_TYPES
        and nid in reachable
    ]
    return secondary


def _resolve_string_node(graph: dict[str, Any], node_id: str, visited: set[str] | None = None) -> str:
    """Resolve text output of a string/prompt node recursively."""
    if visited is None:
        visited = set()
    if node_id in visited or node_id not in graph:
        return ""
    visited.add(node_id)

    node = graph[node_id]
    if not isinstance(node, dict):
        return ""
    ctype = str(node.get("class_type") or "")
    inputs = node.get("inputs") or {}
    if not isinstance(inputs, dict):
        return ""

    if ctype in ANIMA_SELECTOR_CONFIG:
        _, tag_key = ANIMA_SELECTOR_CONFIG[ctype]
        parts: list[str] = []
        opt_target = _link_target(inputs.get("opt_prompt"), graph)
        if opt_target:
            upstream = _resolve_string_node(graph, opt_target, visited)
            if upstream:
                parts.append(upstream)
        for key in (tag_key, "extra_text"):
            val = inputs.get(key)
            if isinstance(val, str) and val.strip():
                parts.append(val.strip())
        return ", ".join(parts)

    if ctype in ANIMA_PROMPT_PLUS_TYPES:
        boxes = _extract_prompt_plus_boxes(graph, node_id)
        sep = str(inputs.get("separator") or ", ")
        return sep.join(b["text"].strip() for b in boxes if not b.get("disabled") and b.get("text", "").strip())

    # String concatenation nodes
    if "concat" in ctype.lower() or "join" in ctype.lower() or ctype == "AnimaPromptComposer":
        delimiter = str(inputs.get("delimiter") or inputs.get("separator") or ", ")
        pieces: list[str] = []
        for key, val in inputs.items():
            if key in ("delimiter", "separator", "clean_whitespace", "clip"):
                continue
            target = _link_target(val, graph)
            if target:
                sub = _resolve_string_node(graph, target, visited)
                if sub:
                    pieces.append(sub)
            elif isinstance(val, str) and val.strip():
                pieces.append(val.strip())
        return delimiter.join(pieces)

    # Generic single-text nodes (CLIPTextEncode, PrimitiveString, String, etc.)
    for key in ("text", "string", "value", "prompt", "text_g", "text_l", "clip_l", "t5xxl"):
        if key not in inputs:
            continue
        val = inputs[key]
        target = _link_target(val, graph)
        if target:
            sub = _resolve_string_node(graph, target, visited)
            if sub:
                return sub
        elif isinstance(val, str) and val.strip():
            return val.strip()

    return ""


def _extract_prompt_plus_boxes(graph: dict[str, Any], node_id: str) -> list[dict[str, Any]]:
    node = graph.get(node_id) or {}
    inputs = node.get("inputs") or {}
    raw_boxes = inputs.get("prompt_boxes")
    boxes = normalize_prompt_boxes(raw_boxes)
    for box in boxes:
        box_input_key = f"box_{box['id']}"
        if box_input_key in inputs:
            val = inputs[box_input_key]
            target = _link_target(val, graph)
            if target:
                resolved = _resolve_string_node(graph, target)
                if resolved:
                    box["text"] = resolved
            elif isinstance(val, str) and val.strip():
                box["text"] = val
    return boxes


def _extract_selector_chain_boxes(graph: dict[str, Any], node_id: str) -> list[dict[str, Any]]:
    """Trace an Anima*Selector chain via opt_prompt into ordered category boxes."""
    chain: list[dict[str, Any]] = []
    visited: set[str] = set()
    cur: str | None = node_id

    while cur and cur not in visited and cur in graph:
        visited.add(cur)
        node = graph[cur]
        if not isinstance(node, dict):
            break
        ctype = str(node.get("class_type") or "")
        inputs = node.get("inputs") or {}
        if ctype in ANIMA_SELECTOR_CONFIG:
            label, tag_key = ANIMA_SELECTOR_CONFIG[ctype]
            parts: list[str] = []
            for key in (tag_key, "extra_text"):
                val = inputs.get(key)
                if isinstance(val, str) and val.strip():
                    parts.append(val.strip())
            if parts:
                chain.append(
                    {
                        "id": f"sel_{cur}",
                        "label": label,
                        "text": ", ".join(parts),
                        "disabled": False,
                        "random": [],
                        "picks": {},
                    }
                )
            cur = _link_target(inputs.get("opt_prompt"), graph)
        else:
            # Non-selector text node feeding into the start of the selector chain
            upstream_text = _resolve_string_node(graph, cur)
            if upstream_text:
                chain.append(
                    {
                        "id": f"sel_{cur}",
                        "label": "プロンプト",
                        "text": upstream_text,
                        "disabled": False,
                        "random": [],
                        "picks": {},
                    }
                )
            break

    chain.reverse()
    return normalize_prompt_boxes(chain)


def _extract_loras_from_node(node: dict[str, Any]) -> list[dict[str, Any]]:
    ctype = str(node.get("class_type") or "")
    inputs = node.get("inputs") or {}
    if not isinstance(inputs, dict):
        return []

    if ctype == "AnimaMultiLoraLoader":
        return normalize_lora_list(inputs.get("lora_list_json"))

    if ctype in ("LoraLoader", "LoraLoaderModelOnly", "LoraLoader|pysssss", "Load LoRA"):
        raw_name = inputs.get("lora_name")
        if isinstance(raw_name, dict):
            raw_name = raw_name.get("content") or raw_name.get("name")
        name = str(raw_name or "").strip()
        if name and name.lower() != "none":
            entry = normalize_lora_entry(
                {
                    "name": name,
                    "display_name": os.path.splitext(os.path.basename(name))[0],
                    "strength_model": inputs.get("strength_model", 1.0),
                    "enabled": True,
                }
            )
            return [entry] if entry else []
        return []

    if "Power Lora Loader" in ctype:
        found: list[dict[str, Any]] = []
        lora_keys = sorted(
            (k for k in inputs.keys() if re.match(r"^lora_\d+$", k)),
            key=lambda k: int(k.split("_")[1]),
        )
        for key in lora_keys:
            val = inputs.get(key)
            if not isinstance(val, dict):
                continue
            lora_name = str(val.get("lora") or "").strip()
            if not lora_name or lora_name.lower() == "none":
                continue
            entry = normalize_lora_entry(
                {
                    "name": lora_name,
                    "display_name": os.path.splitext(os.path.basename(lora_name))[0],
                    "strength_model": val.get("strength", 1.0),
                    "enabled": bool(val.get("on", True)),
                }
            )
            if entry:
                found.append(entry)
        return found

    # Generic stackers: lora_name_1 / lora_wt_1 / switch_1
    if "lora" in ctype.lower():
        found_stack: list[dict[str, Any]] = []
        for idx in range(1, 21):
            name_key = f"lora_name_{idx}"
            if name_key not in inputs:
                continue
            name = str(inputs.get(name_key) or "").strip()
            if not name or name.lower() == "none":
                continue
            switch = inputs.get(f"switch_{idx}", True)
            enabled = switch not in (False, "Off", "off", "false", 0)
            strength = inputs.get(f"lora_wt_{idx}", inputs.get(f"model_weight_{idx}", 1.0))
            entry = normalize_lora_entry(
                {
                    "name": name,
                    "display_name": os.path.splitext(os.path.basename(name))[0],
                    "strength_model": strength,
                    "enabled": enabled,
                }
            )
            if entry:
                found_stack.append(entry)
        if found_stack:
            return found_stack

    return []


def _collect_positive_chain_nodes(graph: dict[str, Any], anchor_samplers: list[str]) -> list[str]:
    """Collect node IDs reachable from sampler positive inputs (never traversing negative)."""
    starts: list[str] = []
    for sid in anchor_samplers:
        node = graph.get(sid) or {}
        inputs = node.get("inputs") or {}
        pos_target = _link_target(inputs.get("positive"), graph)
        if pos_target:
            starts.append(pos_target)
        # SamplerCustomAdvanced uses guider -> CFGGuider/BasicGuider -> positive/conditioning
        guider_target = _link_target(inputs.get("guider"), graph)
        if guider_target:
            g_inputs = (graph.get(guider_target) or {}).get("inputs") or {}
            for gkey in ("positive", "conditioning"):
                gt = _link_target(g_inputs.get(gkey), graph)
                if gt:
                    starts.append(gt)

    if not starts:
        return list(graph.keys())

    visited: list[str] = []
    seen: set[str] = set()
    queue = list(starts)
    while queue:
        nid = queue.pop(0)
        if nid in seen or nid not in graph:
            continue
        seen.add(nid)
        visited.append(nid)
        inputs = (graph[nid] or {}).get("inputs") or {}
        if not isinstance(inputs, dict):
            continue
        for key, val in inputs.items():
            if "negative" in key.lower():
                continue
            target = _link_target(val, graph)
            if target and target not in seen:
                queue.append(target)
    return visited


def _collect_model_chain_loras(graph: dict[str, Any], anchor_samplers: list[str]) -> list[dict[str, Any]]:
    """Trace model path upstream from samplers and return LoRAs in application order."""
    starts: list[str] = []
    for sid in anchor_samplers:
        node = graph.get(sid) or {}
        inputs = node.get("inputs") or {}
        model_target = _link_target(inputs.get("model"), graph)
        if model_target:
            starts.append(model_target)
        guider_target = _link_target(inputs.get("guider"), graph)
        if guider_target:
            g_inputs = (graph.get(guider_target) or {}).get("inputs") or {}
            gt = _link_target(g_inputs.get("model"), graph)
            if gt:
                starts.append(gt)

    if not starts:
        # Fallback: scan all nodes in numeric/insertion order
        all_loras: list[dict[str, Any]] = []
        for nid in graph:
            node = graph[nid]
            if isinstance(node, dict):
                all_loras.extend(_extract_loras_from_node(node))
        return _dedupe_loras(all_loras)

    ordered_nodes: list[str] = []
    seen: set[str] = set()

    def _dfs_model(nid: str) -> None:
        if nid in seen or nid not in graph:
            return
        seen.add(nid)
        node = graph[nid]
        if not isinstance(node, dict):
            return
        inputs = node.get("inputs") or {}
        if isinstance(inputs, dict):
            # Visit upstream model/lora_stack inputs first so LoRAs end up in execution order
            for key in ("model", "base_model", "lora_stack", "pipe", "basic_pipe"):
                target = _link_target(inputs.get(key), graph)
                if target:
                    _dfs_model(target)
        ordered_nodes.append(nid)

    for s in starts:
        _dfs_model(s)

    collected: list[dict[str, Any]] = []
    for nid in ordered_nodes:
        collected.extend(_extract_loras_from_node(graph[nid]))
    return _dedupe_loras(collected)


def _parse_comfy_prompt_graph(graph: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(graph, dict) or not graph:
        return None
    if not any(isinstance(v, dict) and "class_type" in v for v in graph.values()):
        return None

    anchors = _find_anchor_samplers(graph)
    pos_nodes = _collect_positive_chain_nodes(graph, anchors)
    loras = _collect_model_chain_loras(graph, anchors)

    # 1. Exact AnimaPromptPlus / AnimaPromptPlusClipEncode restoration
    for nid in pos_nodes:
        node = graph.get(nid) or {}
        ctype = str(node.get("class_type") or "")
        if ctype in ANIMA_PROMPT_PLUS_TYPES:
            boxes = _extract_prompt_plus_boxes(graph, nid)
            if boxes:
                sep = str((node.get("inputs") or {}).get("separator") or ", ")
                return {
                    "source_type": "comfy_anima_prompt_plus",
                    "source_label": "ComfyUI (Anima Prompt Plus)",
                    "separator": sep,
                    "loras": loras,
                    "prompt_boxes": boxes,
                    "raw_prompt_boxes": boxes,
                    "auto_categorized": False,
                }

    # 2. Anima*Selector chain restoration
    for nid in pos_nodes:
        node = graph.get(nid) or {}
        ctype = str(node.get("class_type") or "")
        if ctype in ANIMA_SELECTOR_CONFIG:
            boxes = _extract_selector_chain_boxes(graph, nid)
            if boxes:
                return {
                    "source_type": "comfy_anima_selectors",
                    "source_label": "ComfyUI (Anima Selector チェーン)",
                    "separator": ", ",
                    "loras": loras,
                    "prompt_boxes": boxes,
                    "raw_prompt_boxes": boxes,
                    "auto_categorized": False,
                }

    # 3. Standard CLIPTextEncode / generic text prompt restoration
    positive_texts: list[str] = []
    for nid in pos_nodes:
        node = graph.get(nid) or {}
        ctype = str(node.get("class_type") or "")
        if "cliptextencode" in ctype.lower() or ctype in ("AnimaPromptComposer",):
            text = _resolve_string_node(graph, nid)
            if text and text not in positive_texts:
                positive_texts.append(text)

    if not positive_texts:
        # Last resort: any text node in positive chain
        for nid in pos_nodes:
            text = _resolve_string_node(graph, nid)
            if text and text not in positive_texts:
                positive_texts.append(text)

    combined_text = ", ".join(t.strip().strip(",") for t in positive_texts if t.strip())
    cleaned_text, inline_loras = _extract_inline_loras(combined_text)
    all_loras = _dedupe_loras(loras + inline_loras)

    if not cleaned_text and not all_loras:
        return None

    raw_boxes = (
        normalize_prompt_boxes([{"id": "raw_0", "label": "プロンプト", "text": cleaned_text}])
        if cleaned_text
        else []
    )
    auto_boxes = auto_categorize_prompt(cleaned_text) if cleaned_text else []
    prompt_boxes = auto_boxes if auto_boxes else raw_boxes

    return {
        "source_type": "comfy_prompt",
        "source_label": "ComfyUI (標準プロンプト)",
        "separator": ", ",
        "loras": all_loras,
        "prompt_boxes": prompt_boxes,
        "raw_prompt_boxes": raw_boxes if raw_boxes else prompt_boxes,
        "auto_categorized": bool(auto_boxes),
    }


# ---------------------------------------------------------------------------
# ComfyUI UI `workflow` JSON fallback parser
# ---------------------------------------------------------------------------


def _parse_comfy_workflow_json(workflow: dict[str, Any]) -> dict[str, Any] | None:
    nodes_list = workflow.get("nodes")
    if not isinstance(nodes_list, list) or not nodes_list:
        return None

    active_nodes = [
        n for n in nodes_list if isinstance(n, dict) and n.get("mode", 0) not in (2, 4)
    ]

    loras: list[dict[str, Any]] = []
    prompt_boxes: list[dict[str, Any]] = []
    separator = ", "
    source_type = "comfy_workflow"
    source_label = "ComfyUI (Workflow JSON)"
    auto_categorized = False

    # Identify link IDs going into "negative" inputs so we skip negative CLIPTextEncode
    negative_node_ids: set[Any] = set()
    links_by_id: dict[Any, list[Any]] = {}
    for link in workflow.get("links") or []:
        if isinstance(link, list) and len(link) >= 4:
            links_by_id[link[0]] = link
    for n in active_nodes:
        for inp in n.get("inputs") or []:
            if isinstance(inp, dict) and "negative" in str(inp.get("name") or "").lower():
                lid = inp.get("link")
                if lid in links_by_id:
                    negative_node_ids.add(links_by_id[lid][1])

    clip_texts: list[str] = []

    for n in active_nodes:
        ntype = str(n.get("type") or "")
        wvals = n.get("widgets_values")
        if not isinstance(wvals, list):
            wvals = []

        if ntype == "AnimaMultiLoraLoader":
            for val in wvals:
                if isinstance(val, str) and val.strip().startswith("["):
                    parsed_loras = normalize_lora_list(val)
                    if parsed_loras:
                        loras.extend(parsed_loras)
                        break

        elif ntype in ("LoraLoader", "LoraLoaderModelOnly"):
            if wvals and isinstance(wvals[0], str) and wvals[0].strip():
                strength = wvals[1] if len(wvals) > 1 else 1.0
                entry = normalize_lora_entry(
                    {
                        "name": wvals[0],
                        "display_name": os.path.splitext(os.path.basename(wvals[0]))[0],
                        "strength_model": strength,
                        "enabled": True,
                    }
                )
                if entry:
                    loras.append(entry)

        elif "Power Lora Loader" in ntype:
            for val in wvals:
                if isinstance(val, dict) and val.get("lora"):
                    entry = normalize_lora_entry(
                        {
                            "name": val["lora"],
                            "display_name": os.path.splitext(os.path.basename(str(val["lora"])))[0],
                            "strength_model": val.get("strength", 1.0),
                            "enabled": bool(val.get("on", True)),
                        }
                    )
                    if entry:
                        loras.append(entry)

        elif ntype in ANIMA_PROMPT_PLUS_TYPES and not prompt_boxes:
            for val in wvals:
                if isinstance(val, str) and val.strip().startswith("["):
                    boxes = normalize_prompt_boxes(val)
                    if boxes:
                        prompt_boxes = boxes
                        source_type = "comfy_anima_prompt_plus"
                        source_label = "ComfyUI Workflow (Anima Prompt Plus)"
                        break
            for val in wvals:
                if isinstance(val, str) and len(val) <= 6 and not val.strip().startswith("["):
                    separator = val
                    break

        elif "cliptextencode" in ntype.lower() and n.get("id") not in negative_node_ids:
            for val in wvals:
                if isinstance(val, str) and val.strip():
                    low = val.lower()
                    if any(neg in low for neg in ("low quality", "worst quality", "bad anatomy")):
                        continue
                    clip_texts.append(val.strip())
                    break

    loras = _dedupe_loras(loras)
    if prompt_boxes:
        return {
            "source_type": source_type,
            "source_label": source_label,
            "separator": separator,
            "loras": loras,
            "prompt_boxes": prompt_boxes,
            "raw_prompt_boxes": prompt_boxes,
            "auto_categorized": False,
        }

    combined = ", ".join(t.strip().strip(",") for t in clip_texts if t.strip())
    cleaned_text, inline_loras = _extract_inline_loras(combined)
    all_loras = _dedupe_loras(loras + inline_loras)
    if not cleaned_text and not all_loras:
        return None

    raw_boxes = (
        normalize_prompt_boxes([{"id": "raw_0", "label": "プロンプト", "text": cleaned_text}])
        if cleaned_text
        else []
    )
    auto_boxes = auto_categorize_prompt(cleaned_text) if cleaned_text else []
    final_boxes = auto_boxes if auto_boxes else raw_boxes
    auto_categorized = bool(auto_boxes)

    return {
        "source_type": source_type,
        "source_label": source_label,
        "separator": ", ",
        "loras": all_loras,
        "prompt_boxes": final_boxes,
        "raw_prompt_boxes": raw_boxes if raw_boxes else final_boxes,
        "auto_categorized": auto_categorized,
    }


# ---------------------------------------------------------------------------
# A1111 `parameters` text parser
# ---------------------------------------------------------------------------


def _parse_a1111_parameters(parameters_text: str) -> dict[str, Any] | None:
    text = str(parameters_text or "").strip()
    if not text:
        return None

    # Positive prompt ends at "Negative prompt:" or "Steps:"
    pos_part = re.split(r"\r?\nNegative prompt:", text, maxsplit=1)[0]
    pos_part = re.split(r"\r?\nSteps:\s*\d+", pos_part, maxsplit=1)[0]
    if pos_part.startswith("Negative prompt:"):
        pos_part = ""

    cleaned_text, loras = _extract_inline_loras(pos_part.strip())
    loras = _dedupe_loras(loras)

    if not cleaned_text and not loras:
        return None

    raw_boxes = (
        normalize_prompt_boxes([{"id": "raw_0", "label": "プロンプト", "text": cleaned_text}])
        if cleaned_text
        else []
    )
    auto_boxes = auto_categorize_prompt(cleaned_text) if cleaned_text else []
    prompt_boxes = auto_boxes if auto_boxes else raw_boxes

    return {
        "source_type": "a1111_parameters",
        "source_label": "WebUI / A1111 (parameters)",
        "separator": ", ",
        "loras": loras,
        "prompt_boxes": prompt_boxes,
        "raw_prompt_boxes": raw_boxes if raw_boxes else prompt_boxes,
        "auto_categorized": bool(auto_boxes),
    }


def _suggest_name(filename: str, chunks: dict[str, str]) -> str:
    studio_meta_raw = chunks.get("anima_set_studio")
    if studio_meta_raw:
        try:
            studio_meta = json.loads(studio_meta_raw)
            if isinstance(studio_meta, dict):
                saved_name = str(studio_meta.get("set_name") or "").strip()
                if saved_name:
                    return saved_name
        except Exception:
            pass

    if filename:
        stem = os.path.splitext(os.path.basename(str(filename)))[0].strip()
        if stem:
            return stem[:60]
    return "画像から読込セット"


def extract_image_dimensions(raw_bytes: bytes) -> tuple[int, int] | None:
    """Read (width, height) from PNG / WebP / JPEG headers using stdlib only."""
    if not raw_bytes:
        return None
    # PNG IHDR
    if len(raw_bytes) >= 24 and raw_bytes[:8] == PNG_SIGNATURE and raw_bytes[12:16] == b"IHDR":
        w, h = struct.unpack(">II", raw_bytes[16:24])
        return (w, h) if w > 0 and h > 0 else None
    # WebP (VP8X / VP8L / VP8 )
    if len(raw_bytes) >= 30 and raw_bytes[:4] == b"RIFF" and raw_bytes[8:12] == b"WEBP":
        chunk = raw_bytes[12:16]
        if chunk == b"VP8X" and len(raw_bytes) >= 30:
            w = 1 + int.from_bytes(raw_bytes[24:27], "little")
            h = 1 + int.from_bytes(raw_bytes[27:30], "little")
            return (w, h) if w > 0 and h > 0 else None
        if chunk == b"VP8L" and len(raw_bytes) >= 25 and raw_bytes[20] == 0x2F:
            bits = int.from_bytes(raw_bytes[21:25], "little")
            w = 1 + (bits & 0x3FFF)
            h = 1 + ((bits >> 14) & 0x3FFF)
            return (w, h) if w > 0 and h > 0 else None
        if chunk == b"VP8 " and len(raw_bytes) >= 30 and raw_bytes[23:26] == b"\x9d\x01\x2a":
            w, h = struct.unpack("<HH", raw_bytes[26:30])
            w &= 0x3FFF
            h &= 0x3FFF
            return (w, h) if w > 0 and h > 0 else None
    # JPEG SOF
    if len(raw_bytes) >= 4 and raw_bytes[:2] == b"\xff\xd8":
        pos = 2
        total = len(raw_bytes)
        sof_markers = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
        while pos + 2 <= total:
            if raw_bytes[pos] != 0xFF:
                pos += 1
                continue
            while pos < total and raw_bytes[pos] == 0xFF:
                pos += 1
            if pos >= total:
                break
            marker = raw_bytes[pos]
            pos += 1
            if marker in (0xD8, 0xD9, 0x01) or (0xD0 <= marker <= 0xD7):
                if marker == 0xD9:
                    break
                continue
            if marker == 0xDA or pos + 2 > total:
                break
            seg_len = struct.unpack(">H", raw_bytes[pos : pos + 2])[0]
            if seg_len < 2 or pos + seg_len > total:
                break
            if marker in sof_markers and seg_len >= 7:
                h, w = struct.unpack(">HH", raw_bytes[pos + 3 : pos + 7])
                return (w, h) if w > 0 and h > 0 else None
            pos += seg_len
    return None


def import_set_from_image_bytes(
    raw_bytes: bytes,
    *,
    filename: str = "",
    available_loras: list[str] | None = None,
) -> dict[str, Any]:
    """Parse generated image bytes and return normalized SetStudio set fields."""
    if not raw_bytes:
        raise ValueError("画像データが空です")

    chunks = extract_image_metadata_chunks(raw_bytes)
    if not chunks:
        raise ValueError(
            "画像に生成メタデータが見つかりませんでした（PNG/WebP/JPEGのComfyUIまたはA1111生成画像を指定してください）"
        )

    parsed: dict[str, Any] | None = None

    # 1. Try ComfyUI API prompt graph first (most reliable for executed nodes)
    prompt_raw = chunks.get("prompt")
    if prompt_raw:
        try:
            prompt_obj = json.loads(prompt_raw)
            if isinstance(prompt_obj, dict):
                parsed = _parse_comfy_prompt_graph(prompt_obj)
        except Exception:
            parsed = None

    # 2. Fallback to ComfyUI workflow JSON
    if parsed is None and chunks.get("workflow"):
        try:
            wf_obj = json.loads(chunks["workflow"])
            if isinstance(wf_obj, dict):
                parsed = _parse_comfy_workflow_json(wf_obj)
        except Exception:
            parsed = None

    # 3. Fallback to A1111 parameters text
    if parsed is None and chunks.get("parameters"):
        parsed = _parse_a1111_parameters(chunks["parameters"])

    if parsed is None:
        raise ValueError(
            "画像メタデータからプロンプトやLoRA情報を読み取れませんでした（未対応形式またはメタデータ削除済みの可能性があります）"
        )

    resolved_loras, warnings = _resolve_loras_against_available(
        parsed.get("loras") or [],
        available_loras,
    )

    prompt_boxes = parsed.get("prompt_boxes") or []
    raw_prompt_boxes = parsed.get("raw_prompt_boxes") or prompt_boxes
    if not prompt_boxes:
        prompt_boxes = normalize_prompt_boxes([], ensure_non_empty=True)
        raw_prompt_boxes = prompt_boxes
        warnings.append("プロンプトテキストは見つかりませんでした（LoRAのみ読み込みました）")

    dims = extract_image_dimensions(raw_bytes)
    detected_ratio = ""
    if dims and dims[0] >= 16 and dims[1] >= 16:
        detected_ratio = detect_aspect_ratio_from_size(dims[0], dims[1])

    return {
        "suggested_name": _suggest_name(filename, chunks),
        "source_type": parsed["source_type"],
        "source_label": parsed["source_label"],
        "separator": parsed.get("separator", ", "),
        "aspect_ratio": detected_ratio,
        "image_width": dims[0] if dims else 0,
        "image_height": dims[1] if dims else 0,
        "loras": resolved_loras,
        "prompt_boxes": prompt_boxes,
        "raw_prompt_boxes": raw_prompt_boxes,
        "auto_categorized": bool(parsed.get("auto_categorized", False)),
        "warnings": warnings,
    }
