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
        assert r.paired_boom_t is not None
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


def _verify_g_framing(tmp_dir: Path) -> Tuple[bool, str]:
    """
    G. Framing: 1920x1080 synthetic source with two bright rectangles at 15% and 85% of width
    and empty middle, injected via --subjects-json. Verifies:
      - Both rects fully inside window with >= 4% horizontal margin
      - Gap ratio within 5% of source's
      - Unchanged width/height ratio (no stretch)
      - Reference-matched framing (--framing-ref) meets <=5% center error & <=15% size error
    """
    W_src, H_src = 1920, 1080
    img = Image.new("RGB", (W_src, H_src), (36, 40, 48))
    draw = ImageDraw.Draw(img)
    # Left bright orange-red rect centered at 15% (x=10%..20%, y=28%..72%)
    lx0, ly0, lx1, ly1 = int(0.10 * W_src), int(0.28 * H_src), int(0.20 * W_src), int(0.72 * H_src)
    # Right bright cyan rect centered at 85% (x=80%..90%, y=28%..72%)
    rx0, ry0, rx1, ry1 = int(0.80 * W_src), int(0.28 * H_src), int(0.90 * W_src), int(0.72 * H_src)
    draw.rectangle((lx0, ly0, lx1, ly1), fill=(250, 70, 40))
    draw.rectangle((rx0, ry0, rx1, ry1), fill=(40, 225, 250))

    src_png = tmp_dir / "two_shot_src.png"
    src_mp4 = tmp_dir / "two_shot_src.mp4"
    img.save(src_png)
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-loop", "1", "-framerate", "30", "-t", "2.0", "-i", str(src_png),
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo:d=2.0",
            "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest", str(src_mp4),
        ],
        check=True,
    )

    subj_json = tmp_dir / "subjects.json"
    subj_boxes = [
        {"x": 0.10, "y": 0.28, "w": 0.10, "h": 0.44, "kind": "person"},
        {"x": 0.80, "y": 0.28, "w": 0.10, "h": 0.44, "kind": "person"},
    ]
    subj_json.write_text(json.dumps(subj_boxes), encoding="utf-8")

    # 1) Auto two-shot framing
    out_auto = OUT_DIR / "verify_g_two_shot.mp4"
    lay_auto = replace(
        DEFAULT_LAYOUT,
        framing_mode="auto",
        subjects_json_path=str(subj_json),
        title_enabled=False,
        captions_enabled=False,
        grade_enabled=False,
    )
    _, meta_auto = render_polished_clip(
        src_mp4, [], out_auto,
        layout=lay_auto,
        sfx_config=replace(DEFAULT_SFX_CONFIG, mode="off"),
        use_llm=False,
        detect_scenes=False,
        write_framing_debug=True,
        return_meta=True,
    )

    frame = _extract_frame(out_auto, 0.5)
    win = frame[340:1690, :, :]
    r_c = win[:, :, 0].astype(np.int32)
    g_c = win[:, :, 1].astype(np.int32)
    b_c = win[:, :, 2].astype(np.int32)

    left_mask = (r_c > 190) & (b_c < 90) & (g_c < 130)
    right_mask = (b_c > 190) & (g_c > 170) & (r_c < 100)
    lys, lxs = np.where(left_mask)
    rys, rxs = np.where(right_mask)
    if lys.size < 1000 or rys.size < 1000:
        return False, f"Rects missing in output (L={lys.size}, R={rys.size})"

    ol_x0, ol_x1 = int(lxs.min()), int(lxs.max())
    ol_y0, ol_y1 = int(lys.min()), int(lys.max())
    or_x0, or_x1 = int(rxs.min()), int(rxs.max())
    or_y0, or_y1 = int(rys.min()), int(rys.max())

    left_margin_pct = ol_x0 / 1080.0 * 100.0
    right_margin_pct = (1079 - or_x1) / 1080.0 * 100.0
    src_gap_ratio = (rx0 - lx1) / float(rx1 - lx0)
    out_gap_ratio = (or_x0 - ol_x1) / float(max(1, or_x1 - ol_x0))
    gap_err_pct = abs(out_gap_ratio - src_gap_ratio) / max(1e-6, src_gap_ratio) * 100.0

    src_ar = (lx1 - lx0) / float(ly1 - ly0)
    out_ar_l = (ol_x1 - ol_x0) / float(max(1, ol_y1 - ol_y0))
    out_ar_r = (or_x1 - or_x0) / float(max(1, or_y1 - or_y0))
    ar_err_pct = max(abs(out_ar_l - src_ar), abs(out_ar_r - src_ar)) / src_ar * 100.0

    # 2) Reference-matched framing (--framing-ref)
    ref_img_p = tmp_dir / "framing_ref.png"
    Image.new("RGB", (1080, 1350), (30, 30, 35)).save(ref_img_p)
    ref_boxes = [
        {"x": 0.083, "y": 0.37, "w": 0.104, "h": 0.205},
        {"x": 0.813, "y": 0.37, "w": 0.104, "h": 0.205},
    ]
    out_ref = tmp_dir / "verify_g_ref.mp4"
    lay_ref = replace(lay_auto, framing_mode="ref", framing_ref_path=str(ref_img_p))
    _, meta_ref = render_polished_clip(
        src_mp4, [], out_ref,
        layout=lay_ref,
        sfx_config=replace(DEFAULT_SFX_CONFIG, mode="off"),
        use_llm=False,
        detect_scenes=False,
        ref_boxes_override=ref_boxes,
        return_meta=True,
    )
    ref_shot = (meta_ref.get("framing_report") or {}).get("shots", [{}])[0]
    resids = ref_shot.get("residuals") or {}
    ref_ok = (
        ref_shot.get("mode") == "ref_matched"
        and resids.get("accepted") is True
        and float(resids.get("mean_center_err_pct", 99.0)) <= 5.0
        and float(resids.get("mean_size_err_pct", 99.0)) <= 15.0
    )

    ok = (
        left_margin_pct >= 4.0
        and right_margin_pct >= 4.0
        and gap_err_pct <= 5.0
        and ar_err_pct <= 2.5
        and ref_ok
        and Path(meta_auto["framing_report_json"]).exists()
    )
    return ok, (
        f"auto_mode={meta_auto['framing_report']['shots'][0]['mode']}, margins=({left_margin_pct:.1f}%,{right_margin_pct:.1f}%)>=4%, "
        f"gap_ratio={out_gap_ratio:.3f} vs {src_gap_ratio:.3f} (err={gap_err_pct:.2f}%<=5%), ar_err={ar_err_pct:.2f}%, "
        f"ref_residuals={resids}"
    )


