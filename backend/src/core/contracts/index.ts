export interface BaseProvider {
  id: string;
  name: string;
  version: string;
  isAvailable: () => Promise<boolean>;
}

export interface SpeechProvider extends BaseProvider {
  transcribe: (audioPath: string) => Promise<{ text: string; segments: Array<{ start: number; end: number; text: string }> }>;
}

export interface VisionProvider extends BaseProvider {
  detectFaces: (videoPath: string) => Promise<Array<{ timestamp: number; faceCount: number; faceCenter?: { x: number; y: number } }>>;
  detectScenes: (videoPath: string) => Promise<Array<{ start: number; end: number }>>;
}

export interface OCRProvider extends BaseProvider {
  extractText: (imageOrVideoPath: string) => Promise<Array<{ timestamp: number; text: string; confidence: number }>>;
}

export interface EmbeddingProvider extends BaseProvider {
  generateEmbedding: (text: string) => Promise<number[]>;
}

export interface ReasoningProvider extends BaseProvider {
  analyzeContext: (prompt: string, context: any) => Promise<{ summary: string; insights: string[] }>;
}

export interface RenderProvider extends BaseProvider {
  renderClip: (sourceVideo: string, start: number, duration: number, filter: string, outputPath: string) => Promise<void>;
}

export interface ScoringProvider extends BaseProvider {
  scoreCandidate: (timelineData: any) => Promise<{ score: number; breakdown: Record<string, number>; explanations: string[] }>;
}

export interface ScriptPrompt {
  idea: string;
  durationSec?: number;
  tone?: 'humorous' | 'dramatic' | 'suspenseful' | 'hype' | 'educational';
  characterCount?: number;
  seed?: number;
}

export interface ScriptBeat {
  id: string;
  speaker: string;
  text: string;
  vocalDirections?: string;
  shotType?: string;
  action?: string;
  notes?: string;
}

export interface ScriptResult {
  title: string;
  logline: string;
  durationTargetSec: number;
  tone: string;
  characters: Array<{ id: string; name: string; role: 'narrator' | 'character'; description: string }>;
  beats: ScriptBeat[];
  criticScore?: number;
  criticFeedback?: string;
}

export interface ScriptLLMProvider extends BaseProvider {
  generateScript: (prompt: ScriptPrompt) => Promise<ScriptResult>;
  critiqueScript: (script: ScriptResult) => Promise<ScriptResult>;
  generateStoryboard: (script: ScriptResult, catalog: any) => Promise<any>;
  repairStoryboard: (invalidJson: string, errors: string[], catalog: any) => Promise<any>;
}

export interface SpeechSynthesisProvider extends BaseProvider {
  synthesizeSpeech: (
    text: string,
    voiceId: string,
    vocalDirections?: string
  ) => Promise<{ audioBuffer: Buffer; durationSec: number; format: string }>;
  listAvailableVoices: () => Promise<Array<{ id: string; name: string; gender: string; tags: string[] }>>;
}

export interface ImageGenProvider extends BaseProvider {
  generateImage: (prompt: string, options?: { width: number; height: number }) => Promise<Buffer>;
}

