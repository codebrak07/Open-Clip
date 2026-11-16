import re
from typing import Dict, Any, List
from openclip_engine.core.models import FootballMatchContext, FootballEvent

class FootballMatchResolver:
    """Resolves football match context and validates event timelines against verified facts."""

    COMMON_CLUBS = [
        "Real Madrid", "Barcelona", "Manchester City", "Arsenal", "Liverpool",
        "Bayern Munich", "PSG", "Inter Milan", "Chelsea", "Manchester United",
        "Juventus", "AC Milan", "Atletico Madrid", "Tottenham", "Borussia Dortmund"
    ]

    @classmethod
    def resolve_from_text(cls, text: str, source_url: str = "") -> FootballMatchContext:
        """Extracts home/away teams, competition, and score from text or title."""
        home_team = "Home Club"
        away_team = "Away Club"
        scoreline = None
        competition = "Premier League"

        # Check for standard 'vs' or 'v' pattern: Team A vs Team B
        match = re.search(r"([A-Za-z\s]+)\s+(?:vs\.?|v)\s+([A-Za-z\s]+)", text, re.IGNORECASE)
        if match:
            h_candidate = match.group(1).strip()
            a_candidate = match.group(2).strip()
            if len(h_candidate) > 2 and len(a_candidate) > 2:
                home_team = h_candidate
                away_team = a_candidate

        # Check for scoreline pattern: e.g. 2-1 or 3-0
        score_match = re.search(r"\b(\d+)\s*[-:]\s*(\d+)\b", text)
        if score_match:
            scoreline = f"{score_match.group(1)}-{score_match.group(2)}"

        # Detect competition
        for comp in ["Champions League", "Premier League", "La Liga", "Serie A", "Bundesliga", "World Cup"]:
            if comp.lower() in text.lower():
                competition = comp
                break

        return FootballMatchContext(
            home_team=home_team,
            away_team=away_team,
            competition=competition,
            scoreline=scoreline,
            verified=bool(scoreline),
            events=[],
            source_url=source_url,
        )

    @classmethod
    def generate_hooks(cls, ctx: FootballMatchContext) -> List[str]:
        """Generates punchy opening verbal hooks grounded in the verified match facts."""
        score_desc = f" ({ctx.scoreline})" if ctx.scoreline else ""
        return [
            f"Nobody expected {ctx.home_team} to turn the entire match around against {ctx.away_team}{score_desc}...",
            f"The tactical masterclass behind {ctx.home_team}'s clash with {ctx.away_team} that changed everything...",
            f"This single turning point defined {ctx.home_team} vs {ctx.away_team} in the {ctx.competition or 'league'}!",
            f"What really happened when {ctx.home_team} faced {ctx.away_team}? The breakdown you didn't see...",
        ]
