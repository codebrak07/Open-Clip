import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ASPECT_DIMS: Dict[str, Tuple[int, int]] = {
    "9:16": (1080, 1920),
    "16:9": (1920, 1080),
    "1:1": (1080, 1080),
    "4:5": (1080, 1350),
    "3:4": (1080, 1440),
    "21:9": (1920, 822),
}

# One-word-one-color vibrant neon palette (Lime / Cyan focus)
KINETIC_PALETTE: List[Tuple[int, int, int, int]] = [
    (163, 255, 18, 255),   # Electric Lime
    (0, 240, 255, 255),    # Bright Cyan
    (255, 230, 0, 255),    # Vivid Yellow
    (0, 255, 163, 255),    # Neon Mint-Cyan
    (255, 77, 148, 255),   # Hot Magenta
    (184, 255, 51, 255),   # Acid Lime
]


def _load_bold_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Impact.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/Library/Fonts/Arial Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]
    for fp in candidates:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
    return ImageFont.load_default()


def fetch_youtube_captions(info: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Fetches timed captions from YouTube's subtitles or automatic_captions (json3 format).
    Returns a sorted list of {start: float, end: float, text: str} cues in seconds.
    """
    subs = info.get("subtitles") or {}
    autos = info.get("automatic_captions") or {}

    track = None
    for src in (subs, autos):
        for lang in ("en", "en-orig", "en-US", "en-GB"):
            if lang in src and src[lang]:
                track = src[lang]
                break
        if track:
            break
    if not track:
        for src in (subs, autos):
            for entries in src.values():
                if entries:
                    track = entries
                    break
            if track:
                break

    if not track:
        return []

    json3_entry = next((x for x in track if x.get("ext") == "json3" and x.get("url")), None)
    if not json3_entry:
        return []

    try:
        req = urllib.request.Request(
            json3_entry["url"],
            headers={"User-Agent": "Mozilla/5.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="ignore"))
    except Exception:
        return []

    cues: List[Dict[str, Any]] = []
    for ev in payload.get("events", []):
        segs = ev.get("segs")
        if not segs:
            continue
        t_ms = ev.get("tStartMs")
        d_ms = ev.get("dDurationMs", 2500)
        if t_ms is None:
            continue
        raw_text = "".join(s.get("utf8", "") for s in segs)
        clean = re.sub(r"\s+", " ", raw_text).strip()
        if not clean or clean in ("[Music]", "[Applause]", "[Laughter]"):
            continue
        start = t_ms / 1000.0
        end = (t_ms + max(500, d_ms)) / 1000.0

        # Preserve per-word timestamps from YouTube json3 tOffsetMs when present
        has_offsets = any("tOffsetMs" in s for s in segs)
        words_timed: List[Dict[str, Any]] = []
        if has_offsets:
            valid_segs = []
            for s in segs:
                txt = re.sub(r"\s+", " ", s.get("utf8", "")).strip()
                if not txt:
                    continue
                off = int(s.get("tOffsetMs", 0))
                valid_segs.append((start + off / 1000.0, txt))
            for idx, (ws, wt) in enumerate(valid_segs):
                we = valid_segs[idx + 1][0] if idx + 1 < len(valid_segs) else end
                words_timed.append({"start": ws, "end": max(ws + 0.08, we), "text": wt})

        cue_obj: Dict[str, Any] = {"start": start, "end": end, "text": clean}
        if words_timed:
            cue_obj["words"] = words_timed
        cues.append(cue_obj)

    cues.sort(key=lambda c: c["start"])
    return cues


def slice_and_chunk_cues(
    all_cues: List[Dict[str, Any]],
    clip_start: float,
    clip_end: float,
    max_words_per_chunk: int = 4,
    max_chunks: int = 24,
) -> List[Dict[str, Any]]:
    """
    Slices cues inside [clip_start, clip_end], rebases timestamps to 0.0,
    and breaks long sentences into punchy viral caption beats (2-4 words each).
    """
    clip_dur = max(1.0, clip_end - clip_start)
    chunks: List[Dict[str, Any]] = []

    for c in all_cues:
        if c["end"] <= clip_start or c["start"] >= clip_end:
            continue
        rel_start = max(0.0, c["start"] - clip_start)
        rel_end = min(clip_dur, c["end"] - clip_start)
        if rel_end - rel_start < 0.2:
            continue

        words = c["text"].split()
        if not words:
            continue

        if len(words) <= max_words_per_chunk:
            chunks.append({"start": rel_start, "end": rel_end, "text": " ".join(words)})
        else:
            n_parts = max(1, (len(words) + max_words_per_chunk - 1) // max_words_per_chunk)
            part_dur = (rel_end - rel_start) / n_parts
            for p_idx in range(n_parts):
                sub_words = words[p_idx * max_words_per_chunk : (p_idx + 1) * max_words_per_chunk]
                if not sub_words:
                    continue
                chunks.append({
                    "start": rel_start + p_idx * part_dur,
                    "end": min(clip_dur, rel_start + (p_idx + 1) * part_dur),
                    "text": " ".join(sub_words),
                })

    chunks.sort(key=lambda x: x["start"])
    cleaned: List[Dict[str, Any]] = []
    for ch in chunks:
        if cleaned and ch["start"] < cleaned[-1]["end"]:
            cleaned[-1]["end"] = max(cleaned[-1]["start"] + 0.18, ch["start"] - 0.02)
        if ch["end"] - ch["start"] >= 0.18:
            cleaned.append(ch)

    return cleaned[:max_chunks]


def write_vtt(cues: List[Dict[str, Any]], vtt_path: Path) -> None:
    def fmt(sec: float) -> str:
        hrs = int(sec // 3600)
        mins = int((sec % 3600) // 60)
        secs = sec % 60
        return f"{hrs:02d}:{mins:02d}:{secs:06.3f}"

    lines = ["WEBVTT", ""]
    for idx, c in enumerate(cues, 1):
        lines.append(str(idx))
        lines.append(f"{fmt(c['start'])} --> {fmt(c['end'])}")
        lines.append(c["text"])
        lines.append("")
    vtt_path.write_text("\n".join(lines), encoding="utf-8")


def _wrap_caption_lines(text: str, max_chars_per_line: int = 16) -> List[str]:
    words = text.split()
    lines: List[str] = []
    cur: List[str] = []
    for w in words:
        trial = " ".join(cur + [w])
        if cur and len(trial) > max_chars_per_line:
            lines.append(" ".join(cur))
            cur = [w]
        else:
            cur.append(w)
    if cur:
        lines.append(" ".join(cur))
    return lines[:2]


def _vertical_motion_blur(arr: np.ndarray, radius: int) -> np.ndarray:
    """
    Fast vectorized 1D vertical directional motion blur along the Y axis (RGBA uint8 array).
    Produces true After Effects / CapCut style vertical smear in ~2ms per band frame.
    """
    if radius <= 1:
        return arr
    k = radius * 2 + 1
    h, w, c = arr.shape
    # Pad vertically with zeros (transparent) so edges fade cleanly
    padded = np.pad(arr.astype(np.float32), ((radius, radius), (0, 0), (0, 0)), mode="constant")
    csum = np.cumsum(padded, axis=0)
    # Box average over [y, y + k) using prefix sums
    out = np.empty((h, w, c), dtype=np.float32)
    out[0] = csum[k - 1] / k
    out[1:] = (csum[k:] - csum[:-k]) / k
    return np.clip(out, 0, 255).astype(np.uint8)


def _scale_alpha(arr: np.ndarray, alpha_mult: float) -> np.ndarray:
    if alpha_mult >= 0.995:
        return arr
    out = arr.copy()
    out[:, :, 3] = np.clip(out[:, :, 3].astype(np.float32) * max(0.0, alpha_mult), 0, 255).astype(np.uint8)
    return out


def _probe_duration(video_path: Path, ffmpeg_bin: str = "ffmpeg") -> float:
    ffprobe_bin = ffmpeg_bin.replace("ffmpeg", "ffprobe")
    try:
        res = subprocess.run(
            [
                ffprobe_bin, "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(video_path),
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        val = float(res.stdout.strip())
        if val > 0:
            return val
    except Exception:
        pass
    return 20.0


def _render_kinetic_frame(
    text: str,
    width: int,
    band_h: int,
    is_vertical: bool,
    cue_idx: int,
    phase: str,       # "in" | "hold" | "out"
    progress: float,  # 0.0 -> 1.0 within the phase
) -> np.ndarray:
    """
    Renders one frame of the 'Kinetic' (Colorful Neon) preset:
      - One word, one color (Lime / Cyan / Yellow / Mint / Hot Pink)
      - Alternating words fly in/out vertically from UP and DOWN with true vertical directional motion blur
    """
    display_text = text.upper()
    font_size = int(width * (0.074 if is_vertical else 0.044))
    font = _load_bold_font(font_size)
    stroke_w = max(5, font_size // 10)
    lines = _wrap_caption_lines(display_text, max_chars_per_line=15 if is_vertical else 28)
    line_gap = int(font_size * 1.24)
    total_text_h = len(lines) * line_gap
    base_y = (band_h - total_text_h) // 2

    # Animation kinematics (ease-out on IN, ease-in on OUT)
    max_travel = int(band_h * 0.30)
    max_blur = max(12, int(font_size * 0.44))

    if phase == "in":
        p = max(0.0, min(1.0, progress))
        inv = 1.0 - p
        offset_mag = int(max_travel * (inv ** 3))
        blur_r = int(max_blur * (inv ** 2))
        alpha = min(1.0, p * 1.45)
    elif phase == "out":
        p = max(0.0, min(1.0, progress))
        offset_mag = int(max_travel * (p ** 3))
        blur_r = int(max_blur * (p ** 2))
        alpha = max(0.0, 1.0 - p * 1.25)
    else:
        offset_mag = 0
        blur_r = 0
        alpha = 1.0

    # Dummy draw for measuring word widths accurately
    meas_img = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    meas_draw = ImageDraw.Draw(meas_img)
    space_w = int(font_size * 0.30)

    canvas = Image.new("RGBA", (width, band_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    word_global_idx = cue_idx * 3
    for line_idx, line in enumerate(lines):
        words = line.split(" ")
        w_widths = []
        for w in words:
            bb = meas_draw.textbbox((0, 0), w, font=font, stroke_width=stroke_w)
            w_widths.append(bb[2] - bb[0])
        line_w = sum(w_widths) + space_w * max(0, len(words) - 1)
        cur_x = (width - line_w) // 2
        rest_y = base_y + line_idx * line_gap

        for w_i, word in enumerate(words):
            color = KINETIC_PALETTE[word_global_idx % len(KINETIC_PALETTE)]
            # Clean vertical split: top line sweeps from UP (-1), bottom line from DOWN (+1);
            # single-line captions alternate UP (-1) and DOWN (+1) per word without line collisions.
            if len(lines) >= 2:
                direction = -1 if line_idx == 0 else 1
            else:
                direction = -1 if (word_global_idx % 2 == 0) else 1
            dy = direction * offset_mag
            wy = rest_y + dy

            # Crisp dark shadow + thick black stroke + vibrant neon word fill
            draw.text(
                (cur_x + 4, wy + 6),
                word,
                font=font,
                fill=(0, 0, 0, 185),
                stroke_width=stroke_w,
                stroke_fill=(0, 0, 0, 185),
            )
            draw.text(
                (cur_x, wy),
                word,
                font=font,
                fill=color,
                stroke_width=stroke_w,
                stroke_fill=(0, 0, 0, 255),
            )

            cur_x += w_widths[w_i] + space_w
            word_global_idx += 1

    arr = np.array(canvas, dtype=np.uint8)
    if blur_r > 1:
        arr = _vertical_motion_blur(arr, blur_r)
    if alpha < 0.995:
        arr = _scale_alpha(arr, alpha)
    return arr


def _render_standard_frame(
    text: str,
    width: int,
    band_h: int,
    is_vertical: bool,
    style: str,
    phase: str,
    progress: float,
) -> np.ndarray:
    """Renders Hormozi Amber, Banner (Subtitle Bar), or Minimalist caption band frame with smooth in/out."""
    img = Image.new("RGBA", (width, band_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    style_norm = (style or "Hormozi").strip().lower()

    # Subtle vertical pop/fade on IN and OUT
    if phase == "in":
        p = max(0.0, min(1.0, progress))
        dy = int(28 * ((1.0 - p) ** 2))
        alpha = min(1.0, p * 1.5)
    elif phase == "out":
        p = max(0.0, min(1.0, progress))
        dy = int(-20 * (p ** 2))
        alpha = max(0.0, 1.0 - p * 1.4)
    else:
        dy = 0
        alpha = 1.0

    if style_norm == "hormozi":
        display_text = text.upper()
        font_size = int(width * (0.072 if is_vertical else 0.044))
        font = _load_bold_font(font_size)
        lines = _wrap_caption_lines(display_text, max_chars_per_line=15 if is_vertical else 28)
        stroke_w = max(5, font_size // 10)
        line_gap = int(font_size * 1.22)
        base_y = (band_h - len(lines) * line_gap) // 2 + dy

        for i, line in enumerate(lines):
            bbox = draw.textbbox((0, 0), line, font=font, stroke_width=stroke_w)
            tw = bbox[2] - bbox[0]
            x = (width - tw) // 2
            y = base_y + i * line_gap

            draw.text((x + 4, y + 6), line, font=font, fill=(0, 0, 0, 180), stroke_width=stroke_w, stroke_fill=(0, 0, 0, 180))

            if len(lines) > 1:
                fill_color = (255, 214, 0, 255) if i == len(lines) - 1 else (255, 255, 255, 255)
                draw.text((x, y), line, font=font, fill=fill_color, stroke_width=stroke_w, stroke_fill=(0, 0, 0, 255))
            else:
                words = line.split(" ")
                if len(words) >= 2:
                    prefix = " ".join(words[:-1]) + " "
                    last_w = words[-1]
                    p_bbox = draw.textbbox((0, 0), prefix, font=font, stroke_width=stroke_w)
                    pw = p_bbox[2] - p_bbox[0]
                    draw.text((x, y), prefix, font=font, fill=(255, 255, 255, 255), stroke_width=stroke_w, stroke_fill=(0, 0, 0, 255))
                    draw.text((x + pw, y), last_w, font=font, fill=(255, 214, 0, 255), stroke_width=stroke_w, stroke_fill=(0, 0, 0, 255))
                else:
                    draw.text((x, y), line, font=font, fill=(255, 214, 0, 255), stroke_width=stroke_w, stroke_fill=(0, 0, 0, 255))

    elif style_norm == "banner":
        font_size = int(width * (0.052 if is_vertical else 0.034))
        font = _load_bold_font(font_size)
        lines = _wrap_caption_lines(text, max_chars_per_line=22 if is_vertical else 38)
        line_gap = int(font_size * 1.32)
        base_y = (band_h - len(lines) * line_gap) // 2 + dy

        widths = [draw.textbbox((0, 0), ln, font=font)[2] for ln in lines]
        max_w = max(widths) if widths else 100
        pad_x, pad_y = 32, 20
        box_h = len(lines) * line_gap + pad_y
        x0 = (width - max_w) // 2 - pad_x
        y0 = base_y - pad_y // 2
        draw.rounded_rectangle(
            [x0, y0, x0 + max_w + pad_x * 2, y0 + box_h],
            radius=18,
            fill=(16, 16, 20, 225),
            outline=(255, 214, 0, 170),
            width=3,
        )
        for i, line in enumerate(lines):
            bbox = draw.textbbox((0, 0), line, font=font)
            tw = bbox[2] - bbox[0]
            x = (width - tw) // 2
            y = base_y + i * line_gap
            draw.text((x, y), line, font=font, fill=(255, 255, 255, 255))

    else:
        # Minimalist
        font_size = int(width * (0.054 if is_vertical else 0.036))
        font = _load_bold_font(font_size)
        lines = _wrap_caption_lines(text, max_chars_per_line=22 if is_vertical else 38)
        stroke_w = max(3, font_size // 16)
        line_gap = int(font_size * 1.28)
        base_y = (band_h - len(lines) * line_gap) // 2 + dy
        for i, line in enumerate(lines):
            bbox = draw.textbbox((0, 0), line, font=font, stroke_width=stroke_w)
            tw = bbox[2] - bbox[0]
            x = (width - tw) // 2
            y = base_y + i * line_gap
            draw.text((x + 2, y + 3), line, font=font, fill=(0, 0, 0, 170))
            draw.text((x, y), line, font=font, fill=(255, 255, 255, 255), stroke_width=stroke_w, stroke_fill=(0, 0, 0, 210))

    arr = np.array(img, dtype=np.uint8)
    if alpha < 0.995:
        arr = _scale_alpha(arr, alpha)
    return arr


def build_reframe_and_caption_clip(
    raw_clip_path: Path,
    final_clip_path: Path,
    cues: List[Dict[str, Any]],
    aspect_ratio: str = "9:16",
    caption_style: str = "Hormozi",
    ffmpeg_bin: str = "ffmpeg",
    raw_all_cues: Optional[List[Dict[str, Any]]] = None,
    clip_start: float = 0.0,
    clip_end: Optional[float] = None,
) -> Path:
    """
    Produces a crisp 1080p reframed MP4 in the chosen aspect ratio with animated burnt-in captions.
    Supports Hormozi, Kinetic (lime/cyan vertical blur), KaraokePop (1-word Times New Roman neon
    glow + vertical Gaussian smear + syllable highlight), Minimalist, and Banner.
    """
    style_check = (caption_style or "Hormozi").strip().lower()
    if style_check in ("karaokepop", "karaoke", "karaoke pop", "karaoke-pop", "serif pop"):
        from openclip_engine.clipping.karaoke_pop import build_karaoke_pop_clip

        source_cues = raw_all_cues if raw_all_cues is not None else cues
        eff_end = clip_end if clip_end is not None else _probe_duration(raw_clip_path, ffmpeg_bin)
        return build_karaoke_pop_clip(
            raw_clip_path=raw_clip_path,
            final_clip_path=final_clip_path,
            cues=source_cues,
            clip_start=clip_start if raw_all_cues is not None else 0.0,
            clip_end=eff_end if raw_all_cues is not None else _probe_duration(raw_clip_path, ffmpeg_bin),
            aspect_ratio=aspect_ratio,
            ffmpeg_bin=ffmpeg_bin,
        )

    target_w, target_h = ASPECT_DIMS.get(aspect_ratio, (1080, 1920))
    is_vertical = target_h > target_w
    ratio_expr = f"{target_w}/{target_h}"
    base_vf = (
        f"crop='if(gt(iw/ih,{ratio_expr}),ih*{ratio_expr},iw)':"
        f"'if(gt(iw/ih,{ratio_expr}),ih,iw/({ratio_expr}))',"
        f"scale={target_w}:{target_h}:flags=lanczos,setsar=1"
    )

    # No captions available -> fast direct reframe encode
    if not cues:
        cmd = [
            ffmpeg_bin, "-y", "-loglevel", "error",
            "-i", str(raw_clip_path),
            "-vf", base_vf,
            "-map", "0:v:0", "-map", "0:a:0?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            str(final_clip_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if res.returncode != 0 or not final_clip_path.exists():
            raise RuntimeError(f"FFmpeg reframe failed: {res.stderr[-400:]}")
        return final_clip_path

    # Animated 30fps RGBA caption band piped into FFmpeg
    fps = 30
    band_h = int(target_h * (0.28 if is_vertical else 0.30))
    # Ensure even height
    band_h += band_h % 2
    band_y = int(target_h * (0.62 if is_vertical else 0.66))
    duration = _probe_duration(raw_clip_path, ffmpeg_bin)
    total_frames = max(1, int(duration * fps) + 2)

    style_norm = (caption_style or "Hormozi").strip().lower()
    is_kinetic = style_norm in ("kinetic", "neon", "colorful", "kinetic neon", "colorful blur")
    in_dur = 0.22 if is_kinetic else 0.14
    out_dur = 0.18 if is_kinetic else 0.12

    cmd = [
        ffmpeg_bin, "-y", "-loglevel", "error",
        "-i", str(raw_clip_path),
        "-f", "rawvideo", "-pix_fmt", "rgba",
        "-s", f"{target_w}x{band_h}", "-r", str(fps),
        "-i", "pipe:0",
        "-filter_complex", f"[0:v]{base_vf}[v0];[v0][1:v]overlay=0:{band_y}:shortest=1[vout]",
        "-map", "[vout]",
        "-map", "0:a:0?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        str(final_clip_path),
    ]

    empty_bytes = bytes(target_w * band_h * 4)
    hold_cache: Dict[int, bytes] = {}

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )

    try:
        assert proc.stdin is not None
        cue_idx = 0
        n_cues = len(cues)

        for frame_i in range(total_frames):
            t = frame_i / fps
            while cue_idx < n_cues and t >= cues[cue_idx]["end"]:
                cue_idx += 1

            if cue_idx >= n_cues or t < cues[cue_idx]["start"]:
                proc.stdin.write(empty_bytes)
                continue

            c = cues[cue_idx]
            st, en = c["start"], c["end"]
            dur = max(0.1, en - st)
            eff_in = min(in_dur, dur * 0.35)
            eff_out = min(out_dur, dur * 0.30)

            if t - st < eff_in:
                prog = (t - st) / max(0.01, eff_in)
                if is_kinetic:
                    arr = _render_kinetic_frame(c["text"], target_w, band_h, is_vertical, cue_idx, "in", prog)
                else:
                    arr = _render_standard_frame(c["text"], target_w, band_h, is_vertical, caption_style, "in", prog)
                proc.stdin.write(arr.tobytes())
            elif en - t < eff_out:
                prog = 1.0 - (en - t) / max(0.01, eff_out)
                if is_kinetic:
                    arr = _render_kinetic_frame(c["text"], target_w, band_h, is_vertical, cue_idx, "out", prog)
                else:
                    arr = _render_standard_frame(c["text"], target_w, band_h, is_vertical, caption_style, "out", prog)
                proc.stdin.write(arr.tobytes())
            else:
                if cue_idx not in hold_cache:
                    if is_kinetic:
                        arr = _render_kinetic_frame(c["text"], target_w, band_h, is_vertical, cue_idx, "hold", 1.0)
                    else:
                        arr = _render_standard_frame(c["text"], target_w, band_h, is_vertical, caption_style, "hold", 1.0)
                    hold_cache[cue_idx] = arr.tobytes()
                proc.stdin.write(hold_cache[cue_idx])

        proc.stdin.close()
        stderr_data = proc.stderr.read().decode("utf-8", errors="ignore") if proc.stderr else ""
        ret = proc.wait(timeout=120)
        if ret != 0 or not final_clip_path.exists() or final_clip_path.stat().st_size < 1000:
            raise RuntimeError(f"FFmpeg animated caption burn failed (rc={ret}): {stderr_data[-400:]}")
        return final_clip_path
    except BrokenPipeError:
        stderr_data = proc.stderr.read().decode("utf-8", errors="ignore") if proc.stderr else ""
        proc.wait(timeout=30)
        if final_clip_path.exists() and final_clip_path.stat().st_size > 1000:
            return final_clip_path
        raise RuntimeError(f"FFmpeg pipe closed early: {stderr_data[-400:]}")
    finally:
        if proc.poll() is None:
            proc.kill()
