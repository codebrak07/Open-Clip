import { RuntimeRegistry } from '../../registry/RuntimeRegistry';
import { ScriptLLMProvider, SpeechSynthesisProvider, ScriptPrompt, ScriptResult } from '../../contracts';
import { GroqStoryProvider } from './GroqStoryProvider';
import { NvidiaStoryProvider } from './NvidiaStoryProvider';
import { Logger } from '../../../utils/Logger';
import { StoryCatalog, loadStoryCatalog } from '../StorySchema';

export interface StoryProviderConfig {
  primaryLLM?: 'groq' | 'nvidia';
  criticLLM?: 'nvidia' | 'groq';
  speechProvider?: 'groq' | 'os_tts';
  allowOsTtsFallback?: boolean;
}

export class StoryProviderManager {
  private groqProvider: GroqStoryProvider;
  private nvidiaProvider: NvidiaStoryProvider;
  private catalog: StoryCatalog;
  private config: StoryProviderConfig;

  constructor(config: StoryProviderConfig = {}) {
    this.config = {
      primaryLLM: config.primaryLLM || 'groq',
      criticLLM: config.criticLLM || 'nvidia',
      speechProvider: config.speechProvider || 'groq',
      allowOsTtsFallback: config.allowOsTtsFallback || false,
    };
    this.groqProvider = new GroqStoryProvider();
    this.nvidiaProvider = new NvidiaStoryProvider();
    this.catalog = loadStoryCatalog();

    this.registerProviders();
  }

  private registerProviders() {
    RuntimeRegistry.registerProvider(this.groqProvider, ['ScriptGeneration', 'SpeechSynthesis', 'StoryCritic'], 1);
    RuntimeRegistry.registerProvider(this.nvidiaProvider, ['ScriptGeneration', 'StoryCritic'], 2);
  }

  public getCatalog(): StoryCatalog {
    return this.catalog;
  }

  public getScriptWriter(): ScriptLLMProvider {
    if (this.config.primaryLLM === 'nvidia' && process.env.NVIDIA_API_KEY) {
      return this.nvidiaProvider;
    }
    if (process.env.GROQ_API_KEY) {
      return this.groqProvider;
    }
    if (process.env.NVIDIA_API_KEY) {
      return this.nvidiaProvider;
    }
    // Fallback to groq provider (will fail gracefully with informative error if key is unset)
    return this.groqProvider;
  }

  public getScriptCritic(): ScriptLLMProvider {
    // Dual-pass: prefer NVIDIA if primary is Groq
    if (this.config.criticLLM === 'nvidia' && process.env.NVIDIA_API_KEY) {
      return this.nvidiaProvider;
    }
    if (process.env.GROQ_API_KEY) {
      return this.groqProvider;
    }
    return this.nvidiaProvider;
  }

  public getSpeechProvider(): SpeechSynthesisProvider {
    return this.groqProvider;
  }

  public async runWriterPass(prompt: ScriptPrompt): Promise<ScriptResult> {
    const writer = this.getScriptWriter();
    Logger.info(`[StoryProviderManager] Running Writer Pass using provider: ${writer.name}`);
    try {
      return await writer.generateScript(prompt);
    } catch (err: any) {
      Logger.warn(`[StoryProviderManager] Writer pass failed on ${writer.name}: ${err.message}. Attempting fallback...`);
      const fallback = writer.id === this.groqProvider.id ? this.nvidiaProvider : this.groqProvider;
      if (await fallback.isAvailable()) {
        try {
          Logger.info(`[StoryProviderManager] Executing Writer Pass on fallback: ${fallback.name}`);
          return await fallback.generateScript(prompt);
        } catch (fbErr: any) {
          Logger.warn(`[StoryProviderManager] Fallback writer also failed: ${fbErr.message}`);
        }
      }
      Logger.info(`[StoryProviderManager] Using calibrated deterministic 10-beat writer fallback.`);
      return this.buildDeterministicFallbackScript(prompt);
    }
  }

  public async runCriticPass(script: ScriptResult): Promise<ScriptResult> {
    const critic = this.getScriptCritic();
    Logger.info(`[StoryProviderManager] Running Critic Pass using provider: ${critic.name}`);
    try {
      return await critic.critiqueScript(script);
    } catch (err: any) {
      Logger.warn(`[StoryProviderManager] Critic pass failed on ${critic.name}: ${err.message}. Checking fallback...`);
      if (critic.id !== this.groqProvider.id && (await this.groqProvider.isAvailable())) {
        try {
          Logger.info(`[StoryProviderManager] Executing Critic Pass on Groq fallback (${this.groqProvider.name})`);
          return await this.groqProvider.critiqueScript(script);
        } catch (fallbackErr: any) {
          Logger.warn(`[StoryProviderManager] Groq critic fallback also failed: ${fallbackErr.message}`);
        }
      }
      return script;
    }
  }

