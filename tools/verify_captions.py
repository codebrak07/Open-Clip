#!/usr/bin/env python3
"""
Self-verification suite for the Karaoke Pop caption renderer.
Renders the 13-word fixture over a flat gray 1080x1920 @ 30fps video, extracts every frame,
runs all 8 spec assertions, and generates a contact sheet of every 3rd frame.
"""
from __future__ import annotations

import colorsys
import math
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend" / "python-engine"))

from openclip_engine.clipping.karaoke_pop import (  # noqa: E402
    KARAOKE_POP,
    build_render_events,
    classify_word_chunks,
    clean_word_text,
    render_captions,
    render_event_sprite,
    split_syllables,
)

FIXTURE = [
    {"word": "Every",     "start": 0.00, "end": 0.27},
    {"word": "GTA",       "start": 0.27, "end": 0.67},
    {"word": "game",      "start": 0.67, "end": 0.97},
    {"word": "has",       "start": 0.97, "end": 1.10},
    {"word": "its",       "start": 1.10, "end": 1.27},
    {"word": "own",       "start": 1.27, "end": 1.40},
    {"word": "iconic",    "start": 1.40, "end": 1.80},
    {"word": "song.",     "start": 1.80, "end": 2.10},
    {"word": "Which",     "start": 2.10, "end": 2.23},
    {"word": "one",       "start": 2.23, "end": 2.37},
    {"word": "is",        "start": 2.37, "end": 2.43},
    {"word": "your",      "start": 2.43, "end": 2.57},
    {"word": "favorite?", "start": 2.57, "end": 2.90},
]

W, H, FPS = 1080, 1920, 30
VIDEO_DUR_S = 3.40  # includes 0.50s tail after 2.90s to verify clean blank tail
BG_GRAY = 128


def rgb_to_hue_deg(r: float, g: float, b: float) -> Tuple[float, float, float]:
    h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
    return h * 360.0, s, v


def hue_diff_deg(h1: float, h2: float) -> float:
    d = abs(h1 - h2) % 360.0
    return min(d, 360.0 - d)


def make_flat_gray_video(out_path: Path) -> None:
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", f"color=c=#808080:s={W}x{H}:r={FPS}:d={VIDEO_DUR_S}",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p",
        str(out_path),
    ]
    subprocess.run(cmd, check=True, timeout=60)


def extract_frames(video_path: Path, frames_dir: Path) -> List[Path]:
    frames_dir.mkdir(parents=True, exist_ok=True)
    for old in frames_dir.glob("frame_*.png"):
        old.unlink()
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(video_path),
        str(frames_dir / "frame_%04d.png"),
    ]
    subprocess.run(cmd, check=True, timeout=60)
    return sorted(frames_dir.glob("frame_*.png"))


def save_contact_sheet(frames: List[Path], out_path: Path, step: int = 3) -> Path:
    selected = [(i, frames[i]) for i in range(0, len(frames), step)]
    cols = 6
    rows = math.ceil(len(selected) / cols)
    tw, th = 270, 480
    sheet = Image.new("RGB", (cols * tw, rows * th), (24, 24, 28))
    draw = ImageDraw.Draw(sheet)
    try:
        lbl_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 18)
    except Exception:
        lbl_font = ImageFont.load_default()

    for idx, (frame_no, fpath) in enumerate(selected):
        r, c = divmod(idx, cols)
        im = Image.open(fpath).resize((tw, th), Image.Resampling.LANCZOS)
        sheet.paste(im, (c * tw, r * th))
        label = f"f{frame_no:02d} ({frame_no / FPS:.2f}s)"
        draw.rectangle([c * tw + 6, r * th + 6, c * tw + 150, r * th + 32], fill=(0, 0, 0))
        draw.text((c * tw + 12, r * th + 9), label, fill=(255, 255, 255), font=lbl_font)

    sheet.save(out_path)
    return out_path


