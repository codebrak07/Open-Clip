"""
M3 Main Title Renderer:
  - Generates a punchy ALL CAPS hook title + yellow keyword via OpenClip's LLM provider
    layer with a deterministic non-LLM fallback.
  - Renders Impact ALL CAPS typography with 8px black outside stroke, drop shadow, and
    two-layer yellow (#F5F000) glow on the keyword inside y 130..320 (strip W x 340 at y=0).
  - Emits cached PNG sprites + a 3-entry title.ffconcat (66ms smear entrance, then steady hold
    via overlay eof_action=repeat).
"""
from __future__ import annotations

import hashlib
import math
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw

from openclip_engine.clipping.config_styles import DEFAULT_TITLE_STYLE, TitleStyle
from openclip_engine.clipping.karaoke_pop import (
    _alpha_over,
    _blur_mask_2d,
    _get_meas_draw,
    _load_font,
    _make_colored_layer,
    _save_png_fast,
    _separable_max_filter_2d,
    apply_smear_strip,
    build_two_layer_glow,
    resolve_writable_cache_dir,
)
from openclip_engine.clipping.llm_helper import call_llm_json

_STOPWORDS = {
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "to", "of", "in", "on",
    "at", "by", "for", "with", "about", "as", "into", "from", "that", "this", "these", "those",
    "it", "its", "and", "or", "but", "if", "so", "not", "no", "yes", "you", "your", "we", "our",
    "they", "their", "he", "she", "his", "her", "my", "me", "i", "do", "does", "did", "has",
    "have", "had", "can", "could", "will", "would", "just", "all", "one", "out", "up", "own",
    "every", "which", "what", "when", "where", "who", "how", "very", "most", "some", "than",
}


def _strip_emojis_and_bad_chars(text: str) -> str:
    # Remove hashtags, quotes, emojis/pictographs while preserving Unicode letters/digits & basic punct
    txt = re.sub(r"#\S+", "", text)
    txt = txt.replace('"', "").replace("'", "'").replace("\u201c", "").replace("\u201d", "")
    # Strip surrogate/emoji Unicode ranges
    txt = re.sub(
        r"[\U0001F300-\U0001FAFF\U00002600-\U000027BF\uFE0F\u200D]+",
        "",
        txt,
    )
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt


def _pick_keyword(title_words: Sequence[str], preferred: Optional[str] = None) -> str:
    if not title_words:
        return ""
    if preferred:
        pref_clean = re.sub(r"[^\w'-]+", "", preferred).upper()
        for w in title_words:
            if re.sub(r"[^\w'-]+", "", w).upper() == pref_clean and pref_clean:
                return w
    # Longest non-stopword
    best = ""
    best_len = -1
    for w in title_words:
        clean = re.sub(r"[^\w]+", "", w).lower()
        if not clean or clean in _STOPWORDS:
            continue
        if len(clean) > best_len:
            best_len = len(clean)
            best = w
    if best:
        return best
    return max(title_words, key=lambda w: len(re.sub(r"[^\w]+", "", w)))


def _fallback_title_from_transcript(transcript: str, style: TitleStyle = DEFAULT_TITLE_STYLE) -> Tuple[str, str]:
    cleaned = _strip_emojis_and_bad_chars(transcript or "")
    if not cleaned:
        return "WATCH THIS MOMENT", "MOMENT"

    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", cleaned) if s.strip()]
    best_sent = sentences[0] if sentences else cleaned
    best_score = -1.0
    for s in sentences:
        ws = s.split()
        if not ws:
            continue
        # Prefer concise punchy sentences with questions/exclamations or strong nouns
        score = min(len(ws), 8) * 1.0
        if "?" in s or "!" in s:
            score += 3.0
        if any(len(re.sub(r"[^\w]", "", w)) >= 6 for w in ws):
            score += 2.0
        if score > best_score:
            best_score = score
            best_sent = s

    words = best_sent.split()[: style.fallback_max_words]
    # Trim trailing dangling stopword if we cut mid-sentence
    while len(words) > 3 and re.sub(r"[^\w]+", "", words[-1]).lower() in _STOPWORDS:
        words.pop()
    title = " ".join(words).upper().rstrip(".,;:")
    if not title:
        title = "WATCH THIS MOMENT"
    kw = _pick_keyword(title.split())
    return title, kw


