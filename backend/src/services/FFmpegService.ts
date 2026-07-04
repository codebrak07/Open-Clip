import { exec, spawn } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { FFMPEG_PATH, FFPROBE_PATH } from '../config';

const execPromise = util.promisify(exec);

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
  hasAudio: boolean;
  audioSampleRate?: number;
  audioChannels?: number;
}

export class FFmpegService {
  private static ffmpegBin = FFMPEG_PATH || 'ffmpeg';
  private static ffprobeBin = FFPROBE_PATH || 'ffprobe';

  public static getFfmpegPath(): string {
    return this.ffmpegBin;
  }

  public static getFfprobePath(): string {
    return this.ffprobeBin;
  }

  public static async probe(videoPath: string): Promise<VideoMetadata> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`[FFmpegService] Video file not found: ${videoPath}`);
    }

    const cmd = `"${this.ffprobeBin}" -v error -show_entries stream=index,codec_name,codec_type,width,height,avg_frame_rate,r_frame_rate,sample_rate,channels:format=duration,bit_rate -of json "${videoPath}"`;
    const { stdout } = await execPromise(cmd);
    const parsed = JSON.parse(stdout);

    const videoStream = parsed.streams?.find((s: any) => s.codec_type === 'video');
    const audioStream = parsed.streams?.find((s: any) => s.codec_type === 'audio');

    let fps = 30;
    if (videoStream?.avg_frame_rate) {
      const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
      if (den && den > 0) fps = num / den;
    }

    const duration = parseFloat(parsed.format?.duration || '0');
    const width = videoStream?.width || 1920;
    const height = videoStream?.height || 1080;
    const codec = videoStream?.codec_name || 'unknown';
    const bitrate = parseInt(parsed.format?.bit_rate || '0', 10);

    return {
      duration,
      width,
      height,
      fps,
      codec,
      bitrate,
      hasAudio: !!audioStream,
      audioSampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate, 10) : undefined,
      audioChannels: audioStream?.channels ? parseInt(audioStream.channels, 10) : undefined,
    };
  }

  public static async runCommand(args: string[], timeoutMs = 120000): Promise<{ stdout: string; stderr: string }> {
    const escapedArgs = args.map(arg => (arg.startsWith('-') ? arg : `"${arg.replace(/"/g, '\\"')}"`));
    const command = `"${this.ffmpegBin}" -y ${escapedArgs.join(' ')}`;

    return new Promise((resolve, reject) => {
      const child = exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
        if (error) {
          return reject(new Error(`[FFmpegService] Command failed: ${command}\nError: ${error.message}\nStderr: ${stderr}`));
        }
        resolve({ stdout, stderr });
      });
    });
  }

  public static async trimAndFilter(
    inputPath: string,
    startTime: number,
    duration: number,
    filterGraph: string,
    outputPath: string
  ): Promise<void> {
    const args = [
      '-ss', startTime.toFixed(3),
      '-t', duration.toFixed(3),
      '-i', inputPath,
    ];

    if (filterGraph) {
      args.push('-vf', filterGraph);
    }

    args.push('-c:v', 'libx264', '-preset', 'superfast', '-c:a', 'aac', outputPath);
    await this.runCommand(args);
  }
}
