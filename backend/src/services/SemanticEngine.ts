import { VectorStore, ChunkVector } from './vectorStore';
import { Logger } from '../utils/Logger';

export interface SemanticSearchResult {
  chunk: ChunkVector;
  score: number;
  explanation: string;
}

export class SemanticEngine {
  private static embeddingCache: Map<string, number[]> = new Map();

  public static generateEmbedding(text: string): number[] {
    if (this.embeddingCache.has(text)) {
      return this.embeddingCache.get(text)!;
    }

    const vec = VectorStore.generateSimpleEmbedding(text);
    this.embeddingCache.set(text, vec);
    return vec;
  }

  public static search(
    jobId: string,
    query: string,
    limit: number = 5
  ): SemanticSearchResult[] {
    Logger.info(`[SemanticEngine] Performing vector search for query: "${query}"`, { jobId });

    const rawResults = VectorStore.search(jobId, query, limit);
    return rawResults.map(r => ({
      chunk: r.chunk,
      score: r.score,
      explanation: `Semantic relevance score ${r.score} calculated via feature vector cosine similarity.`,
    }));
  }
}
