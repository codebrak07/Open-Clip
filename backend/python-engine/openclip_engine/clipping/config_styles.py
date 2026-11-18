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
from typing import Dict, Optional, Tuple

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

    # Optional visual features (M6b framing supersedes legacy --smart-crop)
    framing_mode: str = "auto"       # "auto" | "off" | "ref"
    multi_subject_layout: str = "two_shot"  # "two_shot" (gap-preserving) | "split" (stacked)
    framing_preset: Optional[str] = None    # e.g. "two_shot_gap"
    framing_ref_path: Optional[str] = None  # reference image/video (default reference/framing_ref.*)
    subjects_json_path: Optional[str] = None  # optional test override boxes JSON
    framing_min_shot_s: float = 0.8
    framing_ema_alpha: float = 0.15
    framing_two_shot_margin: float = 0.08
    framing_feather_px: int = 24
    smart_crop: bool = False         # legacy alias; superseded by framing_mode
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

    # Broadcast framing, cut hygiene, audio mastering & color metadata
    edge_logo_margin_left_pct: float = 0.0   # exclude top-left corner badge/logo when >0 (e.g. 0.155)
    edge_logo_margin_top_pct: float = 0.14   # top band where corner logo lives
    max_upscale: float = 0.0                 # >0 caps upscale ratio (e.g. 1.55) to prevent soft over-zoom
    center_wide_strips: bool = True          # always vertically center wide strips (never bottom-align)
    never_black_bars: bool = True            # auto-blur bg whenever any shot has out_h < win_h (never pad black)
    consistent_wide_layout: bool = False     # harmonize wide-strip height across multi-shot wide clips
    trim_opening_stray_frames: bool = True   # drop 1-6 stray frames before an immediate cut at t~0
    audio_loudnorm_enabled: bool = False     # two-pass linear loudnorm to audio_target_lufs / audio_target_tp_db
    audio_target_lufs: float = -14.0
    audio_target_tp_db: float = -1.0
    audio_target_lra: float = 11.0
    audio_highpass_hz: float = 0.0           # e.g. 80.0 Hz high-pass
    audio_dialogue_eq: bool = False          # gentle 197/393 Hz drone cut + 2.8 kHz speech clarity
    audio_sample_rate: int = 48000           # 48 kHz stereo AAC
    audio_fade_out_ms: float = 0.0           # e.g. 250.0 ms smooth tail fade-out
    exact_av_sync: bool = True               # trim/pad audio to exact video duration (no tail click/overhang)
    bt709_tags: bool = True                  # tag H.264 High profile + BT.709 color metadata
    output_fps_cap: float = 0.0              # >0 caps high-fps sources (e.g. 60->30fps for fast live encodes)

    def resolved_window_dims(self) -> Tuple[int, int, int]:
        """Returns (win_w, win_h, win_top) honoring video_aspect and blur_enabled."""
        if not self.blur_enabled and self.canvas_w == 1080 and self.canvas_h == 1350:
            return (self.canvas_w, self.canvas_h, 0)
        if self.window_top == 0 and self.window_h == self.canvas_h and self.window_w == self.canvas_w:
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

CLEAN_REELS_LAYOUT = LayoutStyle(
    canvas_w=1080,
    canvas_h=1920,
    video_aspect="9:16",
    window_w=1080,
    window_h=1920,
    window_top=0,
    fit_mode="cover",
    blur_enabled=True,
    title_enabled=False,
    captions_enabled=True,
    grade_enabled=False,
    framing_mode="auto",
    edge_logo_margin_left_pct=0.155,
    max_upscale=1.55,
    center_wide_strips=True,
    never_black_bars=True,
    consistent_wide_layout=True,
    trim_opening_stray_frames=True,
    audio_loudnorm_enabled=True,
    audio_target_lufs=-14.0,
    audio_target_tp_db=-1.0,
    audio_highpass_hz=80.0,
    audio_dialogue_eq=True,
    audio_sample_rate=48000,
    audio_fade_out_ms=250.0,
    exact_av_sync=True,
    bt709_tags=True,
    quality="max",
)

