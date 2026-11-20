import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { SpeechSynthesisProvider } from '../../contracts';
import { Logger } from '../../../utils/Logger';

export interface DialogueLine {
  id: string;
  speaker: string;
  voiceId: string;
  text: string;
  vocalDirections?: string;
}

export interface SynthesizedLineResult {
  lineId: string;
  speaker: string;
  audioBuffer: Buffer;
  wavPath: string;
  durationSec: number;
}

export class OrpheusVoiceSynthesizer {
  private provider: SpeechSynthesisProvider;
  private cacheDir: string;

  constructor(provider: SpeechSynthesisProvider, cacheDir?: string) {
    this.provider = provider;
    this.cacheDir = cacheDir || path.resolve(process.cwd(), 'backend/storage/cache/story_tts');
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  /**
   * Splits dialogue text into chunks strictly <= maxChars (default 200, including direction tags).
   * Splits at sentence boundaries (. ! ?), clause boundaries (; , -), or word boundaries.
   */
  public static splitIntoChunks(text: string, directionTag?: string, maxChars = 200): string[] {
    const cleanText = text.trim();
    if (!cleanText) return [];

    const prefix = directionTag && directionTag.trim()
      ? `[${directionTag.trim().replace(/^\[|\]$/g, '')}] `
      : '';

    const effectiveLimit = maxChars - prefix.length;
    if (effectiveLimit < 20) {
      // Extremely long direction tag, shrink prefix or clamp
      return [cleanText.slice(0, maxChars)];
    }

    if (`${prefix}${cleanText}`.length <= maxChars) {
      return [`${prefix}${cleanText}`];
    }

    // Split text into sentences / clauses
    const tokens = cleanText.match(/[^.!?;\n]+[.!?;\n]+|[^.!?;\n]+$/g) || [cleanText];
    const chunks: string[] = [];
    let currentBuffer = '';

    for (const token of tokens) {
      const candidate = currentBuffer ? `${currentBuffer} ${token.trim()}` : token.trim();
      if (`${prefix}${candidate}`.length <= maxChars) {
        currentBuffer = candidate;
      } else {
        if (currentBuffer) {
          chunks.push(`${prefix}${currentBuffer}`);
          currentBuffer = '';
        }

        // Token itself exceeds effectiveLimit, split by words
        if (`${prefix}${token.trim()}`.length > maxChars) {
          const words = token.trim().split(/\s+/);
          let wordBuffer = '';
          for (const w of words) {
            const wCandidate = wordBuffer ? `${wordBuffer} ${w}` : w;
            if (`${prefix}${wCandidate}`.length <= maxChars) {
              wordBuffer = wCandidate;
            } else {
              if (wordBuffer) {
                chunks.push(`${prefix}${wordBuffer}`);
              }
              // If a single word is somehow gigantic, clamp hard
              if (`${prefix}${w}`.length > maxChars) {
                chunks.push(`${prefix}${w.slice(0, effectiveLimit)}`);
                wordBuffer = '';
              } else {
                wordBuffer = w;
              }
            }
          }
          if (wordBuffer) {
            currentBuffer = wordBuffer;
          }
        } else {
          currentBuffer = token.trim();
        }
      }
    }

    if (currentBuffer) {
      chunks.push(`${prefix}${currentBuffer}`);
    }

    return chunks;
  }

  /**
   * Generates a deterministic cache key for a given chunk.
   */
  public static getChunkHash(chunkText: string, voiceId: string): string {
    return crypto.createHash('sha256').update(`${voiceId}:${chunkText}`).digest('hex');
  }

  /**
   * Synthesizes a dialogue line by chunking <= 200 chars, synthesizing each piece,
   * and concatenating WAV audio with micro-silence spacing.
   */
  public async synthesizeLine(line: DialogueLine): Promise<SynthesizedLineResult> {
    const chunks = OrpheusVoiceSynthesizer.splitIntoChunks(line.text, line.vocalDirections, 200);
    Logger.info(`[OrpheusVoiceSynthesizer] Synthesizing line "${line.id}" across ${chunks.length} chunk(s) using voice "${line.voiceId}"`);

    const pcmBuffers: Buffer[] = [];
    let sampleRate = 24000;
    let numChannels = 1;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const hash = OrpheusVoiceSynthesizer.getChunkHash(chunk, line.voiceId);
      const cachedPath = path.join(this.cacheDir, `${hash}.wav`);

      let wavBuffer: Buffer;
      if (fs.existsSync(cachedPath)) {
        Logger.info(`[OrpheusVoiceSynthesizer] TTS Cache hit for chunk ${i + 1}/${chunks.length} (${hash.slice(0, 8)})`);
        wavBuffer = fs.readFileSync(cachedPath);
      } else {
        Logger.info(`[OrpheusVoiceSynthesizer] TTS Cache miss. Synthesizing chunk: "${chunk.slice(0, 40)}..."`);
        const res = await this.provider.synthesizeSpeech(chunk, line.voiceId);
        wavBuffer = res.audioBuffer;
        fs.writeFileSync(cachedPath, wavBuffer);
      }

      const pcmInfo = OrpheusVoiceSynthesizer.extractPcmFromWav(wavBuffer);
      pcmBuffers.push(pcmInfo.pcm);
      sampleRate = pcmInfo.sampleRate;
      numChannels = pcmInfo.numChannels;

      // Add 120ms natural inter-clause silence between chunks if multiple
      if (i < chunks.length - 1) {
        const silenceSamples = Math.floor(sampleRate * 0.12);
        pcmBuffers.push(Buffer.alloc(silenceSamples * 2 * numChannels));
      }
    }

    const mergedPcm = Buffer.concat(pcmBuffers);
    const mergedWav = OrpheusVoiceSynthesizer.createWavFile(mergedPcm, sampleRate, numChannels, 16);
    const lineHash = crypto.createHash('sha256').update(`${line.voiceId}:${line.text}:${line.vocalDirections}`).digest('hex');
    const outPath = path.join(this.cacheDir, `line_${line.id}_${lineHash.slice(0, 10)}.wav`);
    fs.writeFileSync(outPath, mergedWav);

    const totalSeconds = mergedPcm.length / (sampleRate * numChannels * 2);
    return {
      lineId: line.id,
      speaker: line.speaker,
      audioBuffer: mergedWav,
      wavPath: outPath,
      durationSec: totalSeconds,
    };
  }

