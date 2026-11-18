from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from openclip_engine.clipping.config_styles import CaptionStyle, KARAOKE_POP

cv2: Any = None
try:
    import cv2 as _cv2  # type: ignore
    cv2 = _cv2
    _HAS_CV2 = True
except Exception:
    _HAS_CV2 = False


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
      - Silent final 'e' after a consonant is dropped when >= 2 nuclei exist.
      - Digraphs (th, ch, sh, ph, wh, ck, ng) stay together.
      - Boundary before a single intervening consonant unit, between two consonant units otherwise.
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
        if ch in ("y", "Y") and idx == 0 and len(core) > 1 and core[1] in set("aeiouAEIOU"):
            return False
        return True

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
                cut_points.append(prev_end)
            else:
                cut_points.append(prev_end + len(units[0]))
    cut_points.append(n)

    chunks = [core[cut_points[j] : cut_points[j + 1]] for j in range(len(cut_points) - 1)]
    chunks = [c for c in chunks if c] or [core]
    if trailing:
        chunks[-1] += trailing
    return chunks


def clean_word_text(raw: str, normalize_casing: bool = False, is_sentence_start: bool = False) -> str:
    """Keep transcript casing and ? ! ' - ; strip zero-width chars and trailing . , ; :"""
    w = re.sub(r"[\u200b\u200c\u200d\ufeff\u2060]+", "", raw).strip()
    if not w:
        return ""
    w = w.strip('"\u201c\u201d\u2018\u2019()[]')
    if normalize_casing:
        # Remove stray "---" / "--" / "..." truncation markers and collapse repeated punctuation
        w = re.sub(r"-{2,}", "", w)
        w = re.sub(r"\.{2,}", "", w)
        w = re.sub(r"\?{2,}", "?", w)
        w = re.sub(r"!{2,}", "!", w)
        w = w.replace("?!?", "?!")
        w = re.sub(r"[.,;:]+$", "", w)
        w = re.sub(r"^[.,;:]+", "", w)
        # Collapse 3+ consecutive identical letters from stretched yells ("hereee" -> "here", "Nooo" -> "No")
        w = re.sub(r"([a-zA-Z])\1{2,}", r"\1", w)
        if not w:
            return ""
        # Sentence case; allow ALL CAPS only for deliberate shouted emphasis (e.g. "WHAT?!")
        letters = re.sub(r"[^a-zA-Z]+", "", w)
        is_deliberate_caps = (
            len(letters) >= 3
            and letters.isupper()
            and ("?!" in w or w.endswith("!"))
            and letters in {"WHAT", "STOP", "WAIT", "RUN", "NO"}
        )
        if not is_deliberate_caps:
            low = w.lower()
            if low in {"i", "i'm", "i'll", "i've", "i'd"}:
                w = "I" + low[1:]
            elif is_sentence_start:
                w = low[0].upper() + low[1:]
            elif low == "t" or re.fullmatch(r"t[?!,]*", low):
                w = "T" + low[1:]
            else:
                w = low
        return w

    w = re.sub(r"[.,;:]+$", "", w)
    w = re.sub(r"^[.,;:]+", "", w)
    return w


def is_acronym(word: str, style: CaptionStyle = KARAOKE_POP) -> bool:
    core = re.sub(r"[?!'\-]+$", "", word)
    if not core.isalpha():
        return False
    if not (style.acronym_min_len <= len(core) <= style.acronym_max_len):
        return False
    if not core.isupper():
        return False
    return not _is_english_word(core.lower())


def classify_word_chunks(word: str, style: CaptionStyle = KARAOKE_POP) -> Tuple[bool, List[str]]:
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
    allowed = [c for c in candidates if c != exclude] or list(candidates)
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
    frame_dur = 1.0 / max(1.0, fps)
    min_word_dur = style.min_display_frames * frame_dur
    min_win_dur = style.min_window_frames * frame_dur
    sync_s = style.caption_sync_offset_ms / 1000.0

    cleaned_words: List[Dict[str, Any]] = []
    next_sent_start = True
    for item in words:
        raw_text = str(item.get("word") if "word" in item else item.get("text", "")).strip()
        if not raw_text:
            continue
        raw_ends_sentence = bool(re.search(r"[.?!\u2026][\"'\u201d\u2019)\]]*$", raw_text))
        raw_ends_clause = raw_ends_sentence or bool(re.search(r"[,;:][\"'\u201d\u2019)\]]*$", raw_text))
        text = clean_word_text(
            raw_text,
            normalize_casing=style.normalize_casing,
            is_sentence_start=next_sent_start,
        )
        if not text:
            continue
        src_start = float(item["start"])
        src_end = float(item.get("end", src_start + min_word_dur))

        # Skip any word whose start is before clip_start (no stray smeared frame at 0.00s)
        if src_start < clip_start - 1e-6:
            next_sent_start = raw_ends_sentence
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
        cleaned_words.append({
            "word": text,
            "start": rel_start,
            "end": rel_end,
            "ends_sentence": raw_ends_sentence,
            "ends_clause": raw_ends_clause,
        })
        next_sent_start = raw_ends_sentence

    if not cleaned_words:
        return []

    cleaned_words.sort(key=lambda w: w["start"])

    n_words = len(cleaned_words)
    spans: List[Tuple[float, float, str, bool, bool]] = []
    for i, w in enumerate(cleaned_words):
        st = w["start"]
        en = w["end"]

        if spans and st < spans[-1][1]:
            prev_st, _, prev_w, prev_es, prev_ec = spans[-1]
            spans[-1] = (prev_st, max(prev_st + frame_dur, st), prev_w, prev_es, prev_ec)

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
            hold_end = min(nxt_st, max(hold_end, st + min_word_dur))
        else:
            hold_end = max(en, st + min_word_dur)
            if clip_end is not None:
                hold_end = min(hold_end, clip_end - clip_start)

        if hold_end > st + 1e-6:
            spans.append((st, hold_end, w["word"], bool(w.get("ends_sentence")), bool(w.get("ends_clause"))))

    # Phrase-chunked mode (2-4 words at a time, >= 0.4s per chunk where pace allows, active word highlighted)
    if style.chunk_mode == "phrase":
        min_w = max(1, style.chunk_min_words)
        max_w = max(min_w, style.chunk_max_words)
        min_chunk_dur = max(0.15, style.chunk_min_duration_s)

        # Split into natural sentences/clauses first, then subdivide into balanced 2-4 word chunks (never 4+1 orphans!)
        clauses: List[List[Tuple[float, float, str, bool, bool]]] = []
        cur_cl: List[Tuple[float, float, str, bool, bool]] = []
        for sp in spans:
            if cur_cl and (sp[0] - cur_cl[-1][1]) > 0.35:
                clauses.append(cur_cl)
                cur_cl = []
            cur_cl.append(sp)
            if sp[3] or (sp[4] and len(cur_cl) >= min_w):
                clauses.append(cur_cl)
                cur_cl = []
        if cur_cl:
            clauses.append(cur_cl)

        groups: List[List[Tuple[float, float, str, bool, bool]]] = []
        for cl in clauses:
            n_cl = len(cl)
            if n_cl <= max_w:
                groups.append(cl)
            else:
                # Balanced split into chunks of size 2..max_w (e.g. 5 -> 2+3, 6 -> 3+3, 7 -> 4+3, 9 -> 3+3+3)
                n_chunks = int(math.ceil(n_cl / float(max_w)))
                base = n_cl // n_chunks
                rem = n_cl % n_chunks
                pos = 0
                for ci in range(n_chunks):
                    sz = base + (1 if ci < rem else 0)
                    groups.append(cl[pos : pos + sz])
                    pos += sz

        # Merge any 1-word orphan or sub-min_chunk_dur group into a neighbor (staying <= max_w + 1)
        merged: List[List[Tuple[float, float, str, bool, bool]]] = []
        for grp in groups:
            g_dur = grp[-1][1] - grp[0][0]
            if merged and (len(grp) < min_w or g_dur < min_chunk_dur) and len(merged[-1]) + len(grp) <= max_w:
                merged[-1].extend(grp)
            elif merged and len(grp) == 1 and len(merged[-1]) == max_w:
                # Rebalance 4 + 1 -> 3 + 2 so no orphan word flickers alone
                moved = merged[-1].pop()
                merged.append([moved, grp[0]])
            else:
                merged.append(grp)

        events_ph: List[RenderEvent] = []
        active_col = style.active_word_color
        w_cursor = 0
        for grp in merged:
            chunk_words = [s[2] for s in grp]
            phrase_str = " ".join(chunk_words)
            for local_i, (st, en, _, _, _) in enumerate(grp):
                events_ph.append(RenderEvent(
                    word_index=w_cursor,
                    word=phrase_str,
                    chunks=chunk_words,
                    window_index=local_i,
                    main_color_name=active_col,
                    start=st,
                    end=en,
                    is_emphasis=True,
                ))
                w_cursor += 1
        return events_ph

    events: List[RenderEvent] = []
    prev_main_color: Optional[str] = None

    for w_idx, (st, en, word, _, _) in enumerate(spans):
        is_emph, chunks = classify_word_chunks(word, style)
        word_dur = en - st

        if is_emph and style.highlight_unit == "word":
            # M6c highlight_unit="word": emphasis word renders as one solid highlight color
            main_color = _pick_deterministic_color(
                style.emphasis_window_colors,
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
                is_emphasis=True,
            ))
        elif is_emph and len(chunks) >= 2 and word_dur >= 2 * frame_dur:
            main_color = _pick_deterministic_color(
                style.emphasis_window_colors,
                prev_main_color,
                w_idx,
                style.color_seed,
            )
            prev_main_color = main_color

            n_ch = len(chunks)
            weights = [max(1, len(c)) for c in chunks]
            total_w = sum(weights)
            raw_durs = [word_dur * (wt / total_w) for wt in weights]
            if word_dur >= n_ch * min_win_dur:
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


