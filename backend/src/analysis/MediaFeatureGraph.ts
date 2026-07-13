export interface SpeechNode {
  text: string;
  speaker?: string;
  confidence: number;
  startTime: number;
  endTime: number;
}

export interface FaceNode {
  timestamp: number;
  faceCount: number;
  largestFace?: { x: number; y: number; width: number; height: number };
  faceCenter?: { x: number; y: number };
  eyeContactScore?: number;
}

export interface MotionNode {
  timestamp: number;
  motionDensity: number;
  cameraMovement: 'static' | 'pan' | 'zoom' | 'fast_motion';
}

export interface OCRNode {
  timestamp: number;
  text: string;
  confidence: number;
  bbox?: { x: number; y: number; width: number; height: number };
}

export interface SceneNode {
  sceneId: number;
  startTime: number;
  endTime: number;
  complexityScore: number;
  dominantColor?: string;
}

export interface AudioNode {
  timestamp: number;
  loudnessDb: number;
  speakingRateWpm: number;
  energyPeak: boolean;
  silence: boolean;
  musicDetected: boolean;
}

export class MediaFeatureGraph {
  public jobId: string;
  public speechNodes: SpeechNode[] = [];
  public faceNodes: FaceNode[] = [];
  public motionNodes: MotionNode[] = [];
  public ocrNodes: OCRNode[] = [];
  public sceneNodes: SceneNode[] = [];
  public audioNodes: AudioNode[] = [];

  constructor(jobId: string) {
    this.jobId = jobId;
  }

  public addSpeech(node: SpeechNode) { this.speechNodes.push(node); }
  public addFace(node: FaceNode) { this.faceNodes.push(node); }
  public addMotion(node: MotionNode) { this.motionNodes.push(node); }
  public addOCR(node: OCRNode) { this.ocrNodes.push(node); }
  public addScene(node: SceneNode) { this.sceneNodes.push(node); }
  public addAudio(node: AudioNode) { this.audioNodes.push(node); }

  public getSummary() {
    return {
      speechCount: this.speechNodes.length,
      faceTimelinePoints: this.faceNodes.length,
      motionPoints: this.motionNodes.length,
      ocrBlocks: this.ocrNodes.length,
      scenesCount: this.sceneNodes.length,
      audioMetricsPoints: this.audioNodes.length,
    };
  }
}
