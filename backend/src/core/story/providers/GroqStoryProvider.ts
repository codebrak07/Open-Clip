import axios from 'axios';
import {
  ScriptLLMProvider,
  SpeechSynthesisProvider,
  ScriptPrompt,
  ScriptResult,
} from '../../contracts';
import { Logger } from '../../../utils/Logger';
import { resolveDynamicModel, blacklistModel, resolveCandidateModels, formatProviderError, probeModelWithOneToken } from './ModelResolver';
import { StoryCatalog, loadStoryCatalog } from '../StorySchema';
import { repairStoryboardWithRetry } from '../StoryboardRepair';

export interface GroqProviderConfig {
  apiKey?: string;
  preferredModels?: string[];
  ttsModel?: string;
  timeoutMs?: number;
  maxRetries?: number;
  concurrencyLimit?: number;
}

export class GroqStoryProvider implements ScriptLLMProvider, SpeechSynthesisProvider {
  public id = 'groq-story-provider';
  public name = 'Groq LPU Story Studio Provider';
  public version = '1.0.0';

  private apiKey: string;
  private chatModel: string | null = null;
  private preferredModels: string[];
  private candidateModels: string[] = [];
  private ttsModel: string;
  private timeoutMs: number;
  private maxRetries: number;
  private activeRequests = 0;
  private concurrencyLimit: number;

  constructor(config: GroqProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.GROQ_API_KEY || '';
    this.preferredModels = config.preferredModels || [
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b',
    ];
    this.ttsModel = config.ttsModel || 'canopylabs/orpheus-v1-english';
    this.timeoutMs = config.timeoutMs || 45000;
    this.maxRetries = config.maxRetries || 3;
    this.concurrencyLimit = config.concurrencyLimit || 5;
  }