# ─────────────────────── Fast Gaussian / Dilation / Compositing Primitives ───────────────────────
_FONT_TLS = threading.local()
_SPRITE_MEM_CACHE: Dict[str, Path] = {}
_SPRITE_LOCK = threading.Lock()


def _load_font(size: int, font_paths: Sequence[str]) -> Union[ImageFont.FreeTypeFont, ImageFont.ImageFont]:
    cache = getattr(_FONT_TLS, "fonts", None)
    if cache is None:
        cache = {}
        _FONT_TLS.fonts = cache
    key = (tuple(font_paths), size)
    cached = cache.get(key)
    if cached is not None:
        return cached
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                f = ImageFont.truetype(fp, size)
                cache[key] = f
                return f
            except Exception:
                continue
    return ImageFont.load_default()


def _get_meas_draw() -> ImageDraw.ImageDraw:
    meas = getattr(_FONT_TLS, "meas", None)
    if meas is None:
        meas = ImageDraw.Draw(Image.new("RGBA", (1, 1), (0, 0, 0, 0)))
        _FONT_TLS.meas = meas
    return meas


def _separable_max_filter_2d(mask_u8: np.ndarray, k: int) -> np.ndarray:
    """Exact 2D square max filter on a 2D uint8 alpha mask via separable 1D Y then X."""
    if k < 3:
        return mask_u8
    r = k // 2
    h, w = mask_u8.shape
    pad_y = np.pad(mask_u8, ((r, r), (0, 0)), mode="edge")
    max_y = pad_y[:h].copy()
    for dy in range(1, k):
        np.maximum(max_y, pad_y[dy : dy + h], out=max_y)
    pad_x = np.pad(max_y, ((0, 0), (r, r)), mode="edge")
    max_xy = pad_x[:, :w].copy()
    for dx in range(1, k):
        np.maximum(max_xy, pad_x[:, dx : dx + w], out=max_xy)
    return max_xy


def _blur_mask_2d(mask_u8: np.ndarray, sigma: float) -> np.ndarray:
    """Fast 2D Gaussian blur on a single-channel uint8 mask (cv2 if present, else Pillow)."""
    if sigma <= 0.15:
        return mask_u8
    if _HAS_CV2:
        k = max(3, int(round(sigma * 6)) | 1)
        return cv2.GaussianBlur(mask_u8, (k, k), sigmaX=sigma, sigmaY=sigma, borderType=cv2.BORDER_CONSTANT)
    return np.array(Image.fromarray(mask_u8, mode="L").filter(ImageFilter.GaussianBlur(radius=sigma)), dtype=np.uint8)


def _alpha_over(dst: np.ndarray, src: np.ndarray) -> np.ndarray:
    """Normal alpha-over composite (src over dst) in float32 premultiplied space -> uint8 RGBA."""
    sa = src[:, :, 3:4].astype(np.float32) * (1.0 / 255.0)
    da = dst[:, :, 3:4].astype(np.float32) * (1.0 / 255.0)
    inv_sa = 1.0 - sa
    out_a = sa + da * inv_sa
    safe_a = np.where(out_a > 1e-6, out_a, 1.0)
    out_rgb = (src[:, :, :3].astype(np.float32) * sa + dst[:, :, :3].astype(np.float32) * da * inv_sa) / safe_a
    out = np.empty_like(dst)
    out[:, :, :3] = np.clip(np.where(out_a > 1e-6, out_rgb, 0.0), 0, 255).astype(np.uint8)
    out[:, :, 3:4] = np.clip(out_a * 255.0, 0, 255).astype(np.uint8)
    return out


def _make_colored_layer(rgb: Tuple[int, int, int], alpha_u8: np.ndarray) -> np.ndarray:
    """Creates a pure saturated RGB RGBA array with the given uint8 alpha mask."""
    h, w = alpha_u8.shape
    layer = np.empty((h, w, 4), dtype=np.uint8)
    layer[:, :, 0] = rgb[0]
    layer[:, :, 1] = rgb[1]
    layer[:, :, 2] = rgb[2]
    layer[:, :, 3] = alpha_u8
    return layer


