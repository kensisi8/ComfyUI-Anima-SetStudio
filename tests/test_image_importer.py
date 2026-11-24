import json
import struct
import unittest
import zlib

from backend.image_importer import (
    auto_categorize_prompt,
    extract_png_text_chunks,
    import_set_from_image_bytes,
)


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def _build_test_png(
    text_chunks: dict[str, str] | None = None,
    itxt_compressed: dict[str, str] | None = None,
) -> bytes:
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00\x00\x00\x00")
    parts = [b"\x89PNG\r\n\x1a\n", _png_chunk(b"IHDR", ihdr)]
    for key, val in (text_chunks or {}).items():
        parts.append(_png_chunk(b"tEXt", key.encode("latin-1") + b"\x00" + val.encode("utf-8")))
    for key, val in (itxt_compressed or {}).items():
        comp = zlib.compress(val.encode("utf-8"))
        payload = key.encode("latin-1") + b"\x00\x01\x00\x00\x00" + comp
        parts.append(_png_chunk(b"iTXt", payload))
    parts.append(_png_chunk(b"IDAT", idat))
    parts.append(_png_chunk(b"IEND", b""))
    return b"".join(parts)


def _build_minimal_exif_with_ascii(tag: int, text: str) -> bytes:
    """Build a minimal little-endian TIFF/EXIF block containing one ASCII tag."""
    text_bytes = text.encode("utf-8") + b"\x00"
    # Header (8 bytes) + IFD count (2) + 1 entry (12) + next_ifd (4) = 26 bytes
    value_offset = 26
    header = b"II" + struct.pack("<HI", 42, 8)
    ifd = struct.pack("<H", 1) + struct.pack("<HHII", tag, 2, len(text_bytes), value_offset) + struct.pack("<I", 0)
    return b"Exif\x00\x00" + header + ifd + text_bytes


def _build_test_webp_with_exif(exif_bytes: bytes) -> bytes:
    exif_chunk = b"EXIF" + struct.pack("<I", len(exif_bytes)) + exif_bytes
    if len(exif_bytes) & 1:
        exif_chunk += b"\x00"
    body = b"WEBP" + exif_chunk
    return b"RIFF" + struct.pack("<I", len(body)) + body


def _build_test_jpeg_with_exif(exif_bytes: bytes) -> bytes:
    app1 = b"\xff\xe1" + struct.pack(">H", len(exif_bytes) + 2) + exif_bytes
    return b"\xff\xd8" + app1 + b"\xff\xd9"


