from __future__ import annotations

import logging
import random
import re
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend" / "python-engine"))

from openclip_engine.scoring import hook_selector as hs
from openclip_engine.scoring.hook_selector import (
    HookCandidate,
    Utterance,
    build_utterances,
    format_explain_summary,
    generate_candidates,
    is_sponsor_text,
    judge_candidates_llm,
    refine_start,
    score_candidate_local,
    score_sentence_hook,
    select_hook_clips,
    shuffle_for_provider,
    validate_judge_item,
    write_hook_reports,
)

# ─────────────────────── Seeded Synthetic Transcript Generator & Fake Judge ───────────────────────
_PLAIN_SENTENCES = [
    "We walked down the street to see how the project looked today.",
    "The setup took a few hours before the cameras were ready.",
    "Most of the crew stayed behind the barrier during the test.",
    "After lunch we checked the weather forecast for the afternoon.",
    "The table sat near the corner of the studio next to the lights.",
    "Several volunteers helped carry equipment into the main warehouse.",
    "We reviewed the notes from yesterday to make sure the schedule held.",
    "The building had three entrances facing the parking lot outside.",
]

_HOOKY_SENTENCES = [
    "Why does nobody talk about this $250,000 mistake that ruins beginners?",
    "Wait until you see what happens when the timer hits zero!",
    "Nobody tells you this secret until you lose everything.",
    "Here’s why 90% of players fail in the first ten seconds.",
    "This impossible trap almost destroyed our entire studio!",
    "What happens if you survive forty-eight hours without sleep?",
]

_SPONSOR_SENTENCES = [
    "This video is sponsored by Acme VPN, use promo code SAVE50 for 20% off.",
    "Today's episode is brought to you by CloudBox with a free trial in the description.",
    "Don't forget to subscribe to the channel and check out the affiliate link below.",
]


def make_words_from_sentences(
    sentences: Sequence[Tuple[str, float]],
    start_t: float = 0.0,
    word_dur: float = 0.28,
    mid_sentence_pause_prob: float = 0.0,
    seed: int = 123,
) -> List[Dict[str, Any]]:
    """
    Turns [(sentence_text, pause_after_s), ...] into realistic word timestamps.
    Optionally injects soft mid-sentence pauses (0.5 s) inside sentences.
    """
    rng = random.Random(seed)
    words: List[Dict[str, Any]] = []
    t = start_t
    for sent, pause_after in sentences:
        toks = sent.split()
        for idx, tok in enumerate(toks):
            if mid_sentence_pause_prob > 0.0 and 2 <= idx <= len(toks) - 3 and rng.random() < mid_sentence_pause_prob:
                t += 0.52  # soft mid-sentence pause (0.4-0.8s, no punctuation)
            words.append({"word": tok, "start": round(t, 3), "end": round(t + word_dur * 0.85, 3)})
            t += word_dur
        t += pause_after
    return words


