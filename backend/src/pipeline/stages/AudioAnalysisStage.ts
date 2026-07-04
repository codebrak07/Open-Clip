import { PipelineStage, JobContext, StageResult } from '../StageRunner';
import { exec } from 'child_process';
import util from 'util';
import { FFPROBE_PATH } from '../../config';

const execPromise = util.promisify(exec);

export class AudioAnalysisStage implements PipelineStage {
  name = 'AudioAnalysisStage';

  async initialize(context: JobContext): Promise<void> {}

  async validate(context: JobContext): Promise<boolean> {
    return true;
  }

  async execute(context: JobContext): Promise<StageResult> {
    let energyLevel: 'low' | 'medium' | 'high' = 'medium';
    let speakingSpeedWpm = 140;
    const silenceSegments: Array<{ start: number; end: number }> = [];

    try {
      if (context.videoPath) {
        const ffprobeBin = FFPROBE_PATH || 'ffprobe';
        const cmd = `"${ffprobeBin}" -v error -select_streams a:0 -show_entries stream=sample_rate,channels,bit_rate -of json "${context.videoPath}"`;
        const { stdout } = await execPromise(cmd);
        const parsed = JSON.parse(stdout);
        const audioStream = parsed.streams?.[0];

        if (audioStream) {
          const sampleRate = parseInt(audioStream.sample_rate || '44100', 10);
          energyLevel = sampleRate >= 48000 ? 'high' : 'medium';
          speakingSpeedWpm = sampleRate >= 44100 ? 150 : 130;
        }
      }
    } catch (e: any) {
      console.warn('[AudioAnalysisStage] Audio stream analysis warning:', e.message);
    }

    const audioMetrics = {
      silenceSegments,
      speakingSpeedWpm,
      energyLevel,
    };

    return {
      success: true,
      stageName: this.name,
      data: { audioMetrics },
    };
  }

  async cleanup(context: JobContext): Promise<void> {}
  async rollback(context: JobContext): Promise<void> {}
}
