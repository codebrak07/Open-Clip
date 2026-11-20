import { db, Job } from '../models/db';
import { PipelineOrchestrator } from '../pipeline/PipelineOrchestrator';
import { JobContext } from '../pipeline/StageRunner';
import { EventBus } from './EventBus';
import { decryptText } from '../utils/security';
import fs from 'fs';

// Import all 15 independent stages
import { UploadStage } from '../pipeline/stages/UploadStage';
import { MetadataStage } from '../pipeline/stages/MetadataStage';
import { WaveformStage } from '../pipeline/stages/WaveformStage';
import { TranscriptionStage } from '../pipeline/stages/TranscriptionStage';
import { SemanticChunkStage } from '../pipeline/stages/SemanticChunkStage';
import { SceneDetectionStage } from '../pipeline/stages/SceneDetectionStage';
import { FrameAnalysisStage } from '../pipeline/stages/FrameAnalysisStage';
import { OCRStage } from '../pipeline/stages/OCRStage';
import { AudioAnalysisStage } from '../pipeline/stages/AudioAnalysisStage';
import { AIAnalysisStage } from '../pipeline/stages/AIAnalysisStage';
import { ClipRankingStage } from '../pipeline/stages/ClipRankingStage';
import { TimelineStage } from '../pipeline/stages/TimelineStage';
import { SubtitleStage } from '../pipeline/stages/SubtitleStage';
import { RenderingStage } from '../pipeline/stages/RenderingStage';
import { ExportStage } from '../pipeline/stages/ExportStage';

import { PipelineRegistry } from '../pipeline/PipelineRegistry';

export class QueueManager {
  private static isProcessing = false;
  private static orchestrator: PipelineOrchestrator;

  static start() {
    // Construct the Orchestrator pipeline with declarative PipelineRegistry
    this.orchestrator = new PipelineOrchestrator();
    for (const stage of PipelineRegistry.getAllStages()) {
      this.orchestrator.registerStage(stage);
    }


    // Event bus listener for logging
    EventBus.subscribe('*', (payload) => {
      if (payload.jobId) {
        try {
          const jobExists = db.prepare('SELECT id FROM jobs WHERE id = ?').get(payload.jobId);
          if (jobExists) {
            const stmt = db.prepare(`
              INSERT INTO job_logs (job_id, stage, message, level, timestamp)
              VALUES (?, ?, ?, ?, ?)
            `);
            stmt.run(
              payload.jobId,
              payload.stageName || payload.event,
              JSON.stringify(payload),
              payload.event?.includes('Failed') ? 'error' : 'info',
              Date.now()
            );
          }
        } catch (err) {
          // Safeguard: logging errors or non-DB jobs must never crash workflow execution
        }
      }
    });

    // Reset pending jobs
    db.prepare("UPDATE jobs SET status = 'pending' WHERE status = 'processing'").run();

    // Start background loop
    setInterval(() => {
      this.processNextJob();
    }, 3000);
  }

  private static async processNextJob() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const getJob = db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1");
      const job = getJob.get() as Job | undefined;

      if (job) {
        const metadata = job.metadata ? JSON.parse(job.metadata) : {};
        const context: JobContext = {
          jobId: job.id,
          videoPath: job.video_path || '',
          provider: metadata.provider || 'groq',
          apiKey: metadata.apiKey ? decryptText(metadata.apiKey) : undefined,
          metadata,
          data: {},
        };

        db.prepare("UPDATE jobs SET status = 'processing', updated_at = ? WHERE id = ?").run(Date.now(), job.id);

        // QueueManager delegates execution directly to PipelineOrchestrator
        await this.orchestrator.run(context, job.current_stage);
      }
    } catch (e: any) {
      console.error('[QueueManager] Job execution error:', e);
    } finally {
      this.isProcessing = false;
    }
  }
}