def resolve_title_and_keyword(
    transcript: str,
    title: Optional[str] = None,
    keyword: Optional[str] = None,
    style: TitleStyle = DEFAULT_TITLE_STYLE,
    use_llm: bool = True,
) -> Tuple[str, str]:
    """
    Returns (UPPERCASE_TITLE, KEYWORD_TOKEN).
    Uses explicit `title` if supplied, otherwise calls OpenClip's LLM provider layer with
    validation and deterministic fallback.
    """
    if title and title.strip():
        clean = _strip_emojis_and_bad_chars(title).upper()
        words = clean.split()[: style.max_words]
        clean = " ".join(words)
        return clean, _pick_keyword(words, keyword)

    if use_llm and transcript and transcript.strip():
        prompt = (
            "Write a punchy hook title for this clip from the transcript: "
            f"max {style.max_words} words, max {style.max_lines} lines, ALL CAPS, "
            "no emojis/hashtags/quotes, in the clip's language. "
            'Return JSON {"title": "...", "keyword": "<one word from the title>"}.\n\n'
            f"Transcript:\n{transcript[:1200]}"
        )
        resp = call_llm_json(prompt, system_prompt="Return ONLY valid raw JSON with keys title and keyword.")
        if isinstance(resp, dict) and isinstance(resp.get("title"), str):
            cand = _strip_emojis_and_bad_chars(resp["title"]).upper()
            words = cand.split()
            if 1 <= len(words) <= style.max_words:
                kw = _pick_keyword(words, str(resp.get("keyword") or ""))
                return " ".join(words), kw

    return _fallback_title_from_transcript(transcript, style)


def _balanced_two_lines(
    words: Sequence[str],
    font: Any,
    meas: ImageDraw.ImageDraw,
    max_w: int,
    stroke_w: int,
) -> List[str]:
    """Splits words into 1 or 2 visually balanced lines within max_w."""
    if not words:
        return []
    full = " ".join(words)
    bb = meas.textbbox((0, 0), full, font=font, stroke_width=stroke_w)
    if (bb[2] - bb[0]) <= max_w or len(words) == 1:
        return [full]

    best_split = 1
    best_cost = float("inf")
    for i in range(1, len(words)):
        l1 = " ".join(words[:i])
        l2 = " ".join(words[i:])
        b1 = meas.textbbox((0, 0), l1, font=font, stroke_width=stroke_w)
        b2 = meas.textbbox((0, 0), l2, font=font, stroke_width=stroke_w)
        w1 = b1[2] - b1[0]
        w2 = b2[2] - b2[0]
        overflow = max(0, w1 - max_w) * 10 + max(0, w2 - max_w) * 10
        cost = max(w1, w2) + 0.5 * abs(w1 - w2) + overflow
        if cost < best_cost:
            best_cost = cost
            best_split = i
    return [" ".join(words[:best_split]), " ".join(words[best_split:])]


