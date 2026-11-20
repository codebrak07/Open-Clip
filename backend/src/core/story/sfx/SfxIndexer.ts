import fs from 'fs';
import path from 'path';
import { ProceduralSfxSynth } from './ProceduralSfxSynth';
import { FFmpegService } from '../../../services/FFmpegService';
import { Logger } from '../../../utils/Logger';

export interface SfxCueEntry {
  cue: string;
  category: string;
  path: string;
  durationSec: number;
  peakDb?: number;
}

export class SfxIndexer {
  private baseDir: string;
  private indexPath: string;
  private proceduralSynth: ProceduralSfxSynth;
  private registry: Map<string, SfxCueEntry> = new Map();

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.resolve(process.cwd(), 'assets/sfx');
    this.indexPath = path.join(this.baseDir, 'index.json');
    this.proceduralSynth = new ProceduralSfxSynth();
    this.init();
  }

  public init() {
    fs.mkdirSync(this.baseDir, { recursive: true });

    // 1. Read existing index if present
    if (fs.existsSync(this.indexPath)) {
      try {
        const raw = fs.readFileSync(this.indexPath, 'utf-8');
        const list: SfxCueEntry[] = JSON.parse(raw);
        for (const entry of list) {
          if (fs.existsSync(entry.path)) {
            this.registry.set(entry.cue, entry);
          }
        }
      } catch (err: any) {
        Logger.warn(`[SfxIndexer] Failed to load index.json: ${err.message}`);
      }
    }

    // 2. Scan directories inside assets/sfx for pre-existing audio
    this.scanAndIndexLocalFiles();
  }

  private scanAndIndexLocalFiles() {
    try {
      const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory() && !ent.name.startsWith('.')) {
          const subDir = path.join(this.baseDir, ent.name);
          const files = fs.readdirSync(subDir);
          for (const f of files) {
            if (f.endsWith('.wav') || f.endsWith('.mp3')) {
              const cueName = ent.name.toLowerCase();
              const fullPath = path.join(subDir, f);
              if (!this.registry.has(cueName)) {
                this.registry.set(cueName, {
                  cue: cueName,
                  category: 'library',
                  path: fullPath,
                  durationSec: 1.0, // default until probed
                  peakDb: -1.0,
                });
              }
            }
          }
        }
      }
    } catch (err: any) {
      Logger.warn(`[SfxIndexer] Error scanning sfx directory: ${err.message}`);
    }
  }

  /**
   * Resolves a cue to an absolute file path. If missing, procedurally synthesizes it.
   */
  public resolveCue(cue: string): SfxCueEntry {
    if (this.registry.has(cue)) {
      const entry = this.registry.get(cue)!;
      if (fs.existsSync(entry.path)) {
        return entry;
      }
    }

    // Procedural fallback
    const res = this.proceduralSynth.generate(cue);
    const entry: SfxCueEntry = {
      cue,
      category: 'procedural',
      path: res.wavPath,
      durationSec: res.durationSec,
      peakDb: -2.0,
    };
    this.registry.set(cue, entry);
    return entry;
  }

  public getAllCues(): SfxCueEntry[] {
    return Array.from(this.registry.values());
  }

  public saveIndex() {
    try {
      fs.writeFileSync(this.indexPath, JSON.stringify(this.getAllCues(), null, 2), 'utf-8');
    } catch (err: any) {
      Logger.warn(`[SfxIndexer] Failed to write index.json: ${err.message}`);
    }
  }
}
