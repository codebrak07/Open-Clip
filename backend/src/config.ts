import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Look for .env in backend directory, process root, or parent directory
const envPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), 'backend/.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../.env'),
];

for (const p of envPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}
dotenv.config(); // fallback default

export const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5001;
export const SECRET_KEY = process.env.SECRET_KEY || 'openclip-production-secret-key-2026';

// Dynamic Environment Reload Helper
export function reloadEnv(): void {
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p, override: true });
    }
  }
}

// AI Provider API Keys with dynamic reload resilience
export function getNvidiaApiKey(): string {
  if (!process.env.NVIDIA_API_KEY) reloadEnv();
  return process.env.NVIDIA_API_KEY || NVIDIA_API_KEY || '';
}

export function getGroqApiKey(): string {
  if (!process.env.GROQ_API_KEY) reloadEnv();
  return process.env.GROQ_API_KEY || GROQ_API_KEY || '';
}

export function getGeminiApiKey(): string {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) reloadEnv();
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || GEMINI_API_KEY || GOOGLE_API_KEY || '';
}

export function getOpenRouterApiKey(): string {
  if (!process.env.OPENROUTER_API_KEY) reloadEnv();
  return process.env.OPENROUTER_API_KEY || OPENROUTER_API_KEY || '';
}

export const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
export const GROQ_API_KEYS = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_FALLBACK_1,
  process.env.GROQ_API_KEY_FALLBACK_2,
].filter(Boolean) as string[];

export const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '';
export const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
export const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
export const FFMPEG_PATH = process.env.FFMPEG_PATH || (fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : (fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg'));

export const FFPROBE_PATH = process.env.FFPROBE_PATH || (fs.existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : (fs.existsSync('/usr/local/bin/ffprobe') ? '/usr/local/bin/ffprobe' : 'ffprobe'));
export const PYTHON_PATH = process.env.PYTHON_PATH || 'python3';
export const DATABASE_PATH = process.env.DATABASE_PATH || 'database.sqlite';

export const WORKSPACE_DIR = path.resolve(__dirname, '..');
export const UPLOADS_DIR = path.resolve(WORKSPACE_DIR, process.env.UPLOADS_DIR || 'uploads');
export const OUTPUTS_DIR = path.resolve(WORKSPACE_DIR, process.env.OUTPUTS_DIR || 'outputs');

// Ensure directories exist
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(OUTPUTS_DIR)) {
  fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
}

// Configure FFmpeg if paths are provided
import ffmpeg from 'fluent-ffmpeg';
if (FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(FFMPEG_PATH);
}
if (FFPROBE_PATH) {
  ffmpeg.setFfprobePath(FFPROBE_PATH);
}
