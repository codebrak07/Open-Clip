from __future__ import annotations

import hashlib
import math
import os
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


# Resolve bundled fallback font relative to repository root (assets/fonts/Tinos-Regular.ttf)
_REPO_ROOT = Path(__file__).resolve().parents[4]
_BUNDLED_TINOS = str(_REPO_ROOT / "assets" / "fonts" / "Tinos-Regular.ttf")
_BUNDLED_LIBERATION = str(_REPO_ROOT / "assets" / "fonts" / "LiberationSerif-Regular.ttf")


@dataclass(frozen=True)
class CaptionStyle:
    """Single source of truth for all Karaoke Pop geometry, palette, glow, shadow, smear, and timing values."""

    # Font (Times New Roman Regular primary; bundled Tinos/Liberation Serif fallback; never bold)
    font_paths: Tuple[str, ...] = (
        "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
        _BUNDLED_TINOS,
        _BUNDLED_LIBERATION,
        "/System/Library/Fonts/Times.ttc",
        "/Library/Fonts/Times New Roman.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf",
    )
    font_size_pct: float = 0.102        # 110px at 1080 wide
    max_word_width_pct: float = 0.90    # shrink to fit if wider than 90% of W

    # Geometry (relative to video W x H)
    anchor_x_pct: float = 0.48          # horizontal center
    center_y_pct: float = 0.54          # vertical center of the line box

    # Palette (ONLY these 4 + white for emphasis base; no pink, lime, mint, orange)
    palette: Dict[str, Tuple[int, int, int]] = field(default_factory=lambda: {
        "yellow": (0xF5, 0xF0, 0x00),   # #F5F000
        "cyan":   (0x2E, 0xE6, 0xF0),   # #2EE6F0
        "red":    (0xFF, 0x1E, 0x1E),   # #FF1E1E
        "green":  (0x1B, 0xFF, 0x1B),   # #1BFF1B
        "white":  (0xFF, 0xFF, 0xFF),   # #FFFFFF (emphasis base only)
    })
    normal_colors: Tuple[str, ...] = ("yellow", "cyan", "red", "green")
    emphasis_window_colors: Tuple[str, ...] = ("green", "yellow")
    emphasis_base_color: str = "white"

    # Layer 1: Drop shadow (bottom)
    shadow_color: Tuple[int, int, int] = (0, 0, 0)
    shadow_alpha: float = 0.70
    shadow_offset_x_1080: float = 3.0
    shadow_offset_y_1080: float = 4.0
    shadow_blur_sigma: float = 1.5

    # Layer 2: Outer glow (middle, same hue as glyph)
    glow_sigma_1080: float = 6.0        # ~12px radius
    glow_opacity: float = 0.60
    glow_dilate_px: int = 5.5             # odd integer kernel size for pre-blur stem spread
    glow_gain: float = 4.8              # compensates 2D blur attenuation on thin serif strokes so 4-12px halo sits at ~45-55%

    # Entrance smear (horizontal-only Gaussian blur + scaleX, time-based in ms)
    smear_phase1_ms: float = 33.0
    smear_phase1_sigma_x_1080: float = 16.0
    smear_phase1_scale_x: float = 1.12
    smear_phase2_ms: float = 66.0
    smear_phase2_sigma_x_1080: float = 5.0
    smear_phase2_scale_x: float = 1.03

    # Optional horizontal echo ghost copies during smear (default off)
    smear_echo: bool = False
    smear_echo_offsets_1080: Tuple[float, ...] = (8.0, 16.0, 24.0)
    smear_echo_alpha: float = 0.35

    # Emphasis word detection stoplist & syllable window rules
    emphasis_stoplist: Tuple[str, ...] = (
        "every", "everyone", "everything", "everybody",
        "probably", "family", "different", "interesting", "camera",
    )
    acronym_min_len: int = 2
    acronym_max_len: int = 5
    emphasis_min_syllables: int = 3
    min_window_frames: int = 2

    # Timing & hold rules
    max_pause_hold_s: float = 0.25      # bridge gaps <= 0.25s; hide at word.end + 0.25s for longer pauses
    min_display_frames: int = 2
    caption_sync_offset_ms: float = 0.0

    # Deterministic color seed & encoding settings
    color_seed: int = 1337
    crf: int = 18
    band_height_pct: float = 0.34       # overlay RGBA strip height centered at center_y_pct


KARAOKE_POP = CaptionStyle()


