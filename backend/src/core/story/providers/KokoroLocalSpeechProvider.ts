import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SpeechSynthesisProvider } from '../../contracts';
import { FFMPEG_PATH } from '../../../config';
import { Logger } from '../../../utils/Logger';

export class KokoroLocalSpeechProvider implements SpeechSynthesisProvider {
  public id = 'kokoro-local';
  public name = 'Kokoro-82M Offline Neural TTS (Apple Silicon / ONNX)';
  public version = '1.0.0';

  private pythonBin: string;
  private sidecarScript: string;
  private modelDir: string;
  private ffmpegBin: string;
  private sidecarProcess: ChildProcess | null = null;
  private pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private stdoutBuffer = '';

  constructor() {
    const rootDir = process.cwd().endsWith('backend') ? path.resolve(process.cwd(), '..') : process.cwd();
    this.pythonBin = path.join(rootDir, 'backend/python-engine/.venv/bin/python');
    this.sidecarScript = path.join(rootDir, 'backend/python-engine/kokoro_sidecar.py');
    this.modelDir = path.join(rootDir, 'backend/storage/models/kokoro');
    this.ffmpegBin = FFMPEG_PATH || (fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');
  }

  public async isAvailable(): Promise<boolean> {
    const onnxPath = path.join(this.modelDir, 'kokoro-v0_19.onnx');
    const voicesPath = path.join(this.modelDir, 'voices.bin');
    const pyExists = fs.existsSync(this.pythonBin);
    const weightsExist = fs.existsSync(onnxPath) && fs.existsSync(voicesPath) && fs.statSync(onnxPath).size > 1000000;
    return Boolean(pyExists && weightsExist);
  }

  private ensureSidecar(): Promise<boolean> {
    if (this.sidecarProcess && !this.sidecarProcess.killed && this.sidecarProcess.exitCode === null) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      try {
        this.sidecarProcess = spawn(this.pythonBin, [this.sidecarScript], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONUNBUFFERED: '1' },
        });

        this.sidecarProcess.stdout?.on('data', (chunk) => {
          this.stdoutBuffer += chunk.toString();
          const lines = this.stdoutBuffer.split('\n');
          this.stdoutBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const res = JSON.parse(line);
              if (res.id && this.pendingRequests.has(res.id)) {
                const { resolve, reject } = this.pendingRequests.get(res.id)!;
                this.pendingRequests.delete(res.id);
                if (res.status === 'ok') resolve(res);
                else reject(new Error(res.message || 'Kokoro sidecar error'));
              }
            } catch (err) {
              Logger.warn(`[KokoroLocal] Error parsing sidecar stdout line: ${line}`);
            }
          }
        });

        this.sidecarProcess.stderr?.on('data', (data) => {
          const msg = data.toString().trim();
          if (msg.includes('Ready for requests')) {
            Logger.info(`[KokoroLocal] Sidecar started successfully`);
            resolve(true);
          } else {
            Logger.info(`[KokoroSidecar LOG] ${msg}`);
          }
        });

        this.sidecarProcess.on('exit', (code) => {
          Logger.warn(`[KokoroLocal] Sidecar exited with code ${code}`);
          this.sidecarProcess = null;
          // Reject all pending
          for (const [id, req] of this.pendingRequests.entries()) {
            req.reject(new Error(`Sidecar exited during request ${id}`));
          }
          this.pendingRequests.clear();
        });

        // Resolve after 1.5s fallback even if stderr ready message was missed
        setTimeout(() => resolve(true), 1500);
      } catch (err) {
        Logger.error(`[KokoroLocal] Failed to spawn sidecar: ${err}`);
        resolve(false);
      }
    });
  }

  public async listAvailableVoices(): Promise<Array<{ id: string; name: string; gender: string; tags: string[] }>> {
    return [
      { id: 'af_heart', name: 'Heart (US Female)', gender: 'female', tags: ['warm', 'expressive', 'relatable'] },
      { id: 'af_bella', name: 'Bella (US Female)', gender: 'female', tags: ['dynamic', 'bright', 'energetic'] },
      { id: 'af_nicole', name: 'Nicole (US Female)', gender: 'female', tags: ['clear', 'narrator', 'grounded'] },
      { id: 'am_adam', name: 'Adam (US Male)', gender: 'male', tags: ['deep', 'charismatic', 'podcast'] },
      { id: 'am_michael', name: 'Michael (US Male)', gender: 'male', tags: ['young', 'fast', 'conversational'] },
      { id: 'bf_emma', name: 'Emma (UK Female)', gender: 'female', tags: ['refined', 'storyteller', 'articulate'] },
      { id: 'bm_george', name: 'George (UK Male)', gender: 'male', tags: ['distinguished', 'warm', 'trailer'] },
      { id: 'bm_lewis', name: 'Lewis (UK Male)', gender: 'male', tags: ['crisp', 'natural', 'dialogue'] },
    ];
  }

  public async synthesizeSpeech(
    text: string,
    voiceId: string,
    vocalDirections?: string
  ): Promise<{ audioBuffer: Buffer; durationSec: number; format: string }> {
    const isAvail = await this.isAvailable();
    if (!isAvail) {
      throw new Error('[KokoroLocalSpeechProvider] Kokoro model weights missing or uninitialized. Run scripts/setup-tts.sh.');
    }

    await this.ensureSidecar();

    const tmpDir = os.tmpdir();
    const stamp = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const rawWavPath = path.join(tmpDir, `kokoro_${stamp}_raw.wav`);
    const finalWavPath = path.join(tmpDir, `kokoro_${stamp}.wav`);

    // Speed modulation from vocal directions
    let speed = 1.0;
    const dirLower = (vocalDirections || '').toLowerCase();
    if (dirLower.includes('fast') || dirLower.includes('excited') || dirLower.includes('hype')) {
      speed = 1.15;
    } else if (dirLower.includes('deadpan') || dirLower.includes('whisper')) {
      speed = 0.92;
    }

    const cleanText = text.replace(/\[.*?\]/g, '').trim();
    const reqId = `req_${stamp}`;

    return new Promise<{ audioBuffer: Buffer; durationSec: number; format: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`[KokoroLocalSpeechProvider] Synthesis timed out after 30s`));
      }, 30000);

      this.pendingRequests.set(reqId, {
        resolve: async (res) => {
          clearTimeout(timeout);
          try {
            // Apply light post-filtering if whisper or gain requested
            let afFilters: string[] = [];
            if (dirLower.includes('whisper')) {
              afFilters.push('volume=-4dB', 'lowpass=f=3600');
            } else if (dirLower.includes('excited') || dirLower.includes('hype')) {
              afFilters.push('volume=+2dB');
            }

            if (afFilters.length > 0) {
              await new Promise<void>((fResolve) => {
                const proc = spawn(this.ffmpegBin, [
                  '-y', '-loglevel', 'error',
                  '-i', rawWavPath,
                  '-af', afFilters.join(','),
                  '-ar', '48000',
                  '-ac', '1',
                  '-c:a', 'pcm_s16le',
                  finalWavPath,
                ]);
                proc.on('close', () => fResolve());
                proc.on('error', () => fResolve());
              });
            } else {
              // Standardize to 48kHz 16-bit mono
              await new Promise<void>((fResolve) => {
                const proc = spawn(this.ffmpegBin, [
                  '-y', '-loglevel', 'error',
                  '-i', rawWavPath,
                  '-ar', '48000',
                  '-ac', '1',
                  '-c:a', 'pcm_s16le',
                  finalWavPath,
                ]);
                proc.on('close', () => fResolve());
                proc.on('error', () => fResolve());
              });
            }

            const chosen = fs.existsSync(finalWavPath) ? finalWavPath : rawWavPath;
            const buffer = fs.readFileSync(chosen);
            const durationSec = Math.max(0.3, (buffer.length - 44) / (48000 * 2));

            try { if (fs.existsSync(rawWavPath)) fs.unlinkSync(rawWavPath); } catch {}
            try { if (fs.existsSync(finalWavPath)) fs.unlinkSync(finalWavPath); } catch {}

            resolve({
              audioBuffer: buffer,
              durationSec,
              format: 'wav',
            });
          } catch (e) {
            reject(e);
          }
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      const payload = JSON.stringify({
        id: reqId,
        command: 'synthesize',
        text: cleanText,
        voice: voiceId,
        speed,
        outputPath: rawWavPath,
      });

      this.sidecarProcess?.stdin?.write(payload + '\n');
    });
  }
}
