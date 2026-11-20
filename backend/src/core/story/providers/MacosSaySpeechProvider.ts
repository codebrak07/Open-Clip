import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SpeechSynthesisProvider } from '../../contracts';
import { FFMPEG_PATH } from '../../../config';
import { Logger } from '../../../utils/Logger';

export class MacosSaySpeechProvider implements SpeechSynthesisProvider {
  public id = 'macos-say';
  public name = 'macOS Native Speech Synthesis (say)';
  public version = '1.0.0';

  private ffmpegBin: string;

  constructor() {
    this.ffmpegBin = FFMPEG_PATH || (fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');
  }

  public async isAvailable(): Promise<boolean> {
    return process.platform === 'darwin';
  }

  public async listAvailableVoices(): Promise<Array<{ id: string; name: string; gender: string; tags: string[] }>> {
    return [
      { id: 'Samantha', name: 'Samantha (US Female)', gender: 'female', tags: ['clear', 'natural', 'conversational'] },
      { id: 'Daniel', name: 'Daniel (UK Male)', gender: 'male', tags: ['authoritative', 'formal', 'narrator'] },
      { id: 'Karen', name: 'Karen (AU Female)', gender: 'female', tags: ['casual', 'friendly', 'expressive'] },
      { id: 'Fred', name: 'Fred (US Male)', gender: 'male', tags: ['quirky', 'classic', 'humorous'] },
      { id: 'Flo (English (US))', name: 'Flo (US Female)', gender: 'female', tags: ['upbeat', 'warm', 'approachable'] },
      { id: 'Eddy (English (US))', name: 'Eddy (US Male)', gender: 'male', tags: ['youthful', 'energetic', 'fast'] },
    ];
  }

  public async synthesizeSpeech(
    text: string,
    voiceId: string,
    vocalDirections?: string
  ): Promise<{ audioBuffer: Buffer; durationSec: number; format: string }> {
    const tmpDir = os.tmpdir();
    const stamp = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const aiffPath = path.join(tmpDir, `say_${stamp}.aiff`);
    const rawWavPath = path.join(tmpDir, `say_${stamp}_raw.wav`);
    const finalWavPath = path.join(tmpDir, `say_${stamp}.wav`);

    const sanitizedVoice = voiceId && voiceId.trim() ? voiceId.trim() : 'Samantha';
    const cleanText = text.replace(/\[.*?\]/g, '').trim();

    try {
      // 1. Generate speech with native macOS 'say'
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('say', ['-v', sanitizedVoice, '-o', aiffPath, cleanText]);
        let errStr = '';
        proc.stderr.on('data', d => errStr += d.toString());
        proc.on('close', code => {
          if (code === 0 && fs.existsSync(aiffPath) && fs.statSync(aiffPath).size > 1000) {
            resolve();
          } else {
            // Fallback without -v if specific voice not installed
            const fallbackProc = spawn('say', ['-o', aiffPath, cleanText]);
            fallbackProc.on('close', fCode => {
              if (fCode === 0 && fs.existsSync(aiffPath) && fs.statSync(aiffPath).size > 1000) {
                resolve();
              } else {
                reject(new Error(`[MacosSaySpeechProvider] 'say' failed (code ${code}): ${errStr}`));
              }
            });
          }
        });
        proc.on('error', err => reject(err));
      });

      // 2. Convert AIFF to 48kHz mono 16-bit WAV
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(this.ffmpegBin, [
          '-y', '-loglevel', 'error',
          '-i', aiffPath,
          '-ar', '48000',
          '-ac', '1',
          '-c:a', 'pcm_s16le',
          rawWavPath,
        ]);
        proc.on('close', code => {
          if (code === 0 && fs.existsSync(rawWavPath)) {
            resolve();
          } else {
            reject(new Error(`[MacosSaySpeechProvider] FFmpeg AIFF->WAV failed: ${code}`));
          }
        });
        proc.on('error', err => reject(err));
      });

      // 3. Apply vocal directions filter (atempo, gain, light EQ)
      let afFilters: string[] = [];
      const dirLower = (vocalDirections || '').toLowerCase();
      if (dirLower.includes('whisper')) {
        afFilters.push('volume=-4dB', 'lowpass=f=3500');
      } else if (dirLower.includes('excited') || dirLower.includes('hype')) {
        afFilters.push('atempo=1.12', 'volume=+2dB');
      } else if (dirLower.includes('deadpan')) {
        afFilters.push('atempo=0.92');
      } else if (dirLower.includes('fast')) {
        afFilters.push('atempo=1.20');
      }

      if (afFilters.length > 0) {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(this.ffmpegBin, [
            '-y', '-loglevel', 'error',
            '-i', rawWavPath,
            '-af', afFilters.join(','),
            '-ar', '48000',
            '-ac', '1',
            '-c:a', 'pcm_s16le',
            finalWavPath,
          ]);
          proc.on('close', code => {
            if (code === 0 && fs.existsSync(finalWavPath)) resolve();
            else resolve(); // Fallback to rawWavPath
          });
          proc.on('error', () => resolve());
        });
      } else {
        fs.copyFileSync(rawWavPath, finalWavPath);
      }

      const chosenPath = fs.existsSync(finalWavPath) ? finalWavPath : rawWavPath;
      const buffer = fs.readFileSync(chosenPath);
      const durationSec = Math.max(0.3, (buffer.length - 44) / (48000 * 2));

      return {
        audioBuffer: buffer,
        durationSec,
        format: 'wav',
      };
    } finally {
      try { if (fs.existsSync(aiffPath)) fs.unlinkSync(aiffPath); } catch {}
      try { if (fs.existsSync(rawWavPath)) fs.unlinkSync(rawWavPath); } catch {}
      try { if (fs.existsSync(finalWavPath)) fs.unlinkSync(finalWavPath); } catch {}
    }
  }
}
