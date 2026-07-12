export type PluginCategory =
  | 'vision'
  | 'audio'
  | 'ocr'
  | 'speech'
  | 'embeddings'
  | 'render'
  | 'reasoning'
  | 'crop'
  | 'scoring'
  | 'export';

export interface PluginMetadata {
  id: string;
  name: string;
  category: PluginCategory;
  version: string;
  capabilities: string[];
  supportedFormats: string[];
  dependencies: string[];
  latencyEstimateMs: number;
  healthStatus: 'healthy' | 'warning' | 'degraded' | 'missing';
  fallbackPriority: number; // Lower is higher priority
}

export interface IntelligencePlugin {
  metadata: PluginMetadata;
  execute: (input: any) => Promise<any>;
}

export class PluginRegistry {
  private static plugins: Map<string, IntelligencePlugin> = new Map();

  public static register(plugin: IntelligencePlugin) {
    this.plugins.set(plugin.metadata.id, plugin);
  }

  public static get(id: string): IntelligencePlugin | undefined {
    return this.plugins.get(id);
  }

  public static getByCategory(category: PluginCategory): IntelligencePlugin[] {
    return Array.from(this.plugins.values())
      .filter(p => p.metadata.category === category)
      .sort((a, b) => a.metadata.fallbackPriority - b.metadata.fallbackPriority);
  }

  public static getAll(): PluginMetadata[] {
    return Array.from(this.plugins.values()).map(p => p.metadata);
  }
}
