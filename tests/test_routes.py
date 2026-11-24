import base64
import json
import struct
import tempfile
import unittest
import zlib

from backend.routes import handle_api_action
from backend.storage import SetStorage


def _make_simple_prompt_png(prompt_graph: dict) -> bytes:
    def _chunk(ctype: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(ctype + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + ctype + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00\x00\x00\x00")
    txt = b"prompt\x00" + json.dumps(prompt_graph, ensure_ascii=False).encode("utf-8")
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"tEXt", txt) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")


class TestApiRoutes(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.storage = SetStorage(base_dir=self.tmpdir.name)

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_sets_and_state_and_build_jobs_handlers(self):
        # 1. Create set
        status, res = handle_api_action(
            self.storage,
            "save_set",
            payload={
                "name": "公園背景セット",
                "loras": [{"name": "sample_style.safetensors", "strength_model": 0.9, "enabled": True}],
                "prompt_boxes": [
                    {"id": "b1", "label": "キャラ", "text": "girl_b,", "disabled": False},
                    {"id": "b2", "label": "背景", "text": "outdoors, sunny park,", "disabled": False},
                ],
            },
        )
        self.assertEqual(status, 200)
        self.assertTrue(res["success"])
        set_id = res["set"]["id"]

        # 2. List & Duplicate
        status, listed = handle_api_action(self.storage, "list_sets")
        self.assertEqual(status, 200)
        self.assertEqual(len(listed["sets"]), 1)

        status, dup = handle_api_action(
            self.storage,
            "duplicate_set",
            set_id=set_id,
            payload={"name": "公園背景セット2"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(dup["set"]["name"], "公園背景セット2")

        # 3. Options
        status, opts = handle_api_action(self.storage, "get_options")
        self.assertEqual(status, 200)
        self.assertIn("samplers", opts["options"])
        self.assertIn("has_anima_tools", opts["options"])

        # 4. Build jobs
        status, built = handle_api_action(
            self.storage,
            "build_jobs",
            payload={
                "common_prompt_boxes": [{"id": "c1", "label": "キャラ", "text": "girl_a,", "disabled": False}],
                "excluded_categories": ["キャラ"],
                "settings": {"images_per_set": 2},
                "selected_sets": [
                    {
                        "instance_id": "inst_1",
                        "source_set_id": set_id,
                        "name": "公園背景セット",
                        "enabled": True,
                        "loras": res["set"]["loras"],
                        "prompt_boxes": res["set"]["prompt_boxes"],
                    }
                ],
            },
            options_provider=lambda: {"has_anima_tools": True},
        )
        self.assertEqual(status, 200)
        self.assertEqual(built["total"], 2)
        self.assertTrue(built["use_anima_tools"])
        self.assertEqual(built["jobs"][0]["positive_preview"], "girl_a, outdoors, sunny park, ")

        # 5. Error handling
        status, err = handle_api_action(self.storage, "get_set", set_id="../bad")
        self.assertEqual(status, 400)
        self.assertFalse(err["success"])

        status, not_found = handle_api_action(self.storage, "delete_set", set_id="set_nonexistent")
        self.assertEqual(status, 404)
        self.assertFalse(not_found["success"])

    def test_import_image_route_action(self):
        png_bytes = _make_simple_prompt_png(
            {
                "1": {
                    "class_type": "AnimaMultiLoraLoader",
                    "inputs": {
                        "lora_list_json": json.dumps(
                            [{"name": "demo_style.safetensors", "strength_model": 0.8, "enabled": True}]
                        )
                    },
                },
                "2": {
                    "class_type": "AnimaPromptPlusClipEncode",
                    "inputs": {
                        "prompt_boxes": json.dumps(
                            [{"id": "b1", "label": "衣装", "text": "maid dress,", "disabled": False}]
                        ),
                        "separator": ", ",
                    },
                },
                "3": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["2", 0]}},
            }
        )
        b64 = base64.b64encode(png_bytes).decode("ascii")
        status, res = handle_api_action(
            self.storage,
            "import_image",
            payload={"image_base64": f"data:image/png;base64,{b64}", "filename": "maid_sample.png"},
            options_provider=lambda: {"loras": ["styles/demo_style.safetensors"]},
        )
        self.assertEqual(status, 200)
        self.assertTrue(res["success"])
        imported = res["imported"]
        self.assertEqual(imported["suggested_name"], "maid_sample")
        self.assertEqual(imported["loras"][0]["name"], "styles/demo_style.safetensors")
        self.assertEqual(imported["prompt_boxes"][0]["label"], "衣装")

        # Empty payload returns 400
        status_err, body_err = handle_api_action(self.storage, "import_image", payload={})
        self.assertEqual(status_err, 400)
        self.assertFalse(body_err["success"])


if __name__ == "__main__":
    unittest.main()
