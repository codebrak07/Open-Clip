import path from 'path';
import fs from 'fs';
import { FFmpegService } from '../services/FFmpegService';
import { SmartCropEngine } from './SmartCropEngine';
import { MediaFeatureGraph } from '../analysis/MediaFeatureGraph';
import { Logger } from '../utils/Logger';

export type AspectRatioType = '9:16' | '16:9' | '1:1' | '4:5';

export interface RenderJobRequest {
  jobId: string;
  clipId: string;
  sourceVideo: string;
  startTime: number;
  duration: number;
  subtitlesPath?: string | null;
  aspectRatio: AspectRatioType;
  outputPath: string;
  mediaFeatureGraph?: MediaFeatureGraph;
}

export class ProductionRenderEngine {
  public static async executeRender(req: RenderJobRequest): Promise<{ success: boolean; outputPath: string }> {
    const startTime = Date.now();
    Logger.info(`[ProductionRenderEngine] Starting render for clip ${req.clipId}`, { jobId: req.jobId });

    if (!fs.existsSync(req.sourceVideo)) {
      throw new Error(`[ProductionRenderEngine] Source video file not found: ${req.sourceVideo}`);
    }

    const meta = await FFmpegService.probe(req.sourceVideo);

    // 1. Crop Planning
    let filterString = '';
    if (req.aspectRatio === '9:16' && meta.width > meta.height) {
      const crops = SmartCropEngine.planCropTimeline(
        req.mediaFeatureGraph || new MediaFeatureGraph(req.jobId),
        meta.width,
        meta.height,
        '9:16'
      );
      const crop = crops[0].cropBox;
      filterString = `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`;
    }

    // 2. Subtitle Formatting
    if (req.subtitlesPath && fs.existsSync(req.subtitlesPath)) {
      const escapedSrt = req.subtitlesPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      const subFilter = `subtitles='${escapedSrt}'`;
      filterString = filterString ? `${filterString},${subFilter}` : subFilter;
    }

    // 3. Execution Engine via FFmpegService
    await FFmpegService.trimAndFilter(
      req.sourceVideo,
      req.startTime,
      req.duration,
      filterString,
      req.outputPath
    );

    const durationMs = Date.now() - startTime;
    Logger.stageMetrics({
      stageName: 'ProductionRenderEngine',
      jobId: req.jobId,
      durationMs,
      cpuUsagePct: 25,
      memoryMb: 120,
      status: 'completed',
    });

    return {
      success: true,
      outputPath: req.outputPath,
    };
  }
}
