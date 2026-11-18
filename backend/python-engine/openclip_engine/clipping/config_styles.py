"""
Single source of truth for all clip rendering configuration dataclasses:
  - LayoutStyle (M1 + M5 encoder/quality/layout settings)
  - CaptionStyle (M2 Karaoke Pop two-layer glow, palette, smear, timing)
  - TitleStyle (M3 Impact ALL CAPS main title + yellow keyword glow)
  - SfxConfig (M4 sound effects indexing, synthesis, rules, cooldowns, mix gains)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Tuple

REPO_ROOT = Path(__file__).resolve().parents[4]
ASSETS_FONTS_DIR = REPO_ROOT / "assets" / "fonts"
ASSETS_SFX_DIR = REPO_ROOT / "assets" / "sfx"


@dataclass(frozen=True)
class LayoutStyle:
    # Canvas & window geometry
    canvas_w: int = 1080
    canvas_h: int = 1920
    video_aspect: str = "4:5"        # "4:5" (1080x1350) or "3:4" (1080x1440)
    window_w: int = 1080
    window_h: int = 1350
    window_top: int = 340            # y 0..340 is title zone
    fit_mode: str = "cover"          # "cover" (uniform scale+crop) | "contain" (letterbox inside window)

    # Blurred background (computed at 1/8 res for M5 speed; sigma=5 at 1/8 ~= sigma=10 at 1/4 ~= 40px full-res)
    blur_enabled: bool = True
    bg_scale_div: int = 8            # 1080/8=135, 1920/8=240
    bg_blur_sigma: float = 5.0
    bg_brightness: float = -0.10
    bg_saturation: float = 1.10

    # Adaptive grade on video window ONLY
    grade_enabled: bool = True
    grade_contrast: float = 1.10
    grade_saturation: float = 1.08
    grade_luma_target: float = 0.45
    grade_luma_gain: float = 0.25
    grade_b_min: float = -0.04
    grade_b_max: float = 0.06
    grade_sample_count: int = 8
    unsharp_lx: int = 5
    unsharp_ly: int = 5
    unsharp_la: float = 0.5
    unsharp_cx: int = 5
    unsharp_cy: int = 5
    unsharp_ca: float = 0.0

    # Optional visual features (default off)
    smart_crop: bool = False
    smart_crop_fps: float = 4.0
    smart_crop_ema_alpha: float = 0.15
    smart_crop_max_pan_px_s: float = 240.0
    subject_pop: bool = False
    subject_pop_brightness: float = 0.04

    # Feature switches (plain 4:5 mode disables blur and title)
    title_enabled: bool = True
    captions_enabled: bool = True

    # Encoding & M5 performance settings
    quality: str = "balanced"        # "fast" | "balanced" | "max"
    vt_bitrate_fast: str = "8M"
    vt_bitrate_balanced: str = "12M"
    vt_maxrate: str = "16M"
    x264_preset_fallback: str = "veryfast"
    x264_crf_fallback: int = 20
    x264_preset_max: str = "slow"
    x264_crf_max: int = 18
    audio_bitrate: str = "192k"
    hwaccel_decode: bool = False     # Step 0 proved CPU decode + VT encode is faster than hwaccel VT decode

    def resolved_window_dims(self) -> Tuple[int, int, int]:
        """Returns (win_w, win_h, win_top) honoring video_aspect and blur_enabled."""
        if not self.blur_enabled and self.canvas_w == 1080 and self.canvas_h == 1350:
            return (self.canvas_w, self.canvas_h, 0)
        if self.video_aspect == "3:4":
            win_w = self.canvas_w
            win_h = min(self.canvas_h - self.window_top, int(round(win_w * 4 / 3)))
            win_h -= win_h % 2
            return (win_w, win_h, self.window_top)
        return (self.window_w, self.window_h, self.window_top)


DEFAULT_LAYOUT = LayoutStyle()

PLAIN_4_5_LAYOUT = LayoutStyle(
    canvas_w=1080,
    canvas_h=1350,
    video_aspect="4:5",
    window_w=1080,
    window_h=1350,
    window_top=0,
    blur_enabled=False,
    title_enabled=False,
)


@dataclass(frozen=True)
class CaptionStyle:
    # Geometry relative to canvas/window
    font_size_pct: float = 0.102            # 110px at W=1080
    max_word_width_pct: float = 0.90        # shrink to fit if word exceeds 0.9*W
    anchor_x_pct: float = 0.48              # horizontal center 0.48*W
    center_y_pct: float = 0.54              # window_top + 0.54*window_h (1069 on default 9:16)
    strip_height_font_mult: float = 3.0     # strip = W x ~3*font_px (~330px at 1080w)

    # Fonts (Times New Roman Regular primary; Tinos/Liberation Serif bundled fallback; NEVER bold)
    font_paths: Tuple[str, ...] = (
        "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
        str(ASSETS_FONTS_DIR / "LiberationSerif-Regular.ttf"),
        str(ASSETS_FONTS_DIR / "Tinos-Regular.ttf"),
        "/Library/Fonts/Times New Roman.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
    )

    # Strict palette (ONLY these 4 colors + white emphasis base)
    palette: Dict[str, Tuple[int, int, int]] = field(default_factory=lambda: {
        "yellow": (245, 240, 0),    # #F5F000
        "cyan": (46, 230, 240),     # #2EE6F0
        "red": (255, 30, 30),       # #FF1E1E
        "green": (27, 255, 27),     # #1BFF1B
        "white": (255, 255, 255),   # #FFFFFF (emphasis base only)
    })
    normal_colors: Tuple[str, ...] = ("yellow", "cyan", "red", "green")
    emphasis_window_colors: Tuple[str, ...] = ("green", "yellow")
    emphasis_base_color: str = "white"

    # Layer 1: Drop shadow (black, alpha 0.7, offset (+3,+4)*(W/1080), sigma 1.5)
    shadow_color: Tuple[int, int, int] = (0, 0, 0)
    shadow_alpha: float = 0.70
    shadow_offset_x_1080: float = 3.0
    shadow_offset_y_1080: float = 4.0
    shadow_blur_sigma: float = 1.5

    # Layer 2 & 3: Two-layer normal alpha-over glow in saturated word color
    # Wide glow: sigma ~9px, alpha 0.65; Tight glow: sigma ~3px, alpha 0.90
    glow_enabled: bool = True
    glow_dilate_px: int = 5                 # compensates thin serif strokes so 4-14px ring stays bold
    wide_glow_sigma_1080: float = 9.0
    wide_glow_alpha: float = 0.65
    wide_glow_gain: float = 2.6             # normalizes Gaussian spread on thin serifs before capping at wide_glow_alpha
    tight_glow_sigma_1080: float = 3.0
    tight_glow_alpha: float = 0.90
    tight_glow_gain: float = 2.0

    # Entrance smear (time-based, fps-independent; same strength for every word & highlight step)
    smear_phase1_ms: float = 33.34          # 0-33ms
    smear_phase1_sigma_x_1080: float = 16.0
    smear_phase1_scale_x: float = 1.12
    smear_phase2_ms: float = 66.67          # 33-66ms
    smear_phase2_sigma_x_1080: float = 5.0
    smear_phase2_scale_x: float = 1.03

    # Optional horizontal ghost echo during phase 1 (default off)
    smear_echo: bool = False
    smear_echo_offsets_1080: Tuple[int, ...] = (8, 16, 24)
    smear_echo_alpha: float = 0.35

    # Timing & hold logic
    max_pause_hold_s: float = 0.25          # hold up to +0.25s after word.end if gap > 0.25s
    min_display_frames: int = 2             # minimum 2 frames per word
    min_window_frames: int = 2              # minimum 2 frames per highlight chunk
    caption_sync_offset_ms: float = 0.0     # shift timestamps if needed

    # Emphasis word rules
    emphasis_min_syllables: int = 3
    acronym_min_len: int = 2
    acronym_max_len: int = 5
    emphasis_stoplist: Tuple[str, ...] = (
        "every", "everyone", "everything", "everybody",
        "probably", "family", "different", "interesting", "camera",
    )

    # Legacy standalone encode settings & cache
    crf: int = 18
    color_seed: int = 1337
    band_height_pct: float = 0.34           # backward-compat alias for legacy tooling
    sprite_cache_dir: str = str(Path.home() / ".cache" / "openclip" / "sprites")


KARAOKE_POP = CaptionStyle()


@dataclass(frozen=True)
class TitleStyle:
    font_paths: Tuple[str, ...] = (
        "/System/Library/Fonts/Supplemental/Impact.ttf",
        str(ASSETS_FONTS_DIR / "Anton-Regular.ttf"),
        "/Library/Fonts/Impact.ttf",
        "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    )
    font_size_pct: float = 0.075            # 81px at W=1080
    min_font_size: int = 60
    max_width_pct: float = 0.88
    side_margin_px: int = 60
    max_lines: int = 2
    max_words: int = 8
    fallback_max_words: int = 6
    line_height: float = 1.05
    zone_y_top: int = 130                   # vertical center inside y 130..320
    zone_y_bottom: int = 320
    strip_height: int = 340                 # W x 340 at y=0

    # Typography colors, stroke & shadow
    fill_color: Tuple[int, int, int] = (255, 255, 255)
    keyword_color: Tuple[int, int, int] = (245, 240, 0)  # #F5F000
    stroke_px_1080: int = 8
    stroke_color: Tuple[int, int, int] = (0, 0, 0)
    shadow_offset_x_1080: float = 0.0
    shadow_offset_y_1080: float = 5.0
    shadow_sigma_1080: float = 4.0
    shadow_alpha: float = 0.60

    # Same two-layer glow for the keyword
    wide_glow_sigma_1080: float = 9.0
    wide_glow_alpha: float = 0.65
    wide_glow_gain: float = 2.2
    tight_glow_sigma_1080: float = 3.0
    tight_glow_alpha: float = 0.90
    tight_glow_gain: float = 1.8

    # Entrance smear (same 66ms as captions)
    smear_phase1_ms: float = 33.34
    smear_phase1_sigma_x_1080: float = 16.0
    smear_phase1_scale_x: float = 1.12
    smear_phase2_ms: float = 66.67
    smear_phase2_sigma_x_1080: float = 5.0
    smear_phase2_scale_x: float = 1.03

    sprite_cache_dir: str = str(Path.home() / ".cache" / "openclip" / "sprites")


DEFAULT_TITLE_STYLE = TitleStyle()


@dataclass(frozen=True)
class SfxConfig:
    sfx_dir: str = str(ASSETS_SFX_DIR)
    mode: str = "rules"                     # "rules" | "llm" | "off"
    seed: int = 42
    master_db: float = 0.0
    normalize_target_dbfs: float = -3.0
    sample_rate: int = 44100

    # Detection thresholds
    title_whoosh_t: float = 0.10
    title_whoosh_intensity: float = 0.6
    scene_threshold: float = 0.4
    scene_min_gap_s: float = 0.5
    scene_whoosh_intensity: float = 0.6
    shout_min_letters: int = 3
    shout_intensity: float = 0.8
    emphasis_pop_intensity: float = 0.4
    buildup_min_gap_s: float = 0.5
    buildup_max_riser_s: float = 2.5

    # Scheduling constraints
    min_spacing_s: float = 0.6
    max_cue_interval_s: float = 2.5         # max_cues = ceil(duration / 2.5)
    end_guard_s: float = 0.1
    cooldowns: Dict[str, float] = field(default_factory=lambda: {
        "boom": 2.5,
        "riser": 6.0,
        "whoosh": 1.0,
        "pop": 1.2,
        "hit": 2.0,
    })
    priority: Dict[str, int] = field(default_factory=lambda: {
        "pop": 1,
        "scene_whoosh": 2,
        "title_whoosh": 3,
        "hit": 4,
        "boom": 5,
        "riser": 5,
    })

    # Mixing gains (dB on -3 dBFS normalized files)
    base_gains_db: Dict[str, float] = field(default_factory=lambda: {
        "whoosh": -12.0,
        "riser": -14.0,
        "boom": -7.0,
        "hit": -8.0,
        "pop": -16.0,
    })
    intensity_atten_db: float = -6.0        # plus -6*(1 - intensity)
    speech_duck_db: float = -4.0            # extra -4 dB on whoosh/riser/pop while overlapping speech
    speech_duck_categories: Tuple[str, ...] = ("whoosh", "riser", "pop")
    limiter_limit: float = 0.89             # ~ -1.0 dBFS peak ceiling


DEFAULT_SFX_CONFIG = SfxConfig()