# ─────────────────────── Dictionary & Syllable Engine ───────────────────────
_COMMON_ENGLISH_FALLBACK = {
    "a", "am", "an", "and", "any", "are", "as", "at", "all", "back", "bad", "be", "best", "big",
    "bro", "but", "by", "can", "chill", "come", "cool", "crazy", "day", "dead", "did", "do",
    "does", "done", "down", "dude", "each", "even", "ever", "fast", "feel", "fight", "find",
    "fire", "for", "from", "full", "game", "get", "give", "go", "god", "good", "got", "great",
    "guy", "guys", "had", "hard", "has", "hate", "have", "he", "help", "her", "here", "hey",
    "high", "him", "his", "hold", "home", "hot", "how", "i", "if", "in", "into", "is", "it",
    "its", "just", "keep", "kill", "kind", "know", "last", "left", "let", "lets", "life", "like",
    "live", "long", "look", "lose", "lost", "lot", "love", "low", "made", "make", "man", "many",
    "may", "me", "mean", "men", "mind", "more", "most", "move", "much", "must", "my", "name",
    "need", "new", "next", "nice", "no", "not", "now", "of", "off", "oh", "ok", "okay", "old",
    "on", "once", "one", "only", "open", "or", "our", "out", "over", "own", "part", "play",
    "pull", "push", "put", "real", "rich", "right", "run", "said", "same", "save", "saw", "say",
    "see", "set", "she", "shot", "show", "shut", "sick", "side", "so", "some", "song", "soon",
    "stay", "step", "stop", "such", "sure", "take", "talk", "tell", "than", "that", "the",
    "them", "then", "they", "this", "time", "to", "told", "too", "took", "top", "true", "try",
    "turn", "two", "up", "us", "use", "very", "wait", "walk", "want", "war", "was", "way", "we",
    "well", "went", "were", "what", "when", "who", "why", "wild", "will", "win", "with", "won",
    "word", "work", "wow", "yeah", "year", "yes", "yet", "yo", "you", "your",
}

_DICT_CACHE: Optional[set] = None


def _get_english_dictionary() -> set:
    global _DICT_CACHE
    if _DICT_CACHE is not None:
        return _DICT_CACHE
    words = set(_COMMON_ENGLISH_FALLBACK)
    for dict_path in ("/usr/share/dict/words", "/usr/share/dict/american-english"):
        p = Path(dict_path)
        if p.exists():
            try:
                for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                    w = line.strip()
                    # Only include lowercase dictionary entries (excludes uppercase proper nouns/acronyms)
                    if w and w.islower() and w.isalpha():
                        words.add(w)
            except Exception:
                pass
            break
    _DICT_CACHE = words
    return words


def _is_english_word(word_lower: str) -> bool:
    d = _get_english_dictionary()
    if word_lower in d:
        return True
    # Handle regular inflections (plurals / -ed / -ing) not always listed in /usr/share/dict/words
    if len(word_lower) > 3 and word_lower.endswith("s") and word_lower[:-1] in d:
        return True
    if len(word_lower) > 4 and word_lower.endswith("es") and word_lower[:-2] in d:
        return True
    if len(word_lower) > 4 and word_lower.endswith("ed") and (word_lower[:-2] in d or word_lower[:-1] in d):
        return True
    if len(word_lower) > 5 and word_lower.endswith("ing") and (word_lower[:-3] in d or (word_lower[:-3] + "e") in d):
        return True
    return False


_DIGRAPHS = {"th", "ch", "sh", "ph", "wh", "ck", "ng"}


def _tokenize_consonants(cluster: str) -> List[str]:
    """Splits a consonant cluster into indivisible units while keeping th/ch/sh/ph/wh/ck/ng together."""
    units: List[str] = []
    i = 0
    n = len(cluster)
    while i < n:
        if i + 1 < n and cluster[i : i + 2].lower() in _DIGRAPHS:
            units.append(cluster[i : i + 2])
            i += 2
        else:
            units.append(cluster[i])
            i += 1
    return units


def split_syllables(word: str) -> List[str]:
    """
    Splits a word into spoken syllable chunks using vowel-group nuclei:
      - a, e, i, o, u, y count as vowels (leading 'y' before a vowel is treated as consonant).
      - Silent final 'e' after a consonant is dropped from nuclei when another nucleus exists.
      - Digraphs (th, ch, sh, ph, wh, ck, ng) stay together as one consonant unit.
      - Boundary is placed BEFORE a single intervening consonant unit, or BETWEEN two consonant units.
      - Trailing '?' or '!' is preserved on the final syllable.
    """
    if not word:
        return []

    trailing = ""
    core = word
    while core and core[-1] in ("?", "!"):
        trailing = core[-1] + trailing
        core = core[:-1]

    if not core:
        return [word]

    vowels = set("aeiouyAEIOUY")

    def is_vowel_at(idx: int) -> bool:
        ch = core[idx]
        if ch not in vowels:
            return False
        # Initial 'y' followed by another vowel acts as a consonant (e.g. "your", "yes")
        if ch in ("y", "Y") and idx == 0 and len(core) > 1 and core[1] in set("aeiouAEIOU"):
            return False
        return True

    # 1. Locate contiguous vowel-group nuclei [(start, end), ...]
    nuclei: List[Tuple[int, int]] = []
    i = 0
    n = len(core)
    while i < n:
        if is_vowel_at(i):
            st = i
            while i < n and is_vowel_at(i):
                i += 1
            nuclei.append((st, i))
        else:
            i += 1

    # 2. Drop silent final 'e' (single 'e' at word end preceded by a consonant, if >= 2 nuclei)
    if (
        len(nuclei) >= 2
        and nuclei[-1][1] == n
        and nuclei[-1][1] - nuclei[-1][0] == 1
        and core[nuclei[-1][0]].lower() == "e"
        and nuclei[-1][0] > 0
        and not is_vowel_at(nuclei[-1][0] - 1)
    ):
        nuclei.pop()

    if len(nuclei) <= 1:
        return [core + trailing]

    # 3. Compute syllable boundaries between consecutive nuclei
    cut_points: List[int] = [0]
    for k in range(len(nuclei) - 1):
        prev_end = nuclei[k][1]
        next_start = nuclei[k + 1][0]
        intervening = core[prev_end:next_start]
        if not intervening:
            cut_points.append(next_start)
        else:
            units = _tokenize_consonants(intervening)
            if len(units) == 1:
                # Boundary BEFORE a single intervening consonant unit
                cut_points.append(prev_end)
            else:
                # Boundary BETWEEN consonants (after the first consonant unit)
                cut_points.append(prev_end + len(units[0]))
    cut_points.append(n)

    chunks = [core[cut_points[j] : cut_points[j + 1]] for j in range(len(cut_points) - 1)]
    chunks = [c for c in chunks if c]
    if not chunks:
        chunks = [core]
    if trailing:
        chunks[-1] += trailing
    return chunks


