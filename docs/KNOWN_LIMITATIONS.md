# OpenClip AI — Known Limitations & Operational Guidelines

This document provides transparent documentation of architectural boundaries, external dependencies, and operational limits of the OpenClip AI platform.

---

## 1. External AI Providers & Credentials
- **API Key Requirement**: Live multi-agent reasoning, punchline detection, and natural language edits require valid API keys for NVIDIA NIM (`NVIDIA_API_KEY`), Groq (`GROQ_API_KEY`), or Google Gemini (`GEMINI_API_KEY`).
- **Heuristic Fallback**: If no API keys are provided or if an external provider endpoint times out, the system automatically falls back to deterministic multi-pass heuristic clip generation (`ReasoningEngine.generateHeuristicClips`) based on speech energy peaks and scene cuts. The pipeline will not crash when keys are missing.

---

## 2. Remote Media Ingestion & yt-dlp
- **Network & Rate Limits**: Remote video downloads via `yt-dlp` depend on YouTube's server availability and platform policies. OpenClip does not bypass DRM, paywalls, or authentication gates.
- **Local Upload Alternative**: When remote video downloads are restricted or unauthorized, users can directly upload local video files (`.mp4`, `.mov`, `.mkv`, `.webm`) up to 4GB.

---

## 3. Football Footage Rights & Licensing
- **Metadata vs. Footage**: Football Creator Studio generates verified event timelines, tactical breakdowns, hooks, and multilingual commentary from match text or reports without requiring match footage.
- **Clip Rendering from Matches**: Extracting and rendering video clips requires the user to supply authorized match footage. OpenClip does not automatically scrape or distribute copyright-protected broadcast streams.

---

## 4. Hardware & GPU Acceleration
- **CPU-Only Default**: The entire media pipeline (FFmpeg encoding, Whisper speech alignment, OpenCV cuts, smart reframing) is engineered to run on standard multicore CPUs (including Apple Silicon and x86_64).
- **GPU Acceleration**: NVIDIA NVENC and Apple Metal acceleration are automatically utilized when available, but are not strictly required for local operation.

---

## 5. Storage & Database Concurrency
- **Better-SQLite3**: OpenClip uses SQLite for low-latency job and asset management. SQLite is optimal for single-node and containerized deployments. For multi-node distributed deployments with hundreds of concurrent video writers, external relational storage is recommended.
- **Large Media Files**: Video chunks, wav audio, and rendered clips are persisted directly in file storage under `storage/` and indexed via SHA-256 hashes rather than stored as BLOBs inside SQLite.
