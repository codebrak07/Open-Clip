# OpenClip M5 Performance Report

Hardware: Apple Silicon macOS (10 logical cores: 4 performance + 6 efficiency), FFmpeg 8.1.2 (`h264_videotoolbox`), Python 3.13 (`Pillow 13.0.0`, `numpy 2.5.5`).
Test clip: 20 s @ 30 fps (600 frames), 1920×1080 source → 1080×1920 polished vertical clip (blurred 9:16 canvas + graded 4:5 window + Karaoke Pop 2-layer glow captions + Impact title + 6-cue SFX mix).

---

## Step 0 — Baseline Measurements (Before M5 Refactor)

Measured prior to implementing M5 on the same 20 s 1080p clip:

| Stage | Time (20s / 600 frames) | Throughput | Notes |
|---|---:|---:|---|
| a) Decode only (CPU) | `0.345 s` | `1740.9 fps` | `-ss 0 -t 20 -i src -f null -` |
| b1) Decode + M1 graph (1/4-res blur, `sigma=10`) → null | `3.155 s` | `190.2 fps` | `270×480` blur |
| b2) Decode + M1 graph (1/8-res blur, `sigma=5`) → null | `2.767 s` | `216.8 fps` | `135×240` blur + `-filter_threads 10` |
| c) Full M1 render (`libx264 -preset veryfast -crf 20`) | `3.300 s` | `181.8 fps` | CPU fallback baseline |
| d1) Full M1 render (`h264_videotoolbox 12M`, CPU decode) | `3.057 s` | `196.3 fps` | **Faster** — kept `-hwaccel videotoolbox` OFF |
| d2) Full M1 render (`h264_videotoolbox 12M` + `-hwaccel videotoolbox`) | `3.136 s` | `191.3 fps` | Slower due to GPU→CPU download before CPU filters |
| e) Python sprite gen (`cProfile`, 126 sprites, `1080×330`) | `1.112 s` | — | Dominated by full-width `cumsum` smear (`0.796 s`) |
| **Previous 3-clip parallel baseline (raw-frame pipe + PIL MaxFilter)** | **`106.22 s`** | **`16.9 fps/clip`** | Per-frame raw RGBA stdin piping + full-band filters |

---

## M5 Rules Applied

1. **Rule 1 — Hardware Encode by Default**: `h264_videotoolbox -b:v 12M -maxrate 16M -pix_fmt yuv420p -tag:v avc1 -movflags +faststart` (`--quality fast|balanced|max`), with runtime probe + automatic fallback to `libx264 -preset veryfast -crf 20`.
2. **Rule 2 — Zero Python Per-Frame Piping**: Removed all raw-frame `stdin` piping and per-frame PIL/NumPy compositing. All video/audio pixel & sample work runs in **one FFmpeg process**.
3. **Rule 3 — Strip-Sized Sprite Tracks (`ffconcat`)**:
   - Captions: `1080×330` strip (`~3×font_px`), one cached PNG per distinct `(word, color, window_idx, smear_level, font_px)` state, smear derived from sharp base via horizontal-ROI-cropped blur + scaleX, overlaid via `-r <fps> -f concat -safe 0 -i captions.ffconcat` with `eof_action=pass` (runs at `2,628 fps` in FFmpeg, zero 25fps `image2` quantization drift).
   - Title: `1080×340` strip at `y=0`, 3-entry `title.ffconcat` (`smear2`, `smear1`, `sharp`) with `eof_action=repeat`.
4. **Rule 4 — Sprite Factory & Caching**: Memory + disk PNG cache (`~/.cache/openclip/sprites/`, fallback `backend/storage/cache/sprites/`), parallel worker pool, tight ROI rendering + separable 1D NumPy max dilation + horizontal ROI smear cropping. Cold 144-sprite generation dropped to **`0.381 s`** (7.9× under the `<= 3 s` budget).
5. **Rule 5 — Fast Seeking & Decode**: `-ss`/`-t` placed before `-i`; `-hwaccel videotoolbox` benchmarked and left OFF (CPU decode is faster before CPU filtergraph).
6. **Rule 6 — Slim Filter Graph**: Single `split`, 1/8-res blur (`scale=135:240:flags=fast_bilinear`, `gblur=sigma=5`, `scale=1080:1920:flags=bilinear`), single `format=yuv420p`, `-filter_threads 10 -filter_complex_threads 10`.
7. **Rule 7 — Parallelism (`--jobs auto`)**: Cached optimal concurrency (`jobs=3` on 10-core Apple Silicon) with `-threads = cores // jobs` for `libx264` fallback.
8. **Rule 8 — Compiled Hot Path**: **Not needed.** Sprite generation + command prep accounts for only `0.381 s` (`7.5%` of total wall time), well below the `15%` trigger threshold.

---

## Final Benchmark Results (`tools/bench.py`, Cold Sprite Cache)

### Single Clip (20 s @ 30 fps = 600 frames) Per-Stage Breakdown

| Stage | `h264_videotoolbox_12M` | `libx264_fallback` (CPU) |
|---|---:|---:|
| Probe | `0.064 s` | `0.062 s` |
| Adaptive grade `signalstats` | `0.338 s` | `0.336 s` |
| Caption sprites (144 cold PNGs) | `0.381 s` | `0.421 s` |
| Title sprites (3 cold PNGs) | `0.091 s` | `0.094 s` |
| SFX scene-cut + cue planning | `0.388 s` | `0.416 s` |
| Single-process FFmpeg render | `3.816 s` | `4.287 s` |
| **Total Single Clip (COLD)** | **`5.079 s` (`118.1 fps`, 3.94× RT)** | **`5.618 s` (`106.8 fps`, 3.56× RT)** |
| **Total Single Clip (WARM)** | **`4.599 s` (`130.5 fps`, 4.35× RT)** | **`5.354 s` (`112.1 fps`, 3.74× RT)** |

### Before / After Acceptance Table

| Metric | Before | After (`h264_videotoolbox`) | After (`libx264` fallback) | Target | Status |
|---|---:|---:|---:|---|---|
| 3 clips parallel (cold wall) | `106.22 s` | **`11.71 s`** | **`12.15 s`** | `<= 30 s` (`<= 20 s` stretch) | **PASS (beats stretch)** |
| Speedup vs baseline | `1.00×` | **`9.07×`** | **`8.74×`** | `>= 3.50×` | **PASS** |
| Single clip end-to-end (cold) | `16.9 fps` | **`118.1 fps`** | **`106.8 fps`** | `>= 100.0 fps` | **PASS** |
| Visual fidelity (SSIM vs `libx264 slow CRF 18`) | — | **`0.99764`** | **`0.99656`** | `>= 0.97` | **PASS** |
