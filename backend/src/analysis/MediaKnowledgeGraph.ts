export interface GraphNode {
  id: string;
  type: 'frame' | 'scene' | 'speaker' | 'face' | 'emotion' | 'topic' | 'entity' | 'ocr' | 'music' | 'silence' | 'speech';
  timestamp?: number;
  startTime?: number;
  endTime?: number;
  data: Record<string, any>;
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  relationship: 'appearsIn' | 'spokenBy' | 'follows' | 'overlaps' | 'references' | 'mentions' | 'belongsTo';
  weight?: number;
}

export class MediaKnowledgeGraph {
  public jobId: string;
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];

  constructor(jobId: string) {
    this.jobId = jobId;
  }

  public addNode(node: GraphNode) {
    this.nodes.set(node.id, node);
  }

  public addEdge(edge: GraphEdge) {
    this.edges.push(edge);
  }

  public getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  public queryNodesByType(type: GraphNode['type']): GraphNode[] {
    return Array.from(this.nodes.values()).filter(n => n.type === type);
  }

  public getConnectedNodes(nodeId: string, relationship?: GraphEdge['relationship']): GraphNode[] {
    const matchingEdges = this.edges.filter(e =>
      (e.sourceId === nodeId || e.targetId === nodeId) &&
      (!relationship || e.relationship === relationship)
    );

    const connectedIds = new Set<string>();
    for (const edge of matchingEdges) {
      connectedIds.add(edge.sourceId === nodeId ? edge.targetId : edge.sourceId);
    }

    return Array.from(connectedIds).map(id => this.nodes.get(id)!).filter(Boolean);
  }

  public toJSON() {
    return {
      jobId: this.jobId,
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
    };
  }
}
