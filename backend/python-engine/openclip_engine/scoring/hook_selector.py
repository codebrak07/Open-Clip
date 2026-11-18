"""
M6a Hook-Aware Clip Selection Pipeline (`hook_selector.py`, PIPELINE_VERSION = "m6a_hook_selector_v2"):
Single selection pipeline shared by both CLI and backend.
  1. Build sentence utterances from word-level transcript (terminal punctuation, abbreviation-aware,
     soft pauses > 0.4 s vs. clean hard pauses >= 0.8 s, tracking starts_clean & ends_clean).
  2. Generate candidates per clean utterance start x window sizes {15, 20, 30, 45, 60} s strictly
     bounded to [min_dur, max_dur], preferring clean sentence endings.
  3. Cheap deterministic local score weighted toward the first 3 s with length damping, curly-quote
     normalization, streaming constant-memory audio RMS, scene-cut density, person visibility,
     stemmed word-boundary hook_hint matching, and filler/dangling/sponsor penalties.
  4. Multi-provider concurrent LLM judge on shortlisted starts x up to 3 duration variants per start
     (temperature 0, shuffled order per provider, numbered utterance prompt, strict schema validation,
     coverage checks, batch z-score ranking, multi-batch refill, and rules-only fallback).
  5. `refine_start()`: moves start inside first 12 s only when hook gain >= refine_min_gain, strips
     strictly leading greetings/fillers (never deleting real content words), enforces [min_dur, max_dur],
     and optionally snaps start to nearest 100 ms low-energy point (else 0.15 s pre-roll).
  6. Overlap deduplication (> 50%) and unified meta schema across every return path.
  7. Transparency reports (`analysis_report.json` + `hook_debug.md`, optional `report_prefix`, capped
     `all_candidates`) and `--explain` summary.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import random
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple, Union

import numpy as np

logger = logging.getLogger(__name__)

PIPELINE_VERSION = "m6a_hook_selector_v2"

# ─────────────────────── Prompt Constants (Phase 3) ───────────────────────
JUDGE_SYSTEM_PROMPT = (
    "You are an expert short-form viral video editor. Judge each candidate strictly on whether "
    "its FIRST 3 SECONDS stop a viewer scrolling (bold claim, compelling question, surprising stat, "
    "conflict/stakes, cliffhanger, or pattern interrupt) AND whether the full window delivers a "
    "self-contained payoff. Greetings, channel intros, filler preambles, and sponsor/ad reads MUST "
    "receive hook_3s <= 2. All timestamps shown are absolute seconds in the source video. "
    "Return ONLY valid raw JSON matching the requested schema."
)

JUDGE_USER_PROMPT_TEMPLATE = (
    "Score every candidate below.{hint_block}\n"
    "Rubric anchors (0-10):\n"
    "  - hook_3s:    0=greeting/filler/sponsor/dead air, 5=clear topic setup, 10=instant scroll-stopping tension/claim/stat\n"
    "  - standalone: 0=incomprehensible without prior context, 5=mostly clear, 10=100% self-contained story\n"
    "  - payoff:     0=cuts off mid-thought/no resolution, 5=decent point made, 10=strong twist/answer/cliffhanger ending\n"
    "  - intensity:  0=flat/monotone/boring, 5=engaged delivery, 10=high emotional stakes or energy\n"
    "Rule: Greetings, intros, and sponsor/ad reads MUST get hook_3s <= 2.\n"
    "Return ONLY JSON in this EXACT schema:\n"
    '{{"candidates": [{{"id": str, "hook_3s": 0..10, "standalone": 0..10, "payoff": 0..10, '
    '"intensity": 0..10, "hook_utt": int_utterance_index_within_candidate, "reason": str}}]}}\n\n'
    "{candidate_blocks}"
)

# ─────────────────────── Linguistic Feature Tables (Phase 4) ───────────────────────
_ABSOLUTES = {
    "never", "nobody", "nothing", "everything", "always",
    "impossible", "worst", "best", "secret", "forever", "zero",
}
_SECOND_PERSON = {"you", "your", "you're", "youre", "you've", "you'll", "yourself"}
_CONFLICT_STAKES = {
    "eliminate", "eliminated", "destroy", "destroyed", "lose", "lost", "die", "dead",
    "banned", "fired", "broke", "wrong", "mistake", "war", "fight", "trap", "bet",
    "risk", "dangerous", "illegal", "crash", "quit", "failed", "fail", "kill", "survive",
    "stolen", "stole", "scam", "lie", "lied", "truth", "insane", "crazy", "shocking",
    "caught", "arrested", "ruined", "win", "won", "danger",
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
_WH_QUESTION_LEADS = {"why", "how", "what", "who", "which"}
_AUX_QUESTION_LEADS = {"did", "can", "could", "would", "have", "do", "does", "is", "are"}
_PRONOUNS_AFTER_AUX = {
    "you", "we", "they", "i", "he", "she", "it", "there", "this", "that",
    "people", "anyone", "everyone", "everybody", "nobody", "someone", "your",
}

_LEADING_FILLER_PHRASES = [
    re.compile(r"^\s*(?:hey\s+guys|hey\s+everyone|hello\s+everyone|what'?s\s+up\s+guys|welcome\s+back(?:\s+guys|\s+everyone|\s+everybody)?)[,!\s]*", re.I),
    re.compile(r"^\s*(?:in\s+this\s+video|today\s+we'?re\s+going\s+to|today\s+i'?m\s+going\s+to)[,!\s]*", re.I),
]
_LEADING_FILLER_TOKENS = {
    "um", "uh", "umm", "uhh", "so", "okay", "ok", "alright", "well", "yeah", "yo",
}
_PENALTY_FILLER_PHRASES = [
    *_LEADING_FILLER_PHRASES,
    re.compile(r"^\s*(?:okay\s+so|ok\s+so|alright\s+so|so\s+um|so\s+uh|um|uh|so|well|okay|ok|alright)\b", re.I),
]
_DANGLING_REF_PATTERNS = [
    re.compile(r"^\s*(?:and\s+then\s+(?:he|she|they|it|we|i)|that'?s\s+why|this\s+is\s+why|which\s+means|so\s+(?:he|she|they|it)\b|as\s+i\s+said|like\s+i\s+mentioned|going\s+back\s+to|speaking\s+of\s+that|because\s+of\s+that)\b", re.I),
    re.compile(r"^\s*(?:and|but|because|or|then)\b", re.I),
    re.compile(r"^\s*(?:he|she|they|that)\s+(?!is\s+the\s+secret\b)", re.I),
]
_SPONSOR_PATTERNS = [
    re.compile(r"\bsponsored\s+by\b", re.I),
    re.compile(r"\btoday'?s\s+sponsor\b", re.I),
    re.compile(r"\bbrought\s+to\s+you\s+by\b", re.I),
    re.compile(r"\buse\s+(?:my\s+|the\s+)?(?:promo|discount|coupon)\s+code\b", re.I),
    re.compile(r"\buse\s+(?:my\s+)?code\s+[A-Z0-9]{3,}\b"),
    re.compile(r"\buse\s+(?:my\s+|the\s+)?code\s+['\"][a-zA-Z0-9_-]{2,}['\"]", re.I),
    re.compile(r"\buse\s+(?:my\s+)?code\b.{0,30}\b(?:checkout|off|discount|save|free|link)\b", re.I),
    re.compile(r"\b\d+\s*%\s*off\b", re.I),
    re.compile(r"\bfree\s+trial\b", re.I),
    re.compile(r"\bdiscount\b", re.I),
    re.compile(r"\baffiliate\b", re.I),
    re.compile(r"\blink\s+in\s+(?:the\s+)?description\b", re.I),
    re.compile(r"\b(?:smash|hit)\s+(?:that\s+)?(?:like|subscribe|bell)\b", re.I),
    re.compile(r"\bsubscribe\s+to\s+(?:the\s+|my\s+)?channel\b", re.I),
    re.compile(r"\bdon'?t\s+forget\s+to\s+subscribe\b", re.I),
    re.compile(r"\bthanks\s+for\s+watching\b", re.I),
    re.compile(r"\bsee\s+you\s+in\s+the\s+next\b", re.I),
    re.compile(r"\bcheck\s+out\s+the\s+link\b", re.I),
]

_ABBREVIATIONS = {
    "mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.", "st.", "vs.", "etc.",
    "e.g.", "i.e.", "u.s.", "u.s.a.", "u.k.", "a.m.", "p.m.", "fig.", "no.", "approx.",
}
_TERMINAL_PUNCT_RE = re.compile(r"[.?!\u2026\u3002\uff1f\uff01][\"'\u201d\u2019)\]]*$")
_HINT_STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "about", "into", "when",
    "where", "what", "which", "who", "how", "why", "are", "was", "were", "have",
    "has", "had", "not", "but", "you", "your", "they", "their", "them", "our",
    "moment", "part", "clip", "video", "talking", "talks", "talk",
}
_VALID_HOOK_MODES = {"strict", "balanced", "loose"}


def _normalize_text(text: str) -> str:
    """Normalizes curly quotes/apostrophes to ASCII and collapses whitespace once."""
    if not text:
        return ""
    t = (
        text.replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2014", " - ")
        .replace("\u2013", " - ")
    )
    return re.sub(r"\s+", " ", t).strip()


def _is_terminal_word(word: str) -> bool:
    """True if word ends with real sentence-ending punctuation and is not an abbreviation."""
    w = _normalize_text(word)
    if not w or not _TERMINAL_PUNCT_RE.search(w):
        return False
    stripped = w.rstrip("\"' )]")
    if stripped.lower() in _ABBREVIATIONS:
        return False
    # Multi-initial dotted acronyms like U.S. / Ph.D.
    if re.fullmatch(r"(?:[A-Za-z]\.){2,}", stripped):
        return False
    return True


def _light_stem(token: str) -> str:
    """Lightweight deterministic stemmer for hint matching (eliminating -> eliminat, eliminate -> eliminat)."""
    w = token.lower()
    if len(w) <= 3:
        return w
    for suf in ("ing", "ed", "es", "s"):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            w = w[: -len(suf)]
            break
    if w.endswith("e") and len(w) >= 5:
        w = w[:-1]
    return w


# ─────────────────────── Data Models ───────────────────────
@dataclass(frozen=True)
class HookWeights:
    hook_3s: float = 0.35
    standalone: float = 0.20
    payoff: float = 0.20
    intensity: float = 0.15
    local: float = 0.10


DEFAULT_HOOK_WEIGHTS = HookWeights()


@dataclass
class Utterance:
    index: int
    start: float
    end: float
    text: str
    words: List[Dict[str, Any]]
    starts_clean_sentence: bool = True
    ends_clean_sentence: bool = True


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
    judged: bool = False
    norm_rank_score: float = 0.0
    refine_details: Dict[str, Any] = field(default_factory=dict)


# ─────────────────────── 1. Utterance Builder ───────────────────────
def build_utterances(
    words: Sequence[Dict[str, Any]],
    pause_threshold_s: float = 0.4,
    hard_gap_s: float = 0.8,
) -> List[Utterance]:
    """
    Builds utterances from word-level timestamps using abbreviation-aware terminal punctuation
    and pauses (> pause_threshold_s). Marks starts_clean_sentence and ends_clean_sentence
    strictly (24-word caps and soft 0.4-0.8 s pauses without punctuation are NOT clean edges).
    """
    norm_words: List[Dict[str, Any]] = []
    skipped_missing_start = 0
    for item in words:
        if not isinstance(item, dict):
            skipped_missing_start += 1
            continue
        raw = str(item.get("word") if "word" in item else item.get("text", "")).strip()
        if not raw:
            continue
        if "start" not in item or item["start"] is None:
            skipped_missing_start += 1
            continue
        try:
            st = float(item["start"])
        except Exception:
            skipped_missing_start += 1
            continue
        raw_end = item.get("end")
        if raw_end is None:
            en = st + 0.12
        else:
            try:
                en = float(raw_end)
            except Exception:
                en = st + 0.12
        norm_words.append({"word": raw, "start": st, "end": max(st + 0.02, en)})

    if skipped_missing_start > 0:
        logger.warning("build_utterances skipped %d word entries missing valid 'start'", skipped_missing_start)

    if not norm_words:
        return []
    norm_words.sort(key=lambda w: w["start"])

    utterances: List[Utterance] = []
    buf: List[Dict[str, Any]] = []
    next_starts_clean = True

    def _flush(ends_clean: bool) -> None:
        nonlocal next_starts_clean
        if not buf:
            return
        txt = " ".join(w["word"] for w in buf).strip()
        utterances.append(Utterance(
            index=len(utterances),
            start=buf[0]["start"],
            end=buf[-1]["end"],
            text=txt,
            words=list(buf),
            starts_clean_sentence=next_starts_clean if utterances else True,
            ends_clean_sentence=ends_clean,
        ))
        next_starts_clean = ends_clean
        buf.clear()

    for w in norm_words:
        if buf:
            gap = w["start"] - buf[-1]["end"]
            if gap > pause_threshold_s:
                is_hard = gap >= hard_gap_s or _is_terminal_word(buf[-1]["word"])
                _flush(ends_clean=is_hard)
        buf.append(w)
        if _is_terminal_word(w["word"]):
            _flush(ends_clean=True)
        elif len(buf) >= 24:
            # 24-word cap split is NOT a clean sentence boundary
            _flush(ends_clean=False)

    if buf:
        _flush(ends_clean=True)
    if utterances:
        utterances[0].starts_clean_sentence = True
        utterances[-1].ends_clean_sentence = True
    return utterances


# ─────────────────────── 2. Candidate Window Generator ───────────────────────
def _generate_candidates_impl(
    utterances: Sequence[Utterance],
    window_sizes: Sequence[float] = (15.0, 20.0, 30.0, 45.0, 60.0),
    min_dur: float = 12.0,
    max_dur: float = 60.0,
    stride_s: float = 3.0,
) -> Tuple[List[HookCandidate], bool, float, bool]:
    """Internal generator returning (candidates, min_dur_relaxed, effective_min_dur, degraded_boundaries)."""
    if min_dur <= 0.0:
        raise ValueError(f"min_dur must be > 0, got {min_dur}")
    if min_dur > max_dur:
        raise ValueError(f"min_dur ({min_dur}) must be <= max_dur ({max_dur})")
    if stride_s <= 0.0:
        raise ValueError(f"stride_s must be > 0, got {stride_s}")

    if not utterances:
        return [], False, min_dur, False

    total_start = utterances[0].start
    total_end = utterances[-1].end
    total_span = max(0.0, total_end - total_start)
    if total_span < 3.0:
        return [], False, min_dur, False

    min_dur_relaxed = total_span < min_dur
    eff_min_dur = min(min_dur, max(3.0, total_span * 0.5)) if min_dur_relaxed else min_dur

    n_utts = len(utterances)
    clean_start_indices = [i for i, u in enumerate(utterances) if u.starts_clean_sentence]
    sparse_clean = len(clean_start_indices) < max(2, int(total_span / 45.0)) and n_utts > len(clean_start_indices)

    def _build_for_starts(start_indices: Sequence[int]) -> List[HookCandidate]:
        seen_pairs: set[Tuple[int, int]] = set()
        out: List[HookCandidate] = []
        for start_idx in start_indices:
            u_start = utterances[start_idx]
            if (total_end - u_start.start) < eff_min_dur - 1e-6:
                break

            clean_ends: List[int] = []
            any_ends: List[int] = []
            for end_idx in range(start_idx, n_utts):
                d = utterances[end_idx].end - u_start.start
                if d < eff_min_dur - 1e-6:
                    continue
                if d > max_dur + 1e-6:
                    break
                any_ends.append(end_idx)
                if utterances[end_idx].ends_clean_sentence:
                    clean_ends.append(end_idx)

            if not any_ends:
                continue

            pool_ends = clean_ends if clean_ends else any_ends
            for win in window_sizes:
                target_dur = max(eff_min_dur, min(max_dur, float(win)))
                target_end = u_start.start + target_dur

                best_end_idx = min(pool_ends, key=lambda ei: abs(utterances[ei].end - target_end))
                pair = (start_idx, best_end_idx)
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)

                slice_utts = utterances[start_idx : best_end_idx + 1]
                c_start = slice_utts[0].start
                c_end = slice_utts[-1].end
                full_text = " ".join(u.text for u in slice_utts)

                w3: List[str] = []
                for u in slice_utts:
                    if u.start > c_start + 3.0:
                        break
                    for w in u.words:
                        if w["start"] <= c_start + 3.0:
                            w3.append(w["word"])
                first_3s = " ".join(w3) if w3 else slice_utts[0].text

                out.append(HookCandidate(
                    id=f"cand_{len(out) + 1:04d}",
                    start=round(c_start, 3),
                    end=round(c_end, 3),
                    start_utt_idx=start_idx,
                    end_utt_idx=best_end_idx,
                    text=full_text,
                    first_3s_text=first_3s,
                    hook_sentence=slice_utts[0].text,
                    local_score=0.0,
                    is_sentence_boundary=bool(
                        u_start.starts_clean_sentence and utterances[best_end_idx].ends_clean_sentence
                    ),
                ))
        return out

    degraded_boundaries = sparse_clean
    if degraded_boundaries:
        cands = _build_for_starts(range(n_utts))
    else:
        cands = _build_for_starts(clean_start_indices)
        if not cands and n_utts > len(clean_start_indices):
            degraded_boundaries = True
            cands = _build_for_starts(range(n_utts))

    return cands, min_dur_relaxed, eff_min_dur, degraded_boundaries


def generate_candidates(
    utterances: Sequence[Utterance],
    window_sizes: Sequence[float] = (15.0, 20.0, 30.0, 45.0, 60.0),
    min_dur: float = 12.0,
    max_dur: float = 60.0,
    stride_s: float = 3.0,
) -> List[HookCandidate]:
    """
    Generates candidate windows per clean utterance start x window_sizes strictly bounded to
    [min_dur, max_dur], preferring clean sentence ends (sets is_sentence_boundary=False when
    no clean end fits the bounds; falls back to all utterance starts on unpunctuated transcripts).
    """
    cands, _, _, _ = _generate_candidates_impl(
        utterances, window_sizes=window_sizes, min_dur=min_dur, max_dur=max_dur, stride_s=stride_s
    )
    return cands


# ─────────────────────── 3. Streaming Audio Probe & Local Hook Scoring ───────────────────────
def _probe_audio_rms_profile(
    video_path: Optional[Union[str, Path]],
    ffmpeg_bin: str = "ffmpeg",
    timeout_s: float = 120.0,
) -> Tuple[Optional[np.ndarray], Optional[np.ndarray], str]:
    """
    Streams ffmpeg audio (`-vn`, 8 kHz mono float32) in constant-memory 1 s chunks via Popen.
    Returns (rms_per_sec, rms_per_100ms, status) where status in {'ok', 'timeout', 'error', 'skipped'}.
    """
    if not video_path:
        return None, None, "skipped"
    vp = Path(video_path)
    if not vp.exists():
        return None, None, "skipped"

    sample_rate = 8000
    chunk_samples = sample_rate  # 1 s = 8000 float32 samples = 32 KB
    chunk_bytes = chunk_samples * 4
    hop_samples = sample_rate // 10  # 100 ms = 800 samples

    proc: Optional[subprocess.Popen[bytes]] = None
    try:
        proc = subprocess.Popen(
            [ffmpeg_bin, "-v", "error", "-vn", "-i", str(vp), "-ac", "1", "-ar", str(sample_rate), "-f", "f32le", "pipe:1"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        assert proc.stdout is not None
        sec_rms: List[float] = []
        hop_rms: List[float] = []
        leftover = b""
        import time as _time
        deadline = _time.monotonic() + max(1.0, float(timeout_s))

        while True:
            if _time.monotonic() > deadline:
                proc.kill()
                proc.wait(timeout=5)
                logger.warning("Audio RMS probe timed out after %.1fs on %s", timeout_s, vp)
                return None, None, "timeout"
            data = proc.stdout.read(chunk_bytes)
            if not data:
                break
            buf = leftover + data
            full_len = (len(buf) // chunk_bytes) * chunk_bytes
            if full_len > 0:
                pcm = np.frombuffer(buf[:full_len], dtype=np.float32)
                n_sec = pcm.size // chunk_samples
                sec_mat = pcm.reshape(n_sec, chunk_samples)
                sec_rms.extend(np.sqrt(np.mean(sec_mat * sec_mat, axis=1) + 1e-12).tolist())
                hop_mat = pcm.reshape(n_sec * 10, hop_samples)
                hop_rms.extend(np.sqrt(np.mean(hop_mat * hop_mat, axis=1) + 1e-12).tolist())
            leftover = buf[full_len:]

        if len(leftover) >= hop_samples * 4:
            usable = (len(leftover) // (hop_samples * 4)) * (hop_samples * 4)
            pcm_tail = np.frombuffer(leftover[:usable], dtype=np.float32)
            hop_mat = pcm_tail.reshape(-1, hop_samples)
            hop_rms.extend(np.sqrt(np.mean(hop_mat * hop_mat, axis=1) + 1e-12).tolist())
            sec_rms.append(float(np.sqrt(np.mean(pcm_tail * pcm_tail) + 1e-12)))

        rem_timeout = max(1.0, deadline - _time.monotonic())
        try:
            rc = proc.wait(timeout=rem_timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
            logger.warning("Audio RMS probe wait timed out on %s", vp)
            return None, None, "timeout"

        if rc != 0 or not sec_rms:
            err_txt = proc.stderr.read().decode("utf-8", errors="ignore")[:160] if proc.stderr else ""
            logger.warning("Audio RMS probe failed (rc=%s) on %s: %s", rc, vp, err_txt)
            return None, None, "error"

        return np.asarray(sec_rms, dtype=np.float32), np.asarray(hop_rms, dtype=np.float32), "ok"
    except Exception as exc:
        logger.warning("Audio RMS probe exception (%s) on %s: %s", type(exc).__name__, vp, str(exc)[:160])
        if proc is not None and proc.poll() is None:
            proc.kill()
        return None, None, "error"


def is_sponsor_text(text: str) -> bool:
    norm = _normalize_text(text)
    if not norm:
        return False
    return any(p.search(norm) for p in _SPONSOR_PATTERNS)


def score_sentence_hook(text: str) -> Tuple[float, Dict[str, Any]]:
    """
    Scores a single sentence / 3 s opening for scroll-stopping hook strength (0..10)
    with curly-quote normalization, long-sentence damping, pronoun-aware question detection,
    and filler/dangling/sponsor penalties.
    """
    t = _normalize_text(text)
    if not t:
        return 0.0, {"empty": True}

    tokens_raw = t.split()
    tokens = [re.sub(r"[^a-zA-Z0-9'$%]+", "", w).lower() for w in tokens_raw]
    tokens = [tk for tk in tokens if tk]
    n_toks = len(tokens)

    base_score = 3.2
    pos_score = 0.0
    feats: Dict[str, Any] = {}

    # Question: explicit '?', wh-word lead, OR aux lead followed by a pronoun
    has_q = "?" in t
    if not has_q and tokens:
        if tokens[0] in _WH_QUESTION_LEADS:
            has_q = True
        elif tokens[0] in _AUX_QUESTION_LEADS and len(tokens) >= 2 and tokens[1] in _PRONOUNS_AFTER_AUX:
            has_q = True
    if has_q:
        pos_score += 1.8
        feats["question"] = True

    has_num = bool(re.search(r"(?:\$\d|\d+%|\b\d{2,}\b|\b(?:million|billion|thousand)\b|#\d)", t, re.I))
    if has_num:
        pos_score += 1.6
        feats["number_stat"] = True

    abs_hits = [tk for tk in tokens if tk in _ABSOLUTES]
    if abs_hits:
        pos_score += min(1.5, 0.9 + 0.3 * (len(abs_hits) - 1))
        feats["absolutes"] = abs_hits[:3]

    if any(tk in _SECOND_PERSON for tk in tokens):
        pos_score += 0.9
        feats["second_person"] = True

    conflict_hits = [tk for tk in tokens if tk in _CONFLICT_STAKES]
    if conflict_hits:
        pos_score += min(2.2, 1.3 + 0.45 * (len(conflict_hits) - 1))
        feats["conflict_stakes"] = conflict_hits[:3]

    if any(p.search(t) for p in _CURIOSITY_PATTERNS):
        pos_score += 1.8
        feats["curiosity_gap"] = True

    if any(tk in _CONTRAST_PIVOTS for tk in tokens):
        pos_score += 0.8
        feats["contrast_pivot"] = True

    if "!" in t:
        pos_score += 0.5
        feats["exclamation"] = True

    # Phase 4 #15: damp long bloated sentences (scale positives by min(1, 14/len), floor 0.6)
    if n_toks > 14:
        damp = max(0.6, min(1.0, 14.0 / float(n_toks)))
        pos_score *= damp
        feats["length_damp"] = round(damp, 3)

    score = base_score + pos_score

    # Penalties
    if any(p.search(t) for p in _PENALTY_FILLER_PHRASES):
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
    scene_cuts: Union[Sequence[float], np.ndarray] = (),
    hook_hint: Optional[str] = None,
    person_visible_times: Optional[Union[Sequence[float], np.ndarray]] = None,
) -> float:
    """Deterministic local score (0..10), weighted toward the first 3 s."""
    del utterances  # preserved in public signature for caller compatibility
    s3_score, feats = score_sentence_hook(cand.first_3s_text)

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

    # Audio energy: first-3 s mean RMS relative to clip mean RMS
    if rms_per_sec is not None and rms_per_sec.size > 0:
        i0 = max(0, min(rms_per_sec.size - 1, int(cand.start)))
        i1 = max(i0 + 1, min(rms_per_sec.size, int(math.ceil(cand.start + 3.0))))
        ic1 = max(i1, min(rms_per_sec.size, int(math.ceil(cand.end))))
        first3_mean = float(np.mean(rms_per_sec[i0:i1]))
        clip_mean = float(np.mean(rms_per_sec[i0:ic1])) + 1e-6
        ratio = first3_mean / clip_mean
        feats["audio_energy_ratio"] = round(ratio, 2)
        if ratio >= 1.25:
            s3_score += 0.6
        elif first3_mean < 0.005:
            s3_score -= 1.2
            feats["penalty_quiet_start"] = True

    # Scene-cut density inside clip (accepts lists or numpy arrays)
    cuts_arr = np.asarray(scene_cuts, dtype=np.float64)
    if cuts_arr.size > 0:
        cuts_in = int(np.sum((cuts_arr >= cand.start) & (cuts_arr <= cand.end)))
        dur = max(1.0, cand.end - cand.start)
        density = cuts_in / (dur / 10.0)
        feats["scene_cuts_per_10s"] = round(density, 2)
        if 0.5 <= density <= 4.0:
            s3_score += 0.4

    # Person/face visible in first second (accepts lists or numpy arrays)
    if person_visible_times is not None:
        vis_arr = np.asarray(person_visible_times, dtype=np.float64)
        vis = bool(vis_arr.size > 0 and np.any((vis_arr >= cand.start) & (vis_arr <= cand.start + 1.0)))
        feats["person_in_first_sec"] = vis
        if vis:
            s3_score += 0.5

    # Payoff / ending strength (clean sentence punctuation)
    if _is_terminal_word(cand.text.strip().split()[-1]) if cand.text.strip() else False:
        s3_score += 0.3

    # Hook hint matching: word boundaries, stopword removal, light stemming
    if hook_hint and hook_hint.strip():
        hint_raw = re.findall(r"[a-zA-Z0-9]+", _normalize_text(hook_hint).lower())
        hint_stems = {_light_stem(tk) for tk in hint_raw if len(tk) >= 3 and tk not in _HINT_STOPWORDS}
        if hint_stems:
            cand_stems = {_light_stem(tk) for tk in re.findall(r"[a-zA-Z0-9]+", _normalize_text(cand.text).lower())}
            f3_stems = {_light_stem(tk) for tk in re.findall(r"[a-zA-Z0-9]+", _normalize_text(cand.first_3s_text).lower())}
            matched_all = sum(1 for st in hint_stems if st in cand_stems)
            matched_f3 = sum(1 for st in hint_stems if st in f3_stems)
            hint_ratio = (matched_all + 1.5 * matched_f3) / (len(hint_stems) * 2.5)
            feats["hook_hint_match"] = round(hint_ratio, 3)
            s3_score += hint_ratio * 4.0

    cand.local_score = round(max(0.0, min(10.0, s3_score)), 3)
    cand.local_features = feats
    return cand.local_score


# ─────────────────────── 4. Multi-Provider LLM Judge (Phase 1, 2, 3) ───────────────────────
def validate_judge_item(item: Any, valid_ids: set[str]) -> Optional[Dict[str, Any]]:
    """
    Strict JSON schema validator for LLM hook judge items.
    Accepts `hook_utt` (int index within candidate) and/or `hook_start_t` (float seconds).
    """
    if not isinstance(item, dict):
        return None
    cid = str(item.get("id", "")).strip()
    if cid not in valid_ids:
        return None
    for key in ("hook_3s", "standalone", "payoff", "intensity"):
        if key not in item or isinstance(item[key], bool):
            return None
    try:
        hook_3s = float(item["hook_3s"])
        standalone = float(item["standalone"])
        payoff = float(item["payoff"])
        intensity = float(item["intensity"])
    except Exception:
        return None
    for v in (hook_3s, standalone, payoff, intensity):
        if not (0.0 <= v <= 10.0) or math.isnan(v) or math.isinf(v):
            return None

    hook_utt: Optional[int] = None
    hook_start_t: Optional[float] = None
    if "hook_utt" in item and item["hook_utt"] is not None:
        if isinstance(item["hook_utt"], bool):
            return None
        try:
            hu = int(item["hook_utt"])
            if hu < 0:
                return None
            hook_utt = hu
        except Exception:
            return None
    if "hook_start_t" in item and item["hook_start_t"] is not None:
        if isinstance(item["hook_start_t"], bool):
            return None
        try:
            ht = float(item["hook_start_t"])
            if math.isnan(ht) or math.isinf(ht) or ht < 0.0:
                return None
            hook_start_t = ht
        except Exception:
            return None
    if hook_utt is None and hook_start_t is None:
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
        "hook_utt": hook_utt,
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


def _format_candidate_for_prompt(
    c: HookCandidate,
    utterances: Optional[Sequence[Utterance]],
    char_budget: int = 1200,
) -> str:
    """Formats candidate with numbered utterances + absolute timestamps using a head+tail budget."""
    header = f'- id: "{c.id}" | window: {c.start:.2f}s-{c.end:.2f}s ({c.end - c.start:.1f}s)\n'
    if utterances and 0 <= c.start_utt_idx <= c.end_utt_idx < len(utterances):
        slice_utts = utterances[c.start_utt_idx : c.end_utt_idx + 1]
        lines = [f"  [{rel_i}] {u.start:.2f}s: {u.text}" for rel_i, u in enumerate(slice_utts)]
    else:
        lines = [f"  [0] {c.start:.2f}s: {c.text}"]

    joined = "\n".join(lines)
    if len(joined) <= char_budget:
        return header + joined

    # Head + tail budget so the judge always sees both the 3s hook AND the ending payoff
    head_budget = int(char_budget * 0.58)
    tail_budget = char_budget - head_budget - 18
    head_lines: List[str] = []
    used = 0
    for ln in lines:
        if used + len(ln) + 1 > head_budget and head_lines:
            break
        head_lines.append(ln)
        used += len(ln) + 1

    tail_lines: List[str] = []
    used_t = 0
    for ln in reversed(lines[len(head_lines) :]):
        if used_t + len(ln) + 1 > tail_budget and tail_lines:
            break
        tail_lines.append(ln)
        used_t += len(ln) + 1
    tail_lines.reverse()

    if tail_lines:
        return header + "\n".join(head_lines) + "\n  [...]\n" + "\n".join(tail_lines)
    return header + joined[:char_budget]


def _lazy_llm_helpers() -> Tuple[Callable[..., Any], Callable[[], List[str]]]:
    """Lazily imports llm_helper so use_llm=False and fake callers never touch it."""
    from openclip_engine.clipping.llm_helper import call_provider_json, list_configured_providers
    return call_provider_json, list_configured_providers


def judge_candidates_llm(
    top_candidates: Sequence[HookCandidate],
    providers: Optional[Sequence[str]] = None,
    hook_hint: Optional[str] = None,
    llm_caller: Optional[Callable[[str, str, str, float], Any]] = None,
    seed: int = 42,
    utterances: Optional[Sequence[Utterance]] = None,
    weights: HookWeights = DEFAULT_HOOK_WEIGHTS,
    min_provider_coverage: float = 0.5,
    max_workers: int = 2,
    prompt_char_budget: int = 1200,
    providers_failed_out: Optional[Dict[str, str]] = None,
) -> Tuple[List[str], Dict[str, int]]:
    """
    Judges candidates concurrently across providers (temperature=0, shuffled order per provider,
    strict schema validation, coverage check >= min_provider_coverage, batch z-score normalization
    for ordering while preserving raw 0-10 scores). Marks `c.judged = True` ONLY on candidates that
    actually received a valid judge score from >=1 succeeding provider.
    Returns (providers_succeeded, provider_valid_counts).
    """
    if not top_candidates:
        return [], {}

    if providers is None or llm_caller is None:
        _call_prov, _list_prov = _lazy_llm_helpers()
        chosen_providers = list(providers) if providers is not None else _list_prov()
        caller = llm_caller or (lambda p, pr, sp, temp: _call_prov(p, pr, system_prompt=sp, temperature=temp))
    else:
        chosen_providers = list(providers)
        caller = llm_caller

    if not chosen_providers:
        return [], {}

    valid_ids = {c.id for c in top_candidates}
    by_id = {c.id: c for c in top_candidates}
    min_required = max(1, int(math.ceil(len(top_candidates) * min_provider_coverage)))
    hint_block = f"\nUser hook hint (prioritize moments matching this): {hook_hint}\n" if hook_hint else ""

    def _call_one_provider(pname: str) -> Tuple[str, Optional[List[Dict[str, Any]]], Optional[str]]:
        shuffled = shuffle_for_provider(top_candidates, pname, seed=seed)
        blocks = [_format_candidate_for_prompt(c, utterances, char_budget=prompt_char_budget) for c in shuffled]
        prompt = JUDGE_USER_PROMPT_TEMPLATE.format(hint_block=hint_block, candidate_blocks="\n".join(blocks))
        try:
            raw = caller(pname, prompt, JUDGE_SYSTEM_PROMPT, 0.0)
        except Exception as exc:
            err_cls = type(exc).__name__
            logger.warning("LLM judge provider %s failed (%s): %s", pname, err_cls, str(exc)[:160])
            return pname, None, err_cls

        items = raw.get("candidates") if isinstance(raw, dict) and isinstance(raw.get("candidates"), list) else raw
        if not isinstance(items, list):
            logger.warning("LLM judge provider %s returned invalid payload type: %s", pname, type(raw).__name__)
            return pname, None, "InvalidPayload"

        # Deduplicate by id (keep first valid entry)
        validated_by_id: Dict[str, Dict[str, Any]] = {}
        for it in items:
            v = validate_judge_item(it, valid_ids)
            if v is not None and v["id"] not in validated_by_id:
                validated_by_id[v["id"]] = v

        if len(validated_by_id) < min_required:
            logger.warning(
                "LLM judge provider %s scored only %d/%d candidates (need >=%d)",
                pname, len(validated_by_id), len(top_candidates), min_required,
            )
            return pname, None, "InsufficientCoverage"

        return pname, list(validated_by_id.values()), None

    # Execute providers concurrently (bounded) and aggregate in sorted provider order for determinism
    results_by_prov: Dict[str, Tuple[Optional[List[Dict[str, Any]]], Optional[str]]] = {}
    eff_workers = max(1, min(int(max_workers), len(chosen_providers)))
    if eff_workers == 1:
        for pname in chosen_providers:
            pn, vals, err = _call_one_provider(pname)
            results_by_prov[pn] = (vals, err)
    else:
        with ThreadPoolExecutor(max_workers=eff_workers) as pool:
            futs = [pool.submit(_call_one_provider, pn) for pn in chosen_providers]
            for fut in as_completed(futs):
                pn, vals, err = fut.result()
                results_by_prov[pn] = (vals, err)

    succeeded: List[str] = []
    valid_counts: Dict[str, int] = {}
    # Per-provider raw composite scores for batch z-score normalization
    prov_raw_composites: Dict[str, Dict[str, float]] = {}

    for pname in sorted(results_by_prov.keys()):
        vals, err = results_by_prov[pname]
        if err is not None or vals is None:
            if providers_failed_out is not None:
                providers_failed_out[pname] = err or "UnknownError"
            continue
        succeeded.append(pname)
        valid_counts[pname] = len(vals)
        raw_map: Dict[str, float] = {}
        for v in vals:
            c = by_id[v["id"]]
            c.provider_scores[pname] = v
            raw_map[c.id] = (
                weights.hook_3s * v["hook_3s"]
                + weights.standalone * v["standalone"]
                + weights.payoff * v["payoff"]
                + weights.intensity * v["intensity"]
                + weights.local * c.local_score
            )
        prov_raw_composites[pname] = raw_map

    # Compute per-provider z-scores within batch for fair cross-provider ranking
    prov_zscores: Dict[str, Dict[str, float]] = {}
    for pname, raw_map in prov_raw_composites.items():
        arr = np.asarray(list(raw_map.values()), dtype=np.float64)
        mean = float(np.mean(arr)) if arr.size else 0.0
        std = float(np.std(arr)) if arr.size else 0.0
        if std > 1e-6:
            prov_zscores[pname] = {cid: (val - mean) / std for cid, val in raw_map.items()}
        else:
            prov_zscores[pname] = {cid: 0.0 for cid in raw_map}

    # Aggregate raw 0-10 scores + normalized rank score; NEVER mark omitted candidates as judged!
    for c in top_candidates:
        if c.provider_scores:
            c.judged = True
            per_prov_finals: List[float] = []
            per_prov_zs: List[float] = []
            h3s, stas, pays, ints, starts = [], [], [], [], []
            reasons: List[str] = []

            for pname in sorted(c.provider_scores.keys()):
                v = c.provider_scores[pname]
                f_score = (
                    weights.hook_3s * v["hook_3s"]
                    + weights.standalone * v["standalone"]
                    + weights.payoff * v["payoff"]
                    + weights.intensity * v["intensity"]
                    + weights.local * c.local_score
                )
                per_prov_finals.append(f_score)
                per_prov_zs.append(prov_zscores.get(pname, {}).get(c.id, 0.0))
                h3s.append(v["hook_3s"])
                stas.append(v["standalone"])
                pays.append(v["payoff"])
                ints.append(v["intensity"])

                # Map hook_utt -> absolute timestamp (preferred), else accept hook_start_t
                mapped_t: Optional[float] = None
                if v.get("hook_utt") is not None and utterances and 0 <= c.start_utt_idx <= c.end_utt_idx < len(utterances):
                    abs_idx = c.start_utt_idx + int(v["hook_utt"])
                    if c.start_utt_idx <= abs_idx <= c.end_utt_idx:
                        mapped_t = utterances[abs_idx].start
                if mapped_t is None and v.get("hook_start_t") is not None:
                    ht = float(v["hook_start_t"])
                    if c.start - 1.0 <= ht <= c.end - 3.0:
                        mapped_t = ht
                if mapped_t is not None:
                    starts.append(mapped_t)
                reasons.append(f"[{pname}] {v['reason']}")

            c.hook_3s = round(sum(h3s) / len(h3s), 3)
            c.standalone = round(sum(stas) / len(stas), 3)
            c.payoff = round(sum(pays) / len(pays), 3)
            c.intensity = round(sum(ints) / len(ints), 3)
            c.hook_start_t = round(sum(starts) / len(starts), 3) if starts else None
            c.final_score = round(sum(per_prov_finals) / len(per_prov_finals), 3)
            c.norm_rank_score = round(sum(per_prov_zs) / len(per_prov_zs), 5)
            c.reason = " | ".join(reasons)
        else:
            # Candidate omitted or all providers failed -> NOT judged!
            c.judged = False
            c.hook_3s = c.local_score
            c.standalone = round(max(0.0, min(10.0, c.local_score - (2.0 if c.local_features.get("penalty_dangling_ref") else 0.0))), 3)
            c.payoff = round(min(10.0, c.local_score * 0.9), 3)
            c.intensity = round(min(10.0, c.local_score * 0.85), 3)
            c.final_score = c.local_score
            c.norm_rank_score = 0.0
            c.reason = f"[rules] local_score={c.local_score:.2f} features={list(c.local_features.keys())[:5]}"

    return succeeded, valid_counts


# ─────────────────────── 5. refine_start() (Phase 1 #3, #5 & Phase 4 #18) ───────────────────────
def _strip_leading_fillers_words(words: Sequence[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Strips ONLY (a) greeting phrases in _LEADING_FILLER_PHRASES and (b) leading tokens in
    _LEADING_FILLER_TOKENS, and NEVER if fewer than 3 words would remain.
    """
    cur = list(words)
    stripped: List[str] = []

    if len(cur) <= 3:
        return cur, stripped

    # (a) Greeting phrase prefix match on normalized utterance text
    full_norm = _normalize_text(" ".join(w["word"] for w in cur))
    for pat in _LEADING_FILLER_PHRASES:
        m = pat.match(full_norm)
        if m:
            matched_tokens = m.group(0).strip().split()
            if matched_tokens and (len(cur) - len(matched_tokens)) >= 3:
                stripped.extend(w["word"] for w in cur[: len(matched_tokens)])
                cur = cur[len(matched_tokens) :]
                break

    # (b) Leading single filler tokens strictly in _LEADING_FILLER_TOKENS
    while len(cur) > 3:
        w_clean = re.sub(r"[^a-zA-Z']+", "", _normalize_text(cur[0]["word"])).lower()
        if w_clean in _LEADING_FILLER_TOKENS:
            stripped.append(cur[0]["word"])
            cur.pop(0)
        else:
            break

    return cur, stripped


