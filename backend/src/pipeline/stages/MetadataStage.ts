import { PipelineStage, JobContext, StageResult } from '../StageRunner';
import { RenderEngine } from '../../services/RenderEngine';

export class MetadataStage implements PipelineStage {
  name = 'MetadataStage';

  async initialize(context: JobContext): Promise<void> {}

  async validate(context: JobContext): Promise<boolean> {
    return true;
  }

  async execute(context: JobContext): Promise<StageResult> {
    const duration = await RenderEngine.getVideoDuration(context.videoPath);
    return {
      success: true,
      stageName: this.name,
      data: {
        duration,
      },
    };
  }

  async cleanup(context: JobContext): Promise<void> {}
  async rollback(context: JobContext): Promise<void> {}
}
