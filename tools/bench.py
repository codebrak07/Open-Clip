#!/usr/bin/env python3
"""
M5 Performance Benchmark (`tools/bench.py`):
  Reproduces the 3-clip parallel 20s 1080x1920 render benchmark with COLD sprite cache
  (full M1 layout+blur+grade + M2 2-layer glow captions + M3 Impact title + M4 SFX mix).
  Targets:
    - 3 clips in parallel (cold): <= 30.0 s wall (stretch <= 20.0 s), >= 3.5x faster than 106.2 s
    - single clip end-to-end: >= 100 fps (>= 3.3x real-time)
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
import time
from dataclasses import replace
from pathlib import Path
from typing import Any, Dict, List

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend" / "python-engine"))

from openclip_engine.clipping.clip_renderer import (
    check_videotoolbox_available,
    render_clips_batch,
    render_polished_clip,
)
from openclip_engine.clipping.config_styles import (
    DEFAULT_LAYOUT,
    DEFAULT_SFX_CONFIG,
    DEFAULT_TITLE_STYLE,
    KARAOKE_POP,
)
from openclip_engine.clipping.sfx_director import ensure_sfx_index

BASELINE_3_CLIP_S = 106.22


def _build_bench_words(clip_idx: int, duration: float = 20.0) -> List[Dict[str, Any]]:
    # Unique phrases per clip so cold cache renders genuinely distinct words across clips
    vocab = [
        "Every GTA game has its own iconic song Which one is your favorite? "
        "Wait until you hear this legendary soundtrack drop right now! "
        "Nobody expected this unbelievable moment to happen live on stream.",
        "This insane strategy changed esports history forever across every tournament! "
        "Watch closely how the championship player reads that impossible rotation. "
        "Absolute cinema when the final countdown hits zero right here!",
        "Here is the ultimate secret behind viral short form storytelling today. "
        "Every single frame grabs attention before anyone can scroll away! "
        "NASA engineers would literally study how smooth this transition feels.",
    ]
    tokens = vocab[clip_idx % len(vocab)].split()
    words: List[Dict[str, Any]] = []
    t = 0.05
    step = (duration - 0.5) / max(1, len(tokens))
    for w in tokens:
        words.append({"word": w, "start": round(t, 3), "end": round(t + step * 0.85, 3)})
        t += step
    return words


def _create_source_video(path: Path, duration: float = 20.0) -> Path:
    if path.exists() and path.stat().st_size > 10000:
        return path
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", f"testsrc2=size=1920x1080:rate=30:duration={duration:.1f}",
            "-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=44100:duration={duration:.1f}",
            "-af", "volume=-12dB",
            "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-shortest",
            str(path),
        ],
        check=True,
    )
    return path


def run_benchmark(quality: str = "balanced", jobs: str = "auto", duration: float = 20.0) -> int:
    vt_ok = check_videotoolbox_available()
    print(f"Environment: cores={os.cpu_count()}, h264_videotoolbox={'AVAILABLE' if vt_ok else 'UNAVAILABLE (libx264 fallback)'}, quality={quality}, jobs={jobs}")

    # Ensure SFX library is indexed before timing cold render (one-time startup task)
    ensure_sfx_index(DEFAULT_SFX_CONFIG)

    with tempfile.TemporaryDirectory(prefix="oc_bench_m5_") as td:
        tmp = Path(td)
        src = _create_source_video(tmp / "src_20s_1080p.mp4", duration=duration)
        layout = replace(DEFAULT_LAYOUT, quality=quality)
        sfx_cfg = replace(DEFAULT_SFX_CONFIG, mode="rules", seed=42)

        # ── 1) Single-clip cold benchmark ──
        cold_cache_single = tmp / "cold_cache_single"
        cap_cold = replace(KARAOKE_POP, sprite_cache_dir=str(cold_cache_single))
        ttl_cold = replace(DEFAULT_TITLE_STYLE, sprite_cache_dir=str(cold_cache_single))

        t0 = time.perf_counter()
        _, meta_single_cold = render_polished_clip(
            src, _build_bench_words(0, duration), tmp / "single_cold.mp4",
            clip_start=0.0, clip_end=duration,
            title="EVERY GTA GAME HAS ITS ICONIC SONG", keyword="ICONIC",
            layout=layout, caption_style=cap_cold, title_style=ttl_cold, sfx_config=sfx_cfg,
            use_llm=False, use_disk_cache=True, detect_scenes=True, return_meta=True,
        )
        single_cold_s = time.perf_counter() - t0
        single_cold_fps = (duration * 30.0) / max(0.01, single_cold_s)

        # ── 2) Single-clip warm benchmark (same sprite cache) ──
        t1 = time.perf_counter()
        _, meta_single_warm = render_polished_clip(
            src, _build_bench_words(0, duration), tmp / "single_warm.mp4",
            clip_start=0.0, clip_end=duration,
            title="EVERY GTA GAME HAS ITS ICONIC SONG", keyword="ICONIC",
            layout=layout, caption_style=cap_cold, title_style=ttl_cold, sfx_config=sfx_cfg,
            use_llm=False, use_disk_cache=True, detect_scenes=True, return_meta=True,
        )
        single_warm_s = time.perf_counter() - t1
        single_warm_fps = (duration * 30.0) / max(0.01, single_warm_s)

        # ── 3) 3-clip parallel benchmark (COLD sprite cache) ──
        cold_cache_3 = tmp / "cold_cache_3clips"
        cap_cold_3 = replace(KARAOKE_POP, sprite_cache_dir=str(cold_cache_3))
        ttl_cold_3 = replace(DEFAULT_TITLE_STYLE, sprite_cache_dir=str(cold_cache_3))

        specs = [
            {
                "video_in": src,
                "words": _build_bench_words(i, duration),
                "out_path": tmp / f"clip_{i + 1}.mp4",
                "clip_start": 0.0,
                "clip_end": duration,
                "title": [
                    "EVERY GTA GAME HAS ITS ICONIC SONG",
                    "THIS INSANE STRATEGY CHANGED ESPORTS FOREVER",
                    "THE ULTIMATE SECRET BEHIND VIRAL STORYTELLING",
                ][i],
                "seek_source": True,
            }
            for i in range(3)
        ]

        t2 = time.perf_counter()
        batch_metas = render_clips_batch(
            specs,
            layout=layout,
            caption_style=cap_cold_3,
            title_style=ttl_cold_3,
            sfx_config=sfx_cfg,
            jobs=jobs,
            use_llm=False,
            use_disk_cache=True,
            detect_scenes=True,
        )
        wall_3_s = time.perf_counter() - t2
        speedup = BASELINE_3_CLIP_S / max(0.01, wall_3_s)

        # Print per-stage report
        print("\n================ M5 PERFORMANCE BENCHMARK REPORT ================")
        print(f"Encoder: {meta_single_cold['encoder']}")
        st = meta_single_cold["timings"]
        print("\nSingle Clip (20s @ 30fps = 600 frames) Per-Stage Breakdown (COLD):")
        print(f"  probe           : {st.get('probe_s', 0.0):.3f}s")
        print(f"  grade signalstat: {st.get('grade_probe_s', 0.0):.3f}s")
        print(f"  caption sprites : {st.get('caption_sprites_s', 0.0):.3f}s ({meta_single_cold['caption_stats']})")
        print(f"  title sprites   : {st.get('title_sprites_s', 0.0):.3f}s")
        print(f"  sfx scene+plan  : {st.get('sfx_plan_s', 0.0):.3f}s (cues={meta_single_cold['sfx_cues_count']})")
        print(f"  ffmpeg encode   : {st.get('ffmpeg_encode_s', 0.0):.3f}s")
        print(f"  TOTAL (COLD)    : {single_cold_s:.3f}s -> {single_cold_fps:.1f} fps ({single_cold_fps/30.0:.2f}x real-time)")
        print(f"  TOTAL (WARM)    : {single_warm_s:.3f}s -> {single_warm_fps:.1f} fps ({single_warm_fps/30.0:.2f}x real-time)")

        print("\n3-Clip Parallel Benchmark (COLD sprite cache, 3 x 20s = 1800 frames):")
        for idx, m in enumerate(batch_metas):
            print(f"  clip {idx+1}: total={m['total_s']:.2f}s (prep={m['python_prep_s']:.2f}s, enc={m['encode_s']:.2f}s, {m['effective_fps']:.1f} fps)")
        print(f"  3-CLIP WALL TIME: {wall_3_s:.2f}s ({1800.0/wall_3_s:.1f} aggregate fps)")

        print("\nBefore / After Summary:")
        print(f"  | Metric                        | Before   | After     | Target          | Status |")
        print(f"  |-------------------------------|----------|-----------|-----------------|--------|")
        p_3 = wall_3_s <= 30.0
        p_stretch = wall_3_s <= 20.0
        p_1 = single_cold_fps >= 100.0
        print(f"  | 3 clips parallel (cold wall)  | {BASELINE_3_CLIP_S:6.2f} s | {wall_3_s:7.2f} s | <= 30s (<=20s*) | {'PASS*' if p_stretch else ('PASS' if p_3 else 'FAIL'):6s} |")
        print(f"  | Speedup vs 106.2 s baseline   |   1.00 x | {speedup:7.2f} x | >= 3.50 x       | {'PASS' if speedup >= 3.5 else 'FAIL':6s} |")
        print(f"  | Single clip end-to-end (cold) |   16.9 f | {single_cold_fps:5.1f} fps | >= 100.0 fps    | {'PASS' if p_1 else 'FAIL':6s} |")
        print("=================================================================\n")
        return 0 if (p_3 and p_1) else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark M1-M5 polished vertical clip renderer.")
    parser.add_argument("--quality", default="balanced", choices=["fast", "balanced", "max"])
    parser.add_argument("--jobs", default="auto")
    parser.add_argument("--duration", type=float, default=20.0)
    args = parser.parse_args()
    sys.exit(run_benchmark(quality=args.quality, jobs=args.jobs, duration=args.duration))


if __name__ == "__main__":
    main()
