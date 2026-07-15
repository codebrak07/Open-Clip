import { TimelineParser } from './TimelineParser';
import { CropEngine } from './CropEngine';
import { SubtitleEngine } from './SubtitleEngine';
import { Encoder } from './Encoder';
import { UniversalTimeline } from '../pipeline/stages/TimelineStage';

export class ModularRenderer {
  static async renderFromTimeline(
    timeline: UniversalTimeline,
    srtPath: string | null,
    outputPath: string
  ): Promise<void> {
    const videoTrack = timeline.tracks.video[0];
    const startTime = videoTrack.startTime;
    const duration = videoTrack.endTime - videoTrack.startTime;

    const filters: string[] = [];

    const cropFilter = CropEngine.getFFmpegCropFilter(videoTrack.crop);
    if (cropFilter) filters.push(cropFilter);

    const subFilter = SubtitleEngine.getFFmpegSubtitleFilter(srtPath);
    if (subFilter) filters.push(subFilter);

    const filterString = filters.join(',');

    await Encoder.encode(
      timeline.sourceVideo,
      startTime,
      duration,
      filterString,
      outputPath
    );
  }
}