  /**
   * Helper to parse RIFF WAV header and extract raw PCM bytes + format info.
   */
  public static extractPcmFromWav(wavBuffer: Buffer): { pcm: Buffer; sampleRate: number; numChannels: number } {
    if (wavBuffer.length < 44 || wavBuffer.toString('utf8', 0, 4) !== 'RIFF') {
      // If not RIFF header, treat whole buffer as raw 24kHz mono PCM
      return { pcm: wavBuffer, sampleRate: 24000, numChannels: 1 };
    }

    const numChannels = wavBuffer.readUInt16LE(22);
    const sampleRate = wavBuffer.readUInt32LE(24);

    // Find "data" chunk
    let offset = 12;
    while (offset < wavBuffer.length - 8) {
      const subChunkId = wavBuffer.toString('utf8', offset, offset + 4);
      const subChunkSize = wavBuffer.readUInt32LE(offset + 4);
      if (subChunkId === 'data') {
        const pcm = wavBuffer.subarray(offset + 8, offset + 8 + subChunkSize);
        return { pcm, sampleRate, numChannels };
      }
      offset += 8 + subChunkSize;
    }

    // Default to data starting at offset 44
    return { pcm: wavBuffer.subarray(44), sampleRate, numChannels };
  }

  /**
   * Creates a standard 44-byte RIFF/WAVE header and wraps raw PCM bytes.
   */
  public static createWavFile(pcmData: Buffer, sampleRate: number, numChannels: number, bitsPerSample = 16): Buffer {
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const header = Buffer.alloc(44);

    // RIFF chunk descriptor
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmData.length, 4);
    header.write('WAVE', 8);

    // "fmt " sub-chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // subchunk1size (16 for PCM)
    header.writeUInt16LE(1, 20); // audioFormat (1 for PCM)
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);

    // "data" sub-chunk
    header.write('data', 36);
    header.writeUInt32LE(pcmData.length, 40);

    return Buffer.concat([header, pcmData]);
  }
}
