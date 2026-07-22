import { PipelineStage, JobContext, StageResult } from '../StageRunner';
import { ModularRenderer } from '../../renderers/Renderer';
import { UniversalTimeline } from './TimelineStage';
import { db } from '../../models/db';
import path from 'path';
import { OUTPUTS_DIR } from '../../config';

export class RenderingStage implements PipelineStage {
  name = 'RenderingStage';

  async initialize(context: JobContext): Promise<void> {}

  async validate(context: JobContext): Promise<boolean> {
    return !!context.data.timelines;
  }

  async execute(context: JobContext): Promise<StageResult> {
    const timelines: Record<string, UniversalTimeline> = context.data.timelines;
    const subtitlePaths: Record<string, string> = context.data.subtitlePaths || {};
    const renderedClipPaths: Record<string, string> = {};

    for (const clipId of Object.keys(timelines)) {
      const timeline = timelines[clipId];
      const srtPath = subtitlePaths[clipId] || null;
      const outputPath = path.join(OUTPUTS_DIR, `${clipId}.mp4`);

      db.prepare("UPDATE clips SET render_status = 'rendering' WHERE id = ?").run(clipId);

      await ModularRenderer.renderFromTimeline(timeline, srtPath, outputPath);

      db.prepare(`
        UPDATE clips 
        SET render_status = 'completed', output_path = ?, subtitles_path = ?
        WHERE id = ?
      `).run(outputPath, srtPath, clipId);

      renderedClipPaths[clipId] = outputPath;
    }

    return {
      success: true,
      stageName: this.name,
      data: { renderedClipPaths },
    };
  }

  async cleanup(context: JobContext): Promise<void> {}
  async rollback(context: JobContext): Promise<void> {}
}
