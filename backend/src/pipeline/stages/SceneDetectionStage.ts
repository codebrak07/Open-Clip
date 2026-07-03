import { PipelineStage, JobContext, StageResult } from '../StageRunner';
import { SceneDetectionService } from '../../services/SceneDetectionService';

export class SceneDetectionStage implements PipelineStage {
  name = 'SceneDetectionStage';

  async initialize(context: JobContext): Promise<void> {}

  async validate(context: JobContext): Promise<boolean> {
    return true;
  }

  async execute(context: JobContext): Promise<StageResult> {
    const scenes = await SceneDetectionService.detectScenes(context.videoPath);
    return {
      success: true,
      stageName: this.name,
      data: { sceneBoundaries: scenes },
    };
  }

  async cleanup(context: JobContext): Promise<void> {}
  async rollback(context: JobContext): Promise<void> {}
}
