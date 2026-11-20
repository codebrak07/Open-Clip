import fs from 'fs';
import path from 'path';
import { Logger } from '../../../utils/Logger';

export interface CatalogGapEntry {
  proposedId: string;
  category: 'homes' | 'platforms' | 'concealers' | 'treatments' | 'formations' | 'locations' | 'props' | 'sfx';
  substitutedId: string;
  context: string;
  timestamp: string;
}

export class CatalogGapLogger {
  private static requestsPath = path.resolve(process.cwd(), 'docs/catalog-requests.json');

  public static sanitizeAndMap(
    proposed: string,
    category: CatalogGapEntry['category'],
    allowedIds: string[],
    defaultId: string,
    context: string = ''
  ): string {
    const cleanProposed = (proposed || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    
    // Direct match
    if (allowedIds.includes(cleanProposed)) {
      return cleanProposed;
    }

    // Substring or prefix match
    const prefixMatch = allowedIds.find(id => cleanProposed.includes(id) || id.includes(cleanProposed));
    const substitute = prefixMatch || defaultId;

    this.logGap({
      proposedId: proposed,
      category,
      substitutedId: substitute,
      context,
      timestamp: new Date().toISOString(),
    });

    Logger.warn(`[CatalogGapLogger] Uncataloged ${category} id "${proposed}" substituted with "${substitute}"`);
    return substitute;
  }

  public static logGap(entry: CatalogGapEntry): void {
    try {
      let existing: CatalogGapEntry[] = [];
      if (fs.existsSync(this.requestsPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(this.requestsPath, 'utf-8'));
        } catch {}
      }

      // Avoid spamming duplicate identical requests
      const isDuplicate = existing.some(e => e.proposedId === entry.proposedId && e.category === entry.category);
      if (!isDuplicate) {
        existing.push(entry);
        fs.mkdirSync(path.dirname(this.requestsPath), { recursive: true });
        fs.writeFileSync(this.requestsPath, JSON.stringify(existing, null, 2), 'utf-8');
      }
    } catch (err: any) {
      Logger.error(`[CatalogGapLogger] Failed to write gap log: ${err.message}`);
    }
  }
}
