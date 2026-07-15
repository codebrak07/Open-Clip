import { EventBus } from '../services/EventBus';
import { RenderEngine, AspectRatioType } from '../services/RenderEngine';

export interface RenderTask {
  id: string;
  clipId: string;
  sourceVideo: string;
  startTime: number;
  duration: number;
  subtitlesPath?: string | null;
  outputPath: string;
  subtitleStyle?: string;
  aspectRatio: string;
}

export class ResilientRenderer {
  private maxWorkers = 4;
  private activeWorkers = 0;
  private queue: RenderTask[] = [];

  public static async executeWithFallback(task: RenderTask): Promise<{ success: boolean; tierUsed: string }> {
    const attempts: Array<{ tier: string; aspect: AspectRatioType; subs: string | null }> = [
      { tier: 'ASS Subtitles (Styled)', aspect: (task.aspectRatio || '9:16') as AspectRatioType, subs: task.subtitlesPath || null },
      { tier: 'Crop & Reframe Only', aspect: (task.aspectRatio || '9:16') as AspectRatioType, subs: null },
      { tier: 'Raw Trimmed Clip', aspect: '16:9', subs: null },
    ];

    for (let i = 0; i < attempts.length; i++) {
      const { tier, aspect, subs } = attempts[i];
      try {
        EventBus.publish('RenderAttemptStarted', { jobId: task.id, clipId: task.clipId, tier, attempt: i + 1, timestamp: Date.now() });
        
        await RenderEngine.renderClip(
          task.sourceVideo,
          task.startTime,
          task.duration,
          subs,
          aspect,
          task.outputPath
        );

        EventBus.publish('RenderCompleted', { jobId: task.id, clipId: task.clipId, tierSuccess: tier, timestamp: Date.now() });

        return { success: true, tierUsed: tier };
      } catch (err: any) {
        console.warn(`Render tier failed: ${tier}, trying next tier...`, err.message);
      }
    }

    return { success: false, tierUsed: 'Failed All Tiers' };
  }

  public enqueue(task: RenderTask) {
    this.queue.push(task);
    this.processNext();
  }

  private async processNext() {
    if (this.activeWorkers >= this.maxWorkers || this.queue.length === 0) return;

    this.activeWorkers++;
    const task = this.queue.shift()!;
    
    try {
      await ResilientRenderer.executeWithFallback(task);
    } finally {
      this.activeWorkers--;
      this.processNext();
    }
  }
}
