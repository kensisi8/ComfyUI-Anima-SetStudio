import os
import tempfile
import unittest

from backend.storage import SetStorage, validate_id


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
                "settings": {"width": 1024, "height": 1440, "steps": 28, "cfg": 4.5, "images_per_set": 3},
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
        self.assertEqual(saved["selected_sets"][0]["images_count"], 5)

        reloaded = self.storage.get_state()
        self.assertEqual(reloaded["common_loras"][0]["name"], "char_sample.safetensors")
        self.assertEqual(reloaded["selected_sets"][0]["name"], "テストセット")
        self.assertTrue(os.path.isfile(self.storage.state_path))


if __name__ == "__main__":
    unittest.main()
