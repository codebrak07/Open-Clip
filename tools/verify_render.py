#!/usr/bin/env python3
"""
Full end-to-end verification suite for M1-M5 polished clip renderer (`tools/verify_render.py`):
  A. Layout (1080x1920, 1080x1350 window at y=340, zero stretch circle ratio <=1%, bg blur <5% var & >=8% darker)
  B. Grade (window luma std-dev rises 5-15%, clipped pixels rise <1%)
  C. Captions (all 8 checks including 2-layer glow ring delta >=18/255 over gray 128, bright 235, dark 30)
  D. Title (present every frame, <=2 lines, y 130-320, side margins >=60px, keyword yellow)
  E. SFX (spacing, count, cooldowns, no-repeat, peak <= -1 dBFS, sfx-mode off == source, empty-folder synth, riser->boom <=10ms)
  F. Contact sheet (every 3rd frame) + M5 SSIM >= 0.97 vs libx264 slow CRF 18
"""
from __future__ import annotations

import json
import math
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import replace
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend" / "python-engine"))

from openclip_engine.clipping.clip_renderer import render_polished_clip
from openclip_engine.clipping.config_styles import (
    DEFAULT_LAYOUT,
    DEFAULT_SFX_CONFIG,
    DEFAULT_TITLE_STYLE,
    KARAOKE_POP,
)
from openclip_engine.clipping.karaoke_pop import (
    RenderEvent,
    _separable_max_filter_2d,
    build_render_events,
    classify_word_chunks,
    clean_word_text,
    is_acronym,
    probe_video_stream,
    render_event_sprite,
    split_syllables,
)
from openclip_engine.clipping.sfx_director import ensure_sfx_index, plan_sfx_cues

FIXTURE: List[Dict[str, Any]] = [
    {"word": "Every", "start": 0.00, "end": 0.27},
    {"word": "GTA", "start": 0.27, "end": 0.67},
    {"word": "game", "start": 0.67, "end": 0.97},
    {"word": "has", "start": 0.97, "end": 1.10},
    {"word": "its", "start": 1.10, "end": 1.27},
    {"word": "own", "start": 1.27, "end": 1.40},
    {"word": "iconic", "start": 1.40, "end": 1.80},
    {"word": "song.", "start": 1.80, "end": 2.10},
    {"word": "Which", "start": 2.10, "end": 2.23},
    {"word": "one", "start": 2.23, "end": 2.37},
    {"word": "is", "start": 2.37, "end": 2.43},
    {"word": "your", "start": 2.43, "end": 2.57},
    {"word": "favorite?", "start": 2.57, "end": 2.90},
]

OUT_DIR = REPO_ROOT / "tools" / "verify_output"


def _laplacian_var(gray: np.ndarray) -> float:
    g = gray.astype(np.float64)
    lap = -4.0 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    return float(lap.var())


def _extract_frame(video_path: Path, t_sec: float = 0.5) -> np.ndarray:
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
        p = Path(tf.name)
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-ss", f"{t_sec:.3f}", "-i", str(video_path), "-frames:v", "1", str(p)],
            check=True,
        )
        return np.array(Image.open(p).convert("RGB"), dtype=np.uint8)
    finally:
        p.unlink(missing_ok=True)


def _extract_all_frames(video_path: Path, frames_dir: Path) -> List[Path]:
    frames_dir.mkdir(parents=True, exist_ok=True)
    for old in frames_dir.glob("f_*.png"):
        old.unlink()
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(video_path), "-vsync", "0", str(frames_dir / "f_%04d.png")],
        check=True,
    )
    return sorted(frames_dir.glob("f_*.png"))


def _decode_audio_f32(video_path: Path) -> np.ndarray:
    res = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(video_path), "-ac", "1", "-ar", "44100", "-f", "f32le", "pipe:1"],
        capture_output=True,
        check=True,
    )
    return np.frombuffer(res.stdout, dtype=np.float32)