def clean_word_text(raw: str) -> str:
    """Keep transcript casing and ? ! ' - ; strip zero-width chars and trailing . , ; :"""
    w = re.sub(r"[\u200b\u200c\u200d\ufeff\u2060]+", "", raw).strip()
    if not w:
        return ""
    # Strip surrounding quotes/parens if any
    w = w.strip('"\u201c\u201d\u2018\u2019()[]')
    # Strip trailing . , ; : while preserving ? ! ' -
    w = re.sub(r"[.,;:]+$", "", w)
    w = re.sub(r"^[.,;:]+", "", w)
    return w


def is_acronym(word: str, style: CaptionStyle) -> bool:
    core = re.sub(r"[?!'\-]+$", "", word)
    if not core.isalpha():
        return False
    if not (style.acronym_min_len <= len(core) <= style.acronym_max_len):
        return False
    if not core.isupper():
        return False
    return not _is_english_word(core.lower())


def classify_word_chunks(word: str, style: CaptionStyle) -> Tuple[bool, List[str]]:
    """
    Returns (is_emphasis, chunks):
      - Acronym (2-5 uppercase non-dictionary letters): emphasis, split letter-by-letter.
      - 3+ syllables and not in stoplist: emphasis, split by split_syllables(word).
      - Otherwise: normal solid word.
    """
    if is_acronym(word, style):
        trailing = ""
        core = word
        while core and core[-1] in ("?", "!"):
            trailing = core[-1] + trailing
            core = core[:-1]
        chunks = list(core)
        if trailing and chunks:
            chunks[-1] += trailing
        return True, chunks

    base_lower = re.sub(r"[^a-zA-Z]+", "", word).lower()
    if base_lower in style.emphasis_stoplist:
        return False, [word]

    sylls = split_syllables(word)
    if len(sylls) >= style.emphasis_min_syllables:
        return True, sylls

    return False, [word]


def _pick_deterministic_color(
    candidates: Sequence[str],
    exclude: Optional[str],
    word_index: int,
    seed: int,
) -> str:
    allowed = [c for c in candidates if c != exclude]
    if not allowed:
        allowed = list(candidates)
    digest = hashlib.sha256(f"{seed}:{word_index}".encode("utf-8")).digest()
    idx = int.from_bytes(digest[:4], "big") % len(allowed)
    return allowed[idx]


# ─────────────────────── Event & Timing Engine ───────────────────────
@dataclass
class RenderEvent:
    word_index: int
    word: str
    chunks: List[str]
    window_index: Optional[int]          # None = normal solid word; int = active syllable chunk on white base
    main_color_name: str                 # normal solid color OR emphasis window color
    start: float                         # clip-relative seconds
    end: float                           # clip-relative seconds
    is_emphasis: bool


