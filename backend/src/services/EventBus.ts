import { EventEmitter } from 'events';

export type EventType =
  | 'StageStarted'
  | 'StageCompleted'
  | 'StageFailed'
  | 'StageSkipped'
  | 'JobUpdated'
  | 'JobCompleted'
  | 'JobFailed'
  | 'ProgressUpdated'
  | 'LogMessage'
  | 'RenderAttemptStarted'
  | 'RenderCompleted'
  | 'UploadCompleted'
  | 'MetadataExtracted'
  | 'TranscriptionCompleted'
  | 'OCRCompleted'
  | 'FaceDetectionCompleted'
  | 'SceneDetectionCompleted'
  | 'SemanticIndexed'
  | 'CandidateGenerated'
  | 'RenderQueued';


export interface EventPayload {
  jobId: string;
  timestamp: number;
  [key: string]: any;
}

class GlobalEventBus extends EventEmitter {
  publish(event: EventType, payload: EventPayload) {
    this.emit(event, payload);
    this.emit('*', { event, ...payload });
  }

  subscribe(event: EventType | '*', handler: (payload: any) => void) {
    this.on(event, handler);
  }

  unsubscribe(event: EventType | '*', handler: (payload: any) => void) {
    this.off(event, handler);
  }
}

export const EventBus = new GlobalEventBus();
