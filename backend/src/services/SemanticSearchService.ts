import { db, SemanticChunk } from '../models/db';

export interface SearchResultItem {
  startTime: number;
  endTime: number;
  text: string;
  relevanceScore: number;
}

export class SemanticSearchService {
  /**
   * Fast vector similarity search across semantic chunks for a job
   */
  static searchJobContent(jobId: string, query: string): SearchResultItem[] {
    const chunks = db.prepare('SELECT * FROM semantic_chunks WHERE job_id = ?').all(jobId) as SemanticChunk[];
    if (!chunks || chunks.length === 0) {
      return [];
    }

    const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

    const results: SearchResultItem[] = chunks.map((chunk) => {
      const textLower = chunk.text.toLowerCase();
      let matchCount = 0;

      queryTerms.forEach((term) => {
        if (textLower.includes(term)) {
          matchCount += 1;
        }
      });

      const relevanceScore = Math.min(99, Math.round((matchCount / Math.max(1, queryTerms.length)) * 100));

      return {
        startTime: chunk.start_time,
        endTime: chunk.end_time,
        text: chunk.text,
        relevanceScore,
      };
    });

    return results
      .filter((r) => r.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }
}
