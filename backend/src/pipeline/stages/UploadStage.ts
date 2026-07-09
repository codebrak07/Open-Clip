import { PipelineStage, JobContext, StageResult } from '../StageRunner';
import fs from 'fs';

export class UploadStage implements PipelineStage {
  name = 'UploadStage';

  async initialize(context: JobContext): Promise<void> {}

  async validate(context: JobContext): Promise<boolean> {
    return !!context.videoPath && fs.existsSync(context.videoPath);
  }

  async execute(context: JobContext): Promise<StageResult> {
    const stats = fs.statSync(context.videoPath);
    return {
      success: true,
      stageName: this.name,
      data: {
        fileSize: stats.size,
        uploadedAt: stats.birthtimeMs,
      },
    };
  }

  async cleanup(context: JobContext): Promise<void> {}
  async rollback(context: JobContext): Promise<void> {}
}