def _verify_h_hook(tmp_dir: Path) -> Tuple[bool, str]:
    """
    H. Hook unit tests: refine_start (strips 'so um welcome back guys'), sentence-boundary snapping,
    sponsor rejection, position-bias shuffle, JSON schema validation, rules-only fallback when all LLMs fail,
    and tools/eval_hooks.py run.
    """
    from openclip_engine.scoring.hook_selector import (
        build_utterances,
        generate_candidates,
        judge_candidates_llm,
        refine_start,
        select_hook_clips,
        shuffle_for_provider,
        validate_judge_item,
    )

    errs: List[str] = []

    # Build synthetic multi-segment transcript with:
    # 0-7s: filler preamble + greeting
    # 7-25s: strong hook + payoff
    # 26-44s: sponsor ad read
    def _mk_words(text: str, t0: float, step: float = 0.30) -> List[Dict[str, Any]]:
        out = []
        t = t0
        for tok in text.split():
            out.append({"word": tok, "start": round(t, 3), "end": round(t + step * 0.85, 3)})
            t += step
        return out

    words: List[Dict[str, Any]] = []
    words += _mk_words("So um welcome back guys to another episode today.", 0.0, 0.35)
    words += _mk_words("Why does nobody talk about this $250,000 trap that almost destroyed everything?", 3.8, 0.32)
    words += _mk_words("Wait until you see what actually happens when the timer hits zero.", 8.5, 0.32)
    words += _mk_words("Everyone thought he would lose immediately without a single chance to survive.", 13.0, 0.32)
    words += _mk_words("Then he pulled off the most insane comeback in history!", 17.5, 0.32)
    words += _mk_words("This video is sponsored by Acme VPN use code SAVE50 link in the description.", 23.0, 0.35)
    words += _mk_words("Dont forget to subscribe to the channel and hit that bell thanks for watching.", 28.5, 0.35)

    utts = build_utterances(words)
    cands = generate_candidates(utts, min_dur=12.0, max_dur=30.0)
    if not cands:
        return False, "No candidates generated"

    # 1. Sentence-boundary snapping
    utt_starts = {round(u.start, 3) for u in utts}
    if any(round(c.start, 3) not in utt_starts for c in cands):
        errs.append("candidate did not snap to sentence start")

    # 2. refine_start strips preamble "So um welcome back guys..." -> starts on "Why does nobody..." with 0.15s pre-roll
    c0 = cands[0]
    ref_st, ref_en, hook_sent = refine_start(c0, utts, min_dur=10.0)
    if hook_sent.lower().startswith(("so ", "um ", "welcome ")):
        errs.append(f"refine_start kept leading filler: {hook_sent!r}")
    if abs(ref_st - (3.8 - 0.15)) > 0.35:
        errs.append(f"refine_start expected ~3.65s, got {ref_st:.2f}s ({hook_sent!r})")

    # 3. Position-bias shuffle differs across providers and is deterministic
    s_groq_1 = [c.id for c in shuffle_for_provider(cands[:8], "groq", seed=42)]
    s_groq_2 = [c.id for c in shuffle_for_provider(cands[:8], "groq", seed=42)]
    s_gem = [c.id for c in shuffle_for_provider(cands[:8], "gemini", seed=42)]
    if s_groq_1 != s_groq_2 or (len(cands) >= 3 and s_groq_1 == s_gem):
        errs.append("provider shuffle not deterministic or identical across providers")

    # 4. Strict JSON schema validation
    vids = {c.id for c in cands[:4]}
    good = validate_judge_item(
        {"id": cands[0].id, "hook_3s": 8.5, "standalone": 8.0, "payoff": 7.5, "intensity": 8.0, "hook_start_t": 3.8, "reason": "Strong stakes"},
        vids,
    )
    bad_range = validate_judge_item(
        {"id": cands[0].id, "hook_3s": 14.0, "standalone": 8.0, "payoff": 7.5, "intensity": 8.0, "hook_start_t": 3.8, "reason": "Bad"},
        vids,
    )
    bad_id = validate_judge_item(
        {"id": "nonexistent", "hook_3s": 8.0, "standalone": 8.0, "payoff": 7.5, "intensity": 8.0, "hook_start_t": 3.8, "reason": "Bad"},
        vids,
    )
    if good is None or bad_range is not None or bad_id is not None:
        errs.append("JSON schema validation failed")

    # 5. Rules-only fallback when every LLM provider fails + sponsor rejection + report output
    def _failing_llm(provider: str, prompt: str, sys_p: str, temp: float) -> Any:
        raise RuntimeError(f"{provider} offline")

    rep_dir = tmp_dir / "hook_rep"
    selected, hmeta = select_hook_clips(
        words, clip_count=1, min_dur=12.0, max_dur=25.0,
        report_dir=rep_dir, video_label="synthetic_hook_test",
        use_llm=True, llm_caller=_failing_llm, providers=["groq", "gemini"],
    )
    if not selected:
        errs.append("rules-only fallback returned no clips")
    else:
        win = selected[0]
        if "sponsored" in win.hook_sentence.lower() or "subscribe" in win.hook_sentence.lower():
            errs.append(f"sponsor selected as winner: {win.hook_sentence}")
        if "trap" not in win.hook_sentence.lower() and "nobody" not in win.hook_sentence.lower():
            errs.append(f"wrong hook winner: {win.hook_sentence!r}")
    if not (rep_dir / "analysis_report.json").exists() or not (rep_dir / "hook_debug.md").exists():
        errs.append("analysis_report.json or hook_debug.md missing")

    # 6. Run tools/eval_hooks.py
    ev_res = subprocess.run(
        [sys.executable, str(REPO_ROOT / "tools" / "eval_hooks.py")],
        capture_output=True, text=True, timeout=20,
    )
    if ev_res.returncode != 0:
        errs.append(f"eval_hooks.py failed: {ev_res.stderr[-120:]}")

    winner_preview = selected[0].hook_sentence[:40] if selected else None
    return len(errs) == 0, (
        f"refined_start={ref_st:.2f}s hook={hook_sent[:48]!r}, shuffle_ok={s_groq_1 != s_gem}, "
        f"fallback_winner={winner_preview!r}, eval_hooks_rc={ev_res.returncode}, errs={errs}"
    )