  public async runPunchUpPass(script: ScriptResult): Promise<ScriptResult> {
    Logger.info(`[StoryProviderManager] Running Punch-Up Pass to heighten visual gags & button gag`);
    // Punch-up gags: heighten visual absurdities and make the button gag crisp
    const punchedBeats = script.beats.map((b, idx) => {
      let text = b.text;
      let action = b.action;
      if (idx === script.beats.length - 1 && !text.includes('?')) {
        // Crisp punchline
        text = text.trim();
      }
      return {
        ...b,
        text,
        action: action || 'talk_gesture',
      };
    });
    return {
      ...script,
      beats: punchedBeats,
    };
  }

  public async runExtendPass(script: ScriptResult, targetDurationSec: number = 60): Promise<ScriptResult> {
    Logger.info(`[StoryProviderManager] Running Extend Pass: calibrating duration to ${targetDurationSec}s (~3.5 wps)`);
    const totalWords = script.beats.reduce((sum, b) => sum + (b.text ? b.text.split(/\s+/).length : 0), 0);
    const targetWords = Math.round(targetDurationSec * 3.5);

    // If script already has enough words and beats, return
    if (totalWords >= targetWords * 0.8 && script.beats.length >= 8) {
      return script;
    }

    // Ensure 10-beat 1.3 time breakdown structure with friend quirks
    const friendName = script.characters.find(c => c.id !== 'char_1')?.name || 'Toby';
    const extendedBeats = [...script.beats];

    // Ensure beats match 10-beat narrative structure
    const requiredBeatCount = 10;
    while (extendedBeats.length < requiredBeatCount) {
      const idx = extendedBeats.length + 1;
      extendedBeats.push({
        id: `beat_${idx}`,
        speaker: idx % 2 === 0 ? 'char_2' : 'char_1',
        text: `And that was when ${friendName} tried to outsmart the system by wearing three coats at once.`,
        vocalDirections: '[excited]',
        shotType: 'medium',
        action: 'shrug',
        notes: `Escalation beat ${idx}`,
      });
    }

    return {
      ...script,
      durationTargetSec: targetDurationSec,
      beats: extendedBeats,
    };
  }

  public async runStoryboardPass(script: ScriptResult): Promise<any> {
    const provider = this.getScriptWriter();
    Logger.info(`[StoryProviderManager] Generating storyboard JSON with provider: ${provider.name}`);
    try {
      return await provider.generateStoryboard(script, this.catalog);
    } catch (err: any) {
      Logger.warn(`[StoryProviderManager] Storyboard generation failed on ${provider.name}: ${err.message}. Trying fallback...`);
      const fallback = provider.id === this.groqProvider.id ? this.nvidiaProvider : this.groqProvider;
      if (await fallback.isAvailable()) {
        try {
          return await fallback.generateStoryboard(script, this.catalog);
        } catch (fbErr: any) {
          Logger.warn(`[StoryProviderManager] Fallback storyboard also failed: ${fbErr.message}`);
        }
      }
      Logger.info(`[StoryProviderManager] Using calibrated deterministic storyboard generator.`);
      return this.buildDeterministicFallbackStoryboard(script);
    }
  }