def _render_title_sharp_base(
    title: str,
    keyword: str,
    canvas_w: int,
    style: TitleStyle = DEFAULT_TITLE_STYLE,
) -> Tuple[np.ndarray, int, int, int, int, int]:
    """
    Renders sharp title strip (canvas_w x strip_height) with Impact ALL CAPS, 8px black outside
    stroke, drop shadow, and two-layer yellow glow on the keyword.
    Strictly fits inside y [zone_y_top, zone_y_bottom] and side margins >= side_margin_px.
    """
    scale = canvas_w / 1080.0
    strip_h = int(round(style.strip_height * scale))
    strip_h += strip_h % 2
    y_top_lim = int(round(style.zone_y_top * scale))
    y_bot_lim = int(round(style.zone_y_bottom * scale))
    zone_h = max(40, y_bot_lim - y_top_lim)

    side_margin = int(round(style.side_margin_px * scale))
    max_w = min(int(round(style.max_width_pct * canvas_w)), canvas_w - 2 * side_margin)
    stroke_px = max(2, int(round(style.stroke_px_1080 * scale)))

    meas = _get_meas_draw()
    words = title.upper().split()
    start_fs = max(style.min_font_size, int(round(style.font_size_pct * canvas_w)))

    chosen_font = _load_font(start_fs, style.font_paths)
    chosen_lines = _balanced_two_lines(words, chosen_font, meas, max_w, stroke_px)

    # Shrink to fit width (max_w) AND vertical zone (y 130..320) down to min_font_size (or below only if needed for margins)
    fs = start_fs
    while fs >= max(36, int(round(style.min_font_size * scale * 0.75))):
        f_try = _load_font(fs, style.font_paths)
        lines_try = _balanced_two_lines(words, f_try, meas, max_w, stroke_px)
        bboxes = [meas.textbbox((0, 0), ln, font=f_try, stroke_width=stroke_px) for ln in lines_try]
        max_lw = max((b[2] - b[0]) for b in bboxes) if bboxes else 0
        line_h = int(round(fs * style.line_height))
        if len(bboxes) == 1:
            block_h = bboxes[0][3] - bboxes[0][1]
        else:
            block_h = (len(bboxes) - 1) * line_h + (bboxes[-1][3] - bboxes[0][1])
        chosen_font = f_try
        chosen_lines = lines_try
        if max_lw <= max_w and block_h <= zone_h - 4:
            break
        if fs <= int(round(style.min_font_size * scale)) and max_lw <= max_w:
            break
        fs -= 2

    # Compute exact line placements centered vertically in [y_top_lim, y_bot_lim]
    bboxes = [meas.textbbox((0, 0), ln, font=chosen_font, stroke_width=stroke_px) for ln in chosen_lines]
    line_step = int(round(fs * style.line_height))
    rel_top = bboxes[0][1]
    rel_bot = (len(bboxes) - 1) * line_step + bboxes[-1][3]
    total_h = rel_bot - rel_top
    zone_cy = (y_top_lim + y_bot_lim) / 2.0
    base_y0 = int(round(zone_cy - total_h / 2.0 - rel_top))
    # Clamp strictly inside [y_top_lim, y_bot_lim]
    if base_y0 + rel_top < y_top_lim:
        base_y0 = y_top_lim - rel_top
    if base_y0 + rel_bot > y_bot_lim:
        base_y0 = y_bot_lim - rel_bot

    kw_norm = re.sub(r"[^\w'-]+", "", keyword).upper()
    kw_used = False

    # Build masks over full strip (title renders once per clip, so 1080x340 is tiny: ~4ms)
    stroke_mask_img = Image.new("L", (canvas_w, strip_h), 0)
    white_mask_img = Image.new("L", (canvas_w, strip_h), 0)
    kw_mask_img = Image.new("L", (canvas_w, strip_h), 0)
    sh_mask_img = Image.new("L", (canvas_w, strip_h), 0)

    sd = ImageDraw.Draw(stroke_mask_img)
    wd = ImageDraw.Draw(white_mask_img)
    kd = ImageDraw.Draw(kw_mask_img)
    shd = ImageDraw.Draw(sh_mask_img)

    sh_dx = int(round(style.shadow_offset_x_1080 * scale))
    sh_dy = int(round(style.shadow_offset_y_1080 * scale))

    min_x, max_x = canvas_w, 0
    min_y, max_y = strip_h, 0

    for li, ln in enumerate(chosen_lines):
        ly = base_y0 + li * line_step
        lb = meas.textbbox((0, 0), ln, font=chosen_font)
        lw = lb[2] - lb[0]
        lx = int(round((canvas_w - lw) / 2.0)) - lb[0]
        # Guarantee side margins >= side_margin
        if lx + lb[0] - stroke_px < side_margin:
            lx = side_margin - lb[0] + stroke_px
        if lx + lb[2] + stroke_px > canvas_w - side_margin:
            lx = canvas_w - side_margin - lb[2] - stroke_px

        min_x = min(min_x, max(0, lx + lb[0] - stroke_px))
        max_x = max(max_x, min(canvas_w, lx + lb[2] + stroke_px))
        min_y = min(min_y, max(0, ly + lb[1] - stroke_px))
        max_y = max(max_y, min(strip_h, ly + lb[3] + stroke_px))

        # Full line stroke & shadow mask (outside stroke = stroke_width drawn underneath fill)
        sd.text((lx, ly), ln, font=chosen_font, fill=255, stroke_width=stroke_px, stroke_fill=255)
        shd.text((lx + sh_dx, ly + sh_dy), ln, font=chosen_font, fill=255, stroke_width=stroke_px, stroke_fill=255)

        # Draw tokens individually so keyword gets yellow mask & glow
        tokens = ln.split(" ")
        prefix = ""
        for ti, tok in enumerate(tokens):
            if ti > 0:
                prefix += " "
            px_off = int(round(meas.textlength(prefix, font=chosen_font))) if prefix else 0
            tx = lx + px_off
            tok_norm = re.sub(r"[^\w'-]+", "", tok).upper()
            if (not kw_used) and kw_norm and tok_norm == kw_norm:
                kd.text((tx, ly), tok, font=chosen_font, fill=255)
                kw_used = True
            else:
                wd.text((tx, ly), tok, font=chosen_font, fill=255)
            prefix += tok

    # Composite layers bottom -> top:
    # 1. Drop shadow (0, +5) sigma 4 alpha 0.6
    sh_blur = _blur_mask_2d(np.array(sh_mask_img, dtype=np.uint8), style.shadow_sigma_1080 * scale)
    sh_alpha = np.clip(sh_blur.astype(np.float32) * style.shadow_alpha, 0, 255).astype(np.uint8)
    comp = _make_colored_layer((0, 0, 0), sh_alpha)

    # 2. Keyword two-layer glow (wide sigma 9 alpha 0.65 + tight sigma 3 alpha 0.90) in yellow #F5F000
    kw_mask = np.array(kw_mask_img, dtype=np.uint8)
    if kw_mask.max() > 0:
        kw_wide, kw_tight = build_two_layer_glow(
            kw_mask, style.keyword_color, scale,
            style.wide_glow_sigma_1080, style.wide_glow_alpha, style.wide_glow_gain,
            style.tight_glow_sigma_1080, style.tight_glow_alpha, style.tight_glow_gain,
            dilate_px=5,
        )
        comp = _alpha_over(comp, kw_wide)
        comp = _alpha_over(comp, kw_tight)

    # 3. 8px black outside stroke
    stroke_mask = np.array(stroke_mask_img, dtype=np.uint8)
    comp = _alpha_over(comp, _make_colored_layer(style.stroke_color, stroke_mask))

    # 4. Crisp white & yellow fills on top of stroke
    white_mask = np.array(white_mask_img, dtype=np.uint8)
    comp = _alpha_over(comp, _make_colored_layer(style.fill_color, white_mask))
    if kw_mask.max() > 0:
        # Subtle inner tight glow boost over stroke edge around keyword + crisp yellow fill
        comp = _alpha_over(comp, _make_colored_layer(style.keyword_color, kw_mask))

    # Active ROI bounds for fast smear
    glow_pad = max(24, int(math.ceil(style.wide_glow_sigma_1080 * scale * 3.5)))
    ry0 = max(0, min_y - glow_pad)
    ry1 = min(strip_h, max_y + glow_pad)
    rx0 = max(0, min_x - glow_pad)
    rx1 = min(canvas_w, max_x + glow_pad)
    center_x = canvas_w // 2

    return comp, ry0, ry1, rx0, rx1, center_x