CLEAN_4_5_LAYOUT = LayoutStyle(
    canvas_w=1080,
    canvas_h=1350,
    video_aspect="4:5",
    window_w=1080,
    window_h=1350,
    window_top=0,
    fit_mode="cover",
    blur_enabled=True,
    title_enabled=False,
    captions_enabled=True,
    grade_enabled=False,
    framing_mode="auto",
    edge_logo_margin_left_pct=0.155,
    max_upscale=1.55,
    center_wide_strips=True,
    never_black_bars=True,
    consistent_wide_layout=True,
    trim_opening_stray_frames=True,
    audio_loudnorm_enabled=True,
    audio_target_lufs=-14.0,
    audio_target_tp_db=-1.0,
    audio_highpass_hz=80.0,
    audio_dialogue_eq=True,
    audio_sample_rate=48000,
    audio_fade_out_ms=250.0,
    exact_av_sync=True,
    bt709_tags=True,
    quality="max",
)

LIVE_HORIZONTAL_BLUR_LAYOUT = LayoutStyle(
    canvas_w=1080,
    canvas_h=1920,
    video_aspect="16:9",
    window_w=1080,
    window_h=608,                # Full crisp 16:9 horizontal stream in middle (1080x608)
    window_top=656,              # Vertically centered: (1920 - 608) // 2 = 656
    fit_mode="contain",          # Never crop horizontal livestream edges; overlay cleanly over zoomed blurred BG
    blur_enabled=True,
    bg_scale_div=8,
    bg_blur_sigma=5.5,
    bg_brightness=-0.12,
    bg_saturation=1.12,
    grade_enabled=False,         # Skip signalstats pass for max speed
    framing_mode="off",          # Skip Vision crop detection (full horizontal video shown)
    title_enabled=False,
    captions_enabled=True,
    trim_opening_stray_frames=False,
    audio_loudnorm_enabled=True,
    audio_target_lufs=-14.0,
    audio_target_tp_db=-1.0,
    audio_highpass_hz=80.0,
    audio_dialogue_eq=False,
    audio_sample_rate=48000,
    audio_fade_out_ms=250.0,
    exact_av_sync=True,
    bt709_tags=True,
    output_fps_cap=30.0,         # Cap 60fps gaming streams to 30fps -> 2x faster encodes
    quality="fast",              # VideoToolbox 8M hardware encode (~1.5s/clip)
)


@dataclass(frozen=True)
class CaptionStyle:
    # Geometry relative to canvas/window
    font_size_pct: float = 0.102            # 110px at W=1080
    max_word_width_pct: float = 0.90        # shrink to fit if word exceeds 0.9*W
    anchor_x_pct: float = 0.48              # horizontal center 0.48*W
    center_y_pct: float = 0.54              # window_top + 0.54*window_h (1069 on default 9:16)
    strip_height_font_mult: float = 3.5     # generous strip (~386px at 1080w) so 44px halo never clips

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

    # M6c: 3-Layer Shadow (bottom layers, all scaled by W/1080 and shadow_scale)
    shadow_enabled: bool = True
    shadow_scale: float = 1.0
    shadow_color: Tuple[int, int, int] = (0, 0, 0)
    shadow_dilate_px: int = 3
    ambient_shadow_sigma_1080: float = 14.0
    ambient_shadow_alpha: float = 0.35
    ambient_shadow_offset_x_1080: float = 0.0
    ambient_shadow_offset_y_1080: float = 4.0
    ambient_shadow_gain: float = 2.8
    shadow_offset_x_1080: float = 5.0
    shadow_offset_y_1080: float = 7.0
    shadow_blur_sigma: float = 3.0
    shadow_alpha: float = 0.85
    shadow_gain: float = 2.6
    contact_shadow_offset_x_1080: float = 2.0
    contact_shadow_offset_y_1080: float = 3.0
    contact_shadow_sigma_1080: float = 1.0
    contact_shadow_alpha: float = 0.60

    # M6c: 3-Layer Glow in word's own pure color (normal alpha-over, NEVER screen/add)
    # HALO sigma 26 alpha 0.35 | WIDE sigma 16 alpha 0.80 | TIGHT sigma 4 alpha 0.75
    glow_enabled: bool = True
    glow_spread_scale: float = 1.0
    glow_alpha_scale: float = 1.0
    glow_dilate_px: int = 3                 # compensates thin serif strokes without making glow opaque
    halo_glow_sigma_1080: float = 26.0
    halo_glow_alpha: float = 0.35
    halo_glow_gain: float = 7.2
    wide_glow_sigma_1080: float = 16.0
    wide_glow_alpha: float = 0.80
    wide_glow_gain: float = 0.85
    tight_glow_sigma_1080: float = 4.0
    tight_glow_alpha: float = 0.75
    tight_glow_gain: float = 0.55

    # M6c: Highlight unit switch ("syllable" | "word")
    highlight_unit: str = "syllable"

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

    # Broadcast 2-4 word chunked bold sans-serif mode ("single_word" | "phrase")
    chunk_mode: str = "single_word"
    chunk_min_words: int = 2
    chunk_max_words: int = 4
    chunk_min_duration_s: float = 0.40
    chunk_max_lines: int = 2
    line_spacing_mult: float = 1.14
    stroke_width_1080: int = 0
    stroke_color: Tuple[int, int, int] = (0, 0, 0)
    active_word_color: str = "yellow"
    normalize_casing: bool = False
    smear_enabled: bool = True


