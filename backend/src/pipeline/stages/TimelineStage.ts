import { PipelineStage, JobContext, StageResult } from '../StageRunner';
import { db } from '../../models/db';

export interface UniversalTimeline {
  version: string;
  jobId: string;
  sourceVideo: string;
  tracks: {
    video: {
      startTime: number;
      endTime: number;
      crop: '9_16' | '16_9' | 'none';
      zoomKeyframes: Array<{ time: number; scale: number }>;
    }[];
    audio: {
      volume: number;
      normalize: boolean;
    }[];
    captions: {
      text: string;
      startTime: number;
      endTime: number;
    }[];
  };
  metadata: {
    title: string;
    score: number;
  };
}

export class TimelineStage implements PipelineStage {
  name = 'TimelineStage';

  async initialize(context: JobContext): Promise<void> {}

  async validate(context: JobContext): Promise<boolean> {
    return !!context.data.rankedClips;
  }

  async execute(context: JobContext): Promise<StageResult> {
    const rankedClips = context.data.rankedClips;
    const timelines: Record<string, UniversalTimeline> = {};

    for (const clip of rankedClips) {
      const timelineObj: UniversalTimeline = {
        version: '1.0.0',
        jobId: context.jobId,
        sourceVideo: context.videoPath,
        tracks: {
          video: [
            {
              startTime: clip.start_time,
              endTime: clip.end_time,
              crop: '9_16', // Default vertical short aspect ratio
              zoomKeyframes: [
                { time: 0, scale: 1.0 },
                { time: 2.0, scale: 1.05 }, // Dynamic micro-zoom hook
              ],
            },
          ],
          audio: [
            {
              volume: 1.0,
              normalize: true,
            },
          ],
          captions: [],
        },
        metadata: {
          title: clip.title,
          score: clip.score,
        },
      };

      timelines[clip.id] = timelineObj;

      // Store timeline in DB
      db.prepare(`
        INSERT OR REPLACE INTO timeline (id, job_id, timeline_json, created_at)
        VALUES (?, ?, ?, ?)
      `).run(clip.id, context.jobId, JSON.stringify(timelineObj), Date.now());
    }

    return {
      success: true,
      stageName: this.name,
      data: { timelines },
    };
  }

  async cleanup(context: JobContext): Promise<void> {}
  async rollback(context: JobContext): Promise<void> {}
}
