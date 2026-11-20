import { WorkflowEngine } from '../workflow/WorkflowEngine';
import { StoryProviderManager, StoryProviderConfig } from './providers/StoryProviderManager';
import { createScriptTask } from './stages/ScriptStage';
import { createStoryboardTask } from './stages/StoryboardStage';
import { createVoiceTask } from './stages/VoiceStage';
import { createAlignmentTask } from './stages/AlignmentStage';
import { createSfxTask } from './stages/SfxStage';
import { createRenderTask } from './stages/RenderStage';
import { createExportTask } from './stages/ExportStage';
import { VersionedArtifactStore } from '../storage/VersionedArtifactStore';
import { Logger } from '../../utils/Logger';

export interface StoryGenerationOptions {
  jobId?: string;
  idea: string;
  durationSec?: number;
  tone?: 'humorous' | 'dramatic' | 'suspenseful' | 'hype' | 'educational';
  characterCount?: number;
  seed?: number;
  forceRefresh?: boolean;
  ttsProvider?: 'auto' | 'kokoro-local' | 'groq-orpheus' | 'macos-say';
}

export class StoryStudioService {
  private providerManager: StoryProviderManager;

  constructor(config?: StoryProviderConfig) {
    this.providerManager = new StoryProviderManager(config);
  }

  public getProviderManager(): StoryProviderManager {
    return this.providerManager;
  }

  /**
   * Executes the full autonomous 8-stage Story Studio pipeline.
   */
  public async generateStoryVideo(options: StoryGenerationOptions): Promise<Record<string, any>> {
    const jobId = options.jobId || `story_${Date.now()}`;
    Logger.info(`[StoryStudioService] Starting autonomous Story Studio job ${jobId} for idea: "${options.idea}"`);

    const tasks = [
      createScriptTask(this.providerManager),
      createStoryboardTask(this.providerManager),
      createVoiceTask(this.providerManager),
      createAlignmentTask(),
      createSfxTask(),
      createRenderTask(),
      createExportTask(),
    ];

    const initialContext = {
      jobId,
      idea: options.idea,
      durationSec: options.durationSec || 60,
      tone: options.tone || 'humorous',
      characterCount: options.characterCount || 2,
      seed: options.seed || 42,
      forceRefresh: options.forceRefresh || false,
      ttsProvider: options.ttsProvider,
    };

    const finalContext = await WorkflowEngine.executeWorkflow(jobId, tasks, initialContext);
    Logger.info(`[StoryStudioService] Job ${jobId} completed successfully.`);
    return finalContext;
  }

  /**
   * Generates just the script and storyboard for user review/editing.
   */
  public async generateStoryboardOnly(options: StoryGenerationOptions): Promise<Record<string, any>> {
    const jobId = options.jobId || `story_${Date.now()}`;
    const tasks = [
      createScriptTask(this.providerManager),
      createStoryboardTask(this.providerManager),
    ];

    const initialContext = {
      jobId,
      idea: options.idea,
      durationSec: options.durationSec || 60,
      tone: options.tone || 'humorous',
      characterCount: options.characterCount || 2,
      seed: options.seed || 42,
      forceRefresh: options.forceRefresh || false,
      ttsProvider: options.ttsProvider,
    };

    return WorkflowEngine.executeWorkflow(jobId, tasks, initialContext);
  }

  /**
   * Renders a modified/edited storyboard starting from VoiceStage through ExportStage.
   */
  public async renderFromStoryboard(jobId: string, storyboard: any, ttsProvider?: 'auto' | 'kokoro-local' | 'groq-orpheus' | 'macos-say'): Promise<Record<string, any>> {
    VersionedArtifactStore.save(jobId, storyboard, 'storyboard', storyboard);

    const tasks = [
      createVoiceTask(this.providerManager),
      createAlignmentTask(),
      createSfxTask(),
      createRenderTask(),
      createExportTask(),
    ];

    const initialContext = {
      jobId,
      storyboard,
      forceRefresh: true,
      ttsProvider,
    };

    return WorkflowEngine.executeWorkflow(jobId, tasks, initialContext);
  }
}
