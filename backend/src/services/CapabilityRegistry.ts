import { PluginRegistry, IntelligencePlugin } from '../plugins/PluginRegistry';

export class CapabilityRegistry {
  public static async executeCapability<T = any>(
    capabilityName: string,
    input: any
  ): Promise<{ result: T; provider: string }> {
    const allPlugins = PluginRegistry.getAll();
    const candidateMetadata = allPlugins.filter(p =>
      p.capabilities.includes(capabilityName) && p.healthStatus !== 'missing'
    ).sort((a, b) => a.fallbackPriority - b.fallbackPriority);

    if (candidateMetadata.length === 0) {
      throw new Error(`[CapabilityRegistry] No active plugin available for capability: ${capabilityName}`);
    }

    for (const meta of candidateMetadata) {
      const plugin = PluginRegistry.get(meta.id);
      if (plugin) {
        try {
          const result = await plugin.execute(input);
          return { result, provider: meta.id };
        } catch (err: any) {
          console.warn(`[CapabilityRegistry] Plugin ${meta.id} failed capability ${capabilityName}, attempting fallback...`, err.message);
        }
      }
    }

    throw new Error(`[CapabilityRegistry] All candidate plugins failed for capability: ${capabilityName}`);
  }
}