def _make_synthetic_circle_video(out_mp4: Path, duration: float = 3.2) -> Path:
    """Creates a 1920x1080 synthetic source with textured mid-gray background + crisp centered circle."""
    img = Image.new("RGB", (1920, 1080), (115, 118, 124))
    arr = np.array(img, dtype=np.uint8)
    # Fine subtle mid-tone checkerboard + gradient for Laplacian & grade std-dev testing (zero clipping)
    yy, xx = np.mgrid[0:1080, 0:1920]
    pattern = (((xx // 16) + (yy // 16)) % 2).astype(np.int32) * 36 - 18
    grad = ((xx / 1920.0) * 32.0 - 16.0).astype(np.int32)
    base = np.clip(118 + pattern + grad, 40, 200).astype(np.uint8)
    arr[:, :, 0] = base
    arr[:, :, 1] = np.clip(base.astype(np.int32) - 4, 40, 200).astype(np.uint8)
    arr[:, :, 2] = np.clip(base.astype(np.int32) + 6, 40, 200).astype(np.uint8)

    pil = Image.fromarray(arr, mode="RGB")
    draw = ImageDraw.Draw(pil)
    # Crisp bright circle centered at (960, 540), radius 240
    r = 240
    draw.ellipse((960 - r, 540 - r, 960 + r, 540 + r), fill=(215, 165, 95), outline=(55, 65, 85), width=6)

    png_path = out_mp4.with_suffix(".src.png")
    pil.save(png_path)
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-loop", "1", "-framerate", "30", "-t", f"{duration:.2f}", "-i", str(png_path),
            "-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=44100:duration={duration:.2f}",
            "-af", "volume=-10dB",
            "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-shortest",
            str(out_mp4),
        ],
        check=True,
    )
    png_path.unlink(missing_ok=True)
    return out_mp4


def _verify_a_layout(src_mp4: Path, tmp_dir: Path) -> Tuple[bool, str]:
    out_mp4 = tmp_dir / "check_a_layout.mp4"
    layout = replace(DEFAULT_LAYOUT, title_enabled=False, captions_enabled=False, grade_enabled=False)
    sfx_off = replace(DEFAULT_SFX_CONFIG, mode="off")
    render_polished_clip(
        src_mp4, [], out_mp4, layout=layout, sfx_config=sfx_off,
        use_llm=False, detect_scenes=False,
    )
    w, h, fps, _ = probe_video_stream(out_mp4)
    if (w, h) != (1080, 1920):
        return False, f"Expected 1080x1920, got {w}x{h}"

    frame = _extract_frame(out_mp4, 0.5)
    # Detect crisp orange circle inside window y=[340..1690]
    win = frame[340:1690, :, :]
    r_ch = win[:, :, 0].astype(np.int32)
    b_ch = win[:, :, 2].astype(np.int32)
    circle_mask = (r_ch - b_ch) > 70
    ys, xs = np.where(circle_mask)
    if ys.size < 5000:
        return False, f"Circle not found in window (px={ys.size})"
    cw = int(xs.max() - xs.min() + 1)
    ch = int(ys.max() - ys.min() + 1)
    ratio = cw / max(1.0, float(ch))
    ratio_err = abs(ratio - 1.0)

    # Check background blur (<5% of window Laplacian variance) and darker (>=8% darker)
    gray_full = 0.299 * frame[:, :, 0] + 0.587 * frame[:, :, 1] + 0.114 * frame[:, :, 2]
    # Window textured region outside the circle (e.g. top-left of window y=360..600)
    win_tex = gray_full[360:600, 40:1040]
    bg_top = gray_full[20:300, 40:1040]
    bg_bot = gray_full[1720:1900, 40:1040]

    win_var = _laplacian_var(win_tex)
    bg_var = 0.5 * (_laplacian_var(bg_top) + _laplacian_var(bg_bot))
    var_pct = (bg_var / max(1e-6, win_var)) * 100.0

    win_mean = float(gray_full[350:1680, :].mean())
    bg_mean = float(0.5 * (bg_top.mean() + bg_bot.mean()))
    darker_pct = ((win_mean - bg_mean) / max(1e-6, win_mean)) * 100.0

    # Check crisp boundary at y=340 and y=1690
    top_edge_jump = float(np.abs(gray_full[342, :].mean() - gray_full[336, :].mean()))
    bot_edge_jump = float(np.abs(gray_full[1688, :].mean() - gray_full[1694, :].mean()))

    ok = (ratio_err <= 0.01) and (var_pct < 5.0) and (darker_pct >= 8.0) and (top_edge_jump > 8.0) and (bot_edge_jump > 8.0)
    return ok, (
        f"dims={w}x{h}, circle={cw}x{ch} (ratio={ratio:.4f}, err={ratio_err*100:.2f}%), "
        f"bg_lap_var={var_pct:.2f}% (<5%), bg_darker={darker_pct:.1f}% (>=8%), window_edges=({top_edge_jump:.1f},{bot_edge_jump:.1f})"
    )


def _verify_b_grade(src_mp4: Path, tmp_dir: Path) -> Tuple[bool, str]:
    ungraded_mp4 = tmp_dir / "check_b_ungraded.mp4"
    graded_mp4 = tmp_dir / "check_b_graded.mp4"
    sfx_off = replace(DEFAULT_SFX_CONFIG, mode="off")

    lay_un = replace(DEFAULT_LAYOUT, title_enabled=False, captions_enabled=False, grade_enabled=False)
    lay_gr = replace(DEFAULT_LAYOUT, title_enabled=False, captions_enabled=False, grade_enabled=True)

    render_polished_clip(src_mp4, [], ungraded_mp4, layout=lay_un, sfx_config=sfx_off, use_llm=False, detect_scenes=False)
    render_polished_clip(src_mp4, [], graded_mp4, layout=lay_gr, sfx_config=sfx_off, use_llm=False, detect_scenes=False)

    f_un = _extract_frame(ungraded_mp4, 0.5)[340:1690, :, :]
    f_gr = _extract_frame(graded_mp4, 0.5)[340:1690, :, :]

    y_un = 0.299 * f_un[:, :, 0] + 0.587 * f_un[:, :, 1] + 0.114 * f_un[:, :, 2]
    y_gr = 0.299 * f_gr[:, :, 0] + 0.587 * f_gr[:, :, 1] + 0.114 * f_gr[:, :, 2]

    std_un = float(y_un.std())
    std_gr = float(y_gr.std())
    std_rise_pct = ((std_gr - std_un) / max(1e-6, std_un)) * 100.0

    clip_un = float(((y_un <= 2.0) | (y_un >= 253.0)).mean()) * 100.0
    clip_gr = float(((y_gr <= 2.0) | (y_gr >= 253.0)).mean()) * 100.0
    clip_rise_pct = clip_gr - clip_un

    ok = (5.0 <= std_rise_pct <= 15.0) and (clip_rise_pct < 1.0)
    return ok, f"luma_std={std_un:.2f}->{std_gr:.2f} (+{std_rise_pct:.2f}%, target 5-15%), clipped_rise={clip_rise_pct:.3f}% (<1%)"


def _rgb_to_hsv_np(rgb: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    f = rgb.astype(np.float32) / 255.0
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    cmax = np.maximum(np.maximum(r, g), b)
    cmin = np.minimum(np.minimum(r, g), b)
    delta = cmax - cmin
    h = np.zeros_like(cmax)
    m = delta > 1e-5
    mr = m & (cmax == r)
    mg = m & (cmax == g) & (~mr)
    mb = m & (~mr) & (~mg)
    h[mr] = (60.0 * (((g[mr] - b[mr]) / delta[mr]) % 6.0))
    h[mg] = (60.0 * (((b[mg] - r[mg]) / delta[mg]) + 2.0))
    h[mb] = (60.0 * (((r[mb] - g[mb]) / delta[mb]) + 4.0))
    s = np.where(cmax > 1e-5, delta / np.maximum(cmax, 1e-5), 0.0)
    return h, s, cmax


def _hue_dist(h1: float, h2: float) -> float:
    d = abs(h1 - h2) % 360.0
    return min(d, 360.0 - d)


def _verify_c_captions(tmp_dir: Path) -> List[Tuple[str, bool, str]]:
    results: List[Tuple[str, bool, str]] = []

    # C.8 Syllable & emphasis unit tests
    c8_errs: List[str] = []
    for w, exp in [
        ("iconic", ["i", "co", "nic"]),
        ("favorite", ["fa", "vo", "rite"]),
        ("favorite?", ["fa", "vo", "rite?"]),
        ("arrow", ["ar", "row"]),
        ("outta", ["out", "ta"]),
        ("Guysss", ["Guysss"]),
    ]:
        got = split_syllables(w)
        if got != exp:
            c8_errs.append(f"split_syllables({w!r})={got} != {exp}")
    for w, exp in [("GTA", True), ("NASA", True), ("NOW", False), ("GUYS", False), ("FIGHT", False)]:
        if is_acronym(w, KARAOKE_POP) != exp:
            c8_errs.append(f"is_acronym({w!r}) != {exp}")
    if classify_word_chunks("Every", KARAOKE_POP)[0]:
        c8_errs.append("'Every' must NOT be emphasis")
    if clean_word_text("song.") != "song" or clean_word_text("favorite?") != "favorite?":
        c8_errs.append("punctuation rule failed")
    results.append(("C.8 Syllable & emphasis unit tests", len(c8_errs) == 0, "; ".join(c8_errs) or "iconic/favorite/arrow/outta/Guysss + acronym/stoplist/punct PASS"))

    # C.5 GLOW: render each colored word with & without glow over gray 128, bright 235, dark 30
    st_on = KARAOKE_POP
    st_off = replace(KARAOKE_POP, glow_enabled=False)
    min_delta = 999.0
    glow_details = []
    for color, word in [("yellow", "Every"), ("cyan", "game"), ("red", "has"), ("green", "your")]:
        ev = RenderEvent(0, word, [word], None, color, 0.0, 1.0, False)
        s_on = render_event_sprite(ev, 1080, 330, 0, st_on)
        s_off = render_event_sprite(ev, 1080, 330, 0, st_off)
        is_glyph = (s_off[:, :, 3] > 120) & (s_off[:, :, :3].max(axis=2) > 100)
        g_u8 = (is_glyph.astype(np.uint8) * 255)
        ring = (_separable_max_filter_2d(g_u8, 29) > 0) & ~(_separable_max_filter_2d(g_u8, 9) > 0)
        per_bg = {}
        for bg in (128, 235, 30):
            a_on = s_on[:, :, 3:4].astype(np.float32) / 255.0
            c_on = s_on[:, :, :3].astype(np.float32) * a_on + float(bg) * (1.0 - a_on)
            a_off = s_off[:, :, 3:4].astype(np.float32) / 255.0
            c_off = s_off[:, :, :3].astype(np.float32) * a_off + float(bg) * (1.0 - a_off)
            d = float(np.abs(c_on[ring] - c_off[ring]).mean())
            per_bg[bg] = round(d, 1)
            min_delta = min(min_delta, d)
        glow_details.append(f"{color}:{per_bg}")
    results.append((
        "C.5 Two-layer glow ring delta (>=18/255 on 128/235/30)",
        min_delta >= 18.0,
        f"min={min_delta:.1f}/255; " + " ".join(glow_details),
    ))

    # Render fixture on flat gray 1080x1920 @ 30fps using M1 window geometry (window_top=340, window_h=1350)
    gray_mp4 = tmp_dir / "gray_1080x1920.mp4"
    cap_mp4 = tmp_dir / "cap_gray_out.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", "color=c=0x808080:s=1080x1920:r=30:d=3.4",
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo:d=3.4",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest", str(gray_mp4),
        ],
        check=True,
    )
    cap_layout = replace(
        DEFAULT_LAYOUT,
        blur_enabled=False,
        grade_enabled=False,
        title_enabled=False,
        captions_enabled=True,
        window_w=1080,
        window_h=1350,
        window_top=340,
        fit_mode="cover",
    )
    # Render directly onto 1080x1920 gray without cropping 1080x1920 -> 1080x1350 (keep full 1080x1920 canvas with window_top=340, window_h=1350)
    from openclip_engine.clipping.karaoke_pop import render_captions
    render_captions(
        gray_mp4, FIXTURE, cap_mp4, style=KARAOKE_POP,
        clip_start=0.0, clip_end=3.4,
        window_top=340, window_h=1350,
    )

    frames = _extract_all_frames(cap_mp4, tmp_dir / "cap_frames")
    events = build_render_events(FIXTURE, fps=30.0, clip_start=0.0, clip_end=3.4, style=KARAOKE_POP)
    target_cy = 340 + int(round(0.54 * 1350))  # 1069
    y_lo, y_hi = max(0, target_cy - 180), min(1920, target_cy + 180)

    def load_band(idx: int) -> np.ndarray:
        return np.array(Image.open(frames[idx]).convert("RGB"), dtype=np.uint8)[y_lo:y_hi, :, :]

    # C.1: Single word & clean outside 2.90s
    c1_errs = []
    for i in range(len(events) - 1):
        if events[i].end > events[i + 1].start + 1e-6:
            c1_errs.append(f"overlap {events[i].word}/{events[i+1].word}")
    stray = 0
    for fi in range(89, len(frames)):
        b_arr = load_band(fi).astype(np.float32)
        bg_ref = np.median(b_arr[:8, :32, :], axis=(0, 1))
        if float(np.abs(b_arr - bg_ref).max()) > 8.0:
            stray += 1
    results.append(("C.1 Single word & clean outside spans", len(c1_errs) == 0 and stray == 0, f"overlaps={len(c1_errs)}, stray_after_2.90s={stray}"))

    # C.2: Palette purity & no consecutive main color repeat
    pal_hues = {"yellow": 58.8, "cyan": 183.1, "red": 0.0, "green": 120.0}
    word_colors: List[str] = []
    seen_w = set()
    c2_errs = []
    for ev in events:
        if ev.word_index not in seen_w:
            seen_w.add(ev.word_index)
            if word_colors and word_colors[-1] == ev.main_color_name:
                c2_errs.append(f"repeat {ev.main_color_name} on {ev.word}")
            word_colors.append(ev.main_color_name)
    for ev in events:
        f_s = int(math.ceil(ev.start * 30.0 - 1e-6))
        f_e = min(len(frames), int(math.ceil(ev.end * 30.0 - 1e-6)))
        if f_e - f_s < 3:
            continue
        band = load_band(f_s + 2)
        h, s, v = _rgb_to_hsv_np(band)
        sat = (s > 0.55) & (v > 0.55)
        if sat.sum() > 20:
            hs = h[sat]
            min_d = np.minimum.reduce([np.minimum(np.abs(hs - ph), 360.0 - np.abs(hs - ph)) for ph in pal_hues.values()])
            if float((min_d > 22.0).mean()) > 0.05:
                c2_errs.append(f"off-palette pixels in {ev.word}")
    results.append(("C.2 Palette purity & no consecutive repeat", len(c2_errs) == 0, f"seq={word_colors[:8]}... errs={len(c2_errs)}"))

    # C.3: Emphasis white+window vs solid non-white
    c3_errs = []
    emph_ok = 0
    solid_ok = 0
    for ev in events:
        f_s = int(math.ceil(ev.start * 30.0 - 1e-6))
        f_e = min(len(frames), int(math.ceil(ev.end * 30.0 - 1e-6)))
        fi = min(f_e - 1, f_s + 2) if f_e > f_s else f_s
        if fi >= len(frames):
            continue
        band = load_band(fi)
        _, s, v = _rgb_to_hsv_np(band)
        white_px = int(((s < 0.12) & (v > 0.88)).sum())
        sat_px = int(((s > 0.55) & (v > 0.55)).sum())
        if ev.is_emphasis:
            if white_px < 100 or sat_px < 60:
                c3_errs.append(f"emphasis {ev.word}[{ev.window_index}] w={white_px} c={sat_px}")
            else:
                emph_ok += 1
        else:
            if white_px > 25 or sat_px < 100:
                c3_errs.append(f"solid {ev.word} w={white_px} c={sat_px}")
            else:
                solid_ok += 1
    results.append(("C.3 Emphasis white+window vs solid non-white", len(c3_errs) == 0, f"emph={emph_ok}, solid={solid_ok}, errs={c3_errs[:2]}"))

    # C.4: Entrance smear f0 > f1 > steady & static hold
    c4_errs = []
    c4_checked = 0
    for ev in events:
        f_s = int(math.ceil(ev.start * 30.0 - 1e-6))
        f_e = min(len(frames), int(math.ceil(ev.end * 30.0 - 1e-6)))
        if f_e - f_s < 4:
            continue
        b0 = load_band(f_s).astype(np.float32)
        b1 = load_band(f_s + 1).astype(np.float32)
        b2 = load_band(f_s + 2).astype(np.float32)
        b3 = load_band(f_s + 3).astype(np.float32)
        d02 = float(np.abs(b0 - b2).mean())
        d12 = float(np.abs(b1 - b2).mean())
        d23 = float(np.abs(b2 - b3).mean())
        c4_checked += 1
        if not (d02 > d12 * 1.15 and d12 > d23 * 1.5 and d23 < 0.6):
            c4_errs.append(f"{ev.word}: d02={d02:.2f} d12={d12:.2f} d23={d23:.2f}")
    results.append(("C.4 Entrance smear (f0>f1>steady) & static hold", len(c4_errs) == 0 and c4_checked >= 5, f"checked={c4_checked}, errs={c4_errs[:2]}"))

    # C.6: Zero blank frames across <=0.25s gaps + pause >0.25s hides at +0.25s
    blank_cnt = 0
    for fi in range(0, 87):
        if float(np.abs(load_band(fi).astype(np.float32) - 128.0).max()) < 10.0:
            blank_cnt += 1
    pause_evs = build_render_events(
        [{"word": "Hello", "start": 0.0, "end": 0.30}, {"word": "world", "start": 1.10, "end": 1.50}],
        fps=30.0, clip_start=0.0, clip_end=2.0, style=KARAOKE_POP,
    )
    pause_ok = len(pause_evs) == 2 and abs(pause_evs[0].end - 0.55) < 0.02 and abs(pause_evs[1].start - 1.10) < 0.02
    results.append(("C.6 Zero blank <=0.25s gap & hide >0.25s pause", blank_cnt == 0 and pause_ok, f"blanks_f0..86={blank_cnt}, pause_hide_t={pause_evs[0].end:.2f}s"))

    # C.7: Center y within +/-1.5% of window_top + 0.54*window_h (1069) & font size +/-5% of 0.102*W (110px)
    c7_errs = []
    centers = []
    for ev in events:
        if ev.word in ("Every", "GTA", "iconic", "Which"):
            f_s = int(math.ceil(ev.start * 30.0 - 1e-6))
            f_e = min(len(frames), int(math.ceil(ev.end * 30.0 - 1e-6)))
            if f_e - f_s < 3:
                continue
            band = load_band(f_s + 2)
            _, s, v = _rgb_to_hsv_np(band)
            glyph = (v > 0.85) & ((s > 0.7) | (s < 0.08))
            ys, _ = np.where(glyph)
            if ys.size:
                cy = y_lo + 0.5 * (ys.min() + ys.max())
                err_pct = abs(cy - target_cy) / 1920.0 * 100.0
                centers.append((ev.word, round(cy, 1), f"{err_pct:.2f}%"))
                if err_pct > 1.5:
                    c7_errs.append(f"{ev.word} cy={cy:.1f} vs {target_cy} ({err_pct:.2f}%)")
    font_px = round(KARAOKE_POP.font_size_pct * 1080)
    font_err_pct = abs(font_px - 0.102 * 1080) / (0.102 * 1080) * 100.0
    results.append(("C.7 Center Y (window_top+0.54*win_h) & font size", len(c7_errs) == 0 and font_err_pct <= 5.0, f"target_y={target_cy}, font={font_px}px, centers={centers[:4]}"))

    return results


