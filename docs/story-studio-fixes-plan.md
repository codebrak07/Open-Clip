# Story Studio Fixes & Reliability Upgrade Plan

> **Status:** APPROVED FOR EXECUTION  
> **Target:** Eliminate silent failures, guarantee real audio synthesis, enforce visual fidelity, ensure deterministic subtitle burns, and calibrate story duration.  
> **Rule:** Claims in documentation and UI must only reflect implemented, benchmarked, and verified functionality.

---

## 1. Executive Summary & Defect Diagnosis

Analysis of previous execution outputs (e.g. `story_1795177305056_sya1e`, prompt: *"A kid discovers his cat sneezes a puff of smoke every time someone lies"*, 45s, 2 characters, seed 42) revealed critical discrepancies between system reports and actual artifacts:

| Subsystem | Observed Defect | Root Cause | Fix Strategy |
| :--- | :--- | :--- | :--- |
| **Voice / Speech** | Constant low-frequency hum (< 150 Hz) + 5 SFX bursts; zero real speech. | Groq Orpheus returned `400 model_terms_required` and fell back to harmonic sine wave pacing instead of real TTS speech. | Build a resilient multi-tier offline/online TTS provider chain: **`kokoro-local` (primary)** -> `groq-orpheus` (cloud optional) -> **`macos-say` (system fallback)**. |
| **Validation / Reporting** | UI printed *"Generation completed successfully!"* despite completely silent dialogue tracks. | Lack of post-mix acoustic validation checks. | Introduce hard-guard acoustic energy analysis: fail or warn if speech-band energy (300 Hz–3400 Hz) is absent in any beat window. |
| **Video & Lighting** | Flat dark backdrop, faces rendered near-black, only 1 character rendered. | WebGL context lacked sRGB color space, tone mapping, and 3-point fill lighting. Fallback renderer lacked character instancing. | Upgrade BlockWorld renderer to `THREE.SRGBColorSpace`, `ACESFilmicToneMapping`, hemisphere + key + fill lighting, and multi-avatar coordinate layout. |
| **Props & FX** | Cat model missing; lie-triggered smoke puffs never rendered. | Procedural meshes for custom props were not instantiated in the 3D scene or 2D fallback. | Implement procedural voxel prop generator for animals (cat) and particle puff system for lie events. Log `renderedFx[]` in report. |
| **Captions** | No burned-in subtitles in exported video. | FFmpeg build on macOS lacks `--enable-libass`, causing silent fallback to raw video muxing. | Render `story_pop` captions directly onto the frame buffer inside the browser renderer so subtitles are burnt-in deterministically. |
| **Pacing & Duration** | Video duration was 28.2s instead of 45s; duplicate beat IDs in UI. | Beat script duration was uncalibrated; beat ID generator was resetting per scene. | Enforce word count calibration (`durationSec * 2.5` words), add automated extension pass if duration < 90%, and assign globally unique beat IDs. |

---

## 2. Voice Architecture: Multi-Tier Offline/Online TTS Provider Chain

```
               [Script Beats (Text + Vocal Directions)]
                                  │
                                  ▼
                     ┌─────────────────────────┐
                     │ SpeechSynthesisManager  │
                     └────────────┬────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
 1. kokoro-local           2. groq-orpheus           3. macos-say
 (Kokoro-82M sidecar       (Cloud Orpheus TTS,       (macOS built-in
  Apple Silicon M4,         requires API key +       48kHz AIFF->WAV,
  Apache 2.0, offline)      accepted terms)           100% offline)
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  ▼
                   [Audio Post-Processing & Normalization]
                   - atempo vocal direction pacing
                   - 48 kHz / 16-bit mono WAV standardization
                                  │
                                  ▼
                     [Whisper Word Alignment]
                   - Groq whisper-large-v3-turbo (primary)
                   - Duration-weighted word estimation (fallback)
```

### 2.1 Provider Specifications

1. **`kokoro-local` (Primary)**:
   - Model: Kokoro-82M (v0.19 / v1.0 ONNX).
   - Platform: Apple Silicon M4 with `onnxruntime` + `soundfile`.
   - Architecture: Long-lived Python sidecar process (`python-engine/kokoro_sidecar.py`) communicating over JSON stdio or local HTTP `127.0.0.1:5002`. Model loads once into memory (~350 MB); per-line synthesis latency < 350ms.
   - Voices: Curated set of 8 distinct English voices (male & female, US & UK): `af_heart`, `af_bella`, `af_nicole`, `am_adam`, `am_michael`, `bf_emma`, `bm_george`, `bm_lewis`.
   - Automated setup: `scripts/setup-tts.sh` (installs dependencies, downloads weights into `backend/storage/models/kokoro/`).
   - Doctor command: `npm run tts:doctor`.

2. **`groq-orpheus` (Secondary / Optional)**:
   - Endpoint: `https://api.groq.com/openai/v1/audio/speech`.
   - Voices: `autumn`, `diana`, `hannah`, `austin`, `daniel`, `troy`.
   - Guard: If API returns `400 model_terms_required`, log and display:
     `"Accept the Orpheus terms at console.groq.com/playground?model=canopylabs/orpheus-v1-english"`.
   - Strict `<= 200` char boundary chunking and SHA-256 chunk caching.