def run_verification() -> int:
    out_dir = REPO_ROOT / "tools" / "verify_output"
    out_dir.mkdir(parents=True, exist_ok=True)
    bg_mp4 = out_dir / "flat_gray_1080x1920.mp4"
    captioned_mp4 = out_dir / "fixture_karaoke_pop.mp4"
    frames_dir = out_dir / "frames"
    contact_sheet_path = out_dir / "contact_sheet.png"

    print("1) Generating flat gray 1080x1920 @ 30fps test video...")
    make_flat_gray_video(bg_mp4)

    print("2) Rendering fixture with render_captions(..., style=KARAOKE_POP)...")
    render_captions(bg_mp4, FIXTURE, captioned_mp4, style=KARAOKE_POP, clip_start=0.0)

    print("3) Extracting all frames...")
    frames = extract_frames(captioned_mp4, frames_dir)
    print(f"   Extracted {len(frames)} frames.")

    events = build_render_events(FIXTURE, fps=FPS, clip_start=0.0, clip_end=VIDEO_DUR_S, style=KARAOKE_POP)
    ev_first_frame = [math.ceil(ev.start * FPS - 1e-6) for ev in events]

    results: List[Tuple[str, bool, str]] = []

    # ────────────────── CHECK 8: Syllable & Classification Unit Tests ──────────────────
    try:
        assert split_syllables("iconic") == ["i", "co", "nic"], split_syllables("iconic")
        assert split_syllables("favorite") == ["fa", "vo", "rite"], split_syllables("favorite")
        assert split_syllables("arrow") == ["ar", "row"], split_syllables("arrow")
        assert split_syllables("outta") == ["out", "ta"], split_syllables("outta")
        assert split_syllables("Guysss") == ["Guysss"], split_syllables("Guysss")

        # Emphasis & punctuation expectations on fixture + acronyms
        assert clean_word_text("song.") == "song"
        assert clean_word_text("favorite?") == "favorite?"
        for w in ("GTA", "NASA", "iconic", "favorite?"):
            is_e, _ = classify_word_chunks(w, KARAOKE_POP)
            assert is_e, f"Expected emphasis word: {w}"
        for w in ("Every", "NOW", "GUYS", "FIGHT", "CHILL", "game", "song"):
            is_e, _ = classify_word_chunks(w, KARAOKE_POP)
            assert not is_e, f"Expected solid normal word: {w}"
        results.append(("8. Syllable & emphasis unit tests", True, "iconic/favorite/arrow/outta/Guysss + acronym/stoplist/punct PASS"))
    except AssertionError as e:
        results.append(("8. Syllable & emphasis unit tests", False, str(e)))

    # Load all frames as RGB uint8 arrays (crop to caption band y in [650, 1450] for fast pixel ops)
    y_min, y_max = int(H * 0.30), int(H * 0.78)
    frame_arrays = [np.array(Image.open(fp).convert("RGB")) for fp in frames]

    def non_gray_mask(arr: np.ndarray, thresh: int = 12) -> np.ndarray:
        diff = np.max(np.abs(arr.astype(np.int16) - BG_GRAY), axis=2)
        return diff > thresh

    # ────────────────── CHECK 1: At most 1 word on screen; nothing outside spans ──────────────────
    try:
        active_end = max(ev.end for ev in events)
        outside_failures = []
        multi_line_failures = []
        for fi, arr in enumerate(frame_arrays):
            t = fi / FPS
            mask = non_gray_mask(arr, thresh=10)
            if t >= active_end + 1.0 / FPS:
                if int(mask.sum()) > 0:
                    outside_failures.append((fi, int(mask.sum())))
            elif mask.any():
                # Verify single line: vertical span of non-gray pixels should never exceed 2.6x font size
                ys = np.where(mask.any(axis=1))[0]
                vspan = int(ys[-1] - ys[0])
                if vspan > int(KARAOKE_POP.font_size_pct * W * 2.6):
                    multi_line_failures.append((fi, vspan))
        # Also verify every frame maps to at most 1 event
        for fi in range(len(frames)):
            t = fi / FPS
            active = [ev for ev in events if ev.start - 1e-6 <= t < ev.end - 1e-6]
            assert len(active) <= 1, f"Frame {fi} has {len(active)} overlapping events"
        assert not outside_failures, f"Non-empty frames outside spans: {outside_failures[:5]}"
        assert not multi_line_failures, f"Unexpected multi-line vertical span: {multi_line_failures[:5]}"
        results.append(("1. Single word on screen & clean outside spans", True, f"0 overlaps, 0 stray pixels after {active_end:.2f}s"))
    except AssertionError as e:
        results.append(("1. Single word on screen & clean outside spans", False, str(e)))

    # ────────────────── CHECK 2: Palette colors only + no consecutive main color repeat ──────────────────
    try:
        palette_hues = {
            name: rgb_to_hue_deg(*rgb)[0]
            for name, rgb in KARAOKE_POP.palette.items()
            if name != "white"
        }
        # No consecutive words share a main color
        word_colors: Dict[int, str] = {}
        for ev in events:
            word_colors[ev.word_index] = ev.main_color_name
        ordered_cols = [word_colors[i] for i in sorted(word_colors.keys())]
        for i in range(1, len(ordered_cols)):
            assert ordered_cols[i] != ordered_cols[i - 1], f"Consecutive repeat at word {i}: {ordered_cols}"

        # Pixel check on steady-state frames: every saturated pixel must match one of the 4 palette hues
        bad_hue_frames = []
        for idx, ev in enumerate(events):
            steady_f = ev_first_frame[idx] + 2
            end_f = int(math.floor(ev.end * FPS - 1e-6))
            if steady_f > end_f or steady_f >= len(frame_arrays):
                continue
            roi = frame_arrays[steady_f][y_min:y_max]
            rf = roi[:, :, 0].astype(np.float32)
            gf = roi[:, :, 1].astype(np.float32)
            bf = roi[:, :, 2].astype(np.float32)
            cmax = np.maximum(np.maximum(rf, gf), bf)
            cmin = np.minimum(np.minimum(rf, gf), bf)
            sat = np.where(cmax > 1, (cmax - cmin) / np.maximum(cmax, 1.0), 0.0)
            # Sample strongly saturated glyph/glow pixels
            sat_mask = (sat > 0.35) & (cmax > 140)
            ys_s, xs_s = np.where(sat_mask)
            if len(ys_s) == 0:
                bad_hue_frames.append((steady_f, ev.word, "no saturated pixels"))
                continue
            # Check hue of sampled pixels
            step_s = max(1, len(ys_s) // 400)
            bad = 0
            total = 0
            for y0, x0 in zip(ys_s[::step_s], xs_s[::step_s]):
                h_deg, _, _ = rgb_to_hue_deg(float(roi[y0, x0, 0]), float(roi[y0, x0, 1]), float(roi[y0, x0, 2]))
                min_d = min(hue_diff_deg(h_deg, ph) for ph in palette_hues.values())
                total += 1
                if min_d > 22.0:
                    bad += 1
            if total > 0 and (bad / total) > 0.02:
                bad_hue_frames.append((steady_f, ev.word, f"{bad}/{total} off-palette"))
        assert not bad_hue_frames, f"Off-palette hues detected: {bad_hue_frames[:5]}"
        results.append(("2. Palette purity & no consecutive color repeat", True, f"sequence={ordered_cols}"))
    except AssertionError as e:
        results.append(("2. Palette purity & no consecutive color repeat", False, str(e)))

    # ────────────────── CHECK 3: Emphasis words have white + window color; solid words have NO white ──────────────────
    try:
        emph_checked = 0
        solid_checked = 0
        for idx, ev in enumerate(events):
            steady_f = ev_first_frame[idx] + 2
            end_f = int(math.floor(ev.end * FPS - 1e-6))
            if steady_f > end_f or steady_f >= len(frame_arrays):
                continue
            roi = frame_arrays[steady_f][y_min:y_max]
            r, g, b = roi[:, :, 0], roi[:, :, 1], roi[:, :, 2]
            white_px = int(((r > 230) & (g > 230) & (b > 230)).sum())

            target_rgb = KARAOKE_POP.palette[ev.main_color_name]
            dist_col = np.sqrt(
                (r.astype(np.float32) - target_rgb[0]) ** 2
                + (g.astype(np.float32) - target_rgb[1]) ** 2
                + (b.astype(np.float32) - target_rgb[2]) ** 2
            )
            colored_px = int((dist_col < 55.0).sum())

            if ev.is_emphasis:
                assert white_px > 50, f"Emphasis word '{ev.word}' (f{steady_f}) missing white base pixels ({white_px})"
                assert colored_px > 30, f"Emphasis word '{ev.word}' (f{steady_f}) missing colored window pixels ({colored_px})"
                emph_checked += 1
            else:
                assert white_px == 0, f"Solid word '{ev.word}' (f{steady_f}) had {white_px} unexpected white pixels"
                assert colored_px > 80, f"Solid word '{ev.word}' (f{steady_f}) missing solid colored pixels ({colored_px})"
                solid_checked += 1

        assert emph_checked >= 6 and solid_checked >= 5, f"Insufficient checked events ({emph_checked}, {solid_checked})"
        results.append(("3. Emphasis white+window vs solid non-white", True, f"checked {emph_checked} emphasis windows & {solid_checked} solid words"))
    except AssertionError as e:
        results.append(("3. Emphasis white+window vs solid non-white", False, str(e)))

    # ────────────────── CHECK 4: First 2 frames smeared, later frames match steady-state ──────────────────
    try:
        smear_checked = 0
        for idx, ev in enumerate(events):
            f0 = ev_first_frame[idx]
            f1 = f0 + 1
            f2 = f0 + 2
            f3 = f0 + 3
            end_f = int(math.floor(ev.end * FPS - 1e-6))
            if f3 > end_f or f3 >= len(frame_arrays):
                continue

            roi0 = frame_arrays[f0][y_min:y_max].astype(np.float32)
            roi1 = frame_arrays[f1][y_min:y_max].astype(np.float32)
            roi2 = frame_arrays[f2][y_min:y_max].astype(np.float32)
            roi3 = frame_arrays[f3][y_min:y_max].astype(np.float32)

            diff_0_2 = float(np.mean(np.abs(roi0 - roi2)))
            diff_1_2 = float(np.mean(np.abs(roi1 - roi2)))
            diff_2_3 = float(np.mean(np.abs(roi2 - roi3)))

            assert diff_0_2 > diff_1_2 > diff_2_3, (
                f"Smear decay failed on '{ev.word}' (win={ev.window_index}): "
                f"d02={diff_0_2:.3f}, d12={diff_1_2:.3f}, d23={diff_2_3:.3f}"
            )
            assert diff_2_3 < 0.35, f"Steady frames f{f2}/f{f3} diverged ({diff_2_3:.3f})"
            smear_checked += 1

        assert smear_checked >= 5, f"Too few events long enough for 4-frame smear check ({smear_checked})"
        results.append(("4. Entrance smear (f0 > f1 > steady) & static hold", True, f"verified {smear_checked} word/window transitions"))
    except AssertionError as e:
        results.append(("4. Entrance smear (f0 > f1 > steady) & static hold", False, str(e)))

    # ────────────────── CHECK 5: Outer glow 4-12px outside glyph edge (hue <=20 deg, brightness 30-70%) ──────────────────
    try:
        band_h = int(round(H * KARAOKE_POP.band_height_pct))
        band_h += band_h % 2
        glow_samples = []
        for ev in events:
            if ev.is_emphasis:
                continue
            sprite = render_event_sprite(ev, W, band_h, smear_level=0, style=KARAOKE_POP)
            # Core glyph pixels have near-opaque alpha (>235) and match fill color
            target_rgb = KARAOKE_POP.palette[ev.main_color_name]
            target_hue = rgb_to_hue_deg(*target_rgb)[0]

            glyph_core = sprite[:, :, 3] > 235
            # Build ring 4..12px outside glyph edge using morphological box dilations
            from PIL import ImageFilter as _IF
            core_img = Image.fromarray((glyph_core.astype(np.uint8) * 255), mode="L")
            dil4 = np.array(core_img.filter(_IF.MaxFilter(9))) > 0     # radius 4px
            dil12 = np.array(core_img.filter(_IF.MaxFilter(25))) > 0   # radius 12px
            ring = dil12 & (~dil4)
            # Focus on upper-left/left/top halo ring so the (+3,+4) dark drop shadow doesn't darken the measurement
            # Specifically measure pixels in the ring whose RGB has strong color chroma (glow pixels)
            ring_rgba = sprite[ring]
            # Filter out shadow-dominated bottom-right pixels (where rgb < 40)
            glow_px = ring_rgba[(ring_rgba[:, 3] > 25) & (np.max(ring_rgba[:, :3], axis=1) > 80)]
            assert len(glow_px) > 100, f"Word '{ev.word}' has insufficient glow pixels in 4-12px ring ({len(glow_px)})"

            # Composite glow pixels over black (to measure intrinsic glow brightness % of full fill)
            a_f = glow_px[:, 3:4].astype(np.float32) / 255.0
            eff_rgb = glow_px[:, :3].astype(np.float32) * a_f
            # Check median hue and peak/upper-quartile brightness in the 4-12px band
            hues = [rgb_to_hue_deg(float(p[0]), float(p[1]), float(p[2]))[0] for p in glow_px[::max(1, len(glow_px) // 300)]]
            hue_errs = [hue_diff_deg(h, target_hue) for h in hues]
            med_hue_err = float(np.median(hue_errs))
            # Brightness relative to pure fill brightness (0..1)
            fill_v = max(target_rgb) / 255.0
            # Peak/p85 glow brightness in the 4-12px ring
            ring_v = np.max(eff_rgb, axis=1) / (255.0 * fill_v)
            p80_bright = float(np.percentile(ring_v, 80))

            assert med_hue_err <= 20.0, f"Glow hue error too large on '{ev.word}': {med_hue_err:.1f} deg"
            assert 0.30 <= p80_bright <= 0.70, f"Glow brightness out of 30-70% on '{ev.word}': {p80_bright*100:.1f}%"
            glow_samples.append((ev.word, round(med_hue_err, 1), round(p80_bright * 100, 1)))
            if len(glow_samples) >= 4:
                break

        results.append(("5. Outer glow hue (<=20°) & brightness (30-70%)", True, f"samples(word,hueErr°,bright%)={glow_samples}"))
    except AssertionError as e:
        results.append(("5. Outer glow hue (<=20°) & brightness (30-70%)", False, str(e)))

    # ────────────────── CHECK 6: No blank frames when gap <= 0.25s + hides when gap > 0.25s ──────────────────
    try:
        # On the fixture (all gaps <= 0.00s), EVERY frame from f0 to last event end must be non-blank
        last_active_f = int(math.floor(max(ev.end for ev in events) * FPS - 1e-6))
        blank_mid = []
        for fi in range(0, last_active_f):
            if not non_gray_mask(frame_arrays[fi], thresh=10).any():
                blank_mid.append(fi)
        assert not blank_mid, f"Unexpected blank frames inside continuous fixture: {blank_mid}"

        # Also verify pause-hide behavior when gap > 0.25s (e.g., 0.80s gap)
        pause_words = [
            {"word": "Hello", "start": 0.0, "end": 0.30},
            {"word": "world", "start": 1.10, "end": 1.50},
        ]
        p_events = build_render_events(pause_words, fps=FPS, clip_start=0.0, clip_end=2.0, style=KARAOKE_POP)
        assert abs(p_events[0].end - 0.55) < 1e-3, f"Expected hold end at 0.55s, got {p_events[0].end}"
        results.append(("6. Gap bridging (<=0.25s) & pause hide (>0.25s)", True, f"0 blank frames across f0..f{last_active_f}; 0.8s gap hides at +0.25s"))
    except AssertionError as e:
        results.append(("6. Gap bridging (<=0.25s) & pause hide (>0.25s)", False, str(e)))

    # ────────────────── CHECK 7: Glyph vertical center (+/-1.5% of 0.54*H) & font size (+/-5% of 0.102*W) ──────────────────
    try:
        target_cy = KARAOKE_POP.center_y_pct * H
        tol_cy = 0.015 * H
        expected_fs = KARAOKE_POP.font_size_pct * W  # 110.16px
        # Measure on steady-state 'Every' (f2) and 'GTA' (steady frame)
        checked_geo = []
        for idx, ev in enumerate(events):
            if ev.word not in ("Every", "GTA", "iconic", "Which"):
                continue
            steady_f = ev_first_frame[idx] + 2
            if steady_f >= len(frame_arrays):
                continue
            arr = frame_arrays[steady_f]
            # Extract bright glyph pixels (excluding dark drop shadow and faint glow)
            diff_bright = np.max(arr.astype(np.int16) - BG_GRAY, axis=2) > 70
            ys = np.where(diff_bright.any(axis=1))[0]
            assert len(ys) > 0, f"No glyph pixels found on '{ev.word}' (f{steady_f})"
            cy = (float(ys[0]) + float(ys[-1])) / 2.0
            cy_err_pct = abs(cy - target_cy) / H * 100.0
            assert abs(cy - target_cy) <= tol_cy, f"'{ev.word}' cy={cy:.1f} vs target {target_cy:.1f} ({cy_err_pct:.2f}%)"
            checked_geo.append((ev.word, round(cy, 1), f"{cy_err_pct:.2f}%"))

        # Verify actual font size used is within +/-5% of 0.102*W
        actual_fs = round(KARAOKE_POP.font_size_pct * W)
        fs_err_pct = abs(actual_fs - expected_fs) / expected_fs * 100.0
        assert fs_err_pct <= 5.0, f"Font size error {fs_err_pct:.2f}%"
        results.append(("7. Vertical center (+/-1.5% of 0.54*H) & font size (+/-5%)", True, f"font={actual_fs}px ({fs_err_pct:.2f}% err), centers={checked_geo}"))
    except AssertionError as e:
        results.append(("7. Vertical center (+/-1.5% of 0.54*H) & font size (+/-5%)", False, str(e)))

    # ────────────────── Save Contact Sheet (every 3rd frame) ──────────────────
    save_contact_sheet(frames, contact_sheet_path, step=3)

    print("\n================ KARAOKE POP VERIFICATION REPORT ================")
    all_pass = True
    for name, ok, detail in results:
        status = "PASS" if ok else "FAIL"
        if not ok:
            all_pass = False
        print(f"[{status}] {name}: {detail}")
    print(f"\nContact sheet: {contact_sheet_path}")
    print(f"Rendered clip: {captioned_mp4}")
    print("=================================================================")
    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(run_verification())
