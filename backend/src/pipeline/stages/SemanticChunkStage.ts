import { PipelineStage, JobContext, StageResult } from '../StageRunner';
import { TranscriptionResult } from '../../services/TranscriptionService';

export interface SemanticChunk {
  chunkIndex: number;
  text: string;
  startTime: number;
  endTime: number;
}

export class SemanticChunkStage implements PipelineStage {
  name = 'SemanticChunkStage';

  async initialize(context: JobContext): Promise<void> {}

  async validate(context: JobContext): Promise<boolean> {
    return !!context.data.transcription;
  }

  async execute(context: JobContext): Promise<StageResult> {
    const transcription: TranscriptionResult = context.data.transcription;
    const segments = transcription.segments || [];

    const semanticChunks: SemanticChunk[] = [];
    let currentChunkText = '';
    let currentStart = segments[0]?.start || 0;
    let currentEnd = currentStart;
    let chunkIdx = 0;

    for (const seg of segments) {
      currentChunkText += ' ' + seg.text.trim();
      currentEnd = seg.end;

      // Group into ~30 second chunks or when text length exceeds 400 chars
      if (currentEnd - currentStart >= 30 || currentChunkText.length >= 400) {
        semanticChunks.push({
          chunkIndex: chunkIdx++,
          text: currentChunkText.trim(),
          startTime: currentStart,
          endTime: currentEnd,
        });
        currentChunkText = '';
        currentStart = seg.end;
      }
    }

    if (currentChunkText.trim()) {
      semanticChunks.push({
        chunkIndex: chunkIdx,
        text: currentChunkText.trim(),
        startTime: currentStart,
        endTime: currentEnd,
      });
    }

    return {
      success: true,
      stageName: this.name,
      data: { semanticChunks },
    };
  }

  async cleanup(context: JobContext): Promise<void> {}
  async rollback(context: JobContext): Promise<void> {}
}
