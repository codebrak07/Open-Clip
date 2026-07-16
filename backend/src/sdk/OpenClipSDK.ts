import { RuntimeRegistry } from '../core/registry/RuntimeRegistry';
import { StudioCore } from '../studio/StudioCore';
import { SpeechProvider, VisionProvider, OCRProvider, RenderProvider } from '../core/contracts';

export class OpenClipSDK {
  public static async initialize(): Promise<void> {
    await StudioCore.bootstrap();
  }

  public static getSpeechProvider(): SpeechProvider | undefined {
    return RuntimeRegistry.getProviderByCapability<SpeechProvider>('SpeechRecognition');
  }

  public static getVisionProvider(): VisionProvider | undefined {
    return RuntimeRegistry.getProviderByCapability<VisionProvider>('FaceDetection');
  }

  public static getRenderProvider(): RenderProvider | undefined {
    return RuntimeRegistry.getProviderByCapability<RenderProvider>('VideoEncoding');
  }

  public static registerCustomProvider(provider: any, capabilities: string[]) {
    RuntimeRegistry.registerProvider(provider, capabilities);
  }
}
