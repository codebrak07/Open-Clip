import { BaseProvider } from '../contracts';

export interface ProviderHealth {
  providerId: string;
  installed: boolean;
  warmupTimeMs: number;
  averageLatencyMs: number;
  errorRate: number;
  lastFailure?: string;
  memoryUsageMb: number;
  gpuUsagePct: number;
  fallbackPriority: number;
  healthy: boolean;
}

export class RuntimeRegistry {
  private static providers: Map<string, BaseProvider> = new Map();
  private static healthMap: Map<string, ProviderHealth> = new Map();
  private static capabilities: Map<string, string[]> = new Map();

  public static registerProvider(provider: BaseProvider, capabilityList: string[], fallbackPriority = 1) {
    this.providers.set(provider.id, provider);
    this.capabilities.set(provider.id, capabilityList);
    this.healthMap.set(provider.id, {
      providerId: provider.id,
      installed: true,
      warmupTimeMs: 120,
      averageLatencyMs: 45,
      errorRate: 0.0,
      memoryUsageMb: 85,
      gpuUsagePct: 0,
      fallbackPriority,
      healthy: true,
    });
  }

  public static getProvider<T extends BaseProvider>(id: string): T | undefined {
    return this.providers.get(id) as T | undefined;
  }

  public static getProviderByCapability<T extends BaseProvider>(capability: string): T | undefined {
    for (const [id, caps] of this.capabilities.entries()) {
      if (caps.includes(capability)) {
        const health = this.healthMap.get(id);
        if (health?.healthy) {
          return this.providers.get(id) as T;
        }
      }
    }
    return undefined;
  }

  public static getHealth(id: string): ProviderHealth | undefined {
    return this.healthMap.get(id);
  }

  public static getAllHealth(): ProviderHealth[] {
    return Array.from(this.healthMap.values());
  }
}
