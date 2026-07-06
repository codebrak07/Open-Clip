import { PipelineStage, JobContext, StageResult } from '../StageRunner';
import { db } from '../../models/db';
import { CandidateClip } from '../../services/AIAnalysisService';

export class ClipRankingStage implements PipelineStage {
  name = 'ClipRankingStage';

  async initialize(context: JobContext): Promise<void> {}

  async validate(context: JobContext): Promise<boolean> {
    return !!context.data.candidateClips;
  }

  async execute(context: JobContext): Promise<StageResult> {
    const candidateClips: CandidateClip[] = context.data.candidateClips;

    // Persist ranked clips to database
    db.prepare('DELETE FROM clips WHERE job_id = ?').run(context.jobId);
    
    const insertClip = db.prepare(`
      INSERT INTO clips (id, job_id, start_time, end_time, score, title, hook_rationale, render_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `);

    const rankedClips = candidateClips.map((clip, idx) => {
      const clipId = `${context.jobId}_clip_${idx + 1}`;
      insertClip.run(
        clipId,
        context.jobId,
        clip.start_time,
        clip.end_time,
        clip.score,
        clip.title,
        clip.hook_rationale
      );
      return {
        id: clipId,
        ...clip,
      };
    });

    return {
      success: true,
      stageName: this.name,
      data: { rankedClips },
    };
  }

  async cleanup(context: JobContext): Promise<void> {}
  async rollback(context: JobContext): Promise<void> {}
}