3. **`macos-say` (Deterministic Native Fallback)**:
   - Command: `say -v <voice> -o <tmp.aiff> "<text>"`.
   - Voices: `Samantha`, `Daniel`, `Karen`, `Fred`, `Eddy`, `Flo`.
   - Conversion: FFmpeg transcoding from AIFF to 48kHz mono 16-bit PCM WAV.
   - Tagged as `"basic"` quality tier in final report.

### 2.2 Vocal Directions Post-Processing
For providers that do not natively ingest vocal direction tags (e.g. Kokoro, macOS say):
- `[whisper]`: Gain `-6 dB`, high-shelf filter cut above 4 kHz.
- `[excited]`: Speed `atempo=1.15`, pitch shift +1 semitone.
- `[deadpan]`: Flat dynamic range, speed `atempo=0.92`.
- `[fast]`: Speed `atempo=1.25`.

---

## 3. Acoustic Verification & Anti-Silent Success Guard

To guarantee that no silent video is ever marked as successful:

```ts
interface AudioIntegrityReport {
  overallLufs: number;          // Target: -14 LUFS (+/- 1.5 dB)
  peakDbfs: number;             // Target: <= -6 dBFS
  speechEnergyPercentage: number;// Target: >= 90% across dialogue windows
  silentBeats: string[];        // Must be empty
  passed: boolean;
}
```

1. **Spectral Analysis**:
   - Extract audio envelope and perform FFT over 300 Hz – 3400 Hz (human vocal tract band).
   - If RMS energy in speech band < -45 dBFS for the duration of any beat, register as a `silentBeat`.
2. **Hard-Fail Policy**:
   - If any beat has zero speech energy:
     - If >= 1 beat has valid speech, status = `'completed_with_warnings'`.
     - If 100% of dialogue beats are silent, status = `'failed'` with error: `"Dialogue track silent: TTS synthesis failed"`.

---

## 4. Visual Rendering Upgrades (BlockWorld 9:16)

### 4.1 Lighting & Color Calibration
- Canvas / WebGL context: `renderer.outputColorSpace = THREE.SRGBColorSpace;`
- Tone mapping: `renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;`
- 3-Point Lighting rig:
  1. **Hemisphere Light**: Sky color `#e2e8f0`, Ground color `#334155`, intensity 0.7.
  2. **Directional Key Light**: Sun color `#ffffff`, intensity 1.2, positioned at `(5, 12, 8)` with PCFSoft shadows.
  3. **Fill Light**: Warm bounce `#fde047`, intensity 0.4, positioned at `(-4, 3, 2)`.

### 4.2 Multi-Avatar Staging & Audio-Driven Animation
- Both requested characters (`char_1`, `char_2`) are positioned side-by-side or framed in dialogue setups.
- **Audio-driven mouth flap**: The speaker's real-time audio RMS envelope drives the jaw open/close displacement `(0.0 to 1.0)`. Non-speaking characters keep mouths closed.
- **Subtle idle motion**: Breathing sway (sine displacement `y = sin(t * 3) * 0.03`) and head tilts.

### 4.3 Procedural Props & FX System
- **Animal / Cat Mesh**: Procedural voxel cat (body, head, ears, tail) positioned next to `char_1`.
- **Smoke Puff Particle System**: Triggered whenever lie events occur in the beat action/fx specification (`puff_smoke`), spawning expanding translucent smoke spheres that dissipate over 1.2s.
- `renderedFx[]` tracked per frame and exported into `[jobId].report.json`.

### 4.4 Deterministic Subtitle Burn-In
- Because local FFmpeg may lack `libass`, `StoryPopCaptionEngine` will support dual-mode burning:
  1. **In-Canvas Burn-In (Primary/Guaranteed)**: BlockWorldRenderer renders the top-third `story_pop` styled text directly onto the viewport canvas during Playwright frame capture.
  2. **FFmpeg libass Filter (Secondary)**: Used when FFmpeg has `libass` compiled.

---

## 5. Verification Harness: `npm run story:verify`

A standalone automated test & verification script:
`npm run story:verify <path-to-video.mp4> [path-to-storyboard.json]`

Checks enforced:
1. **Duration**: Output duration matches target within `+/- 10%`.
2. **Loudness**: Integrated loudness within `-15.5 LUFS` to `-12.5 LUFS`, peak `<= -6 dBFS`.
3. **Speech Presence**: Speech-band energy detected in `>= 90%` of dialogue beat intervals; no silent gaps `> 1.5s`.
4. **Captions**: White-pixel cluster in top-third caption band detected in `>= 70%` of speech frames.
5. **Visual Diversity**: Background and facial pixel histograms verify `>= N` distinct characters and configured skin tones.
6. **FX Audit**: Storyboard FX items appear in `renderedFx[]`.

---

## 6. Implementation Milestones

- **Milestone V1**: TTS Providers (`kokoro-local`, `groq-orpheus`, `macos-say`) + `setup-tts.sh` + `npm run tts:doctor` + anti-silent guards.
- **Milestone V2**: Audio verification + real audio-driven mouth flap + `story:verify` test harness.
- **Milestone V3**: Visual fixes (sRGB, 3-point lighting, multi-avatar staging, cat prop voxel mesh, smoke puff particle effect, in-canvas caption burn).
- **Milestone V4**: Duration calibration (`2.5 words/sec`, extend pass) + unique beat ID resolution + UI updates.
- **Milestone V5**: End-to-end regeneration of the cat smoke test idea with full `story:verify` report attachment.