def build_title_ffconcat(
    title: str,
    keyword: str,
    fps: float,
    canvas_w: int,
    work_dir: Path,
    style: TitleStyle = DEFAULT_TITLE_STYLE,
    use_disk_cache: bool = True,
) -> Tuple[Path, int, Dict[str, Any]]:
    """
    Generates cached title strip PNGs (smear2, smear1, sharp) and writes a tiny title.ffconcat
    intended for `-r <fps> -f concat -safe 0 -i title.ffconcat` with `overlay=0:0:eof_action=repeat`.
    Returns (ffconcat_path, strip_h, info_dict).
    """
    work_dir.mkdir(parents=True, exist_ok=True)
    if use_disk_cache:
        from openclip_engine.core.config import CACHE_DIR
        cache_dir = resolve_writable_cache_dir(style.sprite_cache_dir, CACHE_DIR / "sprites")
    else:
        cache_dir = work_dir / "title_sprites"
        cache_dir.mkdir(parents=True, exist_ok=True)

    scale = canvas_w / 1080.0
    strip_h = int(round(style.strip_height * scale))
    strip_h += strip_h % 2

    fp = hashlib.sha1(
        f"title_v1|{canvas_w}x{strip_h}|{style.font_size_pct}|{style.stroke_px_1080}|{title}|{keyword}".encode("utf-8")
    ).hexdigest()

    paths = {sm: cache_dir / f"ttl_{fp}_sm{sm}.png" for sm in (2, 1, 0)}
    missing = [sm for sm in (2, 1, 0) if (not use_disk_cache) or (not paths[sm].exists())]

    if missing:
        base_arr, ry0, ry1, rx0, rx1, cx = _render_title_sharp_base(title, keyword, canvas_w, style)
        for sm in missing:
            arr = apply_smear_strip(
                base_arr, ry0, ry1, rx0, rx1, cx, sm, canvas_w,
                style.smear_phase1_sigma_x_1080, style.smear_phase1_scale_x,
                style.smear_phase2_sigma_x_1080, style.smear_phase2_scale_x,
                smear_echo=False,
            )
            _save_png_fast(arr, paths[sm])

    p1_frames = max(1, int(round((style.smear_phase1_ms / 1000.0) * fps)))
    p2_frames = max(1, int(round(((style.smear_phase2_ms - style.smear_phase1_ms) / 1000.0) * fps)))

    lines = ["ffconcat version 1.0"]
    for _ in range(p1_frames):
        lines.append(f"file '{str(paths[2]).replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))}'")
    for _ in range(p2_frames):
        lines.append(f"file '{str(paths[1]).replace(chr(39), chr(92) + chr(39) + chr(39))}'")
    # Steady frame held for entire remainder of clip via overlay eof_action=repeat
    lines.append(f"file '{str(paths[0]).replace(chr(39), chr(92) + chr(39) + chr(39))}'")

    ffconcat_path = work_dir / "title.ffconcat"
    ffconcat_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    return ffconcat_path, strip_h, {
        "title": title,
        "keyword": keyword,
        "sharp_png": str(paths[0]),
        "strip_h": strip_h,
    }
