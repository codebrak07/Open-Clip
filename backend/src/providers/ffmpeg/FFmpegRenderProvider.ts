import { RenderProvider } from '../../core/contracts';
import { FFmpegService } from '../../services/FFmpegService';

export class FFmpegRenderProvider implements RenderProvider {
  id = 'ffmpeg-render-provider';
  name = 'FFmpeg Core Encoder Engine';
  version = '8.x';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async renderClip(sourceVideo: string, start: number, duration: number, filter: string, outputPath: string): Promise<void> {
    await FFmpegService.trimAndFilter(sourceVideo, start, duration, filter, outputPath);
  }
}
