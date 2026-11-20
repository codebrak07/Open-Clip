import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { SpeechSynthesisProvider } from '../../contracts';
import { KokoroLocalSpeechProvider } from '../providers/KokoroLocalSpeechProvider';
import { GroqStoryProvider } from '../providers/GroqStoryProvider';
import { MacosSaySpeechProvider } from '../providers/MacosSaySpeechProvider';
import { Logger } from '../../../utils/Logger';

export interface TTSManagerConfig {
  preferredProvider?: 'auto' | 'kokoro-local' | 'groq-orpheus' | 'macos-say';
  cacheDir?: string;
}

export interface SynthesizedVoiceResult {
  audioBuffer: Buffer;
  durationSec: number;
  format: string;
  providerUsed: string;
  qualityTier: 'high' | 'standard' | 'basic';
  warnings?: string[];
}

export interface TTSDiagnostic {
  providerId: string;
  providerName: string;
  ready: boolean;
  latencyMs: number;
  sampleDurationSec?: number;
  error?: string;
  voicesCount: number;
}

export class SpeechSynthesisManager {
  private kokoroProvider: KokoroLocalSpeechProvider;
  private groqProvider: GroqStoryProvider;
  private macosSayProvider: MacosSaySpeechProvider;
  private cacheDir: string;
  private config: TTSManagerConfig;

  constructor(config: TTSManagerConfig = {}) {
    this.config = {
      preferredProvider: config.preferredProvider || (process.env.TTS_PROVIDER as any) || 'auto',
      ...config,
    };
    this.kokoroProvider = new KokoroLocalSpeechProvider();
    this.groqProvider = new GroqStoryProvider();
    this.macosSayProvider = new MacosSaySpeechProvider();

    const rootDir = path.resolve(__dirname, '../../../../');
    this.cacheDir = config.cacheDir || path.join(rootDir, 'backend/storage/cache/tts');
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  public getProviderChain(): SpeechSynthesisProvider[] {
    const pref = this.config.preferredProvider;
    if (pref === 'kokoro-local') {
      return [this.kokoroProvider, this.groqProvider, this.macosSayProvider];
    } else if (pref === 'groq-orpheus') {
      return [this.groqProvider, this.kokoroProvider, this.macosSayProvider];
    } else if (pref === 'macos-say') {
      return [this.macosSayProvider, this.kokoroProvider, this.groqProvider];
    }
    // Default chain: kokoro-local -> groq-orpheus -> macos-say
    return [this.kokoroProvider, this.groqProvider, this.macosSayProvider];
  }

  public async synthesizeLine(
    text: string,
    voiceId: string,
    vocalDirections?: string
  ): Promise<SynthesizedVoiceResult> {
    const cleanText = text.trim();
    const directions = vocalDirections || '';
    const hash = crypto
      .createHash('sha256')
      .update(`${cleanText}::${voiceId}::${directions}`)
      .digest('hex');

    const cachePath = path.join(this.cacheDir, `${hash}.wav`);
    const metaPath = path.join(this.cacheDir, `${hash}.meta.json`);

    if (fs.existsSync(cachePath) && fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        const buf = fs.readFileSync(cachePath);
        return {
          audioBuffer: buf,
          durationSec: meta.durationSec,
          format: 'wav',
          providerUsed: meta.providerUsed,
          qualityTier: meta.qualityTier,
        };
      } catch {}
    }

    const chain = this.getProviderChain();
    let lastError: Error | null = null;
    const warnings: string[] = [];

    for (const provider of chain) {
      try {
        const available = await provider.isAvailable();
        if (!available) continue;

        Logger.info(`[SpeechSynthesisManager] Synthesizing line with ${provider.name} (voice: ${voiceId})`);
        const res = await provider.synthesizeSpeech(cleanText, voiceId, directions);

        if (res.audioBuffer && res.audioBuffer.length > 500) {
          const qualityTier: 'high' | 'standard' | 'basic' =
            provider.id === 'kokoro-local' ? 'high' : (provider.id === 'groq-orpheus' ? 'standard' : 'basic');

          // Save to disk cache
          fs.writeFileSync(cachePath, res.audioBuffer);
          fs.writeFileSync(
            metaPath,
            JSON.stringify({
              durationSec: res.durationSec,
              providerUsed: provider.id,
              qualityTier,
              cachedAt: Date.now(),
            })
          );

          return {
            ...res,
            providerUsed: provider.id,
            qualityTier,
            warnings: warnings.length > 0 ? warnings : undefined,
          };
        }
      } catch (err: any) {
        lastError = err;
        const msg = err.message || String(err);
        if (msg.includes('model_terms_required') || (err.response?.status === 400 && msg.includes('terms'))) {
          const termsMsg = 'Accept the Orpheus terms at console.groq.com/playground?model=canopylabs/orpheus-v1-english';
          Logger.warn(`[SpeechSynthesisManager] ${termsMsg}`);
          warnings.push(termsMsg);
        } else {
          Logger.warn(`[SpeechSynthesisManager] Provider ${provider.name} failed: ${msg}. Cascading...`);
        }
      }
    }

    throw new Error(
      `[SpeechSynthesisManager] All TTS providers failed to synthesize line "${cleanText.substring(0, 30)}...". Last error: ${lastError?.message || 'None available'}`
    );
  }

  public async runDoctor(): Promise<TTSDiagnostic[]> {
    const testLine = 'OpenClip Story Studio autonomous synthesis test.';
    const results: TTSDiagnostic[] = [];

    const providers = [
      { id: 'kokoro-local', name: 'Kokoro-82M (Local MLX/ONNX)', provider: this.kokoroProvider, testVoice: 'af_heart' },
      { id: 'groq-orpheus', name: 'Groq Orpheus Cloud TTS', provider: this.groqProvider, testVoice: 'autumn' },
      { id: 'macos-say', name: 'macOS Native Say', provider: this.macosSayProvider, testVoice: 'Samantha' },
    ];

    for (const p of providers) {
      const t0 = Date.now();
      try {
        const avail = await p.provider.isAvailable();
        if (!avail) {
          results.push({
            providerId: p.id,
            providerName: p.name,
            ready: false,
            latencyMs: Date.now() - t0,
            error: p.id === 'kokoro-local' ? 'Weights not found. Run scripts/setup-tts.sh' : 'Provider not configured or unavailable',
            voicesCount: 0,
          });
          continue;
        }

        const voices = await p.provider.listAvailableVoices();
        const synth = await p.provider.synthesizeSpeech(testLine, p.testVoice);
        results.push({
          providerId: p.id,
          providerName: p.name,
          ready: true,
          latencyMs: Date.now() - t0,
          sampleDurationSec: synth.durationSec,
          voicesCount: voices.length,
        });
      } catch (err: any) {
        let errStr = err.message || String(err);
        if (errStr.includes('model_terms_required') || errStr.includes('requires terms') || errStr.includes('Accept the terms')) {
          errStr = 'Accept the terms at console.groq.com/playground?model=canopylabs%2Forpheus-v1-english';
        }
        results.push({
          providerId: p.id,
          providerName: p.name,
          ready: false,
          latencyMs: Date.now() - t0,
          error: errStr,
          voicesCount: 0,
        });
      }
    }

    return results;
  }
}
