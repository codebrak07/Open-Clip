import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import { TranscriptWord } from './TranscriptionService';

const execPromise = util.promisify(exec);

export type AspectRatioType = '9:16' | '16:9' | '1:1' | '4:5';

export class RenderEngine {
  /**
   * Retrieves video duration in seconds with fallback.
   */
  static async getVideoDuration(videoPath: string): Promise<number> {
    try {
      const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
      const { stdout } = await execPromise(cmd);
      const duration = parseFloat(stdout.trim());
      if (!isNaN(duration) && duration > 0) {
        return duration;
      }
    } catch (e: any) {
      console.warn('[RenderEngine] ffprobe failed. Using fallback estimate.', e.message);
    }
    
    try {
      const stats = fs.statSync(videoPath);
      return Math.max(10, Math.min(600, Math.round(stats.size / (1024 * 1024 * 1.5))));
    } catch {
      return 60.0;
    }
  }

  /**
   * Generates a waveform image from audio.
   */
  static async generateWaveform(videoPath: string, outputPath: string): Promise<void> {
    try {
      const cmd = `ffmpeg -y -i "${videoPath}" -filter_complex "showwavespic=s=600x120:colors=0x228B22" -frames:v 1 "${outputPath}"`;
      await execPromise(cmd);
    } catch (e: any) {
      console.warn('[RenderEngine] Waveform generation warning:', e.message);
    }
  }

  /**
   * Creates an SRT subtitle file from words list.
   */
  static generateSRT(words: TranscriptWord[], outputPath: string): void {
    let srtContent = '';
    
    const maxWordsPerFrame = 3;
    const frames: { words: TranscriptWord[]; start: number; end: number }[] = [];
    
    let currentFrame: TranscriptWord[] = [];
    for (const w of words) {
      currentFrame.push(w);
      if (currentFrame.length >= maxWordsPerFrame) {
        frames.push({
          words: currentFrame,
          start: currentFrame[0].start,
          end: currentFrame[currentFrame.length - 1].end,
        });
        currentFrame = [];
      }
    }
    if (currentFrame.length > 0) {
      frames.push({
        words: currentFrame,
        start: currentFrame[0].start,
        end: currentFrame[currentFrame.length - 1].end,
      });
    }

    frames.forEach((frame, idx) => {
      const startStr = this.formatSRTTime(frame.start);
      const endStr = this.formatSRTTime(frame.end);
      const text = frame.words.map(w => w.word).join(' ');
      
      srtContent += `${idx + 1}\n${startStr} --> ${endStr}\n${text}\n\n`;
    });

    fs.writeFileSync(outputPath, srtContent, 'utf-8');
  }

  /**
   * Multi-Platform Aspect Ratio Crop Calculator.
   */
  private static getCropFilter(cropType: AspectRatioType): string {
    switch (cropType) {
      case '9:16':
        return 'crop=ih*9/16:ih:(iw-ow)/2:0';
      case '1:1':
        return 'crop=ih:ih:(iw-ow)/2:0';
      case '4:5':
        return 'crop=ih*4/5:ih:(iw-ow)/2:0';
      case '16:9':
      default:
        return ''; // Full Frame Passthrough
    }
  }

  /**
   * 4-Pass Multi-Platform Resilient Fallback Rendering Engine.
   */
  static async renderClip(
    videoPath: string,
    startTime: number,
    duration: number,
    srtPath: string | null,
    cropType: AspectRatioType = '9:16',
    outputPath: string
  ): Promise<void> {
    const cropFilter = this.getCropFilter(cropType);

    // Attempt 1: Crop + ASS/SRT burnt subtitles
    if (srtPath && fs.existsSync(srtPath)) {
      try {
        const absSrtPath = path.resolve(srtPath).replace(/\\/g, '/').replace(/:/g, '\\:');
        const subtitleFilter = `subtitles='${absSrtPath}':force_style='Alignment=2,FontSize=18,PrimaryColour=&H00FFFF&'`;
        const filterArg = cropFilter ? `-vf "${cropFilter},${subtitleFilter}"` : `-vf "${subtitleFilter}"`;

        const cmd = `ffmpeg -y -ss ${startTime} -t ${duration} -i "${videoPath}" ${filterArg} -c:v libx264 -preset superfast -c:a aac "${outputPath}"`;
        await execPromise(cmd);
        return;
      } catch (e1: any) {
        console.warn('[RenderEngine] Attempt 1 failed:', e1.message);
      }
    }

    // Attempt 2: Simple Subtitles
    if (srtPath && fs.existsSync(srtPath)) {
      try {
        const simpleSrt = srtPath.replace(/\\/g, '/');
        const filterArg = cropFilter ? `-vf "${cropFilter},subtitles=${simpleSrt}"` : `-vf "subtitles=${simpleSrt}"`;
        const cmd = `ffmpeg -y -ss ${startTime} -t ${duration} -i "${videoPath}" ${filterArg} -c:v libx264 -preset superfast -c:a aac "${outputPath}"`;
        await execPromise(cmd);
        return;
      } catch (e2: any) {
        console.warn('[RenderEngine] Attempt 2 failed:', e2.message);
      }
    }

    // Attempt 3: Crop Only MP4
    try {
      const filterArg = cropFilter ? `-vf "${cropFilter}"` : '';
      const cmd = `ffmpeg -y -ss ${startTime} -t ${duration} -i "${videoPath}" ${filterArg} -c:v libx264 -preset superfast -c:a aac "${outputPath}"`;
      await execPromise(cmd);
      return;
    } catch (e3: any) {
      console.warn('[RenderEngine] Attempt 3 failed:', e3.message);
    }

    // Attempt 4: Passthrough Segment Cut
    try {
      const cmd = `ffmpeg -y -ss ${startTime} -t ${duration} -i "${videoPath}" -c copy "${outputPath}"`;
      await execPromise(cmd);
      return;
    } catch (e4: any) {
      try {
        fs.copyFileSync(videoPath, outputPath);
      } catch {}
    }
  }

  private static formatSRTTime(sec: number): string {
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 1000);

    const pad = (n: number, size = 2) => String(n).padStart(size, '0');
    return `${pad(hours)}:${pad(mins)}:${pad(secs)},${pad(ms, 3)}`;
  }
}