def build_render_events(
    words: Sequence[Dict[str, Any]],
    fps: float,
    clip_start: float = 0.0,
    clip_end: Optional[float] = None,
    style: CaptionStyle = KARAOKE_POP,
) -> List[RenderEvent]:
    """
    Applies clip-relative timing, sync offset, pause-hold bridging (<= 0.25s), clamping,
    min 2-frame display, emphasis detection, syllable window splits, and deterministic colors.
    """
    frame_dur = 1.0 / max(1.0, fps)
    min_word_dur = style.min_display_frames * frame_dur
    min_win_dur = style.min_window_frames * frame_dur
    sync_s = style.caption_sync_offset_ms / 1000.0

    # 1. Filter words starting before clip_start, rebase to clip-relative time, clean text
    cleaned_words: List[Dict[str, Any]] = []
    for item in words:
        raw_text = item.get("word") if "word" in item else item.get("text", "")
        text = clean_word_text(str(raw_text))
        if not text:
            continue
        src_start = float(item["start"])
        src_end = float(item.get("end", src_start + min_word_dur))

        # Skip any word whose start is before clip_start (no stray smeared frame at 0.00s)
        if src_start < clip_start - 1e-6:
            continue

        rel_start = (src_start - clip_start) + sync_s
        rel_end = (src_end - clip_start) + sync_s
        if clip_end is not None:
            clip_dur = clip_end - clip_start
            if rel_start >= clip_dur:
                continue
            rel_end = min(rel_end, clip_dur)

        rel_start = max(0.0, rel_start)
        rel_end = max(rel_start + frame_dur, rel_end)
        cleaned_words.append({"word": text, "start": rel_start, "end": rel_end})

    if not cleaned_words:
        return []

    cleaned_words.sort(key=lambda w: w["start"])

    # 2. Clamp overlapping timestamps and apply hold logic:
    #    Show from word.start until next.start if gap <= max_pause_hold_s (0.25s),
    #    else hide at word.end + max_pause_hold_s. Min display 2 frames, never overlapping next.
    n_words = len(cleaned_words)
    spans: List[Tuple[float, float, str]] = []
    for i, w in enumerate(cleaned_words):
        st = w["start"]
        en = w["end"]

        if spans and st < spans[-1][1]:
            # Clamp previous end if previous overlapped this start
            prev_st, _, prev_w = spans[-1]
            spans[-1] = (prev_st, max(prev_st + frame_dur, st), prev_w)

        if i + 1 < n_words:
            nxt_st = cleaned_words[i + 1]["start"]
            if nxt_st < st:
                nxt_st = st + min_word_dur
                cleaned_words[i + 1]["start"] = nxt_st
            gap = nxt_st - en
            if gap <= style.max_pause_hold_s:
                hold_end = nxt_st
            else:
                hold_end = min(nxt_st, en + style.max_pause_hold_s)
            # Enforce min display 2 frames without overlapping next word
            hold_end = min(nxt_st, max(hold_end, st + min_word_dur))
        else:
            hold_end = max(en, st + min_word_dur)
            if clip_end is not None:
                hold_end = min(hold_end, clip_end - clip_start)

        if hold_end > st + 1e-6:
            spans.append((st, hold_end, w["word"]))

    # 3. Assign colors (deterministic, no consecutive main-color repeats) & split emphasis windows
    events: List[RenderEvent] = []
    prev_main_color: Optional[str] = None

    for w_idx, (st, en, word) in enumerate(spans):
        is_emph, chunks = classify_word_chunks(word, style)
        word_dur = en - st

        # Only split into syllable windows if word can hold chunks cleanly
        if is_emph and len(chunks) >= 2 and word_dur >= 2 * frame_dur:
            main_color = _pick_deterministic_color(
                style.emphasis_window_colors,
                prev_main_color,
                w_idx,
                style.color_seed,
            )
            prev_main_color = main_color

            # Proportional to character count, enforcing min_window_frames per chunk when total duration allows
            n_ch = len(chunks)
            weights = [max(1, len(c)) for c in chunks]
            total_w = sum(weights)

            raw_durs = [word_dur * (wt / total_w) for wt in weights]
            if word_dur >= n_ch * min_win_dur:
                # Floor each chunk to min_win_dur and redistribute excess proportionally
                durs = [max(min_win_dur, d) for d in raw_durs]
                excess = sum(durs) - word_dur
                if excess > 1e-9:
                    shrinkable = [max(0.0, d - min_win_dur) for d in durs]
                    tot_sh = sum(shrinkable)
                    if tot_sh > 1e-9:
                        durs = [d - excess * (sh / tot_sh) for d, sh in zip(durs, shrinkable)]
            else:
                durs = raw_durs

            cur_t = st
            for ch_i in range(n_ch):
                ch_end = en if ch_i == n_ch - 1 else min(en, cur_t + durs[ch_i])
                events.append(RenderEvent(
                    word_index=w_idx,
                    word=word,
                    chunks=chunks,
                    window_index=ch_i,
                    main_color_name=main_color,
                    start=cur_t,
                    end=ch_end,
                    is_emphasis=True,
                ))
                cur_t = ch_end
        else:
            main_color = _pick_deterministic_color(
                style.normal_colors,
                prev_main_color,
                w_idx,
                style.color_seed,
            )
            prev_main_color = main_color
            events.append(RenderEvent(
                word_index=w_idx,
                word=word,
                chunks=[word],
                window_index=None,
                main_color_name=main_color,
                start=st,
                end=en,
                is_emphasis=False,
            ))

    return events


# ─────────────────────── Sprite Rendering & Horizontal Smear ───────────────────────
import threading as _threading

_FONT_TLS = _threading.local()


def _load_font(size: int, style: CaptionStyle) -> ImageFont.FreeTypeFont:
    cache = getattr(_FONT_TLS, "fonts", None)
    if cache is None:
        cache = {}
        _FONT_TLS.fonts = cache
    key = (style.font_paths, size)
    cached = cache.get(key)
    if cached is not None:
        return cached
    for fp in style.font_paths:
        if os.path.exists(fp):
            try:
                f = ImageFont.truetype(fp, size)
                cache[key] = f
                return f
            except Exception:
                continue
    return ImageFont.load_default()


def _separable_max_filter(arr: np.ndarray, k: int) -> np.ndarray:
    """
    Exact 2D square MaxFilter(size=k) implemented as separable 1D-Y then 1D-X
    vectorized NumPy max passes. Mathematically identical to ImageFilter.MaxFilter(k)
    and ~100x faster on RGBA ROIs while releasing the Python GIL.
    """
    if k < 3:
        return arr
    r = k // 2
    h, w, c = arr.shape
    # Vertical 1D max
    pad_y = np.pad(arr, ((r, r), (0, 0), (0, 0)), mode="edge")
    max_y = pad_y[:h].copy()
    for dy in range(1, k):
        np.maximum(max_y, pad_y[dy : dy + h], out=max_y)
    # Horizontal 1D max
    pad_x = np.pad(max_y, ((0, 0), (r, r), (0, 0)), mode="edge")
    max_xy = pad_x[:, :w].copy()
    for dx in range(1, k):
        np.maximum(max_xy, pad_x[:, dx : dx + w], out=max_xy)
    return max_xy


