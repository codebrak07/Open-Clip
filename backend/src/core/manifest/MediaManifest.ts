export interface MediaManifest {
  videoId: string;
  duration: number;
  fps: number;
  resolution: { width: number; height: number };
  audioTracks: number;
  analysis: {
    transcriptCount: number;
    ocrCount: number;
    faceCount: number;
    objectCount: number;
    sceneCount: number;
    embeddingCount: number;
  };
  artifacts: string[];
  providers: string[];
  versions: Record<string, string>;
  createdAt: string;
}