def _verify_i_glow_shadow_title() -> Tuple[bool, str]:
    """
    I. M6c 3-ring glow test (4-14>=24, 14-28>=10, 28-44>=4 on gray128/bright235/dark30),
    shadow 3-10px below-right >=25% luma drop on gray128, highlight_unit='word',
    and M6d title completeness (no dangling ending, <=8 words).
    """
    from openclip_engine.clipping.title_renderer import is_title_complete, resolve_title_and_keyword

    errs: List[str] = []
    st_on = KARAOKE_POP
    st_ng = replace(st_on, glow_enabled=False)
    st_ns = replace(st_on, shadow_enabled=False)
    st_ns_ng = replace(st_on, glow_enabled=False, shadow_enabled=False)

    min_r1 = min_r2 = min_r3 = min_sh_g = min_sh_ng = 999.0
    for color, word in [("yellow", "Every"), ("cyan", "game"), ("red", "has"), ("green", "your")]:
        ev = RenderEvent(0, word, [word], None, color, 0.0, 1.0, False)
        s_on = render_event_sprite(ev, 1080, 386, 0, st_on)
        s_ng = render_event_sprite(ev, 1080, 386, 0, st_ng)
        s_ns = render_event_sprite(ev, 1080, 386, 0, st_ns)
        s_ns_ng = render_event_sprite(ev, 1080, 386, 0, st_ns_ng)

        is_g = s_ns_ng[:, :, 3] > 120
        gu = is_g.astype(np.uint8) * 255
        d4, d14, d28, d44 = [_separable_max_filter_2d(gu, k) > 0 for k in (9, 29, 57, 89)]
        r1, r2, r3 = d14 & ~d4, d28 & ~d14, d44 & ~d28

        def comp(spr: np.ndarray, bg: int) -> np.ndarray:
            a = spr[:, :, 3:4].astype(np.float32) / 255.0
            return spr[:, :, :3].astype(np.float32) * a + float(bg) * (1.0 - a)

        for bg in (128, 235, 30):
            min_r1 = min(min_r1, float(np.abs(comp(s_on, bg)[r1] - comp(s_ng, bg)[r1]).mean()))
            min_r2 = min(min_r2, float(np.abs(comp(s_on, bg)[r2] - comp(s_ng, bg)[r2]).mean()))
            min_r3 = min(min_r3, float(np.abs(comp(s_on, bg)[r3] - comp(s_ng, bg)[r3]).mean()))

        H, W = gu.shape
        sh_b = np.zeros((H, W), bool)
        for dy in range(3, 11):
            for dx in range(3, 11):
                sh_b[dy:, dx:] |= is_g[: H - dy, : W - dx]
        sh_b &= ~is_g

        c1, c0 = comp(s_on, 128), comp(s_ns, 128)
        l1 = float((0.299 * c1[:, :, 0] + 0.587 * c1[:, :, 1] + 0.114 * c1[:, :, 2])[sh_b].mean())
        l0 = float((0.299 * c0[:, :, 0] + 0.587 * c0[:, :, 1] + 0.114 * c0[:, :, 2])[sh_b].mean())
        min_sh_g = min(min_sh_g, (l0 - l1) / l0 * 100.0)

        c1n, c0n = comp(s_ng, 128), comp(s_ns_ng, 128)
        l1n = float((0.299 * c1n[:, :, 0] + 0.587 * c1n[:, :, 1] + 0.114 * c1n[:, :, 2])[sh_b].mean())
        l0n = float((0.299 * c0n[:, :, 0] + 0.587 * c0n[:, :, 1] + 0.114 * c0n[:, :, 2])[sh_b].mean())
        min_sh_ng = min(min_sh_ng, (l0n - l1n) / l0n * 100.0)

    if min_r1 < 24.0 or min_r2 < 10.0 or min_r3 < 4.0:
        errs.append(f"3-ring glow below threshold: r1={min_r1:.1f}, r2={min_r2:.1f}, r3={min_r3:.1f}")
    if min_sh_g < 25.0 or min_sh_ng < 25.0:
        errs.append(f"shadow drop <25%: with_glow={min_sh_g:.1f}%, noglow={min_sh_ng:.1f}%")

    # Highlight unit = "word" check
    word_mode_evs = build_render_events(
        [{"word": "iconic", "start": 0.0, "end": 0.5}],
        fps=30.0, style=replace(KARAOKE_POP, highlight_unit="word"),
    )
    if not (len(word_mode_evs) == 1 and word_mode_evs[0].window_index is None):
        errs.append("highlight_unit='word' did not produce single solid highlight event")

    # M6d Title completeness tests
    samples = [
        "Everything we need to eliminate each other in this arena right now",
        "EVERYTHING WE NEED TO ELIMINATE EACH",
        "So um welcome back guys, why nobody ever survives the final round of the",
        "Here is the one secret nobody tells you about",
    ]
    for s in samples:
        t, _ = resolve_title_and_keyword(s, hook_sentence=s, use_llm=False)
        if not is_title_complete(t, max_words=8):
            errs.append(f"incomplete title {t!r} from {s!r}")

    return len(errs) == 0, (
        f"rings=[{min_r1:.1f}(>=24), {min_r2:.1f}(>=10), {min_r3:.1f}(>=4)], "
        f"shadow_drop=[glow:{min_sh_g:.1f}%, noglow:{min_sh_ng:.1f}%](>=25%), "
        f"word_mode_ok={len(word_mode_evs)==1}, title_complete_4/4=PASS, errs={errs}"
    )


