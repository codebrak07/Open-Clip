from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class MediaMetadata(BaseModel):
    duration_seconds: float
    width: int
    height: int
    fps: float
    codec: str
    audio_channels: int = 2
    audio_sample_rate: int = 44100
    file_size_bytes: int = 0
    title: Optional[str] = None
    uploader: Optional[str] = None

class TranscriptSegment(BaseModel):
    id: int
    start: float
    end: float
    text: str
    confidence: float = 1.0
    speaker: Optional[str] = None

class ValidatedFeature(BaseModel):
    name: str
    normalized_value: float = Field(ge=0.0, le=1.0)
    weight: float = Field(gt=0.0)
    evidence: str

class ViralityScoreResult(BaseModel):
    total_score: int = Field(ge=0, le=100)
    confidence: float = Field(ge=0.0, le=1.0)
    breakdown: Dict[str, float]
    explanations: List[str]
    scoring_version: str = "1.0.0"

class CandidateClip(BaseModel):
    id: str
    start_time: float
    end_time: float
    duration: float
    title: str
    opening_hook: str
    niche: str = "General"
    score: int
    confidence: float
    score_breakdown: Dict[str, float]
    recommended_aspect: str = "9:16"
    render_status: str = "pending"
    output_path: Optional[str] = None

class FootballEvent(BaseModel):
    minute: int
    event_type: str  # goal, assist, card, save, substitution, attack, turning_point
    player_name: Optional[str] = None
    description: str
    timestamp_seconds: Optional[float] = None
    verified: bool = True

class FootballMatchContext(BaseModel):
    home_team: str
    away_team: str
    competition: Optional[str] = None
    match_date: Optional[str] = None
    scoreline: Optional[str] = None
    verified: bool = False
    events: List[FootballEvent] = []
    source_url: Optional[str] = None

class CommentarySegment(BaseModel):
    timestamp_display: str
    speaker_role: str
    text: str
    duration_seconds: float

class CommentaryPackage(BaseModel):
    match_title: str
    language: str
    style: str
    opening_hook: str
    segments: List[CommentarySegment]

class PublishingPackage(BaseModel):
    target_id: str
    primary_title: str
    alternative_titles: List[str]
    description: str
    primary_keyword: str
    seo_keywords: List[str]
    tags: List[str]
    hashtags: List[str]
    thumbnail_path: Optional[str] = None
    thumbnail_type: str = "frame"  # ai or frame
    recommended_aspect_ratio: str = "9:16"
