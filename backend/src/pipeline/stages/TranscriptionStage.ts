import { PipelineStage, JobContext, StageResult } from '../StageRunner';
import { TranscriptionService } from '../../services/TranscriptionService';

export class TranscriptionStage implements PipelineStage {
  name = 'TranscriptionStage';

  async initialize(context: JobContext): Promise<void> {}

  async validate(context: JobContext): Promise<boolean> {
    return true;
  }

  async execute(context: JobContext): Promise<StageResult> {
    const provider = context.provider || 'groq';
    const apiKey = context.apiKey;

    let transcription;
    if (provider === 'openai') {
      transcription = await TranscriptionService.transcribeWithOpenAI(context.videoPath, apiKey || '');
    } else {
      transcription = await TranscriptionService.transcribeWithGroq(context.videoPath, apiKey);
    }

    return {
      success: true,
      stageName: this.name,
      data: { transcription },
    };
  }

  async cleanup(context: JobContext): Promise<void> {}
  async rollback(context: JobContext): Promise<void> {}
}
