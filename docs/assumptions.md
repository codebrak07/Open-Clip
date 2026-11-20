# OpenClip Story Studio v2 Assumptions & Sensible Defaults

This document logs all design decisions, sensible defaults, and heuristic calibrations chosen for unspecified parameters in the Master Spec for Story Studio v2.

---

### 1. Timing & Pacing Defaults
- **Default Duration**: When unspecified by the user, the target video duration defaults to **90 seconds** (range: 45s – 100s).
- **Default Words-Per-Second**: Narrator cadence is calibrated to **3.5 words/second** (generating ~315 words for a 90s video, ~160 words for a 45s video).
- **Inter-Sentence Crossfade / Pause**: Inter-sentence pauses default to **0.15s – 0.20s** with a 20ms linear crossfade to eliminate clicks.
- **Reveal Pause**: Exactly one dramatic pause of **0.50s** (<= 0.60s maximum) is inserted immediately prior to the emotional reveal beat.
- **Max Hold Per Shot**: Camera shots are capped at **3.0 seconds maximum**. If dialogue continues in the same environment, the director cuts to an alternate angle (e.g. wide -> over_shoulder -> medium).

### 2. Audio & SFX Engineering
- **Audio Mix Ducking**: Ambient room tone and background beds are ducked by **-12.0 dB** during active speech, with a 150ms attack and 300ms release envelope.
- **Master Normalization Target**: Integrated loudness is normalized to **-14.0 LUFS (±1.0)** with true peak capped at **-1.0 dBFS** using FFmpeg `loudnorm`.
- **Speech Energy Validation Guard**: Audio integrity validator scans for root-mean-square energy > -45 dBFS in 500ms windows across all narration spans. If dead air exceeds 5%, the job status is set to `completed_with_warnings` with a flagged report.
- **Procedural SFX Gain**: Procedural SFX events default to **-6.0 dBFS** (loud gags/reveals) or **-12.0 dBFS** (footsteps, ambient rustle) so they punch through without clipping.

### 3. Visuals & 3D BlockWorld Renderer
- **Top Caption Safe-Band**: Captions are pinned between **12% and 20%** of the frame height from the top edge (`y = 230px` to `y = 384px` at 1080x1920).
- **Camera Auto-Framing**: If any character's head/face bounding box projects into `y < 400px` in screen coordinates, the camera auto-pitches down by 4.5 degrees or pulls back by 12% to ensure 100% caption-to-face clearance.
- **Instanced Swarm Capacity**: The creature instanced mesh creates **300 instances** with procedural bobbing and path jitter on the X/Z plane.
- **Luminance Contrast Standard**: Contrast between characters and background geometry is calculated using WCAG relative luminance: `(L1 + 0.05) / (L2 + 0.05) >= 3.0:1`. If lower, the environment wall/sky color is dynamically adjusted.

### 4. Directing & Leakage Safeguards
- **Few-Shot Leakage Threshold**: 4-gram overlap against prompt examples is strictly bounded at **<= 12%**. Any generated script exceeding 12% 4-gram overlap is automatically rejected and rewritten.
- **Closed Vocabulary Fallback**: If an LLM script requests an asset not present in `assets/story/catalog.json`, the director maps to the nearest semantic synonym (e.g., `golden_throne` -> `stage_raised`) and appends the uncataloged key to `docs/catalog-requests.json`.
- **Hard-Cut Detection in Profiler**: Scene cut detection uses FFmpeg `select='gt(scene,0.40)'` for hard cuts and `gt(scene,0.25)` for soft cuts.
