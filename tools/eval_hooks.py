#!/usr/bin/env python3
"""
M6a Hook Selection Evaluator (`tools/eval_hooks.py`):
  - If `tests/hook_gold.json` exists ([{video, gold_start, words?}]), runs `select_hook_clips`
    and reports the hit rate (selected start within +/-3 s of gold_start) plus prints misses.
  - If `tests/hook_gold.json` does NOT exist, generates `tests/hook_gold.template.json`
    listing the top 5 candidates (start time + first sentence) per processed video (from any
    `analysis_report.json` found in outputs or a provided report dir) so the user can mark
    the true hook.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend" / "python-engine"))

from openclip_engine.scoring.hook_selector import select_hook_clips

GOLD_PATH = REPO_ROOT / "tests" / "hook_gold.json"
TEMPLATE_PATH = REPO_ROOT / "tests" / "hook_gold.template.json"


def generate_template(search_dirs: List[Path]) -> Path:
    TEMPLATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    entries: List[Dict[str, Any]] = []

    for d in search_dirs:
        if not d.exists():
            continue
        for rp in sorted(d.rglob("analysis_report.json")):
            try:
                data = json.loads(rp.read_text(encoding="utf-8"))
                cands = data.get("all_candidates") or []
                cands_sorted = sorted(cands, key=lambda c: float(c.get("final_score", 0.0)), reverse=True)[:5]
                entries.append({
                    "video": data.get("video") or str(rp.parent.name),
                    "gold_start": None,
                    "top_5_candidates": [
                        {
                            "start": c.get("refined_start") if c.get("refined_start") is not None else c.get("start"),
                            "end": c.get("refined_end") if c.get("refined_end") is not None else c.get("end"),
                            "score": c.get("final_score"),
                            "first_sentence": c.get("hook_sentence") or c.get("first_3s_text"),
                        }
                        for c in cands_sorted
                    ],
                })
            except Exception:
                continue

    if not entries:
        entries.append({
            "video": "example_video.mp4",
            "gold_start": 12.0,
            "words_json": "path/to/words.json",
            "top_5_candidates": [
                {"start": 12.0, "end": 32.0, "score": 8.5, "first_sentence": "Replace with your processed video's top 5 candidates"}
            ],
        })

    TEMPLATE_PATH.write_text(json.dumps(entries, indent=2), encoding="utf-8")
    return TEMPLATE_PATH


def evaluate_gold(gold_path: Path, tol_s: float = 3.0, use_llm: bool = False) -> int:
    rows = json.loads(gold_path.read_text(encoding="utf-8"))
    if not isinstance(rows, list) or not rows:
        print(f"No gold entries in {gold_path}")
        return 1

    hits = 0
    total = 0
    misses: List[Dict[str, Any]] = []

    for row in rows:
        gold_start = row.get("gold_start")
        if gold_start is None:
            continue
        total += 1
        words = row.get("words")
        if not words and row.get("words_json") and Path(row["words_json"]).exists():
            words = json.loads(Path(row["words_json"]).read_text(encoding="utf-8"))
        if not words:
            misses.append({"video": row.get("video"), "reason": "no words transcript provided"})
            continue

        selected, _ = select_hook_clips(words, clip_count=1, use_llm=use_llm, video_label=str(row.get("video", "video")))
        if not selected:
            misses.append({"video": row.get("video"), "gold_start": gold_start, "selected_start": None})
            continue
        sel_start = selected[0].refined_start if selected[0].refined_start is not None else selected[0].start
        err = abs(sel_start - float(gold_start))
        if err <= tol_s:
            hits += 1
        else:
            misses.append({
                "video": row.get("video"),
                "gold_start": gold_start,
                "selected_start": sel_start,
                "error_s": round(err, 2),
                "hook_sentence": selected[0].hook_sentence,
            })

    hit_rate = (hits / total * 100.0) if total else 0.0
    print(f"Hook Gold Eval: {hits}/{total} hits ({hit_rate:.1f}% within +/-{tol_s:.1f}s)")
    if misses:
        print("Misses:")
        for m in misses:
            print(" ", json.dumps(m))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate M6a hook selection against tests/hook_gold.json.")
    parser.add_argument("--gold", default=str(GOLD_PATH))
    parser.add_argument("--tol", type=float, default=3.0)
    parser.add_argument("--use-llm", action="store_true")
    args = parser.parse_args()

    gp = Path(args.gold)
    if gp.exists():
        return evaluate_gold(gp, tol_s=args.tol, use_llm=args.use_llm)

    tpl = generate_template([REPO_ROOT / "backend" / "storage" / "outputs", REPO_ROOT / "tools" / "verify_output"])
    print(f"tests/hook_gold.json not found -> generated template at {tpl}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