def _snap_start_with_rms(
    word_start: float,
    prev_word_end: Optional[float],
    rms_per_100ms: Optional[np.ndarray],
    pre_roll_s: float,
) -> float:
    """
    Snaps refined start to the nearest low-energy 100 ms hop within
    [max(prev_word_end, word_start - 0.25), word_start - 0.03] (never later than word_start);
    falls back to standard pre_roll_s when RMS unavailable or window empty.
    """
    floor_t = min(word_start, max(0.0, prev_word_end)) if prev_word_end is not None else 0.0
    default_t = max(floor_t, min(word_start, word_start - pre_roll_s))
    if rms_per_100ms is None or rms_per_100ms.size == 0:
        return default_t

    lo_t = max(floor_t, word_start - 0.25)
    hi_t = min(word_start - 0.03, (rms_per_100ms.size - 1) * 0.1)
    if hi_t < lo_t:
        return default_t
    i0 = max(0, int(math.ceil(lo_t * 10.0 - 1e-9)))
    i1 = min(rms_per_100ms.size - 1, int(math.floor(hi_t * 10.0 + 1e-9)))
    if i1 < i0:
        return default_t

    seg = rms_per_100ms[i0 : i1 + 1]
    min_rms = float(np.min(seg))
    low_thresh = min_rms * 1.05 + 1e-6
    low_indices = [i0 + idx for idx, val in enumerate(seg.tolist()) if val <= low_thresh]
    best_idx = min(low_indices, key=lambda idx: (abs(idx * 0.1 - (word_start - 0.03)), idx))
    return max(floor_t, min(word_start - 0.03, best_idx * 0.1))