def build_two_layer_glow(
    mask_u8: np.ndarray,
    rgb: Tuple[int, int, int],
    scale: float,
    wide_sigma_1080: float,
    wide_alpha: float,
    wide_gain: float,
    tight_sigma_1080: float,
    tight_alpha: float,
    tight_gain: float,
    dilate_px: int = 5,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Produces (wide_glow_rgba, tight_glow_rgba) in pure saturated `rgb` for normal alpha-over.
      - Wide glow: glyph alpha blurred sigma ~9px, alpha 0.65
      - Tight glow: glyph alpha blurred sigma ~3px, alpha 0.90
    """
    dil_k = int(round(dilate_px * scale))
    if dil_k >= 3:
        if dil_k % 2 == 0:
            dil_k += 1
        wide_src = _separable_max_filter_2d(mask_u8, dil_k)
    else:
        wide_src = mask_u8

    wide_blur = _blur_mask_2d(wide_src, wide_sigma_1080 * scale).astype(np.float32)
    wide_a = np.clip(np.minimum(255.0, wide_blur * wide_gain) * wide_alpha, 0, 255).astype(np.uint8)

    tight_blur = _blur_mask_2d(mask_u8, tight_sigma_1080 * scale).astype(np.float32)
    tight_a = np.clip(np.minimum(255.0, tight_blur * tight_gain) * tight_alpha, 0, 255).astype(np.uint8)

    return _make_colored_layer(rgb, wide_a), _make_colored_layer(rgb, tight_a)


def build_three_layer_glow(
    mask_u8: np.ndarray,
    rgb: Tuple[int, int, int],
    scale: float,
    style: CaptionStyle,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    M6c 3-layer glow in pure saturated `rgb` (normal alpha-over, never screen/add):
      - HALO : sigma 26 * scale * glow_spread_scale, alpha 0.35 * glow_alpha_scale
      - WIDE : sigma 16 * scale * glow_spread_scale, alpha 0.80 * glow_alpha_scale
      - TIGHT: sigma 4  * scale * glow_spread_scale, alpha 0.75 * glow_alpha_scale
    """
    sp = scale * style.glow_spread_scale
    al = style.glow_alpha_scale
    dil_k = int(round(style.glow_dilate_px * scale))
    if dil_k >= 3:
        if dil_k % 2 == 0:
            dil_k += 1
        dil_mask = _separable_max_filter_2d(mask_u8, dil_k)
    else:
        dil_mask = mask_u8

    halo_blur = _blur_mask_2d(dil_mask, style.halo_glow_sigma_1080 * sp).astype(np.float32)
    halo_a = np.clip(np.minimum(255.0, halo_blur * style.halo_glow_gain) * (style.halo_glow_alpha * al), 0, 255).astype(np.uint8)

    wide_blur = _blur_mask_2d(dil_mask, style.wide_glow_sigma_1080 * sp).astype(np.float32)
    wide_a = np.clip(np.minimum(255.0, wide_blur * style.wide_glow_gain) * (style.wide_glow_alpha * al), 0, 255).astype(np.uint8)

    tight_blur = _blur_mask_2d(mask_u8, style.tight_glow_sigma_1080 * sp).astype(np.float32)
    tight_a = np.clip(np.minimum(255.0, tight_blur * style.tight_glow_gain) * (style.tight_glow_alpha * al), 0, 255).astype(np.uint8)

    return (
        _make_colored_layer(rgb, halo_a),
        _make_colored_layer(rgb, wide_a),
        _make_colored_layer(rgb, tight_a),
    )


def _build_three_layer_shadow(
    roi_w: int,
    roi_h: int,
    local_x: int,
    local_y: int,
    word: str,
    font: Any,
    scale: float,
    style: CaptionStyle,
) -> np.ndarray:
    """
    M6c 3-layer bottom shadow (all scaled by W/1080 and shadow_scale):
      1. Ambient dark halo: sigma 14, alpha 0.35, offset (0, +4)
      2. Drop shadow:       sigma 3.0, alpha 0.85, offset (+5, +7)
      3. Contact shadow:    sigma 1.0, alpha 0.60, offset (+2, +3)
    """
    if not style.shadow_enabled or style.shadow_scale <= 0.0:
        return np.zeros((roi_h, roi_w, 4), dtype=np.uint8)

    ss = style.shadow_scale
    # Base glyph silhouette drawn once at (local_x, local_y) -> shifted by integer slices for speed
    base_img = Image.new("L", (roi_w, roi_h), 0)
    ImageDraw.Draw(base_img).text((local_x, local_y), word, font=font, fill=255)
    base_m = np.array(base_img, dtype=np.uint8)

    def _shift_mask(m: np.ndarray, dx: int, dy: int) -> np.ndarray:
        out = np.zeros_like(m)
        sy0 = max(0, -dy)
        dy0 = max(0, dy)
        h_cp = roi_h - abs(dy)
        sx0 = max(0, -dx)
        dx0 = max(0, dx)
        w_cp = roi_w - abs(dx)
        if h_cp > 0 and w_cp > 0:
            out[dy0 : dy0 + h_cp, dx0 : dx0 + w_cp] = m[sy0 : sy0 + h_cp, sx0 : sx0 + w_cp]
        return out

    # 1. Ambient dark halo
    amb_m = _shift_mask(
        base_m,
        int(round(style.ambient_shadow_offset_x_1080 * scale)),
        int(round(style.ambient_shadow_offset_y_1080 * scale)),
    )
    amb_blur = _blur_mask_2d(amb_m, style.ambient_shadow_sigma_1080 * scale).astype(np.float32)
    amb_a = np.clip(np.minimum(255.0, amb_blur * style.ambient_shadow_gain) * (style.ambient_shadow_alpha * ss), 0, 255).astype(np.uint8)
    comp = _make_colored_layer(style.shadow_color, amb_a)

    # 2. Drop shadow (dilated slightly for grounded serif shadow presence)
    sh_dil_k = int(round(style.shadow_dilate_px * scale))
    if sh_dil_k >= 3:
        if sh_dil_k % 2 == 0:
            sh_dil_k += 1
        drop_src = _separable_max_filter_2d(base_m, sh_dil_k)
    else:
        drop_src = base_m
    drop_m = _shift_mask(
        drop_src,
        int(round(style.shadow_offset_x_1080 * scale)),
        int(round(style.shadow_offset_y_1080 * scale)),
    )
    drop_blur = _blur_mask_2d(drop_m, style.shadow_blur_sigma * scale).astype(np.float32)
    drop_a = np.clip(np.minimum(255.0, drop_blur * style.shadow_gain) * (style.shadow_alpha * ss), 0, 255).astype(np.uint8)
    comp = _alpha_over(comp, _make_colored_layer(style.shadow_color, drop_a))

    # 3. Contact shadow
    con_m = _shift_mask(
        base_m,
        int(round(style.contact_shadow_offset_x_1080 * scale)),
        int(round(style.contact_shadow_offset_y_1080 * scale)),
    )
    con_blur = _blur_mask_2d(con_m, style.contact_shadow_sigma_1080 * scale).astype(np.float32)
    con_a = np.clip(con_blur * (style.contact_shadow_alpha * ss), 0, 255).astype(np.uint8)
    comp = _alpha_over(comp, _make_colored_layer(style.shadow_color, con_a))
    return comp


def horizontal_gaussian_blur_1d(arr: np.ndarray, sigma_x: float) -> np.ndarray:
    """Horizontal-only Gaussian blur (sigma_x, sigma_y=0) on premultiplied RGBA."""
    if sigma_x <= 0.25:
        return arr

    if _HAS_CV2:
        f = arr.astype(np.float32)
        a = f[:, :, 3:4] * (1.0 / 255.0)
        premul = np.empty_like(f)
        premul[:, :, :3] = f[:, :, :3] * a
        premul[:, :, 3:4] = f[:, :, 3:4]
        kx = max(3, int(round(sigma_x * 6)) | 1)
        blurred = cv2.GaussianBlur(premul, (kx, 1), sigmaX=sigma_x, sigmaY=0, borderType=cv2.BORDER_CONSTANT)
        oa = blurred[:, :, 3:4]
        safe_a = np.where(oa > 1.0, oa * (1.0 / 255.0), 1.0)
        out = np.empty_like(blurred)
        out[:, :, :3] = np.where(oa > 1.0, blurred[:, :, :3] / safe_a, 0.0)
        out[:, :, 3:4] = oa
        return np.clip(out, 0, 255).astype(np.uint8)

    box_w = max(3, int(round(math.sqrt(4.0 * sigma_x * sigma_x + 1.0))))
    if box_w % 2 == 0:
        box_w += 1
    r = box_w // 2
    inv_w = 1.0 / box_w

    f = arr.astype(np.float32)
    alpha = f[:, :, 3:4] * (1.0 / 255.0)
    cur = np.empty_like(f)
    cur[:, :, :3] = f[:, :, :3] * alpha
    cur[:, :, 3:4] = f[:, :, 3:4]

    _, w, _ = cur.shape
    for _ in range(3):
        padded = np.pad(cur, ((0, 0), (r + 1, r), (0, 0)), mode="constant")
        csum = np.cumsum(padded, axis=1)
        cur = (csum[:, box_w : box_w + w, :] - csum[:, :w, :]) * inv_w

    out_alpha = cur[:, :, 3:4]
    safe_a = np.where(out_alpha > 1.0, out_alpha * (1.0 / 255.0), 1.0)
    res = np.empty_like(cur)
    res[:, :, :3] = np.where(out_alpha > 1.0, cur[:, :, :3] / safe_a, 0.0)
    res[:, :, 3:4] = out_alpha
    return np.clip(res, 0, 255).astype(np.uint8)


def scale_x_about_center(arr: np.ndarray, scale_x: float, center_x: int) -> np.ndarray:
    """Applies horizontal scaleX around center_x while keeping Y untouched."""
    if abs(scale_x - 1.0) < 1e-3:
        return arr
    h, w, _ = arr.shape
    new_w = max(1, int(round(w * scale_x)))
    if _HAS_CV2:
        stretched = cv2.resize(arr, (new_w, h), interpolation=cv2.INTER_LINEAR)
        canvas = np.zeros((h, w, 4), dtype=np.uint8)
        paste_x = int(round(center_x - center_x * scale_x))
        src_x0 = max(0, -paste_x)
        dst_x0 = max(0, paste_x)
        copy_w = min(new_w - src_x0, w - dst_x0)
        if copy_w > 0:
            canvas[:, dst_x0 : dst_x0 + copy_w, :] = stretched[:, src_x0 : src_x0 + copy_w, :]
        return canvas

    img = Image.fromarray(arr, mode="RGBA")
    stretched = img.resize((new_w, h), resample=Image.Resampling.BILINEAR)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    paste_x = int(round(center_x - center_x * scale_x))
    canvas.paste(stretched, (paste_x, 0))
    return np.array(canvas, dtype=np.uint8)


def apply_horizontal_echo(arr: np.ndarray, offsets_px: Sequence[int], alpha_mult: float) -> np.ndarray:
    h, w, _ = arr.shape
    echo = arr.copy()
    echo[:, :, 3] = np.clip(echo[:, :, 3].astype(np.float32) * alpha_mult, 0, 255).astype(np.uint8)
    out = np.zeros_like(arr)
    for off in offsets_px:
        for sign in (-1, 1):
            shift = sign * off
            shifted = np.zeros_like(arr)
            if shift > 0 and shift < w:
                shifted[:, shift:, :] = echo[:, : w - shift, :]
            elif shift < 0 and -shift < w:
                shifted[:, : w + shift, :] = echo[:, -shift:, :]
            out = _alpha_over(out, shifted)
    return _alpha_over(out, arr)


def apply_smear_strip(
    base_arr: np.ndarray,
    ry0: int,
    ry1: int,
    rx0: int,
    rx1: int,
    word_center_x: int,
    smear_level: int,
    width: int,
    sigma1_1080: float,
    scale1_x: float,
    sigma2_1080: float,
    scale2_x: float,
    smear_echo: bool = False,
    echo_offsets_1080: Sequence[int] = (8, 16, 24),
    echo_alpha: float = 0.35,
) -> np.ndarray:
    """
    Applies horizontal-only smear + scaleX ONLY on the active vertical+horizontal ROI,
    dramatically cutting work compared to blurring full 1080px width.
    """
    if smear_level <= 0:
        return base_arr
    scale = width / 1080.0
    sigma_x = (sigma1_1080 if smear_level == 2 else sigma2_1080) * scale
    sc_x = scale1_x if smear_level == 2 else scale2_x
    echo_pad = int(round(max(echo_offsets_1080) * scale)) if (smear_level == 2 and smear_echo and echo_offsets_1080) else 0
    x_pad = max(32, int(math.ceil(sigma_x * 3.5)) + int(math.ceil((rx1 - rx0) * (sc_x - 1.0) * 0.6)) + echo_pad + 8)
    sx0 = max(0, rx0 - x_pad)
    sx1 = min(width, rx1 + x_pad)
    local_cx = word_center_x - sx0

    roi = base_arr[ry0:ry1, sx0:sx1, :]
    roi = scale_x_about_center(roi, sc_x, local_cx)
    if smear_level == 2 and smear_echo:
        offs = [max(1, int(round(o * scale))) for o in echo_offsets_1080]
        roi = apply_horizontal_echo(roi, offs, echo_alpha)
    roi = horizontal_gaussian_blur_1d(roi, sigma_x)

    out = np.zeros_like(base_arr)
    out[ry0:ry1, sx0:sx1, :] = roi
    return out


# ─────────────────────── Caption Strip Sprite Renderer ───────────────────────
def compute_caption_strip_geometry(
    canvas_w: int,
    canvas_h: int,
    window_top: int,
    window_h: int,
    style: CaptionStyle = KARAOKE_POP,
) -> Tuple[int, int, int]:
    """
    Returns (strip_h, strip_y, caption_center_y).
    Strip height = ~3 * font_px (about 330px at 1080w), centered at window_top + 0.54*window_h.
    """
    font_px = max(20, int(round(style.font_size_pct * canvas_w)))
    strip_h = min(canvas_h, max(200, int(round(font_px * style.strip_height_font_mult))))
    strip_h += strip_h % 2
    caption_center_y = window_top + int(round(window_h * style.center_y_pct))
    strip_y = max(0, min(canvas_h - strip_h, caption_center_y - strip_h // 2))
    return strip_h, strip_y, caption_center_y


def _wrap_phrase_words_into_lines(
    words_list: Sequence[str],
    font: Any,
    meas: ImageDraw.ImageDraw,
    max_w: int,
    max_lines: int = 2,
) -> List[List[Tuple[int, str]]]:
    """Wraps indexed words [(idx, word), ...] into 1..max_lines balanced lines fitting within max_w."""
    indexed = list(enumerate(words_list))
    if not indexed:
        return []
    full_txt = " ".join(words_list)
    if meas.textlength(full_txt, font=font) <= max_w or max_lines <= 1 or len(indexed) == 1:
        return [indexed]

    # Pick balanced 2-line split minimizing max(line1_w, line2_w)
    best_split = 1
    best_cost = float("inf")
    for k in range(1, len(indexed)):
        l1 = " ".join(w for _, w in indexed[:k])
        l2 = " ".join(w for _, w in indexed[k:])
        w1 = meas.textlength(l1, font=font)
        w2 = meas.textlength(l2, font=font)
        overflow = max(0.0, w1 - max_w) + max(0.0, w2 - max_w)
        cost = overflow * 100.0 + max(w1, w2) + 0.25 * abs(w1 - w2)
        if cost < best_cost:
            best_cost = cost
            best_split = k
    return [indexed[:best_split], indexed[best_split:]]


def _render_phrase_base(
    ev: RenderEvent,
    width: int,
    band_h: int,
    style: CaptionStyle,
    local_center_y: Optional[float] = None,
) -> Tuple[np.ndarray, int, int, int, int, int]:
    """
    Renders a broadcast-grade 2-4 word chunk sprite (max 2 lines, <=85% width):
      - Heavy sans-serif (Montserrat ExtraBold / Inter Black), cap height ~75px at 1080w
      - Soft drop shadow
      - ~8px opaque black outline around every word (guarantees >=4.5:1 contrast over any bg)
      - White fill on inactive words, single yellow accent on active word ONLY
      - Zero neon glow, zero blur-in flicker
    """
    scale = width / 1080.0
    base_font_size = max(20, int(round(style.font_size_pct * width)))
    stroke_w = max(2, int(round(style.stroke_width_1080 * scale)))
    max_w = int(round(style.max_word_width_pct * width))
    meas = _get_meas_draw()

    words_list = ev.chunks if ev.chunks else ev.word.split()
    font_size = base_font_size
    font = _load_font(font_size, style.font_paths)
    lines = _wrap_phrase_words_into_lines(words_list, font, meas, max_w - stroke_w * 2, style.chunk_max_lines)

    # Shrink font cleanly if any line still exceeds max_w
    for _ in range(10):
        widest = max(meas.textlength(" ".join(w for _, w in ln), font=font) + stroke_w * 2 for ln in lines)
        if widest <= max_w or font_size <= 24:
            break
        font_size = max(24, int(math.floor(font_size * (max_w / widest) * 0.98)))
        font = _load_font(font_size, style.font_paths)
        lines = _wrap_phrase_words_into_lines(words_list, font, meas, max_w - stroke_w * 2, style.chunk_max_lines)

    ref_bb = meas.textbbox((0, 0), "Hg", font=font)
    glyph_h = max(1, int(round(ref_bb[3] - ref_bb[1])))
    line_step = int(round(glyph_h * style.line_spacing_mult))
    total_h = glyph_h + (len(lines) - 1) * line_step
    cy_target = (band_h / 2.0) if local_center_y is None else local_center_y
    top_y = int(round(cy_target - total_h / 2.0 - ref_bb[1]))
    anchor_x = int(round(style.anchor_x_pct * width))

    white_rgb = style.palette.get(style.emphasis_base_color, (255, 255, 255))
    active_rgb = style.palette.get(ev.main_color_name, (255, 224, 0))
    stroke_rgba = (*style.stroke_color, 255)

    # Compute exact word positions across 1-2 lines
    space_w = meas.textlength(" ", font=font)
    placements: List[Tuple[int, str, int, int]] = []  # (word_idx, txt, x, y)
    for li, ln in enumerate(lines):
        line_txt = " ".join(w for _, w in ln)
        line_w = meas.textlength(line_txt, font=font)
        cur_x = anchor_x - line_w / 2.0
        ly = top_y + li * line_step
        for wi, wtxt in ln:
            placements.append((wi, wtxt, int(round(cur_x)), ly))
            cur_x += meas.textlength(wtxt, font=font) + space_w

    # Draw shadow layer first (soft dark silhouette shifted down slightly)
    full_img = Image.new("RGBA", (width, band_h), (0, 0, 0, 0))
    if style.shadow_enabled and style.shadow_scale > 0:
        sh_mask = Image.new("L", (width, band_h), 0)
        sh_draw = ImageDraw.Draw(sh_mask)
        sh_dx = int(round(style.shadow_offset_x_1080 * scale))
        sh_dy = int(round(style.shadow_offset_y_1080 * scale))
        for _, wtxt, wx, wy in placements:
            sh_draw.text(
                (wx + sh_dx, wy + sh_dy),
                wtxt,
                font=font,
                fill=255,
                stroke_width=stroke_w,
                stroke_fill=255,
            )
        sh_arr = _blur_mask_2d(np.array(sh_mask, dtype=np.uint8), max(2.0, style.shadow_blur_sigma * scale))
        sh_alpha = np.clip(sh_arr.astype(np.float32) * (style.shadow_alpha * style.shadow_scale), 0, 255).astype(np.uint8)
        sh_rgba = _make_colored_layer(style.shadow_color, sh_alpha)
        full_img = Image.fromarray(sh_rgba, mode="RGBA")

    # Draw crisp opaque black outline + white/yellow fill on top
    fg_img = Image.new("RGBA", (width, band_h), (0, 0, 0, 0))
    fg_draw = ImageDraw.Draw(fg_img)
    for wi, wtxt, wx, wy in placements:
        fill_rgb = active_rgb if (ev.window_index is not None and wi == ev.window_index) else white_rgb
        fg_draw.text(
            (wx, wy),
            wtxt,
            font=font,
            fill=(*fill_rgb, 255),
            stroke_width=stroke_w,
            stroke_fill=stroke_rgba,
        )

    out_arr = _alpha_over(np.array(full_img, dtype=np.uint8), np.array(fg_img, dtype=np.uint8))
    return out_arr, 0, band_h, 0, width, anchor_x


def _render_sharp_base(
    ev: RenderEvent,
    width: int,
    band_h: int,
    style: CaptionStyle = KARAOKE_POP,
    local_center_y: Optional[float] = None,
) -> Tuple[np.ndarray, int, int, int, int, int]:
    """
    Renders sharp (smear_level=0) RGBA band sprite using tight ROI rendering.
    Dispatches to `_render_phrase_base` when `style.chunk_mode == "phrase"`.
    """
    if style.chunk_mode == "phrase":
        return _render_phrase_base(ev, width, band_h, style, local_center_y)
    scale = width / 1080.0
    base_font_size = max(20, int(round(style.font_size_pct * width)))
    font = _load_font(base_font_size, style.font_paths)
    meas = _get_meas_draw()
    max_w = int(round(style.max_word_width_pct * width))

    word_bbox = meas.textbbox((0, 0), ev.word, font=font)
    word_w = int(round(word_bbox[2] - word_bbox[0]))
    if word_w > max_w and word_w > 0:
        shrunk_size = max(16, int(math.floor(base_font_size * (max_w / word_w))))
        font = _load_font(shrunk_size, style.font_paths)
        word_bbox = meas.textbbox((0, 0), ev.word, font=font)
        word_w = int(round(word_bbox[2] - word_bbox[0]))

    ref_bbox = meas.textbbox((0, 0), "Every", font=font)
    ref_center_from_origin = (ref_bbox[1] + ref_bbox[3]) / 2.0
    cy_target = (band_h / 2.0) if local_center_y is None else local_center_y
    draw_y = int(round(cy_target - ref_center_from_origin))

    anchor_x = int(round(style.anchor_x_pct * width))
    margin = max(12, int(round(0.05 * width)))
    start_x = anchor_x - word_w // 2
    start_x = max(margin, min(width - margin - word_w, start_x))
    word_center_x = int(start_x + word_w // 2)

    sh_dx = int(round(style.shadow_offset_x_1080 * scale))
    sh_dy = int(round(style.shadow_offset_y_1080 * scale))
    dil_px = int(round(style.glow_dilate_px * scale))
    halo_sigma = style.halo_glow_sigma_1080 * scale * style.glow_spread_scale
    pad_xy = max(64, int(math.ceil(halo_sigma * 3.2)) + dil_px + max(abs(sh_dx), abs(sh_dy)) + 10)

    gx0 = int(round(start_x + word_bbox[0]))
    gy0 = int(round(draw_y + word_bbox[1]))
    gx1 = int(round(start_x + word_bbox[2]))
    gy1 = int(round(draw_y + word_bbox[3]))

    rx0 = max(0, gx0 - pad_xy)
    ry0 = max(0, gy0 - pad_xy)
    rx1 = min(width, gx1 + pad_xy)
    ry1 = min(band_h, gy1 + pad_xy)
    roi_w = max(1, rx1 - rx0)
    roi_h = max(1, ry1 - ry0)

    local_x = int(start_x - rx0)
    local_y = int(draw_y - ry0)

    main_rgb = style.palette[ev.main_color_name]
    white_rgb = style.palette[style.emphasis_base_color]

    # Bottom layers: M6c 3-layer shadow (ambient dark halo + drop shadow + contact shadow)
    comp = _build_three_layer_shadow(roi_w, roi_h, local_x, local_y, ev.word, font, scale, style)

    if ev.window_index is None:
        glyph_mask_img = Image.new("L", (roi_w, roi_h), 0)
        ImageDraw.Draw(glyph_mask_img).text((local_x, local_y), ev.word, font=font, fill=255)
        g_mask = np.array(glyph_mask_img, dtype=np.uint8)

        if style.glow_enabled:
            halo_gl, wide_gl, tight_gl = build_three_layer_glow(g_mask, main_rgb, scale, style)
            comp = _alpha_over(comp, halo_gl)
            comp = _alpha_over(comp, wide_gl)
            comp = _alpha_over(comp, tight_gl)

        comp = _alpha_over(comp, _make_colored_layer(main_rgb, g_mask))
    else:
        white_mask_img = Image.new("L", (roi_w, roi_h), 0)
        win_mask_img = Image.new("L", (roi_w, roi_h), 0)
        wd = ImageDraw.Draw(white_mask_img)
        cd = ImageDraw.Draw(win_mask_img)
        prefix = ""
        for idx, ch_txt in enumerate(ev.chunks):
            px_off = int(round(meas.textlength(prefix, font=font))) if prefix else 0
            cx = local_x + px_off
            if idx == ev.window_index:
                cd.text((cx, local_y), ch_txt, font=font, fill=255)
            else:
                wd.text((cx, local_y), ch_txt, font=font, fill=255)
            prefix += ch_txt

        w_mask = np.array(white_mask_img, dtype=np.uint8)
        c_mask = np.array(win_mask_img, dtype=np.uint8)

        if style.glow_enabled:
            w_halo, w_wide, w_tight = build_three_layer_glow(w_mask, white_rgb, scale, style)
            c_halo, c_wide, c_tight = build_three_layer_glow(c_mask, main_rgb, scale, style)
            comp = _alpha_over(comp, w_halo)
            comp = _alpha_over(comp, c_halo)
            comp = _alpha_over(comp, w_wide)
            comp = _alpha_over(comp, c_wide)
            comp = _alpha_over(comp, w_tight)
            comp = _alpha_over(comp, c_tight)

        comp = _alpha_over(comp, _make_colored_layer(white_rgb, w_mask))
        comp = _alpha_over(comp, _make_colored_layer(main_rgb, c_mask))

    full_arr = np.zeros((band_h, width, 4), dtype=np.uint8)
    full_arr[ry0:ry1, rx0:rx1, :] = comp
    return full_arr, ry0, ry1, rx0, rx1, word_center_x


def render_event_sprite(
    ev: RenderEvent,
    width: int,
    band_h: int,
    smear_level: int,
    style: CaptionStyle = KARAOKE_POP,
    local_center_y: Optional[float] = None,
) -> np.ndarray:
    base_arr, ry0, ry1, rx0, rx1, word_center_x = _render_sharp_base(ev, width, band_h, style, local_center_y)
    return apply_smear_strip(
        base_arr, ry0, ry1, rx0, rx1, word_center_x, smear_level, width,
        style.smear_phase1_sigma_x_1080, style.smear_phase1_scale_x,
        style.smear_phase2_sigma_x_1080, style.smear_phase2_scale_x,
        style.smear_echo, style.smear_echo_offsets_1080, style.smear_echo_alpha,
    )


# ─────────────────────── Sprite Factory (Memory + Disk Cache + ffconcat) ───────────────────────
def _style_fingerprint(style: CaptionStyle) -> str:
    payload = (
        f"v4|{style.chunk_mode}|{style.font_size_pct:.4f}|{style.anchor_x_pct:.4f}|{style.glow_enabled}|"
        f"{style.glow_spread_scale:.3f}|{style.glow_alpha_scale:.3f}|{style.shadow_enabled}|{style.shadow_scale:.3f}|"
        f"{style.glow_dilate_px}|{style.halo_glow_sigma_1080}|{style.wide_glow_sigma_1080}|{style.tight_glow_sigma_1080}|"
        f"{style.smear_enabled}|{style.smear_phase1_sigma_x_1080}|{style.smear_phase1_scale_x}|{style.smear_echo}|"
        f"{style.highlight_unit}|{style.stroke_width_1080}|{style.active_word_color}|{style.chunk_max_lines}|"
        f"{style.font_paths[0] if style.font_paths else ''}"
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:10]


def _sprite_cache_key(
    ev: RenderEvent,
    smear_level: int,
    width: int,
    strip_h: int,
    local_cy: int,
    style_fp: str,
) -> str:
    raw = f"cap|{style_fp}|{width}x{strip_h}|cy{local_cy}|{ev.word}|{ev.window_index}|{ev.main_color_name}|sm{smear_level}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def ensure_empty_sprite(width: int, strip_h: int, cache_dir: Path) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    p = cache_dir / f"empty_{width}x{strip_h}.png"
    if not p.exists():
        img = Image.new("RGBA", (width, strip_h), (0, 0, 0, 0))
        tmp = cache_dir / f".empty_{width}x{strip_h}.{os.getpid()}.{threading.get_ident()}.tmp.png"
        img.save(tmp, format="PNG", compress_level=1)
        os.replace(tmp, p)
    return p


def _save_png_fast(arr: np.ndarray, out_path: Path) -> Path:
    tmp = out_path.with_name(f".{out_path.name}.{os.getpid()}.{threading.get_ident()}.tmp.png")
    if _HAS_CV2:
        bgra = cv2.cvtColor(arr, cv2.COLOR_RGBA2BGRA)
        cv2.imwrite(str(tmp), bgra, [cv2.IMWRITE_PNG_COMPRESSION, 1])
    else:
        Image.fromarray(arr, mode="RGBA").save(tmp, format="PNG", compress_level=1)
    os.replace(tmp, out_path)
    return out_path


def resolve_writable_cache_dir(preferred: str, fallback: Path) -> Path:
    """Uses preferred cache dir (~/.cache/openclip/sprites), falling back cleanly if read-only."""
    pref = Path(preferred)
    try:
        pref.mkdir(parents=True, exist_ok=True)
        probe = pref / f".probe_{os.getpid()}"
        probe.write_bytes(b"1")
        probe.unlink(missing_ok=True)
        return pref
    except Exception:
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


def build_caption_ffconcat(
    events: Sequence[RenderEvent],
    duration: float,
    fps: float,
    canvas_w: int,
    canvas_h: int,
    window_top: int,
    window_h: int,
    work_dir: Path,
    style: CaptionStyle = KARAOKE_POP,
    use_disk_cache: bool = True,
) -> Tuple[Path, int, int, Dict[str, int]]:
    """
    Generates cached strip-sized PNG sprites (one per distinct state) in parallel and writes
    `captions.ffconcat` with frame-quantized durations + transparent gaps + transparent tail.
    Returns (ffconcat_path, strip_h, strip_y, stats_dict).
    """
    work_dir.mkdir(parents=True, exist_ok=True)
    if use_disk_cache:
        from openclip_engine.core.config import CACHE_DIR
        cache_dir = resolve_writable_cache_dir(style.sprite_cache_dir, CACHE_DIR / "sprites")
    else:
        cache_dir = work_dir / "sprites"
        cache_dir.mkdir(parents=True, exist_ok=True)

    strip_h, strip_y, caption_center_y = compute_caption_strip_geometry(
        canvas_w, canvas_h, window_top, window_h, style
    )
    local_cy = caption_center_y - strip_y
    style_fp = _style_fingerprint(style)

    empty_png = ensure_empty_sprite(canvas_w, strip_h, cache_dir)

    # Identify unique base states needed -> each base generates smear_level 0, 1, 2
    base_jobs: Dict[Tuple[str, Optional[int], str], RenderEvent] = {}
    for ev in events:
        bk = (ev.word, ev.window_index, ev.main_color_name)
        if bk not in base_jobs:
            base_jobs[bk] = ev

    needed_paths: Dict[Tuple[str, Optional[int], str, int], Path] = {}
    miss_groups: List[Tuple[Tuple[str, Optional[int], str], RenderEvent, List[int]]] = []
    hits = 0
    misses = 0

    smear_levels = (2, 1, 0) if style.smear_enabled else (0,)
    for bk, ev in base_jobs.items():
        missing_smears: List[int] = []
        for sm in smear_levels:
            ck = _sprite_cache_key(ev, sm, canvas_w, strip_h, local_cy, style_fp)
            png_path = cache_dir / f"{ck}.png"
            needed_paths[(bk[0], bk[1], bk[2], sm)] = png_path
            if use_disk_cache and (ck in _SPRITE_MEM_CACHE or png_path.exists()):
                _SPRITE_MEM_CACHE[ck] = png_path
                hits += 1
            else:
                missing_smears.append(sm)
                misses += 1
        if missing_smears:
            miss_groups.append((bk, ev, missing_smears))

    def _render_group(item: Tuple[Tuple[str, Optional[int], str], RenderEvent, List[int]]) -> None:
        bk, ev, smears = item
        base_arr, ry0, ry1, rx0, rx1, word_cx = _render_sharp_base(
            ev, canvas_w, strip_h, style, local_center_y=float(local_cy)
        )
        for sm in smears:
            arr = apply_smear_strip(
                base_arr, ry0, ry1, rx0, rx1, word_cx, sm, canvas_w,
                style.smear_phase1_sigma_x_1080, style.smear_phase1_scale_x,
                style.smear_phase2_sigma_x_1080, style.smear_phase2_scale_x,
                style.smear_echo, style.smear_echo_offsets_1080, style.smear_echo_alpha,
            )
            out_p = needed_paths[(bk[0], bk[1], bk[2], sm)]
            _save_png_fast(arr, out_p)
            ck = _sprite_cache_key(ev, sm, canvas_w, strip_h, local_cy, style_fp)
            if use_disk_cache:
                with _SPRITE_LOCK:
                    _SPRITE_MEM_CACHE[ck] = out_p

    if miss_groups:
        n_workers = max(1, min(len(miss_groups), max(1, (os.cpu_count() or 4) - 2)))
        if n_workers == 1 or len(miss_groups) <= 2:
            for item in miss_groups:
                _render_group(item)
        else:
            with ThreadPoolExecutor(max_workers=n_workers) as pool:
                list(pool.map(_render_group, miss_groups))

    # Build exact per-frame ffconcat entries (paired with `-r <fps> -f concat -safe 0`)
    # Avoids FFmpeg image2's default 25fps (40ms) duration quantization while running at ~2600 fps.
    total_frames = max(1, int(math.ceil(duration * fps)))
    frame_paths: List[Path] = [empty_png] * total_frames

    # Smear phase frame counts (time-based, fps-independent)
    p1_frames = max(1, int(round((style.smear_phase1_ms / 1000.0) * fps)))
    p2_frames = max(1, int(round(((style.smear_phase2_ms - style.smear_phase1_ms) / 1000.0) * fps)))

    cursor_f = 0
    for ev in events:
        f_start = max(cursor_f, int(math.ceil(ev.start * fps - 1e-6)))
        f_end = min(total_frames, int(math.ceil(ev.end * fps - 1e-6)))
        if f_end <= f_start:
            continue

        bk = (ev.word, ev.window_index, ev.main_color_name)
        p_sh0 = needed_paths[(bk[0], bk[1], bk[2], 0)]
        if style.smear_enabled:
            p_sm2 = needed_paths[(bk[0], bk[1], bk[2], 2)]
            p_sm1 = needed_paths[(bk[0], bk[1], bk[2], 1)]
            for fi in range(f_start, f_end):
                rel = fi - f_start
                if rel < p1_frames:
                    frame_paths[fi] = p_sm2
                elif rel < p1_frames + p2_frames:
                    frame_paths[fi] = p_sm1
                else:
                    frame_paths[fi] = p_sh0
        else:
            for fi in range(f_start, f_end):
                frame_paths[fi] = p_sh0
        cursor_f = f_end

    # Append a small transparent tail (2 frames) so eof_action=pass transitions cleanly
    frame_paths.extend([empty_png, empty_png])

    ffconcat_path = work_dir / "captions.ffconcat"
    esc_cache: Dict[Path, str] = {}
    lines = ["ffconcat version 1.0"]
    for p in frame_paths:
        line = esc_cache.get(p)
        if line is None:
            esc = str(p).replace("'", "'\\''")
            line = f"file '{esc}'"
            esc_cache[p] = line
        lines.append(line)
    ffconcat_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    return ffconcat_path, strip_h, strip_y, {
        "unique_bases": len(base_jobs),
        "cache_hits": hits,
        "cache_misses": misses,
        "frames": len(frame_paths),
    }


# ─────────────────────── Video Probing & Standalone Caption API ───────────────────────
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
    data = json.loads(res.stdout)
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
    window_top: int = 0,
    window_h: Optional[int] = None,
) -> Path:
    """
    Burns Karaoke Pop captions onto video_in in ONE FFmpeg process via ffconcat sprite track
    (zero Python per-frame piping). Preserves resolution/fps, H.264 yuv420p CRF 18, -c:a copy, +faststart.
    """
    video_in_p = Path(video_in)
    out_p = Path(out_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)

    src_w, src_h, fps, duration = probe_video_stream(video_in_p, ffmpeg_bin)
    width, height = output_dims if output_dims is not None else (src_w, src_h)
    eff_win_h = window_h if window_h is not None else height
    eff_clip_end = clip_end if clip_end is not None else (clip_start + duration)
    events = build_render_events(words, fps=fps, clip_start=clip_start, clip_end=eff_clip_end, style=style)

    fps_arg = f"{fps:.6f}".rstrip("0").rstrip(".")
    cores = str(os.cpu_count() or 4)

    with tempfile.TemporaryDirectory(prefix="oc_cap_") as td:
        ffconcat_path, _, strip_y, _ = build_caption_ffconcat(
            events=events,
            duration=duration,
            fps=fps,
            canvas_w=width,
            canvas_h=height,
            window_top=window_top,
            window_h=eff_win_h,
            work_dir=Path(td),
            style=style,
        )

        if reframe_vf:
            fc = (
                f"[0:v]{reframe_vf}[vbase];"
                f"[1:v]fps={fps_arg},format=rgba[cap];"
                f"[vbase][cap]overlay=0:{strip_y}:eof_action=pass:format=auto,format=yuv420p[vout]"
            )
        else:
            fc = (
                f"[1:v]fps={fps_arg},format=rgba[cap];"
                f"[0:v][cap]overlay=0:{strip_y}:eof_action=pass:format=auto,format=yuv420p[vout]"
            )

        cmd = [
            ffmpeg_bin, "-y", "-loglevel", "error",
            "-filter_threads", cores, "-filter_complex_threads", cores,
            "-i", str(video_in_p),
            "-r", fps_arg, "-f", "concat", "-safe", "0", "-i", str(ffconcat_path),
            "-filter_complex", fc,
            "-map", "[vout]",
            "-map", "0:a?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", str(style.crf), "-pix_fmt", "yuv420p",
            "-c:a", "copy",
            "-movflags", "+faststart",
            str(out_p),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if res.returncode != 0 or not out_p.exists() or out_p.stat().st_size < 1000:
            raise RuntimeError(f"FFmpeg render_captions failed (rc={res.returncode}): {res.stderr[-400:]}")
        return out_p


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
    title: Optional[str] = None,
    hook_sentence: Optional[str] = None,
    sfx_mode: str = "rules",
    quality: str = "balanced",
) -> Path:
    """
    Pipeline adapter: for 9:16 exports, uses the full polished vertical renderer
    (4:5 video window on blurred 9:16 canvas + adaptive grade + Karaoke Pop captions + title + SFX).
    For other aspect ratios (e.g. 4:5 / 16:9 / 1:1), renders single-pass reframe + Karaoke Pop.
    """
    words = cues_to_words(cues)
    if aspect_ratio in ("9:16", "4:5", "3:4"):
        from dataclasses import replace as dc_replace
        from openclip_engine.clipping.clip_renderer import render_polished_clip
        from openclip_engine.clipping.config_styles import DEFAULT_LAYOUT, DEFAULT_SFX_CONFIG, PLAIN_4_5_LAYOUT

        if aspect_ratio == "4:5":
            layout = dc_replace(PLAIN_4_5_LAYOUT, quality=quality)
        elif aspect_ratio == "3:4":
            layout = dc_replace(DEFAULT_LAYOUT, video_aspect="3:4", quality=quality)
        else:
            layout = dc_replace(DEFAULT_LAYOUT, quality=quality)

        sfx_cfg = dc_replace(DEFAULT_SFX_CONFIG, mode=sfx_mode)
        return render_polished_clip(
            video_in=raw_clip_path,
            words=words,
            out_path=final_clip_path,
            clip_start=clip_start,
            clip_end=clip_end,
            title=title,
            hook_sentence=hook_sentence,
            layout=layout,
            caption_style=style,
            sfx_config=sfx_cfg,
            ffmpeg_bin=ffmpeg_bin,
            seek_source=False,  # raw_clip_path is already cut to [clip_start, clip_end]
        )

    from openclip_engine.clipping.caption_burner import ASPECT_DIMS

    target_w, target_h = ASPECT_DIMS.get(aspect_ratio, (1080, 1920))
    ratio_expr = f"{target_w}/{target_h}"
    base_vf = (
        f"crop='if(gt(iw/ih,{ratio_expr}),ih*{ratio_expr},iw)':"
        f"'if(gt(iw/ih,{ratio_expr}),ih,iw/({ratio_expr}))',"
        f"scale={target_w}:{target_h}:flags=lanczos,setsar=1,setpts=PTS-STARTPTS"
    )
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
