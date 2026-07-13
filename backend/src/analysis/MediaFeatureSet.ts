export interface MediaFeatureSet {
  version: '1.0.0';
  jobId: string;
  duration: number;
  transcription: {
    text: string;
    segments: Array<{ start: number; end: number; text: string }>;
  };
  visual: {
    sceneBoundaries: Array<{ start: number; end: number }>;
    facesDetected: boolean;
    motionScore: number;
    ocrTexts: Array<{ timestamp: number; text: string }>;
  };
  audio: {
    silenceIntervals: Array<{ start: number; end: number }>;
    speakingRateWpm: number;
    energyLevel: string;
  };
  semanticChunks: Array<{
    chunkIndex: number;
    text: string;
    startTime: number;
    endTime: number;
  }>;
}

export class FeatureExtractor {
  static extract(contextData: Record<string, any>, jobId: string): MediaFeatureSet {
    const transcription = contextData.transcription || { text: '', segments: [] };
    const sceneBoundaries = contextData.sceneBoundaries || [];
    const frameData = contextData.frameData || { detectedFaces: true, motionDensity: 0.5 };
    const ocrTexts = contextData.ocrTextBlocks || [];
    const audioMetrics = contextData.audioMetrics || { silenceSegments: [], speakingSpeedWpm: 140, energyLevel: 'normal' };
    const semanticChunks = contextData.semanticChunks || [];

    return {
      version: '1.0.0',
      jobId,
      duration: contextData.duration || 0,
      transcription,
      visual: {
        sceneBoundaries,
        facesDetected: frameData.detectedFaces,
        motionScore: frameData.motionDensity,
        ocrTexts,
      },
      audio: {
        silenceIntervals: audioMetrics.silenceSegments,
        speakingRateWpm: audioMetrics.speakingSpeedWpm,
        energyLevel: audioMetrics.energyLevel,
      },
      semanticChunks,
    };
  }
}