def refine_start(
    cand: HookCandidate,
    utterances: Sequence[Utterance],
    min_dur: float = 10.0,
    pre_roll_s: float = 0.15,
    search_window_s: float = 12.0,
    max_lead_in_s: float = 5.0,
    refine_min_gain: float = 1.0,
    max_dur: Optional[float] = None,
    rms_per_100ms: Optional[np.ndarray] = None,
) -> Tuple[float, float, str]:
    """
    Inside the first 12 s of the winning window:
      - Moves start to a later sentence ONLY if its hook score beats the original first sentence
        by >= refine_min_gain AND leaves >= min_dur.
      - Strips strictly leading greeting phrases and filler tokens (never < 3 words remaining).
      - Keeps <= max_lead_in_s lead-in only if the hook has a dangling setup reference.
      - Enforces min_dur <= (refined_end - refined_start) <= max_dur (when max_dur given).
    Mutates `cand` and returns (refined_start, refined_end, hook_sentence).
    """
    slice_utts = [u for u in utterances if cand.start_utt_idx <= u.index <= cand.end_utt_idx]
    if not slice_utts:
        cand.refined_start = cand.start
        cand.refined_end = cand.end
        return cand.start, cand.end, cand.hook_sentence

    win_start = slice_utts[0].start
    win_end = slice_utts[-1].end
    first_12_utts = [u for u in slice_utts if u.start <= win_start + search_window_s]
    if not first_12_utts:
        first_12_utts = [slice_utts[0]]

    # Score original first utterance (after stripping any leading filler so comparison is fair)
    orig_u = first_12_utts[0]
    orig_words, _ = _strip_leading_fillers_words(orig_u.words)
    orig_text_clean = " ".join(w["word"] for w in orig_words).strip() or orig_u.text
    orig_sc, _ = score_sentence_hook(orig_u.text)
    if cand.hook_start_t is not None and abs(orig_u.start - cand.hook_start_t) <= 1.5:
        orig_sc += 1.2

    best_u = orig_u
    best_sc = orig_sc

    for u in first_12_utts[1:]:
        if (win_end - u.start) < min_dur - 1e-6:
            continue
        sc, _ = score_sentence_hook(u.text)
        if cand.hook_start_t is not None and abs(u.start - cand.hook_start_t) <= 1.5:
            sc += 1.2
        # Move to later sentence ONLY if it beats the original by >= refine_min_gain
        if (sc - orig_sc) >= refine_min_gain and sc > best_sc:
            best_sc = sc
            best_u = u

    hook_words, stripped_words = _strip_leading_fillers_words(best_u.words)
    hook_sentence = " ".join(w["word"] for w in hook_words).strip() or orig_text_clean
    hook_word_start = hook_words[0]["start"] if hook_words else best_u.start

    # Previous word end (for RMS snap floor)
    prev_word_end: Optional[float] = None
    if stripped_words and len(best_u.words) > len(hook_words):
        prev_word_end = best_u.words[len(best_u.words) - len(hook_words) - 1]["end"]
    elif best_u.index > 0:
        prev_word_end = utterances[best_u.index - 1].end

    # Keep <= max_lead_in_s lead-in ONLY if hook_sentence has a dangling setup reference
    needs_lead_in = any(p.search(_normalize_text(hook_sentence)) for p in _DANGLING_REF_PATTERNS)
    if needs_lead_in and best_u.index > slice_utts[0].index:
        prev_u = utterances[best_u.index - 1]
        if (hook_word_start - prev_u.start) <= max_lead_in_s:
            hook_word_start = prev_u.start
            prev_word_end = utterances[prev_u.index - 1].end if prev_u.index > 0 else None

    # Snap / pre-roll
    snapped_start = _snap_start_with_rms(hook_word_start, prev_word_end, rms_per_100ms, pre_roll_s)

    # Enforce strict length bounds [min_dur, max_dur]
    refined_end = round(win_end, 3)
    if (refined_end - snapped_start) < min_dur - 1e-6:
        # Don't move start past what keeps min_dur (fall back toward win_start)
        snapped_start = max(0.0, min(snapped_start, win_start))
    if max_dur is not None and (refined_end - snapped_start) > max_dur + 1e-6:
        # Trim pre-roll so duration never exceeds max_dur
        snapped_start = max(snapped_start, refined_end - max_dur)

    refined_start = round(max(0.0, snapped_start), 3)

    cand.refined_start = refined_start
    cand.refined_end = refined_end
    cand.hook_sentence = hook_sentence
    cand.refine_details = {
        "moved_from": round(win_start, 3),
        "moved_to": refined_start,
        "stripped_words": stripped_words,
    }
    return refined_start, refined_end, hook_sentence


