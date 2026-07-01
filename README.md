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

### Test Suite Summary (30 Passing Tests across 5 Suites):
- tests/system.test.ts: Secrets encryption, vector store embeddings, hardware diagnostics, DAG graph scheduler.
- tests/v7_platform.test.ts: Plugin capability dispatching, model registration, media knowledge graph, event pipeline, artifact fingerprinting.
- tests/v8_enterprise.test.ts: StudioCore bootstrapping, contract resolution, MediaTimeline, CreativeDirectorEngine reasoning, WorkflowEngine.
- tests/v8_5_studio.test.ts: Browser cache upload storage, SmartReframingEngine 7-aspect crop calculation, CreatorExperienceService.
- tests/creative_os.test.ts: Creator editing instructions, ViralityMatrixEngine 9-dimension scoring, OpenClipSDK.

---

## Performance & Security

1. AES-256-GCM Encryption: User-submitted API keys are encrypted at rest inside SQLite job metadata using AES-256-GCM and decrypted dynamically during execution context initialization.
2. Centralized FFmpeg Execution (FFmpegService.ts): All video processing commands pass through a single managed service with path validation, argument escaping, and timeout handling.
3. Content Fingerprinting (ArtifactStore.ts): Transcripts, OCR blocks, and scene analysis artifacts are indexed via SHA-256 content hashes, preventing duplicate processing of identical media.
4. Deterministic Workflows (WorkflowEngine.ts): Task graphs resolve dependencies deterministically, ensuring reproducible outputs for identical inputs.

---

## License

This project is licensed under the MIT License - see the LICENSE file for details.