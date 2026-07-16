import crypto from 'crypto';
import { db } from '../models/db';

export class CacheSystem {
  static hashKey(...parts: string[]): string {
    const hash = crypto.createHash('sha256');
    parts.forEach(p => hash.update(p || ''));
    return hash.digest('hex');
  }

  static getAnalysisCache(hash: string): any | null {
    const row = db.prepare('SELECT response_json FROM analysis_cache WHERE hash = ?').get(hash) as { response_json: string } | undefined;
    if (row) {
      try {
        return JSON.parse(row.response_json);
      } catch {
        return null;
      }
    }
    return null;
  }

  static setAnalysisCache(hash: string, provider: string, model: string, promptHash: string, response: any): void {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO analysis_cache (hash, provider, model, prompt_hash, response_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(hash, provider, model, promptHash, JSON.stringify(response), Date.now());
  }
}
