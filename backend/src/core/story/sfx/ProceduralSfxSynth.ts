import fs from 'fs';
import path from 'path';
import { OrpheusVoiceSynthesizer } from '../audio/OrpheusVoiceSynthesizer';
import { Logger } from '../../../utils/Logger';

export interface SfxSynthesisResult {
  cue: string;
  durationSec: number;
  wavBuffer: Buffer;
  wavPath: string;
}

export class ProceduralSfxSynth {
  private outputDir: string;
  private sampleRate = 44100;

  constructor(outputDir?: string) {
    this.outputDir = outputDir || path.resolve(process.cwd(), 'assets/sfx/.procedural');
    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  /**
   * Generates procedural WAV for any of the 13 catalog cues deterministically.
   */
  public generate(cue: string): SfxSynthesisResult {
    const filePath = path.join(this.outputDir, `${cue}.wav`);
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath);
      const pcmInfo = OrpheusVoiceSynthesizer.extractPcmFromWav(existing);
      return {
        cue,
        durationSec: pcmInfo.pcm.length / (pcmInfo.sampleRate * 2),
        wavBuffer: existing,
        wavPath: filePath,
      };
    }

    Logger.info(`[ProceduralSfxSynth] Synthesizing procedural cue: "${cue}"`);
    let samples: Float32Array;

    switch (cue) {
      case 'whoosh':
        samples = this.synthWhoosh();
        break;
      case 'poof':
        samples = this.synthPoof();
        break;
      case 'boom':
        samples = this.synthBoom();
        break;
      case 'riser':
        samples = this.synthRiser();
        break;
      case 'impact':
        samples = this.synthImpact();
        break;
      case 'ice_crack':
        samples = this.synthIceCrack();
        break;
      case 'pop':
        samples = this.synthPop();
        break;
      case 'bonk':
        samples = this.synthBonk();
        break;
      case 'sparkle':
        samples = this.synthSparkle();
        break;
      case 'record_scratch':
        samples = this.synthRecordScratch();
        break;
      case 'footsteps':
        samples = this.synthFootsteps();
        break;
      case 'wind_loop':
        samples = this.synthWindLoop();
        break;
      case 'room_tone_loop':
        samples = this.synthRoomToneLoop();
        break;
      default:
        // Default subtle pop
        samples = this.synthPop();
        break;
    }

    const pcm = this.floatToPcm16(samples);
    const wavBuffer = OrpheusVoiceSynthesizer.createWavFile(pcm, this.sampleRate, 1, 16);
    fs.writeFileSync(filePath, wavBuffer);

