import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export class ArtifactStore {
  private static cacheDir = path.resolve(__dirname, '../../artifacts_cache');

  private static ensureDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  public static computeFingerprint(input: string | Buffer): string {
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  public static getArtifact<T = any>(fingerprint: string, artifactType: string): T | null {
    this.ensureDir();
    const filePath = path.join(this.cacheDir, `${fingerprint}_${artifactType}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    }
    return null;
  }

  public static saveArtifact(fingerprint: string, artifactType: string, data: any) {
    this.ensureDir();
    const filePath = path.join(this.cacheDir, `${fingerprint}_${artifactType}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
}