  public async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.length > 5);
  }

  public async getResolvedChatModel(): Promise<string> {
    if (this.chatModel) return this.chatModel;
    if (this.candidateModels.length === 0) {
      this.candidateModels = await resolveCandidateModels(
        'https://api.groq.com/openai/v1/models',
        this.apiKey,
        this.preferredModels,
        'GroqStoryProvider',
        'openai/gpt-oss-120b'
      );
    }
    this.chatModel = this.candidateModels[0] || 'openai/gpt-oss-120b';
    return this.chatModel;
  }

  public async rotateModel(reason: string): Promise<string> {
    const current = this.chatModel || 'openai/gpt-oss-120b';
    blacklistModel('GroqStoryProvider', current, reason);
    this.candidateModels = this.candidateModels.filter(m => m !== current);
    if (this.candidateModels.length === 0) {
      this.chatModel = null;
      throw new Error(`[GroqStoryProvider] All candidate models exhausted for Groq.`);
    }
    this.chatModel = this.candidateModels[0];
    Logger.info(`[GroqStoryProvider] Rotated to next candidate model: ${this.chatModel}`);
    return this.chatModel;
  }

  private async executeWithRetry<T>(fn: (model: string) => Promise<T>): Promise<T> {
    let attempt = 0;
    let delay = 1000;
    while (attempt < this.maxRetries) {
      let model = await this.getResolvedChatModel();
      try {
        while (this.activeRequests >= this.concurrencyLimit) {
          await new Promise(r => setTimeout(r, 200));
        }
        this.activeRequests++;
        try {
          return await fn(model);
        } finally {
          this.activeRequests--;
        }
      } catch (err: any) {
        attempt++;
        const status = err.response?.status;
        const formattedErr = formatProviderError('GroqStoryProvider', model, err);
        const bodySnippet = formattedErr.message;

        // HTTP 410 (Retired model), 404 (Not Found), or 403 (No Permission) -> rotate model immediately!
        if (status === 410 || status === 404 || status === 403) {
          Logger.warn(`${bodySnippet}. Rotating model...`);
          try {
            await this.rotateModel(`HTTP ${status}`);
            continue;
          } catch (rotateErr: any) {
            throw formattedErr;
          }
        }

        // HTTP 429: If multiple retries on current model fail, rotate model before failing
        if (status === 429 && attempt >= 2 && this.candidateModels.length > 1) {
          Logger.warn(`[GroqStoryProvider] Rate limited on ${model}. Rotating to alternative model...`);
          try {
            await this.rotateModel(`Rate limited (HTTP 429)`);
            continue;
          } catch {}
        }

        if (status === 401) {
          throw new Error(`[GroqStoryProvider] Unauthorized (HTTP 401). Check GROQ_API_KEY.`);
        }

        if (attempt >= this.maxRetries) {
          throw formattedErr;
        }

        const waitMs = status === 429 ? Math.max(delay, 3000) : delay;
        Logger.warn(`[GroqStoryProvider] Request failed (attempt ${attempt}/${this.maxRetries}): ${err.message}. Retrying in ${waitMs}ms...`);
        await new Promise(r => setTimeout(r, waitMs));
        delay = waitMs * 2;
      }
    }
    throw new Error(`[GroqStoryProvider] Max retries (${this.maxRetries}) exceeded.`);
  }

  private async callChatCompletion(messages: Array<{ role: string; content: string }>, jsonMode = false, modelOverride?: string): Promise<string> {
    return this.executeWithRetry(async (model) => {
      const activeModel = modelOverride || model;
      const res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: activeModel,
          messages,
          temperature: 0.7,
          response_format: jsonMode ? { type: 'json_object' } : undefined,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: this.timeoutMs,
        }
      );
      return res.data?.choices?.[0]?.message?.content || '';
    });
  }

  // 1. Writer pass
  public async generateScript(prompt: ScriptPrompt): Promise<ScriptResult> {
    const tone = prompt.tone || 'humorous';
    const duration = prompt.durationSec || 60;
    const charCount = Math.min(4, Math.max(1, prompt.characterCount || 2));
    const targetWords = Math.round(duration * 2.5);
    const targetBeats = Math.max(8, Math.min(14, Math.round(duration / 4)));

    const systemPrompt = `You are an elite short-form video screenwriter specializing in high-retention TikTok, YouTube Shorts, and Reels content.
Follow this proven viral storytelling formula:
1. Hook within the first 2 seconds (grab attention immediately, create a curiosity gap).
2. Establish a clear, relatable world rule or setup within 5 seconds.
3. Escalating rule-of-three (beat 1 normal, beat 2 weird, beat 3 absurd escalation).
4. Emotional turn or surprise revelation.
5. High-impact twist ending.
6. Final button gag (a funny 1-line exit joke or punchline).

Duration target: ${duration} seconds.
Speaking rate target: 2.5 words/second (~${targetWords} spoken words total across the script).
Beat structure: Generate exactly ${targetBeats} distinct beats (~4 seconds and ~10-16 words per beat, total spoken words ~${targetWords}). Every single beat must have a substantive spoken line.
Character count: exactly ${charCount} character(s).
CRITICAL RULES:
- If character count is 2 or more, BOTH characters must speak dialogue across the story. Alternate speakers so neither is silent.
- Every beat ID MUST be globally unique across the whole script: beat_1, beat_2, beat_3, ..., beat_${targetBeats}. Never duplicate or reset beat IDs.
- For ideas involving props/effects (e.g. cat sneezing smoke on a lie), explicitly include that action in the beat and text.
Tone: ${tone}.

OUTPUT STRICT JSON FORMAT:
{
  "title": "Short punchy title",
  "logline": "1-sentence premise",
  "durationTargetSec": ${duration},
  "tone": "${tone}",
  "characters": [
    { "id": "char_1", "name": "Name 1", "role": "character", "description": "Quick visual and personality trait" },
    { "id": "char_2", "name": "Name 2", "role": "character", "description": "Second character" }
  ],
  "beats": [
    {
      "id": "beat_1",
      "speaker": "char_1",
      "text": "Dialogue line spoken out loud",
      "vocalDirections": "1-2 word vocal direction like [whisper], [excited], [deadpan], or none",
      "shotType": "wide | medium | close_up",
      "action": "Brief physical action",
      "notes": "Pacing note"
    }
  ]
}`;

    const userPrompt = `Concept / Idea: "${prompt.idea}"
Generate a complete script with exactly ${charCount} character(s), exactly ${targetBeats} beats, and ~${targetWords} total spoken words.`;

    const rawJson = await this.callChatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      true
    );

    try {
      const parsed = JSON.parse(rawJson);
      return {
        title: parsed.title || 'Untitled Short',
        logline: parsed.logline || prompt.idea,
        durationTargetSec: duration,
        tone,
        characters: parsed.characters || [{ id: 'char_1', name: 'Narrator', role: 'narrator', description: 'Default host' }],
        beats: parsed.beats || [],
      };
    } catch (e: any) {
      throw new Error(`[GroqStoryProvider] Failed to parse script JSON: ${e.message}\nRaw: ${rawJson}`);
    }
  }

  // 2. Critic pass
  public async critiqueScript(script: ScriptResult): Promise<ScriptResult> {
    const systemPrompt = `You are a ruthless short-form video editor and script doctor.
Review the following script and sharpen it for maximum retention:
1. Is the hook within the first 2 seconds irresistible? If not, rewrite beat 1.
2. Are dialogue lines punchy and rhythmic? Cut filler words.
3. Does the escalating rule-of-three hit hard?
4. Is the twist surprising and the button gag funny?

Rate the script from 1-100 on Retention Velocity. Return refined, tightened beats and critic notes in JSON format.
CRITICAL RULE: refinedBeats MUST contain the exact same number of beats as the original script (${script.beats.length} beats). Do NOT merge, delete, or drop beats. Refine the dialogue and pacing for every single beat.

Output schema:
{
  "criticScore": number,
  "criticFeedback": "Short constructive critique",
  "refinedBeats": [ ...same ${script.beats.length} beats with improved dialogue, vocal directions, and actions... ]
}`;

    const raw = await this.callChatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(script, null, 2) },
      ],
      true,
      'openai/gpt-oss-20b'
    );

    try {
      const parsed = JSON.parse(raw);
      const isComplete = parsed.refinedBeats && parsed.refinedBeats.length >= script.beats.length;
      return {
        ...script,
        beats: isComplete ? parsed.refinedBeats : script.beats,
        criticScore: parsed.criticScore || 88,
        criticFeedback: parsed.criticFeedback || 'Pacing tightened and hook sharpened.',
      };
    } catch {
      return script;
    }
  }

  // 3. Storyboard generation
  public async generateStoryboard(script: ScriptResult, catalog?: StoryCatalog): Promise<any> {
    const cat = catalog || loadStoryCatalog();

    const systemPrompt = `You are the Lead Storyboard Director for OpenClip BlockWorld 3D Animation.
Convert the provided script into a strict, validated Storyboard JSON using ONLY the closed vocabulary provided below.

CRITICAL RULES:
1. ONLY use IDs listed in the catalog below. NEVER invent, modify, or hallucinate IDs.
2. Characters: 'id' must be unique (e.g. "char_1"). 'role' must be 'narrator' or 'character'.
   - 'look.skin': must be one of [${cat.character_parts.skin_colors.map(s => s.id).join(', ')}]
   - 'look.hair.style': one of [${cat.character_parts.hair_styles.map(h => h.id).join(', ')}]
   - 'look.hair.color': one of [${cat.character_parts.hair_colors.map(c => c.id).join(', ')}]
   - 'look.top.color': one of [${cat.character_parts.top_colors.map(c => c.id).join(', ')}]
   - 'look.bottom.style': one of [${cat.character_parts.bottom_styles.map(b => b.id).join(', ')}]
   - 'look.accessory': one of [${cat.character_parts.accessories.map(a => a.id).join(', ')}]
   - 'voice.id': one of [${cat.voices.map(v => v.id).join(', ')}]
3. Scenes:
   - 'location': one of [${cat.locations.map(l => l.id).join(', ')}]
4. Beats:
   - 'speaker': must match one of the character 'id's.
   - 'shot.type': one of [${cat.shot_types.map(s => s.id).join(', ')}]
   - 'shot.move': one of [${cat.shot_moves.map(m => m.id).join(', ')}]
   - 'actions[].anim': one of [${cat.animations.map(a => a.id).join(', ')}]
   - 'actions[].expression': one of [${cat.expressions.map(e => e.id).join(', ')}]
   - 'actions[].actor': must match a character 'id'.
   - 'fx[].type': one of [${cat.fx.map(f => f.id).join(', ')}]
   - 'sfx[].cue': one of [${cat.sfx_cues.map(s => s.id).join(', ')}]
5. FULL BEAT PRESERVATION:
   - The script contains ${script.beats.length} beats. You MUST convert all ${script.beats.length} beats into storyboard beats with their full dialogue lines. NEVER drop or combine beats. The output storyboard MUST have exactly ${script.beats.length} beats.

SCHEMA:
{
  "title": "${script.title}",
  "logline": "${script.logline}",
  "durationTargetSec": ${script.durationTargetSec},
  "characters": [
    {
      "id": "char_1",
      "name": "Name",
      "role": "character",
      "look": {
        "skin": "skin_light",
        "hair": { "style": "hair_short_messy", "color": "hair_brown" },
        "top": { "style": "top_tshirt", "color": "color_blue" },
        "bottom": { "style": "bottom_jeans" },
        "accessory": "acc_none"
      },
      "voice": { "id": "daniel" }
    }
  ],
  "scenes": [
    {
      "id": "scene_1",
      "location": "living_room",
      "weather": "clear",
      "beats": [
        {
          "id": "beat_1",
          "speaker": "char_1",
          "text": "Spoken text",
          "directions": ["excited"],
          "shot": { "type": "medium", "target": "char_1", "move": "zoom_in" },
          "actions": [{ "actor": "char_1", "anim": "talk_excited", "expression": "excited", "atWord": 0 }],
          "fx": [{ "type": "smoke_puff", "atWord": 0 }],
          "sfx": [{ "cue": "whoosh", "atWord": 0, "gainDb": -2 }],
          "emphasisWords": ["IMPORTANT"]
        }
      ]
    }
  ]
}
Return ONLY valid JSON.`;

    const rawJson = await this.callChatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `SCRIPT TO CONVERT:\n${JSON.stringify(script, null, 2)}` },
      ],
      true
    );

    const repairFn = async (prompt: string) => {
      return this.callChatCompletion(
        [
          { role: 'system', content: 'You fix invalid JSON according to strict instructions. Output raw JSON only.' },
          { role: 'user', content: prompt },
        ],
        true
      );
    };

    const repairResult = await repairStoryboardWithRetry(rawJson, cat, repairFn, 3);
    return repairResult.story;
  }

  public async repairStoryboard(invalidJson: string, errors: string[], catalog?: StoryCatalog): Promise<any> {
    const cat = catalog || loadStoryCatalog();
    const repairFn = async (prompt: string) => {
      return this.callChatCompletion(
        [
          { role: 'system', content: 'You fix invalid JSON according to strict instructions. Output raw JSON only.' },
          { role: 'user', content: prompt },
        ],
        true
      );
    };
    const repairResult = await repairStoryboardWithRetry(invalidJson, cat, repairFn, 3);
    return repairResult.story;
  }

  // 4. Speech Synthesis (Groq Orpheus TTS)
  public async listAvailableVoices(): Promise<Array<{ id: string; name: string; gender: string; tags: string[] }>> {
    const cat = loadStoryCatalog();
    return cat.voices.map(v => ({
      id: v.id,
      name: v.id.charAt(0).toUpperCase() + v.id.slice(1),
      gender: v.gender,
      tags: [v.provider, v.gender],
    }));
  }

  public async synthesizeSpeech(
    text: string,
    voiceId: string,
    vocalDirections?: string
  ): Promise<{ audioBuffer: Buffer; durationSec: number; format: string }> {
    return this.executeWithRetry(async () => {
      const res = await axios.post(
        'https://api.groq.com/openai/v1/audio/speech',
        {
          model: this.ttsModel,
          input: vocalDirections ? `[${vocalDirections}] ${text}` : text,
          voice: voiceId,
          response_format: 'wav',
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
          timeout: this.timeoutMs,
        }
      );

      const audioBuffer = Buffer.from(res.data);
      const sampleRate = 24000;
      const channels = 1;
      const bytesPerSample = 2;
      const rawBytes = Math.max(0, audioBuffer.length - 44);
      const durationSec = Math.max(0.1, rawBytes / (sampleRate * channels * bytesPerSample));

      return {
        audioBuffer,
        durationSec,
        format: 'wav',
      };
    });
  }
}
