export interface JobContext {
  jobId: string;
  videoPath: string;
  provider: string;
  apiKey?: string;
  metadata: Record<string, any>;
  data: Record<string, any>; // Stores intermediate data between independent stages
}

export interface StageResult {
  success: boolean;
  stageName: string;
  data?: Record<string, any>;
  error?: string;
  skipped?: boolean;
}

export interface PipelineStage {
  name: string;
  initialize(context: JobContext): Promise<void>;
  validate(context: JobContext): Promise<boolean>;
  execute(context: JobContext): Promise<StageResult>;
  cleanup(context: JobContext): Promise<void>;
  rollback(context: JobContext): Promise<void>;
}
