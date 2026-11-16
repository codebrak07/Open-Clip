import unittest
from openclip_engine.ingestion.url_validator import URLValidator
from openclip_engine.scoring.deterministic_scorer import DeterministicScorer
from openclip_engine.core.models import ValidatedFeature
from openclip_engine.clipping.smart_reframe import SmartReframePlanner
from openclip_engine.football.match_resolver import FootballMatchResolver
from openclip_engine.football.commentary_engine import FootballCommentaryEngine
from openclip_engine.publishing.publishing_package import PublishingEngine

class TestOpenClipEngine(unittest.TestCase):
    def test_youtube_url_validator(self):
        self.assertTrue(URLValidator.is_valid_youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
        self.assertTrue(URLValidator.is_valid_youtube_url("https://youtu.be/dQw4w9WgXcQ"))
        self.assertTrue(URLValidator.is_valid_youtube_url("https://www.youtube.com/shorts/dQw4w9WgXcQ"))
        self.assertFalse(URLValidator.is_valid_youtube_url("https://vimeo.com/123456"))
        self.assertEqual(URLValidator.extract_youtube_video_id("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ")

    def test_deterministic_scorer_reproducibility(self):
        features = [
            ValidatedFeature(name="hook_strength", normalized_value=0.9, weight=1.5, evidence="hook test"),
            ValidatedFeature(name="standalone_context", normalized_value=0.8, weight=1.2, evidence="context test"),
        ]
        res1 = DeterministicScorer.calculate_score(features)
        res2 = DeterministicScorer.calculate_score(features)
        self.assertEqual(res1.total_score, res2.total_score)
        self.assertEqual(res1.total_score, 86)
        self.assertIn("hook_strength", res1.breakdown)

    def test_smart_reframing_7_aspect_ratios(self):
        # 9:16 vertical
        crop916 = SmartReframePlanner.calculate_crop(1920, 1080, "9:16", {"x": 960, "y": 540})
        self.assertEqual(crop916["width"], 608)
        self.assertEqual(crop916["height"], 1080)
        self.assertIn("crop=608:1080", crop916["ffmpeg_filter"])

        # 1:1 square
        crop11 = SmartReframePlanner.calculate_crop(1920, 1080, "1:1")
        self.assertEqual(crop11["width"], 1080)
        self.assertEqual(crop11["height"], 1080)

        # 4:5 social feed
        crop45 = SmartReframePlanner.calculate_crop(1920, 1080, "4:5")
        self.assertEqual(crop45["width"], 864)
        self.assertEqual(crop45["height"], 1080)

        # 21:9 ultrawide
        crop219 = SmartReframePlanner.calculate_crop(1920, 1080, "21:9")
        self.assertEqual(crop219["width"], 1920)
        self.assertEqual(crop219["height"], 822)

    def test_football_match_resolver_and_commentary(self):
        text = "Arsenal vs Manchester City 1-0 Premier League"
        ctx = FootballMatchResolver.resolve_from_text(text)
        self.assertEqual(ctx.home_team, "Arsenal")
        self.assertEqual(ctx.away_team, "Manchester City")
        self.assertEqual(ctx.scoreline, "1-0")
        self.assertTrue(ctx.verified)

        hooks = FootballMatchResolver.generate_hooks(ctx)
        self.assertGreaterEqual(len(hooks), 4)
        self.assertIn("Arsenal", hooks[0])

        commentary = FootballCommentaryEngine.generate_commentary(ctx, language="English", style="Tactical Analyst")
        self.assertGreaterEqual(len(commentary.segments), 4)
        self.assertNotEqual(commentary.opening_hook, "")

    def test_publishing_engine_package(self):
        pkg = PublishingEngine.generate_package(
            target_id="clip_1",
            content_topic="AI Video Automation",
            niche="Technology"
        )
        self.assertEqual(len(pkg.alternative_titles), 4)
        self.assertEqual(pkg.primary_keyword, "ai video automation")
        self.assertGreaterEqual(len(pkg.seo_keywords), 5)
        self.assertGreaterEqual(len(pkg.hashtags), 5)

if __name__ == "__main__":
    unittest.main()
