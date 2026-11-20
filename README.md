# OpenClip AI - Open Source AI Video Studio & Media Infrastructure

> Open-Source AI Media Infrastructure for Short-Form Video Processing, Automated Re-Framing, and Hierarchical AI Editorial Direction.

OpenClip AI is a modular, AI-native media operating system engineered to convert long-form videos (ranging from 30-second reels to 6-hour podcasts) into high-retention short clips tailored for TikTok, YouTube Shorts, and Instagram Reels. OpenClip combines zero-decorative local computer vision, Whisper speech alignment, multi-aspect ratio smart cropping, hierarchical LLM creative director reasoning, and AES-256 encrypted security.

---

## Table of Contents

- [Architectural Overview](#architectural-overview)
- [Key Platform Features](#key-platform-features)
- [System Architecture & Subsystems](#system-architecture--subsystems)
- [Operating System & Dependency Requirements](#operating-system--dependency-requirements)
- [Installation & Environment Setup](#installation--environment-setup)
- [API Reference (/api/v1/*)](#api-reference-apiv1)
- [OpenClip SDK & Plugin Extensions](#openclip-sdk--plugin-extensions)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [Performance & Security](#performance--security)
- [Contributing & License](#contributing--license)

---

## Architectural Overview

OpenClip AI is designed around Studio Core, an internal SDK located at backend/src/core/. Unlike traditional video editors that tightly couple UI code with video rendering scripts, OpenClip enforces contract-based abstractions across all capabilities.

```
+---------------------------------------------------------+
|                     Frontend UI                         |
|       (Arc / Linear / Raycast Minimalist Workspace)     |
+---------------------------+-----------------------------+
                            | REST API / WebSocket
+---------------------------v-----------------------------+
|                 Studio API Router (/v1/*)               |
+---------------------------+-----------------------------+
                            |
+---------------------------v-----------------------------+
|                       Studio Core                       |
|    (Runtime, Media, Analysis, Reasoning, Rendering)     |
+--------+------------------+------------------+----------+
         |                  |                  |
+--------v---------+ +------v--------+ +-------v----------+
| Provider Contracts| |  MediaTimeline  | | WorkflowEngine   |
| (Speech, Vision, | |  & Manifests   | | & JobScheduler  |
|  Render, OCR)    | +----------------+ +------------------+
+--------+---------+
         |
+--------v---------+
| RuntimeRegistry  |
| (Health, Metrics)|
+------------------+
```

---

## Key Platform Features

### 1. Studio Core & Internal SDK
All backend modules communicate exclusively through stable provider contracts (backend/src/core/contracts/). The core engine never cares whether speech transcription is handled by local Whisper, WhisperX, Groq, or Deepgram.

### 2. Hot-Swappable RuntimeRegistry
Centralized startup registry (RuntimeRegistry.ts) that initializes and continuously monitors live health metrics for system binaries and AI runtimes:
- FFmpeg & FFprobe: Media probing, filter-graph processing, and fast H.264 encoding.
- Whisper & WhisperX: Sub-second word-level timestamp alignment.
- MediaPipe & OpenCV: Face detection, facial center tracking, and scene boundary cuts.
- Tesseract & PaddleOCR: On-frame text block extraction.
- PyTorch, ONNX & FAISS: Local ML vector search and acceleration.

### 3. Smart Reframing Engine (Phase 9)
Automatic re-framing planner supporting 7 target aspect ratios plus custom dimensions:
- 9:16 Vertical (TikTok, Shorts, Reels)
- 16:9 Widescreen
- 1:1 Square
- 4:5 Social Feed
- 3:4 Vertical Portrait
- 2:3 Classic Frame
- 21:9 Cinematic Ultrawide
- custom User-defined dimensions

Includes rule-of-thirds composition, user-defined safe area margins (10%), facial focus priority, speaker tracking, and dead-zone protection.

### 4. Explainable Virality Matrix (Phase F)
Replaces opaque virality numbers with a human-readable 9-dimension score matrix:
1. Hook Strength: Immediate speech engagement in the first 1.5 seconds.
2. Audience Match: Direct speaker face contact for personal connection.
3. Emotion: Expressive vocal pitch inflection.
4. Speech Density: Words-per-minute pacing and flow density.
5. Novelty: Unique phrasing and subject framing.
6. Story Progression: Cohesive setup, buildup, and resolution.
7. Retention Prediction: Estimated audience retention past 10 seconds.
8. Visual Motion: Visual camera movement and reframing dynamics.
9. Confidence: Statistical confidence across model evaluations.

### 5. Creator Editing Engine (Phase E)
Preset-driven creative instructions allowing natural-language clip editing:
- make_funnier: Highlights punchlines with dynamic zoom-ins and tight cuts.
- remove_pauses / remove_filler_words: Trims silent gaps > 0.3s and cuts filler words.
- hormozi_captions: Applies high-contrast yellow word-by-word animated captions.
- linkedin_format: Optimizes video for 4:5 square feed with professional headline banner.
- shorts_format / hook_harder: Front-loads explosive verbal hooks into the first 1.5s in 9:16 vertical.

### 6. Memory & Browser Cache Storage
Uploaded footage is managed via BrowserCacheStorage.ts, allowing direct memory/browser-cache buffer streaming without cluttering local backend disk folders.

### 7. Story Studio v2 (Reference-Grade Generative Story-Time Engine)
Autonomous generative engine converting a single-line tag (e.g. `"Instagram followers"`, `"college placements"`, `"attendance percentage"`) into a 9:16 reference-grade Roblox-style animated video:
- **Concept Engine & Critic**: Invents 3 complete social satire worlds from a tag (enforcing `"In this <place>,"` premise and visual proof $\le 3$s), with automated multi-factor Critic selection (Visual Disparity 40%, Irony 30%, Pacing 30%).
- **4-Pass Script Generation & Leakage Shield**: Writer $\to$ Critic $\to$ Punch-Up $\to$ Extend passes calibrating pacing to target duration (10-beat arc, named friend Toby with 3 concrete quirks) with automated 4-gram sliding-window leakage rejection ($\le 12\%$ overlap against references).
- **Director Stage ("Show Every Noun")**: Closed-vocabulary storyboard mapping with $\ge 90\%$ visual event coverage on concrete nouns, cut cadence $\le 3.0$s hold, and floating status tags above characters.
- **Continuous First-Person Narration**: 0.18s standard pause, 0.50s reveal pause, $< 5\%$ dead air target, with Kokoro-82M sidecar / macOS `say` / Groq Orpheus speech synthesis fallback chain.
- **Reference Captions (`reference_caps`)**: Arial Rounded MT Bold white text, soft drop shadow, zero background container, 2–4 words/card, 1 word ALL CAPS, zero stale cards.
- **BlockWorld 3D Renderer v2**: Headless Chromium + Three.js piping raw frames directly into FFmpeg `stdin` using Apple Silicon `h264_videotoolbox` hardware encoding (fallback `libx264`). Features 300-entity swarm instancing, canvas expressions, camera auto-framing away from caption safe-bands (12%–20%), and relative luminance contrast checks.
- **Timeline Auto-Fixer & Quality Governor**: Pre-render timeline auto-fix loop resolving cadence and staging before rendering pixels; 12-frame benchmark governor choosing `high`, `standard`, or `draft` tiers to fit strictly within a 180s budget.
- **Parity Verification & Contact Sheets**: Automated 8-metric parity auditing (`npm run story:parity`) emitting `.parity.json` sidecar and a tiled 1-frame/2s `contact-sheet.jpg` with burned-in timestamps.
- **Zero Silent Success Guarantee**: Every degraded job reports `completed_with_warnings` with an explicit list of warnings, never false green.

---

## System Architecture & Subsystems

### Core Subsystems (backend/src/core/)

```
backend/src/core/
|-- contracts/             # Stable TypeScript provider interfaces
|   `-- index.ts
|-- creator/               # Creator editing & experience engines
|   |-- CreatorEditingEngine.ts
|   `-- CreatorExperienceService.ts
|-- manifest/              # Standardized video JSON manifest generator
|   `-- MediaManifest.ts
|-- reasoning/             # Hierarchical agent & virality matrix engines
|   |-- CreativeDirectorEngine.ts
|   `-- ViralityMatrixEngine.ts
|-- registry/              # Runtime & provider health registry
|   `-- RuntimeRegistry.ts
|-- rendering/             # Smart reframing & crop calculation
|   `-- SmartReframingEngine.ts
|-- scheduler/             # Task queue dispatching across worker groups
|   `-- JobScheduler.ts
|-- storage/               # Versioned artifact & browser cache storage
|   |-- BrowserCacheStorage.ts
|   |-- StorageManager.ts
|   `-- VersionedArtifactStore.ts
|-- story/                 # Story Studio autonomous generative module
|   |-- StoryStudioService.ts
|   |-- StorySchema.ts
|   |-- StoryboardRepair.ts
|   |-- audio/             # Orpheus TTS chunking, Whisper alignment & audio mix
|   |-- captions/          # "story_pop" dynamic ASS subtitle generator
|   |-- providers/         # Groq & NVIDIA dynamic model providers
|   |-- renderer/          # BlockWorld Three.js / Playwright renderer
|   |-- sfx/               # Procedural audio synthesizer & indexer
|   `-- stages/            # 8-stage WorkflowEngine DAG tasks
|-- timeline/              # Timestamped canonical media timeline
|   `-- MediaTimeline.ts
`-- workflow/              # Deterministic Task Graph workflow engine
    `-- WorkflowEngine.ts
```

---

## Operating System & Dependency Requirements

### macOS Requirements
- OS: macOS Monterey (12.0+) or higher (Apple Silicon M1-M4 or Intel).
- System Tools: brew install ffmpeg node python.
- Hardware Acceleration: Apple Metal API support.

### Windows Requirements
- OS: Windows 10 / Windows 11 (64-bit).
- System Tools: choco install ffmpeg nodejs python.
- Hardware Acceleration: DirectML / NVIDIA CUDA.

---

## Installation & Environment Setup

### 1. Clone Repository
```bash
git clone https://github.com/codebrak07/OpenClip.git
cd OpenClip
```

### 2. Configure Backend Environment
Create .env inside backend/:

```env
PORT=5001
SECRET_KEY=openclip-production-secret-key-2026

# Primary and Fallback Groq API Keys (Encrypted at rest via AES-256-GCM)
GROQ_API_KEY=gsk_your_primary_groq_api_key_here
GROQ_API_KEY_FALLBACK_1=gsk_your_fallback_groq_api_key_here

# System Binary Paths (Optional if already in System PATH)
FFMPEG_PATH=/opt/homebrew/bin/ffmpeg
FFPROBE_PATH=/opt/homebrew/bin/ffprobe
PYTHON_PATH=python3

DATABASE_PATH=database.sqlite
```

### 3. Configure Frontend Environment
Create .env inside frontend/:

```env
VITE_API_BASE_URL=http://localhost:5001
```

### 4. Install & Launch Backend API Server
```bash
cd backend
npm install
npm run dev
```
(Optional: Run unit tests with `npm test`)

Backend launches at http://localhost:5001.

### 5. Install & Launch Frontend Application
In a separate terminal window:
```bash
cd frontend
npm install
npm run dev
```
Frontend application launches at http://localhost:5173.

---

## API Reference (/api/v1/*)

### System & Diagnostics
```http
GET /api/v1/diagnostics
```
Returns live hardware metrics (CPU load average, memory usage, GPU accelerator), dependency health statuses, and worker queue capacities.

```http
GET /api/v1/plugins
```
Returns list of registered intelligence plugins and capability metadata.

```http
GET /api/v1/models
```
Returns active hot-swappable AI models (whisper, mediapipe, sentence-transformers).

### Jobs & Searching
```http
GET /api/v1/jobs/:id
```
Returns job status, current pipeline stage, logs, and sanitized metadata.

```http
POST /api/v1/search
```
Performs vector similarity search across video transcript chunks.
```json
{
  "jobId": "job_12345",
  "query": "artificial intelligence funding",
  "limit": 5
}
```

### Creator Experience Endpoints
```http
POST /api/v1/creator/instruction
```
Applies creative preset instructions to video clip.
```json
{
  "preset": "make_funnier"
}
```

```http
GET /api/v1/creator/virality-matrix/:jobId
```
Returns 9-dimension virality matrix evaluation for job.

```http
GET /api/v1/creator/alternate-edits/:clipId
```
Returns generated alternate edit options with rationale and virality scores.

```http
POST /api/v1/creator/natural-language-edit
```
Modifies clip parameters via natural language prompts.
```json
{
  "clipId": "clip_101",
  "prompt": "make this clip faster and add yellow captions"
}
```

### Story Studio v2 Endpoints
```http
POST /api/v1/story
```
Triggers end-to-end story video generation or interactive concept generation.
```json
{
  "tag": "Instagram followers",
  "interactive": false,
  "renderBudgetSec": 180
}
```

```http
GET /api/v1/story/:jobId
```
Polls story job execution status, stage latency breakdown, warnings, and artifact paths.

```http
POST /api/v1/story/:jobId/approve-concept
```
Approves one of the 3 Critic-evaluated concepts to resume pipeline execution.
```json
{
  "conceptIndex": 0
}
```

```http
GET /api/v1/story/:jobId/contact-sheet.jpg
```
Returns 1-frame-per-2s tiled contact sheet JPEG with burned-in timestamps.

```http
GET /api/v1/story/:jobId/parity.json
```
Returns 8-metric reference parity audit report comparing output against `roblox-storytime.json`.

---

## Story Studio CLI Tools

```bash
# 1. Verify and diagnose local & cloud TTS engines (Kokoro-82M, macOS say, Groq Orpheus)
npm run tts:doctor

# 2. Profile any MP4 video across 8 reference metrics
npm run story:profile <path/to/video.mp4>

# 3. Audit video against reference style profile and emit parity.json + contact-sheet.jpg
npm run story:parity <path/to/video.mp4> [assets/story/style-profiles/roblox-storytime.json]

# 4. Run the full 3-tag empirical benchmark suite and update docs/story-studio-report.md
npm run story:benchmark
```

---

## OpenClip SDK & Plugin Extensions

OpenClip provides a public SDK (OpenClipSDK) allowing third-party developers to extend speech, vision, rendering, and storage providers without editing backend core code:

```typescript
import { OpenClipSDK } from './src/sdk/OpenClipSDK';

// Initialize platform engine
await OpenClipSDK.initialize();

// Resolve active SpeechProvider
const speechProvider = OpenClipSDK.getSpeechProvider();
const transcript = await speechProvider.transcribe('path/to/audio.mp3');

// Register custom VisionProvider
OpenClipSDK.registerCustomProvider({
  id: 'custom-vision-plugin',
  name: 'Custom Vision Engine',
  version: '1.0.0',
  isAvailable: async () => true,
  detectFaces: async (path) => [],
  detectScenes: async (path) => [],
}, ['FaceDetection', 'SceneDetection']);
```

---

## Testing & Quality Assurance

OpenClip includes comprehensive automated Jest test suites covering security, rendering, crop engine, DAG scheduling, feature graphs, and API endpoints:

```bash
cd backend
npm test
```

### Test Suite Summary (81 Passing Tests across 10 Suites):
- `tests/system.test.ts`: Secrets encryption, vector store embeddings, hardware diagnostics, DAG graph scheduler.
- `tests/v7_platform.test.ts`: Plugin capability dispatching, model registration, media knowledge graph, event pipeline, artifact fingerprinting.
- `tests/v8_enterprise.test.ts`: StudioCore bootstrapping, contract resolution, MediaTimeline, CreativeDirectorEngine reasoning, WorkflowEngine.
- `tests/v8_5_studio.test.ts`: Browser cache upload storage, SmartReframingEngine 7-aspect crop calculation, CreatorExperienceService.
- `tests/creative_os.test.ts`: Creator editing instructions, ViralityMatrixEngine 9-dimension scoring, OpenClipSDK.
- `tests/staging_solver.test.ts`: Physical staging solver (head clearance, visibility, status tag positions).
- `tests/story_studio_m1.test.ts`: 410-aware LLM providers, model rotation, Kokoro/macOS TTS doctor, schema repair.
- `tests/story_studio_m2.test.ts`: Continuous narration audio mixdown, ducked procedural SFX, ASS subtitle generation.
- `tests/story_studio_m4_m5.test.ts`: 4-gram leakage rejection, ConceptStage Critic scoring, TimelineAutoFixer, QualityGovernor budgeting.
- `tests/story_studio_e2e.test.ts`: Full BlockWorld headless render pipeline and frame multiplexing.

---

## Empirical Benchmark & Quality Disclosure

In accordance with our strict honesty guidelines, all claimed performance numbers are measured directly on our reference test machine (Apple Silicon M4 macOS Darwin, cloud NVIDIA NIM & Groq APIs, local `h264_videotoolbox` hardware encoding with `libx264` fallback):

| Pipeline Stage | Target Spec | Measured Performance (Apple Silicon M4) | Status |
|---|---|---|---|
| **Concept & Scripting** | 3 candidates + Critic, 4-pass writer, 4-gram overlap $\le 12\%$ | 0.08s – 0.12s total latency; 0.0% 4-gram reference leakage | Working |
| **Speech Synthesis** | Continuous narration, pause pacing (0.18s standard, 0.50s reveal) | 3.5s – 23.3s via Kokoro-82M / macOS `say` / Groq Orpheus | Working |
| **Audio Mixing & SFX** | Layered bed, procedural cues, loudnorm -14 LUFS, peak $\le -1$ dBFS | 2.4s mixdown; measured True Peak -1 dBFS, LUFS -15.7 | Working |
| **BlockWorld Rendering** | 9:16 vertical, 300-entity swarms, auto-framing, luminance checks | 40.5 – 42.5 FPS render speed in high tier (45s – 48s for 64s video) | Working |
| **Timeline Auto-Fix** | Pre-render cadence & staging audit (up to 2 iterations) | Automatically splits > 3s holds and populates cast/environments | Working |
| **WebGL2 / 2D Canvas** | Hardware WebGL2 rendering | Fully supported in standard browser; headless Playwright falls back cleanly to 2D Canvas buffer | Working (2D fallback labeled experimental) |
| **Total Wall-Clock Time** | $\le 180$s budget for 60s – 100s video | **59.0s – 82.2s** measured end-to-end (well within budget) | Working |

---

## Performance & Security

1. AES-256-GCM Encryption: User-submitted API keys are encrypted at rest inside SQLite job metadata using AES-256-GCM and decrypted dynamically during execution context initialization.
2. Centralized FFmpeg Execution (FFmpegService.ts): All video processing commands pass through a single managed service with path validation, argument escaping, and timeout handling.
3. Content Fingerprinting (ArtifactStore.ts): Transcripts, OCR blocks, and scene analysis artifacts are indexed via SHA-256 content hashes, preventing duplicate processing of identical media.
4. Deterministic Workflows (WorkflowEngine.ts): Task graphs resolve dependencies deterministically, ensuring reproducible outputs for identical inputs.

---

## License

This project is licensed under the MIT License - see the LICENSE file for details.