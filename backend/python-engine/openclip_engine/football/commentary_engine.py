from typing import List, Dict, Any
from openclip_engine.core.models import FootballMatchContext, CommentaryPackage, CommentarySegment

class FootballCommentaryEngine:
    """Generates structured, multilingual commentary timed to match highlights and events."""

    SUPPORTED_LANGUAGES = ["English", "Hindi", "Hinglish"]
    STYLES = [
        "Passionate Fan",
        "Professional Commentator",
        "Tactical Analyst",
        "Cinematic Storyteller",
        "Funny Creator",
        "Dramatic Narrator",
    ]

    @classmethod
    def generate_commentary(
        cls,
        ctx: FootballMatchContext,
        language: str = "English",
        style: str = "Passionate Fan",
        duration_seconds: int = 45
    ) -> CommentaryPackage:
        home = ctx.home_team
        away = ctx.away_team
        score = ctx.scoreline or "intense clash"
        comp = ctx.competition or "high-stakes battle"

        if language == "Hinglish":
            hook = f"Bhai, {home} aur {away} ka yeh match dekh ke hosh ud gaye!"
            segments = [
                CommentarySegment(
                    timestamp_display="00:00 - 00:05",
                    speaker_role="Host",
                    text=f"Bhai, {home} aur {away} ke is {comp} clash mein jo hua, kisi ne predict nahi kiya tha!",
                    duration_seconds=5.0,
                ),
                CommentarySegment(
                    timestamp_display="00:05 - 00:15",
                    speaker_role="Analyst",
                    text=f"First half mein defense solid tha, lekin second half mein pressure dramatically build hua.",
                    duration_seconds=10.0,
                ),
                CommentarySegment(
                    timestamp_display="00:15 - 00:30",
                    speaker_role="Commentator",
                    text=f"Yeh dekho critical play! Yahan transition itna sharp tha ki opponent defense split ho gaya!",
                    duration_seconds=15.0,
                ),
                CommentarySegment(
                    timestamp_display="00:30 - 00:45",
                    speaker_role="Host",
                    text=f"Final score: {score}. Kya aapko lagta hai yeh season-defining win thi? Comments mein batao!",
                    duration_seconds=15.0,
                ),
            ]
        elif language == "Hindi":
            hook = f"{home} और {away} के इस मुकाबले में इतिहास रच दिया गया!"
            segments = [
                CommentarySegment(
                    timestamp_display="00:00 - 00:05",
                    speaker_role="Host",
                    text=f"नमस्ते दोस्तों! {comp} का यह मुकाबला हर मायने में यादगार साबित हुआ।",
                    duration_seconds=5.0,
                ),
                CommentarySegment(
                    timestamp_display="00:05 - 00:20",
                    speaker_role="Commentator",
                    text=f"{home} ने शुरुआत से ही अपनी आक्रामक रणनीति का प्रदर्शन किया।",
                    duration_seconds=15.0,
                ),
                CommentarySegment(
                    timestamp_display="00:20 - 00:35",
                    speaker_role="Analyst",
                    text=f"मैच का मुख्य मोड़ तब आया जब मिडफील्ड ने खेल का पूरा नियंत्रण अपने हाथों में लिया।",
                    duration_seconds=15.0,
                ),
                CommentarySegment(
                    timestamp_display="00:35 - 00:45",
                    speaker_role="Host",
                    text=f"अंतिम परिणाम रहा {score}। इस खेल के बारे में अपनी राय जरूर दें।",
                    duration_seconds=10.0,
                ),
            ]
        else:  # English
            hook = f"The sheer intensity between {home} and {away} completely broke the script!"
            segments = [
                CommentarySegment(
                    timestamp_display="00:00 - 00:06",
                    speaker_role="Host",
                    text=f"The entire football world stopped when {home} met {away} in this {comp} fixture.",
                    duration_seconds=6.0,
                ),
                CommentarySegment(
                    timestamp_display="00:06 - 00:18",
                    speaker_role="Tactical Analyst",
                    text=f"Notice how the high press forced immediate turnover in the final third. Textbook execution.",
                    duration_seconds=12.0,
                ),
                CommentarySegment(
                    timestamp_display="00:18 - 00:32",
                    speaker_role="Commentator",
                    text=f"And here is the decisive breakthrough! The counter-attack was executed with laser precision.",
                    duration_seconds=14.0,
                ),
                CommentarySegment(
                    timestamp_display="00:32 - 00:45",
                    speaker_role="Host",
                    text=f"That sealed the {score} scoreline. Let us know who was your Man of the Match in the comments!",
                    duration_seconds=13.0,
                ),
            ]

        return CommentaryPackage(
            match_title=f"{home} vs {away} Highlights & Tactical Breakdown",
            language=language,
            style=style,
            opening_hook=hook,
            segments=segments,
        )
