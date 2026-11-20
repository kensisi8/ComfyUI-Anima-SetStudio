import tempfile
import unittest

from backend.routes import handle_api_action
from backend.storage import SetStorage


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


if __name__ == "__main__":
    unittest.main()
