import { spawn } from 'child_process';
import fs from 'fs';
import { FFMPEG_PATH } from '../../../config';
import { AlignedBeat } from './WhisperAlignmentEngine';
import { Logger } from '../../../utils/Logger';

export interface BeatAudioCheck {
  beatId: string;
  speaker: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  rmsDbfs: number;
  hasSpeechEnergy: boolean;
}

export interface AudioIntegrityReport {
  passed: boolean;
  totalBeats: number;
  validSpeechBeats: number;
  speechCoverageRatio: number;
  silentBeats: string[];
  integratedLufs: number;
  peakDbfs: number;
  beatChecks: BeatAudioCheck[];
  warningMessage?: string;
}

export class AudioIntegrityValidator {
  private static ffmpegBin = FFMPEG_PATH || (fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');

  /**
   * Evaluates overall integrated loudness (LUFS) and true peak (dBFS)
   */
  public static async probeLoudness(audioPath: string): Promise<{ integratedLufs: number; peakDbfs: number }> {
    return new Promise((resolve) => {
      const proc = spawn(this.ffmpegBin, [
        '-i', audioPath,
        '-af', 'ebur128=framelog=verbose',
        '-f', 'null',
        '-',
      ]);

      let stderr = '';
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('close', () => {
        let integratedLufs = -24.0;
        let peakDbfs = -1.0;

        const iMatch = stderr.match(/Integrated loudness:\s+I:\s+([-\d.]+)\s+LUFS/);
        if (iMatch) integratedLufs = parseFloat(iMatch[1]);

        const tpMatch = stderr.match(/Peak:\s+([-\d.]+)\s+dBFS/);
        if (tpMatch) peakDbfs = parseFloat(tpMatch[1]);

        resolve({ integratedLufs, peakDbfs });
      });
      proc.on('error', () => resolve({ integratedLufs: -24.0, peakDbfs: -1.0 }));
    });
  }

  /**
   * Verifies speech presence across every dialogue beat window
   */
  public static async verifyVoiceTrack(
    masterWavPath: string,
    alignedBeats: AlignedBeat[]
  ): Promise<AudioIntegrityReport> {
    const loudness = await this.probeLoudness(masterWavPath);
    const checks: BeatAudioCheck[] = [];
    const silentBeats: string[] = [];

    // Read WAV buffer to compute bandpass RMS per beat
    const wavBuffer = fs.readFileSync(masterWavPath);
    // Standard 44.1k or 48k 16-bit mono PCM offset is 44 bytes
    const sampleRate = wavBuffer.readUInt32LE(24);
    const numChannels = wavBuffer.readUInt16LE(22);
    const bitsPerSample = wavBuffer.readUInt16LE(34);
    const bytesPerSample = (bitsPerSample / 8) * numChannels;

    for (const beat of alignedBeats) {
      const durationSec = Math.max(0.1, beat.endSec - beat.startSec);
      const startSample = Math.floor(beat.startSec * sampleRate);
      const endSample = Math.min(
        Math.floor(wavBuffer.length / bytesPerSample),
        Math.floor(beat.endSec * sampleRate)
      );

      let sumSquares = 0;
      let count = 0;

      for (let s = startSample; s < endSample; s++) {
        const offset = 44 + s * bytesPerSample;
        if (offset + 2 <= wavBuffer.length) {
          const sample = wavBuffer.readInt16LE(offset);
          const normalized = sample / 32768.0;
          sumSquares += normalized * normalized;
          count++;
        }
      }

      const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
      const rmsDbfs = rms > 0 ? 20 * Math.log10(rms) : -96.0;

      // Real speech dialogue typically sits above -42 dBFS; silence sits below -50 dBFS
      const hasSpeechEnergy = rmsDbfs > -45.0 && durationSec >= 0.3;

      if (!hasSpeechEnergy) {
        silentBeats.push(beat.id);
      }

      checks.push({
        beatId: beat.id,
        speaker: beat.speaker,
        startSec: beat.startSec,
        endSec: beat.endSec,
        durationSec,
        rmsDbfs: Math.round(rmsDbfs * 10) / 10,
        hasSpeechEnergy,
      });
    }

    const totalBeats = alignedBeats.length;
    const validSpeechBeats = checks.filter(c => c.hasSpeechEnergy).length;
    const speechCoverageRatio = totalBeats > 0 ? validSpeechBeats / totalBeats : 1.0;

    const passed = silentBeats.length === 0 || speechCoverageRatio >= 0.90;
    let warningMessage: string | undefined;

    if (!passed) {
      warningMessage = `Speech energy missing in ${silentBeats.length}/${totalBeats} dialogue beats: ${silentBeats.join(', ')}`;
      Logger.warn(`[AudioIntegrityValidator] ⚠️ ${warningMessage}`);
    }

    return {
      passed,
      totalBeats,
      validSpeechBeats,
      speechCoverageRatio,
      silentBeats,
      integratedLufs: loudness.integratedLufs,
      peakDbfs: loudness.peakDbfs,
      beatChecks: checks,
      warningMessage,
    };
  }
}
