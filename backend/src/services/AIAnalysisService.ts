import fs from 'fs';
import os from 'os';
import path from 'path';
import { ProviderRegistry } from './ProviderRegistry';
import { PythonEngineBridge } from './PythonEngineBridge';
import { TranscriptionResult } from './TranscriptionService';

export interface CandidateClip {
  title: string;
  start_time: number; // in seconds
  end_time: number;   // in seconds
  score: number;      // 0 to 100
  hook_rationale: string;
  hook_sentence?: string;
  analysis_report_json?: string;
}

export class AIAnalysisService {
  /**
   * Identifies candidate short clips from a transcription via the unified M6a Python
   * hook-selection pipeline (`select-hooks`), with legacy TS LLM fallback.
   */
  static async analyzeTranscript(
    transcript: TranscriptionResult,
    providerName: string,
    apiKey?: string,
    apiBase?: string,
    options?: { clipCount?: number; hookMode?: 'strict' | 'balanced' | 'loose'; hookHint?: string }
  ): Promise<CandidateClip[]> {
    // 1. Unified M6a Hook-Aware Selection Pipeline (shared by CLI & Backend)
    try {
      const words = (transcript.words && transcript.words.length > 0)
        ? transcript.words
        : transcript.segments.flatMap((seg) => {
            const toks = seg.text.trim().split(/\s+/).filter(Boolean);
            const span = Math.max(0.1, seg.end - seg.start);
            return toks.map((w, i) => ({
              word: w,
              start: seg.start + (span * i) / toks.length,
              end: seg.start + (span * (i + 1)) / toks.length,
            }));
          });

      if (words.length > 0) {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc_hooks_'));
        const wordsFile = path.join(tmpDir, 'words.json');
        fs.writeFileSync(wordsFile, JSON.stringify(words), 'utf-8');
        const args = [
          'select-hooks',
          wordsFile,
          '--clip-count', String(options?.clipCount ?? 5),
          '--hook-mode', options?.hookMode ?? 'balanced',
          '--report-dir', tmpDir,
        ];
        if (options?.hookHint) {
          args.push('--hook-hint', options.hookHint);
        }
        const res = await PythonEngineBridge.runCommand(args);
        if (res && Array.isArray(res.clips) && res.clips.length > 0) {
          return res.clips.map((c: any) => ({
            title: String(c.hook_sentence || 'Viral Hook Clip').slice(0, 80),
            start_time: Number(c.refined_start ?? c.start ?? 0),
            end_time: Number(c.refined_end ?? c.end ?? 20),
            score: Math.min(100, Math.max(0, Math.round(Number(c.final_score ?? 7.5) * 10))),
            hook_rationale: String(c.reason || ''),
            hook_sentence: String(c.hook_sentence || ''),
            analysis_report_json: res.meta?.analysis_report_json,
          }));
        }
      }
    } catch (err: any) {
      console.warn('[AIAnalysisService] Unified M6a Python hook selector unavailable, falling back to TS provider:', err?.message);
    }

    const provider = ProviderRegistry.getProvider(providerName);

    // Format transcript segments with line numbers or timestamps to help the LLM target exact timings
    let formattedTranscript = '';
    transcript.segments.forEach((seg, idx) => {
      formattedTranscript += `[${idx}] (${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s): "${seg.text.trim()}"\n`;
    });

    const systemPrompt = `You are an elite short-form video content producer and viral clip editor. 
Your task is to analyze the following transcript segments of a long video and extract the absolute best short-form clip candidates (15-60 seconds long).
You must output a raw JSON object containing a "clips" array of candidate clips. Do not return markdown, markdown code blocks, or extra text.

Evaluate clips based on:
1. Clear opening hook: Does the clip start with a hook that grabs attention within 3 seconds?
2. Coherent standalone narrative: Does it make complete sense on its own without needing external context?
3. Emotional intensity or value density (humor, shock, wisdom, education).
4. Completeness of thought: Avoid clipping mid-sentence unless absolutely necessary.
5. Retainment potential: High-energy parts, crucial definitions, or deep secrets.

For each clip, supply:
- title: A punchy, hook-driven title for the clip.
- start_time: The start timestamp of the clip in seconds (derived precisely from the segment timestamps).
- end_time: The end timestamp of the clip in seconds.
- score: An integer score from 0 to 100 based on its viral/retention potential.
- hook_rationale: 1-2 sentences explaining why the opening hook works and its scoring criteria.

Example Output format:
{
  "clips": [
    {
      "title": "Why Modern SaaS Design is Dead",
      "start_time": 12.5,
      "end_time": 42.1,
      "score": 92,
      "hook_rationale": "Starts immediately with a bold, controversial claim about SaaS interfaces that triggers curiosity."
    }
  ]
}`;

    const prompt = `Here is the transcript:
${formattedTranscript}

Extract the candidate clips. Remember to return ONLY valid JSON in the requested format.`;

    const rawResponse = await provider.chat(prompt, systemPrompt, apiKey, apiBase);
    
    // Parse response content
    try {
      // Sometimes rawResponse is double-stringified or wrapped, let's clean it up
      let cleaned = rawResponse.trim();
      if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        // String was serialized inside another JSON
        try {
          cleaned = JSON.parse(cleaned);
        } catch {}
      }
      
      // If LLM wrapped it in ```json ... ```, strip it
      if (cleaned.includes('```json')) {
        cleaned = cleaned.split('```json')[1].split('```')[0].trim();
      } else if (cleaned.includes('```')) {
        cleaned = cleaned.split('```')[1].split('```')[0].trim();
      }

      const parsed = JSON.parse(cleaned);
      if (!parsed || !Array.isArray(parsed.clips)) {
        throw new Error('LLM output parsed successfully but does not contain a "clips" array.');
      }

      // Validate/sanitize clips
      const clips: CandidateClip[] = parsed.clips.map((c: any) => ({
        title: String(c.title || 'Untitled Viral Clip'),
        start_time: Math.max(0, parseFloat(c.start_time || '0')),
        end_time: parseFloat(c.end_time || '0'),
        score: Math.min(100, Math.max(0, parseInt(c.score || '50', 10))),
        hook_rationale: String(c.hook_rationale || ''),
      }));

      // Sort by score descending
      return clips.sort((a, b) => b.score - a.score);
    } catch (e: any) {
      console.error('Failed to parse LLM response as JSON. Raw response:', rawResponse);
      throw new Error(`LLM Analysis parsing error: ${e.message}`);
    }
  }

  /**
   * Post-processes candidates: validates timestamps, merges highly overlapping candidates, and drops duplicates.
   */
  static postProcessClips(clips: CandidateClip[], videoDuration: number): CandidateClip[] {
    const valid: CandidateClip[] = [];

    for (const clip of clips) {
      // Validate bounds
      if (clip.end_time <= clip.start_time) continue;
      if (clip.start_time >= videoDuration) continue;

      const duration = clip.end_time - clip.start_time;
      if (duration < 5.0) continue; // Skip too short clips

      // Bound to video duration
      const sanitizedClip = {
        ...clip,
        end_time: Math.min(videoDuration, clip.end_time),
      };

      // Check for excessive overlap (>80% similarity) with already added clips
      let isDuplicate = false;
      for (const existing of valid) {
        const overlapStart = Math.max(existing.start_time, sanitizedClip.start_time);
        const overlapEnd = Math.min(existing.end_time, sanitizedClip.end_time);

        if (overlapEnd > overlapStart) {
          const overlapDur = overlapEnd - overlapStart;
          const minDur = Math.min(existing.end_time - existing.start_time, sanitizedClip.end_time - sanitizedClip.start_time);
          if (overlapDur / minDur > 0.8) {
            isDuplicate = true;
            break;
          }
        }
      }

      if (!isDuplicate) {
        valid.push(sanitizedClip);
      }
    }

    return valid;
  }
}
