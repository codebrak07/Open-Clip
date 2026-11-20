import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { chromium, Browser } from 'playwright';
import { getStoryOutputsDir } from '../StoryPaths';
import { FFMPEG_PATH } from '../../../config';
import { Logger } from '../../../utils/Logger';

declare const window: any;

export interface RenderJobOptions {
  storyboard: any;
  alignedBeats: any[];
  durationSec: number;
  outputPath: string;
  fps?: number;
  width?: number;
  height?: number;
  workerCount?: number;
  ffmpegPath?: string;
}

export interface RenderJobResult {
  outputPath: string;
  totalFrames: number;
  fpsRenderSpeed: number;
  elapsedMs: number;
  encoderUsed: string;
  renderedFx?: string[];
}

export class BlockWorldRenderer {
  private ffmpegBin: string;
  private hasVideoToolbox: boolean = false;

  constructor(ffmpegPath?: string) {
    this.ffmpegBin = ffmpegPath || FFMPEG_PATH || (fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');
    this.detectHardwareAcceleration();
  }

  private detectHardwareAcceleration() {
    if (process.platform === 'darwin') {
      try {
        const { spawnSync } = require('child_process');
        const probe = spawnSync(this.ffmpegBin, [
          '-f', 'lavfi',
          '-i', 'testsrc=duration=0.05:size=64x64:rate=30',
          '-c:v', 'h264_videotoolbox',
          '-f', 'null',
          '-',
        ]);
        if (probe.status === 0) {
          this.hasVideoToolbox = true;
          Logger.info('[BlockWorldRenderer] Hardware acceleration active: Apple Silicon h264_videotoolbox');
          return;
        }
      } catch {}
    }
    this.hasVideoToolbox = false;
    Logger.info('[BlockWorldRenderer] Using software encoder: libx264 (ARM NEON optimized)');
  }

  public getEncoderFlags(): { encoder: string; flags: string[] } {
    if (this.hasVideoToolbox) {
      return {
        encoder: 'h264_videotoolbox',
        flags: ['-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-b:v', '6500k', '-pix_fmt', 'yuv420p'],
      };
    }
    return {
      encoder: 'libx264',
      flags: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'],
    };
  }

  public async renderVideo(options: RenderJobOptions): Promise<RenderJobResult> {
    const fps = options.fps || 30;
    const width = options.width || 1080;
    const height = options.height || 1920;
    const duration = Math.max(0.1, options.durationSec);
    const totalFrames = Math.floor(duration * fps);
    const numWorkers = Math.max(1, Math.min(options.workerCount || Math.floor(os.cpus().length / 2) || 2, 4));

    Logger.info(
      `[BlockWorldRenderer] Launching BlockWorld render: ${totalFrames} frames (${duration.toFixed(1)}s @ ${fps}fps) across ${numWorkers} worker(s)`
    );

    const startTime = Date.now();
    const encoderConfig = this.getEncoderFlags();
    const htmlPath = path.resolve(__dirname, 'blockworld_scene.html');

    // Launch single browser instance with multiple contexts/pages
    const chromePath = fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined;

    const browser: Browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        '--allow-file-access-from-files',
        '--disable-web-security',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu-vsync',
        '--use-gl=angle',
        '--use-angle=metal',
      ],
    });

    const tempDir = path.resolve(getStoryOutputsDir(), '.render_tmp_' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      const segmentPaths: string[] = [];
      const framesPerWorker = Math.ceil(totalFrames / numWorkers);

      const workerPromises: Promise<{ segPath: string; renderedFx: string[] }>[] = [];

      for (let w = 0; w < numWorkers; w++) {
        const startFrame = w * framesPerWorker;
        const endFrame = Math.min(totalFrames, (w + 1) * framesPerWorker);
        if (startFrame >= totalFrames) break;

        const segPath = path.join(tempDir, `seg_${w}.mp4`);
        segmentPaths.push(segPath);

        const workerPromise = (async () => {
          const page = await browser.newPage({
            viewport: { width, height },
            deviceScaleFactor: 1,
          });

          page.on('console', msg => Logger.info(`[Renderer Browser] ${msg.text()}`));
          page.on('pageerror', err => Logger.error(`[Renderer Browser Error] ${err.message}`, err));

          // Navigate to local scene HTML
          await page.goto(`file://${htmlPath}`);
          await page.waitForFunction(() => (window as any).initScene !== undefined);

          // Initialize scene with storyboard
          const sceneInitData = {
            scene: options.storyboard.scenes?.[0] || {},
            characters: options.storyboard.characters || [],
            alignedBeats: options.alignedBeats || [],
          };
          await page.evaluate(data => (window as any).initScene(data), sceneInitData);

          // Spawn FFmpeg pipe consumer
          const ffmpegArgs = [
            '-y',
            '-loglevel', 'error',
            '-f', 'image2pipe',
            '-vcodec', 'mjpeg',
            '-r', `${fps}`,
            '-i', 'pipe:0',
            ...encoderConfig.flags,
            segPath,
          ];

          const ffmpegProc = spawn(this.ffmpegBin, ffmpegArgs);
          let ffmpegErr = '';
          ffmpegProc.stderr.on('data', chunk => {
            ffmpegErr += chunk.toString();
          });

          const ffmpegClosePromise = new Promise<void>((resolve, reject) => {
            ffmpegProc.on('close', code => {
              if (code === 0 && fs.existsSync(segPath)) {
                resolve();
              } else {
                reject(new Error(`[BlockWorldRenderer] Worker ${w} FFmpeg failed (${code}): ${ffmpegErr}`));
              }
            });
            ffmpegProc.on('error', err => reject(err));
          });

          for (let f = startFrame; f < endFrame; f++) {
            const t = f / fps;
            await page.evaluate(tSec => (window as any).renderAt(tSec), t);
            const frameJpg = await page.screenshot({ type: 'jpeg', quality: 90 });
            ffmpegProc.stdin.write(frameJpg);
          }

          ffmpegProc.stdin.end();
          await ffmpegClosePromise;

          let workerRenderedFx: string[] = [];
          try {
            workerRenderedFx = await page.evaluate(() => (window as any).__RENDERED_FX__ || []);
          } catch {}

          await page.close();
          return { segPath, renderedFx: workerRenderedFx };
        })();

        workerPromises.push(workerPromise);
      }

      const results = await Promise.all(workerPromises);
      const allRenderedFx = Array.from(new Set(results.flatMap(r => r.renderedFx || [])));

      // Concatenate segments
      if (segmentPaths.length === 1) {
        fs.renameSync(segmentPaths[0], options.outputPath);
      } else {
        const concatListPath = path.join(tempDir, 'concat.txt');
        const listContent = segmentPaths.map(p => `file '${p}'`).join('\n');
        fs.writeFileSync(concatListPath, listContent, 'utf-8');

        await new Promise<void>((resolve, reject) => {
          const concatProc = spawn(this.ffmpegBin, [
            '-y',
            '-loglevel', 'error',
            '-f', 'concat',
            '-safe', '0',
            '-i', concatListPath,
            '-c', 'copy',
            options.outputPath,
          ]);

          concatProc.on('close', code => {
            if (code === 0 && fs.existsSync(options.outputPath)) {
              resolve();
            } else {
              reject(new Error(`[BlockWorldRenderer] Concat failed with code ${code}`));
            }
          });
          concatProc.on('error', err => reject(err));
        });
      }

      const elapsedMs = Date.now() - startTime;
      const fpsSpeed = Number(((totalFrames / (elapsedMs / 1000))).toFixed(1));

      Logger.info(
        `[BlockWorldRenderer] Render finished: ${totalFrames} frames in ${(elapsedMs / 1000).toFixed(1)}s (${fpsSpeed} fps) using ${encoderConfig.encoder}`
      );

      return {
        outputPath: options.outputPath,
        totalFrames,
        fpsRenderSpeed: fpsSpeed,
        elapsedMs,
        encoderUsed: encoderConfig.encoder,
        renderedFx: allRenderedFx,
      };
    } finally {
      await browser.close();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  }
}