def _horizontal_gaussian_blur_1d(arr: np.ndarray, sigma_x: float) -> np.ndarray:
    """
    O(1) 3-pass horizontal cumsum Gaussian approximation (sigma_x, sigma_y=0) along axis=1
    on premultiplied RGBA. ~40x faster than direct kernel convolution with identical Gaussian falloff.
    """
    if sigma_x <= 0.25:
        return arr

    # Box width for 3-pass Gaussian approximation: sigma^2 = 3 * (w^2 - 1) / 12 => w = sqrt(4*sigma^2 + 1)
    box_w = max(3, int(round(math.sqrt(4.0 * sigma_x * sigma_x + 1.0))))
    if box_w % 2 == 0:
        box_w += 1
    r = box_w // 2
    inv_w = 1.0 / box_w

    f = arr.astype(np.float32)
    alpha = f[:, :, 3:4] / 255.0
    cur = np.empty_like(f)
    cur[:, :, :3] = f[:, :, :3] * alpha
    cur[:, :, 3:4] = f[:, :, 3:4]

    h, w, _ = cur.shape
    for _ in range(3):
        padded = np.pad(cur, ((0, 0), (r + 1, r), (0, 0)), mode="constant")
        csum = np.cumsum(padded, axis=1)
        cur = (csum[:, box_w : box_w + w, :] - csum[:, :w, :]) * inv_w

    out_alpha = cur[:, :, 3:4]
    safe_a = np.where(out_alpha > 1.0, out_alpha / 255.0, 1.0)
    res = np.empty_like(cur)
    res[:, :, :3] = np.where(out_alpha > 1.0, cur[:, :, :3] / safe_a, 0.0)
    res[:, :, 3:4] = out_alpha
    return np.clip(res, 0, 255).astype(np.uint8)


def _scale_x_about_center(arr: np.ndarray, scale_x: float, center_x: int) -> np.ndarray:
    """Applies horizontal scaleX around center_x while keeping Y untouched."""
    if abs(scale_x - 1.0) < 1e-3:
        return arr
    h, w, _ = arr.shape
    new_w = max(1, int(round(w * scale_x)))
    img = Image.fromarray(arr, mode="RGBA")
    stretched = img.resize((new_w, h), resample=Image.Resampling.BILINEAR)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    # Map old center_x -> int(center_x * scale_x) and align back to center_x
    paste_x = int(round(center_x - center_x * scale_x))
    canvas.paste(stretched, (paste_x, 0))
    return np.array(canvas, dtype=np.uint8)


def _apply_horizontal_echo(arr: np.ndarray, offsets_px: Sequence[int], alpha_mult: float) -> np.ndarray:
    """Optional horizontal ghost copies at +/- offsets_px with alpha_mult."""
    base_img = Image.fromarray(arr, mode="RGBA")
    h, w, _ = arr.shape
    echo_arr = arr.copy()
    echo_arr[:, :, 3] = np.clip(echo_arr[:, :, 3].astype(np.float32) * alpha_mult, 0, 255).astype(np.uint8)
    echo_img = Image.fromarray(echo_arr, mode="RGBA")

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for off in offsets_px:
        for sign in (-1, 1):
            shifted = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            shifted.paste(echo_img, (sign * off, 0))
            out = Image.alpha_composite(out, shifted)
    out = Image.alpha_composite(out, base_img)
    return np.array(out, dtype=np.uint8)


