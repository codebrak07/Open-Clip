import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


# ─────────────────────── Single Configurable Style Object ───────────────────────
KARAOKE_POP_CONFIG: Dict[str, Any] = {
    "canvas": {
        "fps": 30,
    },
    "layout": {
        "align": "center",
        "anchor_x_pct": 0.48,       # configurable horizontal center (reference GTA clip used 0.417; 0.48-0.50 centers nicely across clips)
        "baseline_y_pct": 0.55,     # 55% down the frame (chest/neck area)
        "max_words_on_screen": 1,
    },
    "font": {
        "family": "Times New Roman",
        "paths": [
            "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
            "/System/Library/Fonts/Times.ttc",
            "/Library/Fonts/Times New Roman.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
            "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
        ],
        "weight": 400,
        "size_pct_of_width": 0.10,  # ~108px on 1080-wide canvas
        "text_transform": "none",   # preserve original casing
        "stroke": None,             # NO stroke / NO outline
    },
    "palette": {
        "lime":   (180, 255, 0),    # #B4FF00 Electric Lime
        "cyan":   (0, 247, 255),    # #00F7FF Hyper Cyan
        "yellow": (255, 242, 0),    # #FFF200 Laser Yellow
        "green":  (0, 255, 102),    # #00FF66 Neon Green
        "mint":   (51, 255, 204),   # #33FFCC Electric Mint
        "pink":   (255, 46, 136),   # #FF2E88 Hot Neon Pink
        "red":    (255, 42, 42),    # #FF2A2A Bright Neon Red
        "white":  (255, 255, 255),  # #FFFFFF
    },
    "color_rules": {
        "short_word_cycle": ["cyan", "lime", "yellow", "green", "pink", "mint", "red"],
        "whole_word_color": True,   # always color the entire word, never just one letter/syllable
        "no_immediate_repeat": True,
    },
    "glow": {
        "layers": [
            {"sigma_px": 5.0,  "opacity": 0.65},   # bright tight halo hugging letters
            {"sigma_px": 26.0, "opacity": 0.95},   # vibrant wide outer neon halo
        ],
    },
    "shadow": {
        "color": (0, 0, 0),
        "opacity": 0.65,
        "offset_x": 4,
        "offset_y": 4,
        "blur_sigma_px": 2.5,
    },
    "enter": {
        "effect": "verticalBlur",
        "applies_to": "wholeCaptionLayer",
        "triggers": ["wordStart", "chunkChange"],
        # Exact 30fps vertical Gaussian sigma decay curve from reference measurement
        "gaussian_sigma_y_per_frame": [17.0, 6.0, 1.5, 0.0],
    },
    "exit": None,
}


@dataclass
class KaraokeEvent:
    start: float
    end: float
    word: str
    chunks: List[str]
    active_chunk_idx: Optional[int]   # None = solid whole-word color; int = white base + highlighted chunk
    active_color: Tuple[int, int, int]
    base_color: Tuple[int, int, int]


def _load_serif_font(size: int, config: Dict[str, Any]) -> ImageFont.FreeTypeFont:
    for fp in config["font"]["paths"]:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _clean_word_punctuation(word: str, is_last_in_sentence: bool = False) -> str:
    """Keep trailing '?' or '!', drop periods/commas/quotes cleanly as in spec."""
    w = word.strip().strip('"\'“”‘’()[]')
    if not w:
        return ""
    if w.endswith("?") or w.endswith("!"):
        punct = w[-1]
        core = re.sub(r"[^A-Za-z0-9'\-$%]+$", "", w[:-1])
        return (core + punct) if core else ""
    core = re.sub(r"[.,;:]+$", "", w)
    return core