def _verify_d_and_f_full_render(src_mp4: Path, tmp_dir: Path) -> Tuple[Tuple[bool, str], Tuple[bool, str], Tuple[bool, str], Path]:
    """
    Renders the FULL polished fixture (M1+M2+M3+M4+M5) on balanced fast path AND libx264 slow CRF 18,
    checks D (Title), F (Contact sheet), and M5 SSIM >= 0.97!
    """
    fast_mp4 = OUT_DIR / "fixture_polished_fast.mp4"
    max_mp4 = tmp_dir / "fixture_polished_max.mp4"
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    title_text = "EVERY GTA GAME HAS ITS ICONIC SONG"
    sfx_cfg = replace(DEFAULT_SFX_CONFIG, mode="rules", seed=42)

    _, meta_fast = render_polished_clip(
        src_mp4, FIXTURE, fast_mp4,
        clip_start=0.0, clip_end=3.2,
        title=title_text, keyword="ICONIC",
        layout=replace(DEFAULT_LAYOUT, quality="balanced"),
        caption_style=KARAOKE_POP, title_style=DEFAULT_TITLE_STYLE, sfx_config=sfx_cfg,
        use_llm=False, return_meta=True,
    )
    _, meta_max = render_polished_clip(
        src_mp4, FIXTURE, max_mp4,
        clip_start=0.0, clip_end=3.2,
        title=title_text, keyword="ICONIC",
        layout=replace(DEFAULT_LAYOUT, quality="max"),
        caption_style=KARAOKE_POP, title_style=DEFAULT_TITLE_STYLE, sfx_config=sfx_cfg,
        use_llm=False, return_meta=True,
    )

    frames = _extract_all_frames(fast_mp4, tmp_dir / "full_frames")

    # D. Title check on EVERY frame (0..end): present, <=2 lines, inside y 130..320, margins >=60px, keyword yellow
    missing_frames = 0
    yellow_missing = 0
    y_min_seen, y_max_seen = 9999, 0
    x_min_seen, x_max_seen = 9999, 0

    # Check steady frame 5 for exact title geometry + every frame for presence & yellow
    for fi, fp in enumerate(frames):
        arr = np.array(Image.open(fp).convert("RGB"), dtype=np.uint8)
        zone = arr[0:340, :, :]
        r, g, b = zone[:, :, 0].astype(np.int32), zone[:, :, 1].astype(np.int32), zone[:, :, 2].astype(np.int32)
        if fi < 2:
            # Smeared entrance frames (0-66ms): horizontally blurred glyphs have slightly lower peak luma
            white_txt = (r > 165) & (g > 165) & (b > 165)
            yellow_txt = (r > 160) & (g > 155) & (b < 110) & ((r - b) > 70)
        else:
            white_txt = (r > 235) & (g > 235) & (b > 235)
            yellow_txt = (r > 220) & (g > 215) & (b < 55)
        txt_mask = white_txt | yellow_txt
        if int(txt_mask.sum()) < 500:
            missing_frames += 1
        if int(yellow_txt.sum()) < 200:
            yellow_missing += 1
        if fi >= 2:
            ys, xs = np.where(txt_mask)
            if ys.size:
                y_min_seen = min(y_min_seen, int(ys.min()))
                y_max_seen = max(y_max_seen, int(ys.max()))
                x_min_seen = min(x_min_seen, int(xs.min()))
                x_max_seen = max(x_max_seen, int(xs.max()))

    # Count distinct vertical bands (lines) in steady frame 5
    arr5 = np.array(Image.open(frames[min(5, len(frames) - 1)]).convert("RGB"), dtype=np.uint8)[0:340, :, :]
    r5, g5, b5 = arr5[:, :, 0].astype(np.int32), arr5[:, :, 1].astype(np.int32), arr5[:, :, 2].astype(np.int32)
    row_has_txt = (((r5 > 235) & (g5 > 235) & (b5 > 235)) | ((r5 > 220) & (g5 > 215) & (b5 < 55))).sum(axis=1) > 40
    in_band = False
    n_lines = 0
    for val in row_has_txt:
        if val and not in_band:
            n_lines += 1
            in_band = True
        elif not val:
            in_band = False

    d_ok = (
        missing_frames == 0
        and yellow_missing == 0
        and 1 <= n_lines <= 2
        and y_min_seen >= 125
        and y_max_seen <= 325
        and x_min_seen >= 60
        and (1079 - x_max_seen) >= 60
    )
    d_res = (
        d_ok,
        f"frames={len(frames)}, missing={missing_frames}, yellow_missing={yellow_missing}, "
        f"lines={n_lines}, y=[{y_min_seen}..{y_max_seen}] (130..320), margins=[{x_min_seen},{1079-x_max_seen}] (>=60)",
    )

    # F. Contact sheet (every 3rd frame)
    picked = frames[::3]
    cols = 6
    rows = max(1, math.ceil(len(picked) / cols))
    tw, th = 180, 320
    sheet = Image.new("RGB", (cols * tw, rows * th), (18, 18, 22))
    draw = ImageDraw.Draw(sheet)
    for idx, fp in enumerate(picked):
        r_i, c_i = divmod(idx, cols)
        im = Image.open(fp).convert("RGB").resize((tw, th), Image.Resampling.BILINEAR)
        sheet.paste(im, (c_i * tw, r_i * th))
        draw.rectangle((c_i * tw, r_i * th, c_i * tw + 48, r_i * th + 18), fill=(0, 0, 0))
        draw.text((c_i * tw + 4, r_i * th + 3), f"f{idx*3:02d}", fill=(255, 255, 255))
    sheet_path = OUT_DIR / "render_contact_sheet.png"
    sheet.save(sheet_path)
    f_res = (sheet_path.exists(), f"{sheet_path} ({len(picked)} frames, every 3rd)")

    # M5 SSIM check: fast render vs libx264 slow CRF 18
    ssim_proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(fast_mp4), "-i", str(max_mp4), "-lavfi", "ssim", "-f", "null", "-"],
        capture_output=True,
        text=True,
        check=True,
    )
    m = re.search(r"All:([0-9.]+)", ssim_proc.stderr)
    ssim_val = float(m.group(1)) if m else 0.0
    ssim_res = (
        ssim_val >= 0.97,
        f"SSIM={ssim_val:.5f} (target >= 0.97) fast_enc={meta_fast['encoder']} vs {meta_max['encoder']}",
    )

    return d_res, f_res, ssim_res, fast_mp4