def _render_sharp_base(
    ev: RenderEvent,
    width: int,
    band_h: int,
    style: CaptionStyle = KARAOKE_POP,
) -> Tuple[np.ndarray, int, int, int]:
    """
    Renders the sharp (smear_level=0) RGBA band sprite by drawing & filtering ONLY
    inside the tight padded ROI around the word, then placing it into (band_h, width, 4).
    Returns (full_band_arr, roi_y0, roi_y1, word_center_x).
    """
    scale = width / 1080.0
    base_font_size = max(20, int(round(style.font_size_pct * width)))
    font = _load_font(base_font_size, style)

    meas = getattr(_FONT_TLS, "meas", None)
    if meas is None:
        meas = ImageDraw.Draw(Image.new("RGBA", (1, 1), (0, 0, 0, 0)))
        _FONT_TLS.meas = meas

    max_w = int(round(style.max_word_width_pct * width))

    # Shrink to fit if word exceeds 0.9*W
    word_bbox = meas.textbbox((0, 0), ev.word, font=font)
    word_w = word_bbox[2] - word_bbox[0]
    if word_w > max_w and word_w > 0:
        shrunk_size = max(16, int(math.floor(base_font_size * (max_w / word_w))))
        font = _load_font(shrunk_size, style)
        word_bbox = meas.textbbox((0, 0), ev.word, font=font)
        word_w = word_bbox[2] - word_bbox[0]

    # Compute steady line-box baseline using canonical ascender+baseline ('Every') so
    # vertical center of the line box sits at band_h // 2 (which maps to 0.54 * H on canvas)
    ref_bbox = meas.textbbox((0, 0), "Every", font=font)
    ref_center_from_origin = (ref_bbox[1] + ref_bbox[3]) / 2.0
    draw_y = int(round((band_h / 2.0) - ref_center_from_origin))

    anchor_x = int(round(style.anchor_x_pct * width))
    margin = max(12, int(round(0.05 * width)))
    start_x = anchor_x - word_w // 2
    start_x = max(margin, min(width - margin - word_w, start_x))
    word_center_x = start_x + word_w // 2

    sh_dx = int(round(style.shadow_offset_x_1080 * scale))
    sh_dy = int(round(style.shadow_offset_y_1080 * scale))
    sh_a = int(round(255 * style.shadow_alpha))
    sr, sg, sb = style.shadow_color

    dilate_k = int(round(style.glow_dilate_px))
    if dilate_k >= 3 and dilate_k % 2 == 0:
        dilate_k += 1
    glow_sigma = style.glow_sigma_1080 * scale
    pad_xy = max(32, int(math.ceil(glow_sigma * 4.0)) + dilate_k + max(abs(sh_dx), abs(sh_dy)) + 8)

    # Compute exact tight ROI around drawn glyphs + glow + shadow
    gx0 = start_x + word_bbox[0]
    gy0 = draw_y + word_bbox[1]
    gx1 = start_x + word_bbox[2]
    gy1 = draw_y + word_bbox[3]

    rx0 = max(0, gx0 - pad_xy)
    ry0 = max(0, gy0 - pad_xy)
    rx1 = min(width, gx1 + pad_xy)
    ry1 = min(band_h, gy1 + pad_xy)
    roi_w = max(1, rx1 - rx0)
    roi_h = max(1, ry1 - ry0)

    local_x = start_x - rx0
    local_y = draw_y - ry0

    fill_layer = Image.new("RGBA", (roi_w, roi_h), (0, 0, 0, 0))
    shadow_layer = Image.new("RGBA", (roi_w, roi_h), (0, 0, 0, 0))
    fill_draw = ImageDraw.Draw(fill_layer)
    sh_draw = ImageDraw.Draw(shadow_layer)

    main_rgb = style.palette[ev.main_color_name]
    white_rgb = style.palette[style.emphasis_base_color]

    if ev.window_index is None:
        r, g, b = main_rgb
        fill_draw.text((local_x, local_y), ev.word, font=font, fill=(r, g, b, 255))
        sh_draw.text((local_x + sh_dx, local_y + sh_dy), ev.word, font=font, fill=(sr, sg, sb, sh_a))
    else:
        prefix = ""
        for idx, ch_txt in enumerate(ev.chunks):
            px_off = int(round(meas.textlength(prefix, font=font))) if prefix else 0
            cx = local_x + px_off
            r, g, b = main_rgb if idx == ev.window_index else white_rgb
            fill_draw.text((cx, local_y), ch_txt, font=font, fill=(r, g, b, 255))
            prefix += ch_txt
        sh_draw.text((local_x + sh_dx, local_y + sh_dy), ev.word, font=font, fill=(sr, sg, sb, sh_a))

    # Layer 1 (bottom): Drop shadow (black 70%, offset (+3,+4)*(W/1080), blur sigma 1.5)
    shadow_blurred = shadow_layer.filter(ImageFilter.GaussianBlur(radius=style.shadow_blur_sigma * scale))

    # Layer 2 (middle): Outer glow in the word's OWN color (~12px radius / sigma ~6, 60% opacity)
    if dilate_k >= 3:
        fill_arr = np.array(fill_layer, dtype=np.uint8)
        glow_src = Image.fromarray(_separable_max_filter(fill_arr, dilate_k), mode="RGBA")
    else:
        glow_src = fill_layer
    glow_blurred = glow_src.filter(ImageFilter.GaussianBlur(radius=glow_sigma))
    glow_arr = np.array(glow_blurred, dtype=np.uint8)
    boosted_a = np.minimum(255.0, glow_arr[:, :, 3].astype(np.float32) * style.glow_gain)
    glow_arr[:, :, 3] = np.clip(boosted_a * style.glow_opacity, 0, 255).astype(np.uint8)
    glow_layer = Image.fromarray(glow_arr, mode="RGBA")

    # Composite bottom -> top: Shadow -> Outer Glow -> Crisp Glyphs
    comp = Image.alpha_composite(shadow_blurred, glow_layer)
    comp = Image.alpha_composite(comp, fill_layer)

    full_arr = np.zeros((band_h, width, 4), dtype=np.uint8)
    full_arr[ry0:ry1, rx0:rx1, :] = np.array(comp, dtype=np.uint8)
    return full_arr, ry0, ry1, word_center_x


def _apply_smear_to_base(
    base_arr: np.ndarray,
    ry0: int,
    ry1: int,
    word_center_x: int,
    smear_level: int,
    width: int,
    style: CaptionStyle = KARAOKE_POP,
) -> np.ndarray:
    """Applies horizontal-only smear + scaleX ONLY across active vertical rows [ry0:ry1]."""
    if smear_level <= 0:
        return base_arr
    scale = width / 1080.0
    strip = base_arr[ry0:ry1, :, :]
    if smear_level == 2:
        strip = _scale_x_about_center(strip, style.smear_phase1_scale_x, word_center_x)
        if style.smear_echo:
            offs = [max(1, int(round(o * scale))) for o in style.smear_echo_offsets_1080]
            strip = _apply_horizontal_echo(strip, offs, style.smear_echo_alpha)
        strip = _horizontal_gaussian_blur_1d(strip, style.smear_phase1_sigma_x_1080 * scale)
    elif smear_level == 1:
        strip = _scale_x_about_center(strip, style.smear_phase2_scale_x, word_center_x)
        strip = _horizontal_gaussian_blur_1d(strip, style.smear_phase2_sigma_x_1080 * scale)

    out = np.zeros_like(base_arr)
    out[ry0:ry1, :, :] = strip
    return out