# ─────────────────────── 6. Shortlisting, Dedup & Reports ───────────────────────
def _overlap_ratio(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    inter = max(0.0, min(a_end, b_end) - max(a_start, b_start))
    denom = max(1e-6, min(a_end - a_start, b_end - b_start))
    return inter / denom


def _transcript_slice(words: Sequence[Dict[str, Any]], t0: float, t1: float) -> str:
    out: List[str] = []
    for w in words:
        if not isinstance(w, dict) or "start" not in w or w["start"] is None:
            continue
        try:
            st = float(w["start"])
        except Exception:
            continue
        if t0 <= st <= t1:
            tok = str(w.get("word") if "word" in w else w.get("text", "")).strip()
            if tok:
                out.append(tok)
    return " ".join(out)


def _select_duration_variants(group: Sequence[HookCandidate], max_variants: int = 3) -> List[HookCandidate]:
    """Picks up to 3 duration variants for one start: shortest, nearest 30 s, and longest."""
    ordered = sorted(group, key=lambda c: (c.end - c.start))
    if len(ordered) <= max_variants:
        return ordered
    shortest = ordered[0]
    longest = ordered[-1]
    mid = min(ordered[1:-1], key=lambda c: abs((c.end - c.start) - 30.0))
    picked: List[HookCandidate] = []
    for cand in (shortest, mid, longest):
        if cand.id not in {p.id for p in picked}:
            picked.append(cand)
    return picked


def _build_shortlist_batch(
    all_candidates: Sequence[HookCandidate],
    already_considered_starts: set[int],
    max_starts: int = 12,
    max_start_overlap: float = 0.5,
    max_variants_per_start: int = 3,
) -> Tuple[List[HookCandidate], set[int]]:
    """
    Shortlists up to `max_starts` distinct utterance starts (whose shortest windows overlap
    <= max_start_overlap) and expands each start to up to `max_variants_per_start` duration
    variants (shortest, nearest 30 s, longest) for the LLM judge.
    """
    by_start: Dict[int, List[HookCandidate]] = {}
    for c in all_candidates:
        if c.start_utt_idx in already_considered_starts:
            continue
        by_start.setdefault(c.start_utt_idx, []).append(c)

    if not by_start:
        return [], set()

    # Rank distinct starts by best local_score (tie-break: earliest start)
    ranked_starts: List[Tuple[float, float, int, HookCandidate]] = []
    for s_idx, grp in by_start.items():
        shortest = min(grp, key=lambda c: (c.end - c.start))
        best_local = max(c.local_score for c in grp)
        ranked_starts.append((best_local, -shortest.start, s_idx, shortest))
    ranked_starts.sort(key=lambda x: (x[0], x[1]), reverse=True)

    chosen_shortest: List[HookCandidate] = []
    chosen_start_idxs: set[int] = set()
    batch: List[HookCandidate] = []

    for _, _, s_idx, shortest in ranked_starts:
        if len(chosen_shortest) >= max_starts:
            break
        if any(_overlap_ratio(shortest.start, shortest.end, prev.start, prev.end) > max_start_overlap for prev in chosen_shortest):
            continue
        chosen_shortest.append(shortest)
        chosen_start_idxs.add(s_idx)
        batch.extend(_select_duration_variants(by_start[s_idx], max_variants=max_variants_per_start))

    return batch, chosen_start_idxs


def _recompute_unified_zscores(candidates: Sequence[HookCandidate], weights: HookWeights) -> None:
    """Recomputes per-provider z-scores across all judged candidates so multi-batch runs share one scale."""
    judged = [c for c in candidates if c.judged and c.provider_scores]
    if not judged:
        return
    prov_composites: Dict[str, Dict[str, float]] = {}
    for c in judged:
        for pname, v in c.provider_scores.items():
            comp = (
                weights.hook_3s * v["hook_3s"]
                + weights.standalone * v["standalone"]
                + weights.payoff * v["payoff"]
                + weights.intensity * v["intensity"]
                + weights.local * c.local_score
            )
            prov_composites.setdefault(pname, {})[c.id] = comp

    prov_z: Dict[str, Dict[str, float]] = {}
    for pname, raw_map in prov_composites.items():
        arr = np.asarray(list(raw_map.values()), dtype=np.float64)
        mean = float(np.mean(arr)) if arr.size else 0.0
        std = float(np.std(arr)) if arr.size else 0.0
        if std > 1e-6:
            prov_z[pname] = {cid: (val - mean) / std for cid, val in raw_map.items()}
        else:
            prov_z[pname] = {cid: 0.0 for cid in raw_map}

    for c in judged:
        zs = [prov_z[p][c.id] for p in sorted(c.provider_scores.keys()) if p in prov_z and c.id in prov_z[p]]
        if zs:
            c.norm_rank_score = round(sum(zs) / len(zs), 5)


def _rank_key(c: HookCandidate, any_provider_succeeded: bool) -> Tuple[int, float, float, float]:
    """Judged candidates ALWAYS strictly outrank unjudged ones; never compare on one scale."""
    if any_provider_succeeded:
        if c.judged:
            return (1, c.norm_rank_score, c.final_score, -c.start)
        return (0, c.local_score, c.final_score, -c.start)
    return (0, c.final_score, c.local_score, -c.start)


def write_hook_reports(
    out_dir: Union[str, Path],
    video_label: str,
    selected: Sequence[HookCandidate],
    all_candidates: Sequence[HookCandidate],
    words: Sequence[Dict[str, Any]],
    providers_used: Sequence[str],
    hook_mode: str,
    hook_hint: Optional[str] = None,
    providers_failed: Optional[Dict[str, str]] = None,
    fallbacks: Optional[Sequence[str]] = None,
    report_top_n: int = 50,
    report_prefix: str = "",
) -> Tuple[Path, Path]:
    """Writes `<prefix>analysis_report.json` and `<prefix>hook_debug.md`."""
    out_p = Path(out_dir)
    out_p.mkdir(parents=True, exist_ok=True)
    any_prov = bool(providers_used) and list(providers_used) != ["manual"]
    ranked_all = sorted(all_candidates, key=lambda x: _rank_key(x, any_prov), reverse=True)
    capped_all = ranked_all[: max(1, int(report_top_n))] if ranked_all else []

    winner = selected[0] if selected else None
    runners_up = list(selected[1:5]) if len(selected) > 1 else [c for c in capped_all[:5] if c is not winner]

    win_start = (
        winner.refined_start if (winner is not None and winner.refined_start is not None)
        else (winner.start if winner is not None else 0.0)
    )
    win_end = (
        winner.refined_end if (winner is not None and winner.refined_end is not None)
        else (winner.end if winner is not None else 0.0)
    )
    before_10s = _transcript_slice(words, max(0.0, win_start - 10.0), max(0.0, win_start - 0.01))
    after_10s = _transcript_slice(words, win_start, win_start + 10.0)

    report_obj = {
        "pipeline_version": PIPELINE_VERSION,
        "video": video_label,
        "hook_mode": hook_mode,
        "hook_hint": hook_hint,
        "llm_providers_used": list(providers_used),
        "providers_failed": dict(providers_failed or {}),
        "fallbacks": list(fallbacks or []),
        "total_candidates": len(all_candidates),
        "total_judged": sum(1 for c in all_candidates if c.judged),
        "selected_clips": [asdict(c) for c in selected],
        "winner_context": {
            "start": win_start,
            "end": win_end,
            "hook_sentence": winner.hook_sentence if winner is not None else "",
            "reason": winner.reason if winner is not None else "",
            "refine_details": winner.refine_details if winner is not None else {},
            "transcript_before_10s": before_10s,
            "transcript_after_10s": after_10s,
        },
        "runners_up": [asdict(c) for c in runners_up],
        "all_candidates": [asdict(c) for c in capped_all],
    }

    json_path = out_p / f"{report_prefix}analysis_report.json"
    json_path.write_text(json.dumps(report_obj, indent=2), encoding="utf-8")

    md_lines = [
        f"# Hook Selection Debug Report (`{PIPELINE_VERSION}`)",
        f"- **Video**: `{video_label}`",
        f"- **Mode**: `{hook_mode}` | **Hint**: `{hook_hint or 'none'}` | **LLM Providers**: `{', '.join(providers_used) or 'rules-only fallback'}`",
        f"- **Providers Failed**: `{providers_failed or {}}` | **Fallbacks**: `{list(fallbacks or [])}`",
        f"- **Total Candidates Evaluated**: {len(all_candidates)} (judged: {sum(1 for c in all_candidates if c.judged)})",
        "",
    ]
    if winner is not None:
        md_lines.extend([
            "## Winning Clip",
            f"- **Window**: `{win_start:.2f}s` -> `{win_end:.2f}s` (final score: **{winner.final_score:.2f}/10**, judged={winner.judged})",
            f"- **Hook Sentence**: > {winner.hook_sentence}",
            f"- **Why It Won**: {winner.reason}",
            f"- **Refine**: `{winner.refine_details}`",
            f"- **Scores**: `hook_3s={winner.hook_3s:.2f}`, `standalone={winner.standalone:.2f}`, `payoff={winner.payoff:.2f}`, `intensity={winner.intensity:.2f}`, `local={winner.local_score:.2f}`",
            "",
            "### Transcript Context Around Start",
            f"- **10s Before (`{max(0.0, win_start - 10):.1f}s – {win_start:.1f}s`)**: {before_10s or '*(start of video)*'}",
            f"- **10s After (`{win_start:.1f}s – {win_start + 10:.1f}s`)**: {after_10s}",
            "",
        ])

    md_lines.append("## Runners-Up")
    for idx, r in enumerate(runners_up, 1):
        r_st = r.refined_start if r.refined_start is not None else r.start
        r_en = r.refined_end if r.refined_end is not None else r.end
        md_lines.append(
            f"{idx}. `{r.id}` (`{r_st:.2f}s–{r_en:.2f}s`, judged={r.judged}, "
            f"final={r.final_score:.2f}, hook_3s={r.hook_3s:.2f}, local={r.local_score:.2f}): \"{r.hook_sentence}\""
        )

    md_lines.extend([
        "",
        "## Top Ranked Candidates (Top 20)",
        "| ID | Judged | Start | End | Final | Hook3s | Standalone | Payoff | Intensity | Local | Hook Sentence |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ])
    for c in capped_all[:20]:
        hs_txt = c.hook_sentence.replace("|", "/")[:80]
        md_lines.append(
            f"| {c.id} | {c.judged} | {c.start:.2f}s | {c.end:.2f}s | {c.final_score:.2f} | "
            f"{c.hook_3s:.2f} | {c.standalone:.2f} | {c.payoff:.2f} | {c.intensity:.2f} | {c.local_score:.2f} | {hs_txt} |"
        )

    md_path = out_p / f"{report_prefix}hook_debug.md"
    md_path.write_text("\n".join(md_lines) + "\n", encoding="utf-8")
    return json_path, md_path


def format_explain_summary(
    selected: Sequence[HookCandidate],
    providers_used: Sequence[str],
    report_json: Optional[Union[str, Path]] = None,
) -> str:
    lines = [f"[HookSelector {PIPELINE_VERSION}] providers={list(providers_used) or ['rules-only']} selected={len(selected)}"]
    for i, c in enumerate(selected, 1):
        st = c.refined_start if c.refined_start is not None else c.start
        en = c.refined_end if c.refined_end is not None else c.end
        lines.append(
            f"  #{i} {st:.2f}s-{en:.2f}s (judged={c.judged}, score={c.final_score:.2f}, hook_3s={c.hook_3s:.2f}, local={c.local_score:.2f}): "
            f"\"{c.hook_sentence}\" — {c.reason[:140]}"
        )
    if report_json is not None:
        lines.append(f"  Report: {report_json}")
    return "\n".join(lines)


# ─────────────────────── 7. Main Selection Pipeline ───────────────────────
def _build_meta(
    providers_used: Sequence[str],
    providers_failed: Dict[str, str],
    candidates_count: int,
    hook_mode: str,
    fallbacks: List[str],
    degraded: bool,
    audio_probe: str,
    min_dur_relaxed: bool = False,
    rep_paths: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    return {
        "pipeline_version": PIPELINE_VERSION,
        "providers_used": list(providers_used),
        "providers_failed": dict(providers_failed),
        "candidates_count": int(candidates_count),
        "hook_mode": hook_mode,
        "fallbacks": list(fallbacks),
        "degraded": bool(degraded),
        "audio_probe": audio_probe,
        "min_dur_relaxed": bool(min_dur_relaxed),
        **(rep_paths or {}),
    }


def _select_from_pool(
    pool: Sequence[HookCandidate],
    utterances: Sequence[Utterance],
    clip_count: int,
    eff_min_dur: float,
    max_dur: float,
    refine_min_gain: float,
    rms_per_100ms: Optional[np.ndarray],
    already_selected: Optional[List[HookCandidate]] = None,
) -> List[HookCandidate]:
    """Refines copies of candidates and greedily deduplicates (>50% overlap)."""
    selected = list(already_selected or [])
    for c in pool:
        if len(selected) >= clip_count:
            break
        copy_c = replace(
            c,
            local_features=dict(c.local_features),
            provider_scores=dict(c.provider_scores),
            refine_details=dict(c.refine_details),
        )
        st, en, _ = refine_start(
            copy_c,
            utterances,
            min_dur=eff_min_dur,
            refine_min_gain=refine_min_gain,
            max_dur=max_dur,
            rms_per_100ms=rms_per_100ms,
        )
        if (en - st) < eff_min_dur - 1e-3 or (en - st) > max_dur + 1e-3:
            continue
        overlaps = any(
            _overlap_ratio(
                st, en,
                s.refined_start if s.refined_start is not None else s.start,
                s.refined_end if s.refined_end is not None else s.end,
            ) > 0.50
            for s in selected
        )
        if overlaps:
            continue
        selected.append(copy_c)
    return selected


def select_hook_clips(
    words: Sequence[Dict[str, Any]],
    clip_count: int = 3,
    min_dur: float = 15.0,
    max_dur: float = 60.0,
    hook_mode: str = "balanced",
    hook_hint: Optional[str] = None,
    manual_start: Optional[float] = None,
    manual_end: Optional[float] = None,
    video_path: Optional[Union[str, Path]] = None,
    scene_cuts: Union[Sequence[float], np.ndarray] = (),
    report_dir: Optional[Union[str, Path]] = None,
    video_label: str = "video",
    use_llm: bool = True,
    llm_caller: Optional[Callable[[str, str, str, float], Any]] = None,
    providers: Optional[Sequence[str]] = None,
    ffmpeg_bin: str = "ffmpeg",
    person_visible_times: Optional[Union[Sequence[float], np.ndarray]] = None,
    stride_s: float = 3.0,
    shortlist_max_overlap: float = 0.5,
    max_judge_batches: int = 2,
    min_providers: int = 2,
    min_provider_coverage: float = 0.5,
    refine_min_gain: float = 1.0,
    weights: HookWeights = DEFAULT_HOOK_WEIGHTS,
    max_workers: int = 2,
    audio_probe_timeout_s: float = 120.0,
    report_top_n: int = 50,
    report_prefix: str = "",
    max_starts: int = 8,
) -> Tuple[List[HookCandidate], Dict[str, Any]]:
    """
    Main unified M6a v2 hook selection entry point (used by both CLI and backend).
    Returns (selected_clips, meta_dict) with a single consistent meta schema on every path.
    """
    # Input validation (Phase 2 #6 & #7)
    if clip_count < 0:
        raise ValueError(f"clip_count must be >= 0, got {clip_count}")
    if min_dur <= 0.0:
        raise ValueError(f"min_dur must be > 0, got {min_dur}")
    if min_dur > max_dur:
        raise ValueError(f"min_dur ({min_dur}) must be <= max_dur ({max_dur})")
    if stride_s <= 0.0:
        raise ValueError(f"stride_s must be > 0, got {stride_s}")
    if max_starts < 1:
        raise ValueError(f"max_starts must be >= 1, got {max_starts}")
    mode = (hook_mode or "balanced").strip().lower()
    if mode not in _VALID_HOOK_MODES:
        raise ValueError(f"hook_mode must be one of {_VALID_HOOK_MODES}, got {hook_mode!r}")

    if (manual_start is None) != (manual_end is None):
        raise ValueError("Both manual_start and manual_end must be provided together")
    if manual_start is not None and manual_end is not None:
        if not (0.0 <= manual_start < manual_end):
            raise ValueError(f"Invalid manual range: require 0 <= manual_start < manual_end, got [{manual_start}, {manual_end}]")

    fallbacks: List[str] = []
    providers_failed: Dict[str, str] = {}
    utterances = build_utterances(words)

    def _maybe_write_reports(
        sel: Sequence[HookCandidate],
        all_c: Sequence[HookCandidate],
        provs_used: Sequence[str],
    ) -> Dict[str, str]:
        if report_dir is None:
            return {}
        rj, rm = write_hook_reports(
            report_dir,
            video_label,
            sel,
            all_c,
            words,
            provs_used,
            mode,
            hook_hint,
            providers_failed=providers_failed,
            fallbacks=fallbacks,
            report_top_n=report_top_n,
            report_prefix=report_prefix,
        )
        return {"analysis_report_json": str(rj), "hook_debug_md": str(rm)}

    # Manual --start / --end override
    if manual_start is not None and manual_end is not None:
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
            judged=False,
        )
        rep_paths = _maybe_write_reports([manual_cand], [manual_cand], ["manual"])
        return [manual_cand], _build_meta(
            providers_used=["manual"],
            providers_failed={},
            candidates_count=1,
            hook_mode=mode,
            fallbacks=[],
            degraded=False,
            audio_probe="skipped",
            min_dur_relaxed=False,
            rep_paths=rep_paths,
        )

    if clip_count == 0 or not utterances:
        rep_paths = _maybe_write_reports([], [], [])
        return [], _build_meta(
            providers_used=[],
            providers_failed={},
            candidates_count=0,
            hook_mode=mode,
            fallbacks=[],
            degraded=False,
            audio_probe="skipped",
            min_dur_relaxed=False,
            rep_paths=rep_paths,
        )

    cands, min_dur_relaxed, eff_min_dur, degraded_boundaries = _generate_candidates_impl(
        utterances, min_dur=min_dur, max_dur=max_dur, stride_s=stride_s
    )
    if min_dur_relaxed:
        fallbacks.append("min_dur_relaxed")
    if degraded_boundaries:
        fallbacks.append("degraded_boundaries->all_utterance_starts")

    if not cands:
        rep_paths = _maybe_write_reports([], [], [])
        return [], _build_meta(
            providers_used=[],
            providers_failed={},
            candidates_count=0,
            hook_mode=mode,
            fallbacks=fallbacks,
            degraded=False,
            audio_probe="skipped",
            min_dur_relaxed=min_dur_relaxed,
            rep_paths=rep_paths,
        )

    rms_1s, rms_100ms, audio_probe_status = _probe_audio_rms_profile(
        video_path, ffmpeg_bin=ffmpeg_bin, timeout_s=audio_probe_timeout_s
    )
    for c in cands:
        score_candidate_local(
            c,
            utterances,
            rms_per_sec=rms_1s,
            scene_cuts=scene_cuts,
            hook_hint=hook_hint,
            person_visible_times=person_visible_times,
        )
        c.final_score = c.local_score
        c.hook_3s = c.local_score

    # Mode filter helper (records fallbacks cleanly; strict never admits unjudged when judged exist)
    def _apply_mode_filter(pool: Sequence[HookCandidate], any_prov: bool, record_fb: bool) -> List[HookCandidate]:
        if mode == "strict":
            strict_pool = [
                c for c in pool
                if c.hook_3s >= 7.0
                and c.is_sentence_boundary
                and not c.local_features.get("penalty_clip_sponsor")
                and (c.judged if any_prov else True)
            ]
            if strict_pool:
                return strict_pool
            if record_fb:
                fallbacks.append("strict_pool_empty->judged_all" if any_prov else "strict_pool_empty->all")
            # Strict still never admits unjudged candidates when a provider succeeded
            return [c for c in pool if (c.judged if any_prov else True)]

        if mode == "balanced":
            non_sponsor = [c for c in pool if not c.local_features.get("penalty_clip_sponsor")]
            if non_sponsor:
                return non_sponsor
            if record_fb:
                fallbacks.append("balanced_non_sponsor_empty->all")
            return list(pool)

        return list(pool)

    providers_used_set: set[str] = set()
    considered_starts: set[int] = set()
    degraded = False
    selected: List[HookCandidate] = []

    if use_llm:
        for batch_idx in range(max(1, int(max_judge_batches))):
            batch, used_starts = _build_shortlist_batch(
                cands,
                already_considered_starts=considered_starts,
                max_starts=max_starts,
                max_start_overlap=shortlist_max_overlap,
                max_variants_per_start=3,
            )
            if not batch:
                break
            considered_starts.update(used_starts)

            prov_ok, _ = judge_candidates_llm(
                batch,
                providers=providers,
                hook_hint=hook_hint,
                llm_caller=llm_caller,
                utterances=utterances,
                weights=weights,
                min_provider_coverage=min_provider_coverage,
                max_workers=max_workers,
                providers_failed_out=providers_failed,
            )
            providers_used_set.update(prov_ok)

            if not prov_ok:
                # All providers failed on this batch -> don't waste retries; fall back to rules-only
                if batch_idx == 0:
                    fallbacks.append("llm_all_failed->rules_only")
                    degraded = True
                break

            if len(prov_ok) < min_providers:
                degraded = True

            # Unify per-provider z-scores across all judged candidates so multi-batch runs share one scale
            if batch_idx > 0:
                _recompute_unified_zscores(cands, weights)

            # Check non-fallback survivors before deciding whether to refill with another batch
            judged_only = sorted(
                [c for c in cands if c.judged],
                key=lambda x: _rank_key(x, any_provider_succeeded=True),
                reverse=True,
            )
            if mode == "strict":
                non_fallback_pool = [
                    c for c in judged_only
                    if c.hook_3s >= 7.0
                    and c.is_sentence_boundary
                    and not c.local_features.get("penalty_clip_sponsor")
                ]
            elif mode == "balanced":
                non_fallback_pool = [c for c in judged_only if not c.local_features.get("penalty_clip_sponsor")]
            else:
                non_fallback_pool = judged_only

            selected = _select_from_pool(
                non_fallback_pool, utterances, clip_count, eff_min_dur, max_dur, refine_min_gain, rms_100ms
            )
            if len(selected) >= clip_count:
                break

        providers_used = sorted(providers_used_set)
        any_prov = len(providers_used) > 0

        if any_prov:
            judged_only = sorted(
                [c for c in cands if c.judged],
                key=lambda x: _rank_key(x, any_provider_succeeded=True),
                reverse=True,
            )
            filtered_judged = _apply_mode_filter(judged_only, any_prov=True, record_fb=True)
            selected = _select_from_pool(
                filtered_judged, utterances, clip_count, eff_min_dur, max_dur, refine_min_gain, rms_100ms
            )
            # Fill remaining slots from unjudged ONLY if not strict mode and still short of clip_count
            if len(selected) < clip_count and mode != "strict":
                unjudged = sorted(
                    [c for c in cands if not c.judged],
                    key=lambda x: _rank_key(x, any_provider_succeeded=False),
                    reverse=True,
                )
                filtered_unjudged = _apply_mode_filter(unjudged, any_prov=False, record_fb=False)
                before_fill = len(selected)
                selected = _select_from_pool(
                    filtered_unjudged, utterances, clip_count, eff_min_dur, max_dur, refine_min_gain, rms_100ms,
                    already_selected=selected,
                )
                if len(selected) > before_fill:
                    fallbacks.append("filled_with_unjudged")
        else:
            # Rules-only fallback when all providers failed or none configured
            if not providers_used and not any("rules_only" in fb for fb in fallbacks):
                fallbacks.append("no_providers->rules_only")
                degraded = True
            for c in cands:
                if not c.reason:
                    c.reason = f"[rules] local_score={c.local_score:.2f}"
            ranked_rules = sorted(cands, key=lambda x: _rank_key(x, any_provider_succeeded=False), reverse=True)
            filtered_rules = _apply_mode_filter(ranked_rules, any_prov=False, record_fb=True)
            selected = _select_from_pool(
                filtered_rules, utterances, clip_count, eff_min_dur, max_dur, refine_min_gain, rms_100ms
            )
    else:
        providers_used = []
        for c in cands:
            c.reason = f"[rules] local_score={c.local_score:.2f}"
        ranked_rules = sorted(cands, key=lambda x: _rank_key(x, any_provider_succeeded=False), reverse=True)
        filtered_rules = _apply_mode_filter(ranked_rules, any_prov=False, record_fb=True)
        selected = _select_from_pool(
            filtered_rules, utterances, clip_count, eff_min_dur, max_dur, refine_min_gain, rms_100ms
        )

    rep_paths = _maybe_write_reports(selected, cands, providers_used)
    return selected, _build_meta(
        providers_used=providers_used,
        providers_failed=providers_failed,
        candidates_count=len(cands),
        hook_mode=mode,
        fallbacks=fallbacks,
        degraded=degraded,
        audio_probe=audio_probe_status,
        min_dur_relaxed=min_dur_relaxed,
        rep_paths=rep_paths,
    )
