import Database from 'better-sqlite3';
import path from 'path';
import { DATABASE_PATH } from '../config';

const dbPath = path.isAbsolute(DATABASE_PATH)
  ? DATABASE_PATH
  : path.resolve(__dirname, '../..', DATABASE_PATH);

export const db = new Database(dbPath);

// Initialize Extended Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    current_stage TEXT NOT NULL,
    video_path TEXT,
    duration REAL,
    metadata TEXT,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS job_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    message TEXT NOT NULL,
    level TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
  );

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    type TEXT NOT NULL,
    path TEXT NOT NULL,
    mime_type TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
  );

  CREATE TABLE IF NOT EXISTS timeline (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    timeline_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
  );

  CREATE TABLE IF NOT EXISTS transcript (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    text TEXT NOT NULL,
    segments_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
  );

  CREATE TABLE IF NOT EXISTS semantic_chunks (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    metadata_json TEXT,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
  );

  CREATE TABLE IF NOT EXISTS captions (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    subtitle_format TEXT NOT NULL,
    content TEXT NOT NULL,
    file_path TEXT,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
  );

  CREATE TABLE IF NOT EXISTS scene_data (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    scene_index INTEGER NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    confidence REAL,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
  );

  CREATE TABLE IF NOT EXISTS frame_data (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    timestamp REAL NOT NULL,
    faces_json TEXT,
    motion_json TEXT,
    cuts_json TEXT,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
  );

  CREATE TABLE IF NOT EXISTS audio_data (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    silence_segments_json TEXT,
    energy_levels_json TEXT,
    speaking_speed REAL,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
  );

  CREATE TABLE IF NOT EXISTS analysis_cache (
    hash TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS render_cache (
    hash TEXT PRIMARY KEY,
    timeline_hash TEXT NOT NULL,
    output_path TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS provider_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    token_count INTEGER,
    latency_ms INTEGER,
    status TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    score INTEGER,
    title TEXT,
    hook_rationale TEXT,
    render_status TEXT,
    output_path TEXT,
    subtitles_path TEXT,
    timeline_path TEXT,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
  );
`);

export interface Job {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  current_stage: string;
  video_path: string | null;
  duration: number | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

export interface JobLog {
  id: number;
  job_id: string;
  stage: string;
  message: string;
  level: 'info' | 'warn' | 'error';
  timestamp: number;
}

export interface Clip {
  id: string;
  job_id: string;
  start_time: number;
  end_time: number;
  score: number;
  title: string;
  hook_rationale: string;
  render_status?: string;
  output_path?: string | null;
  subtitles_path?: string | null;
  timeline_path?: string | null;
}

export interface SemanticChunk {
  id: string;
  job_id: string;
  chunk_index: number;
  text: string;
  start_time: number;
  end_time: number;
  metadata_json?: string;
}

