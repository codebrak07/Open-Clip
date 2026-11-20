import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { FFMPEG_PATH } from '../../../config';
import { Logger } from '../../../utils/Logger';

export interface SfxMixItem {
  cue: string;
  filePath: string;
  startSec: number;
  gainDb?: number;
}

export interface AudioMixOptions {
  voiceoverWavPath: string;
  sfxItems: SfxMixItem[];
  bgMusicPath?: string;
  outputPath: string;
  targetDurationSec?: number;
  ffmpegPath?: string;
}

export class AudioMixEngine {
  private ffmpegPath: string;

  constructor(ffmpegPath?: string) {
    this.ffmpegPath = ffmpegPath || FFMPEG_PATH || (fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');
  }

  /**
   * Builds the FFmpeg filtergraph string for sidechain ducking (-12dB), limiter (-6dBFS), and loudnorm (-14 LUFS).
   */
  public buildFilterGraph(sfxCount: number, hasBgMusic: boolean): { filterComplex: string; inputArgs: string[] } {
    const filters: string[] = [];

    // Voiceover is input 0: split into main and sidechain trigger
    filters.push('[0:a]asplit=2[vo_main][vo_sc]');

    // SFX inputs start at index 1 up to index sfxCount
    const sfxLabels: string[] = [];
    for (let i = 0; i < sfxCount; i++) {
      sfxLabels.push(`[sfx_${i}]`);
    }

    if (sfxCount > 0) {
      if (sfxCount === 1) {
        filters.push(`${sfxLabels[0]}aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[sfx_bus]`);
      } else {
        filters.push(`${sfxLabels.join('')}amix=inputs=${sfxCount}:normalize=0:dropout_transition=0[sfx_bus]`);
      }
    }

    let bedLabel = '';
    if (hasBgMusic && sfxCount > 0) {
      const bgIdx = sfxCount + 1;
      filters.push(`[${bgIdx}:a]volume=-14dB[bg_low]`);
      filters.push(`[bg_low][sfx_bus]amix=inputs=2:normalize=0[bed]`);
      bedLabel = '[bed]';
    } else if (hasBgMusic && sfxCount === 0) {
      const bgIdx = 1;
      filters.push(`[${bgIdx}:a]volume=-14dB[bed]`);
      bedLabel = '[bed]';
    } else if (sfxCount > 0) {
      bedLabel = '[sfx_bus]';
    }

    if (bedLabel) {
      // Sidechain compress the background bed under voiceover (-12dB reduction with 50ms attack, 300ms release)
      filters.push(
        `${bedLabel}[vo_sc]sidechaincompress=threshold=0.08:ratio=4:attack=50:release=300:level_in=1[ducked_bed]`
      );
      filters.push('[vo_main][ducked_bed]amix=inputs=2:normalize=0:dropout_transition=0[mixed]');
    } else {
      filters.push('[vo_main]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[mixed]');
    }

    // Peak limiter (-6 dBFS) + streaming broadcast loudness normalization (-14 LUFS)
    filters.push('[mixed]alimiter=limit=-6dB,loudnorm=I=-14:LRA=11:TP=-1.5,aresample=48000[out_a]');

    return {
      filterComplex: filters.join(';'),
      inputArgs: [],
    };
  }

  /**
   * Executes the full audio mixdown into broadcast-ready stereo AAC / WAV.
   */
  public async mixAudio(options: AudioMixOptions): Promise<string> {
    if (!fs.existsSync(options.voiceoverWavPath)) {
      throw new Error(`[AudioMixEngine] Voiceover track missing at: ${options.voiceoverWavPath}`);
    }

    const validSfx = (options.sfxItems || []).filter(item => fs.existsSync(item.filePath));
    const hasBg = Boolean(options.bgMusicPath && fs.existsSync(options.bgMusicPath));

    const cmdArgs: string[] = ['-y', '-loglevel', 'error'];

    // Input 0: Voiceover
    cmdArgs.push('-i', options.voiceoverWavPath);

    // Inputs 1..K: SFX with adelay and volume
    validSfx.forEach((sfx, idx) => {
      const delayMs = Math.max(0, Math.round(sfx.startSec * 1000));
      const gain = sfx.gainDb ?? 0;
      cmdArgs.push('-i', sfx.filePath);
    });

    // Optional Background music
    if (hasBg && options.bgMusicPath) {
      cmdArgs.push('-stream_loop', '-1', '-i', options.bgMusicPath);
    }

    // Build filter complex
    const filterParts: string[] = [];

    validSfx.forEach((sfx, idx) => {
      const inputIdx = idx + 1;
      const delayMs = Math.max(0, Math.round(sfx.startSec * 1000));
      const gain = sfx.gainDb ?? 0;
      filterParts.push(
        `[${inputIdx}:a]adelay=${delayMs}|${delayMs},volume=${gain}dB,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[sfx_${idx}]`
      );
    });

    const sfxLabels = validSfx.map((_, i) => `[sfx_${i}]`);
    if (validSfx.length > 0) {
      if (validSfx.length === 1) {
        filterParts.push(`${sfxLabels[0]}aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[sfx_bus]`);
      } else {
        filterParts.push(`${sfxLabels.join('')}amix=inputs=${validSfx.length}:normalize=0:dropout_transition=0[sfx_bus]`);
      }
    }

    let bedLabel = '';
    if (hasBg && validSfx.length > 0) {
      const bgIdx = validSfx.length + 1;
      filterParts.push(`[${bgIdx}:a]volume=-14dB,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[bg_low]`);
      filterParts.push(`[bg_low][sfx_bus]amix=inputs=2:normalize=0[bed]`);
      bedLabel = '[bed]';
    } else if (hasBg && validSfx.length === 0) {
      const bgIdx = 1;
      filterParts.push(`[${bgIdx}:a]volume=-14dB,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[bed]`);
      bedLabel = '[bed]';
    } else if (validSfx.length > 0) {
      bedLabel = '[sfx_bus]';
    }

    if (bedLabel) {
      filterParts.unshift('[0:a]asplit=2[vo_main][vo_sc]');
      filterParts.push(
        `${bedLabel}[vo_sc]sidechaincompress=threshold=0.08:ratio=4:attack=50:release=300:level_in=1[ducked_bed]`
      );
      filterParts.push('[vo_main][ducked_bed]amix=inputs=2:normalize=0:dropout_transition=0[mixed]');
    } else {
      filterParts.push('[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[mixed]');
    }

    filterParts.push('[mixed]alimiter=limit=-6dB,loudnorm=I=-14:LRA=11:TP=-1.5,aresample=48000[out_a]');

    cmdArgs.push('-filter_complex', filterParts.join(';'));
    cmdArgs.push('-map', '[out_a]');

    if (options.targetDurationSec) {
      cmdArgs.push('-t', options.targetDurationSec.toFixed(3));
    } else {
      cmdArgs.push('-shortest');
    }

    // 48kHz 16-bit stereo AAC or WAV
    if (options.outputPath.endsWith('.wav')) {
      cmdArgs.push('-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2');
    } else {
      cmdArgs.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2');
    }
    cmdArgs.push(options.outputPath);

    Logger.info(`[AudioMixEngine] Spawning FFmpeg mixdown -> ${options.outputPath}`);

    return new Promise((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, cmdArgs);
      let stderr = '';
      proc.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });

      proc.on('close', code => {
        if (code === 0 && fs.existsSync(options.outputPath)) {
          Logger.info(`[AudioMixEngine] Audio mix successful (${fs.statSync(options.outputPath).size} bytes)`);
          resolve(options.outputPath);
        } else {
          reject(new Error(`[AudioMixEngine] FFmpeg audio mix failed (code ${code}): ${stderr.slice(-400)}`));
        }
      });

      proc.on('error', err => reject(err));
    });
  }
}
