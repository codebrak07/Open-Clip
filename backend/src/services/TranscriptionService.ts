import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import { GROQ_API_KEY, GROQ_API_KEYS } from '../config';

import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  words?: TranscriptWord[];
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
}

export class TranscriptionService {
  /**
   * Transcribe an audio file using Groq's whisper-large-v3 model with automatic multi-key failover.
   */
  static async transcribeWithGroq(audioPath: string, apiKey?: string): Promise<TranscriptionResult> {
    const keysPool = Array.from(new Set([
      apiKey,
      ...GROQ_API_KEYS,
    ])).filter(Boolean) as string[];


    let lastError: any = null;

    for (const key of keysPool) {
      try {
        const form = new FormData();
        form.append('file', fs.createReadStream(audioPath));
        form.append('model', 'whisper-large-v3');
        form.append('response_format', 'verbose_json');

        const response = await axios.post(
          'https://api.groq.com/openai/v1/audio/transcriptions',
          form,
          {
            headers: {
              ...form.getHeaders(),
              'Authorization': `Bearer ${key}`,
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          }
        );

        const data = response.data;
        const segments: TranscriptSegment[] = (data.segments || []).map((seg: any) => ({
          text: seg.text,
          start: seg.start,
          end: seg.end,
          words: (seg.words || []).map((w: any) => ({
            word: w.word,
            start: w.start,
            end: w.end,
          })),
        }));

        return {
          text: data.text || '',
          segments,
        };
      } catch (err: any) {
        console.warn(`[Groq Transcription Key Failed] key ending in ...${key.slice(-6)}: ${err.message}`);
        lastError = err;
      }
    }

    // If API keys fail or file is non-verbal, return empty transcript cleanly to trigger visual fallback mode
    return { text: '', segments: [] };
  }


  /**
   * Transcribe an audio file using OpenAI's Whisper model.
   */
  static async transcribeWithOpenAI(audioPath: string, apiKey: string): Promise<TranscriptionResult> {
    if (!apiKey) throw new Error('OpenAI API Key is required for transcription.');

    const form = new FormData();
    form.append('file', fs.createReadStream(audioPath));
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');

    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      form,
      {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${apiKey}`,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    const data = response.data;
    const segments: TranscriptSegment[] = (data.segments || []).map((seg: any) => ({
      text: seg.text,
      start: seg.start,
      end: seg.end,
      words: (seg.words || []).map((w: any) => ({
        word: w.word,
        start: w.start,
        end: w.end,
      })),
    }));

    return {
      text: data.text,
      segments,
    };
  }

  /**
   * Transcribe an audio file locally using a whisper executable (if installed on the host).
   */
  static async transcribeLocally(audioPath: string, model: string = 'base'): Promise<TranscriptionResult> {
    // Basic execution of whisper command line: whisper audioPath --model model --output_format json
    const outputDir = audioPath.replace(/\.[^/.]+$/, '');
    const cmd = `whisper "${audioPath}" --model ${model} --output_dir "${outputDir}" --output_format json`;

    await execPromise(cmd);

    const jsonPath = `${outputDir}/${audioPath.split('/').pop()?.replace(/\.[^/.]+$/, '')}.json`;
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`Local Whisper execution completed but transcription file not found at ${jsonPath}`);
    }

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const segments: TranscriptSegment[] = (data.segments || []).map((seg: any) => ({
      text: seg.text,
      start: seg.start,
      end: seg.end,
      words: (seg.words || []).map((w: any) => ({
        word: w.word,
        start: w.start,
        end: w.end,
      })),
    }));

    return {
      text: data.text,
      segments,
    };
  }
}
