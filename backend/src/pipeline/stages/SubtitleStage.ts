import { PipelineStage, JobContext, StageResult } from '../StageRunner';
import { RenderEngine } from '../../services/RenderEngine';
import { TranscriptWord } from '../../services/TranscriptionService';
import path from 'path';
import { OUTPUTS_DIR } from '../../config';

export class SubtitleStage implements PipelineStage {
  name = 'SubtitleStage';

  async initialize(context: JobContext): Promise<void> {}

  async validate(context: JobContext): Promise<boolean> {
    return !!context.data.rankedClips;
  }

  async execute(context: JobContext): Promise<StageResult> {
    const rankedClips = context.data.rankedClips;
    const transcription = context.data.transcription;
    const subtitlePaths: Record<string, string> = {};

    // Collect all words
    const allWords: TranscriptWord[] = [];
    if (transcription && transcription.segments) {
      transcription.segments.forEach((seg: any) => {
        if (seg.words) {
          seg.words.forEach((w: any) => allWords.push(w));
        } else {
          const segmentWords = seg.text.split(' ');
          const duration = seg.end - seg.start;
          const wordDuration = duration / Math.max(1, segmentWords.length);
          segmentWords.forEach((word: string, wIdx: number) => {
            allWords.push({
              word,
              start: seg.start + wIdx * wordDuration,
              end: seg.start + (wIdx + 1) * wordDuration,
            });
          });
        }
      });
    }

    for (const clip of rankedClips) {
      const clipWords = allWords.filter(w => w.start >= clip.start_time && w.end <= clip.end_time);
      const srtPath = path.join(OUTPUTS_DIR, `${clip.id}.srt`);
      
      RenderEngine.generateSRT(clipWords, srtPath);
      subtitlePaths[clip.id] = srtPath;
    }

    return {
      success: true,
      stageName: this.name,
      data: { subtitlePaths },
    };
  }

  async cleanup(context: JobContext): Promise<void> {}
  async rollback(context: JobContext): Promise<void> {}
}