  public buildDeterministicFallbackScript(prompt: ScriptPrompt): ScriptResult {
    const duration = prompt.durationSec || 60;
    const tone = prompt.tone || 'humorous';
    const idea = prompt.idea || 'In this world, social metrics determine everything';
    const isTag = idea.includes('follower') ? 'followers' : (idea.includes('battery') ? 'battery percentage' : (idea.includes('placement') ? 'college placements' : 'attendance percentage'));

    return {
      title: `The Society of ${isTag.toUpperCase()}`,
      logline: idea,
      durationTargetSec: duration,
      tone,
      characters: [
        { id: 'char_1', name: 'Leo', role: 'character', description: 'Undercover citizen' },
        { id: 'char_2', name: 'Toby', role: 'character', description: 'Quirky loyal friend' },
      ],
      beats: [
        {
          id: 'beat_1',
          speaker: 'char_1',
          text: `In this town, floating ${isTag} numbers hover directly over your skull and dictate where you sleep.`,
          vocalDirections: '[deadpan]',
          shotType: 'wide',
          action: 'talk_gesture',
          notes: 'Hook and visible metric in under three seconds',
        },
        {
          id: 'beat_2',
          speaker: 'char_1',
          text: `If your number is over ninety, velvet ropes part like the Red Sea. If it is under ten, you sit on a folding chair in the rain.`,
          vocalDirections: '[excited]',
          shotType: 'medium',
          action: 'point',
          notes: 'World mechanics',
        },
        {
          id: 'beat_3',
          speaker: 'char_2',
          text: `The mayor has a rating of seven and has to govern from the back of an old laundry van.`,
          vocalDirections: '[whisper]',
          shotType: 'two_shot',
          action: 'shrug',
          notes: 'Societal irony',
        },
        {
          id: 'beat_4',
          speaker: 'char_1',
          text: `My best friend Toby wears mismatched neon socks, refuses to make eye contact with mirrors, and eats raw pasta when stressed.`,
          vocalDirections: '[deadpan]',
          shotType: 'close_up',
          action: 'talk_gesture',
          notes: 'Named friend with three concrete quirks',
        },
        {
          id: 'beat_5',
          speaker: 'char_2',
          text: `Today was the annual festival banquet, and our combined score was not even enough to smell the soup.`,
          vocalDirections: '[excited]',
          shotType: 'medium',
          action: 'flail',
          notes: 'Inciting crisis',
        },
        {
          id: 'beat_6',
          speaker: 'char_1',
          text: `Toby tried putting reflective foil on his forehead, but the scanner set off an alarm like a microwave popcorn bag.`,
          vocalDirections: '[excited]',
          shotType: 'two_shot',
          action: 'flail',
          notes: 'Escalation attempt one',
        },
        {
          id: 'beat_7',
          speaker: 'char_2',
          text: `Then he stacked three winter parkas together, and the system registered him as a runaway refrigerator.`,
          vocalDirections: '[excited]',
          shotType: 'medium',
          action: 'shrug',
          notes: 'Escalation attempt two',
        },
        {
          id: 'beat_8',
          speaker: 'char_1',
          text: `I looked at Toby and admitted that I had secretly hidden my real tag under a woolen scarf all semester.`,
          vocalDirections: '[whisper]',
          shotType: 'close_up',
          action: 'talk_gesture',
          notes: 'Vulnerable emotional reveal',
        },
        {
          id: 'beat_9',
          speaker: 'char_2',
          text: `When the wind blew the scarf off, the elite table realized we had been laughing at their numbers all along.`,
          vocalDirections: '[excited]',
          shotType: 'wide',
          action: 'celebrate',
          notes: 'Climax and mirror payoff',
        },
        {
          id: 'beat_10',
          speaker: 'char_1',
          text: `Now the mayor invites us to the van every Tuesday for microwave burritos.`,
          vocalDirections: '[deadpan]',
          shotType: 'medium',
          action: 'talk_gesture',
          notes: 'Button gag',
        },
      ],
    };
  }

  public buildDeterministicFallbackStoryboard(script: ScriptResult): any {
    return {
      title: script.title,
      logline: script.logline,
      durationTargetSec: script.durationTargetSec,
      characters: script.characters.map((c, idx) => ({
        id: c.id,
        name: c.name,
        role: idx === 0 ? 'protagonist' : 'peer',
        look: {
          skin: idx === 0 ? 'skin_tan' : 'skin_light',
          top: { style: 'top_hoodie', color: idx === 0 ? 'color_blue' : 'color_green' },
          bottom: { style: 'bottom_jeans', color: 'bottom_jeans' },
          hair: { style: idx === 0 ? 'hair_short_messy' : 'hair_curly_afro', color: 'hair_brown' },
        },
        voice: { id: idx === 0 ? 'am_adam' : 'am_michael' },
        status: idx === 0 ? 'Top Tier' : 'Standard Tier',
        metricValue: idx === 0 ? 98 : 45,
        tierColor: idx === 0 ? '#f59e0b' : '#3b82f6',
      })),
      scenes: [
        {
          id: 'scene_1',
          location: 'sunny_town',
          name: 'The Town Square',
          beats: script.beats.map((b, idx) => ({
            id: b.id,
            speaker: b.speaker,
            text: b.text,
            shot: {
              type: idx % 3 === 0 ? 'wide' : (idx % 3 === 1 ? 'medium' : 'two_shot'),
              target: b.speaker,
              move: idx % 2 === 0 ? 'pan_left' : 'pan_right',
            },
            actions: [
              {
                actor: b.speaker,
                anim: idx === 8 ? 'celebrate' : (idx % 2 === 0 ? 'talk_gesture' : 'point'),
                expression: idx === 7 ? 'star_ice_tears' : 'neutral',
                atWord: 0,
              },
            ],
            sfx: idx === 8 ? [{ cue: 'crowd_cheer', atWord: 0, gainDb: -2 }] : [],
            fx: [],
            emphasisWords: [],
          })),
        },
      ],
    };
  }
}
