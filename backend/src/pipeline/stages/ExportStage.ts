import { PipelineStage, JobContext, StageResult } from '../StageRunner';
import { db } from '../../models/db';
import path from 'path';
import fs from 'fs';
import { OUTPUTS_DIR } from '../../config';

export class ExportStage implements PipelineStage {
  name = 'ExportStage';

  async initialize(context: JobContext): Promise<void> {}

  async validate(context: JobContext): Promise<boolean> {
    return true;
  }

  async execute(context: JobContext): Promise<StageResult> {
    const clips = db.prepare('SELECT * FROM clips WHERE job_id = ?').all(context.jobId);
    
    const exportMeta = {
      jobId: context.jobId,
      duration: context.data.duration,
      transcription: context.data.transcription,
      clips: clips.map((c: any) => ({
        id: c.id,
        title: c.title,
        start_time: c.start_time,
        end_time: c.end_time,
        score: c.score,
        hook_rationale: c.hook_rationale,
        video_url: `/outputs/${path.basename(c.output_path || '')}`,
        srt_url: `/outputs/${path.basename(c.subtitles_path || '')}`,
      })),
    };

    const exportJsonPath = path.join(OUTPUTS_DIR, `${context.jobId}_export.json`);
    fs.writeFileSync(exportJsonPath, JSON.stringify(exportMeta, null, 2), 'utf-8');

    return {
      success: true,
      stageName: this.name,
      data: { exportJsonPath },
    };
  }

  async cleanup(context: JobContext): Promise<void> {}
  async rollback(context: JobContext): Promise<void> {}
}