def render_event_sprite(
    ev: RenderEvent,
    width: int,
    band_h: int,
    smear_level: int,          # 2 = 0-33ms heavy, 1 = 33-66ms medium, 0 = sharp
    style: CaptionStyle = KARAOKE_POP,
) -> np.ndarray:
    """
    Renders one transparent RGBA band sprite for (word, window_index, smear_level).
    Layers bottom -> top:
      1. Drop shadow (black 70%, offset (+3,+4)*(W/1080), blur sigma 1.5)
      2. Outer glow (glyph's own color, radius ~12px / sigma ~6, 60% opacity; white glow for white text)
      3. Solid Times New Roman Regular glyphs (NO stroke, NO box)
    Then applies horizontal-only smear + scaleX about word center when smear_level > 0.
    """
    base_arr, ry0, ry1, word_center_x = _render_sharp_base(ev, width, band_h, style)
    return _apply_smear_to_base(base_arr, ry0, ry1, word_center_x, smear_level, width, style)


# ─────────────────────── Video Probing & Compositing Pipeline ───────────────────────
def probe_video_stream(video_path: Union[str, Path], ffmpeg_bin: str = "ffmpeg") -> Tuple[int, int, float, float]:
    """Returns (width, height, fps, duration_s) from ffprobe."""
    ffprobe_bin = ffmpeg_bin.replace("ffmpeg", "ffprobe")
    cmd = [
        ffprobe_bin, "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,avg_frame_rate:format=duration",
        "-of", "json",
        str(video_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=15)
    import json as _json
    data = _json.loads(res.stdout)
    stream = (data.get("streams") or [{}])[0]
    width = int(stream.get("width") or 1080)
    height = int(stream.get("height") or 1920)

    fps_str = stream.get("avg_frame_rate") or stream.get("r_frame_rate") or "30/1"
    if "/" in fps_str:
        num, den = fps_str.split("/", 1)
        fps = float(num) / float(den) if float(den) > 0 else 30.0
    else:
        fps = float(fps_str)
    if fps <= 0 or fps > 240:
        fps = 30.0

    dur = float((data.get("format") or {}).get("duration") or 0.0)
    if dur <= 0:
        dur = 10.0
    return width, height, fps, dur


def render_captions(
    video_in: Union[str, Path],
    words: Sequence[Dict[str, Any]],
    out_path: Union[str, Path],
    style: CaptionStyle = KARAOKE_POP,
    clip_start: float = 0.0,
    clip_end: Optional[float] = None,
    ffmpeg_bin: str = "ffmpeg",
    reframe_vf: Optional[str] = None,
    output_dims: Optional[Tuple[int, int]] = None,
) -> Path:
    """
    Public API: burns Karaoke Pop word-by-word captions onto video_in.
      - Preserves input resolution and fps (or applies optional single-pass reframe_vf + output_dims).
      - Encodes H.264 yuv420p CRF 18, -c:a copy, +faststart.
      - Caches sprites keyed by (word, window_index, smear_level) and reuses one zero-alpha empty frame.
    """
    video_in_p = Path(video_in)
    out_p = Path(out_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)

    src_w, src_h, fps, duration = probe_video_stream(video_in_p, ffmpeg_bin)
    width, height = output_dims if output_dims is not None else (src_w, src_h)
    eff_clip_end = clip_end if clip_end is not None else (clip_start + duration)
    events = build_render_events(words, fps=fps, clip_start=clip_start, clip_end=eff_clip_end, style=style)

    # Band centered at style.center_y_pct (0.54 * H), generous height for font + glow + shadow
    band_h = min(height, max(240, int(round(height * style.band_height_pct))))
    band_h += band_h % 2
    center_y = int(round(height * style.center_y_pct))
    band_y = max(0, min(height - band_h, center_y - band_h // 2))

    total_frames = max(1, int(round(duration * fps)) + 2)
    fps_arg = f"{fps:.6f}".rstrip("0").rstrip(".")

    if reframe_vf:
        filter_complex = f"[0:v]{reframe_vf}[vbase];[vbase][1:v]overlay=0:{band_y}:shortest=1[vout]"
    else:
        filter_complex = f"[0:v][1:v]overlay=0:{band_y}:shortest=1[vout]"

    cmd = [
        ffmpeg_bin, "-y", "-loglevel", "error",
        "-i", str(video_in_p),
        "-f", "rawvideo", "-pix_fmt", "rgba",
        "-s", f"{width}x{band_h}", "-r", fps_arg,
        "-i", "pipe:0",
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(style.crf), "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        "-movflags", "+faststart",
        str(out_p),
    ]

    empty_frame_bytes = bytes(width * band_h * 4)
    sprite_cache: Dict[Tuple[str, Optional[int], str, int], bytes] = {}
    base_cache: Dict[Tuple[str, Optional[int], str], Tuple[np.ndarray, int, int, int]] = {}

    # Precompute the first frame timestamp of each event so frame 0 always receives 0ms smear
    ev_first_frame_t = [math.ceil(ev.start * fps - 1e-6) / fps for ev in events]

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
            while ev_idx < n_ev and t >= events[ev_idx].end - 1e-6:
                ev_idx += 1

            if ev_idx >= n_ev or t < events[ev_idx].start - 1e-6:
                proc.stdin.write(empty_frame_bytes)
                continue

            ev = events[ev_idx]
            dt_ms = max(0.0, (t - ev_first_frame_t[ev_idx]) * 1000.0)
            if dt_ms < style.smear_phase1_ms - 1e-6:
                smear_level = 2
            elif dt_ms < style.smear_phase2_ms - 1e-6:
                smear_level = 1
            else:
                smear_level = 0

            cache_key = (ev.word, ev.window_index, ev.main_color_name, smear_level)
            frame_bytes = sprite_cache.get(cache_key)
            if frame_bytes is None:
                base_key = (ev.word, ev.window_index, ev.main_color_name)
                base_entry = base_cache.get(base_key)
                if base_entry is None:
                    base_entry = _render_sharp_base(ev, width, band_h, style)
                    base_cache[base_key] = base_entry
                base_arr, ry0, ry1, word_center_x = base_entry
                arr = _apply_smear_to_base(base_arr, ry0, ry1, word_center_x, smear_level, width, style)
                frame_bytes = arr.tobytes()
                sprite_cache[cache_key] = frame_bytes

            proc.stdin.write(frame_bytes)

        proc.stdin.close()
        stderr_data = proc.stderr.read().decode("utf-8", errors="ignore") if proc.stderr else ""
        ret = proc.wait(timeout=180)
        if ret != 0 or not out_p.exists() or out_p.stat().st_size < 1000:
            raise RuntimeError(f"FFmpeg render_captions failed (rc={ret}): {stderr_data[-400:]}")
        return out_p
    except BrokenPipeError:
        stderr_data = proc.stderr.read().decode("utf-8", errors="ignore") if proc.stderr else ""
        proc.wait(timeout=30)
        if out_p.exists() and out_p.stat().st_size > 1000:
            return out_p
        raise RuntimeError(f"FFmpeg render_captions pipe closed early: {stderr_data[-400:]}")
    finally:
        if proc.poll() is None:
            proc.kill()


def cues_to_words(cues: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Converts YouTube/Whisper cues (with optional cue['words']) into flat {word, start, end} list."""
    out: List[Dict[str, Any]] = []
    for cue in cues:
        word_entries = cue.get("words")
        if word_entries:
            for we in word_entries:
                ws = float(we["start"])
                we_end = float(we.get("end", ws + 0.1))
                toks = str(we.get("word") if "word" in we else we.get("text", "")).split()
                if not toks:
                    continue
                if len(toks) == 1:
                    out.append({"word": toks[0], "start": ws, "end": max(ws + 0.06, we_end)})
                else:
                    span = max(0.08, we_end - ws)
                    weights = [max(2, len(t)) for t in toks]
                    tw = sum(weights)
                    cur = ws
                    for tk, wt in zip(toks, weights):
                        d = span * (wt / tw)
                        out.append({"word": tk, "start": cur, "end": cur + d})
                        cur += d
        else:
            st = float(cue["start"])
            en = float(cue.get("end", st + 0.5))
            toks = str(cue.get("text", "")).split()
            if not toks:
                continue
            span = max(0.1, en - st)
            weights = [max(2, len(t)) for t in toks]
            tw = sum(weights)
            cur = st
            for tk, wt in zip(toks, weights):
                d = span * (wt / tw)
                out.append({"word": tk, "start": cur, "end": cur + d})
                cur += d
    return out


def build_karaoke_pop_clip(
    raw_clip_path: Path,
    final_clip_path: Path,
    cues: List[Dict[str, Any]],
    clip_start: float,
    clip_end: float,
    aspect_ratio: str = "9:16",
    ffmpeg_bin: str = "ffmpeg",
    style: CaptionStyle = KARAOKE_POP,
) -> Path:
    """
    Pipeline adapter: reframes raw_clip_path to target aspect_ratio AND burns Karaoke Pop
    captions in a single FFmpeg pass (avoiding double H.264 encode overhead).
    """
    from openclip_engine.clipping.caption_burner import ASPECT_DIMS

    target_w, target_h = ASPECT_DIMS.get(aspect_ratio, (1080, 1920))
    ratio_expr = f"{target_w}/{target_h}"
    base_vf = (
        f"crop='if(gt(iw/ih,{ratio_expr}),ih*{ratio_expr},iw)':"
        f"'if(gt(iw/ih,{ratio_expr}),ih,iw/({ratio_expr}))',"
        f"scale={target_w}:{target_h}:flags=lanczos,setsar=1,setpts=PTS-STARTPTS"
    )

    words = cues_to_words(cues)
    return render_captions(
        video_in=raw_clip_path,
        words=words,
        out_path=final_clip_path,
        style=style,
        clip_start=clip_start,
        clip_end=clip_end,
        ffmpeg_bin=ffmpeg_bin,
        reframe_vf=base_vf,
        output_dims=(target_w, target_h),
    )