class TestImageImporter(unittest.TestCase):
    def test_png_anima_prompt_plus_and_multi_lora_ignores_decoy_nodes(self):
        active_boxes = [
            {"id": "b1", "label": "品質", "text": "@sample_artist, masterpiece, best quality,", "disabled": False, "random": [], "picks": {}},
            {"id": "b2", "label": "衣装", "text": "school uniform, pleated skirt,", "disabled": False, "random": ["clothing"], "picks": {"clothing": 1}},
            {"id": "b3", "label": "一時OFF", "text": "unused_tag,", "disabled": True, "random": [], "picks": {}},
        ]
        active_loras = [
            {"name": "styles/sample_style_v1.safetensors", "strength_model": 0.85, "enabled": True, "display_name": "SampleStyle"},
            {"name": "outfits/uniform_v1.safetensors", "strength_model": 0.7, "enabled": False},
        ]
        prompt_graph = {
            "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "sample_anima.safetensors"}},
            "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "sample_clip.safetensors", "type": "lumina2"}},
            "3": {
                "class_type": "AnimaMultiLoraLoader",
                "inputs": {"model": ["1", 0], "lora_list_json": json.dumps(active_loras)},
            },
            "4": {
                "class_type": "AnimaPromptPlusClipEncode",
                "inputs": {
                    "clip": ["2", 0],
                    "prompt_boxes": json.dumps(active_boxes, ensure_ascii=False),
                    "separator": ", ",
                },
            },
            "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": "low quality, bad anatomy"}},
            "6": {
                "class_type": "KSampler",
                "inputs": {"model": ["3", 0], "positive": ["4", 0], "negative": ["5", 0]},
            },
            "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0]}},
            # Disconnected decoy nodes that should NOT be imported
            "90": {
                "class_type": "AnimaMultiLoraLoader",
                "inputs": {"lora_list_json": json.dumps([{"name": "decoy_lora.safetensors", "strength_model": 1.0, "enabled": True}])},
            },
            "91": {
                "class_type": "AnimaPromptPlus",
                "inputs": {"prompt_boxes": json.dumps([{"id": "x", "label": "ダミー", "text": "should_not_appear"}])},
            },
        }
        png = _build_test_png(
            text_chunks={
                "anima_set_studio": json.dumps({"set_name": "制服イラストセット"}, ensure_ascii=False),
            },
            itxt_compressed={"prompt": json.dumps(prompt_graph, ensure_ascii=False)},
        )

        chunks = extract_png_text_chunks(png)
        self.assertIn("prompt", chunks)

        imported = import_set_from_image_bytes(png, filename="ignored_name.png")
        self.assertEqual(imported["suggested_name"], "制服イラストセット")
        self.assertEqual(imported["source_type"], "comfy_anima_prompt_plus")
        self.assertFalse(imported["auto_categorized"])
        self.assertEqual([b["label"] for b in imported["prompt_boxes"]], ["品質", "衣装", "一時OFF"])
        self.assertEqual(imported["prompt_boxes"][1]["random"], ["clothing"])
        self.assertTrue(imported["prompt_boxes"][2]["disabled"])
        self.assertEqual([l["name"] for l in imported["loras"]], [
            "styles/sample_style_v1.safetensors",
            "outfits/uniform_v1.safetensors",
        ])
        self.assertEqual(imported["loras"][0]["strength_model"], 0.85)
        self.assertFalse(imported["loras"][1]["enabled"])

    def test_png_standard_lora_chain_and_auto_categorize(self):
        prompt_graph = {
            "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "sample.safetensors"}},
            "2": {
                "class_type": "LoraLoaderModelOnly",
                "inputs": {"model": ["1", 0], "lora_name": "style_a.safetensors", "strength_model": 0.6},
            },
            "3": {
                "class_type": "LoraLoaderModelOnly",
                "inputs": {"model": ["2", 0], "lora_name": "outfit_b.safetensors", "strength_model": 0.9},
            },
            "4": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": "@demo_artist, masterpiece, best quality, 1girl, long blonde hair, blue eyes, school uniform, standing, cherry blossoms, blue sky",
                },
            },
            "5": {"class_type": "CLIPTextEncode", "inputs": {"text": "low quality"}},
            "6": {"class_type": "KSampler", "inputs": {"model": ["3", 0], "positive": ["4", 0], "negative": ["5", 0]}},
        }
        png = _build_test_png(text_chunks={"prompt": json.dumps(prompt_graph)})

        imported = import_set_from_image_bytes(
            png,
            filename="sakura_uniform.png",
            available_loras=["anima/styles/style_a.safetensors"],
        )
        self.assertEqual(imported["suggested_name"], "sakura_uniform")
        self.assertEqual(imported["source_type"], "comfy_prompt")
        self.assertTrue(imported["auto_categorized"])
        # Order preserved (style_a applied before outfit_b) + local path resolved
        self.assertEqual([l["name"] for l in imported["loras"]], [
            "anima/styles/style_a.safetensors",
            "outfit_b.safetensors",
        ])
        # Missing local LoRA triggers a helpful warning
        self.assertEqual(len(imported["warnings"]), 1)
        self.assertIn("outfit_b.safetensors", imported["warnings"][0])

        by_label = {b["label"]: b["text"] for b in imported["prompt_boxes"]}
        self.assertIn("masterpiece", by_label["品質"])
        self.assertIn("@demo_artist", by_label["画師"])
        self.assertIn("1girl", by_label["キャラ"])
        self.assertIn("school uniform", by_label["衣装"])
        self.assertIn("standing", by_label["ポーズ"])
        self.assertIn("blue sky", by_label["背景"])
        # Raw single-box copy is also provided for 1-click toggle
        self.assertEqual(len(imported["raw_prompt_boxes"]), 1)
        self.assertIn("school uniform", imported["raw_prompt_boxes"][0]["text"])

    def test_png_anima_selector_chain_and_power_lora_loader(self):
        prompt_graph = {
            "1": {"class_type": "UNETLoader", "inputs": {}},
            "2": {
                "class_type": "Power Lora Loader (rgthree)",
                "inputs": {
                    "model": ["1", 0],
                    "lora_1": {"on": True, "lora": "char_alpha.safetensors", "strength": 0.95},
                    "lora_2": {"on": False, "lora": "style_beta.safetensors", "strength": 0.5},
                },
            },
            "3": {
                "class_type": "AnimaArtistSelector",
                "inputs": {"artist_tags": "@artist_sample", "extra_text": ""},
            },
            "4": {
                "class_type": "AnimaClothingSelector",
                "inputs": {"opt_prompt": ["3", 0], "clothing_tags": "summer dress", "extra_text": "straw hat"},
            },
            "5": {"class_type": "CLIPTextEncode", "inputs": {"text": ["4", 0]}},
            "6": {"class_type": "KSampler", "inputs": {"model": ["2", 0], "positive": ["5", 0]}},
        }
        png = _build_test_png(text_chunks={"prompt": json.dumps(prompt_graph)})

        imported = import_set_from_image_bytes(png, filename="selector_chain.png")
        self.assertEqual(imported["source_type"], "comfy_anima_selectors")
        self.assertFalse(imported["auto_categorized"])
        self.assertEqual([(b["label"], b["text"]) for b in imported["prompt_boxes"]], [
            ("画師", "@artist_sample"),
            ("衣装", "summer dress, straw hat"),
        ])
        self.assertEqual(len(imported["loras"]), 2)
        self.assertTrue(imported["loras"][0]["enabled"])
        self.assertFalse(imported["loras"][1]["enabled"])

    def test_png_workflow_only_fallback_skips_muted_nodes(self):
        workflow = {
            "nodes": [
                {
                    "id": 1,
                    "type": "AnimaMultiLoraLoader",
                    "mode": 0,
                    "widgets_values": [
                        json.dumps([{"name": "wf_style.safetensors", "strength_model": 0.8, "enabled": True}])
                    ],
                },
                {
                    "id": 2,
                    "type": "AnimaMultiLoraLoader",
                    "mode": 2,  # Muted node should be ignored
                    "widgets_values": [
                        json.dumps([{"name": "muted_lora.safetensors", "strength_model": 1.0, "enabled": True}])
                    ],
                },
                {
                    "id": 3,
                    "type": "AnimaPromptPlusClipEncode",
                    "mode": 0,
                    "widgets_values": [
                        json.dumps([{"id": "w1", "label": "背景", "text": "sunny beach, ocean,", "disabled": False}]),
                        ", ",
                    ],
                },
            ],
            "links": [],
        }
        png = _build_test_png(text_chunks={"workflow": json.dumps(workflow)})
        imported = import_set_from_image_bytes(png, filename="workflow_only.png")
        self.assertEqual(imported["source_type"], "comfy_anima_prompt_plus")
        self.assertEqual([l["name"] for l in imported["loras"]], ["wf_style.safetensors"])
        self.assertEqual(imported["prompt_boxes"][0]["label"], "背景")
        self.assertIn("sunny beach", imported["prompt_boxes"][0]["text"])

    def test_a1111_parameters_with_inline_loras(self):
        params = (
            "masterpiece, best quality, 1girl, red dress, smiling, cafe interior, "
            "<lora:sample_painter:0.75> <lora:sample_dress:0.6:0.5>\n"
            "Negative prompt: low quality, bad hands\n"
            "Steps: 28, Sampler: Euler a, CFG scale: 7, Seed: 123456"
        )
        png = _build_test_png(text_chunks={"parameters": params})
        imported = import_set_from_image_bytes(png, filename="a1111_demo.png")
        self.assertEqual(imported["source_type"], "a1111_parameters")
        self.assertTrue(imported["auto_categorized"])
        self.assertEqual([(l["name"], l["strength_model"]) for l in imported["loras"]], [
            ("sample_painter", 0.75),
            ("sample_dress", 0.6),
        ])
        joined_all = " ".join(b["text"] for b in imported["prompt_boxes"])
        self.assertNotIn("<lora:", joined_all)
        self.assertIn("red dress", joined_all)

    def test_webp_and_jpeg_exif_prompt_extraction(self):
        prompt_graph = {
            "1": {"class_type": "CLIPTextEncode", "inputs": {"text": "masterpiece, 1girl, kimono, shrine"}},
            "2": {"class_type": "KSampler", "inputs": {"positive": ["1", 0]}},
        }
        exif = _build_minimal_exif_with_ascii(0x010E, "Prompt:" + json.dumps(prompt_graph))
        webp = _build_test_webp_with_exif(exif)
        jpeg = _build_test_jpeg_with_exif(exif)

        for raw, name in ((webp, "demo.webp"), (jpeg, "demo.jpg")):
            imported = import_set_from_image_bytes(raw, filename=name)
            self.assertEqual(imported["source_type"], "comfy_prompt")
            by_label = {b["label"]: b["text"] for b in imported["prompt_boxes"]}
            self.assertIn("kimono", by_label["衣装"])
            self.assertIn("shrine", by_label["背景"])

    def test_missing_metadata_raises_value_error(self):
        empty_png = _build_test_png()
        with self.assertRaises(ValueError):
            import_set_from_image_bytes(empty_png, filename="no_meta.png")

    def test_auto_categorize_preserves_weighted_parentheses(self):
        boxes = auto_categorize_prompt("(blue eyes:1.2), (school uniform, pleated skirt:1.1), sunset")
        by_label = {b["label"]: b["text"] for b in boxes}
        self.assertIn("(blue eyes:1.2)", by_label["キャラ"])
        self.assertIn("(school uniform, pleated skirt:1.1)", by_label["衣装"])
        self.assertIn("sunset", by_label["背景"])


if __name__ == "__main__":
    unittest.main()
