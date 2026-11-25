import os
import tempfile
import unittest

from backend.storage import (
    SetStorage,
    compute_dimensions_for_aspect_ratio,
    detect_aspect_ratio_from_size,
    normalize_aspect_ratio,
    validate_id,
)


class TestSetStorage(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.storage = SetStorage(base_dir=self.tmpdir.name)

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_crud_set_lifecycle(self):
        created = self.storage.save_set(
            {
                "name": "制服衣装セット",
                "separator": ", ",
                "loras": [
                    {
                        "name": "sample_style_v1.safetensors",
                        "display_name": "SampleStyleV1",
                        "strength_model": 1.05,
                        "enabled": True,
                        "trained_words": ["@sample_artist"],
                    },
                    {"name": ""},  # invalid, should be dropped
                ],
                "prompt_boxes": [
                    {"id": "b1", "label": "品質", "text": "@sample_artist, masterpiece,", "disabled": False, "random": [], "picks": {}},
                    {"id": "b2", "label": "衣装", "text": "school uniform,", "disabled": False, "random": ["pose"], "picks": {"clothing": {"keys": ["uniform"]}}},
                ],
            }
        )
        self.assertTrue(created["id"].startswith("set_"))
        self.assertEqual(created["name"], "制服衣装セット")
        self.assertEqual(len(created["loras"]), 1)
        self.assertEqual(created["loras"][0]["strength_model"], 1.05)
        self.assertEqual(len(created["prompt_boxes"]), 2)
        self.assertEqual(created["prompt_boxes"][1]["random"], ["pose"])

        loaded = self.storage.get_set(created["id"])
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded["name"], "制服衣装セット")

        # Update existing set preserves created_at
        updated = self.storage.save_set({**loaded, "name": "制服セット改"})
        self.assertEqual(updated["id"], created["id"])
        self.assertEqual(updated["created_at"], created["created_at"])
        self.assertEqual(updated["name"], "制服セット改")

        # Duplicate set gets fresh ID and default copy suffix
        dup = self.storage.duplicate_set(created["id"])
        self.assertNotEqual(dup["id"], created["id"])
        self.assertEqual(dup["name"], "制服セット改 (コピー)")
        self.assertEqual(len(self.storage.list_sets()), 2)

        # Delete
        self.assertTrue(self.storage.delete_set(created["id"]))
        self.assertFalse(self.storage.delete_set(created["id"]))
        self.assertIsNone(self.storage.get_set(created["id"]))
        self.assertEqual(len(self.storage.list_sets()), 1)

    def test_rejects_empty_name_and_path_traversal(self):
        with self.assertRaises(ValueError):
            self.storage.save_set({"name": "   "})

        for bad_id in ["../evil", "..\\evil", "a/b", "set with spaces", ""]:
            with self.assertRaises(ValueError):
                validate_id(bad_id)
            with self.assertRaises(ValueError):
                self.storage.get_set(bad_id)

    def test_workspace_state_persistence_and_defaults(self):
        initial = self.storage.get_state()
        self.assertEqual(initial["settings"]["unet_name"], "oneObsessionAnima_v50.safetensors")
        self.assertEqual(initial["settings"]["cfg"], 4.0)
        self.assertEqual(initial["settings"]["steps"], 30)

        saved = self.storage.save_state(
            {
                "common_prompt_boxes": [
                    {"id": "c1", "label": "キャラ", "text": "girl_a, 1girl, silver hair,", "disabled": False}
                ],
                "common_loras": [
                    {"name": "char_sample.safetensors", "strength_model": 0.85, "enabled": True}
                ],
                "negative_prompt": "low quality",
                "excluded_categories": ["キャラ", " キャラ ", "品質"],
                "settings": {
                    "width": 1024,
                    "height": 1440,
                    "steps": 28,
                    "cfg": 4.5,
                    "images_per_set": 3,
                    "seed_mode": "increment",
                    "seed": 9007199254740001,
                },
                "selected_sets": [
                    {
                        "instance_id": "inst_1",
                        "source_set_id": "set_abc",
                        "name": "テストセット",
                        "images_count": 5,
                        "loras": [{"name": "style.safetensors", "strength_model": 1.0, "enabled": True}],
                        "prompt_boxes": [{"id": "p1", "label": "衣装", "text": "summer dress", "disabled": False}],
                    }
                ],
            }
        )
        self.assertEqual(saved["excluded_categories"], ["キャラ", "品質"])
        self.assertEqual(saved["settings"]["width"], 1024)
        self.assertEqual(saved["settings"]["images_per_set"], 3)
        self.assertEqual(saved["settings"]["seed_mode"], "increment")
        self.assertEqual(saved["settings"]["seed"], 9007199254740001)
        self.assertEqual(saved["selected_sets"][0]["images_count"], 5)

        reloaded = self.storage.get_state()
        self.assertEqual(reloaded["common_loras"][0]["name"], "char_sample.safetensors")
        self.assertEqual(reloaded["selected_sets"][0]["name"], "テストセット")
        self.assertTrue(os.path.isfile(self.storage.state_path))

    def test_thumbnail_save_compression_and_refcount_cleanup(self):
        # Create a 640x960 raw image (or WebP fallback if Pillow is absent)
        try:
            import io
            from PIL import Image  # type: ignore

            buf = io.BytesIO()
            Image.new("RGB", (640, 960), (120, 160, 210)).save(buf, format="PNG")
            raw_img = buf.getvalue()
            has_pil = True
        except Exception:
            # Minimal valid WebP RIFF header for zero-dependency test environments
            raw_img = b"RIFF\x14\x00\x00\x00WEBPVP8 \x08\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
            has_pil = False

        saved_thumb = self.storage.save_thumbnail(raw_img)
        thumb_name = saved_thumb["thumbnail"]
        self.assertTrue(thumb_name.startswith("thumb_"))
        self.assertTrue(thumb_name.endswith(".webp") or thumb_name.endswith(".jpg"))
        thumb_path = self.storage.get_thumbnail_path(thumb_name)
        self.assertIsNotNone(thumb_path)
        self.assertTrue(os.path.isfile(thumb_path))
        if has_pil:
            self.assertEqual(saved_thumb["format"], "webp")
            self.assertLessEqual(max(saved_thumb["width"], saved_thumb["height"]), 320)

        # Attach thumbnail to a set and duplicate it (both share the file)
        s1 = self.storage.save_set({"name": "サムネ付きセット", "thumbnail": thumb_name})
        self.assertEqual(s1["thumbnail"], thumb_name)
        s2 = self.storage.duplicate_set(s1["id"])
        self.assertEqual(s2["thumbnail"], thumb_name)

        # Deleting only s1 must keep the thumbnail file because s2 still references it
        self.storage.delete_set(s1["id"])
        self.assertTrue(os.path.isfile(thumb_path))

        # Deleting s2 cleans up the now-unreferenced thumbnail file
        self.storage.delete_set(s2["id"])
        self.assertFalse(os.path.exists(thumb_path))

        # Path traversal in thumbnail lookup is rejected
        with self.assertRaises(ValueError):
            self.storage.get_thumbnail_path("../secret.webp")

    def test_aspect_ratio_and_base_resolution_helpers(self):
        self.assertEqual(normalize_aspect_ratio("16:9"), "16:9")
        self.assertEqual(normalize_aspect_ratio("3/2"), "3:2")
        self.assertEqual(normalize_aspect_ratio("common"), "")
        self.assertEqual(normalize_aspect_ratio("invalid", allow_empty=False), "2:3")

        self.assertEqual(compute_dimensions_for_aspect_ratio(1024, "1:1"), (1024, 1024))
        self.assertEqual(compute_dimensions_for_aspect_ratio(1024, "2:3"), (832, 1248))
        self.assertEqual(compute_dimensions_for_aspect_ratio(1024, "3:2"), (1248, 832))
        self.assertEqual(compute_dimensions_for_aspect_ratio(1024, "16:9"), (1360, 768))
        self.assertEqual(compute_dimensions_for_aspect_ratio(768, "1:1"), (768, 768))

        self.assertEqual(detect_aspect_ratio_from_size(832, 1216), "2:3")
        self.assertEqual(detect_aspect_ratio_from_size(1344, 768), "16:9")
        self.assertEqual(detect_aspect_ratio_from_size(1024, 1024), "1:1")

        saved_set = self.storage.save_set({"name": "横長セット", "aspect_ratio": "16:9"})
        self.assertEqual(saved_set["aspect_ratio"], "16:9")
        reloaded_set = self.storage.get_set(saved_set["id"])
        self.assertEqual(reloaded_set["aspect_ratio"], "16:9")

        saved_state = self.storage.save_state(
            {
                "settings": {"base_resolution": 1216, "default_aspect_ratio": "3:4"},
                "selected_sets": [
                    {
                        "instance_id": "inst_r1",
                        "name": "横長セット",
                        "aspect_ratio": "16:9",
                        "prompt_boxes": [{"id": "b1", "label": "背景", "text": "sky", "disabled": False}],
                    }
                ],
            }
        )
        self.assertEqual(saved_state["settings"]["base_resolution"], 1216)
        self.assertEqual(saved_state["settings"]["default_aspect_ratio"], "3:4")
        self.assertEqual(saved_state["selected_sets"][0]["aspect_ratio"], "16:9")


if __name__ == "__main__":
    unittest.main()
