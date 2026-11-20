# OpenClip Story Studio v2 — Benchmark Report

> **Generated:** 2026-11-20T20:10:21.502Z
> **Platform:** Apple Silicon M4 / macOS Darwin (No local NVIDIA GPU, cloud NIM API, Apple Silicon h264_videotoolbox hardware encoding)
> **Reference Standard:** `assets/story/style-profiles/roblox-storytime.json`

## Empirical Benchmark Summary

| Benchmark Tag | Total Time | Render Speed | Quality Tier | Parity Status | Dead Air | Cuts/Min | Max Hold | Contact Sheet |
|---|---|---|---|---|---|---|---|---|
| **"Instagram followers"** | 82.2s | 42.5 fps | high | COMPLETED WITH WARNINGS ⚠️ | 11.1% | 0 | 63.9s | `satire_bench_1_1795205204236.contact-sheet.jpg` |
| **"college placements"** | 63.6s | 41.9 fps | high | COMPLETED WITH WARNINGS ⚠️ | 11.3% | 0 | 64.4s | `satire_bench_2_1795205289456.contact-sheet.jpg` |
| **"attendance percentage"** | 65.4s | 40.5 fps | high | COMPLETED WITH WARNINGS ⚠️ | 11.3% | 0 | 64.6s | `satire_bench_3_1795205356073.contact-sheet.jpg` |

## Per-Video Parity & Review Details

### Benchmark: "Instagram followers" (`satire_bench_1_1795205204236`)
- **Master Video:** `satire_bench_1_1795205204236.mp4`
- **Contact Sheet:** `satire_bench_1_1795205204236.contact-sheet.jpg` (1 frame / 2s with timestamps)
- **Parity Report:** `satire_bench_1_1795205204236.parity.json`
- **Quality Governor Tier:** `high` (Projected 45.1s within 180s budget)
- **Visual QA Score:** 100/100 (Monotonicity: true, Clearance: true, Concealment: true)
- **Critic Retention Score:** 94/100
- **Stage Latency Breakdown:**
  - `ConceptStage`: 0.05s
  - `CastAndStaging`: 0.00s
  - `4-Pass Script Generation (Writer + Critic + Punch-Up + Extend & Leakage Check)`: 0.03s
  - `Closed-Vocabulary Storyboard Generation & Zod Validation`: 0.01s
  - `Voiceover Synthesis (Kokoro-82M / Groq Orpheus / macOS Say)`: 23.29s
  - `Word-Level Alignment & Timing Anchor (Groq Whisper)`: 0.05s
  - `SFX Cue Planning & Ducked Mixdown (Sidechain -12dB, Limiter -6dBFS, Loudnorm -14 LUFS)`: 2.42s
  - `BlockWorld 3D Playwright Deterministic Rendering (Three.js 9:16 + Timeline Auto-Fix)`: 45.21s
  - `Master Multiplex & Sidecar Export (9:16 MP4 + Storyboard + Words + SFX + Report + Parity + Contact Sheet)`: 6.64s
  - `ProductionGeneration`: 77.65s
- **Parity Checks (8 metrics audited):**
  - ✅ **Duration Range**: Actual `63.9s` (Target `45s – 100s`)
  - ⚠️ **Hard Cuts / Minute**: Actual `0` (Target `>= 15 (Target ~22)`)
  - ⚠️ **Max Shot Hold**: Actual `63.9s` (Target `<= 3s`)
  - ⚠️ **Dead Air Ratio**: Actual `11.1%` (Target `<= 5.0%`)
  - ⚠️ **Integrated Loudness**: Actual `-15.7 LUFS` (Target `-14 ± 1 LUFS`)
  - ✅ **True Peak Audio**: Actual `-1 dBFS` (Target `<= -1 dBFS`)
  - ⚠️ **Distinct Environments**: Actual `1` (Target `>= 5`)
  - ⚠️ **Avatar & Cast Variety**: Actual `2` (Target `>= 8`)

