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
    seo_json TEXT,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
  );

  CREATE TABLE IF NOT EXISTS football_matches (
    id TEXT PRIMARY KEY,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    competition TEXT,
    match_date TEXT,
    scoreline TEXT,
    source_url TEXT,
    status TEXT NOT NULL,
    verified INTEGER DEFAULT 0,
    metadata_json TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS match_events (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    minute INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    player_name TEXT,
    description TEXT,
    timestamp_video REAL,
    confidence REAL DEFAULT 1.0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(match_id) REFERENCES football_matches(id)
  );

  CREATE TABLE IF NOT EXISTS commentary_scripts (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    language TEXT NOT NULL,
    style TEXT NOT NULL,
    hook TEXT,
    segments_json TEXT NOT NULL,
    audio_path TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(match_id) REFERENCES football_matches(id)
  );

  CREATE TABLE IF NOT EXISTS publishing_packages (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    primary_title TEXT NOT NULL,
    alternative_titles_json TEXT,
    description TEXT,
    primary_keyword TEXT,
    seo_keywords_json TEXT,
    tags_json TEXT,
    hashtags_json TEXT,
    thumbnail_url TEXT,
    thumbnail_type TEXT,
    platform_recommendation TEXT,
    aspect_ratio TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS provider_configs (
    provider_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    default_model TEXT NOT NULL,
    api_key_encrypted TEXT,
    api_base TEXT,
    usage_count INTEGER DEFAULT 0,
    last_latency_ms INTEGER DEFAULT 0,
    status TEXT DEFAULT 'unknown',
    updated_at INTEGER NOT NULL
  );
`);

// Safe additive migration for existing SQLite databases
try {
  const cols = db.prepare("PRAGMA table_info('clips')").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'seo_json')) {
    db.exec('ALTER TABLE clips ADD COLUMN seo_json TEXT');
  }
} catch {
  // Ignore if already migrated
}

export interface FootballMatch {
  id: string;
  home_team: string;
  away_team: string;
  competition?: string;
  match_date?: string;
  scoreline?: string;
  source_url?: string;
  status: 'pending' | 'resolved' | 'failed';
  verified: number;
  metadata_json?: string;
  created_at: number;
}

export interface MatchEvent {
  id: string;
  match_id: string;
  minute: number;
  event_type: 'goal' | 'assist' | 'card' | 'save' | 'substitution' | 'attack' | 'tactical';
  player_name?: string;
  description?: string;
  timestamp_video?: number;
  confidence?: number;
  created_at: number;
}

export interface CommentaryScript {
  id: string;
  match_id: string;
  language: string;
  style: string;
  hook?: string;
  segments_json: string;
  audio_path?: string;
  created_at: number;
}

export interface PublishingPackage {
  id: string;
  target_id: string;
  target_type: 'clip' | 'football';
  primary_title: string;
  alternative_titles_json: string;
  description?: string;
  primary_keyword?: string;
  seo_keywords_json: string;
  tags_json: string;
  hashtags_json: string;
  thumbnail_url?: string;
  thumbnail_type?: 'ai' | 'frame';
  platform_recommendation?: string;
  aspect_ratio?: string;
  created_at: number;
}

export interface ProviderConfig {
  provider_id: string;
  name: string;
  is_active: number;
  default_model: string;
  api_key_encrypted?: string;
  api_base?: string;
  usage_count: number;
  last_latency_ms: number;
  status: string;
  updated_at: number;
}

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
  seo_json?: string | null;
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

