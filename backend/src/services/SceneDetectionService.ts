import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import { FFMPEG_PATH } from '../config';

const execPromise = util.promisify(exec);

export interface SceneBoundary {
  start: number;
  end: number;
}

export class SceneDetectionService {
  /**
   * Detect scene boundaries using PySceneDetect command line if available,
   * or fallback to FFmpeg scene detection.
   */
  static async detectScenes(videoPath: string, threshold = 27.0): Promise<SceneBoundary[]> {
    try {
      // 1. Try PySceneDetect
      return await this.detectWithPySceneDetect(videoPath, threshold);
    } catch (e: any) {
      console.warn('PySceneDetect failed or is not installed. Falling back to FFmpeg-based scene detection.', e.message);
      try {
        return await this.detectWithFFmpeg(videoPath);
      } catch (ffErr: any) {
        console.warn('FFmpeg scene detection failed. Using fixed-interval scene segmentation.', ffErr.message);
        return this.generateFixedIntervals(videoPath);
      }
    }
  }

  private static async detectWithPySceneDetect(videoPath: string, threshold: number): Promise<SceneBoundary[]> {
    // Command: scenedetect -i video.mp4 detect-content -t threshold list-scenes
    // This outputs a CSV table of scenes.
    const outputDir = path.dirname(videoPath);
    const cmd = `scenedetect -i "${videoPath}" detect-content -t ${threshold} list-scenes -o "${outputDir}"`;
    await execPromise(cmd);

    const baseName = path.basename(videoPath, path.extname(videoPath));
    const csvPath = path.join(outputDir, `${baseName}-Scenes.csv`);

    if (!fs.existsSync(csvPath)) {
      throw new Error(`PySceneDetect CSV output file not found at ${csvPath}`);
    }

    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n');
    const boundaries: SceneBoundary[] = [];

    // Parse CSV: Lines starting from index 5 contain: Scene Number, Start Frame, Start Time, End Frame, End Time, etc.
    let startParsing = false;
    for (const line of lines) {
      if (line.startsWith('Scene Number')) {
        startParsing = true;
        continue;
      }
      if (startParsing && line.trim()) {
        const parts = line.split(',');
        if (parts.length >= 5) {
          // Parse timestamps format: hh:mm:ss.nnn or seconds float
          const startSec = this.parseTime(parts[2]);
          const endSec = this.parseTime(parts[4]);
          boundaries.push({ start: startSec, end: endSec });
        }
      }
    }

    // Clean up CSV
    fs.unlinkSync(csvPath);

    return boundaries;
  }

  private static async detectWithFFmpeg(videoPath: string, sceneThreshold = 0.4): Promise<SceneBoundary[]> {
    // Use ffmpeg filter to detect scene changes:
    // ffmpeg -i video.mp4 -filter_complex "select='gt(scene,0.4)',metadata=print:file=-" -f null -
    // This outputs lines containing "max_pts_time: 12.34" or "pts_time:12.34"
    const ffmpegBin = FFMPEG_PATH || 'ffmpeg';
    const cmd = `"${ffmpegBin}" -i "${videoPath}" -filter_complex "select='gt(scene,${sceneThreshold})',metadata=print" -f null -`;
    const { stderr } = await execPromise(cmd);

    const boundaries: SceneBoundary[] = [];
    const regex = /pts_time:([0-9.]+)/g;
    let match;
    const sceneTimes: number[] = [0];

    while ((match = regex.exec(stderr)) !== null) {
      const time = parseFloat(match[1]);
      if (!sceneTimes.includes(time)) {
        sceneTimes.push(time);
      }
    }

    // Sort times and build boundaries
    sceneTimes.sort((a, b) => a - b);
    
    // Add end boundary if missing, we'll fetch duration from video inside QueueManager, but let's assume
    // we just construct intervals between cuts
    for (let i = 0; i < sceneTimes.length - 1; i++) {
      boundaries.push({
        start: sceneTimes[i],
        end: sceneTimes[i + 1],
      });
    }

    return boundaries;
  }

  private static generateFixedIntervals(videoPath: string, intervalSeconds = 10.0): SceneBoundary[] {
    // Simple fallback: Split every 10 seconds.
    // If duration is unknown, we will let downstream handle truncation.
    const boundaries: SceneBoundary[] = [];
    for (let i = 0; i < 30; i++) { // Max 300 seconds for basic mock/fallback limits
      boundaries.push({
        start: i * intervalSeconds,
        end: (i + 1) * intervalSeconds,
      });
    }
    return boundaries;
  }

  private static parseTime(val: string): number {
    const clean = val.replace(/"/g, '').trim();
    if (clean.includes(':')) {
      const parts = clean.split(':');
      const hrs = parseFloat(parts[0]);
      const mins = parseFloat(parts[1]);
      const secs = parseFloat(parts[2]);
      return hrs * 3600 + mins * 60 + secs;
    }
    return parseFloat(clean);
  }
}
