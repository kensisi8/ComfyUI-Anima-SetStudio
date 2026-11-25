from datetime import datetime
import json
import unittest

from backend.composer import (
    build_batch_jobs,
    compose_prompt_boxes_plan_b,
    filter_set_boxes,
    join_prompt_boxes_text,
    merge_loras,
    resolve_batch_datetime,
    resolve_filename_prefix,
)


class TestComposer(unittest.TestCase):
    def test_category_exclusion_and_plan_b_order(self):
        common_boxes = [
            {"id": "c1", "label": "品質", "text": "masterpiece, best quality,", "disabled": False},
            {"id": "c2", "label": "キャラ", "text": "girl_a, 1girl, silver hair,", "disabled": False},
            {"id": "c3", "label": "無効枠", "text": "should_not_appear,", "disabled": True},
        ]
        set_boxes = [
            {"id": "s1", "label": "品質", "text": "@old_artist,", "disabled": False},
            {"id": "s2", "label": "体格", "text": "medium build,", "disabled": False},
            {"id": "s3", "label": " キャラ ", "text": "girl_b, blue hair,", "disabled": False},
            {"id": "s4", "label": "衣装", "text": "summer dress,", "disabled": False, "random": ["pose"]},
            {"id": "s5", "label": "メモ", "text": "ignored_disabled,", "disabled": True},
        ]

        filtered = filter_set_boxes(set_boxes, ["品質", "キャラ"])
        self.assertEqual([b["label"] for b in filtered], ["体格", "衣装"])

        combined = compose_prompt_boxes_plan_b(common_boxes, set_boxes, ["品質", "キャラ"])
        self.assertEqual([b["label"] for b in combined], ["品質", "キャラ", "体格", "衣装"])
        self.assertEqual(combined[3]["random"], ["pose"])

        text = join_prompt_boxes_text(combined, ", ")
        self.assertEqual(
            text,
            "masterpiece, best quality, girl_a, 1girl, silver hair, medium build, summer dress, ",
        )

    def test_lora_merge_dedup_set_overrides_common(self):
        common = [
            {"name": "char_sample.safetensors", "strength_model": 0.9, "enabled": True},
            {"name": "style_a.safetensors", "strength_model": 1.0, "enabled": True},
            {"name": "disabled_common.safetensors", "strength_model": 1.0, "enabled": False},
        ]
        set_loras = [
            {"name": "style_a.safetensors", "strength_model": 0.65, "enabled": True},
            {"name": "outfit_dress.safetensors", "strength_model": 0.8, "enabled": True},
            {"name": "disabled_set.safetensors", "strength_model": 1.0, "enabled": False},
        ]
        merged = merge_loras(common, set_loras)
        self.assertEqual(
            [(m["name"], m["strength_model"]) for m in merged],
            [
                ("char_sample.safetensors", 0.9),
                ("style_a.safetensors", 0.65),
                ("outfit_dress.safetensors", 0.8),
            ],
        )

    def test_build_batch_jobs_anima_tools_mode_and_fallback(self):
        seeds = iter([101, 102, 201])
        payload = {
            "common_prompt_boxes": [
                {"id": "c1", "label": "キャラ", "text": "girl_a, 1girl,", "disabled": False},
            ],
            "common_loras": [
                {"name": "char_sample.safetensors", "strength_model": 0.85, "enabled": True},
            ],
            "negative_prompt": "low quality",
            "excluded_categories": ["キャラ"],
            "settings": {
                "unet_name": "oneObsessionAnima_v50.safetensors",
                "width": 832,
                "height": 1216,
                "steps": 30,
                "cfg": 4.0,
                "sampler_name": "er_sde",
                "scheduler": "simple",
                "images_per_set": 2,
                "filename_prefix": "%date:yyyyMMdd%/{set_name}",
            },
            "selected_sets": [
                {
                    "instance_id": "inst_1",
                    "source_set_id": "set_1",
                    "name": "夏服/テスト",
                    "enabled": True,
                    "loras": [{"name": "style_sample.safetensors", "strength_model": 1.0, "enabled": True}],
                    "prompt_boxes": [
                        {"id": "p1", "label": "キャラ", "text": "other_girl,", "disabled": False},
                        {"id": "p2", "label": "衣装", "text": "summer dress,", "disabled": False, "random": ["pose"]},
                    ],
                },
                {
                    "instance_id": "inst_disabled",
                    "source_set_id": "set_disabled",
                    "name": "スキップ",
                    "enabled": False,
                    "loras": [],
                    "prompt_boxes": [{"id": "p0", "label": "衣装", "text": "skip,", "disabled": False}],
                },
                {
                    "instance_id": "inst_2",
                    "source_set_id": "set_2",
                    "name": "制服",
                    "enabled": True,
                    "images_count": 1,
                    "loras": [],
                    "prompt_boxes": [{"id": "p3", "label": "衣装", "text": "school uniform,", "disabled": False}],
                },
            ],
        }

        fixed_now = datetime(2026, 11, 24, 23, 30, 5)
        jobs = build_batch_jobs(payload, use_anima_tools=True, seed_fn=lambda: next(seeds), now=fixed_now)
        self.assertEqual(len(jobs), 3)
        self.assertEqual([j["seed"] for j in jobs], [101, 102, 201])
        self.assertEqual(jobs[0]["set_name"], "夏服/テスト")
        self.assertEqual(jobs[0]["merged_loras_count"], 2)
        self.assertEqual(jobs[0]["positive_preview"], "girl_a, 1girl, summer dress, ")

        p0 = jobs[0]["prompt"]
        self.assertEqual(p0["4"]["class_type"], "AnimaMultiLoraLoader")
        self.assertEqual(p0["6"]["class_type"], "AnimaPromptPlusClipEncode")
        parsed_boxes = json.loads(p0["6"]["inputs"]["prompt_boxes"])
        self.assertEqual([b["label"] for b in parsed_boxes], ["キャラ", "衣装"])
        self.assertEqual(parsed_boxes[1]["random"], ["pose"])
        self.assertEqual(p0["11"]["inputs"]["filename_prefix"], "20261124/夏服_テスト")

        # Fallback mode (without Comfyui-Anima-Tools)
        fallback_seeds = iter([301, 302, 401])
        fb_jobs = build_batch_jobs(payload, use_anima_tools=False, seed_fn=lambda: next(fallback_seeds), now=fixed_now)
        fb_p0 = fb_jobs[0]["prompt"]
        self.assertEqual(fb_p0["4_0"]["class_type"], "LoraLoaderModelOnly")
        self.assertEqual(fb_p0["4_1"]["class_type"], "LoraLoaderModelOnly")
        self.assertEqual(fb_p0["5"]["inputs"]["model"], ["4_1", 0])
        self.assertEqual(fb_p0["6"]["class_type"], "CLIPTextEncode")
        self.assertEqual(fb_p0["6"]["inputs"]["text"], "girl_a, 1girl, summer dress, ")

    def test_filename_prefix_date_and_time_expansion(self):
        dt = datetime(2026, 11, 24, 9, 5, 7)
        self.assertEqual(
            resolve_filename_prefix("%date:yyyyMMdd%/%date:yyyyMMdd%", "制服", now=dt),
            "20261124/20261124",
        )
        self.assertEqual(
            resolve_filename_prefix("%date:yyyy-MM-dd_HH-mm-ss%/{set_name}", "制服/春", now=dt),
            "2026-11-24_09-05-07/制服_春",
        )
        self.assertEqual(
            resolve_filename_prefix("%date%/%time:hhmmss%", "制服", now=dt),
            "2026-11-24/090507",
        )
        # Timezone offset resolves without raising and honors offset sign
        jst_dt = resolve_batch_datetime(540)
        self.assertEqual(jst_dt.utcoffset().total_seconds(), 540 * 60)

    def test_seed_modes_fixed_increment_decrement_and_randomize(self):
        base_payload = {
            "common_prompt_boxes": [{"id": "c1", "label": "品質", "text": "masterpiece,", "disabled": False}],
            "selected_sets": [
                {
                    "instance_id": "i1",
                    "name": "セットA",
                    "enabled": True,
                    "images_count": 2,
                    "prompt_boxes": [{"id": "p1", "label": "衣装", "text": "dress,", "disabled": False}],
                },
                {
                    "instance_id": "i2",
                    "name": "セットB",
                    "enabled": True,
                    "images_count": 1,
                    "prompt_boxes": [{"id": "p2", "label": "衣装", "text": "uniform,", "disabled": False}],
                },
            ],
        }

        fixed_jobs = build_batch_jobs({**base_payload, "settings": {"seed_mode": "fixed", "seed": 1234567890123}})
        self.assertEqual([j["seed"] for j in fixed_jobs], [1234567890123, 1234567890123, 1234567890123])
        self.assertEqual(fixed_jobs[0]["prompt"]["9"]["inputs"]["seed"], 1234567890123)

        inc_jobs = build_batch_jobs({**base_payload, "settings": {"seed_mode": "increment", "seed": 500}})
        self.assertEqual([j["seed"] for j in inc_jobs], [500, 501, 502])

        dec_jobs = build_batch_jobs({**base_payload, "settings": {"seed_mode": "decrement", "seed": 500}})
        self.assertEqual([j["seed"] for j in dec_jobs], [500, 499, 498])

        rand_seeds = iter([11, 22, 33])
        rand_jobs = build_batch_jobs(
            {**base_payload, "settings": {"seed_mode": "randomize", "seed": 500}},
            seed_fn=lambda: next(rand_seeds),
        )
        self.assertEqual([j["seed"] for j in rand_jobs], [11, 22, 33])

    def test_per_set_aspect_ratio_scales_with_base_resolution(self):
        payload = {
            "common_prompt_boxes": [{"id": "c1", "label": "品質", "text": "masterpiece,", "disabled": False}],
            "settings": {
                "base_resolution": 1024,
                "default_aspect_ratio": "2:3",
                "images_per_set": 1,
            },
            "selected_sets": [
                {
                    "instance_id": "i_common",
                    "name": "共通比セット",
                    "aspect_ratio": "",
                    "enabled": True,
                    "prompt_boxes": [{"id": "p1", "label": "衣装", "text": "dress,", "disabled": False}],
                },
                {
                    "instance_id": "i_wide",
                    "name": "横長セット",
                    "aspect_ratio": "16:9",
                    "enabled": True,
                    "prompt_boxes": [{"id": "p2", "label": "背景", "text": "landscape,", "disabled": False}],
                },
                {
                    "instance_id": "i_square",
                    "name": "正方形セット",
                    "aspect_ratio": "1:1",
                    "enabled": True,
                    "prompt_boxes": [{"id": "p3", "label": "キャラ", "text": "portrait,", "disabled": False}],
                },
            ],
        }
        jobs = build_batch_jobs(payload, seed_fn=lambda: 42)
        self.assertEqual([(j["aspect_ratio"], j["width"], j["height"]) for j in jobs], [
            ("2:3", 832, 1248),
            ("16:9", 1360, 768),
            ("1:1", 1024, 1024),
        ])
        self.assertEqual(jobs[1]["prompt"]["8"]["inputs"]["width"], 1360)
        self.assertEqual(jobs[1]["prompt"]["8"]["inputs"]["height"], 768)

        # Switching collection base_resolution to 768 (draft) scales all sets uniformly
        draft_jobs = build_batch_jobs(
            {**payload, "settings": {"base_resolution": 768, "default_aspect_ratio": "2:3", "images_per_set": 1}},
            seed_fn=lambda: 42,
        )
        self.assertEqual([(j["width"], j["height"]) for j in draft_jobs], [
            (624, 944),
            (1024, 576),
            (768, 768),
        ])

    def test_empty_selection_raises(self):
        with self.assertRaises(ValueError):
            build_batch_jobs({"selected_sets": []})


if __name__ == "__main__":
    unittest.main()