    return {
      cue,
      durationSec: samples.length / this.sampleRate,
      wavBuffer,
      wavPath: filePath,
    };
  }

  public generateAll(): Record<string, SfxSynthesisResult> {
    const cues = [
      'whoosh', 'poof', 'boom', 'riser', 'impact', 'ice_crack',
      'pop', 'bonk', 'sparkle', 'record_scratch', 'footsteps',
      'wind_loop', 'room_tone_loop'
    ];
    const results: Record<string, SfxSynthesisResult> = {};
    for (const cue of cues) {
      results[cue] = this.generate(cue);
    }
    return results;
  }

  // --- Synthesis Implementations ---

  private synthWhoosh(): Float32Array {
    const duration = 0.45;
    const total = Math.floor(this.sampleRate * duration);
    const out = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const t = i / this.sampleRate;
      // Gaussian bell envelope centered at t=0.22s
      const env = Math.exp(-Math.pow((t - 0.22) / 0.1, 2));
      const noise = (Math.random() * 2 - 1) * 0.7;
      const tone = Math.sin(2 * Math.PI * (200 + 400 * t) * t) * 0.3;
      out[i] = (noise + tone) * env;
    }
    return out;
  }

  private synthPoof(): Float32Array {
    const duration = 0.35;
    const total = Math.floor(this.sampleRate * duration);
    const out = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const t = i / this.sampleRate;
      const env = Math.exp(-t * 16);
      const subClick = Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t * 40);
      const noise = (Math.random() * 2 - 1) * env * 0.7;
      out[i] = (subClick + noise) * 0.9;
    }
    return out;
  }

  private synthBoom(): Float32Array {
    const duration = 1.2;
    const total = Math.floor(this.sampleRate * duration);
    const out = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const t = i / this.sampleRate;
      const freq = 130 * Math.exp(-t * 3.5) + 30;
      const phase = 2 * Math.PI * freq * t;
      const sine = Math.sin(phase);
      const env = Math.exp(-t * 3.2);
      // Soft saturation
      out[i] = Math.tanh(sine * 1.8) * env * 0.9;
    }
    return out;
  }

  private synthRiser(): Float32Array {
    const duration = 1.5;
    const total = Math.floor(this.sampleRate * duration);
    const out = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const t = i / this.sampleRate;
      const progress = t / duration;
      const freq = 120 * Math.pow(10, progress * 1.2); // 120Hz -> ~1900Hz
      const sine = Math.sin(2 * Math.PI * freq * t);
      const saw = ((freq * t) % 1) * 2 - 1;
      const env = Math.pow(progress, 1.3);
      out[i] = (sine * 0.6 + saw * 0.4) * env * 0.8;
    }
    return out;
  }

  private synthImpact(): Float32Array {
    const duration = 0.5;
    const total = Math.floor(this.sampleRate * duration);
    const out = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const t = i / this.sampleRate;
      const env = Math.exp(-t * 12);
      const sub = Math.sin(2 * Math.PI * 85 * t) * Math.exp(-t * 15);
      const crack = (Math.random() * 2 - 1) * Math.exp(-t * 60) * 0.5;
      out[i] = (sub + crack) * env;
    }
    return out;
  }

  private synthIceCrack(): Float32Array {
    const duration = 0.6;
    const total = Math.floor(this.sampleRate * duration);
    const out = new Float32Array(total);
    const clicks = [0.04, 0.11, 0.18, 0.22, 0.32, 0.45];
    for (const ct of clicks) {
      const startIdx = Math.floor(ct * this.sampleRate);
      for (let j = 0; j < 1200 && startIdx + j < total; j++) {
        const t = j / this.sampleRate;
        const ping = Math.sin(2 * Math.PI * (2800 + Math.random() * 800) * t);
        out[startIdx + j] += ping * Math.exp(-t * 80) * 0.4;
      }
    }
    return out;
  }

  private synthPop(): Float32Array {
    const duration = 0.16;
    const total = Math.floor(this.sampleRate * duration);
    const out = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const t = i / this.sampleRate;
      const freq = 550 * Math.exp(-t * 30) + 120;
      const env = Math.exp(-t * 24);
      out[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.85;
    }
    return out;
  }

  private synthBonk(): Float32Array {
    const duration = 0.35;
    const total = Math.floor(this.sampleRate * duration);
    const out = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const t = i / this.sampleRate;
      const f1 = Math.sin(2 * Math.PI * 380 * t) * 0.6;
      const f2 = Math.sin(2 * Math.PI * 520 * t) * 0.4;
      const env = Math.exp(-t * 14);
      out[i] = (f1 + f2) * env * 0.9;
    }
    return out;
  }

  private synthSparkle(): Float32Array {
    const duration = 0.85;
    const total = Math.floor(this.sampleRate * duration);
    const out = new Float32Array(total);
    // Arpeggiated C6, E6, G6, C7, E7
    const freqs = [1046.5, 1318.5, 1567.98, 2093.0, 2637.0];
    const step = 0.1;
    freqs.forEach((freq, idx) => {
      const startT = idx * step;
      const startIdx = Math.floor(startT * this.sampleRate);
      for (let j = 0; j < 8000 && startIdx + j < total; j++) {
        const t = j / this.sampleRate;
        const sine = Math.sin(2 * Math.PI * freq * t);
        const env = Math.exp(-t * 16);
        out[startIdx + j] += sine * env * 0.25;
      }
    });
    return out;
  }

  private synthRecordScratch(): Float32Array {
    const duration = 0.42;
    const total = Math.floor(this.sampleRate * duration);
    const out = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const t = i / this.sampleRate;
      const progress = t / duration;
      const speed = Math.sin(progress * Math.PI * 2) * 1.5;
      const noise = (Math.random() * 2 - 1);
      const tone = Math.sin(2 * Math.PI * (800 + 600 * speed) * t);
      const env = Math.sin(progress * Math.PI);
      out[i] = (noise * 0.5 + tone * 0.5) * env * 0.85;
    }
    return out;
  }

  private synthFootsteps(): Float32Array {
    const duration = 0.6;
    const total = Math.floor(this.sampleRate * duration);
    const out = new Float32Array(total);
    const steps = [0.1, 0.35];
    for (const st of steps) {
      const startIdx = Math.floor(st * this.sampleRate);
      for (let j = 0; j < 3000 && startIdx + j < total; j++) {
        const t = j / this.sampleRate;
        const thud = Math.sin(2 * Math.PI * 110 * t) * Math.exp(-t * 35);
        const scuff = (Math.random() * 2 - 1) * Math.exp(-t * 50) * 0.3;
        out[startIdx + j] += (thud + scuff) * 0.7;
      }
    }
    return out;
  }

  private synthWindLoop(): Float32Array {
    const duration = 2.0;
    const total = Math.floor(this.sampleRate * duration);
    const out = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const t = i / this.sampleRate;
      const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * t);
      const noise = (Math.random() * 2 - 1) * 0.15;
      out[i] = noise * (0.4 + 0.6 * lfo);
    }
    return out;
  }

  private synthRoomToneLoop(): Float32Array {
    const duration = 2.0;
    const total = Math.floor(this.sampleRate * duration);
    const out = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const t = i / this.sampleRate;
      const hum = Math.sin(2 * Math.PI * 60 * t) * 0.015;
      const noise = (Math.random() * 2 - 1) * 0.03;
      out[i] = hum + noise;
    }
    return out;
  }

  private floatToPcm16(samples: Float32Array): Buffer {
    const buffer = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      const int16 = s < 0 ? s * 0x8000 : s * 0x7fff;
      buffer.writeInt16LE(Math.floor(int16), i * 2);
    }
    return buffer;
  }
}
