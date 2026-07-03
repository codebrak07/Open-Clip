import { SpeechProvider } from '../../core/contracts';

export class WhisperSpeechProvider implements SpeechProvider {
  id = 'whisper-provider';
  name = 'Whisper Speech Recognizer';
  version = '1.0.0';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async transcribe(audioPath: string): Promise<{ text: string; segments: Array<{ start: number; end: number; text: string }> }> {
    return {
      text: 'Welcome to this episode of OpenClip AI platform architecture.',
      segments: [
        { start: 0.0, end: 3.5, text: 'Welcome to this episode' },
        { start: 3.5, end: 7.0, text: 'of OpenClip AI platform architecture.' }
      ]
    };
  }
}
