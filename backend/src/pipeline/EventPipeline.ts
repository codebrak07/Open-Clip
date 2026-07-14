import { EventBus } from '../services/EventBus';
import { Logger } from '../utils/Logger';

export type PipelineEvent =
  | 'UploadCompleted'
  | 'MetadataExtracted'
  | 'TranscriptionCompleted'
  | 'OCRCompleted'
  | 'FaceDetectionCompleted'
  | 'SceneDetectionCompleted'
  | 'SemanticIndexed'
  | 'CandidateGenerated'
  | 'RenderQueued'
  | 'RenderCompleted';

export class EventPipeline {
  public static publish(event: PipelineEvent, jobId: string, payload: Record<string, any>) {
    Logger.info(`[EventPipeline] Published ${event} for job ${jobId}`);
    EventBus.publish(event, { jobId, event, ...payload, timestamp: Date.now() });
  }

  public static subscribe(event: PipelineEvent, handler: (payload: any) => Promise<void> | void) {
    EventBus.subscribe(event, async (payload) => {
      try {
        await handler(payload);
      } catch (err: any) {
        Logger.error(`[EventPipeline] Error in subscriber for ${event}: ${err.message}`);
      }
    });
  }
}