def generate_synthetic_transcript_with_truth(
    duration_s: float = 1800.0,
    seed: int = 42,
    mid_sentence_pause_prob: float = 0.12,
) -> Tuple[List[Dict[str, Any]], set[float], set[float]]:
    """
    Deterministic synthetic transcript generator returning (words, gt_sentence_starts, gt_sentence_ends).
    Ground-truth edge timestamps are recorded directly from emitted sentences (independent of module flags).
    """
    rng = random.Random(seed)
    words: List[Dict[str, Any]] = []
    gt_starts: set[float] = set()
    gt_ends: set[float] = set()
    t = 0.0
    sent_i = 0
    while t < duration_s:
        if sent_i % 25 == 7:
            sent = _SPONSOR_SENTENCES[(sent_i // 25) % len(_SPONSOR_SENTENCES)]
        elif sent_i % 11 == 3:
            sent = _HOOKY_SENTENCES[(sent_i // 11) % len(_HOOKY_SENTENCES)]
        else:
            sent = _PLAIN_SENTENCES[rng.randrange(len(_PLAIN_SENTENCES))]
        toks = sent.split()
        sent_start: Optional[float] = None
        sent_end: Optional[float] = None
        for idx, tok in enumerate(toks):
            if mid_sentence_pause_prob > 0.0 and 2 <= idx <= len(toks) - 3 and rng.random() < mid_sentence_pause_prob:
                t += 0.50
            w_st = round(t, 3)
            w_en = round(t + 0.26, 3)
            if sent_start is None:
                sent_start = w_st
            sent_end = w_en
            words.append({"word": tok, "start": w_st, "end": w_en})
            t += 0.30
        if sent_start is not None and sent_end is not None:
            gt_starts.add(sent_start)
            gt_ends.add(sent_end)
        t += rng.choice([0.15, 0.25, 0.90])
        sent_i += 1
    return words, gt_starts, gt_ends


def generate_synthetic_transcript(
    duration_s: float = 1800.0,
    seed: int = 42,
    mid_sentence_pause_prob: float = 0.12,
) -> List[Dict[str, Any]]:
    """Deterministic synthetic transcript generator covering plain, hooky, and sponsor speech."""
    words, _, _ = generate_synthetic_transcript_with_truth(
        duration_s=duration_s, seed=seed, mid_sentence_pause_prob=mid_sentence_pause_prob,
    )
    return words


def make_fake_llm(
    score_fn: Callable[[str, Dict[str, Any]], Optional[Dict[str, Any]]],
    wrap_dict: bool = True,
) -> Tuple[Callable[[str, str, str, float], Any], List[Dict[str, Any]]]:
    """
    Fake LLM caller that parses candidate blocks out of the judge prompt, calls
    `score_fn(provider, cand_info)` per candidate, and records every invocation.
    """
    recorded: List[Dict[str, Any]] = []

    def _caller(provider: str, prompt: str, sys_prompt: str, temp: float) -> Any:
        # Parse candidate blocks from prompt: - id: "cand_001" | window: 12.00s-32.00s
        parsed_cands: List[Dict[str, Any]] = []
        for m in re.finditer(r'id:\s*"([^"]+)"\s*\|\s*window:\s*([0-9.]+)s-([0-9.]+)s', prompt):
            cid, st, en = m.group(1), float(m.group(2)), float(m.group(3))
            parsed_cands.append({"id": cid, "start": st, "end": en, "duration": en - st})

        recorded.append({
            "provider": provider,
            "prompt": prompt,
            "sys_prompt": sys_prompt,
            "temp": temp,
            "candidates": parsed_cands,
        })

        items: List[Dict[str, Any]] = []
        for cinfo in parsed_cands:
            res = score_fn(provider, cinfo)
            if res is not None:
                items.append(res)
        return {"candidates": items} if wrap_dict else items

    return _caller, recorded


# ─────────────────────── PHASE 1: CORRECTNESS TESTS ───────────────────────
def test_judge_influence_low_scores_never_bypassed():
    words = generate_synthetic_transcript(duration_s=600.0, seed=7)

    for constant_score in (2.0, 6.0):
        caller, calls = make_fake_llm(
            lambda prov, c, sc=constant_score: {
                "id": c["id"],
                "hook_3s": sc,
                "standalone": sc,
                "payoff": sc,
                "intensity": sc,
                "hook_utt": 0,
                "hook_start_t": c["start"],
                "reason": f"Scored {sc} by {prov}",
            }
        )
        selected, meta = select_hook_clips(
            words, clip_count=3, min_dur=15.0, max_dur=45.0,
            use_llm=True, llm_caller=caller, providers=["groq", "gemini"],
        )
        assert len(selected) == 3
        assert meta["providers_used"] == ["gemini", "groq"] or set(meta["providers_used"]) == {"groq", "gemini"}
        for clip in selected:
            assert clip.judged is True, f"Unjudged clip bypassed LLM judge: {clip.id} ({clip.reason})"
            assert "[rules]" not in clip.reason
            assert clip.reason.strip() != ""
        assert len(calls) >= 2


def test_judge_preference_beats_higher_local_score():
    words = generate_synthetic_transcript(duration_s=300.0, seed=11)
    # First inspect which starts get shortlisted by calling once with constant score
    probe_caller, probe_calls = make_fake_llm(
        lambda prov, c: {
            "id": c["id"], "hook_3s": 5.0, "standalone": 5.0, "payoff": 5.0,
            "intensity": 5.0, "hook_utt": 0, "hook_start_t": c["start"], "reason": "probe",
        }
    )
    select_hook_clips(words, clip_count=1, use_llm=True, llm_caller=probe_caller, providers=["groq", "gemini"])
    judged_ids = [c["id"] for c in probe_calls[0]["candidates"]]
    # Pick the LAST shortlisted candidate (lower local score) and have both providers prefer it strongly
    target_id = judged_ids[-1]

    caller, _ = make_fake_llm(
        lambda prov, c: {
            "id": c["id"],
            "hook_3s": 9.8 if c["id"] == target_id else 3.0,
            "standalone": 9.5 if c["id"] == target_id else 3.0,
            "payoff": 9.5 if c["id"] == target_id else 3.0,
            "intensity": 9.0 if c["id"] == target_id else 3.0,
            "hook_utt": 0,
            "hook_start_t": c["start"],
            "reason": "Preferred by judge" if c["id"] == target_id else "Weak",
        }
    )
    selected, _ = select_hook_clips(
        words, clip_count=1, use_llm=True, llm_caller=caller, providers=["groq", "gemini"],
    )
    assert len(selected) == 1
    assert selected[0].id == target_id
    assert selected[0].judged is True


def test_omitted_items_never_outrank_scored_peers():
    words = generate_synthetic_transcript(duration_s=400.0, seed=19)
    omitted_seen: List[str] = []

    def _skip_two(prov: str, c: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if len(omitted_seen) < 2 and c["id"] not in omitted_seen:
            omitted_seen.append(c["id"])
        if c["id"] in omitted_seen[:2]:
            return None  # omit from judge response
        return {
            "id": c["id"], "hook_3s": 2.5, "standalone": 2.5, "payoff": 2.5,
            "intensity": 2.5, "hook_utt": 0, "hook_start_t": c["start"], "reason": "Low score",
        }

    caller, _ = make_fake_llm(_skip_two)
    selected, _ = select_hook_clips(
        words, clip_count=3, use_llm=True, llm_caller=caller, providers=["groq", "gemini"],
    )
    assert len(selected) == 3
    for clip in selected:
        assert clip.id not in omitted_seen[:2], f"Omitted item {clip.id} outranked scored peers!"
        assert clip.judged is True


def test_duration_awareness_multiple_variants_and_30s_preference():
    words = generate_synthetic_transcript(duration_s=500.0, seed=23)
    caller, calls = make_fake_llm(
        lambda prov, c: {
            "id": c["id"],
            # Strongly reward ~30 s windows
            "hook_3s": 8.0,
            "standalone": 9.5 if 25.0 <= c["duration"] <= 36.0 else 3.0,
            "payoff": 9.5 if 25.0 <= c["duration"] <= 36.0 else 3.0,
            "intensity": 7.5,
            "hook_utt": 0,
            "hook_start_t": c["start"],
            "reason": "30s sweet spot" if 25.0 <= c["duration"] <= 36.0 else "wrong length",
        }
    )
    selected, _ = select_hook_clips(
        words, clip_count=3, min_dur=15.0, max_dur=60.0,
        use_llm=True, llm_caller=caller, providers=["groq", "gemini"],
    )
    assert len(calls) >= 2
    # Group candidates sent to provider 0 by start time
    by_start: Dict[float, List[float]] = {}
    for c in calls[0]["candidates"]:
        by_start.setdefault(round(c["start"], 1), []).append(c["duration"])
    assert len(by_start) >= 3
    multi_dur_starts = [s for s, durs in by_start.items() if len(durs) >= 2]
    assert len(multi_dur_starts) == len(by_start), f"Some shortlisted starts lacked >=2 duration variants: {by_start}"

    for clip in selected:
        st = clip.refined_start if clip.refined_start is not None else clip.start
        en = clip.refined_end if clip.refined_end is not None else clip.end
        dur = en - st
        assert 24.0 <= dur <= 38.0, f"Expected ~30s clip, got {dur:.2f}s"


def test_clean_sentence_boundaries_and_abbreviations():
    # Abbreviations must NEVER split a sentence
    abbr_words = make_words_from_sentences([
        ("Mr. Smith met Dr. Jones in the U.S. vs. Canada match, e.g. hockey, i.e. finals.", 0.2),
        ("What happened next shocked everyone!", 0.2),
    ])
    utts = build_utterances(abbr_words)
    assert len(utts) == 2, f"Abbreviation erroneously split sentence: {[u.text for u in utts]}"
    assert utts[0].starts_clean_sentence and utts[0].ends_clean_sentence
    assert utts[1].starts_clean_sentence and utts[1].ends_clean_sentence

    # Soft mid-sentence pauses (0.5s, no punctuation) and 24-word caps are NOT clean sentence edges
    words, gt_starts, gt_ends = generate_synthetic_transcript_with_truth(
        duration_s=300.0, seed=31, mid_sentence_pause_prob=0.25,
    )
    utts2 = build_utterances(words)
    cands = generate_candidates(utts2, min_dur=15.0, max_dur=60.0)
    assert len(cands) > 20
    clean_edges = sum(
        1 for c in cands
        if round(c.start, 3) in gt_starts and round(c.end, 3) in gt_ends
    )
    pct = clean_edges / len(cands)
    assert pct >= 0.99, f"Expected >=99% ground-truth clean sentence edges, got {pct*100:.1f}%"


def test_length_limits_and_overlap_dedup_and_short_relax():
    words = generate_synthetic_transcript(duration_s=400.0, seed=37)
    selected, meta = select_hook_clips(
        words, clip_count=3, min_dur=15.0, max_dur=45.0, use_llm=False,
    )
    assert len(selected) == 3
    assert meta.get("min_dur_relaxed") is False
    for c in selected:
        st = c.refined_start if c.refined_start is not None else c.start
        en = c.refined_end if c.refined_end is not None else c.end
        dur = en - st
        assert 15.0 <= dur <= 45.0, f"Clip {c.id} violated [15, 45]s bounds: {dur:.2f}s"

    # No pair overlaps > 50%
    for i in range(len(selected)):
        for j in range(i + 1, len(selected)):
            ci, cj = selected[i], selected[j]
            a_st: float = ci.refined_start if ci.refined_start is not None else ci.start
            a_en: float = ci.refined_end if ci.refined_end is not None else ci.end
            b_st: float = cj.refined_start if cj.refined_start is not None else cj.start
            b_en: float = cj.refined_end if cj.refined_end is not None else cj.end
            inter = max(0.0, min(a_en, b_en) - max(a_st, b_st))
            ov = inter / max(1e-6, min(a_en - a_st, b_en - b_st))
            assert ov <= 0.50 + 1e-6

    # Short input relaxes min_dur explicitly
    short_words = make_words_from_sentences([
        ("Nobody tells you this secret until you fail!", 0.2),
        ("Here is why you can fix it today.", 0.2),
    ])
    _, short_meta = select_hook_clips(short_words, clip_count=1, min_dur=15.0, max_dur=60.0, use_llm=False)
    assert short_meta["min_dur_relaxed"] is True


def test_refine_start_preserves_real_words_and_strips_fillers():
    must_keep = [
        "What's the biggest mistake you can make?",
        "Everybody told me I would fail.",
        "Back in 2015 I lost everything.",
        "Everyone says this is impossible.",
    ]
    for sentence in must_keep:
        words = make_words_from_sentences([
            (sentence, 0.2),
            ("We tested every approach across twenty studios to prove it.", 0.2),
            ("The results completely surprised everyone on the team.", 0.2),
        ])
        utts = build_utterances(words)
        cand = HookCandidate(
            id="c1", start=utts[0].start, end=utts[-1].end,
            start_utt_idx=0, end_utt_idx=len(utts) - 1,
            text=" ".join(u.text for u in utts),
            first_3s_text=utts[0].text, hook_sentence=utts[0].text, local_score=7.0,
        )
        _, _, hook_sent = refine_start(cand, utts, min_dur=5.0)
        assert hook_sent == sentence, f"refine_start corrupted {sentence!r} -> {hook_sent!r}"

    # Must still strip leading filler tokens
    filler_words = make_words_from_sentences([
        ("Okay so here's why you lose money.", 0.2),
        ("Most traders ignore risk management on every single trade.", 0.2),
    ])
    utts_f = build_utterances(filler_words)
    cand_f = HookCandidate(
        id="c2", start=utts_f[0].start, end=utts_f[-1].end,
        start_utt_idx=0, end_utt_idx=len(utts_f) - 1,
        text=" ".join(u.text for u in utts_f),
        first_3s_text=utts_f[0].text, hook_sentence=utts_f[0].text, local_score=7.0,
    )
    _, _, refined_f = refine_start(cand_f, utts_f, min_dur=4.0)
    assert refined_f == "here's why you lose money.", f"Expected stripped filler, got {refined_f!r}"

    # Greeting preamble moved to later hook sentence
    preamble_words = make_words_from_sentences([
        ("So um welcome back guys to another episode.", 0.2),
        ("Why does nobody talk about this $250,000 mistake?", 0.2),
        ("Wait until you see what happens at the very end.", 0.2),
        ("Everything changed after that single decision.", 0.2),
    ])
    utts_p = build_utterances(preamble_words)
    cand_p = HookCandidate(
        id="c3", start=utts_p[0].start, end=utts_p[-1].end,
        start_utt_idx=0, end_utt_idx=len(utts_p) - 1,
        text=" ".join(u.text for u in utts_p),
        first_3s_text=utts_p[0].text, hook_sentence=utts_p[0].text, local_score=6.0,
    )
    st_p, _, hook_p = refine_start(cand_p, utts_p, min_dur=5.0)
    assert hook_p.startswith("Why does nobody"), f"Expected hook sentence, got {hook_p!r}"
    assert abs(st_p - max(0.0, utts_p[1].start - 0.15)) <= 0.25


# ─────────────────────── PHASE 2: ROBUSTNESS TESTS ───────────────────────
def test_inputs_numpy_str_text_missing_start_none_end(tmp_path: Path):
    words: List[Dict[str, Any]] = [
        {"text": "missing_start_ignored"},  # no "start" -> skip
        {"text": "Why", "start": 0.0, "end": None},
        {"text": "nobody", "start": 0.3, "end": None},
        {"text": "survives", "start": 0.6, "end": 0.9},
        {"text": "this", "start": 1.0, "end": 1.2},
        {"text": "trap?", "start": 1.3, "end": 1.6},
    ]
    # Add enough sentences for 15s clip
    words += make_words_from_sentences([
        ("Wait until you see the $100,000 result at the end.", 0.2),
        ("Everyone thought it was impossible until we tried it live.", 0.2),
        ("Then the entire machine crashed right in front of us!", 0.2),
        ("Here is what actually saved the entire project.", 0.2),
        ("Nobody expected that outcome on camera.", 0.2),
    ], start_t=2.0)

    cuts_np = np.array([2.5, 8.0, 14.0], dtype=np.float64)
    vis_np = np.array([0.2, 2.2, 8.1], dtype=np.float64)

    selected, meta = select_hook_clips(
        words,
        clip_count=1,
        min_dur=10.0,
        max_dur=30.0,
        video_path=str(tmp_path / "nonexistent.mp4"),
        scene_cuts=cuts_np,
        person_visible_times=vis_np,
        report_dir=str(tmp_path / "rep"),
        use_llm=False,
    )
    assert len(selected) == 1
    assert selected[0].local_features.get("person_in_first_sec") is True
    assert Path(meta["analysis_report_json"]).exists()
    assert Path(meta["hook_debug_md"]).exists()

    # Parameter validation
    with pytest.raises(ValueError):
        select_hook_clips(words, clip_count=-1, use_llm=False)
    with pytest.raises(ValueError):
        select_hook_clips(words, min_dur=30.0, max_dur=15.0, use_llm=False)
    with pytest.raises(ValueError):
        select_hook_clips(words, hook_mode="invalid_mode", use_llm=False)
    with pytest.raises(ValueError):
        generate_candidates(build_utterances(words), stride_s=0.0)


def test_manual_override_validation_and_unified_meta(tmp_path: Path):
    words = generate_synthetic_transcript(duration_s=60.0, seed=5)
    with pytest.raises(ValueError):
        select_hook_clips(words, manual_start=5.0, manual_end=None, use_llm=False)
    with pytest.raises(ValueError):
        select_hook_clips(words, manual_start=None, manual_end=20.0, use_llm=False)
    with pytest.raises(ValueError):
        select_hook_clips(words, manual_start=-1.0, manual_end=20.0, use_llm=False)
    with pytest.raises(ValueError):
        select_hook_clips(words, manual_start=20.0, manual_end=15.0, use_llm=False)

    required_keys = {
        "pipeline_version", "providers_used", "providers_failed",
        "candidates_count", "hook_mode", "fallbacks", "degraded", "audio_probe",
    }

    # Valid manual override
    sel_m, meta_m = select_hook_clips(
        words, manual_start=5.0, manual_end=25.0, report_dir=tmp_path / "man", use_llm=False,
    )
    assert len(sel_m) == 1
    assert required_keys.issubset(meta_m.keys())
    assert meta_m["pipeline_version"] == "m6a_hook_selector_v2"
    assert Path(meta_m["analysis_report_json"]).exists()

    # Empty transcript -> same unified meta + reports still written!
    sel_e, meta_e = select_hook_clips([], report_dir=tmp_path / "empty", use_llm=False)
    assert sel_e == []
    assert required_keys.issubset(meta_e.keys())
    assert Path(meta_e["analysis_report_json"]).exists()
    assert Path(meta_e["hook_debug_md"]).exists()


def test_provider_failures_coverage_degraded_and_lazy_import(caplog: pytest.LogCaptureFixture):
    words = generate_synthetic_transcript(duration_s=240.0, seed=41)

    # 1. One provider raises, one succeeds -> providers_failed records error class, degraded=True (< min_providers=2)
    def _one_fails(prov: str, prompt: str, sp: str, temp: float) -> Any:
        if prov == "groq":
            raise TimeoutError("groq timed out")
        ids = re.findall(r'id:\s*"([^"]+)"', prompt)
        return {"candidates": [
            {"id": cid, "hook_3s": 7.5, "standalone": 7.5, "payoff": 7.5, "intensity": 7.5, "hook_utt": 0, "reason": "ok"}
            for cid in ids
        ]}

    with caplog.at_level(logging.WARNING):
        sel, meta = select_hook_clips(
            words, clip_count=2, use_llm=True, llm_caller=_one_fails, providers=["groq", "gemini"],
        )
    assert len(sel) == 2
    assert meta["providers_used"] == ["gemini"]
    assert meta["providers_failed"].get("groq") == "TimeoutError"
    assert meta["degraded"] is True
    assert any("groq" in r.message and "TimeoutError" in r.message for r in caplog.records)

    # 2. All providers fail -> rules-only fallback, degraded=True, fallbacks recorded
    def _all_fail(prov: str, prompt: str, sp: str, temp: float) -> Any:
        raise ConnectionError(f"{prov} down")

    sel2, meta2 = select_hook_clips(
        words, clip_count=2, use_llm=True, llm_caller=_all_fail, providers=["groq", "gemini"],
    )
    assert len(sel2) == 2
    assert meta2["providers_used"] == []
    assert set(meta2["providers_failed"].keys()) == {"groq", "gemini"}
    assert meta2["degraded"] is True
    assert any("rules" in fb for fb in meta2["fallbacks"])

    # 3. use_llm=False works without importing openclip_engine.clipping.llm_helper
    saved = sys.modules.pop("openclip_engine.clipping.llm_helper", None)
    try:
        sel3, _ = select_hook_clips(words, clip_count=1, use_llm=False)
        assert len(sel3) == 1
        assert "openclip_engine.clipping.llm_helper" not in sys.modules
    finally:
        if saved is not None:
            sys.modules["openclip_engine.clipping.llm_helper"] = saved


def test_strict_mode_excludes_unjudged_and_records_fallback():
    words = generate_synthetic_transcript(duration_s=240.0, seed=43)
    # Judge gives everything 5.0 (< 7.0 strict threshold)
    caller, _ = make_fake_llm(
        lambda prov, c: {
            "id": c["id"], "hook_3s": 5.0, "standalone": 5.0, "payoff": 5.0,
            "intensity": 5.0, "hook_utt": 0, "reason": "below strict",
        }
    )
    sel, meta = select_hook_clips(
        words, clip_count=2, hook_mode="strict", use_llm=True, llm_caller=caller, providers=["groq", "gemini"],
    )
    assert len(sel) == 2
    assert all(c.judged for c in sel)
    assert any("strict" in fb for fb in meta["fallbacks"])


# ─────────────────────── PHASE 3: JUDGE QUALITY TESTS ───────────────────────
def test_judge_prompt_numbered_utterances_and_zscore_normalization():
    words = generate_synthetic_transcript(duration_s=240.0, seed=53)
    # Harsh provider (scores 2..4) prefers candidate A; generous provider (scores 7..9) prefers candidate B slightly less strongly
    caller, calls = make_fake_llm(
        lambda prov, c: {
            "id": c["id"],
            "hook_3s": 4.0 if prov == "groq" else 8.5,
            "standalone": 4.0 if prov == "groq" else 8.5,
            "payoff": 4.0 if prov == "groq" else 8.5,
            "intensity": 4.0 if prov == "groq" else 8.5,
            "hook_utt": 0,
            "reason": f"judged by {prov}",
        }
    )
    sel, _ = select_hook_clips(
        words, clip_count=2, use_llm=True, llm_caller=caller, providers=["groq", "gemini"],
    )
    assert len(calls) >= 2
    # Prompt must have numbered utterances with absolute timestamps "[0] 12.34s: ..."
    assert re.search(r"\[0\]\s+[0-9]+\.[0-9]{2}s:", calls[0]["prompt"]), "Missing numbered utterance timestamps in judge prompt"
    # Raw 0-10 scores preserved (mean of 4.0 and 8.5 = 6.25)
    assert abs(sel[0].hook_3s - 6.25) < 0.05


# ─────────────────────── PHASE 4: HEURISTICS TESTS ───────────────────────
def test_heuristics_curly_quotes_damping_sponsor_hint_and_questions():
    # 14. Curly apostrophe matches curiosity pattern
    sc_curly, f_curly = score_sentence_hook("Here’s why it failed.")
    assert f_curly.get("curiosity_gap") is True
    assert sc_curly >= 6.0

    # 15. Long sentence damping: short punchy >= long bloated
    sc_short, _ = score_sentence_hook("Nobody tells you this.")
    sc_long, _ = score_sentence_hook(
        "I think that in the end you know basically everything is a risk and nobody ever wins every single time."
    )
    assert sc_short >= sc_long, f"Short ({sc_short}) should score >= bloated long ({sc_long})"

    # Million/billion counted once (not both number_stat and conflict_stakes)
    _, f_mil = score_sentence_hook("We spent a million dollars on this test.")
    assert not (f_mil.get("number_stat") and "million" in (f_mil.get("conflict_stakes") or []))

    # Aux question leads only count when followed by a pronoun
    _, f_q_pro = score_sentence_hook("Do you know what happened next")
    _, f_q_imp = score_sentence_hook("Do the dishes before dinner")
    assert f_q_pro.get("question") is True
    assert not f_q_imp.get("question")

    # Dangling refs extended
    for dang in ["And then we walked away.", "But nobody cared.", "Because it rained.", "He went outside."]:
        _, fd = score_sentence_hook(dang)
        assert fd.get("penalty_dangling_ref") is True, f"Missed dangling ref on {dang!r}"

    # 16. Sponsor detection precision & recall
    assert not is_sponsor_text("You can use code to automate this workflow.")
    assert is_sponsor_text("Use code SAVE20 at checkout for 20% off!")
    assert is_sponsor_text("This video is brought to you by NovaCloud.")
    assert is_sponsor_text("Start your free trial today with our discount link.")
    assert is_sponsor_text("Check out our affiliate store below.")

    # 17. hook_hint word boundary + light stemming ("art" must not match "start")
    w_start = make_words_from_sentences([
        ("Let us start the machine right away today.", 0.2),
        ("We ran the test for twenty seconds.", 0.2),
    ])
    u_s = build_utterances(w_start)
    c_start = HookCandidate("cs", 0.0, u_s[-1].end, 0, len(u_s) - 1, " ".join(u.text for u in u_s), u_s[0].text, u_s[0].text, 0.0)
    score_candidate_local(c_start, u_s, hook_hint="art")
    assert c_start.local_features.get("hook_hint_match", 0.0) == 0.0

    w_elim = make_words_from_sentences([
        ("They started eliminating everyone in the arena!", 0.2),
        ("Nobody survived the round.", 0.2),
    ])
    u_e = build_utterances(w_elim)
    c_elim = HookCandidate("ce", 0.0, u_e[-1].end, 0, len(u_e) - 1, " ".join(u.text for u in u_e), u_e[0].text, u_e[0].text, 0.0)
    score_candidate_local(c_elim, u_e, hook_hint="eliminate")
    assert c_elim.local_features.get("hook_hint_match", 0.0) > 0.0


# ─────────────────────── PHASE 5: REPORTS, DETERMINISM & PERF GUARD ───────────────────────
def test_reports_prefix_cap_and_determinism(tmp_path: Path):
    words = generate_synthetic_transcript(duration_s=300.0, seed=71)

    sel1, meta1 = select_hook_clips(
        words, clip_count=3, report_dir=tmp_path, report_prefix="jobA_", report_top_n=10, use_llm=False,
    )
    sel2, meta2 = select_hook_clips(
        words, clip_count=3, report_dir=tmp_path, report_prefix="jobB_", report_top_n=10, use_llm=False,
    )
    assert [asdict(c) for c in sel1] == [asdict(c) for c in sel2]
    assert Path(meta1["analysis_report_json"]).name == "jobA_analysis_report.json"
    assert Path(meta2["hook_debug_md"]).name == "jobB_hook_debug.md"

    import json
    rep = json.loads(Path(meta1["analysis_report_json"]).read_text(encoding="utf-8"))
    assert len(rep["all_candidates"]) <= 10
    assert rep["total_candidates"] >= len(rep["all_candidates"])
    assert "providers_failed" in rep and "fallbacks" in rep


def test_perf_guard_2h_transcript():
    words = generate_synthetic_transcript(duration_s=7200.0, seed=99)
    t0 = time.perf_counter()
    selected, meta = select_hook_clips(words, clip_count=5, min_dur=15.0, max_dur=60.0, use_llm=False)
    elapsed = time.perf_counter() - t0
    assert len(selected) == 5
    assert elapsed < 3.0, f"2h transcript selection too slow: {elapsed:.2f}s (limit <3.0s)"


# ─────────────────────── EXTENDED EDGE-CASE & STRETCH TESTS ───────────────────────
def test_multi_batch_refill_when_batch1_insufficient():
    import threading

    words = generate_synthetic_transcript(duration_s=900.0, seed=101)
    seen_batches: List[set[str]] = []
    lock = threading.Lock()

    def _batch_caller(prov: str, prompt: str, sp: str, temp: float) -> Any:
        cids = re.findall(r'id:\s*"([^"]+)"', prompt)
        ids_set = set(cids)
        with lock:
            if ids_set not in seen_batches:
                seen_batches.append(ids_set)
            batch_num = seen_batches.index(ids_set)
        # Batch 0 gets low scores (<7.0 strict threshold); Batch 1 gets strong scores (9.0)
        sc = 4.0 if batch_num == 0 else 9.0
        return {
            "candidates": [
                {
                    "id": cid, "hook_3s": sc, "standalone": sc, "payoff": sc,
                    "intensity": sc, "hook_utt": 0, "reason": f"batch {batch_num}",
                }
                for cid in cids
            ]
        }

    sel, meta = select_hook_clips(
        words, clip_count=3, hook_mode="strict", max_judge_batches=2,
        use_llm=True, llm_caller=_batch_caller, providers=["groq", "gemini"],
    )
    assert len(seen_batches) == 2, f"Expected 2 judge batches, got {len(seen_batches)}"
    assert len(sel) == 3
    assert all(c.judged and c.hook_3s >= 7.0 for c in sel)
    assert len(meta["fallbacks"]) == len(set(meta["fallbacks"]))


def test_zscore_normalization_prevents_generous_provider_dominating():
    from openclip_engine.scoring.hook_selector import judge_candidates_llm

    cands = [
        HookCandidate("c1", 0.0, 20.0, 0, 2, "A", "A", "A", local_score=5.0),
        HookCandidate("c2", 30.0, 50.0, 3, 5, "B", "B", "B", local_score=5.0),
        HookCandidate("c3", 60.0, 80.0, 6, 8, "C", "C", "C", local_score=5.0),
        HookCandidate("c4", 90.0, 110.0, 9, 11, "D", "D", "D", local_score=5.0),
    ]

    # Harsh provider strongly prefers c1 (4.0 vs 2.0 on others -> huge positive z-score)
    # Generous provider barely prefers c2 (8.6 vs 8.4 on c1 and 8.5 on others -> tiny z-score diff)
    # Without z-score: c1 avg = (4.0+8.4)/2 = 6.20, c2 avg = (2.0+8.6)/2 = 5.30 — let's make generous
    # have a wider raw gap that is still small in its own distribution, or vice versa:
    # Harsh range [2.0, 3.0]: c1=3.0, c2=2.0, c3=2.0, c4=2.0 (c1 z=+1.73, c2 z=-0.58)
    # Generous range [5.0, 9.0]: c1=8.0, c2=9.0, c3=5.0, c4=5.0 (c1 z=+0.73, c2 z=+1.31)
    # Raw mean: c1=(3+8)/2=5.5 == c2=(2+9)/2=5.5 (TIE on raw!).
    # Z-score mean: c1=(+1.73+0.73)/2=+1.23 > c2=(-0.58+1.31)/2=+0.37 -> c1 clearly wins!
    harsh_map = {"c1": 3.0, "c2": 2.0, "c3": 2.0, "c4": 2.0}
    gen_map = {"c1": 8.0, "c2": 9.0, "c3": 5.0, "c4": 5.0}

    def _caller(prov: str, prompt: str, sp: str, temp: float) -> Any:
        m = harsh_map if prov == "harsh" else gen_map
        return {"candidates": [
            {"id": cid, "hook_3s": sc, "standalone": sc, "payoff": sc, "intensity": sc, "hook_utt": 0, "reason": prov}
            for cid, sc in m.items()
        ]}

    provs, _ = judge_candidates_llm(cands, providers=["harsh", "generous"], llm_caller=_caller)
    assert set(provs) == {"harsh", "generous"}
    # Raw scores preserved on 0-10 scale
    assert abs(cands[0].hook_3s - 5.5) < 0.01
    assert abs(cands[1].hook_3s - 5.5) < 0.01
    # Z-score normalization breaks scale bias cleanly in favor of c1
    assert cands[0].norm_rank_score > cands[1].norm_rank_score


def test_custom_hook_weights_and_bool_rejection():
    from openclip_engine.scoring.hook_selector import HookWeights, judge_candidates_llm

    # Bool rejection in validate_judge_item
    assert validate_judge_item(
        {"id": "c1", "hook_3s": True, "standalone": 5, "payoff": 5, "intensity": 5, "hook_utt": 0, "reason": "x"},
        {"c1"},
    ) is None
    assert validate_judge_item(
        {"id": "c1", "hook_3s": 8, "standalone": 5, "payoff": 5, "intensity": 5, "hook_utt": False, "reason": "x"},
        {"c1"},
    ) is None
    assert validate_judge_item(
        {"id": "c1", "hook_3s": 8, "standalone": 5, "payoff": 5, "intensity": 5, "hook_utt": 1, "reason": "ok"},
        {"c1"},
    ) is not None

    # Custom HookWeights shifts final_score deterministically
    c1 = HookCandidate("c1", 0.0, 20.0, 0, 1, "x", "x", "x", local_score=2.0)
    custom_w = HookWeights(hook_3s=0.80, standalone=0.05, payoff=0.05, intensity=0.05, local=0.05)

    def _caller(prov: str, prompt: str, sp: str, temp: float) -> Any:
        return [{"id": "c1", "hook_3s": 10.0, "standalone": 2.0, "payoff": 2.0, "intensity": 2.0, "hook_start_t": 0.0, "reason": "bare array ok"}]

    provs, _ = judge_candidates_llm([c1], providers=["groq"], llm_caller=_caller, weights=custom_w)
    assert provs == ["groq"]
    expected = 0.80 * 10.0 + 0.05 * 2.0 + 0.05 * 2.0 + 0.05 * 2.0 + 0.05 * 2.0
    assert abs(c1.final_score - expected) < 0.01


def test_min_provider_coverage_rejects_incomplete_provider():
    words = generate_synthetic_transcript(duration_s=240.0, seed=107)

    def _low_cov(prov: str, prompt: str, sp: str, temp: float) -> Any:
        cids = re.findall(r'id:\s*"([^"]+)"', prompt)
        if prov == "groq":
            # Return only 1 valid item (< 50% coverage)
            return {"candidates": [
                {"id": cids[0], "hook_3s": 8.0, "standalone": 8.0, "payoff": 8.0, "intensity": 8.0, "hook_utt": 0, "reason": "only one"}
            ]}
        return {"candidates": [
            {"id": cid, "hook_3s": 7.5, "standalone": 7.5, "payoff": 7.5, "intensity": 7.5, "hook_utt": 0, "reason": "all"}
            for cid in cids
        ]}

    sel, meta = select_hook_clips(
        words, clip_count=2, use_llm=True, llm_caller=_low_cov, providers=["groq", "gemini"], min_provider_coverage=0.5,
    )
    assert len(sel) == 2
    assert meta["providers_used"] == ["gemini"]
    assert meta["providers_failed"].get("groq") == "InsufficientCoverage"
    assert meta["degraded"] is True


def test_unselected_candidates_not_mutated_and_refine_details_in_report(tmp_path: Path):
    import json

    words = make_words_from_sentences([
        ("Okay so here's why nobody survives this $100,000 trap.", 0.2),
        ("Wait until you see the crazy ending right now.", 0.2),
        ("Everything changed after that exact second.", 0.2),
        ("We tested twenty people in the studio live.", 0.2),
        ("Only one person walked away with the prize.", 0.2),
        ("Let us move on to the second challenge immediately.", 0.2),
        ("Why did everyone fail the second round so fast?", 0.2),
        ("The secret was hidden right behind the red door.", 0.2),
        ("Nobody looked up until the timer hit zero.", 0.2),
        ("That single mistake cost them everything.", 0.2),
    ])
    sel, meta = select_hook_clips(
        words, clip_count=1, min_dur=10.0, max_dur=25.0, report_dir=tmp_path, use_llm=False,
    )
    assert len(sel) == 1
    assert "moved_from" in sel[0].refine_details
    assert "moved_to" in sel[0].refine_details
    assert "stripped_words" in sel[0].refine_details
    rep = json.loads(Path(meta["analysis_report_json"]).read_text(encoding="utf-8"))
    # Unselected entries in all_candidates were NOT mutated by refine_start
    assert all(c["refined_start"] is None for c in rep["all_candidates"])
    assert rep["selected_clips"][0]["refine_details"] == sel[0].refine_details


def test_streaming_audio_probe_and_100ms_rms_snap(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import io
    import subprocess
    from openclip_engine.scoring.hook_selector import _probe_audio_rms_profile

    # Skipped when missing
    r1, r100, st = _probe_audio_rms_profile(tmp_path / "missing.mp4")
    assert r1 is None and r100 is None and st == "skipped"

    dummy_vid = tmp_path / "vid.mp4"
    dummy_vid.write_bytes(b"fake")

    # Successful streaming 2 seconds of f32le audio (8000 Hz)
    pcm = np.concatenate([
        np.full(8000, 0.2, dtype=np.float32),
        np.full(8000, 0.5, dtype=np.float32),
    ]).tobytes()

    class _FakePopenOK:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self.stdout = io.BytesIO(pcm)
            self.stderr = io.BytesIO(b"")
        def wait(self, timeout: Any = None) -> int:
            return 0
        def poll(self) -> int:
            return 0
        def kill(self) -> None:
            pass

    monkeypatch.setattr(subprocess, "Popen", _FakePopenOK)
    sec_rms, hop_rms, status = _probe_audio_rms_profile(dummy_vid, timeout_s=10.0)
    assert status == "ok"
    assert sec_rms is not None and len(sec_rms) == 2
    assert hop_rms is not None and len(hop_rms) == 20
    assert abs(float(sec_rms[0]) - 0.2) < 0.01 and abs(float(sec_rms[1]) - 0.5) < 0.01

    # Error exit code
    class _FakePopenErr(_FakePopenOK):
        def wait(self, timeout: Any = None) -> int:
            return 1

    monkeypatch.setattr(subprocess, "Popen", _FakePopenErr)
    _, _, status_err = _probe_audio_rms_profile(dummy_vid, timeout_s=10.0)
    assert status_err == "error"

    # 100 ms RMS snap in refine_start snaps to quiet bin within +-0.25 s without crossing prev_word_end
    words = make_words_from_sentences([
        ("Welcome back guys to the show.", 0.3),
        ("Why does nobody survive this $100,000 trap?", 0.2),
        ("Wait until you see what happens next.", 0.2),
        ("Everything blew up in three seconds.", 0.2),
    ])
    utts = build_utterances(words)
    cand = HookCandidate(
        "c_rms", utts[0].start, utts[-1].end, 0, len(utts) - 1,
        " ".join(u.text for u in utts), utts[0].text, utts[0].text, 5.0,
    )
    target_word_t = utts[1].start
    prev_end = utts[0].end
    rms100 = np.full(200, 0.4, dtype=np.float32)
    quiet_idx = int(round((target_word_t - 0.1) * 10))
    rms100[quiet_idx] = 0.001
    st_ref, _, _ = refine_start(cand, utts, min_dur=3.0, rms_per_100ms=rms100)
    assert st_ref >= prev_end - 1e-6
    assert abs(st_ref - quiet_idx * 0.1) < 0.05


# ─────────────────────── FOLLOW-UP REGRESSION TESTS (ITEMS 1, 2, 4) ───────────────────────
def test_refine_start_snap_never_after_hook_word_200_seeds():
    """Item 2: snap window must be [max(prev_word_end, word_start - 0.25), word_start - 0.03], never > word_start."""
    for seed in range(200):
        rng = random.Random(seed + 1000)
        # Random word timing + pause between utterance 0 and hook utterance 1
        pause = rng.uniform(0.05, 0.50)
        words = make_words_from_sentences([
            ("Welcome back guys to another episode.", pause),
            ("Why does nobody survive this $250,000 trap?", 0.2),
            ("Wait until you see what happens at the end.", 0.2),
            ("Everything changed after that exact second.", 0.2),
        ])
        utts = build_utterances(words)
        assert len(utts) >= 2
        hook_word_start = utts[1].words[0]["start"]
        prev_word_end = utts[0].words[-1]["end"]

        # Deliberately put the lowest-energy bin AFTER hook_word_start (e.g. +0.1s / +0.2s)
        # to catch any bug where snap searches past hook_word_start.
        rms100 = np.asarray([rng.uniform(0.15, 0.6) for _ in range(300)], dtype=np.float32)
        after_idx = min(299, int(round((hook_word_start + rng.choice([0.1, 0.2])) * 10)))
        rms100[after_idx] = 0.0001

        cand = HookCandidate(
            id=f"c_seed_{seed}",
            start=utts[0].start,
            end=utts[-1].end,
            start_utt_idx=0,
            end_utt_idx=len(utts) - 1,
            text=" ".join(u.text for u in utts),
            first_3s_text=utts[0].text,
            hook_sentence=utts[0].text,
            local_score=5.0,
        )
        st_ref, _, hook_sent = refine_start(cand, utts, min_dur=3.0, rms_per_100ms=rms100)
        assert hook_sent.startswith("Why does nobody"), f"seed={seed}: unexpected hook {hook_sent!r}"
        assert st_ref <= hook_word_start + 1e-6, (
            f"seed={seed}: refined_start ({st_ref:.3f}) > hook_word_start ({hook_word_start:.3f})"
        )
        assert st_ref >= prev_word_end - 1e-6, (
            f"seed={seed}: refined_start ({st_ref:.3f}) < prev_word_end ({prev_word_end:.3f})"
        )


def test_unpunctuated_fast_speech_fallback():
    """Item 4: strip all punctuation and keep gaps 0.1-0.4s -> still finds valid clips and records degraded boundary fallback."""
    raw_words = generate_synthetic_transcript(duration_s=300.0, seed=55, mid_sentence_pause_prob=0.0)
    rng = random.Random(55)
    t = 0.0
    unpunct: List[Dict[str, Any]] = []
    for w in raw_words:
        tok = re.sub(r"[^a-zA-Z0-9']+", "", w["word"])
        if not tok:
            continue
        dur = rng.uniform(0.18, 0.28)
        gap = rng.uniform(0.10, 0.35)  # strictly 0.1-0.4 s (no >0.4s pause, no >=0.8s hard gap)
        unpunct.append({"word": tok, "start": round(t, 3), "end": round(t + dur, 3)})
        t += dur + gap

    selected, meta = select_hook_clips(
        unpunct, clip_count=3, min_dur=15.0, max_dur=45.0, use_llm=False,
    )
    assert meta["candidates_count"] > 10, f"Expected candidates across unpunctuated speech, got {meta['candidates_count']}"
    assert len(selected) == 3, f"Expected 3 clips on unpunctuated 300s speech, got {len(selected)}"
    for c in selected:
        st = c.refined_start if c.refined_start is not None else c.start
        en = c.refined_end if c.refined_end is not None else c.end
        assert 15.0 <= (en - st) <= 45.0, f"Clip {c.id} out of [15, 45]s bounds: {en - st:.2f}s"
    assert any("degraded_boundaries" in fb for fb in meta["fallbacks"]), (
        f"Expected degraded boundary fallback in meta['fallbacks'], got {meta['fallbacks']}"
    )


def test_cli_select_hooks_clean_error_on_value_error(tmp_path: Path):
    """Item 1: CLI catches ValueError (e.g. --start without --end) and exits cleanly with no traceback."""
    import json
    from typer.testing import CliRunner
    from openclip_engine.cli.main import app

    words_path = tmp_path / "words.json"
    words_path.write_text(json.dumps(generate_synthetic_transcript(duration_s=60.0, seed=3)), encoding="utf-8")

    runner = CliRunner()
    res = runner.invoke(app, ["select-hooks", str(words_path), "--start", "10", "--no-llm"])
    assert res.exit_code != 0
    assert "Traceback" not in res.output
    assert "manual_start" in res.output or "start" in res.output.lower()
