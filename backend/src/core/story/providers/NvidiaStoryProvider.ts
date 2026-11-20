import axios from 'axios';
import {
  ScriptLLMProvider,
  ScriptPrompt,
  ScriptResult,
} from '../../contracts';
import { Logger } from '../../../utils/Logger';
import { resolveDynamicModel, blacklistModel, resolveCandidateModels, formatProviderError, probeModelWithOneToken } from './ModelResolver';
import { StoryCatalog, loadStoryCatalog } from '../StorySchema';
import { repairStoryboardWithRetry } from '../StoryboardRepair';

export interface NvidiaProviderConfig {
  apiKey?: string;
  preferredModels?: string[];
  timeoutMs?: number;
  maxRetries?: number;
  concurrencyLimit?: number;
}

export class NvidiaStoryProvider implements ScriptLLMProvider {
  public id = 'nvidia-story-provider';
  public name = 'NVIDIA NIM Cloud Story Studio Provider';
  public version = '1.0.0';

  private apiKey: string;
  private chatModel: string | null = null;
  private preferredModels: string[];
  private candidateModels: string[] = [];
  private timeoutMs: number;
  private maxRetries: number;
  private activeRequests = 0;
  private concurrencyLimit: number;

  constructor(config: NvidiaProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.NVIDIA_API_KEY || '';
    this.preferredModels = config.preferredModels || [
      'minimaxai/minimax-m3.1-flash',
      'mistralai/mistral-large-4-1t-a52b',
      'google/gemma-4-31b-it',
      'z-ai/glm-5.3-flash',
      'nvidia/nemotron-3.5-lightning-30b-a3b',
    ];
    this.timeoutMs = config.timeoutMs || 45000;
    this.maxRetries = config.maxRetries || 3;
    this.concurrencyLimit = config.concurrencyLimit || 4;
  }

