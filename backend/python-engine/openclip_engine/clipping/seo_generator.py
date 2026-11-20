"""
YouTube SEO Package Generator (`seo_generator.py`):
Generates a complete YouTube Shorts / Reels / Video SEO metadata bundle per clip:
  - `yt_title`    : high-CTR YouTube title (<= 95 chars)
  - `description` : SEO-optimized description with hook, context, CTA, and hashtags
  - `tags`        : 12-16 high-intent YouTube SEO tags (total comma-joined <= 480 chars)
  - `hashtags`    : 6-8 viral & niche hashtags (`#shorts`, topic, creator)

Reuses `openclip_engine.clipping.llm_helper.call_llm_json` with a deterministic non-LLM
fallback so it never fails or blocks rendering.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from openclip_engine.clipping.llm_helper import call_llm_json

_STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "have", "what", "when", "where",
    "your", "they", "them", "there", "their", "about", "just", "like", "here", "into",
    "over", "then", "than", "some", "more", "very", "been", "were", "will", "would",
    "could", "should", "dont", "cant", "wont", "youre", "thats", "im", "its", "okay",
    "yeah", "gonna", "wanna", "gotta", "really", "actually", "literally", "going", "doing",
    "video", "youtube", "clip", "watch", "official", "full", "episode", "part", "2026", "2025",
}


def _clean_text(raw: str) -> str:
    txt = re.sub(r"[\u0900-\u097f]+", "", str(raw or ""))
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt.strip('"\'')


def _extract_keywords(video_title: str, uploader: str, transcript: str, limit: int = 12) -> List[str]:
    found: List[str] = []
    seen: set[str] = set()

    def _add(term: str) -> None:
        t = re.sub(r"[^a-zA-Z0-9\s]+", "", term).strip().lower()
        t = re.sub(r"\s+", " ", t)
        if not t or len(t) < 2 or t in _STOPWORDS or t in seen:
            return
        seen.add(t)
        found.append(t)

    # Creator name first (strongest search intent)
    if uploader and uploader.lower() not in {"youtube creator", "unknown"}:
        _add(uploader)

    # Multi-word capitalized phrases / game titles from video title (e.g. "GTA 6", "Vice City", "Hunger Games")
    clean_vt = re.sub(r"\b20\d\d-\d\d-\d\d\b.*", "", video_title or "")
    for m in re.finditer(r"\b(?:[A-Z][A-Za-z0-9]*(?:\s+[A-Z0-9][A-Za-z0-9]*){0,2})\b", clean_vt):
        phrase = m.group(0).strip()
        if len(phrase) >= 3 and phrase.lower() not in _STOPWORDS:
            _add(phrase)

    # Single meaningful words from video title then transcript
    for src in (clean_vt, transcript):
        for tk in re.findall(r"[a-zA-Z0-9]{3,}", src or ""):
            low = tk.lower()
            if low not in _STOPWORDS:
                _add(low)
            if len(found) >= limit:
                return found[:limit]
    return found[:limit]


def _sanitize_seo_package(
    raw: Dict[str, Any],
    fallback: Dict[str, Any],
    is_vertical: bool,
    is_live: bool,
) -> Dict[str, Any]:
    yt_title = _clean_text(str(raw.get("yt_title") or raw.get("title") or ""))
    if len(yt_title) < 6:
        yt_title = fallback["yt_title"]
    if len(yt_title) > 95:
        yt_title = yt_title[:92].rsplit(" ", 1)[0].rstrip(" ,;:-") + "..."

    # Clean hashtags (#alnum, lowercase, 5-8 items)
    raw_hashes = raw.get("hashtags") if isinstance(raw.get("hashtags"), list) else []
    hashtags: List[str] = []
    seen_h: set[str] = set()
    for h in list(raw_hashes) + list(fallback["hashtags"]):
        tok = re.sub(r"[^a-zA-Z0-9]+", "", str(h or "")).lower()
        if not tok or len(tok) < 2 or tok in seen_h:
            continue
        seen_h.add(tok)
        hashtags.append(f"#{tok}")
        if len(hashtags) >= 7:
            break
    if is_vertical and "#shorts" not in hashtags:
        hashtags.insert(0, "#shorts")
        hashtags = hashtags[:8]
    if is_live and "#live" not in hashtags and len(hashtags) < 8:
        hashtags.append("#live")

    # Clean tags (12-16 items, total comma-joined <= 480 chars — strictly within YouTube's 500-char limit)
    raw_tags = raw.get("tags") if isinstance(raw.get("tags"), list) else []
    tags: List[str] = []
    seen_t: set[str] = set()
    total_chars = 0
    for tg in list(raw_tags) + list(fallback["tags"]):
        t = re.sub(r"[^a-zA-Z0-9\s]+", "", str(tg or "")).strip().lower()
        t = re.sub(r"\s+", " ", t)
        if not t or len(t) < 2 or len(t) > 40 or t in seen_t:
            continue
        add_len = len(t) + (2 if tags else 0)
        if total_chars + add_len > 480:
            break
        seen_t.add(t)
        tags.append(t)
        total_chars += add_len
        if len(tags) >= 16:
            break

    desc = _clean_text(str(raw.get("description") or ""))
    if len(desc) < 20:
        desc = fallback["description"]
    # Ensure hashtags appear cleanly at the end of description
    if "#" not in desc:
        desc = f"{desc}\n\n{' '.join(hashtags[:6])}"

    return {
        "yt_title": yt_title,
        "description": desc,
        "tags": tags,
        "hashtags": hashtags,
    }


def _fallback_seo(
    transcript: str,
    video_title: str,
    uploader: str,
    hook_sentence: str,
    is_live: bool,
    is_vertical: bool,
) -> Dict[str, Any]:
    clean_vt = _clean_text(re.sub(r"\b20\d\d-\d\d-\d\d\b.*", "", video_title or ""))
    clean_tr = _clean_text(transcript)
    clean_hook = _clean_text(hook_sentence)
    kws = _extract_keywords(clean_vt, uploader, clean_tr, limit=14)

    # Punchy fallback YouTube title
    lead = clean_hook or (clean_tr.split(".")[0].strip() if clean_tr else clean_vt)
    lead = re.sub(r"\s+", " ", lead).strip()
    if len(lead) > 58:
        lead = lead[:55].rsplit(" ", 1)[0]
    topic_suffix = ""
    if uploader and uploader.lower() not in lead.lower() and uploader.lower() != "youtube creator":
        topic_suffix = f" | {uploader}"
    elif clean_vt and len(clean_vt) <= 30 and clean_vt.lower() not in lead.lower():
        topic_suffix = f" | {clean_vt}"
    yt_title = f"{lead}{topic_suffix}".strip() or clean_vt or "Insane Viral Moment"
    if len(yt_title) > 95:
        yt_title = yt_title[:92].rsplit(" ", 1)[0] + "..."

    # Hashtags
    hashtags: List[str] = []
    if is_vertical:
        hashtags.append("#shorts")
    if is_live:
        hashtags.append("#livestream")
    for kw in kws:
        h = "#" + re.sub(r"\s+", "", kw)
        if h not in hashtags and 3 <= len(h) <= 24:
            hashtags.append(h)
        if len(hashtags) >= 6:
            break
    for extra in ("#viral", "#trending", "#clips"):
        if len(hashtags) < 7 and extra not in hashtags:
            hashtags.append(extra)

    # Tags
    tags: List[str] = []
    for base in (
        kws
        + ([f"{uploader.lower()} clips", f"{uploader.lower()} live"] if uploader and uploader.lower() != "youtube creator" else [])
        + (["youtube shorts", "shorts", "viral shorts"] if is_vertical else ["viral clip", "highlights"])
        + (["live stream highlights", "livestream clips"] if is_live else ["viral moments", "best moments"])
    ):
        t = base.strip().lower()
        if t and t not in tags:
            tags.append(t)

    excerpt = (clean_tr[:180].rsplit(" ", 1)[0] + "...") if len(clean_tr) > 180 else clean_tr
    source_line = f"Clipped from {uploader}'s {'live stream' if is_live else 'video'}: {clean_vt}." if uploader and uploader.lower() != "youtube creator" else f"From: {clean_vt}."
    desc_parts = [p for p in [excerpt, source_line, "Like & subscribe for more daily highlights!", " ".join(hashtags[:6])] if p]
    description = "\n\n".join(desc_parts)

    return {
        "yt_title": yt_title,
        "description": description,
        "tags": tags[:16],
        "hashtags": hashtags[:7],
    }


def generate_clip_seo(
    transcript: str,
    video_title: str,
    uploader: str = "",
    hook_sentence: str = "",
    is_live: bool = False,
    aspect_ratio: str = "9:16",
    use_llm: bool = True,
    custom_context: str = "",
) -> Dict[str, Any]:
    """
    Generates a full YouTube SEO metadata bundle (`yt_title`, `description`, `tags`, `hashtags`)
    tailored specifically to what happened in THIS clip (never generic stream-title copy-paste).
    """
    is_vertical = aspect_ratio in ("9:16", "4:5", "3:4")
    fallback = _fallback_seo(transcript, video_title, uploader, hook_sentence, is_live, is_vertical)
    if not use_llm:
        return _sanitize_seo_package(fallback, fallback, is_vertical, is_live)

    custom_block = (
        f"Custom creator/moment note (PRIORITIZE THIS): {custom_context.strip()[:260]}\n"
        if (custom_context or "").strip()
        else ""
    )
    prompt = (
        "Generate a HIGH-CTR, CUSTOM YouTube "
        f"{'Shorts ' if is_vertical else ''}SEO metadata package in ENGLISH specifically about WHAT HAPPENED in THIS exact clip.\n"
        f"Creator/Streamer: {uploader or 'Creator'}\n"
        f"Is Live Stream: {is_live}\n"
        f"{custom_block}"
        f"Source stream/video title (context ONLY — DO NOT copy this phrase verbatim as the title!): {video_title[:160]}\n"
        f"Clip opening hook: {hook_sentence[:180]}\n"
        f"Clip spoken transcript (build the title & description directly from what actually happens here!): {transcript[:650]}\n\n"
        "Strict Rules:\n"
        "- yt_title: <= 75 chars, custom & specific to THIS clip's unique moment/reaction/dialogue with the creator! "
        "NEVER start with generic boilerplate like '<Creator> Plays <Stream Title>' — lead with the specific funny/wild/shocking thing that happened (e.g. 'When GTA 6 Threatened to Charge IShowSpeed Rent! 💀' or 'IShowSpeed Couldn\\'t Believe This GTA 6 Scene!').\n"
        "- description: 2-3 punchy English sentences explaining what specifically happened with the creator in THIS clip (using details from the transcript/custom note) + natural SEO keywords + subscribe CTA + 5 hashtags at the bottom.\n"
        "- tags: 12-16 high-intent lowercase YouTube search tags specific to this creator, the exact moment/topic, game/event, and clips/shorts search queries (no '#' symbol, no generic filler words like 'playing' or 'get in here').\n"
        "- hashtags: 6-7 relevant hashtags starting with '#' (include #shorts if vertical, creator tag, topic tag).\n"
        "Return ONLY valid JSON: "
        '{"yt_title": str, "description": str, "tags": [str, ...], "hashtags": [str, ...]}'
    )
    sys_prompt = "You are a top viral YouTube Shorts & streamer-clip SEO strategist. Every clip MUST get a unique, moment-specific title and description — never repeat the generic livestream title. Return ONLY raw valid JSON in English."

    try:
        res = call_llm_json(prompt, system_prompt=sys_prompt)
        if isinstance(res, dict) and res:
            return _sanitize_seo_package(res, fallback, is_vertical, is_live)
    except Exception:
        pass
    return _sanitize_seo_package(fallback, fallback, is_vertical, is_live)


def write_clip_seo_json(clip_mp4_path: Path, seo: Dict[str, Any]) -> Path:
    seo_path = Path(f"{clip_mp4_path}.seo.json")
    seo_path.write_text(json.dumps(seo, indent=2, ensure_ascii=False), encoding="utf-8")
    return seo_path