### Benchmark: "college placements" (`satire_bench_2_1795205289456`)
- **Master Video:** `satire_bench_2_1795205289456.mp4`
- **Contact Sheet:** `satire_bench_2_1795205289456.contact-sheet.jpg` (1 frame / 2s with timestamps)
- **Parity Report:** `satire_bench_2_1795205289456.parity.json`
- **Quality Governor Tier:** `high` (Projected 46.1s within 180s budget)
- **Visual QA Score:** 100/100 (Monotonicity: true, Clearance: true, Concealment: true)
- **Critic Retention Score:** 92/100
- **Stage Latency Breakdown:**
  - `ConceptStage`: 0.03s
  - `CastAndStaging`: 0.00s
  - `4-Pass Script Generation (Writer + Critic + Punch-Up + Extend & Leakage Check)`: 0.03s
  - `Closed-Vocabulary Storyboard Generation & Zod Validation`: 0.01s
  - `Voiceover Synthesis (Kokoro-82M / Groq Orpheus / macOS Say)`: 3.50s
  - `Word-Level Alignment & Timing Anchor (Groq Whisper)`: 0.05s
  - `SFX Cue Planning & Ducked Mixdown (Sidechain -12dB, Limiter -6dBFS, Loudnorm -14 LUFS)`: 2.45s
  - `BlockWorld 3D Playwright Deterministic Rendering (Three.js 9:16 + Timeline Auto-Fix)`: 46.30s
  - `Master Multiplex & Sidecar Export (9:16 MP4 + Storyboard + Words + SFX + Report + Parity + Contact Sheet)`: 6.67s
  - `ProductionGeneration`: 59.01s
- **Parity Checks (8 metrics audited):**
  - ✅ **Duration Range**: Actual `64.4s` (Target `45s – 100s`)
  - ⚠️ **Hard Cuts / Minute**: Actual `0` (Target `>= 15 (Target ~22)`)
  - ⚠️ **Max Shot Hold**: Actual `64.4s` (Target `<= 3s`)
  - ⚠️ **Dead Air Ratio**: Actual `11.3%` (Target `<= 5.0%`)
  - ⚠️ **Integrated Loudness**: Actual `-15.7 LUFS` (Target `-14 ± 1 LUFS`)
  - ✅ **True Peak Audio**: Actual `-1 dBFS` (Target `<= -1 dBFS`)
  - ⚠️ **Distinct Environments**: Actual `1` (Target `>= 5`)
  - ⚠️ **Avatar & Cast Variety**: Actual `2` (Target `>= 8`)

### Benchmark: "attendance percentage" (`satire_bench_3_1795205356073`)
- **Master Video:** `satire_bench_3_1795205356073.mp4`
- **Contact Sheet:** `satire_bench_3_1795205356073.contact-sheet.jpg` (1 frame / 2s with timestamps)
- **Parity Report:** `satire_bench_3_1795205356073.parity.json`
- **Quality Governor Tier:** `high` (Projected 47.9s within 180s budget)
- **Visual QA Score:** 100/100 (Monotonicity: true, Clearance: true, Concealment: true)
- **Critic Retention Score:** 90/100
- **Stage Latency Breakdown:**
  - `ConceptStage`: 0.03s
  - `CastAndStaging`: 0.00s
  - `4-Pass Script Generation (Writer + Critic + Punch-Up + Extend & Leakage Check)`: 0.02s
  - `Closed-Vocabulary Storyboard Generation & Zod Validation`: 0.02s
  - `Voiceover Synthesis (Kokoro-82M / Groq Orpheus / macOS Say)`: 3.62s
  - `Word-Level Alignment & Timing Anchor (Groq Whisper)`: 0.04s
  - `SFX Cue Planning & Ducked Mixdown (Sidechain -12dB, Limiter -6dBFS, Loudnorm -14 LUFS)`: 2.46s
  - `BlockWorld 3D Playwright Deterministic Rendering (Three.js 9:16 + Timeline Auto-Fix)`: 47.97s
  - `Master Multiplex & Sidecar Export (9:16 MP4 + Storyboard + Words + SFX + Report + Parity + Contact Sheet)`: 6.79s
  - `ProductionGeneration`: 60.92s
- **Parity Checks (8 metrics audited):**
  - ✅ **Duration Range**: Actual `64.6s` (Target `45s – 100s`)
  - ⚠️ **Hard Cuts / Minute**: Actual `0` (Target `>= 15 (Target ~22)`)
  - ⚠️ **Max Shot Hold**: Actual `64.6s` (Target `<= 3s`)
  - ⚠️ **Dead Air Ratio**: Actual `11.3%` (Target `<= 5.0%`)
  - ⚠️ **Integrated Loudness**: Actual `-15.7 LUFS` (Target `-14 ± 1 LUFS`)
  - ✅ **True Peak Audio**: Actual `-1 dBFS` (Target `<= -1 dBFS`)
  - ⚠️ **Distinct Environments**: Actual `1` (Target `>= 5`)
  - ⚠️ **Avatar & Cast Variety**: Actual `2` (Target `>= 8`)

