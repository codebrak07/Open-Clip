import { RuntimeRegistry } from '../core/registry/RuntimeRegistry';
import { StorageManager } from '../core/storage/StorageManager';
import { WhisperSpeechProvider } from '../providers/whisper/WhisperSpeechProvider';
import { MediaPipeVisionProvider } from '../providers/mediapipe/MediaPipeVisionProvider';
import { FFmpegRenderProvider } from '../providers/ffmpeg/FFmpegRenderProvider';
import { Logger } from '../utils/Logger';

export class StudioCore {
  private static isInitialized = false;

  public static async bootstrap(): Promise<void> {
    if (this.isInitialized) return;

    Logger.info('[StudioCore] Bootstrapping OpenClip V8 Studio Engine Architecture...');

    // 1. Initialize Storage Directory Layout
    StorageManager.initializeStorage();

    // 2. Register Startup AI Providers into RuntimeRegistry
    const whisper = new WhisperSpeechProvider();
    const mediaPipe = new MediaPipeVisionProvider();
    const ffmpegRender = new FFmpegRenderProvider();

    RuntimeRegistry.registerProvider(whisper, ['SpeechRecognition', 'Transcription']);
    RuntimeRegistry.registerProvider(mediaPipe, ['FaceDetection', 'SceneDetection']);
    RuntimeRegistry.registerProvider(ffmpegRender, ['VideoEncoding', 'Filtering', 'Trimming']);

    this.isInitialized = true;
    Logger.info('[StudioCore] OpenClip V8 Studio Engine successfully initialized.');
  }

  public static getStatus() {
    return {
      initialized: this.isInitialized,
      providers: RuntimeRegistry.getAllHealth(),
      storagePath: StorageManager.getPath('uploads'),
    };
  }
}