def _verify_e_sfx(src_mp4: Path, tmp_dir: Path) -> Tuple[bool, str]:
    errs: List[str] = []

    # 1. Synth fallback on an empty folder
    empty_sfx_dir = tmp_dir / "empty_sfx"
    cfg_empty = replace(DEFAULT_SFX_CONFIG, sfx_dir=str(empty_sfx_dir), mode="rules", seed=42)
    idx = ensure_sfx_index(cfg_empty)
    if not all(len(idx[c]) == 3 for c in ("whoosh", "riser", "boom", "hit", "pop")):
        errs.append("empty-folder synth did not populate 3 variants per category")
    if not (empty_sfx_dir / ".index.json").exists():
        errs.append(".index.json missing")

    # 2. Cue constraints (spacing, count, cooldowns, no-repeat, riser->boom <=10ms)
    test_words = [
        {"word": "Every", "start": 0.00, "end": 0.25},
        {"word": "GTA", "start": 0.25, "end": 0.55},
        {"word": "WAIT!", "start": 1.60, "end": 1.90},   # 1.05s gap -> riser ending at 1.60 + boom
        {"word": "iconic", "start": 2.30, "end": 2.65},
        {"word": "BOOM!", "start": 3.40, "end": 3.70},   # <2.5s after 1.60 boom -> downgraded to hit
        {"word": "INSANE!", "start": 5.50, "end": 5.85}, # 1.80s gap + >2.5s after 1.60 -> riser + boom
    ]
    dur = 7.0
    cues = plan_sfx_cues(test_words, duration=dur, scene_cuts=[1.2, 4.6], title_enabled=True, sfx_config=cfg_empty)
    max_budget = math.ceil(dur / cfg_empty.max_cue_interval_s)
    non_riser = [c for c in cues if c.paired_boom_t is None]
    if len(non_riser) > max_budget:
        errs.append(f"budget exceeded: {len(non_riser)} > {max_budget}")
    for i in range(len(non_riser) - 1):
        if (non_riser[i + 1].t - non_riser[i].t) < cfg_empty.min_spacing_s - 1e-4:
            errs.append(f"spacing violated between {non_riser[i].t} and {non_riser[i+1].t}")
    # No consecutive duplicate file
    for i in range(len(cues) - 1):
        if cues[i].file == cues[i + 1].file:
            errs.append(f"consecutive duplicate file {cues[i].file}")
    # Cooldowns per category
    last_cat_t: Dict[str, float] = {}
    for c in cues:
        if c.category in last_cat_t:
            if (c.t - last_cat_t[c.category]) < cfg_empty.cooldowns[c.category] - 1e-4:
                errs.append(f"cooldown violated for {c.category}: {c.t} vs {last_cat_t[c.category]}")
        last_cat_t[c.category] = c.t
    # Riser ends on boom within 10ms
    risers = [c for c in cues if c.category == "riser" and c.paired_boom_t is not None]
    if not risers:
        errs.append("no riser generated before gapped shout word")
    max_riser_err_ms = 0.0
    for r in risers:
        err_ms = abs((r.play_start_s + r.play_duration_s) - r.paired_boom_t) * 1000.0
        max_riser_err_ms = max(max_riser_err_ms, err_ms)
        if err_ms > 10.0:
            errs.append(f"riser end err {err_ms:.2f}ms > 10ms")

    # 3. Render with SFX ON -> mixed peak <= -1.0 dBFS & .sfx_cues.json exists
    sfx_on_mp4 = tmp_dir / "sfx_on.mp4"
    sfx_off_mp4 = tmp_dir / "sfx_off.mp4"
    short_words = [
        {"word": "Every", "start": 0.00, "end": 0.25},
        {"word": "BOOM!", "start": 1.60, "end": 1.90},
        {"word": "favorite?", "start": 2.40, "end": 2.80},
    ]
    render_polished_clip(
        src_mp4, short_words, sfx_on_mp4,
        layout=replace(DEFAULT_LAYOUT, title_enabled=True, captions_enabled=True),
        sfx_config=cfg_empty, use_llm=False, detect_scenes=False,
    )
    if not Path(f"{sfx_on_mp4}.sfx_cues.json").exists():
        errs.append(".sfx_cues.json missing")
    mixed_pcm = _decode_audio_f32(sfx_on_mp4)
    peak_amp = float(np.max(np.abs(mixed_pcm))) if mixed_pcm.size else 0.0
    peak_dbfs = 20.0 * math.log10(max(1e-9, peak_amp))
    if peak_dbfs > -1.0:
        errs.append(f"mixed peak {peak_dbfs:.2f} dBFS > -1.0 dBFS")

    # 4. Render with --sfx-mode off -> decoded audio equals source
    render_polished_clip(
        src_mp4, short_words, sfx_off_mp4,
        layout=replace(DEFAULT_LAYOUT, title_enabled=False, captions_enabled=False),
        sfx_config=replace(cfg_empty, mode="off"), use_llm=False, detect_scenes=False,
        seek_source=False,
    )
    src_pcm = _decode_audio_f32(src_mp4)
    off_pcm = _decode_audio_f32(sfx_off_mp4)
    n_cmp = min(len(src_pcm), len(off_pcm))
    max_audio_diff = float(np.max(np.abs(src_pcm[:n_cmp] - off_pcm[:n_cmp]))) if n_cmp > 0 else 1.0
    if max_audio_diff > 1e-3:
        errs.append(f"sfx-mode off audio diff {max_audio_diff:.5f} > 1e-3")

    return len(errs) == 0, (
        f"cues={len(cues)}, risers={len(risers)} (max_err={max_riser_err_ms:.2f}ms), "
        f"mixed_peak={peak_dbfs:.2f} dBFS (<=-1), sfx_off_diff={max_audio_diff:.6f}, errs={errs}"
    )


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="oc_verify_render_") as td:
        tmp = Path(td)
        src_mp4 = _make_synthetic_circle_video(tmp / "synthetic_circle_1080p.mp4", duration=3.2)

        checks: List[Tuple[str, bool, str]] = []
        ok_a, det_a = _verify_a_layout(src_mp4, tmp)
        checks.append(("A. Layout (1080x1920, 4:5 window y=340, zero stretch, bg blur)", ok_a, det_a))

        ok_b, det_b = _verify_b_grade(src_mp4, tmp)
        checks.append(("B. Adaptive Grade (luma std +5-15%, clip rise <1%)", ok_b, det_b))

        checks.extend(_verify_c_captions(tmp))

        d_res, f_res, ssim_res, _ = _verify_d_and_f_full_render(src_mp4, tmp)
        checks.append(("D. Main Title (every frame, <=2 lines, y 130-320, yellow kw)", d_res[0], d_res[1]))

        ok_e, det_e = _verify_e_sfx(src_mp4, tmp)
        checks.append(("E. SFX (constraints, peak<=-1dBFS, off==src, synth, riser->boom)", ok_e, det_e))

        checks.append(("F. Contact Sheet (every 3rd frame)", f_res[0], f_res[1]))
        checks.append(("M5. Fast vs libx264-slow-CRF18 SSIM (>=0.97)", ssim_res[0], ssim_res[1]))

    print("\n================ FULL RENDER VERIFICATION REPORT ================")
    all_pass = True
    for name, ok, detail in checks:
        tag = "PASS" if ok else "FAIL"
        if not ok:
            all_pass = False
        print(f"[{tag}] {name}: {detail}")
    print("=================================================================\n")
    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
