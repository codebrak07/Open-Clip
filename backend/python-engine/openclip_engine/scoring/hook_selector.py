"""
M6a Hook-Aware Clip Selection Pipeline (`hook_selector.py`):
Single selection pipeline shared by both CLI and backend.
  1. Build sentence utterances from word-level transcript (punctuation + pauses > 0.4 s).
  2. Generate candidates of {15, 20, 30, 45, 60} s (clipped to [min_dur, max_dur], stride 3 s),
     START snapped to a sentence start, END snapped to a sentence end (no mid-sentence starts).
  3. Cheap deterministic local score weighted toward the FIRST 3 s + filler/dangling/sponsor penalties.
  4. Multi-provider LLM judge on top 12 candidates (>=2 providers, temp 0, per-provider shuffled order,
     strict JSON schema validation, rules-only fallback when all providers fail).
  5. `refine_start()`: inside first 12 s of winning window, move start to strongest hook sentence
     (word boundary, 0.15 s pre-roll, strip leading filler, max 5 s lead-in only if needed).
  6. Dedup overlapping > 50% with a higher-ranked clip.
  7. Transparency: write `analysis_report.json` + `hook_debug.md` + `--explain` summary.
  8. Controls: `--hook-mode strict|balanced|loose`, `--hook-hint`, manual `--start/--end`.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
import re
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np

from openclip_engine.clipping.llm_helper import call_provider_json, list_configured_providers

PIPELINE_VERSION = "m6a_hook_selector_v1"

# ─────────────────────── Linguistic Feature Tables ───────────────────────
_ABSOLUTES = {
    "never", "nobody", "nothing", "everything", "everyone", "everybody", "only",
    "always", "zero", "impossible", "worst", "best", "secret", "literally", "forever",
    "every", "single", "all", "none", "first", "last",
}
_SECOND_PERSON = {"you", "your", "you're", "youre", "you've", "you'll", "yourself"}
_CONFLICT_STAKES = {
    "eliminate", "eliminated", "destroy", "destroyed", "lose", "lost", "die", "dead",
    "banned", "fired", "broke", "wrong", "mistake", "war", "fight", "trap", "bet",
    "risk", "dangerous", "illegal", "crash", "quit", "failed", "fail", "kill", "survive",
    "stolen", "stole", "scam", "lie", "lied", "truth", "insane", "crazy", "shocking",
    "caught", "arrested", "ruined", "million", "billion", "win", "won", "danger",
}
_CONTRAST_PIVOTS = {"but", "until", "without", "except", "instead", "unless", "however"}
_CURIOSITY_PATTERNS = [
    re.compile(r"\bhere'?s\s+why\b", re.I),
    re.compile(r"\bhere\s+is\s+why\b", re.I),
    re.compile(r"\bthe\s+reason\b", re.I),
    re.compile(r"\bwait\s+until\b", re.I),
    re.compile(r"\bnobody\s+(?:talks|knows|tells|told)\b", re.I),
    re.compile(r"\bwhat\s+happens\b", re.I),
    re.compile(r"\byou\s+(?:won'?t|wouldn'?t)\s+believe\b", re.I),
    re.compile(r"\bturned\s+out\b", re.I),
    re.compile(r"\bthe\s+truth\b", re.I),
    re.compile(r"\bplot\s+twist\b", re.I),
    re.compile(r"\bthe\s+secret\b", re.I),
    re.compile(r"\bmost\s+people\s+don'?t\b", re.I),
]
_QUESTION_LEADS = {"why", "how", "what", "did", "can", "could", "would", "have", "do", "does", "is", "are", "who", "which"}

_LEADING_FILLER_PHRASES = [
    re.compile(r"^\s*(?:hey\s+guys|hey\s+everyone|hello\s+everyone|what'?s\s+up\s+guys|welcome\s+back(?:\s+guys|\s+everyone|\s+everybody)?)\b", re.I),
    re.compile(r"^\s*(?:okay\s+so|ok\s+so|alright\s+so|so\s+um|so\s+uh|um|uh|so|well|okay|ok|alright)\b", re.I),
    re.compile(r"^\s*(?:in\s+this\s+video|today\s+we'?re\s+going\s+to|today\s+i'?m\s+going\s+to)\b", re.I),
]
_FILLER_WORDS = {
    "so", "um", "uh", "uhh", "umm", "okay", "ok", "alright", "well", "hey", "hi", "hello",
    "guys", "everyone", "everybody", "welcome", "back", "like", "yeah", "yo", "whats", "what's", "up",
}
_DANGLING_REF_PATTERNS = [
    re.compile(r"^\s*(?:and\s+then\s+(?:he|she|they|it|we|i)|that'?s\s+why|this\s+is\s+why|which\s+means|so\s+(?:he|she|they|it)\b|as\s+i\s+said|like\s+i\s+mentioned|going\s+back\s+to|speaking\s+of\s+that|because\s+of\s+that)\b", re.I),
]
_SPONSOR_PATTERNS = [
    re.compile(r"\bsponsored\s+by\b", re.I),
    re.compile(r"\btoday'?s\s+sponsor\b", re.I),
    re.compile(r"\buse\s+(?:my\s+)?(?:promo\s+)?code\b", re.I),
    re.compile(r"\blink\s+in\s+(?:the\s+)?description\b", re.I),
    re.compile(r"\b(?:smash|hit)\s+(?:that\s+)?(?:like|subscribe|bell)\b", re.I),
    re.compile(r"\bsubscribe\s+to\s+(?:the\s+|my\s+)?channel\b", re.I),
    re.compile(r"\bdon'?t\s+forget\s+to\s+subscribe\b", re.I),
    re.compile(r"\bthanks\s+for\s+watching\b", re.I),
    re.compile(r"\bsee\s+you\s+in\s+the\s+next\b", re.I),
    re.compile(r"\bcheck\s+out\s+the\s+link\b", re.I),
]


@dataclass
class Utterance:
    index: int
    start: float
    end: float
    text: str
    words: List[Dict[str, Any]]
    starts_clean_sentence: bool = True


@dataclass
class HookCandidate:
    id: str
    start: float
    end: float
    start_utt_idx: int
    end_utt_idx: int
    text: str
    first_3s_text: str
    hook_sentence: str
    local_score: float
    local_features: Dict[str, Any] = field(default_factory=dict)
    hook_3s: float = 0.0
    standalone: float = 0.0
    payoff: float = 0.0
    intensity: float = 0.0
    hook_start_t: Optional[float] = None
    final_score: float = 0.0
    reason: str = ""
    provider_scores: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    refined_start: Optional[float] = None
    refined_end: Optional[float] = None
    is_sentence_boundary: bool = True


# ─────────────────────── 1. Utterance Builder ───────────────────────
def build_utterances(
    words: Sequence[Dict[str, Any]],
    pause_threshold_s: float = 0.4,
) -> List[Utterance]:
    """Builds sentence utterances from word-level timestamps using punctuation + pauses > 0.4 s."""
    norm_words: List[Dict[str, Any]] = []
    for item in words:
        raw = str(item.get("word") if "word" in item else item.get("text", "")).strip()
        if not raw:
            continue
        st = float(item["start"])
        en = float(item.get("end", st + 0.12))
        norm_words.append({"word": raw, "start": st, "end": max(st + 0.02, en)})

    if not norm_words:
        return []
    norm_words.sort(key=lambda w: w["start"])

    utterances: List[Utterance] = []
    buf: List[Dict[str, Any]] = []

    def _flush() -> None:
        if not buf:
            return
        txt = " ".join(w["word"] for w in buf).strip()
        utterances.append(Utterance(
            index=len(utterances),
            start=buf[0]["start"],
            end=buf[-1]["end"],
            text=txt,
            words=list(buf),
            starts_clean_sentence=True,
        ))
        buf.clear()

    for i, w in enumerate(norm_words):
        if buf:
            gap = w["start"] - buf[-1]["end"]
            if gap > pause_threshold_s:
                _flush()
        buf.append(w)
        # Split on terminal sentence punctuation
        if re.search(r"[.?!][\"')\]]*$", w["word"]):
            _flush()
        elif len(buf) >= 24:
            # Cap ultra-long unpunctuated runs cleanly
            _flush()
    _flush()
    return utterances


# ─────────────────────── 2. Candidate Window Generator ───────────────────────
def generate_candidates(
    utterances: Sequence[Utterance],
    window_sizes: Sequence[float] = (15.0, 20.0, 30.0, 45.0, 60.0),
    min_dur: float = 12.0,
    max_dur: float = 60.0,
    stride_s: float = 3.0,
) -> List[HookCandidate]:
    """
    Generates candidate windows of {15,20,30,45,60} s clipped to [min_dur, max_dur], stride 3 s,
    START snapped to a sentence start, END snapped to a sentence end. Drops mid-sentence starts.
    """
    if not utterances:
        return []

    total_start = utterances[0].start
    total_end = utterances[-1].end
    total_span = max(0.0, total_end - total_start)
    if total_span < 3.0:
        return []

    # Adapt min_dur cleanly for very short videos (< 15s) so unit tests / short clips still work
    eff_min_dur = min(min_dur, max(3.0, total_span * 0.5))

    seen_pairs: set[Tuple[int, int]] = set()
    cands: List[HookCandidate] = []

    t_cur = total_start
    while t_cur <= max(total_start, total_end - eff_min_dur + 1.0):
        # Snap START to the nearest sentence start (strictly on a sentence boundary, never mid-sentence)
        start_idx = None
        for u in utterances:
            if u.start >= t_cur - 0.5:
                # Drop if t_cur is strictly inside a sentence (>1.2s past its start)
                start_idx = u.index
                break
        if start_idx is None:
            break
        u_start = utterances[start_idx]
        if not u_start.starts_clean_sentence:
            t_cur += stride_s
            continue

        for win in window_sizes:
            target_dur = max(eff_min_dur, min(max_dur, float(win)))
            target_end = u_start.start + target_dur

            # Snap END to the closest sentence end within [eff_min_dur, max_dur]
            best_end_idx = None
            best_err = float("inf")
            for u in utterances[start_idx:]:
                d = u.end - u_start.start
                if d < eff_min_dur - 1e-3:
                    continue
                if d > max_dur + 2.0:
                    break
                err = abs(u.end - target_end)
                if err < best_err:
                    best_err = err
                    best_end_idx = u.index

            if best_end_idx is None:
                continue
            pair = (start_idx, best_end_idx)
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)

            slice_utts = utterances[start_idx : best_end_idx + 1]
            c_start = slice_utts[0].start
            c_end = slice_utts[-1].end
            full_text = " ".join(u.text for u in slice_utts)
            # First 3 seconds words
            w3: List[str] = []
            for u in slice_utts:
                for w in u.words:
                    if w["start"] <= c_start + 3.0:
                        w3.append(w["word"])
            first_3s = " ".join(w3) if w3 else slice_utts[0].text

            cands.append(HookCandidate(
                id=f"cand_{len(cands) + 1:03d}",
                start=round(c_start, 3),
                end=round(c_end, 3),
                start_utt_idx=start_idx,
                end_utt_idx=best_end_idx,
                text=full_text,
                first_3s_text=first_3s,
                hook_sentence=slice_utts[0].text,
                local_score=0.0,
                is_sentence_boundary=True,
            ))
        t_cur += stride_s

    return cands


# ─────────────────────── 3. Deterministic Local Hook Scoring ───────────────────────
def _probe_audio_rms_profile(video_path: Optional[Path], duration: float, ffmpeg_bin: str = "ffmpeg") -> Optional[np.ndarray]:
    """Fast 1-second RMS energy envelope at 8 kHz mono (optional; returns None if unavailable)."""
    if not video_path or not video_path.exists():
        return None
    try:
        res = subprocess.run(
            [ffmpeg_bin, "-v", "error", "-i", str(video_path), "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"],
            capture_output=True,
            timeout=20,
        )
        if res.returncode != 0 or not res.stdout:
            return None
        pcm = np.frombuffer(res.stdout, dtype=np.float32)
        n_sec = max(1, len(pcm) // 8000)
        trimmed = pcm[: n_sec * 8000].reshape(n_sec, 8000)
        return np.sqrt(np.mean(trimmed * trimmed, axis=1) + 1e-12)
    except Exception:
        return None


def is_sponsor_text(text: str) -> bool:
    return any(p.search(text) for p in _SPONSOR_PATTERNS)


def score_sentence_hook(text: str) -> Tuple[float, Dict[str, Any]]:
    """Scores a single sentence / 3s opening for scroll-stopping hook strength (0..10)."""
    t = (text or "").strip()
    if not t:
        return 0.0, {"empty": True}

    tokens_raw = t.split()
    tokens = [re.sub(r"[^a-zA-Z0-9'$%]+", "", w).lower() for w in tokens_raw]
    tokens = [tk for tk in tokens if tk]

    score = 3.2
    feats: Dict[str, Any] = {}

    # Positive hook features
    has_q = ("?" in t) or (bool(tokens) and tokens[0] in _QUESTION_LEADS)
    if has_q:
        score += 1.8
        feats["question"] = True

    has_num = bool(re.search(r"(?:\$\d|\d+%|\b\d{2,}\b|\b(?:million|billion|thousand)\b|#\d)", t, re.I))
    if has_num:
        score += 1.6
        feats["number_stat"] = True

    abs_hits = [tk for tk in tokens if tk in _ABSOLUTES]
    if abs_hits:
        score += min(1.5, 0.9 + 0.3 * (len(abs_hits) - 1))
        feats["absolutes"] = abs_hits[:3]

    if any(tk in _SECOND_PERSON for tk in tokens):
        score += 0.9
        feats["second_person"] = True

    conflict_hits = [tk for tk in tokens if tk in _CONFLICT_STAKES]
    if conflict_hits:
        score += min(2.2, 1.3 + 0.45 * (len(conflict_hits) - 1))
        feats["conflict_stakes"] = conflict_hits[:3]

    if any(p.search(t) for p in _CURIOSITY_PATTERNS):
        score += 1.8
        feats["curiosity_gap"] = True

    if any(tk in _CONTRAST_PIVOTS for tk in tokens):
        score += 0.8
        feats["contrast_pivot"] = True

    if "!" in t:
        score += 0.5
        feats["exclamation"] = True

    # Penalties
    if any(p.search(t) for p in _LEADING_FILLER_PHRASES):
        score -= 2.8
        feats["penalty_leading_filler"] = True

    if any(p.search(t) for p in _DANGLING_REF_PATTERNS):
        score -= 2.2
        feats["penalty_dangling_ref"] = True

    if is_sponsor_text(t):
        score -= 6.5
        feats["penalty_sponsor"] = True

    return round(max(0.0, min(10.0, score)), 3), feats


def score_candidate_local(
    cand: HookCandidate,
    utterances: Sequence[Utterance],
    rms_per_sec: Optional[np.ndarray] = None,
    scene_cuts: Sequence[float] = (),
    hook_hint: Optional[str] = None,
    person_visible_times: Optional[Sequence[float]] = None,
) -> float:
    """Deterministic local score (0..10), heavily weighted toward the FIRST 3 s."""
    s3_score, feats = score_sentence_hook(cand.first_3s_text)

    # Whole-clip sponsor check (reject ad reads anywhere in the candidate!)
    if is_sponsor_text(cand.text):
        s3_score = max(0.0, s3_score - 5.5)
        feats["penalty_clip_sponsor"] = True

    # Speech rate in first 3 s
    n_w3 = len(cand.first_3s_text.split())
    wps = n_w3 / 3.0
    feats["first_3s_wps"] = round(wps, 2)
    if 2.0 <= wps <= 4.5:
        s3_score += 0.6
    elif wps < 1.0:
        s3_score -= 1.5
        feats["penalty_silent_or_slow_start"] = True

    # Silent start check (gap before first word in opening utterance)
    u0 = utterances[cand.start_utt_idx]
    if u0.words and (u0.words[0]["start"] - cand.start) > 0.8:
        s3_score -= 1.8
        feats["penalty_silent_start"] = True

    # Audio energy peak in first 3 s vs clip median
    if rms_per_sec is not None and rms_per_sec.size > 0:
        i0 = max(0, min(rms_per_sec.size - 1, int(cand.start)))
        i1 = max(i0 + 1, min(rms_per_sec.size, int(math.ceil(cand.start + 3.0))))
        ic1 = max(i1, min(rms_per_sec.size, int(math.ceil(cand.end))))
        first3_peak = float(np.max(rms_per_sec[i0:i1]))
        clip_med = float(np.median(rms_per_sec[i0:ic1])) + 1e-6
        ratio = first3_peak / clip_med
        feats["audio_energy_ratio"] = round(ratio, 2)
        if ratio >= 1.35:
            s3_score += 0.6
        elif first3_peak < 0.005:
            s3_score -= 1.2
            feats["penalty_quiet_start"] = True

    # Scene-cut density inside clip
    if scene_cuts:
        cuts_in = [ct for ct in scene_cuts if cand.start <= ct <= cand.end]
        dur = max(1.0, cand.end - cand.start)
        density = len(cuts_in) / (dur / 10.0)
        feats["scene_cuts_per_10s"] = round(density, 2)
        if 0.5 <= density <= 4.0:
            s3_score += 0.4

    # Person/face visible in first second
    if person_visible_times is not None:
        vis = any(cand.start <= t <= cand.start + 1.0 for t in person_visible_times)
        feats["person_in_first_sec"] = vis
        if vis:
            s3_score += 0.5

    # Payoff / ending strength (ends cleanly on sentence punctuation)
    if re.search(r"[.?!][\"')\]]*$", cand.text.strip()):
        s3_score += 0.3

    # Hook hint match boost (`--hook-hint`)
    if hook_hint and hook_hint.strip():
        hint_tokens = {
            re.sub(r"[^a-z0-9]+", "", tk).lower()
            for tk in hook_hint.split()
            if len(re.sub(r"[^a-z0-9]+", "", tk)) >= 3
        }
        if hint_tokens:
            cand_low = cand.text.lower()
            f3_low = cand.first_3s_text.lower()
            matched_all = sum(1 for tk in hint_tokens if tk in cand_low)
            matched_f3 = sum(1 for tk in hint_tokens if tk in f3_low)
            hint_ratio = (matched_all + 1.5 * matched_f3) / (len(hint_tokens) * 2.5)
            feats["hook_hint_match"] = round(hint_ratio, 3)
            s3_score += hint_ratio * 4.0

    cand.local_score = round(max(0.0, min(10.0, s3_score)), 3)
    cand.local_features = feats
    return cand.local_score


# ─────────────────────── 4. Multi-Provider LLM Judge ───────────────────────
def validate_judge_item(item: Any, valid_ids: set[str]) -> Optional[Dict[str, Any]]:
    """Strict JSON schema validator for LLM hook judge items."""
    if not isinstance(item, dict):
        return None
    cid = str(item.get("id", "")).strip()
    if cid not in valid_ids:
        return None
    try:
        hook_3s = float(item["hook_3s"])
        standalone = float(item["standalone"])
        payoff = float(item["payoff"])
        intensity = float(item["intensity"])
        hook_start_t = float(item["hook_start_t"])
    except Exception:
        return None
    for v in (hook_3s, standalone, payoff, intensity):
        if not (0.0 <= v <= 10.0) or math.isnan(v):
            return None
    if math.isnan(hook_start_t) or hook_start_t < 0.0:
        return None
    reason = str(item.get("reason", "")).strip()
    if not reason:
        return None
    return {
        "id": cid,
        "hook_3s": hook_3s,
        "standalone": standalone,
        "payoff": payoff,
        "intensity": intensity,
        "hook_start_t": hook_start_t,
        "reason": reason[:240],
    }


def shuffle_for_provider(candidates: Sequence[HookCandidate], provider_name: str, seed: int = 42) -> List[HookCandidate]:
    """Deterministically shuffles candidate order per provider to eliminate LLM position bias."""
    items = list(candidates)
    h = hashlib.sha256(f"{seed}:{provider_name}".encode("utf-8")).digest()
    rng = random.Random(int.from_bytes(h[:8], "big"))
    rng.shuffle(items)
    return items


def judge_candidates_llm(
    top_candidates: Sequence[HookCandidate],
    providers: Optional[Sequence[str]] = None,
    hook_hint: Optional[str] = None,
    llm_caller: Optional[Callable[[str, str, str, float], Any]] = None,
    seed: int = 42,
) -> Tuple[List[str], Dict[str, int]]:
    """
    Judges top <=12 candidates across >=2 providers (temperature=0, shuffled order per provider).
    Updates candidate LLM subscores + weighted final_score in-place.
    Falls back cleanly to rules-only if all providers fail.
    Returns (providers_succeeded, provider_valid_counts).
    """
    if not top_candidates:
        return [], {}

    chosen_providers = list(providers) if providers is not None else list_configured_providers()
    caller = llm_caller or (lambda p, pr, sp, temp: call_provider_json(p, pr, system_prompt=sp, temperature=temp))
    valid_ids = {c.id for c in top_candidates}
    by_id = {c.id: c for c in top_candidates}

    sys_prompt = (
        "You are an expert short-form viral clip editor. Judge each candidate strictly on whether "
        "its FIRST 3 SECONDS stop a viewer scrolling (bold claim, question, surprising stat, stakes/conflict, "
        "cliffhanger, pattern interrupt — NOT an intro, greeting, filler, or sponsor read) AND delivers a "
        "self-contained payoff. Return ONLY a raw JSON array."
    )

    succeeded: List[str] = []
    valid_counts: Dict[str, int] = {}

    for pname in chosen_providers:
        shuffled = shuffle_for_provider(top_candidates, pname, seed=seed)
        blocks = []
        for c in shuffled:
            blocks.append(
                f'- id: "{c.id}" | window: {c.start:.2f}s-{c.end:.2f}s\n'
                f'  first_3s: "{c.first_3s_text}"\n'
                f'  transcript: "{c.text[:480]}"'
            )
        hint_line = f"\nUser hook hint (prioritize moments matching this): {hook_hint}\n" if hook_hint else ""
        prompt = (
            f"Score every candidate below.{hint_line}\n"
            "Return ONLY a JSON array of objects with EXACT schema:\n"
            '[{"id": str, "hook_3s": 0..10, "standalone": 0..10, "payoff": 0..10, '
            '"intensity": 0..10, "hook_start_t": float_seconds, "reason": str}]\n\n'
            + "\n".join(blocks)
        )
        try:
            raw = caller(pname, prompt, sys_prompt, 0.0)
        except Exception:
            raw = None

        items = raw.get("candidates") if isinstance(raw, dict) and isinstance(raw.get("candidates"), list) else raw
        if not isinstance(items, list):
            continue

        validated: List[Dict[str, Any]] = []
        for it in items:
            v = validate_judge_item(it, valid_ids)
            if v is not None:
                validated.append(v)

        if validated:
            succeeded.append(pname)
            valid_counts[pname] = len(validated)
            for v in validated:
                by_id[v["id"]].provider_scores[pname] = v

    # Aggregate final scores across providers (or rules-only fallback)
    for c in top_candidates:
        if c.provider_scores:
            per_prov_finals = []
            h3s, stas, pays, ints, starts = [], [], [], [], []
            reasons = []
            for pname, v in c.provider_scores.items():
                f_score = (
                    0.35 * v["hook_3s"]
                    + 0.20 * v["standalone"]
                    + 0.20 * v["payoff"]
                    + 0.15 * v["intensity"]
                    + 0.10 * c.local_score
                )
                per_prov_finals.append(f_score)
                h3s.append(v["hook_3s"])
                stas.append(v["standalone"])
                pays.append(v["payoff"])
                ints.append(v["intensity"])
                if c.start - 1.0 <= v["hook_start_t"] <= c.end - 3.0:
                    starts.append(v["hook_start_t"])
                reasons.append(f"[{pname}] {v['reason']}")
            c.hook_3s = round(sum(h3s) / len(h3s), 3)
            c.standalone = round(sum(stas) / len(stas), 3)
            c.payoff = round(sum(pays) / len(pays), 3)
            c.intensity = round(sum(ints) / len(ints), 3)
            c.hook_start_t = round(sum(starts) / len(starts), 3) if starts else None
            c.final_score = round(sum(per_prov_finals) / len(per_prov_finals), 3)
            c.reason = " | ".join(reasons)
        else:
            # Rules-only fallback
            c.hook_3s = c.local_score
            c.standalone = round(max(0.0, min(10.0, c.local_score - (2.0 if c.local_features.get("penalty_dangling_ref") else 0.0))), 3)
            c.payoff = round(min(10.0, c.local_score * 0.9), 3)
            c.intensity = round(min(10.0, c.local_score * 0.85), 3)
            c.final_score = c.local_score
            c.reason = f"[rules] local_score={c.local_score:.2f} features={list(c.local_features.keys())[:5]}"

    return succeeded, valid_counts


# ─────────────────────── 5. refine_start() ───────────────────────
def refine_start(
    cand: HookCandidate,
    utterances: Sequence[Utterance],
    min_dur: float = 10.0,
    pre_roll_s: float = 0.15,
    search_window_s: float = 12.0,
    max_lead_in_s: float = 5.0,
) -> Tuple[float, float, str]:
    """
    Inside the first 12 s of the winning window:
      - Finds the strongest hook sentence and moves start there (word boundary, 0.15 s pre-roll).
      - Strips leading filler/greeting words ("so", "um", "welcome back guys", etc.).
      - Keeps at most 5 s of lead-in, ONLY if the hook sentence has a setup dependency.
      - Ends cleanly on a sentence end at the payoff/cliffhanger.
    Returns (refined_start, refined_end, hook_sentence).
    """
    slice_utts = [u for u in utterances if u.index >= cand.start_utt_idx and u.index <= cand.end_utt_idx]
    if not slice_utts:
        return cand.start, cand.end, cand.hook_sentence

    win_start = slice_utts[0].start
    win_end = slice_utts[-1].end
    first_12_utts = [u for u in slice_utts if u.start <= win_start + search_window_s]
    if not first_12_utts:
        first_12_utts = [slice_utts[0]]

    # Score every sentence in the first 12 s (favoring LLM hook_start_t if provided)
    best_u = first_12_utts[0]
    best_sc = -999.0
    for u in first_12_utts:
        # Must leave enough clip remaining (unless only 1 utterance)
        if len(first_12_utts) > 1 and (win_end - u.start) < min(min_dur, (win_end - win_start) * 0.45):
            continue
        sc, _ = score_sentence_hook(u.text)
        if cand.hook_start_t is not None and abs(u.start - cand.hook_start_t) <= 1.5:
            sc += 1.2
        if sc > best_sc:
            best_sc = sc
            best_u = u

    # Strip leading filler / greeting words on a clean word boundary inside best_u
    chosen_words = list(best_u.words)
    first_non_filler_idx = 0
    while first_non_filler_idx < len(chosen_words) - 1:
        w_clean = re.sub(r"[^a-zA-Z']+", "", chosen_words[first_non_filler_idx]["word"]).lower()
        if w_clean in _FILLER_WORDS:
            first_non_filler_idx += 1
        else:
            break

    hook_words = chosen_words[first_non_filler_idx:]
    hook_sentence = " ".join(w["word"] for w in hook_words).strip() or best_u.text
    hook_word_start = hook_words[0]["start"] if hook_words else best_u.start

    # Keep at most 5 s of lead-in ONLY if hook_sentence has a dangling setup reference
    needs_lead_in = any(p.search(hook_sentence) for p in _DANGLING_REF_PATTERNS)
    if needs_lead_in and best_u.index > slice_utts[0].index:
        prev_u = utterances[best_u.index - 1]
        if (hook_word_start - prev_u.start) <= max_lead_in_s:
            hook_word_start = prev_u.start

    refined_start = round(max(0.0, hook_word_start - pre_roll_s), 3)
    refined_end = round(win_end, 3)

    cand.refined_start = refined_start
    cand.refined_end = refined_end
    cand.hook_sentence = hook_sentence
    return refined_start, refined_end, hook_sentence


# ─────────────────────── 6. Dedup + Mode Controls + Reports ───────────────────────
def _overlap_ratio(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    inter = max(0.0, min(a_end, b_end) - max(a_start, b_start))
    denom = max(1e-6, min(a_end - a_start, b_end - b_start))
    return inter / denom


def _transcript_slice(words: Sequence[Dict[str, Any]], t0: float, t1: float) -> str:
    return " ".join(
        str(w.get("word") if "word" in w else w.get("text", "")).strip()
        for w in words
        if t0 <= float(w["start"]) <= t1
    ).strip()


def write_hook_reports(
    out_dir: Path,
    video_label: str,
    selected: Sequence[HookCandidate],
    all_candidates: Sequence[HookCandidate],
    words: Sequence[Dict[str, Any]],
    providers_used: Sequence[str],
    hook_mode: str,
    hook_hint: Optional[str] = None,
) -> Tuple[Path, Path]:
    """Writes `analysis_report.json` and `hook_debug.md` for full clip-selection transparency."""
    out_dir.mkdir(parents=True, exist_ok=True)
    winner = selected[0] if selected else None
    runners_up = list(selected[1:5]) if len(selected) > 1 else [c for c in all_candidates[:5] if c is not winner]

    win_start = (winner.refined_start if winner and winner.refined_start is not None else (winner.start if winner else 0.0))
    before_10s = _transcript_slice(words, max(0.0, win_start - 10.0), max(0.0, win_start - 0.01))
    after_10s = _transcript_slice(words, win_start, win_start + 10.0)

    report_obj = {
        "pipeline_version": PIPELINE_VERSION,
        "video": video_label,
        "hook_mode": hook_mode,
        "hook_hint": hook_hint,
        "llm_providers_used": list(providers_used),
        "selected_clips": [asdict(c) for c in selected],
        "winner_context": {
            "start": win_start,
            "end": (winner.refined_end if winner and winner.refined_end is not None else (winner.end if winner else 0.0)),
            "hook_sentence": winner.hook_sentence if winner else "",
            "reason": winner.reason if winner else "",
            "transcript_before_10s": before_10s,
            "transcript_after_10s": after_10s,
        },
        "runners_up": [asdict(c) for c in runners_up],
        "all_candidates": [asdict(c) for c in all_candidates],
    }

    json_path = out_dir / "analysis_report.json"
    json_path.write_text(json.dumps(report_obj, indent=2), encoding="utf-8")

    md_lines = [
        f"# Hook Selection Debug Report (`{PIPELINE_VERSION}`)",
        f"- **Video**: `{video_label}`",
        f"- **Mode**: `{hook_mode}` | **Hint**: `{hook_hint or 'none'}` | **LLM Providers**: `{', '.join(providers_used) or 'rules-only fallback'}`",
        f"- **Total Candidates Evaluated**: {len(all_candidates)}",
        "",
    ]
    if winner:
        md_lines.extend([
            "## Winning Clip",
            f"- **Window**: `{win_start:.2f}s` -> `{(winner.refined_end or winner.end):.2f}s` (final score: **{winner.final_score:.2f}/10**)",
            f"- **Hook Sentence**: > {winner.hook_sentence}",
            f"- **Why It Won**: {winner.reason}",
            f"- **Scores**: `hook_3s={winner.hook_3s:.2f}`, `standalone={winner.standalone:.2f}`, `payoff={winner.payoff:.2f}`, `intensity={winner.intensity:.2f}`, `local={winner.local_score:.2f}`",
            "",
            "### Transcript Context Around Start",
            f"- **10s Before (`{max(0.0, win_start-10):.1f}s – {win_start:.1f}s`)**: {before_10s or '*(start of video)*'}",
            f"- **10s After (`{win_start:.1f}s – {win_start+10:.1f}s`)**: {after_10s}",
            "",
        ])

    md_lines.append("## Runners-Up")
    for idx, r in enumerate(runners_up, 1):
        md_lines.append(
            f"{idx}. `{r.id}` (`{(r.refined_start or r.start):.2f}s–{(r.refined_end or r.end):.2f}s`, "
            f"final={r.final_score:.2f}, hook_3s={r.hook_3s:.2f}, local={r.local_score:.2f}): \"{r.hook_sentence}\""
        )

    md_lines.extend(["", "## All Ranked Candidates (Top 20)", "| ID | Start | End | Final | Hook3s | Standalone | Payoff | Intensity | Local | Hook Sentence |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|"])
    for c in sorted(all_candidates, key=lambda x: x.final_score, reverse=True)[:20]:
        hs = c.hook_sentence.replace("|", "/")[:80]
        md_lines.append(
            f"| {c.id} | {c.start:.2f}s | {c.end:.2f}s | {c.final_score:.2f} | {c.hook_3s:.2f} | {c.standalone:.2f} | {c.payoff:.2f} | {c.intensity:.2f} | {c.local_score:.2f} | {hs} |"
        )

    md_path = out_dir / "hook_debug.md"
    md_path.write_text("\n".join(md_lines) + "\n", encoding="utf-8")
    return json_path, md_path


def format_explain_summary(selected: Sequence[HookCandidate], providers_used: Sequence[str], report_json: Optional[Path] = None) -> str:
    lines = [f"[HookSelector {PIPELINE_VERSION}] providers={list(providers_used) or ['rules-only']} selected={len(selected)}"]
    for i, c in enumerate(selected, 1):
        st = c.refined_start if c.refined_start is not None else c.start
        en = c.refined_end if c.refined_end is not None else c.end
        lines.append(
            f"  #{i} {st:.2f}s-{en:.2f}s (score={c.final_score:.2f}, hook_3s={c.hook_3s:.2f}, local={c.local_score:.2f}): "
            f"\"{c.hook_sentence}\" — {c.reason[:140]}"
        )
    if report_json:
        lines.append(f"  Report: {report_json}")
    return "\n".join(lines)


def select_hook_clips(
    words: Sequence[Dict[str, Any]],
    clip_count: int = 3,
    min_dur: float = 15.0,
    max_dur: float = 60.0,
    hook_mode: str = "balanced",
    hook_hint: Optional[str] = None,
    manual_start: Optional[float] = None,
    manual_end: Optional[float] = None,
    video_path: Optional[Path] = None,
    scene_cuts: Sequence[float] = (),
    report_dir: Optional[Path] = None,
    video_label: str = "video",
    use_llm: bool = True,
    llm_caller: Optional[Callable[[str, str, str, float], Any]] = None,
    providers: Optional[Sequence[str]] = None,
    ffmpeg_bin: str = "ffmpeg",
) -> Tuple[List[HookCandidate], Dict[str, Any]]:
    """
    Main unified M6a hook selection entry point (used by both CLI and backend).
    Returns (selected_clips, meta_dict).
    """
    utterances = build_utterances(words)

    # Manual --start / --end override
    if manual_start is not None and manual_end is not None and manual_end > manual_start:
        slice_txt = _transcript_slice(words, manual_start, manual_end)
        f3_txt = _transcript_slice(words, manual_start, manual_start + 3.0)
        manual_cand = HookCandidate(
            id="manual_001",
            start=round(manual_start, 3),
            end=round(manual_end, 3),
            start_utt_idx=0,
            end_utt_idx=max(0, len(utterances) - 1),
            text=slice_txt,
            first_3s_text=f3_txt,
            hook_sentence=f3_txt or slice_txt[:120],
            local_score=10.0,
            hook_3s=10.0,
            final_score=10.0,
            reason="Manual --start/--end override",
            refined_start=round(manual_start, 3),
            refined_end=round(manual_end, 3),
        )
        rep_paths: Dict[str, str] = {}
        if report_dir:
            rj, rm = write_hook_reports(report_dir, video_label, [manual_cand], [manual_cand], words, ["manual"], hook_mode, hook_hint)
            rep_paths = {"analysis_report_json": str(rj), "hook_debug_md": str(rm)}
        return [manual_cand], {"pipeline_version": PIPELINE_VERSION, "providers_used": ["manual"], **rep_paths}

    cands = generate_candidates(utterances, min_dur=min_dur, max_dur=max_dur)
    if not cands:
        return [], {"pipeline_version": PIPELINE_VERSION, "providers_used": [], "candidates_count": 0}

    rms = _probe_audio_rms_profile(video_path, utterances[-1].end if utterances else 0.0, ffmpeg_bin=ffmpeg_bin)
    for c in cands:
        score_candidate_local(c, utterances, rms_per_sec=rms, scene_cuts=scene_cuts, hook_hint=hook_hint)
        c.final_score = c.local_score
        c.hook_3s = c.local_score

    # Rank locally and pick top 12 non-identical local candidates for multi-provider LLM judge
    cands.sort(key=lambda c: c.local_score, reverse=True)
    top12: List[HookCandidate] = []
    for c in cands:
        if len(top12) >= 12:
            break
        if any(_overlap_ratio(c.start, c.end, t.start, t.end) > 0.85 for t in top12):
            continue
        top12.append(c)

    providers_used: List[str] = []
    if use_llm and top12:
        providers_used, _ = judge_candidates_llm(
            top12, providers=providers, hook_hint=hook_hint, llm_caller=llm_caller
        )
    else:
        for c in top12:
            c.final_score = c.local_score
            c.hook_3s = c.local_score
            c.reason = f"[rules] local_score={c.local_score:.2f}"

    # Sort all candidates by final_score
    cands.sort(key=lambda c: c.final_score, reverse=True)

    # Apply hook-mode filtering (strict requires hook_3s >= 7 and sentence-boundary start)
    mode = (hook_mode or "balanced").strip().lower()
    filtered = list(cands)
    if mode == "strict":
        strict_pool = [c for c in cands if c.hook_3s >= 7.0 and c.is_sentence_boundary and not c.local_features.get("penalty_clip_sponsor")]
        if strict_pool:
            filtered = strict_pool
    elif mode == "balanced":
        non_sponsor = [c for c in cands if not c.local_features.get("penalty_clip_sponsor")]
        if non_sponsor:
            filtered = non_sponsor

    # Deduplicate (> 50% overlap with any higher-ranked selected clip) and refine_start()
    selected: List[HookCandidate] = []
    for c in filtered:
        if len(selected) >= clip_count:
            break
        st, en, _ = refine_start(c, utterances, min_dur=min(10.0, min_dur))
        if any(_overlap_ratio(st, en, s.refined_start or s.start, s.refined_end or s.end) > 0.50 for s in selected):
            continue
        selected.append(c)

    rep_paths = {}
    if report_dir:
        rj, rm = write_hook_reports(report_dir, video_label, selected, cands, words, providers_used, mode, hook_hint)
        rep_paths = {"analysis_report_json": str(rj), "hook_debug_md": str(rm)}

    return selected, {
        "pipeline_version": PIPELINE_VERSION,
        "providers_used": providers_used,
        "candidates_count": len(cands),
        "hook_mode": mode,
        **rep_paths,
    }
