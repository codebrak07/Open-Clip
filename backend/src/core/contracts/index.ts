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