def _split_into_syllable_chunks(word: str) -> List[str]:
    """
    Splits acronyms letter-by-letter (GTA -> G, T, A) and multi-syllable words
    into natural spoken chunks (iconic -> i, co, nic; favorite? -> fa, vo, rite?).
    """
    trailing = ""
    core = word
    if core and core[-1] in ("?", "!"):
        trailing = core[-1]
        core = core[:-1]

    alpha_only = re.sub(r"[^A-Za-z]", "", core)

    # 1. All-caps acronyms (2-5 chars like GTA, NBA, CEO, POV) -> letter by letter
    if 2 <= len(alpha_only) <= 5 and alpha_only.isupper():
        chunks = list(core)
        if trailing and chunks:
            chunks[-1] += trailing
        return chunks

    # 2. Known reference / common syllable patterns + vowel-cluster heuristic
    lower = core.lower()
    known = {
        "iconic": ["i", "co", "nic"],
        "favorite": ["fa", "vo", "rite"],
        "favourite": ["fa", "vou", "rite"],
        "everything": ["ev", "ery", "thing"],
        "everyone": ["ev", "ery", "one"],
        "actually": ["ac", "tu", "ally"],
        "literally": ["lit", "er", "ally"],
        "unbelievable": ["un", "be", "liev", "able"],
        "incredible": ["in", "cred", "ible"],
        "remember": ["re", "mem", "ber"],
        "together": ["to", "ge", "ther"],
        "thousand": ["thou", "sand"],
        "million": ["mil", "lion"],
        "billion": ["bil", "lion"],
    }
    if lower in known:
        parts = list(known[lower])
        # Preserve original capitalization
        out: List[str] = []
        pos = 0
        for p in parts:
            out.append(core[pos : pos + len(p)])
            pos += len(p)
        if pos < len(core):
            out[-1] += core[pos:]
        if trailing:
            out[-1] += trailing
        return out

    # 3. Vowel-group heuristic syllable splitter
    # Find vowel clusters to estimate syllable boundaries
    vowels = "aeiouyAEIOUY"
    boundaries = [0]
    i = 0
    n = len(core)
    while i < n:
        # Advance past consonants
        while i < n and core[i] not in vowels:
            i += 1
        # Advance past vowel nucleus
        while i < n and core[i] in vowels:
            i += 1
        if i >= n:
            break
        # Count consonants before next vowel
        c_start = i
        while i < n and core[i] not in vowels:
            i += 1
        c_len = i - c_start
        if i < n:
            # Split consonant cluster naturally
            split_at = c_start if c_len <= 1 else c_start + (c_len // 2)
            if split_at > boundaries[-1]:
                boundaries.append(split_at)

    boundaries.append(n)
    raw_chunks = [core[boundaries[k] : boundaries[k + 1]] for k in range(len(boundaries) - 1)]
    raw_chunks = [c for c in raw_chunks if c]

    # Merge tiny trailing silent-'e' fragment (e.g. "rite" staying intact)
    if len(raw_chunks) >= 2 and len(raw_chunks[-1]) <= 2 and raw_chunks[-1].lower().endswith("e"):
        raw_chunks[-2] += raw_chunks[-1]
        raw_chunks.pop()

    # Cap at 4 chunks max so pacing stays snappy
    while len(raw_chunks) > 4:
        raw_chunks[-2] += raw_chunks[-1]
        raw_chunks.pop()

    if not raw_chunks:
        raw_chunks = [core]
    if trailing:
        raw_chunks[-1] += trailing
    return raw_chunks


def _is_chunked_emphasis_word(word: str, chunks: List[str], is_final_word: bool) -> bool:
    core = word.rstrip("?!")
    alpha = re.sub(r"[^A-Za-z]", "", core)
    if 2 <= len(alpha) <= 5 and alpha.isupper():
        return True
    if len(chunks) >= 3:
        return True
    if is_final_word and len(chunks) >= 2 and (word.endswith("?") or word.endswith("!") or len(alpha) >= 6):
        return True
    return False


def build_karaoke_events_from_cues(
    cues: List[Dict[str, Any]],
    clip_start: float,
    clip_end: float,
    config: Dict[str, Any] = KARAOKE_POP_CONFIG,
) -> List[KaraokeEvent]:
    """
    Converts timed cues (with optional per-word timestamps) into contiguous, gapless
    word / syllable-chunk KaraokeEvents driven strictly by speech timing.
    """
    clip_dur = max(0.5, clip_end - clip_start)
    raw_words: List[Tuple[float, float, str]] = []

    for cue in cues:
        if cue["end"] <= clip_start or cue["start"] >= clip_end:
            continue

        word_entries = cue.get("words")
        if word_entries:
            for we in word_entries:
                ws = we["start"]
                we_end = we["end"]
                if we_end <= clip_start or ws >= clip_end:
                    continue
                rel_s = max(0.0, ws - clip_start)
                rel_e = min(clip_dur, we_end - clip_start)
                for tok in we["text"].split():
                    cleaned = _clean_word_punctuation(tok)
                    if cleaned:
                        raw_words.append((rel_s, max(rel_s + 0.06, rel_e), cleaned))
        else:
            rel_s = max(0.0, cue["start"] - clip_start)
            rel_e = min(clip_dur, cue["end"] - clip_start)
            tokens = [_clean_word_punctuation(t) for t in cue["text"].split()]
            tokens = [t for t in tokens if t]
            if not tokens:
                continue
            weights = [max(2, len(t)) for t in tokens]
            total_w = sum(weights)
            cur = rel_s
            span = max(0.1, rel_e - rel_s)
            for idx, tok in enumerate(tokens):
                dur = span * (weights[idx] / total_w)
                raw_words.append((cur, cur + dur, tok))
                cur += dur

    if not raw_words:
        return []

    raw_words.sort(key=lambda x: x[0])

    # Make words strictly contiguous (each word holds until the next word starts; small pad on last)
    contiguous_words: List[Tuple[float, float, str]] = []
    for idx, (st, en, w) in enumerate(raw_words):
        if idx + 1 < len(raw_words):
            nxt_st = raw_words[idx + 1][0]
            # Only close gaps up to 0.8s so speech pauses still feel natural while active speech is gapless
            if nxt_st > st and nxt_st - en < 0.8:
                en = nxt_st
            elif nxt_st <= st:
                st = max(0.0, nxt_st - 0.07)
                en = nxt_st
        else:
            en = min(clip_dur, en + 0.12)
        if en - st >= 0.05:
            contiguous_words.append((st, en, w))

    palette = config["palette"]
    short_cycle = config["color_rules"]["short_word_cycle"]
    whole_word_only = config["color_rules"].get("whole_word_color", True)
    chunk_colors = config["color_rules"].get("chunk_highlight_colors", ["green", "yellow"])
    base_white = palette[config["color_rules"].get("chunked_word_base", "white")]

    events: List[KaraokeEvent] = []
    last_color_name: Optional[str] = None
    color_cursor = 0
    chunk_color_cursor = 0

    for w_idx, (st, en, word) in enumerate(contiguous_words):
        is_last = w_idx == len(contiguous_words) - 1
        chunks = _split_into_syllable_chunks(word)
        is_chunked = (
            (not whole_word_only)
            and _is_chunked_emphasis_word(word, chunks, is_last)
            and len(chunks) >= 2
            and (en - st) >= 0.16
        )

        if is_chunked:
            # Pick highlight color (green or yellow), preferring yellow for final '?' word & never repeating previous
            if word.endswith("?"):
                chosen_name = "yellow" if last_color_name != "yellow" else "green"
            else:
                chosen_name = chunk_colors[chunk_color_cursor % len(chunk_colors)]
                chunk_color_cursor += 1
                if chosen_name == last_color_name:
                    chosen_name = chunk_colors[chunk_color_cursor % len(chunk_colors)]
                    chunk_color_cursor += 1
            last_color_name = chosen_name
            hl_rgb = palette[chosen_name]

            # Split word duration across syllables proportionally by chunk character length
            c_weights = [max(1, len(c)) for c in chunks]
            c_total = sum(c_weights)
            cur_t = st
            total_dur = en - st
            for c_idx, _ in enumerate(chunks):
                c_dur = total_dur * (c_weights[c_idx] / c_total)
                c_end = en if c_idx == len(chunks) - 1 else cur_t + c_dur
                events.append(KaraokeEvent(
                    start=cur_t,
                    end=c_end,
                    word=word,
                    chunks=chunks,
                    active_chunk_idx=c_idx,
                    active_color=hl_rgb,
                    base_color=base_white,
                ))
                cur_t = c_end
        else:
            # Pick solid neon color without repeating previous active color
            chosen_name = short_cycle[color_cursor % len(short_cycle)]
            color_cursor += 1
            if chosen_name == last_color_name:
                chosen_name = short_cycle[color_cursor % len(short_cycle)]
                color_cursor += 1
            last_color_name = chosen_name
            rgb = palette[chosen_name]
            events.append(KaraokeEvent(
                start=st,
                end=en,
                word=word,
                chunks=[word],
                active_chunk_idx=None,
                active_color=rgb,
                base_color=rgb,
            ))

    return events


def _gaussian_blur_y_1d(arr: np.ndarray, sigma: float) -> np.ndarray:
    """
    True 1D vertical-only Gaussian blur along axis=0 (RGBA uint8 array).
    Equivalent to scipy.ndimage.gaussian_filter1d(arr, sigma, axis=0) / ffmpeg gblur=sigma=0:sigmaV=sigma.
    Pure NumPy — zero scipy dependency, ~2-4ms per band frame.
    """
    if sigma <= 0.25:
        return arr
    radius = max(1, int(round(sigma * 3.0)))
    xs = np.arange(-radius, radius + 1, dtype=np.float32)
    kernel = np.exp(-0.5 * (xs / sigma) ** 2)
    kernel /= kernel.sum()

    h, w, c = arr.shape
    # Premultiply RGB by alpha before vertical blur so dark transparent pixels don't cause black fringes
    f = arr.astype(np.float32)
    alpha = f[:, :, 3:4] / 255.0
    premul = np.empty_like(f)
    premul[:, :, :3] = f[:, :, :3] * alpha
    premul[:, :, 3:4] = f[:, :, 3:4]

    padded = np.pad(premul, ((radius, radius), (0, 0), (0, 0)), mode="constant")
    # Vectorized 1D convolution along axis=0
    out = np.zeros_like(premul)
    for k_i, weight in enumerate(kernel):
        out += weight * padded[k_i : k_i + h]

    # Un-premultiply RGB safely
    out_alpha = out[:, :, 3:4]
    safe_a = np.where(out_alpha > 1.0, out_alpha / 255.0, 1.0)
    res = np.empty_like(out)
    res[:, :, :3] = np.where(out_alpha > 1.0, out[:, :, :3] / safe_a, 0.0)
    res[:, :, 3:4] = out_alpha
    return np.clip(res, 0, 255).astype(np.uint8)


def _render_crisp_karaoke_layer(
    ev: KaraokeEvent,
    width: int,
    band_h: int,
    config: Dict[str, Any],
) -> np.ndarray:
    """
    Renders the crisp (sigmaY = 0) RGBA layer for a single KaraokeEvent:
      Bottom -> Top:
        1. Same-hue outer glow (wide sigma=24px @ 0.90 + tight sigma=4px @ 0.50)
        2. Drop shadow (black @ 0.65, offset +4/+4, blur sigma=2.5px)
        3. Solid Times New Roman Regular fill (NO stroke, NO background box)
    """
    font_size = max(36, int(width * config["font"]["size_pct_of_width"]))
    font = _load_serif_font(font_size, config)

    # Measure full word width & draw glyph fills onto clean RGBA layer
    meas = ImageDraw.Draw(Image.new("RGBA", (1, 1), (0, 0, 0, 0)))
    full_bbox = meas.textbbox((0, 0), ev.word, font=font)
    word_w = full_bbox[2] - full_bbox[0]
    word_h = full_bbox[3] - full_bbox[1]

    anchor_x = int(width * config["layout"]["anchor_x_pct"])
    # Ensure long words never clip off left/right edges
    margin = int(width * 0.06)
    start_x = anchor_x - word_w // 2
    start_x = max(margin, min(width - margin - word_w, start_x))
    start_y = (band_h - word_h) // 2 - full_bbox[1]

    fill_layer = Image.new("RGBA", (width, band_h), (0, 0, 0, 0))
    shadow_mask_layer = Image.new("RGBA", (width, band_h), (0, 0, 0, 0))
    fill_draw = ImageDraw.Draw(fill_layer)
    sh_draw = ImageDraw.Draw(shadow_mask_layer)

    sh_cfg = config["shadow"]
    sh_x = start_x + sh_cfg["offset_x"]
    sh_y = start_y + sh_cfg["offset_y"]
    sh_alpha = int(255 * sh_cfg["opacity"])

    if ev.active_chunk_idx is None:
        # Solid neon single-color word
        r, g, b = ev.active_color
        fill_draw.text((start_x, start_y), ev.word, font=font, fill=(r, g, b, 255))
        sh_draw.text((sh_x, sh_y), ev.word, font=font, fill=(0, 0, 0, sh_alpha))
    else:
        # White base word + colored active syllable chunk (exact kerning via cumulative prefix width)
        prefix = ""
        for idx, ch_txt in enumerate(ev.chunks):
            px_offset = int(round(meas.textlength(prefix, font=font))) if prefix else 0
            cx = start_x + px_offset
            r, g, b = ev.active_color if idx == ev.active_chunk_idx else ev.base_color
            fill_draw.text((cx, start_y), ch_txt, font=font, fill=(r, g, b, 255))
            prefix += ch_txt
        sh_draw.text((sh_x, sh_y), ev.word, font=font, fill=(0, 0, 0, sh_alpha))

    # 1. Build outer glow layers (same hue as fill — white letters emit white glow!)
    composite = Image.new("RGBA", (width, band_h), (0, 0, 0, 0))
    for gl in config["glow"]["layers"]:
        blurred = fill_layer.filter(ImageFilter.GaussianBlur(radius=gl["sigma_px"]))
        if gl["opacity"] < 0.999:
            arr_g = np.array(blurred, dtype=np.uint8)
            arr_g[:, :, 3] = np.clip(arr_g[:, :, 3].astype(np.float32) * gl["opacity"], 0, 255).astype(np.uint8)
            blurred = Image.fromarray(arr_g, mode="RGBA")
        composite = Image.alpha_composite(composite, blurred)

    # 2. Drop shadow (black @ 65%, offset +4,+4, sigma=2.5px)
    shadow_blurred = shadow_mask_layer.filter(ImageFilter.GaussianBlur(radius=sh_cfg["blur_sigma_px"]))
    composite = Image.alpha_composite(composite, shadow_blurred)

    # 3. Crisp serif fill on top
    composite = Image.alpha_composite(composite, fill_layer)
    return np.array(composite, dtype=np.uint8)


def build_karaoke_pop_clip(
    raw_clip_path: Path,
    final_clip_path: Path,
    cues: List[Dict[str, Any]],
    clip_start: float,
    clip_end: float,
    aspect_ratio: str = "4:5",
    ffmpeg_bin: str = "ffmpeg",
    config: Dict[str, Any] = KARAOKE_POP_CONFIG,
) -> Path:
    """
    Renders a full-HD reframed MP4 with authentic 'Karaoke Pop' word-by-word serif captions:
      - One word at a time, Times New Roman Regular, no stroke, no box
      - Neon glow + dark drop shadow
      - Exact 30fps vertical-only directional Gaussian smear [17, 6, 1.5, 0] on every word & syllable step
      - Instant cut transitions (no exit animation)
    """
    from openclip_engine.clipping.caption_burner import ASPECT_DIMS, _probe_duration

    target_w, target_h = ASPECT_DIMS.get(aspect_ratio, (1080, 1350))
    ratio_expr = f"{target_w}/{target_h}"
    base_vf = (
        f"crop='if(gt(iw/ih,{ratio_expr}),ih*{ratio_expr},iw)':"
        f"'if(gt(iw/ih,{ratio_expr}),ih,iw/({ratio_expr}))',"
        f"scale={target_w}:{target_h}:flags=lanczos,setsar=1"
    )

    events = build_karaoke_events_from_cues(cues, clip_start, clip_end, config)
    if not events:
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

    fps = config["canvas"]["fps"]
    # Generous vertical band centered at baseline_y_pct (0.55) so sigmaY=17 vertical smear + sigma=24 glow never clip
    band_h = min(target_h, max(440, int(target_h * 0.42)))
    band_h += band_h % 2
    center_y = int(target_h * config["layout"]["baseline_y_pct"])
    band_y = max(0, min(target_h - band_h, center_y - band_h // 2))

    duration = _probe_duration(raw_clip_path, ffmpeg_bin)
    total_frames = max(1, int(duration * fps) + 2)
    sigmas = config["enter"]["gaussian_sigma_y_per_frame"]  # [17.0, 6.0, 1.5, 0.0]

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

    # Pre-render 4 stills per event (3 vertical-blurred entrance frames + 1 crisp hold) on demand
    crisp_cache: Dict[int, np.ndarray] = {}
    bytes_cache: Dict[Tuple[int, int], bytes] = {}

    def get_event_frame_bytes(ev_idx: int, local_frame: int) -> bytes:
        blur_slot = min(local_frame, len(sigmas) - 1)
        key = (ev_idx, blur_slot)
        if key in bytes_cache:
            return bytes_cache[key]
        if ev_idx not in crisp_cache:
            crisp_cache[ev_idx] = _render_crisp_karaoke_layer(events[ev_idx], target_w, band_h, config)
        sigma_y = sigmas[blur_slot]
        if sigma_y <= 0.0:
            raw = crisp_cache[ev_idx].tobytes()
        else:
            raw = _gaussian_blur_y_1d(crisp_cache[ev_idx], sigma_y).tobytes()
        bytes_cache[key] = raw
        return raw

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )

    try:
        assert proc.stdin is not None
        ev_idx = 0
        n_ev = len(events)

        for frame_i in range(total_frames):
            t = frame_i / fps
            while ev_idx < n_ev and t >= events[ev_idx].end:
                # Evict old event's cached frames to keep RAM tiny
                crisp_cache.pop(ev_idx, None)
                for s_i in range(len(sigmas)):
                    bytes_cache.pop((ev_idx, s_i), None)
                ev_idx += 1

            if ev_idx >= n_ev or t < events[ev_idx].start:
                proc.stdin.write(empty_bytes)
                continue

            ev_start_frame = int(round(events[ev_idx].start * fps))
            local_frame = max(0, frame_i - ev_start_frame)
            proc.stdin.write(get_event_frame_bytes(ev_idx, local_frame))

        proc.stdin.close()
        stderr_data = proc.stderr.read().decode("utf-8", errors="ignore") if proc.stderr else ""
        ret = proc.wait(timeout=120)
        if ret != 0 or not final_clip_path.exists() or final_clip_path.stat().st_size < 1000:
            raise RuntimeError(f"FFmpeg Karaoke Pop burn failed (rc={ret}): {stderr_data[-400:]}")
        return final_clip_path
    except BrokenPipeError:
        stderr_data = proc.stderr.read().decode("utf-8", errors="ignore") if proc.stderr else ""
        proc.wait(timeout=30)
        if final_clip_path.exists() and final_clip_path.stat().st_size > 1000:
            return final_clip_path
        raise RuntimeError(f"FFmpeg Karaoke Pop pipe closed early: {stderr_data[-400:]}")
    finally:
        if proc.poll() is None:
            proc.kill()