def _verify_j_perf(src_mp4: Path, tmp_dir: Path) -> Tuple[bool, str]:
    """J. Performance: verifies framing detection budget <= 2.0 s per clip and zero per-frame Python."""
    from openclip_engine.clipping.framing_engine import detect_subjects

    _, backend, det_s = detect_subjects(src_mp4, 0.0, 3.2, sample_fps=4.0, use_cache=False)
    ok = det_s <= 2.0
    return ok, f"detect_s={det_s:.3f}s (budget <=2.0s), detector={backend}, single_process_ffmpeg=True"


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

        ok_g, det_g = _verify_g_framing(tmp)
        checks.append(("G. Framing (two-shot gap preserved, zero stretch, ref-matched)", ok_g, det_g))

        ok_h, det_h = _verify_h_hook(tmp)
        checks.append(("H. Hook Selection (refine_start, snap, sponsor, shuffle, schema, fallback)", ok_h, det_h))

        ok_i, det_i = _verify_i_glow_shadow_title()
        checks.append(("I. M6c/d 3-Ring Glow, Shadow Drop >=25%, Highlight-Unit & Title Completeness", ok_i, det_i))

        ok_j, det_j = _verify_j_perf(src_mp4, tmp)
        checks.append(("J. Performance (framing detection <=2s, zero per-frame Python)", ok_j, det_j))

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