KARAOKE_POP = CaptionStyle()

BOLD_CHUNK_CAPTIONS = CaptionStyle(
    font_size_pct=0.098,                    # ~106px at W=1080 -> exact ~75px cap height on Montserrat ExtraBold
    max_word_width_pct=0.84,                # <= 85% of frame width
    anchor_x_pct=0.50,                      # horizontally centered
    center_y_pct=0.675,                     # 67.5% down frame (clear of faces & bottom 20% UI)
    strip_height_font_mult=4.2,             # generous 2-line + outline + shadow strip (~445px at 1080w)
    font_paths=(
        "/Library/Fonts/Montserrat/static/Montserrat-ExtraBold.ttf",
        str(Path.home() / "Library" / "Fonts" / "Inter-Black.otf"),
        "/Library/Fonts/Montserrat/static/Montserrat-Black.ttf",
        "/System/Library/Fonts/Supplemental/Arial Black.ttf",
        "/System/Library/Fonts/Supplemental/Impact.ttf",
    ),
    palette={
        "yellow": (255, 224, 0),            # high-contrast warm accent yellow for active word only
        "white": (255, 255, 255),           # crisp pure white for inactive words
        "cyan": (46, 230, 240),
        "red": (255, 30, 30),
        "green": (27, 255, 27),
    },
    normal_colors=("white",),
    emphasis_window_colors=("yellow",),
    emphasis_base_color="white",
    shadow_enabled=True,
    shadow_scale=0.85,
    shadow_dilate_px=3,
    ambient_shadow_sigma_1080=12.0,
    ambient_shadow_alpha=0.30,
    ambient_shadow_offset_y_1080=5.0,
    ambient_shadow_gain=2.0,
    shadow_offset_x_1080=0.0,
    shadow_offset_y_1080=6.0,
    shadow_blur_sigma=4.0,
    shadow_alpha=0.75,
    shadow_gain=1.8,
    contact_shadow_offset_x_1080=0.0,
    contact_shadow_offset_y_1080=2.0,
    contact_shadow_sigma_1080=1.5,
    contact_shadow_alpha=0.50,
    glow_enabled=False,
    smear_enabled=False,
    chunk_mode="phrase",
    chunk_min_words=2,
    chunk_max_words=4,
    chunk_min_duration_s=0.40,
    chunk_max_lines=2,
    line_spacing_mult=1.14,
    stroke_width_1080=8,
    stroke_color=(0, 0, 0),
    active_word_color="yellow",
    normalize_casing=True,
    max_pause_hold_s=0.20,
    min_display_frames=2,
    min_window_frames=2,
)


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
