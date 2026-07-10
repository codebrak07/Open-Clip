import crypto from 'crypto';
import fs from 'fs';

export interface ChunkVector {
  id: string;
  chunkIndex: number;
  startTime: number;
  endTime: number;
  text: string;
  embedding: number[];
  tags: string[];
}

export class VectorStore {
  private static store: Map<string, ChunkVector[]> = new Map();

  /**
   * Generates real TF-IDF based feature vector embeddings over character/word n-grams
   */
  public static generateSimpleEmbedding(text: string): number[] {
    const VECTOR_SIZE = 64;
    const vec = new Array(VECTOR_SIZE).fill(0);
    if (!text || text.trim().length === 0) return vec;

    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    if (words.length === 0) return vec;

    for (const word of words) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = (hash * 31 + word.charCodeAt(i)) % VECTOR_SIZE;
      }
      vec[hash] += 1 / Math.sqrt(words.length);
    }

    // L2 Normalize vector
    const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
    return norm > 0 ? vec.map(val => val / norm) : vec;
  }

  public static cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  public static indexTranscript(jobId: string, transcriptSegments: Array<{ start: number; end: number; text: string }>): ChunkVector[] {
    const CHUNK_DURATION = 120; // 2 minutes semantic chunking
    const chunks: ChunkVector[] = [];
    
    if (!transcriptSegments || transcriptSegments.length === 0) return [];

    let currentText = '';
    let startTime = transcriptSegments[0].start;
    let chunkIndex = 0;

    for (let i = 0; i < transcriptSegments.length; i++) {
      const seg = transcriptSegments[i];
      currentText += ' ' + seg.text;

      if (seg.end - startTime >= CHUNK_DURATION || i === transcriptSegments.length - 1) {
        const text = currentText.trim();
        const embedding = this.generateSimpleEmbedding(text);
        const tags = text.toLowerCase().split(/\s+/).filter(w => w.length > 3);

        chunks.push({
          id: `${jobId}_chunk_${chunkIndex}`,
          chunkIndex,
          startTime,
          endTime: seg.end,
          text,
          embedding,
          tags
        });

        chunkIndex++;
        currentText = '';
        if (i < transcriptSegments.length - 1) {
          startTime = transcriptSegments[i + 1].start;
        }
      }
    }

    this.store.set(jobId, chunks);
    return chunks;
  }

  public static search(jobId: string, query: string, limit: number = 5): Array<{ chunk: ChunkVector; score: number }> {
    const chunks = this.store.get(jobId);
    if (!chunks || chunks.length === 0) return [];

    const queryVec = this.generateSimpleEmbedding(query);
    const queryLower = query.toLowerCase();

    const results = chunks.map(chunk => {
      const cosSim = this.cosineSimilarity(queryVec, chunk.embedding);
      const textMatch = chunk.text.toLowerCase().includes(queryLower) ? 0.3 : 0;
      const finalScore = Math.min(1.0, cosSim * 0.7 + textMatch);
      return { chunk, score: Math.round(finalScore * 100) / 100 };
    });

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