  public async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.length > 5);
  }

  public async getResolvedChatModel(): Promise<string> {
    if (this.chatModel) return this.chatModel;
    if (this.candidateModels.length === 0) {
      this.candidateModels = await resolveCandidateModels(
        'https://integrate.api.nvidia.com/v1/models',
        this.apiKey,
        this.preferredModels,
        'NvidiaStoryProvider',
        'minimaxai/minimax-m3.1-flash'
      );
    }
    this.chatModel = this.candidateModels[0] || 'minimaxai/minimax-m3.1-flash';
    return this.chatModel;
  }

  public async rotateModel(reason: string): Promise<string> {
    const current = this.chatModel || 'minimaxai/minimax-m3.1-flash';
    blacklistModel('NvidiaStoryProvider', current, reason);
    this.candidateModels = this.candidateModels.filter(m => m !== current);
    if (this.candidateModels.length === 0) {
      this.chatModel = null;
      throw new Error(`[NvidiaStoryProvider] All candidate models exhausted for NVIDIA NIM.`);
    }
    this.chatModel = this.candidateModels[0];
    Logger.info(`[NvidiaStoryProvider] Rotated to next candidate model: ${this.chatModel}`);
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
        const formattedErr = formatProviderError('NvidiaStoryProvider', model, err);
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

        // HTTP 429 or 529 (Rate limited or server overloaded) -> rotate to alternate model if possible
        if ((status === 429 || status === 529) && attempt >= 2 && this.candidateModels.length > 1) {
          Logger.warn(`[NvidiaStoryProvider] Rate limited / overloaded on ${model}. Rotating to alternate model...`);
          try {
            await this.rotateModel(`HTTP ${status}`);
            continue;
          } catch {}
        }

        if (status === 401) {
          throw new Error(`[NvidiaStoryProvider] Unauthorized (HTTP 401). Check NVIDIA_API_KEY.`);
        }

        if (attempt >= this.maxRetries) {
          throw formattedErr;
        }

        const waitMs = (status === 429 || status === 529) ? Math.max(delay, 3000) : delay;
        Logger.warn(`[NvidiaStoryProvider] Request failed (attempt ${attempt}/${this.maxRetries}): ${err.message}. Retrying in ${waitMs}ms...`);
        await new Promise(r => setTimeout(r, waitMs));
        delay = waitMs * 2;
      }
    }
    throw new Error(`[NvidiaStoryProvider] Max retries (${this.maxRetries}) exceeded.`);
  }

  private async callChatCompletion(messages: Array<{ role: string; content: string }>, jsonMode = false): Promise<string> {
    return this.executeWithRetry(async (model) => {
      const res = await axios.post(
        'https://integrate.api.nvidia.com/v1/chat/completions',
        {
          model,
          messages,
          temperature: 0.5,
          max_tokens: 8000,
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
      const choice = res.data?.choices?.[0]?.message;
      return choice?.content || choice?.reasoning_content || '';
    });
  }

  public async generateScript(prompt: ScriptPrompt): Promise<ScriptResult> {
    const tone = prompt.tone || 'humorous';
    const duration = prompt.durationSec || 60;
    const charCount = Math.min(4, Math.max(1, prompt.characterCount || 2));
    const targetWords = Math.round(duration * 2.5);
    const targetBeats = Math.max(8, Math.min(14, Math.round(duration / 4)));

    const systemPrompt = `You are an elite short-form screenwriter.
Formula:
1. Hook within 2s.
2. World rule in 5s.
3. Rule of three escalation.
4. Emotional turn.
5. High-impact twist.
6. Button gag.

Duration target: ${duration}s (~${targetWords} words total).
Beat structure: Generate exactly ${targetBeats} beats (beat_1 to beat_${targetBeats}).
Characters: exactly ${charCount} character(s). Both must speak if charCount >= 2.
Tone: ${tone}.

Return STRICT JSON ONLY:
{
  "title": "Title",
  "logline": "Logline",
  "durationTargetSec": ${duration},
  "tone": "${tone}",
  "characters": [ { "id": "char_1", "name": "Name", "role": "character", "description": "..." } ],
  "beats": [ { "id": "beat_1", "speaker": "char_1", "text": "...", "vocalDirections": "excited", "shotType": "wide", "action": "..." } ]
}`;

    const raw = await this.callChatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Concept: "${prompt.idea}"` },
    ], true);

    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      title: parsed.title || 'Untitled Short',
      logline: parsed.logline || prompt.idea,
      durationTargetSec: duration,
      tone,
      characters: parsed.characters || [{ id: 'char_1', name: 'Narrator', role: 'narrator', description: 'Narrator' }],
      beats: parsed.beats || [],
    };
  }

  public async critiqueScript(script: ScriptResult): Promise<ScriptResult> {
    const systemPrompt = `You are a premier viral content script doctor powered by NVIDIA NIM.
Analyze the provided short-form script. Score its retention velocity from 1-100, tighten dialogue, heighten stakes, and refine comedic or dramatic beats.
CRITICAL: refinedBeats MUST have the exact same count of beats as the original script (${script.beats.length} beats). Do NOT drop beats.
Return STRICT JSON ONLY with:
{
  "criticScore": number,
  "criticFeedback": "Feedback summary",
  "refinedBeats": [ ...refined beat objects... ]
}`;

    const raw = await this.callChatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(script, null, 2) },
    ], true);

    try {
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(cleaned);
      const isComplete = parsed.refinedBeats && parsed.refinedBeats.length >= script.beats.length;
      return {
        ...script,
        beats: isComplete ? parsed.refinedBeats : script.beats,
        criticScore: parsed.criticScore || 90,
        criticFeedback: parsed.criticFeedback || 'NVIDIA critic refined beat timing and punchlines.',
      };
    } catch {
      return script;
    }
  }

  public async generateStoryboard(script: ScriptResult, catalog?: StoryCatalog): Promise<any> {
    const cat = catalog || loadStoryCatalog();

    const systemPrompt = `You are the Lead Storyboard Director for OpenClip BlockWorld 3D Animation.
Convert the provided script into strict JSON conforming to the closed vocabulary.
Allowed IDs:
Locations: ${cat.locations.map(l => l.id).join(', ')}
Skins: ${cat.character_parts.skin_colors.map(s => s.id).join(', ')}
Hairs: ${cat.character_parts.hair_styles.map(h => h.id).join(', ')}
HairColors: ${cat.character_parts.hair_colors.map(c => c.id).join(', ')}
TopColors: ${cat.character_parts.top_colors.map(c => c.id).join(', ')}
BottomStyles: ${cat.character_parts.bottom_styles.map(b => b.id).join(', ')}
Accessories: ${cat.character_parts.accessories.map(a => a.id).join(', ')}
Animations: ${cat.animations.map(a => a.id).join(', ')}
Expressions: ${cat.expressions.map(e => e.id).join(', ')}
ShotTypes: ${cat.shot_types.map(s => s.id).join(', ')}
ShotMoves: ${cat.shot_moves.map(m => m.id).join(', ')}
SfxCues: ${cat.sfx_cues.map(s => s.id).join(', ')}
Voices: ${cat.voices.map(v => v.id).join(', ')}

Preserve all ${script.beats.length} beats.
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
          "text": "Dialogue text",
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
Output STRICT JSON ONLY.`;

    const raw = await this.callChatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(script, null, 2) },
    ], true);

    const repairFn = async (prompt: string) => {
      return this.callChatCompletion([
        { role: 'system', content: 'You fix invalid JSON according to strict instructions. Output raw JSON only.' },
        { role: 'user', content: prompt },
      ], true);
    };

    const repairResult = await repairStoryboardWithRetry(raw, cat, repairFn, 3);
    return repairResult.story;
  }

  public async repairStoryboard(invalidJson: string, errors: string[], catalog?: StoryCatalog): Promise<any> {
    const cat = catalog || loadStoryCatalog();
    const repairFn = async (prompt: string) => {
      return this.callChatCompletion([
        { role: 'system', content: 'You fix invalid JSON according to strict instructions. Output raw JSON only.' },
        { role: 'user', content: prompt },
      ], true);
    };
    const repairResult = await repairStoryboardWithRetry(invalidJson, cat, repairFn, 3);
    return repairResult.story;
  }
}
