from typing import List, Dict, Any
from openclip_engine.core.models import ValidatedFeature, ViralityScoreResult

class DeterministicScorer:
    """Calculates reproducible, explainable 9-dimension virality scores with separate confidence."""

    DEFAULT_FEATURE_WEIGHTS = {
        "hook_strength": 1.5,          # Immediate speech/visual engagement in first 1.5s
        "audience_match": 1.1,         # Speaker eye contact and face prominence
        "emotion": 1.2,                # Vocal inflection and energy peaks
        "speech_density": 1.0,         # Words-per-minute conversational cadence
        "novelty": 1.0,                # Unique phrasing and topic framing
        "story_progression": 1.2,      # Cohesive setup, buildup, and resolution
        "retention_prediction": 1.3,   # Estimated retention past 10s mark
        "visual_motion": 0.9,          # Camera dynamics and framing stability
        "technical_quality": 0.8,      # Resolution, audio SNR, and caption contrast
    }

    @classmethod
    def calculate_score(cls, features: List[ValidatedFeature]) -> ViralityScoreResult:
        if not features:
            return ViralityScoreResult(
                total_score=0,
                confidence=0.0,
                breakdown={},
                explanations=["No validated features provided for deterministic evaluation."],
            )

        weighted_sum = 0.0
        total_weight = 0.0
        breakdown: Dict[str, float] = {}
        explanations: List[str] = []

        for f in features:
            # Match directly or by alias
            weight = cls.DEFAULT_FEATURE_WEIGHTS.get(f.name, f.weight)
            weighted_sum += f.normalized_value * weight
            total_weight += weight
            score_contrib = round(f.normalized_value * 100, 1)
            breakdown[f.name] = score_contrib
            explanations.append(f"{f.name.replace('_', ' ').title()}: {score_contrib}/100 — {f.evidence}")

        final_normalized = weighted_sum / total_weight if total_weight > 0 else 0.0
        total_score = int(round(final_normalized * 100))

        # Confidence is an orthogonal reliability metric based on evidence completeness
        confidence = min(1.0, round(len(features) / len(cls.DEFAULT_FEATURE_WEIGHTS), 2))

        return ViralityScoreResult(
            total_score=max(0, min(100, total_score)),
            confidence=confidence,
            breakdown=breakdown,
            explanations=explanations,
            scoring_version="2.0.0",
        )
