#!/usr/bin/env python3
"""
Honest side-by-side evaluation for `openclip_engine.scoring.hook_selector` (v1 HEAD vs v2).
Measures clean boundaries strictly against the synthetic generator's ground-truth sentence
edges (never the module's own flags), runs v1 and v2 on the identical 30-min synthetic set,
prints both columns + judge token cost, and supports optional external transcript JSONs.

Usage:
  python tools/eval_hook_selector.py [transcript1.json ...]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set

ROOT = Path(__file__).resolve().parents[1]
ENGINE_DIR = ROOT / "backend" / "python-engine"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from openclip_engine.scoring import hook_selector as hs_v2
from tests.test_hook_selector import generate_synthetic_transcript_with_truth


def _load_v1_from_git() -> Optional[Any]:
    """Loads HEAD's hook_selector.py into an isolated module for apples-to-apples v1 vs v2 eval."""
    try:
        proc = subprocess.run(
            ["git", "show", "HEAD:backend/python-engine/openclip_engine/scoring/hook_selector.py"],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=10,
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            return None
        tmp_path = Path(tempfile.gettempdir()) / "openclip_hook_selector_v1_eval.py"
        tmp_path.write_text(proc.stdout, encoding="utf-8")
        spec = importlib.util.spec_from_file_location("hook_selector_v1_eval", str(tmp_path))
        if spec is None or spec.loader is None:
            return None
        mod = importlib.util.module_from_spec(spec)
        sys.modules["hook_selector_v1_eval"] = mod
        spec.loader.exec_module(mod)
        return mod
    except Exception:
        return None


def _bucket_hist(durations: Sequence[float]) -> Dict[str, int]:
    buckets = {"<15s": 0, "15-21s": 0, "21-35s": 0, "35-50s": 0, "50-60s": 0, ">60s": 0}
    for d in durations:
        if d < 15.0:
            buckets["<15s"] += 1
        elif d < 21.0:
            buckets["15-21s"] += 1
        elif d < 35.0:
            buckets["21-35s"] += 1
        elif d < 50.0:
            buckets["35-50s"] += 1
        elif d <= 60.0 + 1e-6:
            buckets["50-60s"] += 1
        else:
            buckets[">60s"] += 1
    return buckets


def _parse_prompt_candidates(prompt: str) -> List[Dict[str, Any]]:
    """Parses candidate id/start/end from both v1 and v2 judge prompts."""
    out: List[Dict[str, Any]] = []
    # v2 format: - id: "cand_0001" | window: 12.00s-32.00s
    for m in re.finditer(r'id:\s*"([^"]+)"\s*\|\s*(?:window:\s*)?([0-9.]+)s-([0-9.]+)s', prompt):
        st, en = float(m.group(2)), float(m.group(3))
        out.append({"id": m.group(1), "start": st, "end": en, "duration": en - st})
    if out:
        return out
    # v1 JSON block fallback: "id": "cand_001", "start": 12.0, "end": 32.0
    for m in re.finditer(r'"id"\s*:\s*"([^"]+)"[^}]*?"start"\s*:\s*([0-9.]+)[^}]*?"end"\s*:\s*([0-9.]+)', prompt, re.S):
        st, en = float(m.group(2)), float(m.group(3))
        out.append({"id": m.group(1), "start": st, "end": en, "duration": en - st})
    return out


def _evaluate_module(
    mod: Any,
    label: str,
    words: Sequence[Dict[str, Any]],
    gt_starts: Optional[Set[float]],
    gt_ends: Optional[Set[float]],
    clip_count: int = 3,
    min_dur: float = 15.0,
    max_dur: float = 60.0,
    constant_judge_score: float = 2.0,
    extra_kwargs: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    utts = mod.build_utterances(words)
    cands = mod.generate_candidates(utts, min_dur=min_dur, max_dur=max_dur)

    # Honest ground-truth boundary check (never trust the module's own flags when gt is provided)
    if gt_starts is not None and gt_ends is not None:
        clean_cands = sum(
            1 for c in cands
            if round(float(c.start), 3) in gt_starts and round(float(c.end), 3) in gt_ends
        )
    else:
        clean_cands = sum(
            1 for c in cands
            if bool(getattr(c, "is_sentence_boundary", False))
        )
    pct_clean = (100.0 * clean_cands / len(cands)) if cands else 0.0

    judged_durations: List[float] = []
    judged_ids: Set[str] = set()
    prompt_chars_list: List[int] = []
    items_per_call: List[int] = []
    providers = ["groq", "gemini"]

    def _fake_judge(prov: str, prompt: str, sp: str, temp: float) -> Any:
        parsed = _parse_prompt_candidates(prompt)
        if prov == providers[0]:
            prompt_chars_list.append(len(sp) + len(prompt))
            items_per_call.append(len(parsed))
            for cinfo in parsed:
                judged_durations.append(float(cinfo["duration"]))
                judged_ids.add(str(cinfo["id"]))
        items = [
            {
                "id": cinfo["id"],
                "hook_3s": constant_judge_score,
                "standalone": constant_judge_score,
                "payoff": constant_judge_score,
                "intensity": constant_judge_score,
                "hook_utt": 0,
                "hook_start_t": cinfo["start"],
                "reason": f"eval score {constant_judge_score:.1f}",
            }
            for cinfo in parsed
        ]
        # v1 expects a JSON list; v2 accepts both {"candidates": [...]} and bare list
        if getattr(mod, "PIPELINE_VERSION", "") == "m6a_hook_selector_v1":
            return items
        return {"candidates": items}

    kwargs: Dict[str, Any] = {
        "words": words,
        "clip_count": clip_count,
        "min_dur": min_dur,
        "max_dur": max_dur,
        "use_llm": True,
        "llm_caller": _fake_judge,
        "providers": providers,
    }
    if extra_kwargs:
        kwargs.update(extra_kwargs)

    t0 = time.perf_counter()
    selected, meta = mod.select_hook_clips(**kwargs)
    elapsed = time.perf_counter() - t0

    sel_durs = [
        (c.refined_end if c.refined_end is not None else c.end)
        - (c.refined_start if c.refined_start is not None else c.start)
        for c in selected
    ]
    # Check whether each selected clip was actually scored by the judge (works identically for v1 and v2)
    n_sel_judged = sum(1 for c in selected if bool(getattr(c, "provider_scores", None)))
    pct_judged = (100.0 * n_sel_judged / len(selected)) if selected else 0.0
    within = sum(1 for d in sel_durs if min_dur - 1e-3 <= d <= max_dur + 1e-3)
    pct_within = (100.0 * within / len(selected)) if selected else 0.0
    prov_rate = 100.0 * len(meta.get("providers_used") or []) / max(1, len(providers))
    first_prompt_chars = prompt_chars_list[0] if prompt_chars_list else 0
    first_items = items_per_call[0] if items_per_call else 0

    return {
        "label": label,
        "version": str(getattr(mod, "PIPELINE_VERSION", "unknown")),
        "candidates": len(cands),
        "selected": len(selected),
        "pct_selected_judged": round(pct_judged, 1),
        "pct_clean_boundaries_gt": round(pct_clean, 1),
        "pct_within_limits": round(pct_within, 1),
        "min_selected_dur_s": round(min(sel_durs), 2) if sel_durs else 0.0,
        "max_selected_dur_s": round(max(sel_durs), 2) if sel_durs else 0.0,
        "judged_duration_hist": _bucket_hist(judged_durations),
        "selected_duration_hist": _bucket_hist(sel_durs),
        "provider_success_rate_pct": round(prov_rate, 1),
        "prompt_chars": first_prompt_chars,
        "approx_input_tokens": int(round(first_prompt_chars / 4.0)),
        "items_per_call": first_items,
        "approx_output_tokens": first_items * 55,
        "runtime_s": round(elapsed, 3),
    }


def _load_transcript_json(path: Path) -> List[Dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        for key in ("words", "transcript", "segments"):
            if isinstance(raw.get(key), list):
                return raw[key]
    raise ValueError(f"Unrecognized transcript JSON structure in {path}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Honest v1 vs v2 hook_selector evaluation.")
    ap.add_argument("transcripts", nargs="*", help="Optional paths to word-level transcript JSON files")
    ap.add_argument("--clip-count", type=int, default=3)
    ap.add_argument("--min-dur", type=float, default=15.0)
    ap.add_argument("--max-dur", type=float, default=60.0)
    args = ap.parse_args()

    v1_mod = _load_v1_from_git()
    words_30m, gt_starts, gt_ends = generate_synthetic_transcript_with_truth(
        duration_s=1800.0, seed=42, mid_sentence_pause_prob=0.25,
    )

    r_v2 = _evaluate_module(
        hs_v2, "synthetic_30min_judge2", words_30m, gt_starts, gt_ends,
        args.clip_count, args.min_dur, args.max_dur, 2.0,
    )
    r_v2_12 = _evaluate_module(
        hs_v2, "synthetic_30min_max_starts12", words_30m, gt_starts, gt_ends,
        args.clip_count, args.min_dur, args.max_dur, 2.0, extra_kwargs={"max_starts": 12},
    )
    r_v1 = (
        _evaluate_module(
            v1_mod, "synthetic_30min_judge2", words_30m, gt_starts, gt_ends,
            args.clip_count, args.min_dur, args.max_dur, 2.0,
        )
        if v1_mod is not None
        else None
    )

    print("=== Honest Synthetic 30-Min Eval (Ground-Truth Sentence Edges, Constant 2/10 Judge) ===")
    print(f"{'Metric':<30} | {'v1 (HEAD)':<26} | {'v2 (max_starts=8)':<26}")
    print("-" * 88)
    rows = [
        ("Selected clips judged", f"{r_v1['pct_selected_judged']:.1f}%" if r_v1 else "n/a", f"{r_v2['pct_selected_judged']:.1f}%"),
        ("Clean boundaries (GT)", f"{r_v1['pct_clean_boundaries_gt']:.1f}% ({r_v1['candidates']} cands)" if r_v1 else "n/a", f"{r_v2['pct_clean_boundaries_gt']:.1f}% ({r_v2['candidates']} cands)"),
        ("Clips within [15,60]s", f"{r_v1['pct_within_limits']:.1f}% ({r_v1['min_selected_dur_s']}-{r_v1['max_selected_dur_s']}s)" if r_v1 else "n/a", f"{r_v2['pct_within_limits']:.1f}% ({r_v2['min_selected_dur_s']}-{r_v2['max_selected_dur_s']}s)"),
        ("Provider success rate", f"{r_v1['provider_success_rate_pct']:.1f}%" if r_v1 else "n/a", f"{r_v2['provider_success_rate_pct']:.1f}%"),
        ("Prompt chars / call", f"{r_v1['prompt_chars']} ({r_v1['items_per_call']} items)" if r_v1 else "n/a", f"{r_v2['prompt_chars']} ({r_v2['items_per_call']} items)"),
        ("Approx input tokens (~c/4)", f"{r_v1['approx_input_tokens']}" if r_v1 else "n/a", f"{r_v2['approx_input_tokens']}"),
        ("Approx output tokens", f"{r_v1['approx_output_tokens']}" if r_v1 else "n/a", f"{r_v2['approx_output_tokens']}"),
        ("Runtime", f"{r_v1['runtime_s']:.3f}s" if r_v1 else "n/a", f"{r_v2['runtime_s']:.3f}s"),
    ]
    for k, c1, c2 in rows:
        print(f"{k:<30} | {c1:<26} | {c2:<26}")
    print("\nDuration histograms (judged windows):")
    if r_v1:
        print(f"  v1: {r_v1['judged_duration_hist']}")
    print(f"  v2 (max_starts=8) : {r_v2['judged_duration_hist']}")
    print(f"  v2 (max_starts=12): {r_v2_12['judged_duration_hist']}")
    print(
        f"\nJudge cost comparison (v2): max_starts=12 ({r_v2_12['items_per_call']} items) -> "
        f"{r_v2_12['prompt_chars']} chars (~{r_v2_12['approx_input_tokens']} in tok, ~{r_v2_12['approx_output_tokens']} out tok) | "
        f"max_starts=8 ({r_v2['items_per_call']} items) -> "
        f"{r_v2['prompt_chars']} chars (~{r_v2['approx_input_tokens']} in tok, ~{r_v2['approx_output_tokens']} out tok)"
    )

    for tpath_str in args.transcripts:
        tp = Path(tpath_str)
        ext_words = _load_transcript_json(tp)
        rext = _evaluate_module(
            hs_v2, tp.name, ext_words, None, None, args.clip_count, args.min_dur, args.max_dur, 7.5,
        )
        print(f"\n[{tp.name}] v2: judged={rext['pct_selected_judged']}% within={rext['pct_within_limits']}% runtime={rext['runtime_s']}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
