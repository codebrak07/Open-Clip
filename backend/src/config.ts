import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

export const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5001;
export const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
export const GROQ_API_KEYS = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_FALLBACK_1,
  process.env.GROQ_API_KEY_FALLBACK_2,
].filter(Boolean) as string[];
export const FFMPEG_PATH = process.env.FFMPEG_PATH || '';

export const FFPROBE_PATH = process.env.FFPROBE_PATH || '';
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
