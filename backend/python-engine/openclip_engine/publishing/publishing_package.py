from typing import List, Dict, Any, Optional
from openclip_engine.core.models import PublishingPackage

class PublishingEngine:
    """Generates complete SEO metadata, platform-tailored titles, hashtags, and thumbnail plans."""

    @classmethod
    def generate_package(
        cls,
        target_id: str,
        content_topic: str,
        niche: str = "Technology",
        key_quote_or_summary: str = "",
        aspect_ratio: str = "9:16"
    ) -> PublishingPackage:
        clean_topic = content_topic.strip()

        # Generate 4 title variations
        primary_title = f"{clean_topic}: What Nobody Told You"
        alternative_titles = [
            f"The Untold Truth About {clean_topic}",                 # Curiosity
            f"How {clean_topic} Actually Works (Full Breakdown)",     # Educational / Search
            f"Stop Doing This If You Care About {clean_topic}!",      # Emotional / Urgent
            f"Why {clean_topic} Will Change Everything in 2026",      # Visionary
        ]

        primary_kw = clean_topic.lower()
        seo_keywords = [
            primary_kw,
            f"{primary_kw} guide",
            f"{primary_kw} tips",
            f"best {primary_kw} shorts",
            f"{niche.lower()} trends 2026",
        ]

        tags = [
            primary_kw.replace(" ", ""),
            niche.lower(),
            "shortform",
            "viralvideo",
            "creator",
            "education",
        ]

        hashtags = [
            f"#{primary_kw.replace(' ', '')}",
            f"#{niche.lower()}",
            "#shorts",
            "#reels",
            "#viral",
            "#contentcreator",
        ]

        description = (
            f"Discover the key insight behind {clean_topic}.\n\n"
            f"Key Takeaway: {key_quote_or_summary or 'A deep dive into high-retention techniques.'}\n\n"
            f"Subscribe for more daily {niche} breakdowns and practical insights!\n\n"
            f"{' '.join(hashtags)}"
        )

        return PublishingPackage(
            target_id=target_id,
            primary_title=primary_title,
            alternative_titles=alternative_titles,
            description=description,
            primary_keyword=primary_kw,
            seo_keywords=seo_keywords,
            tags=tags,
            hashtags=hashtags,
            thumbnail_type="frame",
            recommended_aspect_ratio=aspect_ratio,
        )
