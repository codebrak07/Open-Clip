import { PipelineStage } from './StageRunner';
import { UploadStage } from './stages/UploadStage';
import { MetadataStage } from './stages/MetadataStage';
import { WaveformStage } from './stages/WaveformStage';
import { SceneDetectionStage } from './stages/SceneDetectionStage';
import { FrameAnalysisStage } from './stages/FrameAnalysisStage';
import { OCRStage } from './stages/OCRStage';
import { AudioAnalysisStage } from './stages/AudioAnalysisStage';
import { TranscriptionStage } from './stages/TranscriptionStage';
import { SemanticChunkStage } from './stages/SemanticChunkStage';
import { AIAnalysisStage } from './stages/AIAnalysisStage';
import { ClipRankingStage } from './stages/ClipRankingStage';
import { TimelineStage } from './stages/TimelineStage';
import { SubtitleStage } from './stages/SubtitleStage';
import { RenderingStage } from './stages/RenderingStage';
import { ExportStage } from './stages/ExportStage';

export class PipelineRegistry {
  private static stages: Map<string, PipelineStage> = new Map();

  public static registerStage(stage: PipelineStage) {
    this.stages.set(stage.name, stage);
  }

  public static getStage(name: string): PipelineStage | undefined {
    return this.stages.get(name);
  }

  public static getAllStages(): PipelineStage[] {
    if (this.stages.size === 0) {
      // Auto-register default 15 stages
      this.registerStage(new UploadStage());
      this.registerStage(new MetadataStage());
      this.registerStage(new WaveformStage());
      this.registerStage(new SceneDetectionStage());
      this.registerStage(new FrameAnalysisStage());
      this.registerStage(new OCRStage());
      this.registerStage(new AudioAnalysisStage());
      this.registerStage(new TranscriptionStage());
      this.registerStage(new SemanticChunkStage());
      this.registerStage(new AIAnalysisStage());
      this.registerStage(new ClipRankingStage());
      this.registerStage(new TimelineStage());
      this.registerStage(new SubtitleStage());
      this.registerStage(new RenderingStage());
      this.registerStage(new ExportStage());
    }
    return Array.from(this.stages.values());
  }
}
