import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import { Logger } from '../../../utils/Logger';

export interface AlignedWord {
  word: string;
  start: number;
  end: number;
}

export interface AlignedBeat {
  id: string;
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
  words: AlignedWord[];
  actions: Array<{ actor: string; anim: string; expression: string; atWord: number; startSec: number }>;
  fx: Array<{ type: string; atWord: number; startSec: number; target?: string }>;
  sfx: Array<{ cue: string; atWord: number; startSec: number; gainDb?: number }>;
  shot: { type: string; target: string; move: string; startSec: number; endSec: number };
  emphasisWords: string[];
}

export class WhisperAlignmentEngine {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model = 'whisper-large-v3-turbo') {
    this.apiKey = apiKey || process.env.GROQ_API_KEY || '';
    this.model = model;
  }

  /**
   * Transcribes an audio file via Groq Whisper API to get word-level timestamps.
   */
  public async alignAudioWords(audioPath: string, lineText?: string): Promise<AlignedWord[]> {
    if (!fs.existsSync(audioPath)) {
      throw new Error(`[WhisperAlignmentEngine] Audio file not found at ${audioPath}`);
    }

    if (!this.apiKey) {
      Logger.warn('[WhisperAlignmentEngine] No GROQ_API_KEY available. Using duration-weighted word estimation.');
      return this.fallbackEstimateWords(audioPath, lineText);
    }

    try {
      const formData = new FormData();
      formData.append('file', fs.createReadStream(audioPath));
      formData.append('model', this.model);
      formData.append('response_format', 'verbose_json');
      formData.append('timestamp_granularities[]', 'word');

      const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...formData.getHeaders(),
        },
        timeout: 45000,
      });

      const words = res.data?.words || [];
      if (words.length > 0) {
        return words.map((w: any) => ({
          word: String(w.word || '').trim(),
          start: Number(w.start || 0),
          end: Number(w.end || 0),
        }));
      }
      return this.fallbackEstimateWords(audioPath, lineText);
    } catch (err: any) {
      Logger.warn(`[WhisperAlignmentEngine] Groq Whisper API call failed: ${err.message}. Using duration-weighted word estimation.`);
      return this.fallbackEstimateWords(audioPath, lineText);
    }
  }

  /**
   * Anchors storyboard beats, actions, camera movements, and SFX cues to exact word timestamps.
   */
  public mapBeatsToTimeline(
    beats: any[],
    beatWordAlignments: AlignedWord[][],
    beatDurations: number[],
    pauseSec: number = 0.15,
    introPauseSec: number = 0.0
  ): AlignedBeat[] {
    const alignedBeats: AlignedBeat[] = [];
    let currentGlobalTime = introPauseSec;

    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const rawWords = beatWordAlignments[i] || [];
      const duration = beatDurations[i] || (rawWords.length > 0 ? rawWords[rawWords.length - 1].end : 2.5);

      const beatStart = currentGlobalTime;
      const beatEnd = currentGlobalTime + duration;

      // Shift word timestamps to global timeline
      const globalWords: AlignedWord[] = rawWords.map(w => ({
        word: w.word,
        start: Number((beatStart + w.start).toFixed(3)),
        end: Number((beatStart + w.end).toFixed(3)),
      }));

      // Map actions
      const actions = (beat.actions || []).map((a: any) => {
        const atWord = Math.min(a.atWord || 0, Math.max(0, globalWords.length - 1));
        const startSec = globalWords[atWord]?.start ?? beatStart;
        return {
          actor: a.actor,
          anim: a.anim,
          expression: a.expression,
          atWord,
          startSec,
        };
      });

      // Map FX
      const fx = (beat.fx || []).map((f: any) => {
        const atWord = Math.min(f.atWord || 0, Math.max(0, globalWords.length - 1));
        const startSec = globalWords[atWord]?.start ?? beatStart;
        return {
          type: f.type,
          atWord,
          startSec,
          target: f.target,
        };
      });

      // Map SFX
      const sfx = (beat.sfx || []).map((s: any) => {
        const atWord = Math.min(s.atWord || 0, Math.max(0, globalWords.length - 1));
        const startSec = globalWords[atWord]?.start ?? beatStart;
        return {
          cue: s.cue,
          atWord,
          startSec,
          gainDb: s.gainDb ?? 0,
        };
      });

      alignedBeats.push({
        id: beat.id,
        speaker: beat.speaker,
        text: beat.text,
        startSec: Number(beatStart.toFixed(3)),
        endSec: Number(beatEnd.toFixed(3)),
        words: globalWords,
        actions,
        fx,
        sfx,
        shot: {
          type: beat.shot?.type || 'medium',
          target: beat.shot?.target || beat.speaker,
          move: beat.shot?.move || 'static',
          startSec: Number(beatStart.toFixed(3)),
          endSec: Number(beatEnd.toFixed(3)),
        },
        emphasisWords: beat.emphasisWords || [],
      });

      currentGlobalTime += duration + pauseSec;
    }

    return alignedBeats;
  }

  public fallbackEstimateWords(audioPath: string, lineText?: string): AlignedWord[] {
    // Read WAV header to determine exact duration
    let approxDurationSec = 2.0;
    try {
      const buf = fs.readFileSync(audioPath);
      const sampleRate = buf.readUInt32LE(24) || 48000;
      const numChannels = buf.readUInt16LE(22) || 1;
      const bitsPerSample = buf.readUInt16LE(34) || 16;
      const dataSize = Math.max(0, buf.length - 44);
      approxDurationSec = Math.max(0.3, dataSize / (sampleRate * numChannels * (bitsPerSample / 8)));
    } catch {
      const stat = fs.statSync(audioPath);
      approxDurationSec = Math.max(0.5, stat.size / (48000 * 2));
    }

    const words = lineText && lineText.trim()
      ? lineText.trim().split(/\s+/).filter(Boolean)
      : ['Look', 'at', 'this', 'story'];

    // Duration-weighted by character count: longer words take proportionally more time
    const totalChars = words.reduce((acc, w) => acc + Math.max(1, w.length), 0);
    const alignedWords: AlignedWord[] = [];
    let curTime = 0.05; // 50ms initial margin
    const speechSpan = Math.max(0.2, approxDurationSec - 0.1);

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const weight = Math.max(1, w.length) / totalChars;
      const wordDur = Math.max(0.12, speechSpan * weight);
      const start = Number(curTime.toFixed(3));
      const end = Number(Math.min(approxDurationSec, curTime + wordDur).toFixed(3));
      alignedWords.push({ word: w, start, end });
      curTime = end;
    }

    return alignedWords;
  }
}
