import fs from 'fs';
import path from 'path';

export interface PluginManifest {
  name: string;
  version: string;
  type: 'provider' | 'stage' | 'renderer' | 'detector' | 'effect';
  main: string;
  description?: string;
}

export interface OpenClipPlugin {
  initialize(): Promise<void>;
  execute(input?: any): Promise<any>;
  shutdown(): Promise<void>;
  metadata(): PluginManifest;
  validate(): Promise<boolean>;
}

export class PluginSystem {
  private static plugins: Map<string, OpenClipPlugin> = new Map();

  static async autoDiscover(baseDir: string = path.resolve(__dirname, '../../plugins')): Promise<void> {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
      return;
    }

    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pluginDir = path.join(baseDir, entry.name);
        const manifestPath = path.join(pluginDir, 'manifest.json');
        const pluginConfigPath = path.join(pluginDir, 'plugin.json');

        const activeManifest = fs.existsSync(manifestPath)
          ? manifestPath
          : fs.existsSync(pluginConfigPath)
          ? pluginConfigPath
          : null;

        if (activeManifest) {
          try {
            const manifest: PluginManifest = JSON.parse(fs.readFileSync(activeManifest, 'utf-8'));
            const mainFile = path.join(pluginDir, manifest.main || 'index.js');
            if (fs.existsSync(mainFile)) {
              const module = require(mainFile);
              const PluginClass = module.default || module;
              const instance: OpenClipPlugin = new PluginClass();
              
              if (await instance.validate()) {
                await instance.initialize();
                this.plugins.set(manifest.name, instance);
                console.log(`[PluginSystem] Registered plugin: ${manifest.name} v${manifest.version}`);
              }
            }
          } catch (e: any) {
            console.error(`[PluginSystem] Failed to load plugin at ${pluginDir}:`, e.message);
          }
        }
      }
    }
  }

  static getPlugin(name: string): OpenClipPlugin | undefined {
    return this.plugins.get(name);
  }

  static listPlugins(): PluginManifest[] {
    return Array.from(this.plugins.values()).map(p => p.metadata());
  }
}
