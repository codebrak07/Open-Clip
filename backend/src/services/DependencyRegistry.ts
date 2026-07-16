import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export interface DependencyDetail {
  id: string;
  name: string;
  category: 'core' | 'ai' | 'vision' | 'audio';
  installed: boolean;
  version: string;
  location: string;
  latencyMs: number;
  health: 'healthy' | 'warning' | 'missing';
  lastCheck: string;
}

export class DependencyRegistry {
  private static registry: Record<string, DependencyDetail> = {};

  public static async detectDependency(
    id: string,
    name: string,
    category: 'core' | 'ai' | 'vision' | 'audio',
    checkCmd: string,
    versionRegex?: RegExp
  ): Promise<DependencyDetail> {
    const start = Date.now();
    let installed = false;
    let version = 'Not Installed';
    let location = 'Unknown';
    let health: 'healthy' | 'warning' | 'missing' = 'missing';

    try {
      const { stdout } = await execPromise(checkCmd);
      installed = true;
      health = 'healthy';
      const output = stdout.trim();
      location = checkCmd.split(' ')[0];

      if (versionRegex) {
        const match = output.match(versionRegex);
        version = match ? match[1] : output.split('\n')[0];
      } else {
        version = output.split('\n')[0] || 'Installed';
      }
    } catch {
      installed = false;
      health = 'missing';
    }

    const latencyMs = Date.now() - start;

    const detail: DependencyDetail = {
      id,
      name,
      category,
      installed,
      version,
      location,
      latencyMs,
      health,
      lastCheck: new Date().toISOString(),
    };

    this.registry[id] = detail;
    return detail;
  }

  public static async verifyAll(): Promise<Record<string, DependencyDetail>> {
    await Promise.all([
      this.detectDependency('ffmpeg', 'FFmpeg Engine', 'core', 'ffmpeg -version', /version\s+([^\s]+)/i),
      this.detectDependency('ffprobe', 'FFprobe Extractor', 'core', 'ffprobe -version', /version\s+([^\s]+)/i),
      this.detectDependency('whisper', 'Whisper ASR', 'audio', 'python3 -c "import whisper; print(whisper.__version__)"'),
      this.detectDependency('torch', 'PyTorch Acceleration', 'ai', 'python3 -c "import torch; print(torch.__version__)"'),
      this.detectDependency('mediapipe', 'MediaPipe Engine', 'vision', 'python3 -c "import mediapipe; print(mediapipe.__version__)"'),
      this.detectDependency('onnx', 'ONNX Runtime', 'ai', 'python3 -c "import onnxruntime; print(onnxruntime.__version__)"'),
      this.detectDependency('faiss', 'FAISS Vector Search', 'ai', 'python3 -c "import faiss; print(faiss.__version__)"'),
      this.detectDependency('tesseract', 'Tesseract OCR', 'vision', 'tesseract --version', /tesseract\s+([^\s]+)/i),
    ]);

    return this.registry;
  }

  public static getDiagnostics(): DependencyDetail[] {
    return Object.values(this.registry);
  }
}
