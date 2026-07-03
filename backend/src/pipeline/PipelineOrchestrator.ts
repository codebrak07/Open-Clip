import { PipelineStage, JobContext, StageResult } from './StageRunner';
import { EventBus } from '../services/EventBus';
import { db } from '../models/db';

export class PipelineOrchestrator {
  private stages: PipelineStage[] = [];

  registerStage(stage: PipelineStage): this {
    this.stages.push(stage);
    return this;
  }

  getStages(): PipelineStage[] {
    return this.stages;
  }

  async run(context: JobContext, startFromStageName?: string): Promise<boolean> {
    const jobId = context.jobId;
    let startIndex = 0;

    if (startFromStageName) {
      const idx = this.stages.findIndex(s => s.name === startFromStageName);
      if (idx !== -1) {
        startIndex = idx;
      }
    }

    EventBus.publish('JobUpdated', { jobId, status: 'processing', timestamp: Date.now() });

    for (let i = startIndex; i < this.stages.length; i++) {
      const stage = this.stages[i];
      const stageName = stage.name;
      const progressPercent = Math.round(((i + 1) / this.stages.length) * 100);

      // Log & Publish stage start
      EventBus.publish('StageStarted', { jobId, stageName, timestamp: Date.now() });
      EventBus.publish('ProgressUpdated', { jobId, stageName, percentage: progressPercent, timestamp: Date.now() });

      db.prepare("UPDATE jobs SET current_stage = ?, updated_at = ? WHERE id = ?")
        .run(stageName, Date.now(), jobId);

      try {
        await stage.initialize(context);

        const isValid = await stage.validate(context);
        if (!isValid) {
          EventBus.publish('StageSkipped', { jobId, stageName, timestamp: Date.now() });
          await stage.cleanup(context);
          continue;
        }

        const result: StageResult = await stage.execute(context);
        await stage.cleanup(context);

        if (!result.success) {
          EventBus.publish('StageFailed', { jobId, stageName, error: result.error, timestamp: Date.now() });
          await stage.rollback(context);
          db.prepare("UPDATE jobs SET status = 'failed', updated_at = ? WHERE id = ?").run(Date.now(), jobId);
          return false;
        }

        // Merge stage output into job context data bag
        if (result.data) {
          context.data = { ...context.data, ...result.data };
        }

        EventBus.publish('StageCompleted', { jobId, stageName, timestamp: Date.now() });

      } catch (err: any) {
        EventBus.publish('StageFailed', { jobId, stageName, error: err.message, timestamp: Date.now() });
        try {
          await stage.rollback(context);
        } catch {}
        db.prepare("UPDATE jobs SET status = 'failed', updated_at = ? WHERE id = ?").run(Date.now(), jobId);
        return false;
      }
    }

    // Pipeline finished completely
    db.prepare("UPDATE jobs SET status = 'completed', current_stage = 'completed', updated_at = ? WHERE id = ?")
      .run(Date.now(), jobId);

    EventBus.publish('JobCompleted', { jobId, timestamp: Date.now() });
    return true;
  }
}
