import { PipelineStage, JobContext, StageResult } from '../StageRunner';
import { RenderEngine } from '../../services/RenderEngine';
import { OUTPUTS_DIR } from '../../config';
import path from 'path';

export class WaveformStage implements PipelineStage {
  name = 'WaveformStage';

  async initialize(context: JobContext): Promise<void> {}

  async validate(context: JobContext): Promise<boolean> {
    return true;
  }

  async execute(context: JobContext): Promise<StageResult> {
    const waveformPath = path.join(OUTPUTS_DIR, `${context.jobId}_waveform.png`);
    try {
      await RenderEngine.generateWaveform(context.videoPath, waveformPath);
      return {
        success: true,
        stageName: this.name,
        data: { waveformPath },
      };
    } catch (e: any) {
      return {
        success: true, // Non-fatal stage
        stageName: this.name,
        data: { waveformWarning: e.message },
      };
    }
  }

  async cleanup(context: JobContext): Promise<void> {}
  async rollback(context: JobContext): Promise<void> {}
}
