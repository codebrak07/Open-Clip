export type ModelCategory = 'speech' | 'vision' | 'embeddings' | 'llm';

export interface ModelDescriptor {
  id: string;
  name: string;
  category: ModelCategory;
  provider: 'whisper' | 'whisperx' | 'deepgram' | 'groq' | 'torch' | 'mediapipe' | 'tesseract' | 'sentence-transformers';
  isLocal: boolean;
  active: boolean;
}

export class ModelRegistry {
  private static models: Map<string, ModelDescriptor> = new Map();

  public static initializeDefaults() {
    this.register({ id: 'whisper-local', name: 'Whisper Local Engine', category: 'speech', provider: 'whisper', isLocal: true, active: true });
    this.register({ id: 'groq-whisper', name: 'Groq Cloud Whisper', category: 'speech', provider: 'groq', isLocal: false, active: true });
    this.register({ id: 'mediapipe-vision', name: 'MediaPipe Face/Object Vision', category: 'vision', provider: 'mediapipe', isLocal: true, active: true });
    this.register({ id: 'sentence-transformers-l6', name: 'SentenceTransformers All-MiniLM-L6', category: 'embeddings', provider: 'sentence-transformers', isLocal: true, active: true });
  }

  public static register(model: ModelDescriptor) {
    this.models.set(model.id, model);
  }

  public static getModelsByCategory(category: ModelCategory): ModelDescriptor[] {
    if (this.models.size === 0) this.initializeDefaults();
    return Array.from(this.models.values()).filter(m => m.category === category && m.active);
  }

  public static getAll(): ModelDescriptor[] {
    if (this.models.size === 0) this.initializeDefaults();
    return Array.from(this.models.values());
  }
}
